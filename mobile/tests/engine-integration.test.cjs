const test=require('node:test');
const assert=require('node:assert/strict');
const {environment,OWNER,OTHER,TASK,LECTURE,SCHEDULE,journalKey,task,lecture}=require('./helpers/engine-integration.cjs');

const mutations=[
 ['newTask',task()],['saveTask',task()],['deleteTask',{id:TASK}],['taskStatus',{id:TASK,status:'done'}],
 ['newLecture',lecture()],['saveLecture',lecture()],['saveLectureFields',{id:`${LECTURE}_${SCHEDULE}`,patch:{grading_quiz:0}}],['deleteLecture',{id:`${LECTURE}_${SCHEDULE}`}],['absence',{id:`${LECTURE}_${SCHEDULE}`,count:2}],
 ['newEvent',{id:'event-1',title:'private event',date:'2026-10-10',colorTheme:'teal'}],['saveEvent',{id:'event-1',title:'private event',date:'2026-10-10',colorTheme:'teal'}],['deleteEvent',{id:'event-1'}],
 ['profile',{department:'faculty',major:'course',icalUrl:'https://private.invalid/feed',shareTemplates:false}],
 ['setup',['template-1']],['templates',{department:'faculty',major:'course',icalUrl:'',shareTemplates:false}],['suggestion',{id:`${LECTURE}_${SCHEDULE}`}]
];
for(const [type,payload] of mutations)test(`real APIs reject ${type} when session changes after engine precheck`,async t=>{
 const h=environment(t);h.disk.set(`haskapp_tasks_${OWNER}`,JSON.stringify([task({task_name:'A private task'})]));h.disk.set(`haskapp_classes_${OWNER}`,JSON.stringify([lecture()]));h.disk.set(`haskapp_calendar_events_${OWNER}`,JSON.stringify([{id:'event-1',title:'private event',date:'2026-10-10'}]));
 const {engine}=await h.boot();engine.state.templates=[lecture({id:'template-1'})];if(type==='suggestion'){engine.state.profile.department='工学部';engine.state.profile.major='情報理工学コース';}if(['profile','templates','suggestion'].includes(type))h.setOnline(true);
 const beforeApiReads=h.apiReads();h.hooks.beforeApiOwner=()=>h.setOwner(OTHER);
 await engine.dispatch({type,payload});assert.ok(h.apiReads()>beforeApiReads,'test must cross the real API owner boundary');
 assert.equal(h.requests.length,0,'no database query/write may use the wrong account');
 assert.deepEqual([...h.disk.keys()].filter(key=>key.endsWith(OTHER)),[],'no cache/profile/outbox may be written for the replacement account');
 assert.match(engine.state.message,/アカウント/);assert.equal(engine.state.account,OTHER);assert.equal(engine.state.tasks.length,0);assert.equal(engine.state.lectures.length,0);
});

test('expiry to guest cannot receive another account’s task list or draft',async t=>{
 const h=environment(t);h.disk.set(`haskapp_tasks_${OWNER}`,JSON.stringify([task({task_name:'A private task'})]));const {engine}=await h.boot();h.hooks.beforeApiOwner=()=>h.setOwner('guest-ios');await engine.dispatch({type:'newTask',payload:task()});assert.equal(h.disk.has('haskapp_tasks_guest-ios'),false);assert.equal(h.disk.has('haskapp_drafts_guest-ios'),false);assert.equal(h.requests.length,0);
});

async function makePending(h,kind,tail){
 const {engine}=await h.boot();await engine.dispatch({type:kind==='task'?'newTask':'newLecture',payload:kind==='task'?task():lecture()});
 const id=kind==='task'?engine.state.tasks[0].id:engine.state.lectures[0].id;
 await engine.dispatch({type:tail==='delete'?(kind==='task'?'deleteTask':'deleteLecture'):'saveTask',payload:tail==='delete'?{id}:task({id,task_name:'latest local edit'})});
 assert.equal(JSON.parse(h.disk.get(journalKey)).operations.length,2);return {engine,id};
}
for(const kind of ['task','lecture'])test(`atomic ${kind} journal survives failed prefix acknowledgement and process restart`,async t=>{
 const h=environment(t);const {engine,id}=await makePending(h,kind,'delete');
 h.hooks.beforeWrite=(key,value)=>{if(key===journalKey && value && JSON.parse(value).operations.length===1)throw Error('disk rejected atomic acknowledgement')};
 await engine.dispatch({type:'syncPending',payload:{}});
 const durable=JSON.parse(h.disk.get(journalKey));assert.equal(durable.operations.length,2);assert.equal(durable.ids[id],undefined);assert.equal(durable.intent[kind==='task'?'tasks':'lectures'].length,0);
 assert.equal(h.db[kind==='task'?'tasks':'user_lecture_data'].length,1,'server insert occurred before disk failure');
 h.hooks.beforeWrite=undefined;const restarted=await h.boot();await restarted.engine.refresh();assert.equal(restarted.engine.state[kind==='task'?'tasks':'lectures'].length,0,'final deleted intent survives restart');
 await restarted.engine.dispatch({type:'syncPending',payload:{}});assert.equal(h.db[kind==='task'?'tasks':'user_lecture_data'].length,0);assert.equal(h.db.schedules.length,1);assert.ok(h.requests.filter(q=>q.table==='schedules').every(q=>q.operation==='select'));assert.equal(JSON.parse(h.disk.get(journalKey)).operations.length,0);assert.equal(restarted.engine.state.pendingCount,0);
});

test('final task edit survives cache-write failure after server insert and resumes safely',async t=>{
 const h=environment(t);const {engine}=await makePending(h,'task','edit');h.hooks.beforeWrite=(key)=>{if(key===`haskapp_tasks_${OWNER}` && h.db.tasks.length)throw Error('cache disk full')};await engine.dispatch({type:'syncPending',payload:{}});assert.equal(h.db.tasks[0].name,'original task');
 h.hooks.beforeWrite=undefined;const restarted=await h.boot();await restarted.engine.refresh();assert.equal(restarted.engine.state.tasks[0].task_name,'latest local edit');await restarted.engine.dispatch({type:'syncPending',payload:{}});assert.equal(h.db.tasks.length,1);assert.equal(h.db.tasks[0].name,'latest local edit');assert.equal(JSON.parse(h.disk.get(journalKey)).operations.length,0);
});

test('queue reduction and temp ID mapping are inseparable at every persisted acknowledgement',async t=>{
 const h=environment(t);const {engine,id}=await makePending(h,'task','delete');await engine.dispatch({type:'syncPending',payload:{}});
 const acks=h.writes.filter(write=>write.key===journalKey).map(write=>JSON.parse(write.value));assert.ok(acks.some(journal=>journal.operations.length===1 && journal.ids[id]===TASK));
 for(const journal of acks){if(journal.operations[0]?.type==='deleteTask')assert.equal(journal.ids[id],TASK,'dependent operation can never persist without its ID map')}
});

test('process kill immediately after prefix acknowledgement retains final edit and ID mapping',async t=>{
 const h=environment(t);const {engine,id}=await makePending(h,'task','edit');await engine.dispatch({type:'syncPending',payload:{}});
 const cut=h.writes.find(write=>write.key===journalKey && JSON.parse(write.value).operations.length===1 && JSON.parse(write.value).ids[id]===TASK);assert.ok(cut);
 const restarted=environment(t,{disk:cut.disk,db:cut.db});const {engine:next}=await restarted.boot();await next.refresh();assert.equal(next.state.tasks[0].id,TASK);assert.equal(next.state.tasks[0].task_name,'latest local edit');await next.dispatch({type:'syncPending',payload:{}});assert.equal(restarted.db.tasks[0].name,'latest local edit');assert.equal(next.state.pendingCount,0);
});

test('legacy queue and mapping migrate together; empty combined journal stays authoritative',async t=>{
 const h=environment(t);const localId='task-old-local';h.disk.set(`haskapp_outbox_${OWNER}`,JSON.stringify([{type:'taskStatus',payload:{id:localId,status:'done'}}]));h.disk.set(`haskapp_outbox_ids_${OWNER}`,JSON.stringify({[localId]:TASK}));h.disk.set(`haskapp_tasks_${OWNER}`,JSON.stringify([task({id:localId,status:'done'})]));h.disk.set(`haskapp_pending_local_${OWNER}`,'true');h.db.tasks=[{id:TASK,user_id:OWNER,name:'original task',progress_percent:0}];
 const {engine}=await h.boot();await engine.dispatch({type:'syncPending',payload:{}});const journal=JSON.parse(h.disk.get(journalKey));assert.equal(journal.operations.length,0);assert.equal(journal.ids[localId],TASK);assert.equal(h.db.tasks[0].progress_percent,100);
 const restarted=await h.boot();assert.equal(restarted.engine.state.pendingCount,0,'legacy nonempty queue must not resurrect after combined completion');
});

test('registering a shared course displays every canonical slot without schedule writes',async t=>{
 const h=environment(t);h.db.schedules.push({...h.db.schedules[0],id:'77777777-7777-4777-8777-777777777777',day_of_week:3,start_time:'10:30:00'});const {engine}=await h.boot();h.setOnline(true);await engine.dispatch({type:'newLecture',payload:lecture()});assert.equal(engine.state.lectures.length,2);assert.deepEqual(engine.state.lectures.map(l=>l.day_of_the_week),[1,3]);assert.ok(engine.state.lectures.every(l=>l.schedule_is_shared));assert.equal(h.db.user_lecture_data.length,1);assert.ok(h.requests.filter(q=>q.table==='schedules').every(q=>q.operation==='select'));
});
test('real affiliation permission failure does not block owned iCal persistence',async t=>{
 const h=environment(t);const {engine}=await h.boot();h.setOnline(true);await engine.dispatch({type:'profile',payload:{department:'faculty',major:'course',icalUrl:'https://feed.invalid/calendar',shareTemplates:false}});assert.equal(h.db.ical_url_users.length,1);assert.equal(h.db.ical_url_users[0].user_id,OWNER);assert.equal(h.db.ical_url_users[0].ical_url,'https://feed.invalid/calendar');assert.equal(h.db.department_and_major.length,0);assert.equal(JSON.parse(h.disk.get(`haskapp_profile_pending_${OWNER}`)),true);assert.match(engine.state.message,/iCal設定は保存しました/);
});
test('real profile stage stops later writes after an account change during affiliation lookup',async t=>{
 const h=environment(t);const {engine}=await h.boot();h.setOnline(true);h.hooks.beforeQuery=query=>{if(query.table==='department_and_major')h.setOwner(OTHER)};await engine.dispatch({type:'profile',payload:{department:'faculty',major:'course',icalUrl:'https://feed.invalid/calendar',shareTemplates:false}});assert.equal(h.requests.filter(q=>q.table==='ical_url_users').length,0);assert.equal(engine.state.account,OTHER);assert.equal(engine.state.profile.icalUrl,'');assert.match(engine.state.message,/アカウント/);
});

test('pending read-only affiliation does not block unrelated task outbox sync',async t=>{
 const h=environment(t);const {engine}=await h.boot();await engine.dispatch({type:'profile',payload:{department:'faculty',major:'course',icalUrl:'https://feed.invalid/calendar',shareTemplates:false}});await engine.dispatch({type:'newTask',payload:task()});assert.equal(engine.state.pendingCount,3);await engine.dispatch({type:'syncPending',payload:{}});assert.equal(h.db.tasks.length,1);assert.equal(h.db.tasks[0].name,'original task');assert.equal(h.db.ical_url_users.length,1);assert.equal(JSON.parse(h.disk.get(journalKey)).operations.length,0);assert.equal(JSON.parse(h.disk.get(`haskapp_profile_pending_${OWNER}`)),true);assert.equal(engine.state.pendingCount,1);assert.match(engine.state.message,/課題・講義を送信/);assert.match(engine.state.message,/所属.*保存できません/);
});


test('nullable lecture task survives real API mock save, refresh and process restart', async t => {
 const h=environment(t);const {engine}=await h.boot();h.setOnline(true);
 await engine.dispatch({type:'newTask',payload:task({lecture_id:null,deadline:'',task_name:'Personal task'})});
 assert.equal(h.db.tasks.length,1);assert.equal(h.db.tasks[0].group_id,null);assert.equal(h.db.tasks[0].user_id,OWNER);
 assert.equal(engine.state.tasks[0].lecture_id,null);assert.equal(engine.state.drafts.length,0);
 await engine.refresh();assert.equal(engine.state.tasks[0].lecture_id,null);assert.equal(engine.state.tasks[0].task_name,'Personal task');
 await engine.dispatch({type:'saveTask',payload:{...engine.state.tasks[0],task_name:'Personal task edited'}});
 const {engine:restarted}=await h.boot();await restarted.refresh();
 assert.equal(restarted.state.tasks[0].lecture_id,null);assert.equal(restarted.state.tasks[0].task_name,'Personal task edited');
 assert.equal(h.db.tasks[0].group_id,null);assert.equal(h.db.tasks[0].user_id,OWNER);
 assert.equal(h.requests.filter(q=>q.operation!=='select' && ['groups','schedules'].includes(q.table)).length,0);
});

test('real template preview only reads; approved blank fields update owned lecture metadata and never shared templates',async t=>{
 const h=environment(t);const current=lecture({grading_report:0,memo:'private memo',grading_memo:' ',grading_criteria:' '});
 h.disk.set(`haskapp_classes_${OWNER}`,JSON.stringify([current]));
 h.db.user_lecture_data=[{id:LECTURE,user_id:OWNER,group_id:current.lecture_list_id,report_rlate:0,exam_rate:null,mini_exam_rate:null,memo:'private memo',grading_criteria:' '}];
 h.db.user_lecture_data_template=[{id:'99999999-9999-4999-8999-999999999999',user_id:OTHER,group_id:current.lecture_list_id,affiliation_id:'00000001-0001-0001-0000-000000000000',created_at:'2026-09-01T00:00:00Z',report_rate:50,exam_rate:40,grading_criteria:'shared criterion'}];
 const {engine}=await h.boot();engine.state.profile.department='工学部';engine.state.profile.major='情報理工学コース';h.setOnline(true);
 await engine.dispatch({type:'suggestion',payload:{id:current.id}});
 assert.ok(h.requests.length>0);assert.ok(h.requests.every(q=>q.operation==='select'));assert.equal(h.db.user_lecture_data[0].grading_criteria,' ');
 const proposal=engine.state.templateSuggestions[current.id].proposal;assert.equal(proposal.fields.find(f=>f.key==='grading_report').eligible,false);
 await engine.dispatch({type:'applySuggestion',payload:{id:current.id,proposalId:proposal.id,fields:['grading_test','grading_criteria']}});
 assert.equal(h.db.user_lecture_data[0].exam_rate,40);assert.equal(h.db.user_lecture_data[0].report_rlate,0);assert.equal(h.db.user_lecture_data[0].grading_criteria,'shared criterion');assert.equal(h.db.user_lecture_data[0].memo,'private memo');
 assert.ok(h.requests.filter(q=>q.operation!=='select').every(q=>q.table==='user_lecture_data'));
 assert.match(engine.state.message,/共有テンプレートは変更していません/);
});

async function pendingLectureFields(t) {
 const h=environment(t), current=lecture({grading_report:0,memo:'cached private memo'});
 h.disk.set(`haskapp_classes_${OWNER}`,JSON.stringify([current]));
 h.db.user_lecture_data=[{id:LECTURE,user_id:OWNER,group_id:current.lecture_list_id,report_rlate:0,exam_rate:null,mini_exam_rate:null,memo:'server private memo'}];
 const {engine}=await h.boot();
 await engine.dispatch({type:'saveLectureFields',payload:{id:current.id,patch:{grading_test:40},recovery:{...current,grading_test:40}}});
 assert.equal(engine.state.lectures[0].grading_test,40);
 assert.equal(JSON.parse(h.disk.get(journalKey)).operations[0].type,'saveLectureFields');
 assert.equal(h.requests.length,0);
 return {h,engine,current};
}

test('approved-field journal survives restart and never resends a cached unrelated server memo',async t=>{
 const {h}=await pendingLectureFields(t);h.db.user_lecture_data[0].memo='newer server memo';
 const {engine}=await h.boot();await engine.refresh();assert.equal(engine.state.lectures[0].grading_test,40);
 await engine.dispatch({type:'syncPending',payload:{}});
 assert.equal(engine.state.pendingCount,0);assert.equal(h.db.user_lecture_data[0].exam_rate,40);assert.equal(h.db.user_lecture_data[0].report_rlate,0);assert.equal(h.db.user_lecture_data[0].memo,'newer server memo');
 const updates=h.requests.filter(q=>q.operation==='update');assert.equal(updates.length,1);assert.deepEqual(updates[0].payload,{exam_rate:40});
});

test('approved-field replay is idempotent after server success but failed durable acknowledgement',async t=>{
 const {h,engine}=await pendingLectureFields(t);
 h.hooks.beforeWrite=(key,value)=>{if(key===journalKey && value && JSON.parse(value).operations.length===0)throw Error('disk rejected acknowledgement')};
 await engine.dispatch({type:'syncPending',payload:{}});
 assert.equal(h.db.user_lecture_data[0].exam_rate,40);assert.equal(JSON.parse(h.disk.get(journalKey)).operations.length,1);
 h.hooks.beforeWrite=undefined;h.db.user_lecture_data[0].memo='later unrelated server edit';
 const {engine:restarted}=await h.boot();await restarted.refresh();await restarted.dispatch({type:'syncPending',payload:{}});
 assert.equal(restarted.state.pendingCount,0);assert.equal(h.db.user_lecture_data[0].memo,'later unrelated server edit');
 assert.equal(h.requests.filter(q=>q.operation==='update').length,1,'already-equal selected values need no second write');
});

test('remote zero blocks a stale proposed field without dropping its journal or recovery draft',async t=>{
 const {h,engine,current}=await pendingLectureFields(t);h.db.user_lecture_data[0].exam_rate=0;
 await engine.dispatch({type:'syncPending',payload:{}});
 assert.equal(h.db.user_lecture_data[0].exam_rate,0);assert.equal(h.requests.filter(q=>q.operation==='update').length,0);
 assert.equal(engine.state.lectures[0].grading_test,40);assert.equal(engine.state.pendingCount,1);assert.equal(JSON.parse(h.disk.get(journalKey)).operations.length,1);
 const draft=engine.state.drafts.find(d=>d.type==='saveLectureFields');assert.ok(draft);assert.equal(JSON.parse(draft.json).id,current.id);assert.equal(JSON.parse(draft.json).patch.grading_test,40);assert.ok(engine.state.drafts.every(d=>d.type!=='saveLecture'));assert.match(engine.state.message,/別の端末|変更されています/);
});

test('approved-field replay validates its earlier intent before a later changed assessment',async t=>{
 const {h,engine,current}=await pendingLectureFields(t);
 await engine.dispatch({type:'saveLecture',payload:{...current,grading_test:20,grading_report:80}});
 assert.equal(engine.state.lectures[0].grading_report,80);assert.equal(JSON.parse(h.disk.get(journalKey)).operations.length,2);
 await engine.dispatch({type:'syncPending',payload:{}});
 assert.equal(engine.state.pendingCount,0);assert.equal(h.db.user_lecture_data[0].exam_rate,20);assert.equal(h.db.user_lecture_data[0].report_rlate,80);
});

test('approved-field replay advances to a later delete without resurrecting the local lecture',async t=>{
 const {h,engine,current}=await pendingLectureFields(t);
 await engine.dispatch({type:'deleteLecture',payload:{id:current.id}});
 assert.equal(engine.state.lectures.length,0);assert.equal(JSON.parse(h.disk.get(journalKey)).operations.length,2);
 const published=[];engine.subscribe(snapshot=>published.push(JSON.parse(JSON.stringify(snapshot))));
 await engine.dispatch({type:'syncPending',payload:{}});
 assert.equal(engine.state.pendingCount,0);assert.equal(h.db.user_lecture_data.length,0);assert.equal(engine.state.lectures.length,0);
 assert.ok(published.every(snapshot=>snapshot.lectures.length===0));
});

test('approved-field replay does not visibly undo a later explicit local blank-clear',async t=>{
 const {h,engine,current}=await pendingLectureFields(t);
 await engine.dispatch({type:'saveLecture',payload:{...current,grading_test:null}});
 assert.equal(engine.state.lectures[0].grading_test,null);
 const values=[];engine.subscribe(snapshot=>values.push(snapshot.lectures[0]?.grading_test));
 await engine.dispatch({type:'syncPending',payload:{}});
 assert.equal(engine.state.pendingCount,0);assert.equal(h.db.user_lecture_data[0].exam_rate,null);assert.ok(values.every(value=>value==null),'old patch must not flash over final blank intent');
});

test('explicitly cancelling one conflicting proposal unblocks later task sync and retains its backup',async t=>{
 const {h,engine}=await pendingLectureFields(t);h.db.user_lecture_data[0].exam_rate=0;
 await engine.dispatch({type:'newTask',payload:task()});await engine.dispatch({type:'syncPending',payload:{}});
 assert.equal(engine.state.pendingCount,2);const draft=engine.state.drafts.find(d=>d.type==='saveLectureFields');assert.ok(draft);
 const before=h.requests.length;await engine.dispatch({type:'cancelLectureFields',payload:{draftId:draft.id}});
 assert.equal(h.requests.length,before,'cancelling a queued proposal performs no server request');
 assert.equal(engine.state.pendingCount,1);assert.equal(engine.state.lectures[0].grading_test,undefined);assert.ok(engine.state.drafts.some(d=>d.id===draft.id));
 const {engine:restarted}=await h.boot();await restarted.refresh();assert.equal(restarted.state.lectures[0].grading_test,undefined);
 await restarted.dispatch({type:'syncPending',payload:{}});
 assert.equal(restarted.state.pendingCount,0);assert.equal(h.db.user_lecture_data[0].exam_rate,0);assert.equal(h.db.tasks.length,1);assert.equal(restarted.state.lectures[0].grading_test,0);
});

test('cancelling an older proposal preserves later lecture edits and every other queued action',async t=>{
 const {h,engine,current}=await pendingLectureFields(t);h.db.user_lecture_data[0].exam_rate=0;
 await engine.dispatch({type:'saveLecture',payload:{...current,grading_test:20,grading_report:80,memo:'later user memo'}});
 await engine.dispatch({type:'syncPending',payload:{}});const draft=engine.state.drafts.find(d=>d.type==='saveLectureFields');assert.ok(draft);
 await engine.dispatch({type:'cancelLectureFields',payload:{draftId:draft.id}});
 assert.equal(engine.state.lectures[0].grading_test,20);assert.equal(engine.state.lectures[0].grading_report,80);assert.equal(engine.state.lectures[0].memo,'later user memo');
 const operations=JSON.parse(h.disk.get(journalKey)).operations;assert.equal(operations.length,1);assert.equal(operations[0].type,'saveLecture');
 await engine.dispatch({type:'cancelLectureFields',payload:{draftId:draft.id}});assert.equal(engine.state.pendingCount,1);assert.equal(JSON.parse(h.disk.get(journalKey)).operations.length,1);
});

test('failed durable cancellation retains the old queue and final intent after restart',async t=>{
 const {h,engine}=await pendingLectureFields(t);h.db.user_lecture_data[0].exam_rate=0;
 await engine.dispatch({type:'syncPending',payload:{}});const draft=engine.state.drafts.find(d=>d.type==='saveLectureFields');assert.ok(draft);
 h.hooks.beforeWrite=(key,value)=>{if(key===journalKey && value && JSON.parse(value).operations.length===0)throw Error('disk rejected cancellation')};
 await engine.dispatch({type:'cancelLectureFields',payload:{draftId:draft.id}});
 assert.match(engine.state.message,/端末への保存に失敗/);assert.equal(JSON.parse(h.disk.get(journalKey)).operations.length,1);
 h.hooks.beforeWrite=undefined;const {engine:restarted}=await h.boot();await restarted.refresh();
 assert.equal(restarted.state.pendingCount,1);assert.equal(restarted.state.lectures[0].grading_test,40);assert.ok(restarted.state.drafts.some(d=>d.id===draft.id));
});

test('native manual lecture uses private table, preserves zero, and never guesses a shared group',async t=>{
 const h=environment(t);const {engine}=await h.boot();h.setOnline(true);
 await engine.dispatch({type:'newLecture',payload:lecture({id:LECTURE,lecture_list_id:undefined,schedule_is_shared:false,lecture_name:'QA private only',grading_report:0,absences:0})});
 assert.equal(h.db.personal_timetable_entries.length,1);assert.equal(h.db.personal_timetable_entries[0].grading_report,0);assert.equal(h.db.personal_timetable_entries[0].grading_test,null);assert.equal(h.db.personal_timetable_entries[0].academic_year,2026);assert.equal(h.db.user_lecture_data.length,0);
 assert.equal(engine.state.lectures[0].personal_entry,true);assert.equal(engine.state.pendingCount,0);
 assert.ok(h.requests.filter(q=>q.operation!=='select').every(q=>q.table==='personal_timetable_entries'));
 await engine.dispatch({type:'absence',payload:{id:LECTURE,count:1}});assert.equal(h.db.personal_timetable_entries[0].absences,1);
 await engine.dispatch({type:'deleteLecture',payload:{id:LECTURE}});assert.equal(h.db.personal_timetable_entries.length,0);assert.equal(engine.state.lectures.length,0);
});
test('private lecture queued offline survives engine restart and syncs without legacy outbox',async t=>{
 const h=environment(t);const {engine}=await h.boot();await engine.dispatch({type:'newLecture',payload:lecture({id:LECTURE,lecture_list_id:undefined,lecture_name:'QA offline private'})});
 assert.equal(h.requests.length,0);assert.equal(engine.state.pendingCount,1);assert.equal(engine.state.lectures[0].lecture_name,'QA offline private');assert.equal(JSON.parse(h.disk.get(`haskapp_private_sync_v1_${OWNER}`)).queue.length,1);
 const restarted=await h.boot();await restarted.engine.dispatch({type:'syncPending',payload:{}});assert.equal(h.db.personal_timetable_entries.length,1);assert.equal(restarted.engine.state.pendingCount,0);assert.equal(h.db.user_lecture_data.length,0);
});
test('study year/class and official selection sync independently of read-only affiliation',async t=>{
 const h=environment(t);const {engine}=await h.boot();h.setOnline(true);await engine.dispatch({type:'profile',payload:{department:'faculty',major:'course',icalUrl:'',shareTemplates:false,studentYear:2,classGroup:'B'}});
 assert.equal(h.db.private_profile_settings[0].student_year,2);assert.equal(h.db.private_profile_settings[0].class_group,'B');assert.equal(h.db.department_and_major.length,0);
 const id=engine.state.officialCatalog.courses[0].id;await engine.dispatch({type:'officialSelection',payload:{ids:[id]}});assert.deepEqual(h.db.private_profile_settings[0].official_course_ids,[id]);assert.equal(h.db.private_profile_settings.length,1);
});
test('tasks cannot send personal entry UUID into the canonical group FK',async t=>{
 const h=environment(t);const {engine}=await h.boot();h.setOnline(true);await engine.dispatch({type:'newLecture',payload:lecture({id:LECTURE,lecture_list_id:undefined})});const before=h.requests.length;
 await engine.dispatch({type:'newTask',payload:task({lecture_id:LECTURE})});assert.equal(h.db.tasks.length,0);assert.equal(h.requests.length,before);assert.match(engine.state.message,/未指定/);
});
test('unsupported personal metadata remains in owner-scoped device extras after native edits',async t=>{
 const h=environment(t);const {engine}=await h.boot();h.setOnline(true);await engine.dispatch({type:'newLecture',payload:lecture({id:LECTURE,lecture_list_id:undefined,credits:'1単位',lecture_details:'device-only description'})});
 await engine.dispatch({type:'saveLecture',payload:{...engine.state.lectures[0],credits:undefined,lecture_details:'edited locally'}});assert.equal(engine.state.lectures[0].credits,'1単位');assert.equal(engine.state.lectures[0].lecture_details,'edited locally');assert.equal(h.db.personal_timetable_entries[0].lecture_details,undefined);
});

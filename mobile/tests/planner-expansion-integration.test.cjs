const test=require('node:test');const assert=require('node:assert/strict');
const {environment,OTHER,lecture}=require('./helpers/engine-integration.cjs');
test('duplicate manual lecture is rejected before enrollment or private writes',async t=>{
 const h=environment(t);const {engine}=await h.boot();engine.state.lectures=[lecture()];
 const before=h.requests.filter(x=>x.operation!=='select').length;
 await engine.dispatch({type:'newLecture',payload:lecture({id:'new-personal',lecture_list_id:null})});
 assert.match(engine.state.message,/同じターム/);assert.equal(engine.state.lectures.length,1);
 assert.equal(h.requests.filter(x=>x.operation!=='select').length,before);
});
test('QR batch is prevalidated; duplicate slots cannot partially append',async t=>{
 const h=environment(t);const {engine}=await h.boot();const a=lecture({id:'1',lecture_list_id:null}),b=lecture({id:'2',lecture_list_id:null});
 await engine.dispatch({type:'importTimetable',payload:{lectures:[a,b]}});assert.match(engine.state.message,/同じターム/);assert.equal(engine.state.lectures.length,0);
});
test('club activity survives restart but never enters the timetable or another owner',async t=>{
 const h=environment(t);let {engine}=await h.boot();await engine.dispatch({type:'saveActivity',payload:{title:'Local club',details:'Private activity',colorTheme:'pink'}});
 assert.equal(engine.state.activities.length,1);assert.equal(engine.state.lectures.length,0);assert.equal(h.requests.filter(x=>x.table==='groups'&&x.operation!=='select').length,0);
 ({engine}=await h.boot());assert.equal(engine.state.activities[0].title,'Local club');
 h.setOwner(OTHER);await engine.loadAccount();assert.equal(engine.state.activities.length,0);
});
test('linked event retains activity identity and theme after reload',async t=>{
 const h=environment(t);let {engine}=await h.boot();await engine.dispatch({type:'saveActivity',payload:{title:'Local club',colorTheme:'pink'}});const id=engine.state.activities[0].id;
 await engine.dispatch({type:'newEvent',payload:{title:'Meeting',date:'2026-10-20',relatedLectureID:id,colorTheme:'teal'}});assert.equal(engine.state.events[0].colorTheme,'pink');
 ({engine}=await h.boot());assert.equal(engine.state.events[0].relatedLectureID,id);assert.equal(engine.state.events[0].colorTheme,'pink');
});
test('disabled lecture chat never sends and retains owner isolation',async t=>{
 const h=environment(t);const {engine}=await h.boot();engine.state.lectures=[lecture()];await engine.dispatch({type:'lectureChatOpen',payload:{id:lecture().id}});
 assert.equal(engine.state.lectureChat.ready,false);await engine.dispatch({type:'lectureChatSend',payload:{body:'Do not send',nickname:'Sample'}});
 assert.equal(h.requests.filter(x=>x.table==='lecture_chat_messages'&&x.operation!=='select').length,0);
 h.setOwner(OTHER);await engine.loadAccount();assert.equal(engine.state.lectureChat.room,null);
});

test('iCal in-progress is owner-local and keeps feed contents immutable',async t=>{
 const h=environment(t);const {engine}=await h.boot();localStorage.setItem(`haskapp_ical_entries_11111111-1111-4111-8111-111111111111`,JSON.stringify([{uid:'feed',summary:'Imported task',date:'2026-10-20',categories:[]}]));engine.mergeFeed();const task=engine.state.tasks.find(x=>x.id.startsWith('ical-'));assert.ok(task);const before=h.requests.length;await engine.dispatch({type:'taskStatus',payload:{id:task.id,status:'inProgress'}});const changed=engine.state.tasks.find(x=>x.id===task.id);assert.equal(changed.status,'inProgress');assert.equal(changed.progress_percent,50);assert.equal(h.requests.length,before);
});

test('QR repeated slots retain shared local identity across import and restart without copying enrollment identity',async t=>{
 let sequence=0;const h=environment(t,{randomUUID:()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12,'0')}`});
 let {engine}=await h.boot();const group='qr-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 await engine.dispatch({type:'importTimetable',payload:{lectures:[lecture({id:'foreign-1',lecture_list_id:'foreign-group',sharing_group_id:group}),lecture({id:'foreign-2',day_of_the_week:3,period:2,sharing_group_id:group})]}});
 assert.equal(engine.state.lectures.length,2);assert.equal(new Set(engine.state.lectures.map(row=>row.id)).size,2);
 assert.ok(engine.state.lectures.every(row=>row.sharing_group_id===group&&!row.lecture_list_id));
 ({engine}=await h.boot());await engine.refresh();assert.equal(engine.state.lectures.filter(row=>row.sharing_group_id===group).length,2);
 assert.equal(h.requests.filter(q=>q.table==='user_lecture_data'&&q.operation!=='select').length,0);
});

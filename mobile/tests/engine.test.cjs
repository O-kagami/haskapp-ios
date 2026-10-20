const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTs}=require('./helpers/load-ts.cjs');
function setup(t){
 const values=new Map();const calls=[];const hooks={};let user=null;let online=false;let saveError;let sequence=0;
 const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>values.get(k) ?? null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}});
 t.after(()=>{if(old)Object.defineProperty(globalThis,'localStorage',old);else delete globalThis.localStorage});
 const getLocal=k=>JSON.parse(values.get(k) ?? 'null');const setLocal=(k,v)=>values.set(k,JSON.stringify(v));
 const owner=()=>user?.id ?? 'guest-ios';
 const privateDb=require('./helpers/private-backend.cjs').privateBackend(()=>user);
 const client={from:privateDb.from,auth:{getUser:async()=>({data:{user},error:null}),startAutoRefresh(){calls.push({type:'startAutoRefresh'})},stopAutoRefresh(){},signInWithOAuth:async options=>{calls.push({type:'oauthStart',options});return {data:{url:'https://login.invalid/authorize'},error:null}},exchangeCodeForSession:async code=>{calls.push({type:'exchangeCode',code});return {error:null}},signInWithPassword:async p=>{user={id:p.email,email:p.email};online=true;return {error:null}}}};
 const saveTask=async(data,current)=>{
  const id=owner();calls.push({type:'saveTask',data:{...data},online,owner:id,current:[...current]});
  if(hooks.beforeTaskSave)await hooks.beforeTaskSave(data,current);if(saveError)throw saveError;
  const saved={...data,id:data.id ?? (online ? data.mobile_insert_id ?? 'new-server-task':`offline-${++sequence}`),created_at:'',user_id:id,progress_percent:data.status==='done'?100:0};
  setLocal(`haskapp_tasks_${id}`,data.id && current.some(t=>t.id===data.id)?current.map(t=>t.id===data.id?saved:t):[...current,saved]);return saved;
 };
 const lecturesApi={
  fetchLectures:async()=>{if(hooks.fetchLectures)await hooks.fetchLectures();return getLocal(`haskapp_classes_${owner()}`) ?? []},
  searchPublicLectures:async()=>[],
  saveLecture:async(data,current)=>{calls.push({type:'saveLecture',data:{...data},online});const saved={...data,id:data.id ?? `class-${++sequence}`};setLocal(`haskapp_classes_${owner()}`,data.id?current.map(l=>l.id===data.id?saved:l):[...current,saved]);return saved},
  applyLectureFields:async(id,patch,current)=>{calls.push({type:'applyLectureFields',id,patch:{...patch},online});const saved={...current.find(l=>l.id===id),...patch};setLocal(`haskapp_classes_${owner()}`,current.map(l=>l.id===id?saved:l));return saved},
  updateAbsences:async(id,count,current)=>setLocal(`haskapp_classes_${owner()}`,current.map(l=>l.id===id?{...l,absences:count}:l)),
  markSetupStarted:async()=>{calls.push({type:'markSetupStarted'})},markSetupDone:async()=>{calls.push({type:'markSetupDone'})}
 };
 const tasksApi={fetchTasks:async()=>getLocal(`haskapp_tasks_${owner()}`) ?? [],saveTask,
  updateTaskStatus:async(id,status,current)=>{calls.push({type:'taskStatus',id,status,online});setLocal(`haskapp_tasks_${owner()}`,current.map(t=>t.id===id?{...t,status,progress_percent:status==='done'?100:50}:t))},
  deleteTask:async(id,current)=>{calls.push({type:'deleteTask',id,online});setLocal(`haskapp_tasks_${owner()}`,current.filter(t=>t.id!==id))}};
 const eventsApi={fetchEvents:async()=>getLocal(`haskapp_events_${owner()}`) ?? [],saveEvent:async(data,current)=>{calls.push({type:'saveEvent',data});const saved={...data,id:data.id ?? `event-${++sequence}`};setLocal(`haskapp_events_${owner()}`,data.id?current.map(e=>e.id===data.id?saved:e):[...current,saved]);return saved}};
 const insightHelpers=loadTs('src/lecture-insights.ts',{'../web-contract/lib/supabase':{supabase:client,configured:true,getCurrentUserId:async()=>owner()}});
 const overrides={
 'react-native':{AppState:{currentState:'active'}},
 'expo-crypto':{randomUUID:()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12,'0')}`},
 './auth-flow':{getAuthRedirectUri:()=> 'haskapp://auth/callback',requestEmailLink:async email=>{calls.push({type:'magicLink',email});if(hooks.magicLink)await hooks.magicLink(email)},acceptAuthCallback:async url=>{calls.push({type:'authCallback',url});return hooks.authCallback?await hooks.authCallback(url):url.startsWith('haskapp://auth/callback?code=')}},
 './department-chat':{...loadTs('src/department-chat.ts',{'../web-contract/lib/supabase':{supabase:client}}),departmentChatEnabled:false},
 './lecture-insights':{...insightHelpers,fetchTemplateLectureEvidence:async(groupId,affiliationId)=>{calls.push({type:'templateEvidence',groupId,affiliationId});return hooks.templateEvidence?await hooks.templateEvidence():[{templateId:'template-1',creatorId:null,groupId,affiliationId,createdAt:'2026-09-01T00:00:00Z',values:{classroom:'shared room'}}]}},
 './grade-history':{gradeHistoryContext:lecture=>JSON.stringify([lecture.lecture_name,lecture.instructor]),fetchGradeHistory:async(lecture,owner)=>{calls.push({type:'gradeHistory',lecture,owner});return hooks.gradeHistory?await hooks.gradeHistory():[]}},

 'expo-web-browser':{maybeCompleteAuthSession(){},openAuthSessionAsync:async(url,redirect)=>{calls.push({type:'oauthBrowser',redirect});return hooks.oauthResult ?? {type:'cancel'}}},'expo-auth-session':{makeRedirectUri:()=> 'haskapp://auth/callback'},
 '../web-contract/lib/supabase':{supabase:client,configured:true,guestId:"guest-ios",getCurrentUserId:async()=>owner(),getCurrentUser:async()=>{if(hooks.getCurrentUser)await hooks.getCurrentUser();return user},getSupabaseStatus:()=>online,setSupabaseOffline:()=>{online=false},retryConnection:()=>{online=true},signOutUser:async()=>{user=null;online=false}},
 '../web-contract/lib/api/lectures':{lecturesApi},
 '../web-contract/lib/api/tasks':{tasksApi},
 '../web-contract/lib/api/events':{eventsApi},
 '../web-contract/lib/api/user-settings':{getUserSettingsFromSupabase:async()=>({department:null,major:null}),getIcalUrlFromSupabase:async()=>({icalUrl:null}),saveDepartmentAndMajorToSupabase:async()=>hooks.saveDepartment?await hooks.saveDepartment():'affiliation',saveIcalUrlToSupabase:async()=>{calls.push({type:'saveIcalURL'})},fetchTemplateLectureSuggestion:async()=>({classroom:'shared room'}),fetchTemplatesForDepartment:async()=>({templates:[]})},
 '../web-contract/lib/setup-templates':{faculties:loadTs('web-contract/lib/setup-templates.ts').faculties,getAffiliationId:()=>''},
 '../web-contract/lib/api/offline-sync':{getLocal,setLocal},'./storage':{flushStorage:async()=>{if(hooks.flush)await hooks.flush()}}
 };
 const {engine}=loadTs('src/engine.ts',overrides);
 return {engine,values,setLocal,getLocal,calls,hooks,lecturesApi,setUser:u=>{user=u},setOnline:v=>{online=v},setError:e=>{saveError=e}};
}
const task=(id='draft-task')=>({id,task_name:'assignment',deadline:'2026-10-06',status:'todo',colorTheme:'teal'});
const lecture=(id='lecture-1')=>({id,lecture_name:'course',lecture_list_id:'canonical-group',day_of_the_week:1,period:1,colorTheme:'teal',instructor:''});
const feed=()=>[{uid:'uid-1',summary:'feed task',date:'2026-10-06',categories:[]}];
test('guest starts empty and cache remains scoped after login/logout',async t=>{
 const {engine,setLocal}=setup(t);setLocal('haskapp_tasks_guest-ios',[{id:'guest-task',task_name:'private guest',deadline:'2026-10-06'}]);setLocal('haskapp_tasks_person@example.invalid',[{id:'remote-task',task_name:'account task',deadline:'2026-10-07'}]);
 await engine.initialize();assert.equal(engine.state.tasks[0].id,'guest-task');
 await engine.dispatch({type:'login',payload:{email:'person@example.invalid',password:'not-saved'}});assert.equal(engine.state.tasks[0].id,'remote-task');
 await engine.dispatch({type:'logout',payload:{}});assert.equal(engine.state.tasks[0].id,'guest-task');
});
test('rejected task edit stays recoverable and does not become confirmed data',async t=>{
 const {engine,setError,values}=setup(t);await engine.initialize();setError(new Error('schema restriction'));
 await engine.dispatch({type:'newTask',payload:{id:'local-draft',task_name:'keep this',deadline:'2026-10-06',status:'todo'}});
 assert.equal(engine.state.tasks.length,0);assert.equal(engine.state.drafts.length,1);assert.match(engine.state.message,/schema/);assert.equal(JSON.parse(engine.state.drafts[0].json).task_name,'keep this');assert.ok(values.has('haskapp_drafts_guest-ios'));
});
test('login failures never persist credentials as recoverable drafts',async t=>{
 const {engine,values}=setup(t);await engine.initialize();
 await engine.dispatch({type:'unsupported',payload:{password:'private-secret'}});assert.equal(engine.state.drafts.length,0);assert.ok(![...values.values()].some(v=>v.includes('private-secret')));
});
test('refresh preserves unsent account cache instead of replacing it',async t=>{
 const {engine,setLocal,setUser}=setup(t);setUser({id:'owner',email:'owner@example.invalid'});
 setLocal('haskapp_pending_local_owner',true);setLocal('haskapp_tasks_owner',[{id:'unsent',task_name:'pending',deadline:'2026-10-06'}]);
 await engine.initialize();await engine.dispatch({type:'refresh',payload:{}});assert.equal(engine.state.tasks[0].id,'unsent');assert.match(engine.state.connection,/未同期/);
});
test('iCal tasks retain completion locally without database mutations',async t=>{
 const {engine,setLocal}=setup(t);setLocal('haskapp_ical_entries_guest-ios',[{uid:'uid-1',summary:'feed task',date:'2026-10-06',categories:[]}]);await engine.initialize();assert.equal(engine.state.tasks.length,1);assert.equal(engine.state.events.length,0);
 const id=engine.state.tasks[0].id;await engine.dispatch({type:'taskStatus',payload:{id,status:'done'}});assert.equal(engine.state.tasks[0].progress_percent,100);await engine.dispatch({type:'refresh',payload:{}});assert.equal(engine.state.tasks[0].status,'done');
});

test('stale queued save is retained only for its originating account',async t=>{
 const {engine,calls,getLocal}=setup(t);await engine.initialize();
 const login=engine.dispatch({type:'login',payload:{email:'next-owner',password:'not-saved'}});
 const save=engine.dispatch({type:'newTask',payload:task()});await Promise.all([login,save]);
 assert.equal(calls.filter(c=>c.type==='saveTask').length,0);assert.equal(engine.state.account,'next-owner');assert.equal(engine.state.drafts.length,0);
 assert.equal(getLocal('haskapp_drafts_guest-ios')[0].title,'assignment');assert.equal(getLocal('haskapp_drafts_next-owner'),null);
});
test('manual event actions also reject a changed account',async t=>{
 const {engine,setUser,calls,getLocal}=setup(t);await engine.initialize();setUser({id:'other',email:'other'});
 await engine.dispatch({type:'newEvent',payload:{id:'draft-event',title:'private event',date:'2026-10-06'}});
 assert.equal(calls.filter(c=>c.type==='saveEvent').length,0);assert.equal(getLocal('haskapp_drafts_guest-ios')[0].title,'private event');assert.equal(engine.state.events.length,0);
});
test('refresh drops stale results after the authenticated user changes during fetch',async t=>{
 const {engine,setUser,setLocal,hooks}=setup(t);setUser({id:'first'});setLocal('haskapp_classes_first',[lecture()]);await engine.initialize();
 engine.state.searchResults=[{id:'private-result'}];engine.state.templates=[lecture()];hooks.fetchLectures=async()=>setUser({id:'second'});
 await engine.dispatch({type:'refresh',payload:{}});assert.equal(engine.state.lectures.length,0);assert.equal(engine.state.templates.length,0);assert.equal(engine.state.searchResults.length,0);assert.match(engine.state.message,/アカウント/);
});
test('pending refresh retains iCal completion and lecture extras without fetching server lists',async t=>{
 const {engine,setUser,setLocal,hooks}=setup(t);setUser({id:'owner'});setLocal('haskapp_pending_local_owner',true);setLocal('haskapp_classes_owner',[lecture()]);setLocal('haskapp_lecture_extras_owner',{'lecture-1':{belongings:'calculator'}});setLocal('haskapp_ical_entries_owner',feed());setLocal('haskapp_completed_ical_tasks_owner',['ical-uid-1-2026-10-06']);hooks.fetchLectures=()=>assert.fail('must preserve pending cache');
 await engine.initialize();assert.equal(engine.state.lectures[0].belongings,'calculator');assert.equal(engine.state.tasks[0].status,'done');assert.equal(engine.state.events.length,0);
});
test('an outbox alone protects pending cache even if its legacy pending flag is missing',async t=>{
 const {engine,setUser,setLocal,hooks}=setup(t);setUser({id:'owner'});setLocal('haskapp_outbox_owner',[{type:'saveTask',payload:task()}]);setLocal('haskapp_tasks_owner',[task()]);hooks.fetchLectures=()=>assert.fail('must not refresh over queued edits');await engine.initialize();assert.equal(engine.state.tasks[0].id,'draft-task');assert.equal(engine.state.pendingCount,1);
});
test('iCal completion never creates a cloud outbox operation',async t=>{
 const {engine,setUser,setLocal,setOnline,getLocal}=setup(t);setUser({id:'owner'});setLocal('haskapp_ical_entries_owner',feed());await engine.initialize();setOnline(false);await engine.dispatch({type:'taskStatus',payload:{id:'ical-uid-1-2026-10-06',status:'done'}});assert.equal(getLocal('haskapp_sync_journal_owner')?.operations,undefined);assert.equal(engine.state.pendingCount,0);
});
test('new offline edits stay in FIFO order after a refresh tentatively reconnects',async t=>{
 const {engine,setUser,setOnline,calls,getLocal}=setup(t);setUser({id:'owner'});await engine.initialize();setOnline(false);await engine.dispatch({type:'newTask',payload:task('stable-id')});const id=engine.state.tasks[0].id;
 await engine.dispatch({type:'refresh',payload:{}});await engine.dispatch({type:'saveTask',payload:{...task(id),task_name:'latest edit'}});
 assert.deepEqual(calls.filter(c=>c.type==='saveTask').map(c=>c.online),[false,false]);assert.equal(getLocal('haskapp_sync_journal_owner')?.operations.length,2);assert.equal(engine.state.tasks[0].task_name,'latest edit');
});
test('outbox is created before disk failures are surfaced and a later action can continue',async t=>{
 const {engine,setUser,setOnline,hooks,getLocal}=setup(t);setUser({id:'owner'});await engine.initialize();setOnline(false);hooks.flush=async()=>{throw Error('disk full')};await engine.dispatch({type:'newTask',payload:task()});
 assert.equal(getLocal('haskapp_sync_journal_owner')?.operations.length,1);assert.equal(getLocal('haskapp_pending_local_owner'),true);assert.match(engine.state.message,/保存に失敗/);hooks.flush=undefined;await engine.dispatch({type:'refresh',payload:{}});assert.equal(engine.state.tasks.length,1);
});
test('outbox replay maps actual inserted task rather than trailing iCal task',async t=>{
 const {engine,setUser,setLocal,setOnline,calls,getLocal}=setup(t);setUser({id:'owner'});setLocal('haskapp_ical_entries_owner',feed());await engine.initialize();setOnline(false);
 await engine.dispatch({type:'newTask',payload:task('stable-server-id')});const id=engine.state.tasks.find(t=>!t.id.startsWith('ical-')).id;await engine.dispatch({type:'taskStatus',payload:{id,status:'done'}});
 await engine.dispatch({type:'syncPending',payload:{}});assert.equal(calls.filter(c=>c.type==='taskStatus').at(-1).id,'stable-server-id');assert.equal(getLocal('haskapp_sync_journal_owner')?.ids[id],'stable-server-id');assert.equal(engine.state.pendingCount,0);assert.equal(engine.state.tasks.filter(t=>!t.id.startsWith('ical-')).length,1);assert.equal(engine.state.tasks.find(t=>t.id==='stable-server-id').status,'done');
});
test('failed replay restores the final local edit and keeps only the unsent suffix',async t=>{
 const {engine,setUser,setOnline,hooks,getLocal}=setup(t);setUser({id:'owner'});await engine.initialize();setOnline(false);await engine.dispatch({type:'newTask',payload:task('stable-id')});const id=engine.state.tasks[0].id;await engine.dispatch({type:'saveTask',payload:{...task(id),task_name:'newest edit'}});
 hooks.beforeTaskSave=async data=>{if(data.id)throw Error('server rejected update')};await engine.dispatch({type:'syncPending',payload:{}});
 assert.equal(engine.state.tasks[0].id,'stable-id');assert.equal(engine.state.tasks[0].task_name,'newest edit');assert.equal(getLocal('haskapp_tasks_owner')[0].task_name,'newest edit');assert.equal(getLocal('haskapp_sync_journal_owner')?.operations.length,1);assert.equal(getLocal('haskapp_pending_local_owner'),true);
 hooks.beforeTaskSave=undefined;await engine.dispatch({type:'syncPending',payload:{}});assert.equal(engine.state.pendingCount,0);assert.equal(engine.state.tasks[0].task_name,'newest edit');
});
test('replay interrupted by account change cannot restore old edits into the new account',async t=>{
 const {engine,setUser,setOnline,hooks,getLocal}=setup(t);setUser({id:'owner'});await engine.initialize();setOnline(false);await engine.dispatch({type:'newTask',payload:task('stable-id')});hooks.beforeTaskSave=async()=>setUser({id:'new-owner',email:'new-owner'});
 await engine.dispatch({type:'syncPending',payload:{}});assert.equal(engine.state.account,'new-owner');assert.equal(engine.state.tasks.length,0);assert.equal(getLocal('haskapp_tasks_new-owner'),null);assert.equal(getLocal('haskapp_tasks_owner')[0].task_name,'assignment');assert.equal(getLocal('haskapp_sync_journal_owner')?.operations.length,1);
});
test('rejected draft is flushed without relying on the native bridge',async t=>{
 const {engine,setError,hooks}=setup(t);await engine.initialize();let flushed=0;hooks.flush=async()=>{flushed++};setError(Error('rejected'));await engine.dispatch({type:'newTask',payload:task()});assert.equal(flushed,1);assert.equal(engine.state.drafts.length,1);
});
test('manual task mutations exclude imported feed rows from Web cache input',async t=>{
 const {engine,setLocal,calls}=setup(t);setLocal('haskapp_ical_entries_guest-ios',feed());await engine.initialize();await engine.dispatch({type:'newTask',payload:task()});assert.equal(calls.find(c=>c.type==='saveTask').current.length,0);assert.equal(engine.state.tasks.length,2);
});
test('invalid task date/status and lecture counts are rejected before API calls',async t=>{
 const {engine,calls}=setup(t);await engine.initialize();await engine.dispatch({type:'newTask',payload:{...task(),deadline:'2026-02-30'}});await engine.dispatch({type:'newTask',payload:{...task(),status:'unexpected'}});await engine.dispatch({type:'newLecture',payload:{...lecture(),grading_attendance_total:-1}});await engine.dispatch({type:'newEvent',payload:{title:'bad date',date:'not-a-date'}});
 assert.equal(calls.filter(c=>['saveTask','saveLecture','saveEvent'].includes(c.type)).length,0);assert.equal(engine.state.drafts.length,4);
});
test('suggestion preview makes no mutation; explicitly selected offline application uses the existing journal',async t=>{
 const {engine,setUser,setLocal,setOnline,getLocal,calls}=setup(t);setUser({id:'owner'});setLocal('haskapp_classes_owner',[lecture()]);await engine.initialize();engine.state.profile.department='工学部';engine.state.profile.major='情報理工学コース';setOnline(false);await engine.dispatch({type:'suggestion',payload:{id:'lecture-1'}});assert.equal(engine.state.lectures[0].classroom,undefined);assert.equal(calls.filter(c=>c.type==='saveLecture').length,0);assert.equal(getLocal('haskapp_sync_journal_owner'),null);const proposal=engine.state.templateSuggestions['lecture-1'].proposal;await engine.dispatch({type:'applySuggestion',payload:{id:'lecture-1',proposalId:proposal.id,fields:['classroom']}});assert.equal(engine.state.lectures[0].classroom,'shared room');assert.equal(getLocal('haskapp_sync_journal_owner')?.operations[0].type,'saveLectureFields');assert.match(engine.state.message,/クラウドへの反映は未完了/);
});
test('offline template setup journals every lecture instead of silently losing them on refresh',async t=>{
 const {engine,setUser,setOnline,getLocal,calls}=setup(t);setUser({id:'owner'});await engine.initialize();setOnline(false);engine.state.templates=[lecture('template-1'),{...lecture('template-2'),period:2}];await engine.dispatch({type:'setup',payload:['template-1','template-2']});
 assert.equal(getLocal('haskapp_sync_journal_owner')?.operations.length,2);assert.equal(calls.filter(c=>c.type==='markSetupDone').length,1);await engine.dispatch({type:'refresh',payload:{}});assert.equal(engine.state.lectures.length,2);
});
test('invalid iCal URL cannot overwrite the saved profile',async t=>{
 const {engine,getLocal}=setup(t);await engine.initialize();await engine.dispatch({type:'importIcal',payload:{...engine.state.profile,icalUrl:'http://insecure.invalid/feed'}});assert.equal(getLocal('haskapp_profile_guest-ios'),null);assert.equal(engine.state.profile.icalUrl,'');
});
test('clearing an iCal subscription removes its imported rows and completion records',async t=>{
 const {engine,setLocal,getLocal}=setup(t);setLocal('haskapp_profile_guest-ios',{department:'',major:'',shareTemplates:false,icalUrl:'https://old.invalid/feed'});setLocal('haskapp_pending_local_guest-ios',true);setLocal('haskapp_ical_entries_guest-ios',feed());setLocal('haskapp_completed_ical_tasks_guest-ios',['ical-uid-1-2026-10-06']);await engine.initialize();await engine.dispatch({type:'profile',payload:{...engine.state.profile,icalUrl:''}});assert.equal(engine.state.tasks.length,0);assert.equal(engine.state.events.length,0);assert.equal(getLocal('haskapp_completed_ical_tasks_guest-ios'),null);
});

test('Google OAuth cancellation leaves the current account and drafts unchanged',async t=>{
 const {engine,calls}=setup(t);await engine.initialize();await engine.dispatch({type:'googleLogin',payload:{}});assert.equal(engine.state.account,'端末内のゲスト');assert.equal(engine.state.drafts.length,0);assert.equal(calls.filter(c=>c.type==='exchangeCode').length,0);
});
test('Google OAuth rejects unexpected callback destinations and provider errors',async t=>{
 const {engine,hooks,calls,values}=setup(t);await engine.initialize();
 for(const url of ['https://evil.invalid/auth/callback?code=private-code','haskapp://auth/other?code=private-code','haskapp://auth/callback?error=access_denied&code=private-code']){hooks.oauthResult={type:'success',url};await engine.dispatch({type:'googleLogin',payload:{}});assert.ok(engine.state.message);}
 assert.equal(calls.filter(c=>c.type==='exchangeCode').length,0);assert.equal(engine.state.drafts.length,0);assert.ok(![...values.values()].some(v=>v.includes('private-code')));
});
test('Google OAuth exchanges a code only from the expected redirect',async t=>{
 const {engine,hooks,calls}=setup(t);await engine.initialize();hooks.oauthResult={type:'success',url:'haskapp://auth/callback?code=expected-code'};await engine.dispatch({type:'googleLogin',payload:{}});assert.equal(calls.find(c=>c.type==='authCallback').url,'haskapp://auth/callback?code=expected-code');
});
test('duplicate iCal UID/date pairs render once and use the latest content',async t=>{
 const {engine,setLocal}=setup(t);setLocal('haskapp_ical_entries_guest-ios',[...feed(),{...feed()[0],summary:'updated'}]);await engine.initialize();assert.equal(engine.state.tasks.length,1);assert.equal(engine.state.tasks[0].task_name,'updated');assert.equal(engine.state.events.length,0);
});

test('tasks without a deadline are valid and remain date-less',async t=>{
 const {engine,calls}=setup(t);await engine.initialize();await engine.dispatch({type:'newTask',payload:{...task(),deadline:''}});assert.equal(engine.state.tasks[0].deadline,'');assert.equal(calls.filter(c=>c.type==='saveTask').length,1);assert.equal(engine.state.drafts.length,0);
});
test('saving one unidentified new lecture cannot discard an unrelated rejected draft',async t=>{
 const {engine,setLocal}=setup(t);const rejected={...lecture(),lecture_name:'keep rejected'};delete rejected.id;setLocal('haskapp_drafts_guest-ios',[{id:'saved-draft',type:'newLecture',title:rejected.lecture_name,json:JSON.stringify(rejected)}]);await engine.initialize();const next={...lecture(),lecture_name:'other course'};delete next.id;await engine.dispatch({type:'newLecture',payload:next});assert.equal(engine.state.drafts.length,1);assert.equal(engine.state.drafts[0].title,'keep rejected');
});
test('profile save stops before iCal transmission if the account changes during affiliation save',async t=>{
 const {engine,setUser,hooks,calls,getLocal}=setup(t);setUser({id:'first'});await engine.initialize();hooks.saveDepartment=async()=>setUser({id:'second',email:'second'});await engine.dispatch({type:'profile',payload:{department:'faculty',major:'course',icalUrl:'https://private.invalid/feed',shareTemplates:false}});
 assert.equal(calls.filter(c=>c.type==='saveIcalURL').length,0);assert.equal(getLocal('haskapp_profile_pending_first'),true);assert.equal(getLocal('haskapp_profile_second'),null);assert.equal(engine.state.profile.icalUrl,'');
});
test('profile action validates nonempty iCal URLs before transmission',async t=>{
 const {engine,setUser,calls,getLocal}=setup(t);setUser({id:'owner'});await engine.initialize();await engine.dispatch({type:'profile',payload:{department:'faculty',major:'course',icalUrl:'http://invalid.invalid/feed',shareTemplates:false}});assert.equal(calls.filter(c=>c.type==='saveIcalURL').length,0);assert.equal(getLocal('haskapp_profile_owner').icalUrl,'');assert.match(engine.state.message,/HTTPS/);
});
test('lecture save reloads owner cache so shared metadata updates appear on sibling slots',async t=>{
 const {engine,setLocal,lecturesApi}=setup(t);setLocal('haskapp_classes_guest-ios',[lecture('slot-1'),{...lecture('slot-2'),period:2}]);await engine.initialize();lecturesApi.saveLecture=async(data,current)=>{const updated=current.map(l=>({...l,classroom:data.classroom}));setLocal('haskapp_classes_guest-ios',updated);return updated.find(l=>l.id===data.id)};
 await engine.dispatch({type:'saveLecture',payload:{...lecture('slot-1'),classroom:'new room'}});assert.deepEqual(engine.state.lectures.map(l=>l.classroom),['new room','new room']);
});

test('restoring an existing task/event to an empty cache keeps the saved item visible',async t=>{
 const {engine}=setup(t);await engine.initialize();await engine.dispatch({type:'saveTask',payload:task('existing-task')});await engine.dispatch({type:'saveEvent',payload:{id:'existing-event',title:'restored event',date:'2026-10-06'}});assert.equal(engine.state.tasks[0].id,'existing-task');assert.equal(engine.state.events[0].id,'existing-event');
});
test('an orphan pending marker never authorizes overwriting potentially unsent cache',async t=>{
 const {engine,setUser,setLocal,getLocal}=setup(t);setUser({id:'owner'});setLocal('haskapp_pending_local_owner',true);setLocal('haskapp_tasks_owner',[task('unsent')]);await engine.initialize();await engine.dispatch({type:'syncPending',payload:{}});assert.equal(engine.state.tasks[0].id,'unsent');assert.equal(getLocal('haskapp_pending_local_owner'),true);assert.match(engine.state.message,/送信履歴/);
});

test('magic link request reports delivery without persisting auth data or drafts',async t=>{
 const {engine,calls,values}=setup(t);await engine.initialize();await engine.dispatch({type:'magicLink',payload:{email:'person@example.invalid'}});assert.equal(calls.find(c=>c.type==='magicLink').email,'person@example.invalid');assert.match(engine.state.message,/メール/);assert.equal(engine.state.drafts.length,0);assert.ok(![...values.values()].some(v=>v.includes('person@example.invalid')));
});
test('auth callback reloads the new account but never stores its URL or code',async t=>{
 const {engine,hooks,setUser,setLocal,values}=setup(t);await engine.initialize();setLocal('haskapp_tasks_signed-in',[task('account-task')]);hooks.authCallback=async()=>{setUser({id:'signed-in',email:'signed-in'});return true};await engine.dispatch({type:'authCallback',payload:{url:'haskapp://auth/callback?code=one-time-secret'}});assert.equal(engine.state.account,'signed-in');assert.equal(engine.state.tasks[0].id,'account-task');assert.ok(![...values.values()].some(v=>v.includes('one-time-secret')));
});
test('rejected template create draft has a stable UUID that native editors can reopen',async t=>{
 const {engine,lecturesApi}=setup(t);await engine.initialize();engine.state.templates=[lecture('template-1')];lecturesApi.saveLecture=async()=>{throw Error('server rejected')};await engine.dispatch({type:'setup',payload:['template-1']});const draft=engine.state.drafts[0];const payload=JSON.parse(draft.json);assert.match(payload.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);await engine.dispatch({type:draft.type,payload});assert.equal(engine.state.drafts.length,1);assert.equal(JSON.parse(engine.state.drafts[0].json).id,payload.id);
});
test('grade history is scoped by lecture and cleared after account changes',async t=>{
 const {engine,setLocal,hooks,calls}=setup(t);setLocal('haskapp_classes_guest-ios',[lecture()]);await engine.initialize();const row={id:'grade-row',academicTerm:'2025',distribution:[80,null],preferred:true};hooks.gradeHistory=async()=>[row];await engine.dispatch({type:'gradeHistory',payload:{id:'lecture-1'}});assert.deepEqual(engine.state.gradeHistory['lecture-1'],[row]);assert.equal(calls.find(c=>c.type==='gradeHistory').owner,'guest-ios');await engine.dispatch({type:'login',payload:{email:'new-owner',password:'not-stored'}});assert.deepEqual(engine.state.gradeHistory,{});
});
test('grade history response is discarded when the account changes during retrieval',async t=>{
 const {engine,setLocal,hooks,setUser}=setup(t);setLocal('haskapp_classes_guest-ios',[lecture()]);await engine.initialize();hooks.gradeHistory=async()=>{setUser({id:'new-owner'});return [{id:'private-result'}]};await engine.dispatch({type:'gradeHistory',payload:{id:'lecture-1'}});assert.deepEqual(engine.state.gradeHistory,{});assert.match(engine.state.message,/アカウント/);
});

test('read-only affiliation rejection does not block the independent iCal setting',async t=>{
 const {engine,setUser,hooks,calls,getLocal}=setup(t);setUser({id:'owner'});await engine.initialize();hooks.saveDepartment=async()=>null;await engine.dispatch({type:'profile',payload:{department:'faculty',major:'course',icalUrl:'https://feed.invalid/calendar',shareTemplates:false}});assert.equal(calls.filter(c=>c.type==='saveIcalURL').length,1);assert.equal(getLocal('haskapp_profile_pending_owner'),true);assert.equal(engine.state.pendingCount,1);assert.match(engine.state.message,/iCal設定は保存しました/);assert.match(engine.state.message,/所属.*保存できません/);
});
test('iCal import continues after partial profile save and reports the unresolved affiliation',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});globalThis.fetch=async()=>({ok:true,text:async()=> 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:partial-save\r\nDTSTART;VALUE=DATE:20261010\r\nSUMMARY:Imported despite affiliation restriction\r\nEND:VEVENT\r\nEND:VCALENDAR'});
 const {engine,setUser,hooks,getLocal}=setup(t);setUser({id:'owner'});await engine.initialize();hooks.saveDepartment=async()=>null;await engine.dispatch({type:'importIcal',payload:{department:'faculty',major:'course',icalUrl:'https://feed.invalid/calendar',shareTemplates:false}});assert.equal(engine.state.tasks.length,1);assert.equal(getLocal('haskapp_profile_pending_owner'),true);assert.match(engine.state.message,/1件.*取り込み/);assert.match(engine.state.message,/所属.*保存できません/);
});

test('affiliation choices use the Web faculty and linked course names',async t=>{
 const {engine}=setup(t);await engine.initialize();
 assert.equal(engine.state.affiliations.length,1);
 assert.equal(engine.state.affiliations[0].faculty,'工学部');
 assert.equal(engine.state.affiliations[0].majors.length,5);
 assert.ok(engine.state.affiliations[0].majors.every(name=>name.startsWith('情報エレクトロニクス学科 ')));
});

test('settings and entry Google action explicitly request the native callback and skip browser redirects',async t=>{
 const {engine,calls}=setup(t);await engine.initialize();await engine.dispatch({type:'googleLogin',payload:{}});
 assert.deepEqual(calls.find(c=>c.type==='oauthStart').options,{provider:'google',options:{redirectTo:'haskapp://auth/callback',skipBrowserRedirect:true}});
 assert.equal(calls.find(c=>c.type==='oauthBrowser').redirect,'haskapp://auth/callback');
 assert.equal(engine.state.account,'端末内のゲスト');
});

test('official selection and study year stay owner-scoped without shared database writes',async t=>{
 const {engine,setLocal,getLocal,calls,setUser}=setup(t);await engine.initialize();
 const id=engine.state.officialCatalog.courses.find(x=>x.title==='信号処理' && x.classGroup==='A').id;
 await engine.dispatch({type:'officialSelection',payload:{ids:[id,id]}});
 assert.deepEqual(engine.state.officialSelection,[id]);assert.ok(engine.state.officialLectures.length>0);assert.equal(calls.filter(x=>x.type==='saveLecture').length,0);
 await engine.dispatch({type:'profile',payload:{department:'工学部',major:'情報エレクトロニクス学科 情報理工学コース',icalUrl:'',shareTemplates:false,studentYear:2,classGroup:'A'}});
 assert.equal(getLocal('haskapp_profile_guest-ios').studentYear,2);
 await engine.loadAccount();assert.deepEqual(engine.state.officialSelection,[id]);assert.equal(engine.state.profile.studentYear,2);
 setUser({id:'different-owner',email:'other@example.invalid'});await engine.loadAccount();assert.deepEqual(engine.state.officialSelection,[]);assert.deepEqual(engine.state.officialLectures,[]);assert.equal(engine.state.profile.studentYear,0);
 setUser(null);await engine.loadAccount();assert.deepEqual(engine.state.officialSelection,[id]);assert.equal(engine.state.profile.studentYear,2);
 await engine.dispatch({type:'officialSelection',payload:{ids:['bad']}});assert.deepEqual(getLocal('haskapp_official_selection_guest-ios'),[id]);
 setLocal('haskapp_profile_guest-ios',{department:'工学部',major:'旧表記',icalUrl:'',shareTemplates:false});await engine.loadAccount();assert.equal(engine.state.profile.studentYear,2,'owner private profile remains authoritative over legacy incomplete settings');
});
test('guest chat cannot send; disabled service retains owner draft without database calls',async t=>{
 const {engine,setUser,getLocal}=setup(t);await engine.initialize();await engine.dispatch({type:'chatOpen',payload:{}});assert.equal(engine.state.chat.ready,false);assert.deepEqual(engine.state.chat.messages,[]);
 setUser({id:'chat-owner',email:'owner@example.invalid'});await engine.loadAccount();await engine.dispatch({type:'profile',payload:{department:'工学部',major:'情報エレクトロニクス学科 情報理工学コース',icalUrl:'',shareTemplates:false,studentYear:3}});await engine.dispatch({type:'chatOpen',payload:{}});
 assert.equal(engine.state.chat.room.id,'hokudai:engineering:info-elec');assert.equal(engine.state.chat.ready,false);
 await engine.dispatch({type:'chatSend',payload:{body:'unsent private',nickname:'Nick'}});
 assert.equal(engine.state.chat.draft,'unsent private');assert.ok(engine.state.message.includes('送信できません'));
 const saved=getLocal('haskapp_chat_draft_chat-owner_hokudai:engineering:info-elec');assert.equal(saved.body,'unsent private');
 await engine.dispatch({type:'chatSend',payload:{body:'unsent private',nickname:'Nick'}});assert.equal(getLocal('haskapp_chat_draft_chat-owner_hokudai:engineering:info-elec').id,saved.id);
 setUser(null);await engine.loadAccount();assert.equal(engine.state.chat.draft,'');assert.deepEqual(engine.state.chat.messages,[]);
});

test('all lecture-save entrypoints reject fractional or overfull assessment totals before the API',async t=>{
 const {engine,calls}=setup(t);await engine.initialize();
 await engine.dispatch({type:'newLecture',payload:{...lecture(),grading_report:50,grading_test:70}});
 await engine.dispatch({type:'newLecture',payload:{...lecture(),grading_report:12.5}});
 assert.equal(calls.filter(c=>c.type==='saveLecture').length,0);assert.equal(engine.state.drafts.length,2);
});


test('suggestion preflight auth failure completes the exact recovery request without any template read',async t=>{
 const {engine,setUser,setLocal,hooks,calls}=setup(t);setUser({id:'owner'});setLocal('haskapp_classes_owner',[lecture()]);await engine.initialize();
 hooks.getCurrentUser=async()=>{throw Error('auth transport failed')};
 await engine.dispatch({type:'suggestion',payload:{id:'lecture-1',requestId:'native-recovery-request'}});
 assert.equal(engine.state.templateSuggestions['lecture-1'].requestId,'native-recovery-request');assert.equal(engine.state.templateSuggestions['lecture-1'].status,'error');assert.equal(engine.state.templateSuggestions['lecture-1'].proposal,undefined);assert.equal(engine.state.busy,false);assert.equal(calls.filter(call=>call.type==='templateEvidence').length,0);
});

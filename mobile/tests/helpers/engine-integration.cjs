// Integration harness: engine, storage, offline-sync and all data APIs are real.
// Only native platform primitives, auth/session source, disk, and DB transport
// are fakes. Every request/write is observable; no network access is possible.
const {loadTs}=require('./load-ts.cjs');
const OWNER='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const TASK='33333333-3333-4333-8333-333333333333';
const GROUP='44444444-4444-4444-8444-444444444444';
const LECTURE='55555555-5555-4555-8555-555555555555';
const SCHEDULE='66666666-6666-4666-8666-666666666666';
const journalKey=`haskapp_sync_journal_${OWNER}`;
const copy=value=>JSON.parse(JSON.stringify(value));
const task=(overrides={})=>({id:TASK,user_id:OWNER,created_at:'2026-10-01T00:00:00Z',task_name:'original task',deadline:'2026-10-10',status:'todo',progress_percent:0,colorTheme:'teal',lecture_id:GROUP,...overrides});
const lecture=(overrides={})=>({id:`${LECTURE}_${SCHEDULE}`,lecture_name:'course',lecture_list_id:GROUP,term:'2026年度 2学期（秋ターム）',day_of_the_week:1,period:1,colorTheme:'teal',instructor:'',...overrides});

function environment(t,initial={}){
 const descriptors={window:Object.getOwnPropertyDescriptor(globalThis,'window'),localStorage:Object.getOwnPropertyDescriptor(globalThis,'localStorage'),fetch:Object.getOwnPropertyDescriptor(globalThis,'fetch')};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
 Object.defineProperty(globalThis,'fetch',{configurable:true,value:async()=>({ok:true,text:async()=> 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR'})});
 t.after(()=>{for(const [key,descriptor] of Object.entries(descriptors)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}});
 const disk=new Map(initial.disk ?? []),requests=[],writes=[],hooks={};
 const db=copy(initial.db ?? {groups:[{id:GROUP,name:'course'}],public_lecture_data:[],tasks:[],user_lecture_data:[],schedules:[{id:SCHEDULE,group_id:GROUP,user_id:OTHER,day_of_week:1,start_time:'08:45:00',end_time:'10:15:00',period_start_daytime:'2026-10-01T00:00:00.000Z'}],grade_distributions:[],department_and_major:[],ical_url_users:[],affiliation:[]});
 let activeOwner=OWNER,online=false,apiReads=0;
 const session={
  configured:true,guestId:'guest-ios',
  getCurrentUser:async()=>activeOwner==='guest-ios'?null:{id:activeOwner,email:activeOwner},
  getCurrentUserId:async()=>{apiReads++;if(hooks.beforeApiOwner)await hooks.beforeApiOwner();return activeOwner},
  getSupabaseStatus:()=>online,setSupabaseOffline:()=>{online=false},retryConnection:()=>{online=true},
  signOutUser:async()=>{activeOwner='guest-ios';online=false}
 };
 const privateDb=require('./private-backend.cjs').privateBackend(()=>activeOwner==='guest-ios'?null:{id:activeOwner},db);privateDb.hooks.before=async q=>{const mapped={table:q.table,operation:q.op,payload:q.payload};requests.push(copy(mapped));if(hooks.beforeQuery)await hooks.beforeQuery(mapped);};
 const client={auth:{getUser:async()=>({data:{user:{id:activeOwner}},error:null}),startAutoRefresh(){},stopAutoRefresh(){}},from(table){
  if(['private_profile_settings','personal_timetable_entries'].includes(table))return privateDb.from(table);
  const q={table,operation:'select',filters:[],single:false,payload:null};
  const builder={
   select(){return builder},limit(){return builder},order(){return builder},
   insert(payload){q.operation='insert';q.payload=payload;return builder},
   update(payload){q.operation='update';q.payload=payload;return builder},
   delete(){q.operation='delete';return builder},
   eq(key,value){q.filters.push([key,value]);return builder},
   is(key,value){q.filters.push([key,value]);return builder},
   in(key,value){q.filters.push([key,value]);return builder},
   single(){q.single=true;return builder},maybeSingle(){q.single=true;return builder},
   then(resolve,reject){return Promise.resolve().then(async()=>{
    requests.push(copy(q));if(hooks.beforeQuery)await hooks.beforeQuery(q);
    const readOnly=['groups','public_lecture_data','schedules','grade_distributions','department_and_major','affiliation'].includes(table);
    const ownerOnly=['tasks','user_lecture_data','ical_url_users','user_lecture_data_template'].includes(table);
    if(q.operation!=='select' && (readOnly || ownerOnly && q.payload?.user_id && q.payload.user_id!==activeOwner))return {data:null,error:{code:'42501',message:'row-level security denied'}};
    const rows=db[table] ?? (db[table]=[]);let selected=rows.filter(row=>(!ownerOnly || table==='user_lecture_data_template' && q.operation==='select' || row.user_id===activeOwner) && q.filters.every(([key,value])=>Array.isArray(value)?value.includes(row[key]):value===null?row[key]==null:row[key]===value));
    if(q.operation==='insert'){
     const id=q.payload.id ?? (table==='user_lecture_data'?LECTURE:table==='schedules'?SCHEDULE:TASK);
     if(rows.some(row=>row.id===id))return {data:null,error:{code:'23505',message:'duplicate key'}};
     selected=[{...q.payload,id,created_at:'2026-10-01T00:00:00Z'}];rows.push(...selected);
    }
    if(q.operation==='update')selected.forEach(row=>Object.assign(row,q.payload));
    if(q.operation==='delete')db[table]=rows.filter(row=>!selected.includes(row));
    return {data:q.single ? selected[0] ?? null:selected,error:null};
   }).then(resolve,reject)}
  };return builder;
 }};
 session.supabase=client;
 const asyncStorage={
  getAllKeys:async()=>[...disk.keys()],multiGet:async keys=>keys.map(key=>[key,disk.get(key)??null]),
  setItem:async(key,value)=>{if(hooks.beforeWrite)await hooks.beforeWrite(key,value);disk.set(key,value);writes.push({key,value,disk:[...disk],db:copy(db)});},
  removeItem:async key=>{if(hooks.beforeWrite)await hooks.beforeWrite(key,null);disk.delete(key);writes.push({key,value:null,disk:[...disk],db:copy(db)})}
 };
 async function boot(){
  const storage=loadTs('src/storage.ts',{'@react-native-async-storage/async-storage':asyncStorage});await storage.hydrateStorage();
  const {engine}=loadTs('src/engine.ts',{
   'expo-crypto':{randomUUID:initial.randomUUID??(()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')},'./auth-flow':{getAuthRedirectUri:()=> 'haskapp://auth/callback',requestEmailLink:async()=>{},acceptAuthCallback:async()=>false},
   'react-native':{AppState:{currentState:'active'}},'expo-web-browser':{maybeCompleteAuthSession(){}},'expo-auth-session':{makeRedirectUri:()=> 'haskapp://auth/callback'},
   '../web-contract/lib/supabase':session,'@/lib/supabase':session,'./storage':storage,
  });
  await engine.loadAccount();
  engine.state.tasks=JSON.parse(disk.get(`haskapp_tasks_${activeOwner}`)??'[]');
  engine.state.lectures=JSON.parse(disk.get(`haskapp_classes_${activeOwner}`)??'[]');
  engine.state.events=JSON.parse(disk.get(`haskapp_calendar_events_${activeOwner}`)??'[]');
  return {engine,storage};
 }
 return {boot,disk,db,requests,writes,hooks,setOwner:value=>{activeOwner=value},setOnline:value=>{online=value},apiReads:()=>apiReads};
}
module.exports={environment,OWNER,OTHER,TASK,GROUP,LECTURE,SCHEDULE,journalKey,task,lecture};

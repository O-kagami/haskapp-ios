import {emptyTimetableView,readTimetableView,effectiveTimetable,replacingTimetable,undoTimetable,persistTimetableView,type TimetableView} from './timetable-view';
import {loadCampusDirectory,type CampusDirectory} from './campus-directory';
import {lectureHistory,sendLectureMessage,lectureChatEnabled} from './lecture-chat';
import {assertNoNewConflicts} from './planner-rules';
import {searchCatalog,normalizeSearch} from './catalog-search';
import {PrivateSync,type PrivateState} from './private-sync';
import {personalLecture,personalEntry} from './personal-lecture';
import {DepartmentChat,departmentRoom,departmentChatEnabled,validateChat,mergeChat,type ChatSnapshot} from './department-chat';
import {officialCatalog,officialLecturesFor,validateStudyProfile} from './official-timetable';
import {AppState} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {requestEmailLink,acceptAuthCallback,getAuthRedirectUri} from './auth-flow';
import {type GradeHistoryRow} from './grade-history';
import {LectureDetailResources,verifiedSuggestionAffiliation} from './lecture-detail-resources';
import {type ResourceStatus,type TemplateSuggestionState} from './lecture-insights';
import * as WebBrowser from 'expo-web-browser';
import {supabase,configured,guestId,getCurrentUser,getCurrentUserId,getSupabaseStatus,setSupabaseOffline,retryConnection,signOutUser} from '../web-contract/lib/supabase';
import {lecturesApi,syncCurrentUserLectureTemplates} from '../web-contract/lib/api/lectures';
import {tasksApi} from '../web-contract/lib/api/tasks';
import {eventsApi} from '../web-contract/lib/api/events';
import {getIcalUrlFromSupabase,getUserSettingsFromSupabase,saveDepartmentAndMajorToSupabase,saveIcalUrlToSupabase,fetchTemplatesForDepartment,updateTemplateRates} from '../web-contract/lib/api/user-settings';
import {parseIcalEntries} from '../web-contract/lib/ical';
import {faculties,getAffiliationId} from '../web-contract/lib/setup-templates';
import {getLocal,setLocal} from '../web-contract/lib/api/offline-sync';
import type {LectureWithDetails,TaskWithUI,CalendarEvent,PublicLectureSearchResult} from '../web-contract/lib/types';
import {flushStorage} from './storage';
WebBrowser.maybeCompleteAuthSession();
export type Profile={department:string;major:string;icalUrl:string;shareTemplates:boolean;icalExpiry?:string;studentYear?:number;classGroup?:string};
export const affiliationChoices=faculties.map(f=>({faculty:f.name,majors:f.departments.flatMap(d=>d.courses.map(c=>`${d.name} ${c.name}`))}));
export type ClubActivity={id:string;title:string;details:string;colorTheme:string};
export type Snapshot={timetableView:TimetableView;activities:ClubActivity[];campus:CampusDirectory;lectureChat:ChatSnapshot;chat:ChatSnapshot;officialCatalog:typeof officialCatalog;officialSelection:string[];officialLectures:LectureWithDetails[];affiliations:typeof affiliationChoices;lectures:LectureWithDetails[];tasks:TaskWithUI[];events:CalendarEvent[];searchResults:PublicLectureSearchResult[];searchStatus:string;searchQuery:string;templates:LectureWithDetails[];profile:Profile;account:string;displayName:string;avatarURL:string;connection:string;configured:boolean;busy:boolean;message:string;revision:number;pendingCount:number;drafts:Draft[];gradeHistory:Record<string,GradeHistoryRow[]>;gradeHistoryStatus:Record<string,ResourceStatus>;templateSuggestions:Record<string,TemplateSuggestionState>};
type Action={type:string;payload:any};
export type Draft={id:string;type:string;title:string;json:string};
type Outcome={ok:boolean;savedId?:string};
type SyncJournal={version:1;operations:Action[];ids:Record<string,string>;intent?:{lectures:LectureWithDetails[];tasks:TaskWithUI[]}};
const blankProfile=():Profile=>({department:'',major:'',icalUrl:'',shareTemplates:false,icalExpiry:'',studentYear:0,classGroup:''});
class PlannerEngine {
 private readonly privateSync=new PrivateSync({client:supabase,storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},identity:async()=>{const id=await getCurrentUserId();const user=await getCurrentUser();if(user && id!==user.id)throw Error('アカウントが変更されています。');return user;},flush:flushStorage,online:getSupabaseStatus});
 private privateState():PrivateState{return this.privateSync.read(this.owner);}
 private personal(id:string){return this.privateState().entries.some(e=>e.id===id);}
 private mergePersonal(lectures=this.state.lectures){const ids=new Set(this.privateState().entries.map(e=>e.id));const extra=getLocal<Record<string,Partial<LectureWithDetails>>>(`haskapp_personal_extras_${this.owner}`)??{};return [...lectures.filter(l=>!ids.has(l.id)&&!(l as any).personal_entry),...this.privateState().entries.map(e=>({...personalLecture(e),...extra[e.id]}))];}
 private applyPrivateProfile(){const p=this.privateState().profile;if(p){this.state.profile={...this.state.profile,studentYear:p.student_year??0,classGroup:p.class_group??''};this.state.officialSelection=p.official_course_ids;this.state.officialLectures=officialLecturesFor(p.official_course_ids);setLocal(`haskapp_profile_${this.owner}`,this.state.profile);setLocal(`haskapp_official_selection_${this.owner}`,p.official_course_ids);}}
 private async syncPrivate(owner:string){if(owner===guestId)return;try{await this.privateSync.sync(owner);await this.assertOwner(owner);this.applyPrivateProfile();}catch(error){await this.assertOwner(owner);this.state.message=error instanceof Error?error.message:'個人時間割の未送信変更は端末に保持しています。';}}
 private async savePersonal(p:LectureWithDetails,owner:string){await this.privateSync.save(owner,personalEntry(p,owner));const extras=getLocal<Record<string,Partial<LectureWithDetails>>>(`haskapp_personal_extras_${owner}`)??{};const deviceFields=['sharing_group_id','lecture_details','syllabus_id','belongings','colorTheme','credits','discipline','gpa','aRate','passRate','historicalInstructor','historicalEnrollment','gradeDistribution','template_creator_id','template_rating'];extras[p.id]={...extras[p.id],...Object.fromEntries(deviceFields.filter(k=>(p as any)[k]!==undefined).map(k=>[k,(p as any)[k]]))};setLocal(`haskapp_personal_extras_${owner}`,extras);await flushStorage();await this.assertOwner(owner);await this.syncPrivate(owner);this.state.lectures=this.mergePersonal();setLocal(`haskapp_classes_${owner}`,this.state.lectures);}

 state:Snapshot={timetableView:emptyTimetableView(),activities:[],campus:{entries:[],status:'掲載準備中です'},lectureChat:{room:null,messages:[],status:'講義チャットは準備中です',ready:false,hasMore:false,draft:'',nickname:''},chat:{room:null,messages:[],status:'学科チャットは準備中です',ready:false,hasMore:false,draft:'',nickname:''},officialCatalog,officialSelection:[],officialLectures:[],affiliations:affiliationChoices,lectures:[],tasks:[],events:[],searchResults:[],searchStatus:'未検索',searchQuery:'',templates:[],profile:blankProfile(),account:'端末内のゲスト',displayName:'',avatarURL:'',connection:'クラウド未設定',configured,busy:false,message:'',revision:0,pendingCount:0,drafts:[],gradeHistory:{},gradeHistoryStatus:{},templateSuggestions:{}};
 private readonly lectureDetails=new LectureDetailResources({
  state:()=>this.state,owner:()=>this.owner,assertOwner:owner=>this.assertOwner(owner),
  lecture:id=>this.state.lectures.find(lecture=>lecture.id===id),
  historyLecture:id=>{const lecture=this.state.lectures.find(lecture=>lecture.id===id);if(lecture)return lecture;const course=officialCatalog.courses.find(course=>course.id===id);return course ? {id:course.id,lecture_name:course.title,instructor:course.instructor}:undefined;},
  affiliation:()=>verifiedSuggestionAffiliation(this.state.profile.department,this.state.profile.major),publish:()=>this.publish()
 });
 private chatService=new DepartmentChat();
 private chatOpened=false;
 private chatIdentity='';
 private listener:(s:Snapshot)=>void=()=>{};
 private queue=Promise.resolve();
 private owner=guestId;
 private replaying=false;
 private draftSequence=0;
 private cloudMutation(a:Action){return this.isMutation(a.type) && !a.payload?.id?.startsWith('ical-') && !(a.payload?.id && this.personal(a.payload.id)) && !(a.type==='newLecture' && !a.payload?.lecture_list_id);}
 private accountAction(type:string){return !['login','googleLogin','magicLink','authCallback','logout','refresh'].includes(type);}
 private pendingCount(){return this.operations().length+(this.owner===guestId?0:this.privateState().queue.length)+(getLocal<boolean>(`haskapp_profile_pending_${this.owner}`)?1:0);}
 private applyTaskLinks(){const links=getLocal<Record<string,string|null>>(`haskapp_task_links_${this.owner}`)??{};this.state.tasks=this.state.tasks.map(task=>{const relation=links[task.id]??task.lecture_id;const lecture=[...this.state.lectures,...this.state.officialLectures].find(l=>(l.lecture_list_id??l.id)===relation);return {...task,related_lecture_id:relation,...(lecture?{colorTheme:lecture.colorTheme}:{})};});}
 private applyExtras(){const extras=getLocal<Record<string,{belongings?:string}>>(`haskapp_lecture_extras_${this.owner}`) ?? {};this.state.lectures=this.state.lectures.map(l=>({...l,...extras[l.id]}));}
 private saveDraft(a:Action,owner:string){
  const drafts=getLocal<Draft[]>(`haskapp_drafts_${owner}`) ?? [];
  const json=JSON.stringify(a.payload);
  if(!drafts.some(d=>d.type===a.type && d.json===json))drafts.push({id:`${Date.now()}-${++this.draftSequence}`,type:a.type,title:a.payload?.lecture_name ?? a.payload?.task_name ?? a.payload?.title ?? a.payload?.recovery?.lecture_name ?? '保存待ち',json});
  setLocal(`haskapp_drafts_${owner}`,drafts);if(owner===this.owner)this.state.drafts=drafts;
 }
 private async assertOwner(owner:string){const current=await getCurrentUser();if((current?.id ?? guestId)!==owner || this.owner!==owner){await this.loadAccount();throw Error('アカウントが変更されています。データを読み直してから操作してください。');}}
 private journal(owner=this.owner):SyncJournal {
  const saved=localStorage.getItem(`haskapp_sync_journal_${owner}`);
  if(saved!==null){
   let journal:SyncJournal;
   try{journal=JSON.parse(saved)}catch{throw Error('未同期の送信履歴を読み込めません。データを削除せずバックアップを確認してください。');}
   if(journal?.version!==1 || !Array.isArray(journal.operations) || !journal.ids || typeof journal.ids!=='object' || Array.isArray(journal.ids))throw Error('未同期の送信履歴を確認できません。データは保持されています。');
   return journal;
  }
  // Read old installs without mutating their two-key journal. Once the first
  // combined record is durable it is authoritative, including an empty queue.
  return {version:1,operations:getLocal<Action[]>(`haskapp_outbox_${owner}`) ?? [],ids:getLocal<Record<string,string>>(`haskapp_outbox_ids_${owner}`) ?? {}};
 }
 private journalIntent(journal:SyncJournal){return journal.intent ? {lectures:journal.intent.lectures.map(l=>({...l,id:journal.ids[l.id] ?? l.id})),tasks:journal.intent.tasks.map(t=>({...t,id:journal.ids[t.id] ?? t.id,lecture_id:t.lecture_id ? journal.ids[t.lecture_id] ?? t.lecture_id:t.lecture_id}))}:undefined;}
 private saveJournal(journal:SyncJournal,owner=this.owner){setLocal(`haskapp_sync_journal_${owner}`,journal);}
 private operations():Action[]{return this.journal().operations;}
 private isMutation(type:string){return ['newLecture','saveLecture','saveLectureFields','deleteLecture','absence','newTask','saveTask','deleteTask','taskStatus'].includes(type);}
 subscribe(fn:(s:Snapshot)=>void){this.listener=fn}
 publish(){this.lectureDetails.reconcile();this.state.revision++;this.listener(this.state)}
 notify(message:string){this.state.message=message;this.publish()}
 foreground(active:boolean){if(active && configured)supabase.auth.startAutoRefresh();else supabase.auth.stopAutoRefresh()}
 async initialize(){this.foreground(AppState.currentState==='active');await this.loadAccount();await this.refresh();}
 async loadAccount(){const user=await getCurrentUser();const owner=user?.id || guestId;if(owner!==this.owner){this.state.lectures=[];this.state.tasks=[];this.state.events=[];this.state.searchResults=[];this.state.templates=[];this.state.gradeHistory={};this.state.gradeHistoryStatus={};this.state.templateSuggestions={};this.state.officialSelection=[];this.state.officialLectures=[];}this.owner=owner;this.state.timetableView=emptyTimetableView();try{this.state.timetableView=readTimetableView(owner);}catch{this.state.message="時間割の復元記録を読み込めません。データは削除していません。";}this.state.activities=getLocal<ClubActivity[]>(`haskapp_activities_${owner}`)??[];this.state.lectureChat={room:null,messages:[],status:'講義を選択してください',ready:false,hasMore:false,draft:'',nickname:''};this.chatOpened=false;this.chatIdentity='';this.state.chat={room:null,messages:[],status:'学科チャットは準備中です',ready:false,hasMore:false,draft:'',nickname:''};this.publish();await this.chatService.reset(owner,null);this.state.account=user?.email || (user ? 'ログイン中':'端末内のゲスト');this.state.displayName=user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? '';this.state.avatarURL=user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? '';this.state.profile={...blankProfile(),...getLocal<Profile>(`haskapp_profile_${this.owner}`)};
 this.state.officialSelection=getLocal<string[]>(`haskapp_official_selection_${owner}`) ?? [];this.state.officialLectures=officialLecturesFor(this.state.officialSelection);this.applyPrivateProfile();
 // Web's unscoped profile keys are kept in this in-memory adapter only for the current owner.
 this.state.pendingCount=this.operations().length+(getLocal<boolean>(`haskapp_profile_pending_${this.owner}`)?1:0);this.state.drafts=getLocal<Draft[]>(`haskapp_drafts_${this.owner}`) ?? [];this.applyProfileKeys();if(!user)setSupabaseOffline();}
 applyProfileKeys(){const p=this.state.profile;localStorage.setItem('haskapp_faculty_name',p.department);localStorage.setItem('haskapp_major_name',p.major);localStorage.setItem('haskapp_affiliation_id',getAffiliationId(p.department,p.major));localStorage.setItem('haskapp_share_templates',String(p.shareTemplates));}
 private status(){if(getLocal<boolean>(`haskapp_pending_local_${this.owner}`) || this.pendingCount()){this.state.connection='端末に未同期変更あり · データは保持';return;}this.state.connection=!configured ? 'クラウド未設定 · 端末内保存':this.owner===guestId ? '未ログイン · 端末内保存':getSupabaseStatus() ? 'クラウド接続設定済み':'通信未確認 · キャッシュ表示';}
 async refresh(){
 const current=await getCurrentUser();if((current?.id ?? guestId)!==this.owner)await this.loadAccount();
 const owner=this.owner;const localManual=(getLocal<LectureWithDetails[]>(`haskapp_classes_${owner}`)??[]).filter(l=>!l.lecture_list_id && !(l as any).personal_entry);if(owner!==guestId)retryConnection();
 const journal=this.journal(owner);const pending=!!getLocal<boolean>(`haskapp_pending_local_${owner}`) || journal.operations.length>0;
 const intent=this.journalIntent(journal);
 const lectures=pending ? intent?.lectures ?? getLocal<LectureWithDetails[]>(`haskapp_classes_${owner}`) ?? [] : await lecturesApi.fetchLectures();
 await this.assertOwner(owner);
 const tasks=pending ? intent?.tasks ?? getLocal<TaskWithUI[]>(`haskapp_tasks_${owner}`) ?? [] : await tasksApi.fetchTasks();
 await this.assertOwner(owner);
 const events=await eventsApi.fetchEvents(owner);await this.assertOwner(owner);
 let profile=this.state.profile;
 if(!pending && owner!==guestId && getSupabaseStatus() && !getLocal<boolean>(`haskapp_profile_pending_${owner}`)){
  const settings=await getUserSettingsFromSupabase();await this.assertOwner(owner);
  const ical=await getIcalUrlFromSupabase();await this.assertOwner(owner);
  profile={...profile,department:settings.department ?? profile.department,major:settings.major ?? profile.major,icalUrl:ical.icalUrl ?? ''};
  if(profile.icalUrl!==this.state.profile.icalUrl){localStorage.removeItem(`haskapp_ical_entries_${owner}`);localStorage.removeItem(`haskapp_completed_ical_tasks_${owner}`);}
  setLocal(`haskapp_profile_${owner}`,profile);
 }
 if(owner!==guestId){try{await this.privateSync.refresh(owner);await this.assertOwner(owner);}catch{await this.assertOwner(owner);this.state.message='個人時間割は前回のデータを表示しています。未送信変更は同期ボタンから送れます。';}}
 this.state.lectures=this.mergePersonal([...lectures.filter(l=>!localManual.some(m=>m.id===l.id)),...localManual]);this.applyExtras();this.state.tasks=tasks;this.applyTaskLinks();this.state.events=events;this.state.profile=profile;this.applyPrivateProfile();this.applyProfileKeys();if(this.chatOpened)await this.prepareChat();
 if(!pending && profile.icalUrl){try{await this.importIcal(profile,false);}catch{await this.assertOwner(owner);this.state.message='iCalを更新できませんでした。前回のデータを表示しています。';}}
 this.mergeFeed();this.state.pendingCount=this.pendingCount();this.status();await flushStorage();this.publish();
 }
 dispatch(a:Action):Promise<void>{const owner=this.owner;const action={...a,payload:a.payload && JSON.parse(JSON.stringify(a.payload))};const result=this.queue.then(()=>this.perform(action,owner));this.queue=result.then(()=>{},()=>{});return result.then(()=>{});}
 private async perform(a:Action,actionOwner=this.owner):Promise<Outcome>{let savedId:string|undefined;let ok=false;this.state.busy=true;this.state.message='';this.publish();
 try {const cloudMutation=this.cloudMutation(a);const p=a.payload;if(!a || typeof a.type!=='string' || !p || typeof p!=='object')throw Error('操作データを確認してください。');
 if(['newLecture','newTask','newEvent'].includes(a.type) && !p.id)p.id=randomUUID();
 if(this.accountAction(a.type)){const user=await getCurrentUser();if((user?.id ?? guestId)!==actionOwner || actionOwner!==this.owner){await this.loadAccount();await this.refresh();throw Error('アカウントが変更されています。データを読み直してから操作してください。');}}
 if(!this.replaying && this.cloudMutation(a) && (this.operations().length || getLocal<boolean>(`haskapp_pending_local_${this.owner}`)))setSupabaseOffline();
 switch(a.type){
 case 'syncPending':await this.syncPending();break;
 case 'refresh':await this.refresh();break;
 case 'magicLink':await requestEmailLink(p.email);this.state.message='ログイン用のリンクをメールに送りました。この端末でリンクを開いてください。';break;
 case 'authCallback':if(await acceptAuthCallback(p.url)){await this.loadAccount();await this.refresh();}break;
 case 'gradeHistory':await this.lectureDetails.history(p.id,actionOwner);break;
 case 'login':{if(!configured)throw Error('接続設定が必要です。');const {error}=await supabase.auth.signInWithPassword({email:p.email,password:p.password});if(error)throw error;await this.loadAccount();await this.refresh();break;}
 case 'googleLogin':{if(!configured)throw Error('接続設定が必要です。');const redirectTo=getAuthRedirectUri();const {data,error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo,skipBrowserRedirect:true}});if(error)throw error;if(!data.url)throw Error('ログインURLを取得できません。');const result=await WebBrowser.openAuthSessionAsync(data.url,redirectTo);if(result.type==='success'){if(!await acceptAuthCallback(result.url))throw Error('ログインの戻り先が一致しません。');await this.loadAccount();await this.refresh();}break;}
 case 'cancelLectureFields':await this.cancelLectureFields(p.draftId,actionOwner);break;
 case 'discardDraft':this.state.drafts=this.state.drafts.filter(d=>d.id!==p.id);setLocal(`haskapp_drafts_${this.owner}`,this.state.drafts);break;
 case 'logout':await signOutUser();this.state.searchResults=[];this.state.templates=[];await this.loadAccount();await this.refresh();break;
 case 'newLecture':case 'saveLecture':{this.validateLecture(p);assertNoNewConflicts([p],effectiveTimetable([...this.state.lectures,...this.state.officialLectures],this.state.timetableView),[p.id]);if(this.personal(p.id) || !p.lecture_list_id && !p.schedule_is_shared){await this.savePersonal(p,actionOwner);savedId=p.id;break;}const data={...p};if(a.type==='newLecture')delete data.id;
 // Hand-written courses without a canonical group must not be stored under the Web sentinel group.
 if(this.owner!==guestId && !data.lecture_list_id){const matches=await lecturesApi.searchPublicLectures(data.lecture_name);const exact=matches.find(m=>m.name===data.lecture_name);if(!exact)throw Error('この講義に対応する共有グループがありません。共有講義検索から登録してください。内容は保存待ちとして端末に保持します。');data.lecture_list_id=exact.id;}
 this.validateLecture(data);const saved=await lecturesApi.saveLecture(data,this.state.lectures,actionOwner,effectiveTimetable([...this.state.lectures,...this.state.officialLectures],this.state.timetableView));await this.assertOwner(actionOwner);savedId=saved.id;this.state.lectures=getLocal<LectureWithDetails[]>(`haskapp_classes_${this.owner}`) ?? (a.type==='saveLecture'?this.state.lectures.map(l=>l.id===p.id?saved:l):[...this.state.lectures,saved]);if(this.replaying && a.type==='newLecture' && p.id!==saved.id)this.state.lectures=this.state.lectures.filter(l=>l.id!==p.id);const extras=getLocal<Record<string,{belongings?:string}>>(`haskapp_lecture_extras_${this.owner}`) ?? {};extras[saved.id]={belongings:p.belongings};setLocal(`haskapp_lecture_extras_${this.owner}`,extras);this.applyExtras();setLocal(`haskapp_classes_${this.owner}`,this.state.lectures);break;}
 case 'saveLectureFields':{const current=this.state.lectures.find(lecture=>lecture.id===p.id);if(this.personal(p.id)){if(!current)throw Error('講義がありません。');await this.savePersonal({...current,...p.patch},actionOwner);break;}const original=this.replaying && p.recovery ? {...p.recovery,id:p.id} : current;if(!original)throw Error('講義が見つかりません。');
 // A queued field patch describes an earlier valid intent. Later edits/deletion
 // must not make that prefix invalid or resurrect it in the final local view.
 this.validateLecture({...original,...p.patch});const inputs=this.replaying ? this.state.lectures.map(lecture=>lecture.id===p.id || original.lecture_list_id && lecture.lecture_list_id===original.lecture_list_id ? {...lecture,...p.patch} : lecture) : this.state.lectures;if(!current)inputs.push(original);const saved=await lecturesApi.applyLectureFields(p.id,p.patch,inputs,actionOwner);await this.assertOwner(actionOwner);this.state.lectures=getLocal<LectureWithDetails[]>(`haskapp_classes_${actionOwner}`) ?? this.state.lectures.map(lecture=>lecture.id===saved.id?saved:lecture);this.applyExtras();break;}
 case 'deleteLecture':if(this.personal(p.id)){await this.privateSync.remove(actionOwner,p.id);await this.syncPrivate(actionOwner);this.state.lectures=this.mergePersonal();setLocal(`haskapp_classes_${actionOwner}`,this.state.lectures);break;}await lecturesApi.deleteLecture(p.id,this.state.lectures,actionOwner);this.state.lectures=getLocal(`haskapp_classes_${this.owner}`) ?? this.state.lectures;break;
 case 'absence':if(this.personal(p.id)){const current=this.state.lectures.find(l=>l.id===p.id);if(!current)throw Error('講義がありません。');await this.savePersonal({...current,absences:Number(p.count)},actionOwner);break;}if(!Number.isInteger(Number(p.count)) || Number(p.count)<0)throw Error('欠席回数は0以上の整数です。');await lecturesApi.updateAbsences(p.id,Number(p.count),this.state.lectures,actionOwner);this.state.lectures=getLocal(`haskapp_classes_${this.owner}`) ?? this.state.lectures;break;
 case 'newTask':case 'saveTask':{if(a.type==='newTask')p.mobile_insert_id=p.mobile_insert_id ?? p.id;if(p.id?.startsWith('ical-'))throw Error('iCal課題は配信元で編集してください。完了状態はこの端末に保存できます。');const data={...p};const relation=p.related_lecture_id;const related=[...this.state.lectures,...this.state.officialLectures,...this.state.activities.map(x=>({id:x.id,lecture_list_id:null,colorTheme:x.colorTheme}))].find(l=>(l.lecture_list_id??l.id)===relation);if(relation && (this.personal(relation)||relation.startsWith('official-')||relation.startsWith('club-')))data.lecture_id=null;if(related)data.colorTheme=related.colorTheme;delete data.related_lecture_id;if(a.type==='newTask')delete data.id;this.validateTask(data);const saved=await tasksApi.saveTask(data,this.state.tasks.filter(t=>!t.id.startsWith('ical-')),actionOwner);await this.assertOwner(actionOwner);savedId=saved.id;const links=getLocal<Record<string,string|null>>(`haskapp_task_links_${actionOwner}`)??{};if(relation!==undefined){links[saved.id]=relation;setLocal(`haskapp_task_links_${actionOwner}`,links);}saved.related_lecture_id=relation??saved.lecture_id;if(this.replaying && a.type==='newTask')this.state.tasks=this.state.tasks.filter(t=>t.id!==p.id);this.state.tasks=a.type==='saveTask' && this.state.tasks.some(t=>t.id===p.id)?this.state.tasks.map(t=>t.id===p.id?saved:t):[...this.state.tasks,saved];setLocal(`haskapp_tasks_${this.owner}`,this.state.tasks.filter(t=>!t.id.startsWith('ical-')));break;}
 case 'deleteTask':if(p.id.startsWith('ical-'))throw Error('iCalの課題は配信元で管理されます。');await tasksApi.deleteTask(p.id,this.state.tasks.filter(t=>!t.id.startsWith('ical-')),actionOwner);this.state.tasks=getLocal(`haskapp_tasks_${this.owner}`) ?? this.state.tasks;break;
 case 'taskStatus':this.validateStatus(p.status);if(p.id.startsWith('ical-')){const statuses=getLocal<Record<string,string>>(`haskapp_ical_task_status_${this.owner}`)??{};statuses[p.id]=p.status;setLocal(`haskapp_ical_task_status_${this.owner}`,statuses);const completed=getLocal<string[]>(`haskapp_completed_ical_tasks_${this.owner}`) ?? [];const next=completed.filter(id=>id!==p.id);if(p.status==='done')next.push(p.id);setLocal(`haskapp_completed_ical_tasks_${this.owner}`,next);this.mergeFeed();break;}await tasksApi.updateTaskStatus(p.id,p.status,this.state.tasks.filter(t=>!t.id.startsWith('ical-')),actionOwner);this.state.tasks=getLocal(`haskapp_tasks_${this.owner}`) ?? this.state.tasks;break;
 case 'newEvent':case 'saveEvent':{if(p.id?.startsWith('ical-'))throw Error('iCal予定は配信元で編集してください。');const data={...p};if(data.relatedLectureID){const related=[...this.state.lectures,...this.state.officialLectures,...this.state.activities.map(x=>({id:x.id,colorTheme:x.colorTheme}))].find(l=>l.id===data.relatedLectureID);if(related)data.colorTheme=related.colorTheme;}if(a.type==='newEvent')delete data.id;if(typeof data.title!=='string' || !data.title.trim())throw Error('予定名が必要です。');this.validateDate(data.date);const saved=await eventsApi.saveEvent(data,this.state.events.filter(e=>!e.id.startsWith('ical-')),actionOwner);this.state.events=a.type==='saveEvent' && this.state.events.some(e=>e.id===p.id)?this.state.events.map(e=>e.id===p.id?saved:e):[...this.state.events,saved];break;}
 case 'deleteEvent':if(p.id.startsWith('ical-'))throw Error('iCal予定は配信元で管理されます。');await eventsApi.deleteEvent(p.id,this.state.events.filter(e=>!e.id.startsWith('ical-')),actionOwner);this.state.events=this.state.events.filter(e=>e.id!==p.id);break;
 case 'search':{const query=normalizeSearch(typeof p.query==='string'?p.query:'');this.state.searchQuery=query;const key=`haskapp_catalog_search_${this.owner}_${query}`;const cached=getLocal<PublicLectureSearchResult[]>(key);this.state.searchResults=cached??[];this.state.searchStatus=cached?'保存済みの検索結果':'検索中';this.publish();try{const results=await searchCatalog(query);await this.assertOwner(actionOwner);this.state.searchResults=results;this.state.searchStatus=results.length>=100?'100件以上あります。検索語で絞り込んでください。':results.length?'共有カタログから取得':'共有カタログに結果がありません';setLocal(key,results);}catch{this.state.searchStatus=cached?'オフライン・保存済みの検索結果':'共有カタログを取得できません。公式科目は端末で検索できます。';}break;}
 case 'suggestion':await this.lectureDetails.suggestions(p.id,actionOwner,typeof p.requestId==='string'?p.requestId:undefined);break;
 case 'applySuggestion':{const patch=await this.lectureDetails.approvedPatch(p.id,p.proposalId,p.fields,actionOwner);const current=this.state.lectures.find(lecture=>lecture.id===p.id);if(!current)throw Error('講義が見つかりません。');const result=await this.perform({type:'saveLectureFields',payload:{id:p.id,patch,base:current,recovery:{...current,...patch}}},actionOwner);if(!result.ok)throw Error(this.state.message);this.lectureDetails.applied(p.id);if(!this.state.message)this.state.message='選択した項目を自分の講義に反映しました。共有テンプレートは変更していません。';break;}
 case 'importTimetable':{if(!Array.isArray(p.lectures)||p.lectures.length===0||p.lectures.length>25)throw Error('取り込む講義数を確認してください。');const rows=p.lectures.map((raw:any)=>({id:randomUUID(),lecture_name:typeof raw.lecture_name==='string'?raw.lecture_name.slice(0,120):'',instructor:typeof raw.instructor==='string'?raw.instructor.slice(0,120):'',classroom:typeof raw.classroom==='string'?raw.classroom.slice(0,120):'',sharing_group_id:typeof raw.sharing_group_id==='string'&&/^qr-[0-9a-f-]{36}$/i.test(raw.sharing_group_id)?raw.sharing_group_id:undefined,day_of_the_week:raw.day_of_the_week,period:raw.period,term:raw.term,colorTheme:'teal' as const}));for(const row of rows){this.validateLecture(row);personalEntry(row,actionOwner);}assertNoNewConflicts(rows,effectiveTimetable([...this.state.lectures,...this.state.officialLectures],this.state.timetableView));for(const row of rows){await this.assertOwner(actionOwner);await this.savePersonal(row,actionOwner);}this.state.message='確認した時間割を個人講義として追加しました。';break;}
 case 'campusOpen':{const campus=await loadCampusDirectory();await this.assertOwner(actionOwner);this.state.campus=campus;break;}
 case 'saveActivity':{if(typeof p.title!=='string'||!p.title.trim()||p.title.length>120)throw Error('サークル名は1〜120文字です。');const activity={id:typeof p.id==='string'&&/^club-[0-9a-f-]+$/i.test(p.id)?p.id:'club-'+randomUUID(),title:p.title.trim(),details:typeof p.details==='string'?p.details.slice(0,2000):'',colorTheme:['teal','blue','pink','orange','green','indigo','violet'].includes(p.colorTheme)?p.colorTheme:'teal'};this.state.activities=[...this.state.activities.filter(x=>x.id!==activity.id),activity];setLocal(`haskapp_activities_${actionOwner}`,this.state.activities);break;}
 case 'lectureChatOpen':{const lecture=this.state.lectures.find(l=>l.id===p.id);const group=lecture?.lecture_list_id;const room=group?{id:group,universityId:'',facultyId:'',departmentId:'',name:lecture.lecture_name}:null;const draft=getLocal<{body:string;nickname:string}>(`haskapp_lecture_chat_${actionOwner}_${group??p.id}`);this.state.lectureChat={room,messages:[],ready:false,hasMore:false,draft:draft?.body??'',nickname:draft?.nickname??'',status:actionOwner===guestId?'講義チャットにはログインが必要です。':!group?'共有講義への登録が必要です。科目名だけではルームを決定しません。':!lectureChatEnabled?'講義チャットはサーバーの権限設定待ちです。':'読み込み中'};if(actionOwner!==guestId && group && lectureChatEnabled){const messages=await lectureHistory(actionOwner,group);await this.assertOwner(actionOwner);if(this.state.lectureChat.room?.id===group){this.state.lectureChat.messages=messages;this.state.lectureChat.ready=true;this.state.lectureChat.status='この共有講義に登録した利用者のルームです。';}}break;}
 case 'lectureChatDraft':{const group=this.state.lectureChat.room?.id;if(!group)throw Error('共有講義を選択してください。');if(typeof p.body!=='string'||p.body.length>4000||typeof p.nickname!=='string'||p.nickname.length>64)throw Error('下書きが長すぎます。');setLocal(`haskapp_lecture_chat_${actionOwner}_${group}`,{body:p.body,nickname:p.nickname});this.state.lectureChat.draft=p.body;this.state.lectureChat.nickname=p.nickname;break;}
 case 'lectureChatHistory':{const group=this.state.lectureChat.room?.id;if(group && this.state.lectureChat.ready){const messages=await lectureHistory(actionOwner,group);await this.assertOwner(actionOwner);if(this.state.lectureChat.room?.id===group)this.state.lectureChat.messages=messages;}break;}
 case 'lectureChatSend':{const group=this.state.lectureChat.room?.id;if(!group||!this.state.lectureChat.ready||actionOwner===guestId)throw Error('現在は送信できません。');const key=`haskapp_lecture_chat_${actionOwner}_${group}`;const prior=getLocal<{id?:string;body:string;nickname:string}>(key);const id=prior?.id&&prior.body===p.body&&prior.nickname===p.nickname?prior.id:randomUUID();setLocal(key,{id,body:p.body,nickname:p.nickname});await flushStorage();await sendLectureMessage(actionOwner,group,id,p.body,p.nickname);await this.assertOwner(actionOwner);if(this.state.lectureChat.room?.id===group){const messages=await lectureHistory(actionOwner,group);await this.assertOwner(actionOwner);if(this.state.lectureChat.room?.id!==group)break;this.state.lectureChat.messages=messages;this.state.lectureChat.draft='';setLocal(`haskapp_lecture_chat_${actionOwner}_${group}`,{body:'',nickname:p.nickname});}break;}
 case 'chatOpen':this.chatOpened=true;this.state.chat.ready=false;await this.prepareChat();break;

 case 'chatHistory':await this.chatHistory(p.older===true);break;
 case 'chatDraft':{this.saveChatDraft(p.body,p.nickname);this.state.message='チャットの下書きをこの端末に保存しました。';break;}
 case 'chatSend':await this.sendChat(p);break;
 case 'replaceTimetable':{if(!Array.isArray(p.ids)||p.ids.some((id:unknown)=>typeof id!=='string'||!officialCatalog.courses.some(c=>c.id===id)))throw Error('置換する公式科目を確認してください。');const rows=officialLecturesFor([...new Set<string>(p.ids)]).filter(row=>row.term===p.term);const next=replacingTimetable(readTimetableView(actionOwner),[...this.state.lectures,...this.state.officialLectures],p.term,rows);await persistTimetableView(actionOwner,next,flushStorage,()=>this.assertOwner(actionOwner));this.state.timetableView=next;this.state.message='この端末の時間割表示を置換しました。元の授業・成績・課題は保持し、時間割から元に戻せます。';break;}
 case 'undoTimetable':{const next=undoTimetable(readTimetableView(actionOwner),[...this.state.lectures,...this.state.officialLectures]);await persistTimetableView(actionOwner,next,flushStorage,()=>this.assertOwner(actionOwner));this.state.timetableView=next;this.state.message='直前の時間割表示に戻しました。授業・成績・課題の原本は保持しています。';break;}
 case 'officialSelection':{if(!Array.isArray(p.ids) || p.ids.some((id:unknown)=>typeof id!=='string' || !officialCatalog.courses.some(c=>c.id===id)))throw Error('公式科目の選択を確認してください。');const nextIds=[...new Set<string>(p.ids)];const nextRows=officialLecturesFor(nextIds);assertNoNewConflicts(nextRows,effectiveTimetable([...this.state.lectures,...this.state.officialLectures],this.state.timetableView),this.state.officialLectures.filter(row=>!nextRows.some(next=>next.id===row.id)).map(row=>row.id));this.state.officialSelection=nextIds;setLocal(`haskapp_official_selection_${actionOwner}`,this.state.officialSelection);this.state.officialLectures=officialLecturesFor(this.state.officialSelection);await this.privateSync.profile(actionOwner,{student_year:this.state.profile.studentYear||null,class_group:this.state.profile.studentYear===2?this.state.profile.classGroup||null:null,official_course_ids:this.state.officialSelection});await this.syncPrivate(actionOwner);if(!this.state.message)this.state.message=actionOwner===guestId?'公式時間割の選択をこの端末に保存しました。':'公式時間割の選択を本人専用の保存先に同期しました。';break;}
 case 'migratePersonal':{const originals=this.state.lectures.filter(l=>!l.lecture_list_id && !(l as any).personal_entry);for(const original of originals){await this.assertOwner(actionOwner);await this.savePersonal(original,actionOwner);}break;}
 case 'profile':await this.saveProfile(p);break;
 case 'templates':{if(!p.department.trim() || !p.major.trim())throw Error('学部と学科・コースを入力してください。');this.state.profile=p;this.applyProfileKeys();const result=await fetchTemplatesForDepartment(p.department,p.major,actionOwner);this.state.templates=result.templates.flatMap(t=>t.slots.map((slot,i)=>({id:`${t.id}_${i}`,lecture_list_id:t.group_id,lecture_name:t.lecture_name,instructor:t.instructor,classroom:t.classroom ?? '',lecture_details:t.details ?? '',day_of_the_week:slot.day_of_the_week,period:Math.min(5,slot.period) as 1|2|3|4|5,term:slot.term,schedule_is_shared:true,colorTheme:'teal' as const,syllabus_id:t.syllabus_id,template_creator_id:t.creator_id,template_rating:t.rate,grading_criteria:t.grading_criteria ?? '',grading_report:t.report_rate ?? undefined,grading_test:t.exam_rate ?? undefined,grading_quiz:t.mini_exam_rate ?? undefined,grading_attendance_total:t.lecture_count ?? undefined,grading_attendance_required:t.attendance_count_needed ?? undefined})));break;}
 case 'setup':{await lecturesApi.markSetupStarted(undefined,actionOwner);const creators=new Set<string>();for(const id of p as string[]){const t=this.state.templates.find(t=>t.id===id);if(!t)continue;if(this.state.lectures.some(l=>l.lecture_list_id===t.lecture_list_id && l.day_of_the_week===t.day_of_the_week && l.period===t.period && l.term===t.term))continue;const {id:_,...data}=t;const result=await this.perform({type:'newLecture',payload:data},actionOwner);if(!result.ok)throw Error(this.state.message);await this.assertOwner(actionOwner);const creator=(t as any).template_creator_id;if(creator)creators.add(creator);}if(getSupabaseStatus())for(const creator of creators)await updateTemplateRates(this.state.profile.department,this.state.profile.major,creator,actionOwner);await lecturesApi.markSetupDone(undefined,actionOwner);break;}
 case 'importIcal':await this.importIcal(p);break;
 default:throw Error('未対応の操作です。');
 }
 if(this.accountAction(a.type))await this.assertOwner(actionOwner);
 if(['newLecture','saveLecture','newTask','saveTask','newEvent','saveEvent'].includes(a.type)){this.state.drafts=this.state.drafts.filter(d=>{try{const original=JSON.parse(d.json);return !(d.type===a.type && (a.payload.id ? original.id===a.payload.id : d.json===JSON.stringify(a.payload)))}catch{return true}});setLocal(`haskapp_drafts_${this.owner}`,this.state.drafts);}
 if(!this.replaying && this.owner!==guestId && !getSupabaseStatus() && cloudMutation){const journal=this.journal();const operations=journal.operations;const payload={...a.payload};if(savedId && ['newTask','newLecture'].includes(a.type))payload.id=savedId;operations.push({type:a.type,payload});journal.intent={lectures:this.state.lectures,tasks:this.state.tasks.filter(t=>!t.id.startsWith('ical-'))};this.saveJournal(journal);this.state.pendingCount=this.pendingCount();setLocal(`haskapp_pending_local_${this.owner}`,true);this.state.message='端末内に保存しました。クラウドへの反映は未完了です。';}this.state.lectures=this.mergePersonal();this.state.pendingCount=this.pendingCount();this.mergeFeed();this.status();ok=true;
 }catch(e){
 // A guard can reject inside the API before our post-call check runs. Clear
 // the previous account's visible state immediately, without moving its draft.
 try{const current=await getCurrentUser();if((current?.id ?? guestId)!==this.owner)await this.loadAccount();}catch{}
 // Rejected edits belong to the account that produced the action, even after a session switch.
 if(a.payload && ['newLecture','saveLecture','newTask','saveTask','newEvent','saveEvent'].includes(a.type))this.saveDraft(a,actionOwner);
 if(a.type==='saveLectureFields' && a.payload?.recovery)this.saveDraft(a,actionOwner);
 if(a.type==='suggestion' && typeof a.payload?.requestId==='string')this.lectureDetails.suggestionFailed(a.payload.id,actionOwner,a.payload.requestId);
 this.state.message=e instanceof Error?e.message:'操作に失敗しました。変更内容は保持されています。';
 }finally{try{await flushStorage();}catch{ok=false;this.state.message='端末への保存に失敗しました。アプリを閉じずに空き容量を確認して再試行してください。';}this.state.busy=false;this.publish();}
 return {ok,savedId};}
 private async cancelLectureFields(draftId:string,owner:string){
  await this.assertOwner(owner);
  const draft=this.state.drafts.find(value=>value.id===draftId && value.type==='saveLectureFields');
  if(!draft)throw Error('保存待ちの提案が見つかりません。');
  const journal=this.journal(owner);
  const mapped=(payload:any)=>({...payload,id:journal.ids[payload.id] ?? payload.id});
  const index=journal.operations.findIndex(operation=>operation.type==='saveLectureFields' && JSON.stringify(mapped(operation.payload))===draft.json);
  if(index<0){this.state.message='この提案は未同期の送信履歴にありません。元の提案は保存待ちの編集に保持しています。';return;}
  const operation=mapped(journal.operations[index].payload),patch=operation.patch;
  if(!patch || typeof patch!=='object' || Array.isArray(patch))throw Error('提案の送信履歴を確認できません。バックアップを保持してください。');
  const group=operation.recovery?.lecture_list_id;
  const sameLecture=(value:any)=>value.id===operation.id || value.id?.split('_')[0]===operation.id?.split('_')[0] || !!group && (value.lecture_list_id ?? value.recovery?.lecture_list_id)===group;
  const later=journal.operations.slice(index+1).filter(value=>sameLecture(mapped(value.payload)));
  const broadLater=later.some(value=>['newLecture','saveLecture','deleteLecture'].includes(value.type));
  const protectedFields=new Set(later.filter(value=>value.type==='saveLectureFields').flatMap(value=>Object.keys(value.payload.patch ?? {})));
  if(protectedFields.has('grading_criteria') || protectedFields.has('grading_memo')){protectedFields.add('grading_criteria');protectedFields.add('grading_memo');}
  const lectures=this.state.lectures.map(lecture=>{
   if(!sameLecture(lecture) || broadLater)return lecture;
   const result={...lecture};
   for(const key of Object.keys(patch))if(!protectedFields.has(key) && (lecture as any)[key]===patch[key]){
    // Selected fields were blank before approval. New entries retain their exact
    // pre-apply values; older journal entries safely revert only to unknown.
    (result as any)[key]=operation.base?.[key];
   }
   return result;
  });
  journal.operations.splice(index,1);journal.intent={lectures,tasks:this.state.tasks.filter(task=>!task.id.startsWith('ical-'))};
  this.saveJournal(journal,owner);setLocal(`haskapp_classes_${owner}`,lectures);
  if(journal.operations.length)setLocal(`haskapp_pending_local_${owner}`,true);else localStorage.removeItem(`haskapp_pending_local_${owner}`);
  await flushStorage();await this.assertOwner(owner);
  this.state.lectures=lectures;this.state.pendingCount=this.pendingCount();
  this.state.message='この提案だけを未同期の送信履歴から取り消しました。後の編集と元の提案は保持しています。既にサーバーに保存された内容は元に戻しません。同期・再読み込みで現在のサーバー情報を確認してください。';
 }
 async syncPending(){
 if(this.owner===guestId)throw Error('ログインが必要です。');
 if(getLocal<boolean>(`haskapp_pending_local_${this.owner}`) && !localStorage.getItem(`haskapp_sync_journal_${this.owner}`) && !this.operations().length && !getLocal<boolean>(`haskapp_profile_pending_${this.owner}`))throw Error('未同期データの送信履歴を確認できません。バックアップを保存し、内容を確認してください。端末データは保持されています。');
 const {data:{user},error}=await supabase.auth.getUser();if(error || user?.id!==this.owner)throw Error('同じアカウントで再ログインしてください。');
 // Do not begin remote writes until the current local journal is durable.
 await flushStorage();
 retryConnection();if(this.privateState().queue.length)await this.privateSync.sync(this.owner);await this.assertOwner(this.owner);this.applyPrivateProfile();this.state.lectures=this.mergePersonal();const profileWarning=getLocal<boolean>(`haskapp_profile_pending_${this.owner}`)?await this.saveProfile(this.state.profile,true):undefined;
 const replayOwner=this.owner;const journal=this.journal(replayOwner);const operations=journal.operations;const hadOperations=operations.length>0;const mapping=journal.ids;
 const intended={lectures:this.state.lectures.map(l=>({...l})),tasks:this.state.tasks.map(t=>({...t})),events:this.state.events.map(e=>({...e}))};
 // Persist the final local view before replay can replace caches with an older
 // prefix. Queue, ID mapping, and final intent advance in one durable record.
 journal.intent={lectures:intended.lectures,tasks:intended.tasks.filter(t=>!t.id.startsWith('ical-'))};
 this.saveJournal(journal,replayOwner);await flushStorage();await this.assertOwner(replayOwner);
 this.replaying=true;
 try{while(operations.length){const original=operations[0];const payload={...original.payload};if(mapping[payload.id])payload.id=mapping[payload.id];if(mapping[payload.lecture_id])payload.lecture_id=mapping[payload.lecture_id];
 const result=await this.perform({type:original.type,payload},replayOwner);if(!result.ok || !getSupabaseStatus())throw Error(this.state.message || '同期できませんでした。未同期データは保持されています。');
 if(result.savedId && ['newTask','newLecture'].includes(original.type))mapping[original.payload.id]=result.savedId;
 operations.shift();this.saveJournal(journal,replayOwner);this.state.pendingCount=this.pendingCount();await flushStorage();}
 localStorage.removeItem(`haskapp_pending_local_${this.owner}`);await this.refresh();this.state.message=profileWarning ? `${hadOperations?'未同期の課題・講義を送信しました。':''}${profileWarning}`:'未同期変更を送信しました。';
 }catch(error){
 // Replay can stop after any prefix. Keep the user's final local edits visible,
 // rather than the older versions that happened to be sent before the failure.
 const lectures=intended.lectures.map(l=>({...l,id:mapping[l.id] ?? l.id}));
 const tasks=intended.tasks.map(t=>({...t,id:mapping[t.id] ?? t.id,lecture_id:t.lecture_id ? mapping[t.lecture_id] ?? t.lecture_id:t.lecture_id}));
 setLocal(`haskapp_classes_${replayOwner}`,lectures);
 setLocal(`haskapp_tasks_${replayOwner}`,tasks.filter(t=>!t.id.startsWith('ical-')));
 if(operations.length)setLocal(`haskapp_pending_local_${replayOwner}`,true);else localStorage.removeItem(`haskapp_pending_local_${replayOwner}`);
 if(this.owner===replayOwner){this.state.lectures=lectures;this.state.tasks=tasks;this.state.events=intended.events;this.status();}throw error;
 }finally{this.replaying=false;}
 }
 validateStatus(status:string){if(!['todo','inProgress','done'].includes(status))throw Error('課題の進捗が正しくありません。');}
 validateDate(value:unknown){if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value+'T00:00:00Z')) || new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('日付を確認してください。');}
 validateTask(data:any){if(data.lecture_id && this.personal(data.lecture_id))throw Error('個人講義には課題を関連付けられません。講義を未指定にして保存してください。');if(typeof data.task_name!=='string' || !data.task_name.trim())throw Error('課題名が必要です。');this.validateStatus(data.status);if(data.deadline!=='')this.validateDate(data.deadline);for(const key of ['assigned_date','scheduled_date'])if(data[key])this.validateDate(data[key]);}
 validateLecture(l:LectureWithDetails){if(typeof l.lecture_name!=='string' || !l.lecture_name.trim())throw Error('講義名が必要です。');for(const k of ['grading_report','grading_test','grading_quiz'] as const){const n=l[k];if(n!=null && (!Number.isInteger(n) || n<0 || n>100))throw Error('評価割合は0〜100の整数です。');}if([l.grading_report,l.grading_test,l.grading_quiz].reduce<number>((sum,n)=>sum+(n ?? 0),0)>100)throw Error('評価割合の合計は100%以下にしてください。');if(!Number.isInteger(l.day_of_the_week) || l.day_of_the_week<0 || l.day_of_the_week>6 || !Number.isInteger(l.period) || l.period<1 || l.period>5)throw Error('曜日と時限を確認してください。');for(const key of ['absences','grading_attendance_required','grading_attendance_total'] as const){const n=l[key];if(n!=null && (!Number.isInteger(n) || n<0))throw Error('出欠回数は0以上の整数です。');}if(l.grading_attendance_required!=null && l.grading_attendance_total!=null && l.grading_attendance_required>l.grading_attendance_total)throw Error('必要出席回数が講義回数を超えています。');}
 private chatDraftKey(){return `haskapp_chat_draft_${this.owner}_${this.state.chat.room?.id ?? 'unset'}`;}
 private saveChatDraft(body:string,nickname:string){if(typeof body!=='string' || [...body].length>2000 || typeof nickname!=='string' || [...nickname].length>32)throw Error('下書きは2000文字、表示名は32文字以内です。');const existing=getLocal<{body:string;nickname:string;id:string}>(this.chatDraftKey());const id=existing?.body===body && existing?.nickname===nickname ? existing.id:randomUUID();setLocal(this.chatDraftKey(),{body,nickname,id});this.state.chat={...this.state.chat,draft:body,nickname};return id;}
 private async prepareChat(){
 const owner=this.owner,room=departmentRoom(this.state.profile),identity=`${owner}|${room?.id ?? ''}`;
 if(identity===this.chatIdentity && this.state.chat.ready)return;
 if(identity!==this.chatIdentity){this.chatIdentity=identity;this.state.chat={room,messages:[],status:'学科チャットは準備中です',ready:false,hasMore:false,draft:'',nickname:''};this.publish();await this.chatService.reset(owner,room);const draft=getLocal<{body:string;nickname:string}>(this.chatDraftKey());if(draft){this.state.chat.draft=draft.body;this.state.chat.nickname=draft.nickname;}}
 if(owner===guestId){this.state.chat.status='学科チャットにはログインが必要です。';return;}
 if(!room){this.state.chat.status='設定から正式な学部・学科・コースを保存してください。';return;}
 if(!departmentChatEnabled){this.state.chat.status='サーバーの権限設定を準備中です。下書きは端末に保存できます。';return;}
 if(!configured){this.state.chat.status='接続設定が必要です。';return;}
 await this.chatService.reset(owner,room);
 if(!await this.chatService.join(owner,room))return;await this.assertOwner(owner);if(this.chatIdentity!==identity)return;
 this.state.chat.ready=true;
 this.chatService.subscribe(owner,room,m=>{if(this.owner!==owner || this.chatIdentity!==identity)return;this.state.chat.messages=mergeChat(this.state.chat.messages,[m]);this.publish();},status=>{if(this.owner===owner && this.chatIdentity===identity){this.state.chat.status=status;this.publish();}});
 try{await this.chatHistory(false);}catch(error){this.state.chat.ready=false;this.state.chat.status='履歴を読み込めません。再接続してください。';throw error;}
 }
 private async chatHistory(older:boolean){const owner=this.owner,room=this.state.chat.room;if(!this.state.chat.ready || !room || owner===guestId)return;const identity=this.chatIdentity;const result=await this.chatService.history(owner,room,older?this.state.chat.messages[0]:undefined);await this.assertOwner(owner);if(!result || this.chatIdentity!==identity)return;this.state.chat.messages=mergeChat(this.state.chat.messages,result.messages);this.state.chat.hasMore=result.hasMore;}
 private async sendChat(p:{body:string;nickname:string}){const owner=this.owner,room=this.state.chat.room;const id=this.saveChatDraft(p.body,p.nickname);validateChat(p.body,p.nickname);await flushStorage();await this.assertOwner(owner);if(!departmentChatEnabled || !this.state.chat.ready || !room || owner===guestId)throw Error('現在は送信できません。下書きを端末に保持しました。');const identity=this.chatIdentity,result=await this.chatService.send(owner,room,id,p.body,p.nickname);await this.assertOwner(owner);if(!result || this.chatIdentity!==identity)return;this.state.chat.messages=mergeChat(this.state.chat.messages,[result]);this.state.chat.draft='';setLocal(this.chatDraftKey(),{body:'',nickname:p.nickname,id:randomUUID()});}
 async saveProfile(p:Profile,allowPartial=false):Promise<string|undefined>{
 const owner=this.owner;await this.assertOwner(owner);
 if(typeof p.department!=='string' || typeof p.major!=='string' || typeof p.icalUrl!=='string' || typeof p.shareTemplates!=='boolean')throw Error('設定内容を確認してください。');
 validateStudyProfile(p);if(p.studentYear!==2)p={...p,classGroup:''};
 if(p.icalUrl){const url=new URL(p.icalUrl.replace(/^webcal:/,'https:'));if(url.protocol!=='https:' || url.username || url.password)throw Error('HTTPSのiCal URLを使用してください。');}
 if(this.state.profile.icalUrl!==p.icalUrl){localStorage.removeItem(`haskapp_ical_entries_${owner}`);localStorage.removeItem(`haskapp_completed_ical_tasks_${owner}`);}
 this.state.profile={...blankProfile(),...p};setLocal(`haskapp_profile_${owner}`,p);this.applyProfileKeys();if(this.chatOpened){try{await this.prepareChat();}catch{await this.assertOwner(owner);this.state.chat.ready=false;this.state.chat.status='学科チャットの接続を確認できません。下書きは端末に保持しています。';}}
 await this.privateSync.profile(owner,{student_year:p.studentYear||null,class_group:p.studentYear===2?p.classGroup||null:null,official_course_ids:this.state.officialSelection});await this.syncPrivate(owner);
 if(owner===guestId)return;
 setLocal(`haskapp_profile_pending_${owner}`,true);this.state.pendingCount=this.operations().length+1;
 if(!getSupabaseStatus())return;
 const failed:string[]=[];let icalSaved=false;
 const recordFailure=async(error:unknown,label:string)=>{
  if(error instanceof Error && error.name==='AccountOwnerChangedError')throw error;
  await this.assertOwner(owner);failed.push(label);
 };
 try{const departmentId=await saveDepartmentAndMajorToSupabase(p.department,p.major,owner);await this.assertOwner(owner);if(p.department && p.major && !departmentId)failed.push('所属');}
 catch(error){await recordFailure(error,'所属');}
 // Public affiliation metadata can be read-only. Its failure must not prevent
 // the independent owner-scoped iCal setting from being saved.
 await this.assertOwner(owner);
 try{await saveIcalUrlToSupabase(p.icalUrl,owner);await this.assertOwner(owner);icalSaved=true;}
 catch(error){await recordFailure(error,'iCal設定');}
 await this.assertOwner(owner);
 if(p.shareTemplates){try{await syncCurrentUserLectureTemplates(owner);await this.assertOwner(owner);}catch(error){await recordFailure(error,'共有テンプレート');}}
 if(failed.length){const warning=`${icalSaved?'iCal設定は保存しました。':''}${failed.join('・')}はクラウドに保存できませんでした。端末の設定と未同期状態は保持されています。`;if(allowPartial)return warning;throw Error(warning);}
 localStorage.removeItem(`haskapp_profile_pending_${owner}`);this.state.pendingCount=this.operations().length;
 }
 mergeFeed(){
 const cached=getLocal<ReturnType<typeof parseIcalEntries>>(`haskapp_ical_entries_${this.owner}`) ?? [];
 const entries=[...new Map(cached.map(entry=>[`${entry.uid ?? entry.summary}-${entry.date}`,entry])).values()];
 const completed=getLocal<string[]>(`haskapp_completed_ical_tasks_${this.owner}`) ?? [];
 const statuses=getLocal<Record<string,string>>(`haskapp_ical_task_status_${this.owner}`)??{};
 const tasks:TaskWithUI[]=entries.map(entry=>{const id=`ical-${entry.uid ?? entry.summary}-${entry.date}`;const syllabus=entry.categories.find(c=>/^p\d{2}/.test(c))?.slice(3);const lecture=this.state.lectures.find(l=>l.syllabus_id===syllabus && !!syllabus);const localStatus=statuses[id];const status=localStatus==='todo'||localStatus==='inProgress'||localStatus==='done'?localStatus:completed.includes(id)?'done':'todo';const done=status==='done';return {id,created_at:'',user_id:'external',task_name:entry.summary,deadline:entry.date,task_details:'iCal配信元の課題',progress_percent:done?100:status==='inProgress'?50:0,status,colorTheme:lecture?.colorTheme ?? 'indigo',lecture_id:lecture?.lecture_list_id ?? null,syllabus_id:syllabus ?? null}});
 this.state.tasks=[...this.state.tasks.filter(t=>!t.id.startsWith('ical-')),...tasks];
 this.state.events=this.state.events.filter(e=>!e.id.startsWith('ical-')); // iCal is an assignment feed, never personal calendar events.
 }
 async importIcal(p:Profile,persistSettings=true){const owner=this.owner;const url=new URL(p.icalUrl.replace(/^webcal:/,'https:'));if(url.protocol!=='https:' || url.username || url.password)throw Error('HTTPSのiCal URLを使用してください。');const profileWarning=persistSettings?await this.saveProfile(p,true):undefined;const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);try{const response=await fetch(url.toString(),{signal:controller.signal});if(!response.ok)throw Error('iCalを取得できません。');const text=await response.text();if(text.length>5_000_000)throw Error('iCalが大きすぎます。');const entries=parseIcalEntries(text);await this.assertOwner(owner);setLocal(`haskapp_ical_entries_${this.owner}`,entries);this.mergeFeed();this.state.message=`${entries.length}件のiCal課題を取り込みました。配信元の内容は変更していません。${profileWarning ?? ''}`;}finally{clearTimeout(timeout)}}

}
export const engine=new PlannerEngine();

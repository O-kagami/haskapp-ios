import {faculties} from '../web-contract/lib/setup-templates';
import {supabase} from '../web-contract/lib/supabase';
export const CHAT_LIMIT=2000;
export const departmentChatEnabled=process.env.EXPO_PUBLIC_ENABLE_DEPARTMENT_CHAT!=='false';
export type ChatRoom={id:string;universityId:string;facultyId:string;departmentId:string;name:string};
export type ChatMessage={id:string;roomId:string;nickname:string;body:string;createdAt:string;own:boolean};
export type ChatSnapshot={room:ChatRoom|null;messages:ChatMessage[];status:string;ready:boolean;hasMore:boolean;draft:string;nickname:string};
export function departmentRoom(profile:{department:string;major:string}):ChatRoom|null{
 for(const f of faculties){if(f.name!==profile.department && f.id!==profile.department)continue;for(const d of f.departments){if(profile.major===d.name || d.courses.some(c=>profile.major===`${d.name} ${c.name}` || profile.major===c.name))return {id:`hokudai:${f.id}:${d.id}`,universityId:'hokudai',facultyId:f.id,departmentId:d.id,name:`${f.name} ${d.name}`};}}
 return null;
}
export function validateChat(body:string,nickname:string){
 if(typeof body!=='string' || !body.trim())throw Error('メッセージを入力してください。');
 if([...body].length>CHAT_LIMIT)throw Error(`メッセージは${CHAT_LIMIT}文字以内です。`);
 if(typeof nickname!=='string' || !nickname.trim() || [...nickname].length>32)throw Error('表示名は1〜32文字です。');
 return {body:body.trim(),nickname:nickname.trim()};
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function message(row:any,owner:string):ChatMessage{
 if(!uuid.test(row.id) || typeof row.room_id!=='string' || typeof row.body!=='string' || typeof row.nickname!=='string' || !Number.isFinite(Date.parse(row.created_at)))throw Error('チャットの応答を確認できません。');
 return {id:row.id,roomId:row.room_id,nickname:row.nickname,body:row.body,createdAt:row.created_at,own:row.sender_id===owner};
}
// One active account/department only. Every async result is checked against its
// captured generation; logout and affiliation changes discard late responses.
export class DepartmentChat {
 private generation=0;
 private owner='';
 private room:ChatRoom|null=null;
 private channel:ReturnType<typeof supabase.channel>|null=null;
 constructor(private client:typeof supabase=supabase){}
 async reset(owner:string,room:ChatRoom|null){this.generation++;this.owner=owner;this.room=room;const old=this.channel;this.channel=null;if(old)await this.client.removeChannel(old);}
 private valid(generation:number,owner:string,roomId:string){return generation===this.generation && this.owner===owner && this.room?.id===roomId;}
 async join(owner:string,room:ChatRoom):Promise<boolean>{
 const generation=this.generation;if(!this.valid(generation,owner,room.id))return false;
 const found=await this.client.from('department_chat_memberships').select('room_id').eq('owner_id',owner).maybeSingle();
 if(!this.valid(generation,owner,room.id))return false;if(found.error)throw Error('学科ルームの所属を確認できません。');
 if(found.data?.room_id===room.id)return true;
 // An UPSERT would also try to UPDATE owner_id. Only room_id has UPDATE
 // permission, so change that column explicitly and keep ownership immutable.
 let result=found.data ? await this.client.from('department_chat_memberships').update({room_id:room.id}).eq('owner_id',owner) : await this.client.from('department_chat_memberships').insert({owner_id:owner,room_id:room.id});
 if(!this.valid(generation,owner,room.id))return false;
 if(result.error?.code==='23505'){result=await this.client.from('department_chat_memberships').update({room_id:room.id}).eq('owner_id',owner);if(!this.valid(generation,owner,room.id))return false;}
 if(result.error)throw Error('学科ルームに参加できません。通信・サーバー設定を確認してください。');return true;
 }
 async history(owner:string,room:ChatRoom,cursor?:ChatMessage):Promise<{messages:ChatMessage[];hasMore:boolean}|null>{
 const generation=this.generation;if(!this.valid(generation,owner,room.id))return null;
 let query=this.client.from('department_chat_messages').select('id,room_id,sender_id,nickname,body,created_at').eq('room_id',room.id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50);
 if(cursor){if(!uuid.test(cursor.id) || !/^\d{4}-\d\d-\d\dT[0-9:.]+(?:Z|[+-]\d\d:\d\d)$/.test(cursor.createdAt) || cursor.roomId!==room.id)throw Error('履歴の読み込み位置を確認してください。');query=query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);}
 const {data,error}=await query;if(!this.valid(generation,owner,room.id))return null;if(error)throw Error('学科チャットに接続できません。所属設定・通信・サーバー設定を確認してください。');
 return {messages:(data ?? []).map(row=>message(row,owner)).reverse(),hasMore:(data?.length ?? 0)===50};
 }
 async send(owner:string,room:ChatRoom,id:string,body:string,nickname:string):Promise<ChatMessage|null>{
 const generation=this.generation;if(!this.valid(generation,owner,room.id))return null;if(!uuid.test(id))throw Error('送信IDを確認してください。');const text=validateChat(body,nickname);
 const {data,error}=await this.client.from('department_chat_messages').insert({id,room_id:room.id,sender_id:owner,...text}).select('id,room_id,sender_id,nickname,body,created_at').single();
 if(!this.valid(generation,owner,room.id))return null;
 if(error?.code==='23505'){
  const result=await this.client.from('department_chat_messages').select('id,room_id,sender_id,nickname,body,created_at').eq('id',id).eq('sender_id',owner).eq('room_id',room.id).single();
  if(!this.valid(generation,owner,room.id))return null;
  if(result.error || result.data?.body!==text.body || result.data?.nickname!==text.nickname)throw Error('送信履歴が一致しません。内容を端末に保持しました。');return message(result.data,owner);
 }
 if(error)throw Error('送信できませんでした。内容を保持しています。同じ送信IDで再試行できます。');return message(data,owner);
 }
 subscribe(owner:string,room:ChatRoom,onMessage:(m:ChatMessage)=>void,onStatus:(s:string)=>void){
 const generation=this.generation;if(!this.valid(generation,owner,room.id))return;
 this.channel=this.client.channel(`department-chat:${generation}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'department_chat_messages',filter:`room_id=eq.${room.id}`},payload=>{
 if(!this.valid(generation,owner,room.id) || payload.new.room_id!==room.id)return;try{onMessage(message(payload.new,owner));}catch{onStatus('受信内容を確認できません。履歴を再読み込みしてください。');}
 }).subscribe(status=>{if(this.valid(generation,owner,room.id))onStatus(status==='SUBSCRIBED'?'接続中':status==='CHANNEL_ERROR' || status==='TIMED_OUT'?'再接続が必要です':'接続を確認中');});
 }
}
function chatInstant(raw:string){const fraction=raw.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? '';return BigInt(Math.floor(Date.parse(raw)/1000))*1000000n+BigInt(fraction.slice(0,6).padEnd(6,'0'));}
export function mergeChat(messages:ChatMessage[],incoming:ChatMessage[]){return [...new Map([...messages,...incoming].map(m=>[m.id,m])).values()].sort((a,b)=>(chatInstant(a.createdAt)<chatInstant(b.createdAt)?-1:chatInstant(a.createdAt)>chatInstant(b.createdAt)?1:0)||a.id.localeCompare(b.id));}

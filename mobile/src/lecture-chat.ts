import {supabase,configured} from '../web-contract/lib/supabase';
import {validateChat,type ChatMessage} from './department-chat';
export const lectureChatEnabled=process.env.EXPO_PUBLIC_ENABLE_LECTURE_CHAT==='true';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function lectureHistory(owner:string,group:string):Promise<ChatMessage[]>{
 if(!lectureChatEnabled||!configured||!uuid.test(owner)||!uuid.test(group))throw Error('講義チャットはログインとサーバー側の登録・権限設定が必要です。');
 const {data,error}=await supabase.from('lecture_chat_messages').select('id,group_id,sender_id,nickname,body,created_at').eq('group_id',group).order('created_at',{ascending:false}).limit(50);
 if(error)throw Error('講義チャットを取得できません。登録と権限設定を確認してください。');
 return (data??[]).reverse().filter((r:any)=>r.group_id===group&&uuid.test(r.id)&&typeof r.body==='string'&&typeof r.nickname==='string').map((r:any)=>({id:r.id,roomId:r.group_id,nickname:r.nickname,body:r.body,createdAt:r.created_at,own:r.sender_id===owner}));
}
export async function sendLectureMessage(owner:string,group:string,id:string,body:string,nickname:string){
 if(!lectureChatEnabled||!configured||!uuid.test(owner)||!uuid.test(group)||!uuid.test(id))throw Error('現在は送信できません。下書きは保持しています。');
 const clean=validateChat(body,nickname);const {error}=await supabase.from('lecture_chat_messages').insert({id,group_id:group,sender_id:owner,...clean});
 if(error){if(error.code==='23505'){const found=await supabase.from('lecture_chat_messages').select('id,body,nickname').eq('id',id).eq('group_id',group).eq('sender_id',owner).maybeSingle();if(!found.error&&found.data?.body===clean.body&&found.data?.nickname===clean.nickname)return;}throw Error('送信できません。下書きは端末に保持しています。');}
}

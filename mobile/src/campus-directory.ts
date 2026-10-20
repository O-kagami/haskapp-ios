import {safeLearningURL} from './planner-rules';
import {supabase,configured} from '../web-contract/lib/supabase';
export type CampusEntry={id:string;category:'club'|'promotion';title:string;body:string;url:string;sponsor:string};
export type CampusDirectory={entries:CampusEntry[];status:string};
export async function loadCampusDirectory():Promise<CampusDirectory>{
 if(!configured || process.env.EXPO_PUBLIC_ENABLE_CAMPUS_DIRECTORY!=='true')return {entries:[],status:'公開情報は掲載準備中です。自分のサークルは端末内に登録できます。'};
 const {data,error}=await supabase.from('campus_directory').select('id,category,title,body,url,sponsor').eq('published',true).limit(100);
 if(error)return {entries:[],status:'掲載情報を取得できません。接続先の掲載設定を確認してください。'};
 const entries=(data??[]).filter((r:any)=>['club','promotion'].includes(r.category)&&typeof r.title==='string'&&typeof r.body==='string'&&typeof r.url==='string'&&safeLearningURL(r.url)!==undefined).map((r:any)=>({id:r.id,category:r.category,title:r.title,body:r.body,url:r.url,sponsor:r.sponsor??''}));
 return {entries,status:entries.length?'掲載元が公開した情報です。':'公開されている掲載情報はありません。'};
}

import {supabase,configured} from '../web-contract/lib/supabase';
import type {PublicLectureSearchResult} from '../web-contract/lib/types';
export function normalizeSearch(text:string){return text.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();}
export function searchPattern(text:string){return `%${normalizeSearch(text).replace(/[\\%_]/g,'\\$&').split(/\s+/).join('%')}%`;}
const fields='id,name,public_lecture_data(id,name,teacher,syllabus_id,classroom,details),schedules(day_of_week,start_time,end_time,period_start_daytime)';
export async function searchCatalog(query:string):Promise<PublicLectureSearchResult[]>{
 if(!configured)throw Error('共有カタログの接続設定がありません。公式科目は端末で検索できます。');
 const pattern=searchPattern(query), rows=new Map<string,PublicLectureSearchResult>();
 // Group labels and official subject labels can differ. Resolve subject hits to
 // their actual group IDs; never guess an association from a matching title.
 const [groups,subjects,teachers]=await Promise.all([
  supabase.from('groups').select(fields).ilike('name',pattern).order('name').limit(100),
  supabase.from('public_lecture_data').select('group_id').ilike('name',pattern).limit(100),
  supabase.from('public_lecture_data').select('group_id').ilike('teacher',pattern).limit(100),
 ]);
 if(groups.error || subjects.error || teachers.error)throw Error('共有カタログを取得できません。通信を確認して再検索してください。');
 for(const row of groups.data??[])rows.set(row.id,row as PublicLectureSearchResult);
 const ids=[...new Set([...(subjects.data??[]),...(teachers.data??[])].map(row=>row.group_id).filter((id):id is string=>typeof id==='string'&&!rows.has(id)))];
 if(ids.length){const extra=await supabase.from('groups').select(fields).in('id',ids).limit(100);if(extra.error)throw Error('共有カタログを取得できません。通信を確認して再検索してください。');for(const row of extra.data??[])rows.set(row.id,row as PublicLectureSearchResult);}
 return [...rows.values()].map(row=>({...row,schedules:(row.schedules??[]).filter(s=>Number.isInteger(s.day_of_week)&&s.day_of_week!==null&&s.day_of_week>=1&&s.day_of_week<=5&&typeof s.start_time==='string'&&s.start_time.trim().length>0)})).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
}

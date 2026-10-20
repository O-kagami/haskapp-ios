import type { SupabaseClient } from '@supabase/supabase-js';

export type PrivateProfile = { owner_id: string; student_year: number | null; class_group: string | null; official_course_ids: string[] };
export type PersonalEntry = {
 id: string; owner_id: string; academic_year: number; term: 'spring'|'summer'|'fall'|'winter'; weekday: number; period: number;
 lecture_name: string; instructor: string; classroom: string; private_memo: string|null; assessment_note: string|null;
 grading_report: number|null; grading_test: number|null; grading_quiz: number|null;
 attendance_total: number|null; attendance_required: number|null; absences: number|null; exam_date: string|null; cancelled_date: string|null;
};
type ProfilePatch = Partial<Omit<PrivateProfile,'owner_id'>>;
type EntryPatch = Partial<Omit<PersonalEntry,'id'|'owner_id'>>;
type Operation = {kind:'profile'; patch:ProfilePatch; base:PrivateProfile|null} | {kind:'insert'; value:PersonalEntry} | {kind:'update'; id:string; patch:EntryPatch; base:PersonalEntry} | {kind:'delete'; id:string; base:PersonalEntry};
export type PrivateState = {version:1; profile:PrivateProfile|null; entries:PersonalEntry[]; queue:Operation[]; loaded:boolean};
type Hooks = {client:SupabaseClient; storage:Pick<Storage,'getItem'|'setItem'>; identity:()=>Promise<{id:string;is_anonymous?:boolean}|null>; flush:()=>Promise<void>; online:()=>boolean};
const fields = ['academic_year','term','weekday','period','lecture_name','instructor','classroom','private_memo','assessment_note','grading_report','grading_test','grading_quiz','attendance_total','attendance_required','absences','exam_date','cancelled_date'] as const;
const profileFields = ['student_year','class_group','official_course_ids'] as const;
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const errorText='他の端末で同じ項目が変更されています。端末の変更は保存待ちに保持しています。バックアップして内容を確認してください。';
export function privateKey(owner:string){return `haskapp_private_sync_v1_${owner}`;}
export function emptyPrivateState():PrivateState{return {version:1,profile:null,entries:[],queue:[],loaded:false};}
export function validatePrivateProfile(p:ProfilePatch){
 if(p.student_year!==undefined && p.student_year!==null && (!Number.isInteger(p.student_year)||p.student_year<1||p.student_year>4))throw Error('学年は1〜4年です。');
 if(p.class_group!==undefined && p.class_group!==null && !['A','B','C'].includes(p.class_group))throw Error('クラスはA/B/Cです。');
 if(p.class_group && p.student_year!==2)throw Error('クラスは2年のときだけ設定できます。');
 if(p.official_course_ids && (p.official_course_ids.length>500||p.official_course_ids.some(x=>typeof x!=='string')||[...p.official_course_ids.join(',')].reduce((n,c)=>{const v=c.codePointAt(0)!;return n+(v<128?1:v<2048?2:v<65536?3:4);},0)>64000))throw Error('公式科目の選択件数を確認してください。');
}
export function validatePersonalEntry(e:PersonalEntry){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e.id)||!e.owner_id)throw Error('個人講義の保存IDを確認してください。');
 if(!Number.isInteger(e.academic_year)||e.academic_year<2000||e.academic_year>2200||!['spring','summer','fall','winter'].includes(e.term))throw Error('年度・タームを確認してください。');
 if(!Number.isInteger(e.weekday)||e.weekday<1||e.weekday>5||!Number.isInteger(e.period)||e.period<1||e.period>5)throw Error('曜日・時限を確認してください。');
 if(!e.lecture_name.trim()||e.lecture_name.length>200||e.instructor.length>200||e.classroom.length>200)throw Error('講義名・教員・教室は200文字以内です。');
 for(const k of ['private_memo','assessment_note'] as const)if(e[k]!==null&&e[k]!.length>10000)throw Error('メモは10000文字以内です。');
 for(const k of ['grading_report','grading_test','grading_quiz','attendance_total','attendance_required','absences'] as const){const n=e[k];const max=k.startsWith('grading_')?100:1000;if(n!==null&&(!Number.isInteger(n)||n<0||n>max))throw Error('評価割合・出欠回数を確認してください。');}
 if((e.grading_report??0)+(e.grading_test??0)+(e.grading_quiz??0)>100)throw Error('評価割合の合計は100%以下です。');
 if(e.attendance_total!==null&&e.attendance_required!==null&&e.attendance_required>e.attendance_total)throw Error('必要出席回数が講義回数を超えています。');
 for(const key of ['exam_date','cancelled_date'] as const){const d=e[key];if(d!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d))throw Error('試験・休講日は実在する日付を選んでください。');}
}
export class PrivateSync {
 constructor(private h:Hooks){}
 read(owner:string):PrivateState{
  const raw=this.h.storage.getItem(privateKey(owner));if(!raw)return emptyPrivateState();
  let s:PrivateState;try{s=JSON.parse(raw);}catch{throw Error('個人時間割の保存履歴を読み込めません。端末データは削除していません。');}
  if(s.version!==1||!Array.isArray(s.entries)||!Array.isArray(s.queue)||s.entries.some(e=>e.owner_id!==owner)||s.profile&&s.profile.owner_id!==owner)throw Error('個人時間割の所有者・履歴を確認できません。');return s;
 }
 private async write(owner:string,s:PrivateState){this.h.storage.setItem(privateKey(owner),JSON.stringify(s));await this.h.flush();}
 private async guard(owner:string){const u=await this.h.identity();if(!u||u.id!==owner||u.is_anonymous)throw Error('通常ログインした同じ本人のアカウントが必要です。端末データは保持しています。');}
 async profile(owner:string,patch:ProfilePatch){
  const s=this.read(owner),base=s.profile;const next={owner_id:owner,student_year:null,class_group:null,official_course_ids:[],...base,...patch};validatePrivateProfile(next);
  const changed=Object.fromEntries(profileFields.filter(k=>!equal(next[k],base?.[k])).map(k=>[k,next[k]]));
  if(!Object.keys(changed).length)return;s.profile=next;s.queue.push({kind:'profile',patch:changed,base});await this.write(owner,s);
 }
 async save(owner:string,e:PersonalEntry){
  if(e.owner_id!==owner)throw Error('講義の所有者が一致しません。');validatePersonalEntry(e);const s=this.read(owner),base=s.entries.find(x=>x.id===e.id);
  if(base){const patch=Object.fromEntries(fields.filter(k=>!equal(e[k],base[k])).map(k=>[k,e[k]]));if(!Object.keys(patch).length)return;s.queue.push({kind:'update',id:e.id,patch,base});}
  else s.queue.push({kind:'insert',value:e});s.entries=[...s.entries.filter(x=>x.id!==e.id),e];await this.write(owner,s);
 }
 async remove(owner:string,id:string){const s=this.read(owner),base=s.entries.find(x=>x.id===id);if(!base)throw Error('削除する個人講義が見つかりません。');s.queue.push({kind:'delete',id,base});s.entries=s.entries.filter(x=>x.id!==id);await this.write(owner,s);}
 async refresh(owner:string){
  await this.guard(owner);if(!this.h.online())throw Error('通信を確認できません。前回の個人時間割を表示します。');
  const s=this.read(owner);if(s.queue.length)return s;
  const [p,e]=await Promise.all([this.h.client.from('private_profile_settings').select('*').eq('owner_id',owner).maybeSingle(),this.h.client.from('personal_timetable_entries').select('*').eq('owner_id',owner).order('academic_year').order('weekday').order('period')]);
  await this.guard(owner);if(p.error||e.error)throw Error('個人時間割を取得できません。前回のデータは保持しています。');
  // A concurrent local edit must not be erased by an older read response.
  if(this.read(owner).queue.length)return this.read(owner);
  const next:PrivateState={version:1,profile:p.data,entries:e.data??[],queue:[],loaded:true};await this.write(owner,next);return next;
 }
 async sync(owner:string){
  await this.guard(owner);await this.h.flush();if(!this.h.online())throw Error('未送信の個人時間割は端末に保持しています。');
  while(this.read(owner).queue.length){
   await this.guard(owner);const s=this.read(owner),op=s.queue[0];
   if(op.kind==='insert'){
    const found=await this.h.client.from('personal_timetable_entries').select('*').eq('owner_id',owner).eq('id',op.value.id).maybeSingle();await this.guard(owner);if(found.error)throw found.error;
    if(found.data){if(fields.some(k=>!equal(found.data[k],op.value[k])))throw Error(errorText);}
    else{const r=await this.h.client.from('personal_timetable_entries').insert(op.value).select('id').single();await this.guard(owner);if(r.error)throw r.error;}
   }else if(op.kind==='profile'){
    const found=await this.h.client.from('private_profile_settings').select('*').eq('owner_id',owner).maybeSingle();await this.guard(owner);if(found.error)throw found.error;
    if(!found.data){if(op.base)throw Error(errorText);const r=await this.h.client.from('private_profile_settings').insert({owner_id:owner,student_year:null,class_group:null,official_course_ids:[],...op.patch}).select('owner_id').single();await this.guard(owner);if(r.error)throw r.error;}
    else if(!Object.entries(op.patch).every(([k,v])=>equal(found.data[k],v))){
     if(!op.base||Object.keys(op.patch).some(k=>!equal(found.data[k],op.base![k as keyof PrivateProfile])))throw Error(errorText);
     let q=this.h.client.from('private_profile_settings').update(op.patch).eq('owner_id',owner);
     for(const key of Object.keys(op.patch) as (keyof ProfilePatch)[]){const val=op.base[key];q=val===null?q.is(key,null):Array.isArray(val)?q.filter(key,'eq',`{${val.map(x=>JSON.stringify(x)).join(',')}}`):q.eq(key,val);}
     const r=await q.select('owner_id');await this.guard(owner);if(r.error)throw r.error;if(r.data?.length!==1)throw Error(errorText);
    }
   }else{
    const found=await this.h.client.from('personal_timetable_entries').select('*').eq('owner_id',owner).eq('id',op.id).maybeSingle();await this.guard(owner);if(found.error)throw found.error;
    if(op.kind==='delete'&&!found.data){/* acknowledged earlier delete */}
    else if(!found.data)throw Error(errorText);
    else if(op.kind==='update'&&Object.entries(op.patch).every(([k,v])=>equal(found.data[k],v))){/* acknowledged earlier patch */}
    else{
     const compare=op.kind==='delete'?[...fields]:Object.keys(op.patch) as (keyof EntryPatch)[];
     if(compare.some(k=>!equal(found.data[k],op.base[k])))throw Error(errorText);
     let q=op.kind==='delete'?this.h.client.from('personal_timetable_entries').delete():this.h.client.from('personal_timetable_entries').update(op.patch);
     q=q.eq('owner_id',owner).eq('id',op.id);for(const key of compare){const val=op.base[key];q=val===null?q.is(key,null):q.eq(key,val);}
     const r=await q.select('id');await this.guard(owner);if(r.error)throw r.error;if(r.data?.length!==1)throw Error(errorText);
    }
   }
   // Always re-read: additional local edits may have been appended during I/O.
   const current=this.read(owner);if(!equal(current.queue[0],op))throw Error('保存履歴が変更されました。再読み込みしてください。');current.queue.shift();await this.write(owner,current);
  }
  return this.refresh(owner);
 }
}
export const termLabels={spring:'春',summer:'夏',fall:'秋',winter:'冬'} as const;
export function personalTerm(e:Pick<PersonalEntry,'academic_year'|'term'>){return `${e.academic_year}年度 ${e.term==='spring'||e.term==='summer'?1:2}学期（${termLabels[e.term]}ターム）`;}

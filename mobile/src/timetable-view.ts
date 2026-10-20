import type {LectureWithDetails} from '../web-contract/lib/types';
import {LEGACY_DEFAULT_TERM} from '../web-contract/lib/academic-terms';
import {assertNoNewConflicts} from './planner-rules';

/** An owner-local display overlay. Enrollments, grades, tasks and cloud rows are never removed. */
export type TimetableView = {version:1;terms:Record<string,LectureWithDetails[]>;hidden:Record<string,string[]>;undo?:{term:string;rows:LectureWithDetails[]}};
export const emptyTimetableView=():TimetableView=>({version:1,terms:{},hidden:{}});
export const timetableViewKey=(owner:string)=>`haskapp_timetable_view_${owner}`;
export function readTimetableView(owner:string):TimetableView {
 const raw=localStorage.getItem(timetableViewKey(owner));if(raw===null)return emptyTimetableView();
 const value=JSON.parse(raw) as TimetableView;
 const validRows=(rows:unknown):rows is LectureWithDetails[]=>Array.isArray(rows)&&rows.every(row=>row&&typeof row.id==='string'&&typeof row.lecture_name==='string');
 if(value?.version!==1||!value.terms||typeof value.terms!=='object'||Array.isArray(value.terms)||!Object.values(value.terms).every(validRows)||!value.hidden||typeof value.hidden!=='object'||Array.isArray(value.hidden)||!Object.values(value.hidden).every(ids=>Array.isArray(ids)&&ids.every(id=>typeof id==='string'))||value.undo&&(!validRows(value.undo.rows)||typeof value.undo.term!=='string'))throw Error('時間割の復元記録を読み込めません。元の授業データは保持されています。');
 return value;
}
export function effectiveTimetable(rows:LectureWithDetails[],view:TimetableView):LectureWithDetails[] {
 const overlays=Object.values(view.terms).flat(),overlayIDs=new Set(overlays.map(row=>row.id));
 return [...rows.filter(row=>!view.hidden[row.term??LEGACY_DEFAULT_TERM]?.includes(row.id)&&!overlayIDs.has(row.id)),...overlays];
}
export function replacingTimetable(view:TimetableView,source:LectureWithDetails[],term:string,rows:LectureWithDetails[]):TimetableView {
 if(!/^\d{4}年度 [12]学期（[春夏秋冬]ターム）$/.test(term)||rows.length===0||rows.some(row=>row.term!==term))throw Error('置換するタームと授業を確認してください。');
 assertNoNewConflicts(rows,[]);
 const previous=effectiveTimetable(source,view).filter(row=>(row.term??LEGACY_DEFAULT_TERM)===term);
 return JSON.parse(JSON.stringify({version:1,terms:{...view.terms,[term]:rows},hidden:{...view.hidden,[term]:source.filter(row=>(row.term??LEGACY_DEFAULT_TERM)===term).map(row=>row.id)},undo:{term,rows:previous}}));
}
export function undoTimetable(view:TimetableView,source:LectureWithDetails[]):TimetableView {
 if(!view.undo)throw Error('元に戻せる時間割はありません。');
 const {term,rows}=view.undo;
 return {version:1,terms:{...view.terms,[term]:rows},hidden:{...view.hidden,[term]:source.filter(row=>(row.term??LEGACY_DEFAULT_TERM)===term).map(row=>row.id)},undo:{term,rows:effectiveTimetable(source,view).filter(row=>(row.term??LEGACY_DEFAULT_TERM)===term)}};
}
/** Persist replacement and its complete recovery snapshot together, before publishing UI state. */
export async function persistTimetableView(owner:string,next:TimetableView,flush:()=>Promise<void>,assertOwner:()=>Promise<void>) {
 const key=timetableViewKey(owner),previous=localStorage.getItem(key);
 await assertOwner();
 try {localStorage.setItem(key,JSON.stringify(next));await flush();await assertOwner();}
 catch(error){
  if(previous===null)localStorage.removeItem(key);else localStorage.setItem(key,previous);
  try{await flush();}catch{throw Error('時間割表示を切り替えませんでした。保存領域を確認してください。元の授業と復元記録は削除していません。');}
  throw error;
 }
}

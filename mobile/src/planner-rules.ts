import {LEGACY_DEFAULT_TERM} from '../web-contract/lib/academic-terms';
export type ScheduleRow={id:string;lecture_name:string;term?:string|null;day_of_the_week:number;period:number};
export function scheduleSlot(row:ScheduleRow){return `${row.term ?? LEGACY_DEFAULT_TERM}:${row.day_of_the_week}:${row.period}`;}
/** Existing overlaps are preserved; only newly introduced occupancy is rejected. */
export function assertNoNewConflicts(incoming:ScheduleRow[],existing:ScheduleRow[],replacedIds:string[]=[]){
 const incomingIDs=new Set<string>();
 const occupied=existing.filter(row=>!replacedIds.includes(row.id));
 for(const row of incoming){
  if(incomingIDs.has(row.id))throw Error('同じターム・曜日・時限の講義を複数回追加できません。');incomingIDs.add(row.id);
  if(!Number.isInteger(row.day_of_the_week)||row.day_of_the_week<0||row.day_of_the_week>6||!Number.isInteger(row.period)||row.period<1||row.period>5)throw Error('曜日と時限を確認してください。');
  const old=existing.find(item=>item.id===row.id);
  if(old && scheduleSlot(old)===scheduleSlot(row))continue;
  const conflict=occupied.find(item=>item.id!==row.id && scheduleSlot(item)===scheduleSlot(row));
  if(conflict)throw Error(`同じターム・曜日・時限に「${conflict.lecture_name}」が登録されています。既存の授業を確認してください。`);
  occupied.push(row);
 }
}
export function safeLearningURL(value:unknown){if(typeof value!=='string'||!value)return undefined;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash?u.href:undefined;}catch{return undefined;}}

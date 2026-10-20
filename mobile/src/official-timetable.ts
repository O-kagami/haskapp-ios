import catalog from '../data/official-timetable-2026-semester2.json';
import type {LectureWithDetails,JavaScriptDayOfWeek,PeriodNumber} from '../web-contract/lib/types';
export const officialCatalog=catalog;
const courseColors=['teal','blue','violet','orange','green','pink','indigo','red','yellow','rose'] as const;
export function courseColor(name:string,instructor=''){
 let hash=2166136261;for(const character of `${name.normalize('NFKC')}|${instructor.normalize('NFKC')}`){hash=Math.imul(hash^character.codePointAt(0)!,16777619)>>>0;}
 return courseColors[hash%courseColors.length];
}
export type OfficialCourse=typeof catalog.courses[number];
export function officialCoursesFor(profile:{department:string;major:string;studentYear?:number;classGroup?:string}){
 return catalog.courses.filter(c=>(!profile.department || profile.department===catalog.faculty) && (!profile.major || c.courseNames.some(name=>profile.major===name || profile.major===`${catalog.department} ${name}`)) && (!profile.studentYear || c.studentYear===profile.studentYear) && (!profile.classGroup || !c.classGroup || c.classGroup===profile.classGroup));
}
export function officialLecturesFor(ids:string[]):LectureWithDetails[]{
 const selected=new Set(ids);
 return catalog.courses.filter(c=>selected.has(c.id) && !c.intensive).flatMap(c=>{
 const terms=c.openingTerm==='秋'?['秋']:c.openingTerm==='冬'?['冬']:['秋','冬'];
 return terms.flatMap(term=>c.slots.map(s=>({id:`${c.id}:${term}:${s.weekday}:${s.period}`,user_id:'official-catalog',created_at:'',lecture_name:c.title,instructor:c.instructor,classroom:c.classroom,term:`2026年度 2学期（${term}ターム）`,day_of_the_week:s.weekday as JavaScriptDayOfWeek,period:s.period as PeriodNumber,colorTheme:courseColor(c.title,c.instructor),lecture_details:`${catalog.sourceLabel} · 原資料${c.page}ページ · ${c.openingTerm}\n${c.notes}`})));
 });
}
export function officialTeachingDay(date:string,ordinary:number){return catalog.dateOverrides.find(x=>x.date===date)?.weekday ?? ordinary;}
export function validateStudyProfile(p:{studentYear?:number;classGroup?:string}){
 if(p.studentYear!==undefined && (!Number.isInteger(p.studentYear) || p.studentYear<0 || p.studentYear>4))throw Error('学年は未設定または1〜4年を選んでください。');
 if(p.classGroup!==undefined && !['','A','B','C'].includes(p.classGroup))throw Error('クラスは未設定またはA/B/Cを選んでください。');
}

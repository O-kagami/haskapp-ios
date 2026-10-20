import {courseColor} from './official-timetable';
import {personalTerm,type PersonalEntry} from './private-sync';
import type {LectureWithDetails} from '../web-contract/lib/types';
export type PersonalLecture=LectureWithDetails & {personal_entry:true};
export function personalLecture(e:PersonalEntry):PersonalLecture{
 return {id:e.id,personal_entry:true,schedule_is_shared:false,term:personalTerm(e),lecture_name:e.lecture_name,instructor:e.instructor,classroom:e.classroom,day_of_the_week:e.weekday as 1|2|3|4|5,period:e.period as 1|2|3|4|5,colorTheme:courseColor(e.lecture_name,e.instructor),memo:e.private_memo??undefined,grading_memo:e.assessment_note??undefined,grading_criteria:e.assessment_note??undefined,grading_report:e.grading_report??undefined,grading_test:e.grading_test??undefined,grading_quiz:e.grading_quiz??undefined,grading_attendance_total:e.attendance_total??undefined,grading_attendance_required:e.attendance_required??undefined,absences:e.absences??undefined,test_datetime:e.exam_date??undefined,cancelled_date:e.cancelled_date??undefined};
}
export function personalEntry(l:LectureWithDetails,owner:string):PersonalEntry{
 const match=l.term?.match(/^(\d{4})年度 [12]学期（(春|夏|秋|冬)ターム）$/);if(!match)throw Error('個人講義の年度・タームを選んでください。');
 if(l.grading_criteria?.trim() && l.grading_memo?.trim() && l.grading_criteria!==l.grading_memo)throw Error('評価基準と評価メモが異なります。内容をバックアップして一本化してから同期してください。');
 const terms={春:'spring',夏:'summer',秋:'fall',冬:'winter'} as const;
 return {id:l.id,owner_id:owner,academic_year:Number(match[1]),term:terms[match[2] as keyof typeof terms],weekday:l.day_of_the_week,period:l.period,lecture_name:l.lecture_name,instructor:l.instructor??'',classroom:l.classroom??'',private_memo:l.memo||null,assessment_note:l.grading_memo?.trim()?l.grading_memo:l.grading_criteria||null,grading_report:l.grading_report??null,grading_test:l.grading_test??null,grading_quiz:l.grading_quiz??null,attendance_total:l.grading_attendance_total??null,attendance_required:l.grading_attendance_required??null,absences:l.absences??null,exam_date:l.test_datetime||null,cancelled_date:l.cancelled_date||null};
}

const test=require('node:test');const assert=require('node:assert/strict');const {loadTs}=require('./helpers/load-ts.cjs');
const {officialCatalog:c,officialCoursesFor,officialLecturesFor,officialTeachingDay,validateStudyProfile}=loadTs('src/official-timetable.ts');
test('official catalog retains verified six pages, all courses and intensive exceptions',()=>{
 assert.equal(c.academicYear,2026);assert.equal(c.semester,2);assert.equal(c.sourcePages,6);assert.equal(c.courses.length,154);assert.equal(c.courses.reduce((n,x)=>n+x.slots.length,0),273);assert.equal(c.courses.filter(x=>x.intensive).length,9);
 assert.equal(new Set(c.courses.map(x=>x.id)).size,c.courses.length);
 for(const x of c.courses){assert.ok(x.title && x.instructor && x.classroom);assert.ok(x.page>=1&&x.page<=6);assert.ok(x.studentYear>=2&&x.studentYear<=4);assert.equal(x.slots.length===0,x.intensive);for(const s of x.slots){assert.ok(s.weekday>=1&&s.weekday<=5);assert.ok(s.period>=1&&s.period<=5)}}
});
test('faculty, course, academic grade and class filter independently; legacy unset lists all',()=>{
 assert.equal(officialCoursesFor({department:'',major:''}).length,154);
 assert.equal(officialCoursesFor({department:'工学部',major:'',studentYear:1}).length,0);
 assert.equal(officialCoursesFor({department:'別学部',major:'',studentYear:2}).length,0);
 const filtered=officialCoursesFor({department:'工学部',major:'情報エレクトロニクス学科 情報理工学コース',studentYear:2,classGroup:'A'});
 assert.ok(filtered.length>0);assert.ok(filtered.every(x=>x.studentYear===2 && x.courseNames.includes('情報理工学コース') && (!x.classGroup || x.classGroup==='A')));
 assert.ok(!filtered.some(x=>x.title==='応用電気回路'));
});
test('source examples preserve precise autumn/winter classrooms, course and periods',()=>{
 const find=(title,year,group,opening,page)=>c.courses.find(x=>x.title===title&&x.studentYear===year&&x.classGroup===group&&x.openingTerm===opening&&x.page===page);
 assert.equal(find('信号処理',2,'A','秋',1).classroom,'A13');assert.equal(find('信号処理',2,'C','秋',1).classroom,'A21');
 assert.equal(find('線形システム論',2,'A','冬',1).classroom,'M151');
 const quantum=find('量子力学',4,'','冬',6);assert.deepEqual(quantum.slots,[{weekday:3,period:5},{weekday:5,period:1}]);
 const cloud=find('ネットワークとクラウド',4,'','冬',6);assert.deepEqual(cloud.slots,[{weekday:3,period:3},{weekday:4,period:1}]);
 const bioEnglish=find('科学技術英語演習',3,'','2学期',4);assert.deepEqual(bioEnglish.slots,[{weekday:5,period:5}]);assert.equal(bioEnglish.intensive,false);
});
test('selection is idempotent, unknown ids ignored, intensive never gets fabricated slot or grades',()=>{
 const full=c.courses.find(x=>x.openingTerm==='通年'),intensive=c.courses.find(x=>x.intensive);
 const rows=officialLecturesFor([full.id,full.id,intensive.id,'invalid']);assert.equal(rows.length,full.slots.length*2);assert.equal(new Set(rows.map(x=>x.id)).size,rows.length);
 assert.ok(rows.every(x=>x.term.startsWith('2026年度 2学期') && !('absences' in x) && !('grading_report' in x)));
});
test('official Monday overrides preserve academic year and ordinary days elsewhere',()=>{assert.equal(officialTeachingDay('2026-10-15',4),1);assert.equal(officialTeachingDay('2027-01-13',3),1);assert.equal(officialTeachingDay('2026-10-16',5),5)});
test('unset old profile accepted without invented year; reject unsupported years/classes',()=>{validateStudyProfile({});validateStudyProfile({studentYear:0,classGroup:''});validateStudyProfile({studentYear:2,classGroup:'A'});for(const p of [{studentYear:5},{studentYear:1.5},{classGroup:'D'}])assert.throws(()=>validateStudyProfile(p));});

test('official classes use stable subject colors across terms and slots with several distinguishable colors',()=>{
 const rows=officialLecturesFor(c.courses.map(x=>x.id));const colors=new Map();
 for(const row of rows){const key=row.lecture_name+'|'+row.instructor;if(colors.has(key))assert.equal(row.colorTheme,colors.get(key));else colors.set(key,row.colorTheme);}
 assert.ok(new Set(rows.map(x=>x.colorTheme)).size>=8);
});

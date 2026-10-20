const test = require('node:test');
const assert = require('node:assert/strict');
const { apiHarness } = require('./helpers/api-harness.cjs');
const owner = '11111111-1111-4111-8111-111111111111';
const admin = '99999999-9999-4999-8999-999999999999';
const uid = '22222222-2222-4222-8222-222222222222';
const sid = '33333333-3333-4333-8333-333333333333';
const sid2 = '44444444-4444-4444-8444-444444444444';
const group = '55555555-5555-4555-8555-555555555555';
const key = `haskapp_classes_${owner}`;
const term = '2028年度 2学期（秋ターム）';
const canonicalSchedules = [
  { id: sid, user_id: admin, group_id: group, day_of_week: 1, start_time: '08:45:00', period_start_daytime: '2028-10-01T00:00:00Z' },
  { id: sid2, user_id: admin, group_id: group, day_of_week: 3, start_time: '14:45:00', period_start_daytime: '2028-10-01T00:00:00Z' },
];
const makeLecture = (extra = {}) => ({
  id: `${uid}_${sid}`, lecture_list_id: group, lecture_name: '数学', instructor: '先生',
  day_of_the_week: 1, period: 1, colorTheme: 'teal', term, schedule_is_shared: true, ...extra,
});
const setup = (t, options) => apiHarness(t, 'lib/api/lectures.ts', options);
function canonicalResponse(q, { enrolled = true, schedules = canonicalSchedules } = {}) {
  if (q.operation !== 'select') return { data: { id: uid }, error: null };
  const result = {
    groups: { id: group, name: '数学' },
    public_lecture_data: { group_id: group, name: '数学', teacher: '先生', syllabus_id: '123450' },
    schedules,
    user_lecture_data: enrolled ? { id: uid, group_id: group, exam_date: '2028-11-09', no_lecture_date: '2028-10-15' } : null,
    grade_distributions: [],
  }[q.table];
  return { data: q.single || q.maybeSingle || Array.isArray(result) ? result : result ? [result] : [], error: null };
}
const assertNoCanonicalWrites = h => assert.equal(h.requests.filter(q => q.operation !== 'select' && q.table !== 'user_lecture_data').length, 0);

test('owned enrollment displays admin-owned canonical slots, stored dates, and actual terms', async t => {
  const h = setup(t, { respond: canonicalResponse });
  const result = await h.api.lecturesApi.fetchLectures();
  assert.equal(result.length, 2);
  assert.equal(result[0].test_datetime, '2028-11-09');
  assert.equal(result[0].cancelled_date, '2028-10-15');
  assert.equal(result[0].term, term);
  assert.equal(result[1].day_of_the_week, 3);
  assert.equal(result[1].period, 4);
  assert.ok(result.every(l => l.schedule_is_shared));
  assert.deepEqual(h.requests.find(q => q.table === 'schedules').filters, []);
  assert.deepEqual(h.requests.find(q => q.table === 'user_lecture_data').filters, [['user_id', owner]]);
  assert.equal(h.authReads(), 1);
});

test('public schedule reads never create enrollment for unrelated groups', async t => {
  const h = setup(t, { respond: q => canonicalResponse(q, { schedules: [...canonicalSchedules, { ...canonicalSchedules[0], id: 'unrelated', group_id: 'another-group' }] }) });
  assert.equal((await h.api.lecturesApi.fetchLectures()).length, 2);
});

test('metadata saves use one owner and update every canonical slot without schedule writes', async t => {
  const h = setup(t, { respond: q => { h.setOwner(admin); return canonicalResponse(q); } });
  const first = makeLecture({ memo: 'old' });
  const saved = await h.api.lecturesApi.saveLecture({ ...first, memo: 'shared', test_datetime: '2028-11-01' }, [first], owner);
  assert.equal(saved.id, first.id);
  assert.equal(h.authReads(), 1);
  assert.equal(h.cache(`haskapp_classes_${admin}`), null);
  assert.equal(h.cache(key).length, 2);
  assert.equal(h.cache(key)[1].memo, 'shared');
  assert.equal(h.cache(key)[1].period, 4);
  const writes = h.requests.filter(q => q.operation !== 'select');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].filters, [['id', uid], ['user_id', owner]]);
  assert.equal(writes[0].payload.exam_date, '2028-11-01');
  assertNoCanonicalWrites(h);
});

test('new registration inserts only enrollment and caches all canonical group slots', async t => {
  const h = setup(t, { respond: q => canonicalResponse(q, { enrolled: false }) });
  const saved = await h.api.lecturesApi.saveLecture(makeLecture({ id: undefined }), [], owner);
  assert.equal(saved.id, `${uid}_${sid}`);
  assert.equal(h.cache(key).length, 2);
  assert.deepEqual(h.cache(key).map(l => l.id), [`${uid}_${sid}`, `${uid}_${sid2}`]);
  assert.equal(h.requests.filter(q => q.operation === 'insert').length, 1);
  assertNoCanonicalWrites(h);
});

test('canonical field changes reject before mutating enrollment metadata', async t => {
  for (const change of [{ lecture_name: 'Renamed' }, { instructor: 'Another teacher' }, { day_of_the_week: 2 }, { period: 2 }, { term: '2029年度 2学期（秋ターム）' }]) {
    await t.test(Object.keys(change)[0], async t => {
      const h = setup(t, { respond: canonicalResponse });
      const before = makeLecture(); h.seed(key, [before]);
      await assert.rejects(h.api.lecturesApi.saveLecture({ ...before, ...change }, [before], owner), /共有時間割/);
      assert.deepEqual(h.cache(key), [before]);
      assert.equal(h.requests.filter(q => q.operation !== 'select').length, 0);
    });
  }
});

test('registration with no canonical schedules fails without inventing or writing a slot', async t => {
  const h = setup(t, { respond: q => canonicalResponse(q, { schedules: [], enrolled: false }) });
  await assert.rejects(h.api.lecturesApi.saveLecture(makeLecture({ id: undefined }), [], owner), /共有時限が未登録/);
  assert.equal(h.requests.filter(q => q.operation !== 'select').length, 0);
  assert.equal(h.cache(key), null);
});

test('undated canonical schedules use the legacy term, never an invented current term', async t => {
  const schedules = canonicalSchedules.map(({ period_start_daytime: _, ...row }) => row);
  const h = setup(t, { respond: q => canonicalResponse(q, { schedules }) });
  const result = await h.api.lecturesApi.fetchLectures();
  assert.ok(result.every(l => l.term === '2026年度 1学期（夏ターム）'));
  const saved = await h.api.lecturesApi.saveLecture({ ...result[0], memo: 'Metadata edit' }, result, owner);
  assert.equal(saved.term, '2026年度 1学期（夏ターム）');
  await assert.rejects(h.api.lecturesApi.saveLecture(makeLecture(), result, owner), /共有時間割/);
  assertNoCanonicalWrites(h);
});

test('long teacher display truncation roundtrips through metadata edits', async t => {
  const teacher = '先生'.repeat(60);
  const h = setup(t, { respond: q => q.table === 'public_lecture_data'
    ? { data: q.maybeSingle ? { name: '数学', teacher, group_id: group } : [{ name: '数学', teacher, group_id: group }], error: null }
    : canonicalResponse(q) });
  const rows = await h.api.lecturesApi.fetchLectures();
  assert.equal(rows[0].instructor, teacher.slice(0, 90) + '...');
  const saved = await h.api.lecturesApi.saveLecture(rows[0], rows, owner);
  assert.equal(saved.instructor, rows[0].instructor);
});

test('an inaccessible enrollment ID or zero-row update never becomes a confirmed edit', async t => {
  for (const failure of ['missing', 'denied']) {
    await t.test(failure, async t => {
      const h = setup(t, { respond: q => q.table === 'user_lecture_data' && (failure === 'missing' || q.operation === 'update')
        ? { data: null, error: failure === 'denied' ? { code: 'PGRST116', message: 'no visible row' } : null }
        : canonicalResponse(q) });
      const before = makeLecture(); h.seed(key, [before]);
      await assert.rejects(h.api.lecturesApi.saveLecture({ ...before, memo: 'changed' }, [before], owner));
      assert.deepEqual(h.cache(key), [before]);
      assert.equal(h.requests.filter(q => q.operation === 'insert').length, 0);
      assertNoCanonicalWrites(h);
    });
  }
});

test('unregistering one displayed shared slot removes only the owned enrollment and all its slots', async t => {
  let enrolled = true;
  const h = setup(t, { respond: q => {
    if (q.operation === 'delete') { enrolled = false; return { data: null, error: null }; }
    return { data: enrolled ? { id: uid } : null, error: null };
  } });
  const first = makeLecture(); const second = makeLecture({ id: `${uid}_${sid2}` });
  const other = makeLecture({ id: 'local-other', lecture_list_id: undefined });
  await h.api.lecturesApi.deleteLecture(first.id, [first, second, other], owner);
  assert.deepEqual(h.cache(key), JSON.parse(JSON.stringify([other])));
  assert.ok(h.requests.every(q => q.table === 'user_lecture_data'));
  assert.deepEqual(h.requests[0].filters, [['id', uid], ['user_id', owner]]);
  await h.api.lecturesApi.deleteLecture(first.id, [first, second], owner);
  assert.deepEqual(h.cache(key), []);
});

test('a rejected or silently denied enrollment delete retains recoverable cache', async t => {
  const h = setup(t, { respond: q => ({ data: q.operation === 'select' ? { id: uid } : null, error: null }) });
  const before = makeLecture(); h.seed(key, [before]);
  await assert.rejects(h.api.lecturesApi.deleteLecture(before.id, [before], owner), /登録解除が確認/);
  assert.deepEqual(h.cache(key), [before]);
  assertNoCanonicalWrites(h);
});

test('lost-response enrollment insert is recoverable without duplicate enrollment or schedule writes', async t => {
  let enrolled = false;
  const h = setup(t, { respond: q => {
    if (q.operation === 'insert') { enrolled = true; throw new Error('Failed to fetch'); }
    return canonicalResponse(q, { enrolled });
  } });
  const input = makeLecture({ id: undefined });
  const local = await h.api.lecturesApi.saveLecture(input, [], owner);
  assert.match(local.id, /^class-/);
  h.setOnline(true);
  const saved = await h.api.lecturesApi.saveLecture(input, [local], owner);
  assert.equal(saved.id, `${uid}_${sid}`);
  assert.equal(h.requests.filter(q => q.operation === 'insert').length, 1);
  assert.equal(h.cache(key).length, 2);
  assertNoCanonicalWrites(h);
});

test('guest edits and removals stay flexible and local even when the online flag is set', async t => {
  const h = setup(t, { owner: 'guest-test' });
  const guestKey = 'haskapp_classes_guest-test';
  h.seed(guestKey, [makeLecture({ id: 'local', day_of_the_week: 7 })]);
  assert.equal((await h.api.lecturesApi.fetchLectures())[0].day_of_the_week, 0);
  const first = await h.api.lecturesApi.saveLecture(makeLecture({ id: undefined, lecture_list_id: undefined, term: 'custom' }), []);
  const second = await h.api.lecturesApi.saveLecture(makeLecture({ id: undefined, lecture_list_id: undefined }), [first]);
  await h.api.lecturesApi.deleteLecture(first.id, [first, second]);
  assert.deepEqual(h.cache(guestKey), JSON.parse(JSON.stringify([second])));
  assert.equal(h.requests.length, 0);
});

test('same-millisecond offline lecture IDs remain unique without randomness', async t => {
  const h = setup(t, { online: false });
  t.mock.method(Date, 'now', () => 1); t.mock.method(Math, 'random', () => 0);
  const old = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  t.after(() => { if (old) Object.defineProperty(globalThis, 'crypto', old); else delete globalThis.crypto; });
  const first = await h.api.lecturesApi.saveLecture(makeLecture({ id: undefined }), []);
  const second = await h.api.lecturesApi.saveLecture(makeLecture({ id: undefined }), [first]);
  assert.notEqual(first.id, second.id); assert.equal(h.cache(key).length, 2);
});

test('absence edits update every enrollment slot using one narrow owner-scoped write', async t => {
  const h = setup(t, { respond: canonicalResponse });
  const first = makeLecture({ grading_attendance_total: 12 }); const second = makeLecture({ id: `${uid}_${sid2}` });
  await h.api.lecturesApi.updateAbsences(first.id, 30, [first, second], owner);
  assert.deepEqual(h.cache(key).map(l => l.absences), [12, 12]);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0].payload, { absence_count: 12 });
  assert.deepEqual(h.requests[0].filters, [['id', uid], ['user_id', owner]]);
});

test('a bulk lecture save stops on owner change without populating another account cache', async t => {
  const h = setup(t, { respond: q => { h.setOwner(admin); return canonicalResponse(q); } });
  await assert.rejects(h.api.lecturesApi.saveAllLectures([makeLecture(), makeLecture({ id: `${uid}_${sid2}` })], owner), /アカウント/);
  assert.equal(h.cache(key).length, 2);
  assert.equal(h.cache(`haskapp_classes_${admin}`), null);
});

test('successive offline edits in sibling slots preserve shared room and notes for replay', async t => {
  const h = setup(t, { online: false });
  const first = makeLecture({ classroom: 'Old room', memo: 'Old notes' });
  const second = makeLecture({ id: `${uid}_${sid2}`, day_of_the_week: 3, period: 4, classroom: 'Old room', memo: 'Old notes' });
  await h.api.lecturesApi.saveLecture({ ...first, classroom: 'New room' }, [first, second], owner);
  const afterFirst = h.cache(key);
  assert.equal(afterFirst[1].classroom, 'New room');
  await h.api.lecturesApi.saveLecture({ ...afterFirst[1], memo: 'New notes' }, afterFirst, owner);
  const afterSecond = h.cache(key);
  assert.deepEqual(afterSecond.map(l => [l.classroom, l.memo]), [['New room', 'New notes'], ['New room', 'New notes']]);
  assert.deepEqual(afterSecond.map(l => [l.day_of_the_week, l.period]), [[1, 1], [3, 4]]);
  assert.equal(h.requests.length, 0);
});

test('deleting a pending canonical course removes its local group slots but leaves other groups and guest rows alone', async t => {
  for (const currentOwner of [owner, 'guest-local']) {
    await t.test(currentOwner, async t => {
      const h = setup(t, { owner: currentOwner, online: false });
      const first = makeLecture({ id: 'class-first' }); const second = makeLecture({ id: 'class-second', period: 4 });
      const unrelated = makeLecture({ id: 'class-other', lecture_list_id: '66666666-6666-4666-8666-666666666666' });
      await h.api.lecturesApi.deleteLecture(first.id, [first, second, unrelated], currentOwner);
      assert.deepEqual(h.cache(`haskapp_classes_${currentOwner}`), currentOwner === owner ? [unrelated] : [second, unrelated]);
      assert.equal(h.requests.length, 0);
    });
  }
});

test('bulk registration retains all canonical group slots rather than only selected returns', async t => {
  const h = setup(t, { respond: q => canonicalResponse(q, { enrolled: false }) });
  await h.api.lecturesApi.saveAllLectures([makeLecture({ id: undefined })], owner);
  assert.deepEqual(h.cache(key).map(l => l.id), [`${uid}_${sid}`, `${uid}_${sid2}`]);
  assertNoCanonicalWrites(h);
});

test('public search carries canonical anchors and omits unselectable schedule rows', async t => {
  const rows = [...canonicalSchedules,
    { id: 'invalid-day', day_of_week: null, start_time: '08:45:00' },
    { id: 'invalid-time', day_of_week: 1, start_time: null },
  ];
  const h = setup(t, { respond: () => ({ data: [{ id: group, name: '数学', schedules: rows, public_lecture_data: [] }], error: null }) });
  const results = await h.api.lecturesApi.searchPublicLectures('数学');
  assert.equal(results[0].schedules.length, 2);
  assert.equal(results[0].schedules[0].period_start_daytime, '2028-10-01T00:00:00Z');
  assert.match(h.requests[0].columns, /period_start_daytime/);
});

test('pending shared-slot absences propagate before another slot full edit is queued', async t => {
  const h = setup(t, { online: false });
  const first = makeLecture({ id: 'class-first', absences: 0 });
  const second = makeLecture({ id: 'class-second', day_of_the_week: 3, period: 4, absences: 0 });
  await h.api.lecturesApi.updateAbsences(first.id, 2, [first, second], owner);
  const afterAbsence = h.cache(key);
  assert.deepEqual(afterAbsence.map(l => l.absences), [2, 2]);
  await h.api.lecturesApi.saveLecture({ ...afterAbsence[1], memo: 'New note' }, afterAbsence, owner);
  assert.deepEqual(h.cache(key).map(l => l.absences), [2, 2]);
  assert.equal(h.requests.length, 0);
});

test('missing absence counts stay unknown and never reinterpret attendance as absence', async t => {
 const h=setup(t,{respond(q){const rows={groups:[{id:group,name:'数学'}],public_lecture_data:[{group_id:group,name:'数学',teacher:'先生'}],schedules:canonicalSchedules,user_lecture_data:[{id:uid,user_id:owner,group_id:group,absence_count:null,attendance_count:12}],grade_distributions:[]};return {data:rows[q.table] ?? [],error:null};}});
 const rows=await h.api.lecturesApi.fetchLectures();assert.equal(rows[0].absences,undefined);
});
test('unknown lecture count does not impose a fabricated fifteen-class absence cap',async t=>{
 const h=setup(t,{owner:'guest-ios',online:false});const row=makeLecture({grading_attendance_total:undefined,absences:18});await h.api.lecturesApi.updateAbsences(row.id,19,[row]);assert.equal(h.cache('haskapp_classes_guest-ios')[0].absences,19);
});
test('incomplete legacy history does not manufacture zero buckets or a 100 percent pass rate',async t=>{
 const h=setup(t,{respond(q){const rows={groups:[{id:group,name:'数学'}],public_lecture_data:[{group_id:group,name:'数学',teacher:'先生'}],schedules:canonicalSchedules,user_lecture_data:[{id:uid,user_id:owner,group_id:group,absence_count:0}],grade_distributions:[{id:'cohort',subject_name:'数学',academic_term:'2025年度 １学期',gpa:0,student_count:0,aplus_percent:0,a_percent:null,aminus_percent:20,f_percent:null}]};return {data:rows[q.table] ?? [],error:null};}});
 const rows=await h.api.lecturesApi.fetchLectures();assert.equal(rows[0].absences,0);assert.equal(rows[0].gpa,'0.00');assert.equal(rows[0].historicalEnrollment,'0 人');assert.equal(rows[0].aRate,undefined);assert.equal(rows[0].passRate,undefined);assert.equal(rows[0].gradeDistribution,undefined);
});
test('explicit shared-criteria approval synchronizes only its blank alias through actual save serialization',async t=>{
 const {loadTs}=require('../../tests/helpers/load-ts.cjs');
 const helpers=loadTs('src/lecture-insights.ts',{'../web-contract/lib/supabase':{configured:true,getCurrentUserId:async()=>owner,supabase:{}}});
 const affiliation='00000001-0001-0001-0000-000000000000';const current=makeLecture({grading_criteria:' ',grading_memo:' ',grading_report:0,memo:'私の講義メモ'});
 const preview=helpers.buildTemplateSuggestionPreview(current,[{templateId:'source',creatorId:null,groupId:group,affiliationId:affiliation,createdAt:null,values:{grading_criteria:'試験の評価基準'}}],owner,affiliation);
 const patch=helpers.applyTemplateSuggestion(preview,current,['grading_criteria'],owner,affiliation);
 const h=setup(t,{respond:q=>canonicalResponse(q)});const saved=await h.api.lecturesApi.saveLecture({...current,...patch},[current],owner);
 const update=h.requests.find(q=>q.table==='user_lecture_data' && q.operation==='update');
 assert.equal(update.payload.grading_criteria,'試験の評価基準');assert.equal(update.payload.memo,'私の講義メモ');assert.equal(update.payload.report_rlate,0);assert.equal(saved.grading_memo,'試験の評価基準');assert.equal(saved.grading_criteria,'試験の評価基準');
});

test('mobile sharing never publishes free text, private dates, notes, personal grades or feed URLs',async t=>{
 const h=setup(t,{respond:q=>q.operation!=='select'?{data:{id:uid},error:null}:{data:q.table==='user_lecture_data'?[{group_id:group,classroom:'A13',details:'private details',grading_criteria:'private text',exam_date:'2026-12-01',no_lecture_date:'2026-12-02',report_rlate:0,exam_rate:70,mini_exam_rate:30,lecture_count:10,attendance_count_needed:8,memo:'secret',absence_count:2}]:q.maybeSingle?null:[],error:null}});
 h.store.set('haskapp_share_templates','true');h.store.set('haskapp_affiliation_id','00000001-0001-0001-0000-000000000000');await h.api.syncCurrentUserLectureTemplates(owner);
 const payload=h.requests.find(q=>q.operation==='insert').payload;
 for(const key of ['details','grading_criteria','exam_date','no_lecture_date'])assert.equal(payload[key],null);
 assert.equal(payload.report_rate,0);assert.equal(payload.exam_rate,70);assert.equal(payload.mini_exam_rate,30);for(const key of ['memo','absence_count','icalUrl','gpa','earned_grade'])assert.equal(key in payload,false);
});

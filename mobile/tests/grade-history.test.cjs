const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');

function setup({ rows = [], fail = false, owners = ['owner'], configured = true } = {}) {
  const queries = [];
  let reads = 0;
  const api = loadTs('src/grade-history.ts', {
    '../web-contract/lib/supabase': {
      configured,
      getCurrentUserId: async () => owners[Math.min(reads++, owners.length - 1)],
      supabase: { from(table) { queries.push(table); return { select(columns) { queries.push(columns); return { eq(field, value) { queries.push([field, value]); return Promise.resolve({ data: rows, error: fail ? { message: 'private details' } : null }); } }; } }; } },
    },
  });
  return { ...api, queries };
}
const lecture = { lecture_name: '123456 数学 演習', instructor: '佐藤 太郎' };

test('history fetch matches the Web subject lookup and returns all academic cohorts', async () => {
  const api = setup({ rows: [
    { id: 'old', subject_name: '数学', academic_term: '2024', instructor_name: '別担当', student_count: 10 },
    { id: 'new', subject_name: '数学', academic_term: '2026', instructor_name: '佐藤 太郎', lecture_title: '演習', student_count: 30 },
  ] });
  const rows = await api.fetchGradeHistory(lecture, 'owner');
  assert.deepEqual(api.queries, ['grade_distributions', api.gradeHistoryColumns, ['subject_name', '数学']]);
  assert.deepEqual(rows.map(x => x.id), ['new', 'old']);
  assert.equal(rows[0].preferred, true);
  assert.equal(rows[1].preferred, false);
});

test('history preserves zero/null and distinct eleven grade buckets without fabricated metrics', () => {
  const api = setup();
  const row = api.mapGradeHistory([{ id: 'zero', academic_term: '2026', gpa: 0, student_count: 0, aplus_percent: 0, a_percent: null, dminus_percent: 8, f_percent: 9 }], lecture)[0];
  assert.equal(row.gpa, 0); assert.equal(row.enrollment, 0);
  assert.equal(row.distribution.length, 11);
  assert.equal(row.distribution[0], 0); assert.equal(row.distribution[1], null);
  assert.equal(row.distribution[9], 8); assert.equal(row.distribution[10], 9);
  assert.equal(row.faculty, null); assert.equal(row.instructor, null);
});

test('preferred history follows instructor/subtitle match instead of inventing a current-year cohort', () => {
  const api = setup();
  const rows = api.mapGradeHistory([
    { id: 'new', academic_term: '2026', instructor_name: '別担当', lecture_title: '基礎', student_count: 1 },
    { id: 'match', academic_term: '2023', instructor_name: '佐藤', lecture_title: '演習', student_count: 1 },
  ], lecture);
  assert.equal(rows.find(x => x.preferred).id, 'match');
});

test('a stale owner is rejected before querying and an owner switch cannot publish fetched history', async () => {
  const stale = setup({ owners: ['different'] });
  await assert.rejects(stale.fetchGradeHistory(lecture, 'owner'), /アカウント/);
  assert.deepEqual(stale.queries, []);
  const switched = setup({ owners: ['owner', 'different'] });
  await assert.rejects(switched.fetchGradeHistory(lecture, 'owner'), /アカウント/);
});

test('unconfigured tests make no request and failed queries do not fabricate empty successful history', async () => {
  const disabled = setup({ configured: false });
  await assert.rejects(disabled.fetchGradeHistory(lecture, 'owner'), /接続設定/);
  assert.deepEqual(disabled.queries, []);
  await assert.rejects(setup({ fail: true }).fetchGradeHistory(lecture, 'owner'), /取得できません/);
});


test('historical provenance is explicit, nullable, and never identifies a private creator', () => {
  const api = setup();
  const row = api.mapGradeHistory([{ id: 'historical', academic_term: '2024', subject_name: '数学', course_program: '学部', class_code: '3', data_type: '集計', user_id: 'private-creator', instructor_name: '佐藤', lecture_title: '演習' }], lecture)[0];
  assert.equal(row.subjectName, '数学');
  assert.equal(row.courseProgram, '学部');
  assert.equal(row.classCode, '3');
  assert.equal(row.dataType, '集計');
  assert.equal(row.matchKind, 'instructor-and-title');
  assert.equal(row.source, 'grade_distributions');
  assert.ok(!JSON.stringify(row).includes('private-creator'));
  assert.ok(!api.gradeHistoryColumns.split(',').includes('user_id'));
  assert.notEqual(api.gradeHistoryContext(lecture), api.gradeHistoryContext({ ...lecture, instructor: '別担当' }));
});

test('invalid historical values remain unknown and preferred matching stays an explicit hint', () => {
  const api = setup();
  const row = api.mapGradeHistory([{ id: 'bad', academic_term: '', student_count: -3, gpa: -1, aplus_percent: 101, a_percent: -1, aminus_percent: '0', bplus_percent: ' ' }], lecture)[0];
  assert.equal(row.academicTerm, '');
  assert.equal(row.enrollment, null);
  assert.equal(row.gpa, null);
  assert.deepEqual(row.distribution.slice(0, 4), [null, null, 0, null]);
  assert.equal(row.matchKind, 'subject');
  assert.equal(row.preferred, true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const group = '22222222-2222-4222-8222-222222222222';
const affiliation = '00000001-0001-0003-0000-000000000000';
const owner = 'owner-a';
const lecture = { id: 'lecture-a', lecture_list_id: group, lecture_name: '数学', instructor: '教員' };
const now = '2026-10-05T04:00:00.000Z';
function setup({ rows = [], owners = [owner], configured = true, fail = false } = {}) {
  const calls = [];
  let reads = 0;
  const query = { select: value => { calls.push(['select', value]); return query; }, eq: (field, value) => { calls.push(['eq', field, value]); return query; }, order: (...args) => { calls.push(['order', ...args]); return query; }, limit: count => { calls.push(['limit', count]); return Promise.resolve({ data: rows, error: fail ? { message: 'private server details' } : null }); } };
  const api = loadTs('src/lecture-insights.ts', { '../web-contract/lib/supabase': { configured, getCurrentUserId: async () => owners[Math.min(reads++, owners.length - 1)], supabase: { from: table => { calls.push(['from', table]); return query; } } } });
  return { ...api, calls };
}
function raw(extra = {}) { return { id: 'template-a', user_id: 'private-creator-id', group_id: group, affiliation_id: affiliation, created_at: '2026-08-18T06:40:32Z', report_rate: 0, exam_rate: 80, mini_exam_rate: null, attendance_count_needed: 10, lecture_count: 15, grading_criteria: 'シラバスで確認', ...extra }; }
function preview(api, current = lecture, records = [raw()]) { return api.buildTemplateSuggestionPreview(current, api.mapTemplateLectureEvidence(records), owner, affiliation, now); }

test('evidence mapping preserves zero and absence, excludes personal grades and source creator from preview', () => {
  const api = setup();
  const mapped = api.mapTemplateLectureEvidence([raw({ details: '共有の講義詳細', memo: 'private memo', grading_memo: 'private grading memo', academic_term: 'invented' })]);
  assert.equal(mapped[0].creatorId, 'private-creator-id');
  assert.equal(mapped[0].values.grading_report, 0);
  assert.equal(mapped[0].values.grading_quiz, undefined);
  assert.equal(mapped[0].values.lecture_details, '共有の講義詳細');
  assert.equal(mapped[0].values.memo, undefined);
  const proposal = api.buildTemplateSuggestionPreview(lecture, mapped, owner, affiliation, now);
  assert.ok(!JSON.stringify(proposal).includes('private-creator-id'));
  assert.ok(!JSON.stringify(proposal).includes('invented'));
  assert.match(proposal.warning, /対象年度は不明/);
  assert.equal(proposal.fields.find(row => row.key === 'grading_report').sourceCreatedAt, '2026-08-18T06:40:32.000Z');
});

test('invalid, missing, infinite, out-of-range or fractional count values cannot become facts', () => {
  const api = setup();
  const records = api.mapTemplateLectureEvidence([raw({ report_rate: -1, exam_rate: 101, mini_exam_rate: Infinity, lecture_count: 2.5, attendance_count_needed: '', grading_criteria: ' ', classroom: true })]);
  assert.deepEqual(records[0].values, {});
  assert.equal(api.buildTemplateSuggestionPreview(lecture, records, owner, affiliation), null);
});

test('fetch is read-only, exact group/affiliation bounded, stable ordered and owner guarded', async () => {
  const api = setup({ rows: [raw(), raw({ id: 'wrong-group', group_id: 'another' }), raw({ id: 'wrong-affiliation', affiliation_id: 'another' })] });
  const rows = await api.fetchTemplateLectureEvidence(group, affiliation, owner);
  assert.equal(rows.length, 1);
  assert.deepEqual(api.calls.filter(row => row[0] === 'eq'), [['eq', 'group_id', group], ['eq', 'affiliation_id', affiliation]]);
  assert.deepEqual(api.calls.at(-1), ['limit', 100]);
  assert.ok(!api.calls.some(row => /insert|upsert|update/.test(row[0])));
  const stale = setup({ owners: ['owner-b'] });
  await assert.rejects(stale.fetchTemplateLectureEvidence(group, affiliation, owner), /アカウント/);
  assert.deepEqual(stale.calls, []);
  const switched = setup({ owners: [owner, 'owner-b'] });
  await assert.rejects(switched.fetchTemplateLectureEvidence(group, affiliation, owner), /アカウント/);
});

test('missing canonical mapping never falls back to name lookup and failures remain failures', async () => {
  const api = setup();
  assert.deepEqual(await api.fetchTemplateLectureEvidence('', affiliation, owner), []);
  assert.deepEqual(await api.fetchTemplateLectureEvidence('00000000-0000-0000-0000-000000000000', affiliation, owner), []);
  assert.equal(preview(api, { ...lecture, lecture_list_id: undefined }), null);
  assert.deepEqual(api.calls, []);
  await assert.rejects(api.fetchTemplateLectureEvidence('not-a-group-id', affiliation, owner), /講義グループ/);
  await assert.rejects(setup({ configured: false }).fetchTemplateLectureEvidence(group, affiliation, owner), /接続設定/);
  await assert.rejects(setup({ fail: true }).fetchTemplateLectureEvidence(group, affiliation, owner), /取得できません/);
});

test('preview picks one coherent record deterministically and reports disagreement', () => {
  const api = setup();
  const records = [raw({ id: 'a', report_rate: 20, mini_exam_rate: 0, classroom: null }), raw({ id: 'b', report_rate: 40, exam_rate: null, mini_exam_rate: null, classroom: 'not mixed in', created_at: '2026-10-01' })];
  const a = preview(api, lecture, records), b = preview(api, lecture, [...records].reverse());
  assert.equal(a.id, b.id);
  assert.deepEqual(a.fields, b.fields);
  assert.ok(a.fields.every(row => row.sourceTemplateId === 'a'));
  assert.ok(!a.fields.some(row => row.key === 'classroom'));
  assert.equal(a.fields.find(row => row.key === 'grading_report').conflictCount, 1);
  const ties = [raw({ id: 'z' }), raw({ id: 'a' })];
  assert.equal(preview(api, lecture, ties).fields[0].sourceTemplateId, 'a');
});

test('existing text and zero remain ineligible; selected empty fields alone become a patch', () => {
  const api = setup();
  const current = { ...lecture, grading_report: 0, memo: 'personal', grading_memo: 'personal criterion', classroom: 'mine' };
  const p = preview(api, current, [raw({ classroom: 'shared' })]);
  for (const key of ['grading_report', 'grading_criteria', 'classroom']) assert.equal(p.fields.find(row => row.key === key).eligible, false);
  const patch = api.applyTemplateSuggestion(p, current, ['grading_test'], owner, affiliation);
  assert.deepEqual(patch, { grading_test: 80 });
  assert.equal(current.grading_test, undefined);
  assert.equal(current.memo, 'personal');
  assert.throws(() => api.applyTemplateSuggestion(p, current, [], owner, affiliation), /選んで/);
  assert.throws(() => api.applyTemplateSuggestion(p, current, ['memo'], owner, affiliation), /選択できない/);
  assert.throws(() => api.applyTemplateSuggestion(p, current, ['grading_report'], owner, affiliation), /選択できない/);
});

test('stale preview cannot overwrite later edits including the grading-memo alias', () => {
  const api = setup(), p = preview(api);
  assert.throws(() => api.applyTemplateSuggestion(p, { ...lecture, grading_test: 0 }, ['grading_test'], owner, affiliation), /変更/);
  assert.throws(() => api.applyTemplateSuggestion(p, { ...lecture, grading_memo: 'just typed' }, ['grading_criteria'], owner, affiliation), /変更/);
  assert.deepEqual(api.applyTemplateSuggestion(p, { ...lecture, memo: 'unrelated edit' }, ['grading_test'], owner, affiliation), { grading_test: 80 });
  assert.throws(() => api.applyTemplateSuggestion(p, lecture, ['grading_test'], 'owner-b', affiliation), /アカウント/);
  assert.throws(() => api.applyTemplateSuggestion(p, { ...lecture, lecture_list_id: 'changed' }, ['grading_test'], owner, affiliation), /講義または所属/);
  assert.throws(() => api.applyTemplateSuggestion(p, lecture, ['grading_test'], owner, 'changed'), /講義または所属/);
});

test('selected patch checks combined rates and attendance against existing values', () => {
  const api = setup();
  const rates = { ...lecture, grading_report: 30 };
  assert.throws(() => api.applyTemplateSuggestion(preview(api, rates), rates, ['grading_test'], owner, affiliation), /100%/);
  const attendance = { ...lecture, grading_attendance_total: 8 };
  assert.throws(() => api.applyTemplateSuggestion(preview(api, attendance), attendance, ['grading_attendance_required'], owner, affiliation), /講義回数/);
});

test('cache is owner- and context-scoped, isolated, dated, stale and never a cross-account fallback', () => {
  const api = setup();
  const context = api.templateEvidenceContext(group, affiliation);
  const value = [raw()];
  const cache = api.makeInsightCache(owner, context, value, now);
  value[0].id = 'mutated';
  assert.equal(cache.value[0].id, 'template-a');
  assert.notEqual(api.insightCacheKey('templates', owner, context), api.insightCacheKey('templates', 'owner-b', context));
  assert.equal(api.readInsightCache(cache, 'owner-b', context), null);
  assert.equal(api.readInsightCache(cache, owner, 'other-context'), null);
  assert.equal(api.readInsightCache({ ...cache, fetchedAt: 'broken' }, owner, context), null);
  assert.equal(api.readInsightCache(cache, owner, context, Date.parse(now) - 1), null);
  assert.equal(api.readInsightCache(cache, owner, context, Date.parse(now) + 1000).stale, false);
  const old = api.readInsightCache(cache, owner, context, Date.parse(now) + 86400000);
  assert.equal(old.stale, true);
  old.value[0].id = 'another mutation';
  assert.equal(cache.value[0].id, 'template-a');
  assert.equal(api.readInsightCache({ ...cache, version: 2 }, owner, context), null);
});


test('template smallint assessment weights reject fractional numbers instead of rounding', () => {
  const api = setup();
  const p = preview(api, lecture, [raw({ report_rate: 12.5, exam_rate: 70, mini_exam_rate: '17.5' })]);
  assert.ok(!p.fields.some(field => field.key === 'grading_report' || field.key === 'grading_quiz'));
  assert.deepEqual(api.applyTemplateSuggestion(p, lecture, ['grading_test'], owner, affiliation), { grading_test: 70 });
});

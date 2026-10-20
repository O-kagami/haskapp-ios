const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');

const group = '55555555-5555-4555-8555-555555555555';
const affiliation = '00000001-0001-0001-0000-000000000000';
const lecture = () => ({ id: 'lecture-1', lecture_list_id: group, lecture_name: '数学', instructor: '先生', day_of_the_week: 1, period: 1, colorTheme: 'teal', grading_report: 0 });
const evidence = () => [{ templateId: 'template-1', creatorId: 'public-creator', groupId: group, affiliationId: affiliation, createdAt: '2026-09-01T00:00:00Z', values: { grading_report: 50, grading_test: 40, grading_quiz: 0, grading_criteria: '共有の基準', classroom: 'A101' } }];
const grade = () => ({ id: 'cohort-1', academicTerm: '2025年度 １学期', preferred: true, distribution: [0, 20, 30, 20, 10, 10, 5, 5, 0, 0, null], gpa: 0, enrollment: 0 });
const empty = () => ({ gradeHistory: {}, gradeHistoryStatus: {}, templateSuggestions: {} });

function setup(options = {}) {
  let owner = 'owner-A'; let selectedAffiliation = affiliation; let currentLecture = lecture(); let state = empty();
  const calls = []; const store = options.store ?? new Map(); const hooks = {};
  const backend = { configured: true, getCurrentUserId: async () => owner, supabase: { from() { throw Error('Unexpected live request'); } } };
  const insights = loadTs('src/lecture-insights.ts', { '../web-contract/lib/supabase': backend });
  const history = loadTs('src/grade-history.ts', { '../web-contract/lib/supabase': backend });
  const { LectureDetailResources, verifiedSuggestionAffiliation } = loadTs('src/lecture-detail-resources.ts', {
    './lecture-insights': { ...insights, fetchTemplateLectureEvidence: async (...args) => { calls.push(['templates', ...args]); return hooks.templates ? await hooks.templates() : evidence(); } },
    './grade-history': { ...history, fetchGradeHistory: async (...args) => { calls.push(['history', ...args]); return hooks.history ? await hooks.history() : [grade()]; } },
    '../web-contract/lib/api/offline-sync': { getLocal: key => store.get(key) ?? null, setLocal: (key, value) => store.set(key, JSON.parse(JSON.stringify(value))) },
  });
  const resource = new LectureDetailResources({
    state: () => state, owner: () => owner,
    assertOwner: async expected => { if(hooks.assertOwner)await hooks.assertOwner(); if (expected !== owner) throw Error('Account owner changed'); },
    lecture: id => currentLecture?.id === id ? currentLecture : undefined,
    historyLecture: id => id === 'official-2026-course' ? { id, lecture_name: '数学', instructor: '資料の担当教員' } : currentLecture?.id === id ? currentLecture : undefined,
    affiliation: () => selectedAffiliation, publish: () => resource.reconcile(),
  });
  return { resource, calls, store, hooks, insights, verifiedSuggestionAffiliation, state: () => state, lecture: () => currentLecture,
    setLecture: value => { currentLecture = value; }, setAffiliation: value => { selectedAffiliation = value; },
    switchOwner: value => { owner = value; state = empty(); } };
}

test('template preview is read-only and explicit application preserves existing zero and unselected fields', async () => {
  const r = setup(); const before = { ...r.lecture() };
  await r.resource.suggestions('lecture-1', 'owner-A');
  const preview = r.state().templateSuggestions['lecture-1'].proposal;
  assert.deepEqual(r.lecture(), before);
  assert.equal(preview.fields.find(x => x.key === 'grading_report').eligible, false);
  const patched = await r.resource.approvedPatch('lecture-1', preview.id, ['grading_quiz', 'classroom'], 'owner-A');
  assert.equal(patched.grading_report, undefined); assert.equal(patched.grading_quiz, 0); assert.equal(patched.classroom, 'A101');
  assert.equal(patched.grading_test, undefined); assert.deepEqual(r.lecture(), before);
  assert.equal(r.calls.filter(x => x[0] === 'templates').length, 1);
});

test('empty, forged, or existing-value selections cannot save', async () => {
  const r = setup(); await r.resource.suggestions('lecture-1', 'owner-A'); const id = r.state().templateSuggestions['lecture-1'].proposal.id;
  for (const fields of [[], ['grading_report'], ['memo'], ['not-a-field']]) await assert.rejects(r.resource.approvedPatch('lecture-1', id, fields, 'owner-A'));
  await assert.rejects(r.resource.approvedPatch('lecture-1', 'stale-id', ['grading_test'], 'owner-A'));
  assert.equal(r.lecture().grading_test, undefined);
});

test('user edits made after preview cannot be overwritten', async () => {
  const r = setup(); await r.resource.suggestions('lecture-1', 'owner-A'); const id = r.state().templateSuggestions['lecture-1'].proposal.id;
  r.setLecture({ ...r.lecture(), grading_test: 0 });
  await assert.rejects(r.resource.approvedPatch('lecture-1', id, ['grading_test'], 'owner-A'), /変更/);
  r.resource.reconcile(); assert.equal(r.state().templateSuggestions['lecture-1'], undefined); assert.equal(r.lecture().grading_test, 0);
});

test('saved evidence can produce an explicit offline preview after restart without mutating the lecture', async () => {
  const first = setup(); await first.resource.suggestions('lecture-1', 'owner-A');
  const restarted = setup({ store: first.store }); restarted.hooks.templates = async () => { throw Error('offline'); };
  await restarted.resource.suggestions('lecture-1', 'owner-A');
  const result = restarted.state().templateSuggestions['lecture-1'];
  assert.equal(result.source, 'cache'); assert.equal(result.stale, true); assert.equal(result.status, 'error'); assert.ok(result.proposal);
  assert.equal(restarted.lecture().grading_test, undefined);
  const patch = await restarted.resource.approvedPatch('lecture-1', result.proposal.id, ['grading_test'], 'owner-A');
  assert.equal(patch.grading_test, 40);
});

test('template cache and proposals cannot cross account or affiliation boundaries', async () => {
  const r = setup(); await r.resource.suggestions('lecture-1', 'owner-A'); const id = r.state().templateSuggestions['lecture-1'].proposal.id;
  r.setAffiliation('00000001-0001-0002-0000-000000000000');
  await assert.rejects(r.resource.approvedPatch('lecture-1', id, ['grading_test'], 'owner-A'), /所属/);
  r.resource.reconcile(); assert.equal(r.state().templateSuggestions['lecture-1'], undefined);
  r.switchOwner('owner-B'); r.hooks.templates = async () => { throw Error('offline'); };
  await r.resource.suggestions('lecture-1', 'owner-B'); assert.equal(r.state().templateSuggestions['lecture-1'].proposal, undefined);
});

test('unknown affiliation never falls back to an arbitrary course or performs a template query', async () => {
  const r = setup(); assert.equal(r.verifiedSuggestionAffiliation('', ''), null);
  assert.equal(r.verifiedSuggestionAffiliation('別の学部', '情報理工学コース'), null);
  assert.equal(r.verifiedSuggestionAffiliation('工学部', '情報理工学コース'), affiliation);
  r.setAffiliation(null); await r.resource.suggestions('lecture-1', 'owner-A');
  assert.equal(r.calls.length, 0); assert.match(r.state().templateSuggestions['lecture-1'].error, /学部とコース/);
});

test('history persists zero/null and returns explicitly marked cached data when offline after restart', async () => {
  const first = setup(); await first.resource.history('lecture-1', 'owner-A');
  const restarted = setup({ store: first.store }); restarted.hooks.history = async () => { throw Error('offline'); };
  await restarted.resource.history('lecture-1', 'owner-A');
  assert.equal(restarted.state().gradeHistory['lecture-1'][0].gpa, 0);
  assert.equal(restarted.state().gradeHistory['lecture-1'][0].distribution[10], null);
  assert.equal(restarted.state().gradeHistoryStatus['lecture-1'].source, 'cache');
  assert.equal(restarted.state().gradeHistoryStatus['lecture-1'].stale, true);
  assert.ok(restarted.state().gradeHistoryStatus['lecture-1'].fetchedAt);
});

test('late history from a previous account cannot update the new account or its cache', async () => {
  const r = setup(); r.hooks.history = async () => { r.switchOwner('owner-B'); return [grade()]; };
  await assert.rejects(r.resource.history('lecture-1', 'owner-A'), /owner changed/);
  assert.deepEqual(r.state(), empty()); assert.equal(r.store.size, 0);
});

test('changing lecture identity invalidates visible historical data instead of relabeling it', async () => {
  const r = setup(); await r.resource.history('lecture-1', 'owner-A');
  r.setLecture({ ...r.lecture(), lecture_name: '別の科目' }); r.resource.reconcile();
  assert.equal(r.state().gradeHistory['lecture-1'], undefined); assert.equal(r.state().gradeHistoryStatus['lecture-1'], undefined);
});

test('late history is discarded when the lecture changes while the request is in flight', async () => {
  const r = setup(); r.hooks.history = async () => { r.setLecture({ ...r.lecture(), instructor: '別の先生' }); return [grade()]; };
  await r.resource.history('lecture-1', 'owner-A'); assert.equal(r.state().gradeHistory['lecture-1'], undefined); assert.equal(r.store.size, 0);
});

test('official PDF history uses only its exact catalog reference and never gains a shared-course link', async () => {
  const r = setup(); await r.resource.history('official-2026-course', 'owner-A');
  const reference = r.calls.find(x => x[0] === 'history')[1];
  assert.equal(reference.id, 'official-2026-course'); assert.equal(reference.lecture_name, '数学'); assert.equal(reference.lecture_list_id, undefined);
  assert.ok(r.state().gradeHistory['official-2026-course']);
  await assert.rejects(r.resource.suggestions('official-2026-course', 'owner-A'), /講義が見つかりません/);
});

test('a malformed cached row is ignored instead of breaking the native snapshot decoder', async () => {
  const r = setup(); await r.resource.history('lecture-1', 'owner-A');
  for (const [key, value] of r.store) r.store.set(key, { ...value, value: [null] });
  const restarted = setup({ store: r.store }); restarted.hooks.history = async () => { throw Error('offline'); };
  await restarted.resource.history('lecture-1', 'owner-A');
  assert.equal(restarted.state().gradeHistory['lecture-1'], undefined); assert.equal(restarted.state().gradeHistoryStatus['lecture-1'].source, 'live');
});

test('every proposal reload carries its exact completion token even for repeated immediate errors', async () => {
 const r=setup();r.setAffiliation(null);
 await r.resource.suggestions('lecture-1','owner-A','request-1');
 assert.equal(r.state().templateSuggestions['lecture-1'].requestId,'request-1');assert.equal(r.state().templateSuggestions['lecture-1'].status,'error');
 await r.resource.suggestions('lecture-1','owner-A','request-2');
 assert.equal(r.state().templateSuggestions['lecture-1'].requestId,'request-2');assert.equal(r.calls.length,0);
 r.setAffiliation(affiliation);await r.resource.suggestions('lecture-1','owner-A','request-3');
 assert.equal(r.state().templateSuggestions['lecture-1'].requestId,'request-3');assert.equal(r.state().templateSuggestions['lecture-1'].status,'ready');
 r.hooks.templates=async()=>{throw Error('offline')};await r.resource.suggestions('lecture-1','owner-A','request-4');
 assert.equal(r.state().templateSuggestions['lecture-1'].requestId,'request-4');assert.equal(r.state().templateSuggestions['lecture-1'].status,'error');assert.ok(r.state().templateSuggestions['lecture-1'].proposal);
});


test('a pre-loading auth transport failure still completes the matching request without exposing cached evidence', async () => {
 const r=setup();r.hooks.assertOwner=async()=>{throw Error('temporary auth transport failure')};
 await assert.rejects(r.resource.suggestions('lecture-1','owner-A','failed-before-load'));
 const state=r.state().templateSuggestions['lecture-1'];assert.equal(state.requestId,'failed-before-load');assert.equal(state.status,'error');assert.equal(state.proposal,undefined);assert.equal(r.calls.length,0);
});

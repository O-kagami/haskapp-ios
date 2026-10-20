const test = require('node:test');
const assert = require('node:assert/strict');
const { apiHarness } = require('./helpers/api-harness.cjs');
const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '99999999-9999-4999-8999-999999999999';
const enrollment = '22222222-2222-4222-8222-222222222222';
const group = '33333333-3333-4333-8333-333333333333';
const id = `${enrollment}_44444444-4444-4444-8444-444444444444`;
const key = `haskapp_classes_${owner}`;
const lecture = (extra = {}) => ({ id, lecture_list_id: group, lecture_name: '数学', instructor: '教員', day_of_the_week: 1, period: 1, colorTheme: 'teal', memo: 'local memo', absences: 3, ...extra });
function setup(t, options = {}) {
  let server = { id: enrollment, group_id: group, user_id: owner, classroom: null, details: null, grading_criteria: null, attendance_count_needed: null, lecture_count: null, report_rlate: null, exam_rate: null, mini_exam_rate: null, memo: 'newer server memo', absence_count: 8, ...options.server };
  let beforeUpdate = options.beforeUpdate;
  const h = apiHarness(t, 'lib/api/lectures.ts', {
    owner: options.owner ?? owner, online: options.online ?? true,
    beforeOwnerRead: async count => { if (options.beforeOwnerRead) await options.beforeOwnerRead(count, h); },
    respond: async request => {
      assert.equal(request.table, 'user_lecture_data');
      if (request.operation === 'select') {
        if (options.beforeSelect) await options.beforeSelect(h);
        const data = { ...server };
        if (options.afterRead) await options.afterRead(h);
        return { data: request.filters.every(([column, value]) => server[column] === value) ? data : null, error: null };
      }
      assert.equal(request.operation, 'update');
      if (beforeUpdate) { const fn = beforeUpdate; beforeUpdate = undefined; await fn(server, h); }
      if (!request.filters.every(([column, value]) => server[column] === value)) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      server = { ...server, ...request.payload };
      if (options.afterWrite) return options.afterWrite(server, h);
      return { data: { ...server }, error: null };
    },
  });
  h.seed(key, options.classes ?? [lecture()]);
  return { ...h, server: () => server };
}

test('selected-field save updates only approved DB columns and leaves unrelated server values alone', async t => {
  const h = setup(t);
  const saved = await h.api.lecturesApi.applyLectureFields(id, { grading_report: 0, grading_test: 80 }, [lecture()], owner);
  const update = h.requests.find(row => row.operation === 'update');
  assert.deepEqual(update.payload, { report_rlate: 0, exam_rate: 80 });
  assert.ok(update.filters.some(([column, value]) => column === 'id' && value === enrollment));
  assert.ok(update.filters.some(([column, value]) => column === 'user_id' && value === owner));
  assert.ok(update.filters.some(([column, value]) => column === 'group_id' && value === group));
  assert.deepEqual(update.isFilters, [['report_rlate', null], ['exam_rate', null], ['mini_exam_rate', null]]);
  assert.equal(h.server().memo, 'newer server memo');
  assert.equal(h.server().absence_count, 8);
  assert.equal(saved.memo, 'local memo');
  assert.equal(saved.absences, 3);
  assert.equal(saved.grading_report, 0);
  assert.equal(saved.grading_test, 80);
});

test('nonblank server values, including zero, conflict rather than being overwritten', async t => {
  for (const server of [{ classroom: 'manual room' }, { report_rlate: 0 }]) await t.test(JSON.stringify(server), async t => {
    const h = setup(t, { server });
    const patch = 'classroom' in server ? { classroom: 'suggested room' } : { grading_report: 25 };
    await assert.rejects(h.api.lecturesApi.applyLectureFields(id, patch, [lecture()], owner), /変更/);
    assert.equal(h.requests.filter(row => row.operation === 'update').length, 0);
    assert.deepEqual(h.cache(key), [lecture()]);
  });
});

test('already-exact targets, including zero, are idempotent and need no update', async t => {
  const h = setup(t, { server: { report_rlate: 0, classroom: 'room' } });
  const saved = await h.api.lecturesApi.applyLectureFields(id, { grading_report: 0, classroom: 'room' }, [lecture()], owner);
  assert.equal(h.requests.filter(row => row.operation === 'update').length, 0);
  assert.equal(saved.grading_report, 0);
  assert.equal(saved.classroom, 'room');
});

test('whitespace blanks use an exact CAS value and only changed fields enter the payload', async t => {
  const h = setup(t, { server: { classroom: '  ', exam_rate: 80 } });
  await h.api.lecturesApi.applyLectureFields(id, { classroom: 'room', grading_test: 80 }, [lecture()], owner);
  const update = h.requests.find(row => row.operation === 'update');
  assert.deepEqual(update.payload, { classroom: 'room' });
  assert.ok(update.filters.some(([column, value]) => column === 'classroom' && value === '  '));
  assert.ok(update.filters.some(([column, value]) => column === 'exam_rate' && value === 80));
});

test('a concurrent selected-column edit loses CAS without overwriting that edit or acknowledging success', async t => {
  const h = setup(t, { beforeUpdate: server => { server.exam_rate = 45; } });
  await assert.rejects(h.api.lecturesApi.applyLectureFields(id, { grading_test: 80 }, [lecture()], owner), /変更/);
  assert.equal(h.server().exam_rate, 45);
  assert.equal(h.cache(key)[0].grading_test, undefined);
});

test('a concurrent related percentage edit also loses CAS instead of making total invalid', async t => {
  const h = setup(t, { beforeUpdate: server => { server.report_rlate = 40; } });
  await assert.rejects(h.api.lecturesApi.applyLectureFields(id, { grading_test: 80 }, [lecture()], owner), /変更/);
  assert.equal(h.server().exam_rate, null);
  assert.equal(h.server().report_rlate, 40);
});

test('a lost write response can retry exact targets without duplicating or overwriting anything', async t => {
  let lost = true;
  const h = setup(t, { afterWrite: server => lost ? (lost = false, { data: null, error: { message: 'Failed to fetch' } }) : { data: server, error: null } });
  await h.api.lecturesApi.applyLectureFields(id, { classroom: 'room' }, [lecture()], owner);
  assert.equal(h.server().classroom, 'room');
  assert.equal(h.cache(key)[0].classroom, 'room');
  h.setOnline(true);
  await h.api.lecturesApi.applyLectureFields(id, { classroom: 'room' }, h.cache(key), owner);
  assert.equal(h.requests.filter(row => row.operation === 'update').length, 1);
  assert.equal(h.server().memo, 'newer server memo');
});

test('owner switches before the write or after its response never publish into either account cache', async t => {
  for (const switchRead of [1, 2, 3]) await t.test(`owner read ${switchRead}`, async t => {
    const h = setup(t, { beforeOwnerRead: (count, h) => { if (count === switchRead) h.setOwner(otherOwner); } });
    h.seed(`haskapp_classes_${otherOwner}`, ['other private row']);
    await assert.rejects(h.api.lecturesApi.applyLectureFields(id, { classroom: 'room' }, [lecture()], owner), /アカウント/);
    assert.deepEqual(h.cache(key), [lecture()]);
    assert.deepEqual(h.cache(`haskapp_classes_${otherOwner}`), ['other private row']);
    if (switchRead < 3) assert.equal(h.requests.filter(row => row.operation === 'update').length, 0);
  });
});

test('latest local unrelated and later selected edits survive an in-flight successful response', async t => {
  const h = setup(t, { beforeUpdate: (_, h) => h.seed(key, [lecture({ memo: 'typed during request', classroom: 'later local room' })]) });
  const saved = await h.api.lecturesApi.applyLectureFields(id, { classroom: 'reviewed room' }, [lecture()], owner);
  assert.equal(h.server().classroom, 'reviewed room');
  assert.equal(saved.memo, 'typed during request');
  assert.equal(saved.classroom, 'later local room');
});

test('criteria aliases map to one DB column and never modify personal lecture memo', async t => {
  const h = setup(t);
  const saved = await h.api.lecturesApi.applyLectureFields(id, { grading_criteria: 'shared criteria' }, [lecture()], owner);
  assert.deepEqual(h.requests.find(row => row.operation === 'update').payload, { grading_criteria: 'shared criteria' });
  assert.equal(saved.grading_criteria, 'shared criteria');
  assert.equal(saved.grading_memo, 'shared criteria');
  assert.equal(saved.memo, 'local memo');
  await assert.rejects(h.api.lecturesApi.applyLectureFields(id, { grading_criteria: 'one', grading_memo: 'two' }, [lecture()], owner), /一致/);
});

test('offline selected patches update siblings only and keep unrelated fields and lecture records', async t => {
  const sibling = lecture({ id: `${enrollment}_55555555-5555-4555-8555-555555555555`, day_of_the_week: 3, period: 2, memo: 'sibling memo' });
  const unrelated = lecture({ id: 'other', lecture_list_id: 'another-group', memo: 'unrelated memo' });
  const h = setup(t, { online: false, classes: [lecture(), sibling, unrelated] });
  await h.api.lecturesApi.applyLectureFields(id, { classroom: 'room', grading_report: 0 }, h.cache(key), owner);
  assert.equal(h.requests.length, 0);
  const rows = h.cache(key);
  assert.equal(rows[0].classroom, 'room'); assert.equal(rows[1].classroom, 'room');
  assert.equal(rows[1].memo, 'sibling memo'); assert.equal(rows[1].day_of_the_week, 3);
  assert.equal(rows[2].classroom, undefined); assert.equal(rows[2].memo, 'unrelated memo');
});

test('guest and offline paths reject stale nonblank local targets without writes', async t => {
  for (const userId of [owner, 'guest-ios']) await t.test(userId, async t => {
    const current = lecture({ grading_report: 0 });
    const h = setup(t, { owner: userId, online: false });
    h.seed(`haskapp_classes_${userId}`, [current]);
    await assert.rejects(h.api.lecturesApi.applyLectureFields(id, { grading_report: 20 }, [current], userId), /変更/);
    assert.deepEqual(h.cache(`haskapp_classes_${userId}`), [current]);
    assert.equal(h.requests.length, 0);
  });
});

test('invalid or unapproved fields and mismatched owned enrollment are rejected without server mutation', async t => {
  const h = setup(t);
  for (const patch of [{}, { memo: 'do not transmit' }, { absences: 0 }, { lecture_name: 'changed' }, { grading_test: 12.5 }, { grading_attendance_total: -1 }])
    await assert.rejects(h.api.lecturesApi.applyLectureFields(id, patch, [lecture()], owner));
  assert.equal(h.requests.length, 0);
  const absent = setup(t, { server: { group_id: 'other-group' } });
  await assert.rejects(absent.api.lecturesApi.applyLectureFields(id, { classroom: 'room' }, [lecture()], owner), /権限/);
  assert.equal(absent.requests.filter(row => row.operation === 'update').length, 0);
});

test('server-side companion values validate combined attendance and percentage constraints', async t => {
  const h = setup(t, { server: { report_rlate: 30, lecture_count: 8 } });
  await assert.rejects(h.api.lecturesApi.applyLectureFields(id, { grading_test: 80 }, [lecture()], owner), /100%/);
  await assert.rejects(h.api.lecturesApi.applyLectureFields(id, { grading_attendance_required: 10 }, [lecture()], owner), /講義回数/);
  assert.equal(h.requests.filter(row => row.operation === 'update').length, 0);
});


test('a newer local blank edit is also preserved instead of treated as an untouched empty field', async t => {
  const h = setup(t, { beforeUpdate: (_, h) => h.seed(key, [lecture({ classroom: '' })]) });
  const saved = await h.api.lecturesApi.applyLectureFields(id, { classroom: 'reviewed room' }, [lecture()], owner);
  assert.equal(h.server().classroom, 'reviewed room');
  assert.equal(saved.classroom, '');
});

test('prototype-property names are not approved patch fields', async t => {
  const h = setup(t);
  for (const property of ['constructor', 'toString', '__proto__']) {
    const patch = JSON.parse(`{"${property}":0}`);
    await assert.rejects(h.api.lecturesApi.applyLectureFields(id, patch, [lecture()], owner), /変更できない/);
  }
  assert.equal(h.requests.length, 0);
});

test('offline whitespace memo alias cannot hide existing assessment criteria', async t => {
 const current=lecture({grading_memo:' ',grading_criteria:'manually entered criterion'});
 const h=setup(t,{online:false,classes:[current]});
 await assert.rejects(h.api.lecturesApi.applyLectureFields(id,{grading_criteria:'template criterion'},[current],owner),/変更/);
 assert.deepEqual(h.cache(key),[current]);assert.equal(h.requests.length,0);
});

test('online completion never resurrects an enrollment removed from the latest cache', async t => {
 const h=setup(t,{beforeUpdate:(_,h)=>h.seed(key,[])});
 await h.api.lecturesApi.applyLectureFields(id,{classroom:'reviewed room'},[lecture()],owner);
 assert.equal(h.server().classroom,'reviewed room');assert.deepEqual(h.cache(key),[]);
});

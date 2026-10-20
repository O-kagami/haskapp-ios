const test = require('node:test');
const assert = require('node:assert/strict');
const { apiHarness } = require('./helpers/api-harness.cjs');
const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '99999999-9999-4999-8999-999999999999';
const id = '22222222-2222-4222-8222-222222222222';
const task = { id, task_name: 'Owner A private task', deadline: '2026-10-09', user_id: owner, status: 'todo', colorTheme: 'teal' };
const lecture = { id, lecture_name: 'Owner A private lecture', instructor: 'Teacher', day_of_the_week: 1, period: 1, colorTheme: 'teal' };
const event = { id, title: 'Owner A private event', date: '2026-10-09', colorTheme: 'teal' };
const cases = [
  ['tasks.ts', 'save task', a => a.tasksApi.saveTask(task, [task], owner)],
  ['tasks.ts', 'delete task', a => a.tasksApi.deleteTask(id, [task], owner)],
  ['tasks.ts', 'task status', a => a.tasksApi.updateTaskStatus(id, 'done', [task], owner)],
  ['tasks.ts', 'bulk tasks', a => a.tasksApi.saveAllTasks([task], owner)],
  ['tasks.ts', 'clear tasks', a => a.tasksApi.saveAllTasks([], owner)],
  ['lectures.ts', 'save lecture', a => a.lecturesApi.saveLecture(lecture, [lecture], owner)],
  ['lectures.ts', 'apply reviewed lecture fields', a => a.lecturesApi.applyLectureFields(id, { classroom: 'shared room' }, [lecture], owner)],
  ['lectures.ts', 'delete lecture', a => a.lecturesApi.deleteLecture(id, [lecture], owner)],
  ['lectures.ts', 'lecture absences', a => a.lecturesApi.updateAbsences(id, 1, [lecture], owner)],
  ['lectures.ts', 'bulk lectures', a => a.lecturesApi.saveAllLectures([lecture], owner)],
  ['lectures.ts', 'clear lectures', a => a.lecturesApi.saveAllLectures([], owner)],
  ['lectures.ts', 'setup start', a => a.lecturesApi.markSetupStarted(undefined, owner)],
  ['lectures.ts', 'setup finish', a => a.lecturesApi.markSetupDone(undefined, owner)],
  ['lectures.ts', 'template sharing', a => a.syncCurrentUserLectureTemplates(owner)],
  ['events.ts', 'event cache seed', a => a.eventsApi.fetchEvents(owner)],
  ['events.ts', 'save event', a => a.eventsApi.saveEvent(event, [event], owner)],
  ['events.ts', 'delete event', a => a.eventsApi.deleteEvent(id, [event], owner)],
  ['events.ts', 'bulk events', a => a.eventsApi.saveAllEvents([event], owner)],
  ['events.ts', 'clear events', a => a.eventsApi.saveAllEvents([], owner)],
  ['user-settings.ts', 'department', a => a.saveDepartmentAndMajorToSupabase('工学部', '数学科', owner)],
  ['user-settings.ts', 'iCal URL', a => a.saveIcalUrlToSupabase('https://calendar.example.invalid/feed.ics', owner)],
  ['user-settings.ts', 'affiliation', a => a.getOrCreateAffiliation('工学部', '数学科', owner)],
  ['user-settings.ts', 'affiliation cache', a => a.getCurrentAffiliationId(owner)],
  ['user-settings.ts', 'template rates', a => a.updateTemplateRates('工学部', '数学科', otherOwner, owner)],
  ['user-settings.ts', 'department template lookup', a => a.fetchTemplatesForDepartment('工学部', '数学科', owner)],
  ['user-settings.ts', 'suggestion lookup', a => a.fetchTemplateLectureSuggestion(id, owner)],
];

test('every mutation rejects account switches or expiry during its owner read before touching cache or DB', async t => {
  for (const nextOwner of [otherOwner, 'guest-expired']) {
    for (const [module, label, invoke] of cases) {
      await t.test(`${label}: ${nextOwner === otherOwner ? 'new account' : 'expired session'}`, async t => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const h = apiHarness(t, `lib/api/${module}`, { owner, beforeOwnerRead: () => gate });
        h.seed(`haskapp_tasks_${owner}`, [task]); h.seed(`haskapp_tasks_${nextOwner}`, ['unrelated B data']);
        h.store.set('haskapp_affiliation_id', '55555555-5555-4555-8555-555555555555');
        const original = new Map(h.store);
        const pending = invoke(h.api);
        h.setOwner(nextOwner);
        release();
        await assert.rejects(pending, { name: 'AccountOwnerChangedError' });
        assert.deepEqual(h.store, original);
        assert.equal(h.requests.length, 0);
      });
    }
  }
});

test('offline event/task/lecture mutations also reject stale owners before replacing any cache', async t => {
  for (const [module, label, invoke] of cases.filter(([module]) => ['tasks.ts','lectures.ts','events.ts'].includes(module))) {
    await t.test(label, async t => {
      const h = apiHarness(t, `lib/api/${module}`, { owner: otherOwner, online: false });
      h.seed(`haskapp_tasks_${otherOwner}`, ['B data']);
      const original = new Map(h.store);
      await assert.rejects(invoke(h.api), { name: 'AccountOwnerChangedError' });
      assert.deepEqual(h.store, original);
      assert.equal(h.requests.length, 0);
    });
  }
});

test('nested template helpers preserve the original owner and propagate owner changes instead of swallowing them', async t => {
  const nestedCases = [
    ['current affiliation', a => a.getCurrentAffiliationId(owner)],
    ['department templates', a => a.fetchTemplatesForDepartment('工学部', '数学科', owner)],
    ['template rates', a => a.updateTemplateRates('工学部', '数学科', otherOwner, owner)],
    ['suggestion', a => a.fetchTemplateLectureSuggestion(id, owner)],
  ];
  for (const [label, invoke] of nestedCases) {
    await t.test(label, async t => {
      const h = apiHarness(t, 'lib/api/user-settings.ts', { owner, beforeOwnerRead: count => { if (count === 2) h.setOwner(otherOwner); } });
      await assert.rejects(invoke(h.api), { name: 'AccountOwnerChangedError' });
      assert.equal(h.store.size, 0);
      assert.equal(h.requests.length, 0);
    });
  }
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts.cjs");

const userId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const otherTaskId = "33333333-3333-4333-8333-333333333333";
const groupId = "44444444-4444-4444-8444-444444444444";
const createdAt = "2026-09-01T12:00:00+00:00";

function makeTask(overrides = {}) {
  return {
    id: taskId,
    created_at: createdAt,
    user_id: userId,
    task_name: "Report",
    deadline: "2026-10-10",
    assigned_date: "2026-10-01",
    scheduled_date: "2026-10-05",
    status: "todo",
    progress_percent: 0,
    colorTheme: "violet",
    lecture_id: null,
    ...overrides,
  };
}

function setup(t, options = {}) {
  const owner = options.userId ?? userId;
  const key = `haskapp_tasks_${owner}`;
  const store = new Map();
  const requests = [];
  let online = options.online ?? true;
  let authReads = 0;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (name) => store.get(name) ?? null,
      setItem: (name, value) => {
        if (options.storageError) throw options.storageError;
        store.set(name, value);
      },
      removeItem: (name) => store.delete(name),
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else delete globalThis.localStorage;
  });

  const supabase = {
    from(table) {
      const query = { table, operation: "select", filters: [], single: false };
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        insert(payload) { query.operation = "insert"; query.payload = payload; return builder; },
        update(payload) { query.operation = "update"; query.payload = payload; return builder; },
        delete() { query.operation = "delete"; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        single() { query.single = true; return builder; },
        then(resolve, reject) {
          requests.push(query);
          return Promise.resolve().then(() => options.respond ? options.respond(query) : ({
            data: query.operation === "select" ? [] : {
              id: query.filters.find(([column]) => column === "id")?.[1] ?? taskId,
              created_at: createdAt,
            },
            error: null,
          })).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const { tasksApi } = loadTs("lib/api/tasks.ts", {
    "@/lib/supabase": {
      supabase,
      getCurrentUserId: async () => { authReads++; return owner; },
      getSupabaseStatus: () => online,
      setSupabaseOffline: () => { online = false; },
    },
  });
  return {
    tasksApi, requests, store, key,
    cache: () => JSON.parse(store.get(key) ?? "null"),
    seed: (tasks) => store.set(key, JSON.stringify(tasks)),
    authReads: () => authReads,
  };
}

test("fetch restores date-only form fields and planned calendar entries, then save retains them", async (t) => {
  const row = {
    id: taskId, created_at: createdAt, user_id: userId, group_id: groupId,
    name: "Report", details: "Read chapter 2", progress_percent: 50,
    period_start_daytime: "2026-10-01T00:00:00+00:00",
    work_start_daytime: "2026-10-05T00:00:00+00:00",
    period_end_daytime: "2026-10-10T00:00:00+00:00",
    work_interval_estimated: "01:00:00",
  };
  const h = setup(t, { respond: (query) => ({
    data: query.operation === "select" ? [row] : { id: taskId, created_at: createdAt },
    error: null,
  }) });
  h.store.set(`haskapp_classes_${userId}`, JSON.stringify([{ lecture_list_id: groupId, colorTheme: "teal" }]));
  const [task] = await h.tasksApi.fetchTasks();
  assert.equal(task.assigned_date, "2026-10-01");
  assert.equal(task.scheduled_date, "2026-10-05");
  assert.equal(task.deadline, "2026-10-10");
  assert.equal(task.start_at, row.period_start_daytime);
  assert.equal(task.scheduled_start_at, row.work_start_daytime);
  assert.equal(task.status, "inProgress");
  assert.equal(task.colorTheme, "teal");

  const { buildFullCalendarEvents } = loadTs("lib/calendar-events.ts");
  const events = buildFullCalendarEvents([], [task]);
  assert.equal(events.length, 2);
  assert.equal(events.find((event) => event.id.startsWith("task-scheduled-")).start, "2026-10-05");

  const saved = await h.tasksApi.saveTask({ ...task, status: "done" }, [task]);
  const write = h.requests[1];
  assert.equal(write.payload.period_start_daytime, row.period_start_daytime);
  assert.equal(write.payload.work_start_daytime, row.work_start_daytime);
  assert.equal(write.payload.period_end_daytime, row.period_end_daytime);
  assert.equal(write.payload.progress_percent, 100);
  assert.equal(saved.created_at, createdAt);
  assert.equal(write.single, true);
  assert.deepEqual(write.filters, [["id", taskId], ["user_id", userId]]);
});

test("fetch keeps absent optional dates null instead of inventing today's date", async (t) => {
  const h = setup(t, { respond: () => ({ data: [{
    id: taskId, created_at: createdAt, user_id: userId,
    group_id: null, name: "Unlinked", progress_percent: 0,
  }], error: null }) });
  const [task] = await h.tasksApi.fetchTasks();
  assert.equal(task.assigned_date, null);
  assert.equal(task.scheduled_date, null);
  assert.equal(task.deadline, "");
  assert.equal(task.lecture_id, null);
});

test("unlinked inserts preserve optional UI behavior and use the database's creation timestamp", async (t) => {
  const h = setup(t);
  const data = makeTask({ id: undefined, status: "inProgress" });
  const saved = await h.tasksApi.saveTask(data, []);
  assert.equal(h.requests[0].operation, "insert");
  assert.equal(h.requests[0].payload.group_id, null);
  assert.equal(h.requests[0].payload.progress_percent, 50);
  assert.equal(saved.created_at, createdAt);
  assert.equal(saved.user_id, userId);
  assert.equal(h.authReads(), 1);
  assert.deepEqual(h.cache(), [saved]);
});

test("a rejected unlinked save is surfaced rather than reported as saved locally", async (t) => {
  const error = { code: "23502", message: 'null value in column "group_id" violates not-null constraint' };
  const h = setup(t, { respond: () => ({ data: null, error }) });
  const existing = makeTask();
  h.seed([existing]);
  await assert.rejects(h.tasksApi.saveTask(makeTask({ id: undefined }), [existing]), /group_id/);
  assert.deepEqual(h.cache(), [existing]);
});

test("updating a missing or inaccessible task cannot silently report success", async (t) => {
  const h = setup(t, { respond: (query) => {
    assert.equal(query.single, true);
    return { data: null, error: { code: "PGRST116", message: "Cannot coerce the result to a single JSON object" } };
  } });
  const existing = makeTask();
  h.seed([existing]);
  await assert.rejects(h.tasksApi.saveTask({ ...existing, task_name: "Changed" }, [existing]), /single JSON object/);
  assert.deepEqual(h.cache(), [existing]);
});

test("a missing or inaccessible status update fails without changing cached progress", async (t) => {
  const h = setup(t, { respond: (query) => {
    assert.equal(query.single, true);
    assert.equal(query.columns, "id");
    assert.deepEqual(query.payload, { progress_percent: 100 });
    assert.deepEqual(query.filters, [["id", taskId], ["user_id", userId]]);
    return { data: null, error: { code: "PGRST116", message: "Cannot coerce the result to a single JSON object" } };
  } });
  const existing = makeTask();
  h.seed([existing]);
  await assert.rejects(h.tasksApi.updateTaskStatus(taskId, "done", [existing]), /single JSON object/);
  assert.deepEqual(h.cache(), [existing]);
});

test("guest and offline saves keep the actual owner and an existing creation timestamp", async (t) => {
  for (const options of [{ userId: "guest-example" }, { online: false }]) {
    await t.test(options.userId ? "guest" : "offline", async (t) => {
      const h = setup(t, options);
      const existing = makeTask({ user_id: options.userId ?? userId });
      const saved = await h.tasksApi.saveTask({ ...existing, task_name: "Edited offline" }, [existing]);
      assert.equal(saved.user_id, existing.user_id);
      assert.equal(saved.created_at, createdAt);
      assert.equal(h.requests.length, 0);
      assert.equal(h.authReads(), 1);
      assert.deepEqual(h.cache(), [saved]);
    });
  }
});

test("saveTask adds a successfully saved existing row to an empty cache", async (t) => {
  const h = setup(t);
  const saved = await h.tasksApi.saveTask(makeTask(), []);
  assert.deepEqual(h.cache(), [saved]);
});

test("bulk save keeps every task in the cache instead of replacing it with an empty list", async (t) => {
  const h = setup(t);
  const tasks = [makeTask(), makeTask({ id: otherTaskId, task_name: "Second" })];
  await h.tasksApi.saveAllTasks(tasks);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.cache(), tasks);
});

test("bulk save failure propagates and does not cache the failed task's edits", async (t) => {
  const h = setup(t, { respond: (query) => query.filters.some(([, id]) => id === otherTaskId)
    ? { data: null, error: { code: "42501", message: "permission denied" } }
    : { data: { id: taskId, created_at: createdAt }, error: null }
  });
  const before = [makeTask(), makeTask({ id: otherTaskId, task_name: "Second" })];
  h.seed(before);
  const after = before.map((task) => ({ ...task, task_name: `${task.task_name} edited` }));
  await assert.rejects(h.tasksApi.saveAllTasks(after), /permission denied/);
  assert.deepEqual(h.cache(), [after[0], before[1]]);
});

test("an empty local batch clears the cache without a database write", async (t) => {
  const h = setup(t);
  h.seed([makeTask()]);
  await h.tasksApi.saveAllTasks([]);
  assert.deepEqual(h.cache(), []);
  assert.equal(h.requests.length, 0);
});

test("guest saves, deletes, and status changes reject when local persistence fails", async (t) => {
  const h = setup(t, { userId: "guest-example", storageError: new Error("QuotaExceededError") });
  const existing = makeTask({ user_id: "guest-example" });
  h.seed([existing]);
  await assert.rejects(h.tasksApi.saveTask({ ...existing, task_name: "Changed" }, [existing]), /QuotaExceededError/);
  await assert.rejects(h.tasksApi.deleteTask(existing.id, [existing]), /QuotaExceededError/);
  await assert.rejects(h.tasksApi.updateTaskStatus(existing.id, "done", [existing]), /QuotaExceededError/);
  assert.deepEqual(h.cache(), [existing]);
  assert.equal(h.requests.length, 0);
});

test("offline bulk saves reject a failed cache write", async (t) => {
  const h = setup(t, { online: false, storageError: new Error("QuotaExceededError") });
  await assert.rejects(h.tasksApi.saveAllTasks([makeTask()]), /QuotaExceededError/);
  assert.equal(h.requests.length, 0);
});

test("successful online bulk writes are not falsely failed by an unavailable cache", async (t) => {
  const h = setup(t, { storageError: new Error("QuotaExceededError") });
  await h.tasksApi.saveAllTasks([makeTask(), makeTask({ id: otherTaskId })]);
  assert.equal(h.requests.length, 2);
});

test("bulk save caches only the requested list without erasing its successfully saved rows", async (t) => {
  const h = setup(t);
  const requested = makeTask();
  h.seed([requested, makeTask({ id: otherTaskId })]);
  await h.tasksApi.saveAllTasks([requested]);
  assert.deepEqual(h.cache(), [requested]);
});

test("two local creates in the same millisecond receive distinct task IDs", async (t) => {
  for (const useFallback of [false, true]) {
    await t.test(useFallback ? "without randomUUID" : "with randomUUID", async (t) => {
      const h = setup(t, { userId: "guest-example" });
      t.mock.method(Date, "now", () => 123456789);
      if (useFallback) {
        const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
        Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
        t.after(() => {
          if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto);
          else delete globalThis.crypto;
        });
      }
      const data = makeTask({ id: undefined });
      const first = await h.tasksApi.saveTask(data, []);
      const second = await h.tasksApi.saveTask(data, [first]);
      assert.match(first.id, /^task-/);
      assert.notEqual(first.id, second.id);
      assert.deepEqual(h.cache(), [first, second]);
      assert.equal(h.requests.length, 0);
    });
  }
});

test('native insert retries use a stable UUID and verify duplicate ownership without updating existing content',async t=>{
 let attempted;
 const h=setup(t,{respond:q=>{if(q.operation==='insert'){attempted=q.payload;return {data:null,error:{code:'23505',message:'duplicate'}};}return {data:{...attempted,id:taskId,created_at:createdAt},error:null};}});
 const task=makeTask();delete task.id;task.mobile_insert_id=taskId;
 const saved=await h.tasksApi.saveTask(task,[]);
 assert.equal(saved.id,taskId);assert.equal(h.requests[0].payload.id,taskId);
 assert.deepEqual(h.requests[1].filters,[['id',taskId],['user_id',userId]]);
 assert.equal(h.requests.filter(q=>q.operation==='update').length,0);
});

test('a stable insert UUID owned by someone else never becomes a confirmed saved task',async t=>{
 const h=setup(t,{respond:q=>q.operation==='insert'?{data:null,error:{code:'23505',message:'duplicate'}}:{data:null,error:{message:'not owned'}}});
 const task=makeTask();delete task.id;task.mobile_insert_id=taskId;
 await assert.rejects(h.tasksApi.saveTask(task,[]));assert.equal(h.cache(),null);
});

test('renaming a task preserves raw timestamps, independent work end, and partial progress', async t => {
  const h = setup(t);
  const before = makeTask({ status: 'inProgress', progress_percent: 37,
    start_at: '2026-10-01T08:15:00+09:00', end_at: '2026-10-10T23:59:00+09:00',
    scheduled_start_at: '2026-10-05T13:30:00+09:00', scheduled_end_at: '2026-10-05T15:00:00+09:00',
  });
  const saved = await h.tasksApi.saveTask({ ...before, task_name: 'Renamed' }, [before]);
  const payload = h.requests[0].payload;
  assert.equal(payload.progress_percent, 37);
  assert.equal(payload.period_start_daytime, before.start_at);
  assert.equal(payload.period_end_daytime, before.end_at);
  assert.equal(payload.work_start_daytime, before.scheduled_start_at);
  assert.equal(payload.work_end_daytime, before.scheduled_end_at);
  assert.equal(saved.progress_percent, 37);
});

test('explicit task date/status edits replace their old values without overwriting work end', async t => {
  const h = setup(t);
  const before = makeTask({ status: 'inProgress', progress_percent: 37,
    start_at: '2026-10-01T08:15:00Z', end_at: '2026-10-10T23:59:00Z',
    scheduled_start_at: '2026-10-05T13:30:00Z', scheduled_end_at: '2026-10-05T15:00:00Z',
  });
  const saved = await h.tasksApi.saveTask({ ...before, deadline: '2026-10-11', assigned_date: null, scheduled_date: '2026-10-06', status: 'done' }, [before]);
  const payload = h.requests[0].payload;
  assert.equal(payload.progress_percent, 100);
  assert.equal(payload.period_start_daytime, null);
  assert.equal(payload.period_end_daytime, '2026-10-11');
  assert.equal(payload.work_start_daytime, '2026-10-06');
  assert.equal(payload.work_end_daytime, before.scheduled_end_at);
  assert.equal(saved.end_at, '2026-10-11');
  assert.equal(saved.start_at, null);
  assert.equal(saved.scheduled_start_at, '2026-10-06');
});

test('offline task edits preserve raw timestamps and fine progress until explicit changes', async t => {
  const h = setup(t, { online: false });
  const before = makeTask({ status: 'inProgress', progress_percent: 62,
    end_at: '2026-10-10T21:40:00Z', scheduled_end_at: '2026-10-05T15:00:00Z',
  });
  const saved = await h.tasksApi.saveTask({ ...before, task_details: 'Changed offline' }, [before]);
  assert.equal(saved.progress_percent, 62);
  assert.equal(saved.end_at, before.end_at);
  assert.equal(saved.scheduled_end_at, before.scheduled_end_at);
  assert.equal(h.requests.length, 0);
});

test('stable UUID retry accepts equivalent timestamps normalized by Postgres', async t => {
  let attempted;
  const h = setup(t, { respond: q => {
    if (q.operation === 'insert') { attempted = q.payload; return { data: null, error: { code: '23505', message: 'duplicate' } }; }
    return { data: { ...attempted, id: taskId, created_at: createdAt,
      period_end_daytime: '2026-10-10T14:59:00+00:00',
      work_start_daytime: '2026-10-05T00:00:00+00:00',
    }, error: null };
  } });
  const input = makeTask({ id: undefined, end_at: '2026-10-10T23:59:00+09:00', mobile_insert_id: taskId });
  const saved = await h.tasksApi.saveTask(input, []);
  assert.equal(saved.id, taskId);
  assert.equal(h.requests[1].columns, '*');
  assert.equal(h.requests.filter(q => q.operation === 'update').length, 0);
});

test('stable UUID retry rejects conflicting saved content without confirming attempted edits', async t => {
  let attempted;
  const h = setup(t, { respond: q => {
    if (q.operation === 'insert') { attempted = q.payload; return { data: null, error: { code: '23505', message: 'duplicate' } }; }
    return { data: { ...attempted, id: taskId, created_at: createdAt, name: 'Different cloud content' }, error: null };
  } });
  const existing = makeTask({ id: otherTaskId }); h.seed([existing]);
  await assert.rejects(h.tasksApi.saveTask(makeTask({ id: undefined, mobile_insert_id: taskId }), [existing]), /課題IDの内容がクラウドで異なります/);
  assert.deepEqual(h.cache(), [existing]);
  assert.equal(h.requests.filter(q => q.operation === 'update').length, 0);
});

test('same date but a different deadline time is a conflicting stable UUID retry', async t => {
  let attempted;
  const h = setup(t, { respond: q => {
    if (q.operation === 'insert') { attempted = q.payload; return { data: null, error: { code: '23505', message: 'duplicate' } }; }
    return { data: { ...attempted, id: taskId, created_at: createdAt, period_end_daytime: '2026-10-10T14:58:00+00:00' }, error: null };
  } });
  await assert.rejects(h.tasksApi.saveTask(makeTask({ id: undefined, end_at: '2026-10-10T23:59:00+09:00', mobile_insert_id: taskId }), []), /クラウドで異なります/);
  assert.equal(h.cache(), null);
});

test('uppercase native UUID lost-response recovery matches lowercase PostgreSQL IDs', async t => {
  const nativeId = 'ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF';
  const nativeGroup = 'FEDCBAFE-DCBA-4FED-8FED-FEDCBAFEDCBA';
  let attempted;
  const h = setup(t, { respond: q => {
    if (q.operation === 'insert') {
      attempted = q.payload;
      return { data: null, error: { code: '23505', message: 'duplicate after lost response' } };
    }
    return { data: { ...attempted, id: nativeId.toLowerCase(), group_id: nativeGroup.toLowerCase(), created_at: createdAt }, error: null };
  } });
  const saved = await h.tasksApi.saveTask(makeTask({ id: undefined, lecture_id: nativeGroup, mobile_insert_id: nativeId }), [], userId);
  assert.equal(attempted.id, nativeId.toLowerCase());
  assert.equal(attempted.group_id, nativeGroup.toLowerCase());
  assert.equal(saved.id, nativeId.toLowerCase());
  assert.deepEqual(h.requests[1].filters, [['id', nativeId.toLowerCase()], ['user_id', userId]]);
  assert.equal(h.requests.filter(q => q.operation === 'update').length, 0);
});

test('lost-response retry accepts equivalent PostgreSQL interval output but rejects changed duration', async t => {
  for (const storedDuration of ['02:00:00', '03:00:00']) {
    await t.test(storedDuration, async t => {
      let attempted;
      const h = setup(t, { respond: q => {
        if (q.operation === 'insert') { attempted = q.payload; return { data: null, error: { code: '23505', message: 'duplicate' } }; }
        return { data: { ...attempted, id: taskId, created_at: createdAt, work_interval_estimated: storedDuration }, error: null };
      } });
      const action = h.tasksApi.saveTask(makeTask({ id: undefined, estimated_duration: '2 hours', mobile_insert_id: taskId }), [], userId);
      if (storedDuration === '02:00:00') assert.equal((await action).id, taskId);
      else { await assert.rejects(action, /クラウドで異なります/); assert.equal(h.cache(), null); }
      assert.equal(h.requests.filter(q => q.operation === 'update').length, 0);
    });
  }
});

test('retry timestamp equivalence retains PostgreSQL microsecond precision', async t => {
  for (const microseconds of ['123456', '123457']) {
    await t.test(microseconds, async t => {
      let attempted;
      const h = setup(t, { respond: q => {
        if (q.operation === 'insert') { attempted = q.payload; return { data: null, error: { code: '23505', message: 'duplicate' } }; }
        return { data: { ...attempted, id: taskId, created_at: createdAt, period_end_daytime: `2026-10-10T14:59:00.${microseconds}+00:00` }, error: null };
      } });
      const action = h.tasksApi.saveTask(makeTask({ id: undefined, end_at: '2026-10-10T23:59:00.123456+09:00', mobile_insert_id: taskId }), []);
      if (microseconds === '123456') assert.equal((await action).id, taskId);
      else { await assert.rejects(action, /クラウドで異なります/); assert.equal(h.cache(), null); }
    });
  }
});


test("nullable lecture cloud task creates, edits and reloads without a placeholder group", async (t) => {
  let row;
  const h = setup(t, { respond(query) {
    if (query.operation === "insert") row = { ...query.payload, id: taskId, created_at: createdAt };
    if (query.operation === "update") Object.assign(row, query.payload);
    return { data: query.operation === "select" ? [row] : row, error: null };
  }});
  const saved = await h.tasksApi.saveTask(makeTask({ id: undefined, lecture_id: null, deadline: "" }), [], userId);
  assert.equal(row.group_id, null);
  assert.equal(row.user_id, userId);
  const [loaded] = await h.tasksApi.fetchTasks();
  assert.equal(loaded.lecture_id, null);
  assert.equal(loaded.deadline, "");
  await h.tasksApi.saveTask({ ...saved, task_name: "Personal report edited", lecture_id: null }, [loaded], userId);
  const [reloaded] = await h.tasksApi.fetchTasks();
  assert.equal(reloaded.task_name, "Personal report edited");
  assert.equal(reloaded.lecture_id, null);
  assert.equal(reloaded.user_id, userId);
  assert.equal(row.group_id, null);
  assert.ok(h.requests.filter(q => q.operation === "select").every(q => q.filters.some(([key,value]) => key === "user_id" && value === userId)));
});

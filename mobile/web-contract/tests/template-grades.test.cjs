const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { loadTs } = require("./helpers/load-ts.cjs");

const affiliationId = "00000001-0001-0003-0000-000000000000";
const browserGlobals = new Map();

before(() => {
  for (const name of ["window", "localStorage"]) {
    browserGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { setItem() {} },
  });
});

after(() => {
  for (const [name, descriptor] of browserGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

async function fetchTemplate(gradeResult, schedules = []) {
  const responses = {
    department_and_major: { data: { id: "department-major" } },
    user_lecture_data_template: {
      data: [{
        id: "template-1",
        user_id: "creator-1",
        group_id: "group-1",
        affiliation_id: affiliationId,
        groups: { id: "group-1", name: "123456 数学 English title" },
      }],
    },
    user_lecture_data_template_rate: { data: [] },
    public_lecture_data: { data: [] },
    schedules: { data: schedules },
    grade_distributions: gradeResult,
  };

  const supabase = {
    from(table) {
      assert.ok(Object.hasOwn(responses, table), `Unexpected table: ${table}`);
      const query = {
        select() { return query; },
        eq() { return query; },
        neq() { return query; },
        limit() { return query; },
        maybeSingle() { return query; },
        in(column, values) {
          if (table === "grade_distributions") {
            assert.equal(column, "subject_name");
            assert.deepEqual(values, ["数学"]);
          }
          return query;
        },
        then(resolve, reject) { return Promise.resolve(responses[table]).then(resolve, reject); },
      };
      return query;
    },
  };

  const { fetchTemplatesForDepartment } = loadTs("lib/api/user-settings.ts", {
    "@/lib/supabase": {
      supabase,
      getCurrentUserId: async () => null,
      getSupabaseStatus: () => true,
    },
    "@/lib/setup-templates": { getAffiliationId: () => affiliationId },
  });

  const result = await fetchTemplatesForDepartment("工学部", "数学科");
  assert.equal(result.hasData, true);
  assert.equal(result.templates.length, 1);
  return result.templates[0];
}

function assertMissingGrades(template) {
  for (const key of ["gpa", "aRate", "passRate", "gradeDistribution", "historicalEnrollment", "historicalInstructor"]) {
    assert.equal(template[key], undefined, `${key} should stay unavailable`);
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(template)), key), false, `${key} must not enter the setup cache`);
  }
}

test("templates without historical grades do not fabricate GPA, rates, or a distribution", async () => {
  const template = await fetchTemplate({ data: [] });
  assertMissingGrades(template);
  assert.equal(template.lecture_name, "123456 数学 English title");
  assert.equal(template.discipline, "工学部");
});

test("an unavailable grade query preserves templates while leaving historical grades missing", async () => {
  const template = await fetchTemplate({ data: null, error: { message: "offline" } });
  assertMissingGrades(template);
});

test("real template grades retain all eleven buckets, including distinct D- and F values", async () => {
  const template = await fetchTemplate({ data: [{
    subject_name: "数学",
    gpa: 2.345,
    aplus_percent: 12,
    a_percent: 18,
    aminus_percent: 10,
    bplus_percent: 8,
    b_percent: 15,
    bminus_percent: 5,
    cplus_percent: 7,
    c_percent: 6,
    d_percent: 9,
    dminus_percent: 4,
    f_percent: 6,
    faculty: "理学部",
    instructor_name: "田中",
    student_count: 120,
  }] });
  assert.equal(template.gpa, "2.35");
  assert.equal(template.aRate, "40.0 %");
  assert.equal(template.passRate, "94.0 %");
  assert.deepEqual(template.gradeDistribution, [12, 18, 10, 8, 15, 5, 7, 6, 9, 4, 6]);
  assert.equal(template.historicalEnrollment, "120 人");
  assert.equal(template.historicalInstructor, "田中");
  assert.equal(template.discipline, "理学部");
});

test("zero GPA and enrollment are preserved rather than treated as missing", async () => {
  const template = await fetchTemplate({ data: [{
    subject_name: "数学",
    gpa: 0,
    student_count: 0,
    aplus_percent: 0,
    a_percent: 0,
    aminus_percent: 0,
    f_percent: 100,
  }] });
  assert.equal(template.gpa, "0.00");
  assert.equal(template.aRate, "0.0 %");
  assert.equal(template.passRate, "0.0 %");
  assert.equal(template.historicalEnrollment, "0 人");
  assert.equal(template.gradeDistribution, undefined, "unknown buckets are not zero-filled");
});

test("an existing historical row with null GPA does not acquire a made-up GPA", async () => {
  const template = await fetchTemplate({ data: [{
    subject_name: "数学",
    gpa: null,
    student_count: null,
  }] });
  assert.equal(template.gpa, undefined);
  assert.equal(template.historicalEnrollment, undefined);
});

test('template slots carry the canonical academic year or pinned undated legacy term', async () => {
  const template = await fetchTemplate({ data: [] }, [
    { group_id: 'group-1', day_of_week: 1, start_time: '08:45:00', period_start_daytime: '2028-10-01T00:00:00Z' },
    { group_id: 'group-1', day_of_week: 3, start_time: '14:45:00', period_start_daytime: null },
  ]);
  assert.deepEqual(template.slots, [
    { day_of_the_week: 1, period: 1, term: '2028年度 2学期（秋ターム）' },
    { day_of_the_week: 3, period: 4, term: '2026年度 1学期（夏ターム）' },
  ]);
});

test('template with no canonical schedules does not invent a selectable Monday slot', async () => {
  const template = await fetchTemplate({ data: [] });
  assert.deepEqual(template.slots, []);
});


test('partial historical data cannot fabricate a pass rate or missing grade buckets', async () => {
  const template = await fetchTemplate({ data: [{ subject_name: '数学', aplus_percent: 0, a_percent: null, aminus_percent: 25, f_percent: null }] });
  assert.equal(template.aRate, undefined);
  assert.equal(template.passRate, undefined);
  assert.equal(template.gradeDistribution, undefined);
  assert.equal(template.credits, undefined);
  assert.equal(template.syllabus_id, undefined);
});

test('invalid historical percentages are not surfaced as real template grade metrics', async () => {
  const template = await fetchTemplate({ data: [{ subject_name: '数学', gpa: -1, aplus_percent: -5, a_percent: 0, aminus_percent: 0, f_percent: 101 }] });
  assert.equal(template.gpa, undefined);
  assert.equal(template.aRate, undefined);
  assert.equal(template.passRate, undefined);
  assert.equal(template.gradeDistribution, undefined);
});

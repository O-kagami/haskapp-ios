const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const terms = loadTs('lib/academic-terms.ts');

test('academic term changes at Tokyo midnight and January stays in the prior academic year', () => {
  const cases = [
    ['2027-03-31T14:59:59Z', '2026年度 2学期（冬ターム）'],
    ['2027-03-31T15:00:00Z', '2027年度 1学期（春ターム）'],
    ['2027-05-31T15:00:00Z', '2027年度 1学期（夏ターム）'],
    ['2027-09-30T15:00:00Z', '2027年度 2学期（秋ターム）'],
    ['2027-11-30T15:00:00Z', '2027年度 2学期（冬ターム）'],
    ['2028-01-15T00:00:00Z', '2027年度 2学期（冬ターム）'],
  ];
  for (const [timestamp, expected] of cases) assert.equal(terms.getCurrentTerm(new Date(timestamp)), expected);
});

test('all terms roundtrip arbitrary academic years with the Web UTC anchors', () => {
  for (const year of [2024, 2026, 2027, 2032]) {
    const options = terms.getAcademicTermOptions(year);
    assert.equal(options.length, 4);
    options.forEach((term, index) => {
      const date = terms.getTermStartDate(term);
      assert.equal(date, `${year}-${['04','06','10','12'][index]}-01T00:00:00.000Z`);
      assert.equal(terms.getTermFromSchedule({ period_start_daytime: date }), term);
    });
  }
});

test('unknown term labels fail rather than silently storing a different academic year', () => {
  assert.throws(() => terms.getTermStartDate('2028 spring'));
  assert.throws(() => terms.getTermStartDate('2028年度 1学期（冬ターム）'));
  assert.equal(terms.getTermFromSchedule({ period_start_daytime: null }), undefined);
  assert.equal(terms.getTermFromSchedule({ period_start_daytime: 'invalid' }), undefined);
  assert.equal(terms.getTermFromSchedule({ period_start_daytime: '2027-99-01' }), undefined);
});

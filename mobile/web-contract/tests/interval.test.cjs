const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const { equivalentIntervals } = loadTs('lib/interval.ts');

test('supported PostgreSQL duration spellings preserve separate month/day/clock components', () => {
  for (const [a, b] of [
    ['2 hours', '02:00:00'], ['2:00:00', '02:00:00'], ['2:00', '02:00:00'],
    ['90 minutes', '01:30:00'], ['PT2H', '02:00:00'], ['PT1H30M', '01:30:00'],
    ['1 day 2 hours', '1 day 02:00:00'], ['3 04:05:06', '3 days 04:05:06'],
    ['P1Y2M3DT4H5M6S', '1 year 2 mons 3 days 04:05:06'],
    ['1.5 days', '1 day 12:00:00'], ['1.5 months', '1 mon 15 days'],
    ['@ 2 hours ago', '-02:00:00'], ['1.000001 seconds', '00:00:01.000001'],
    ['2 weeks', '14 days'], ['1500 milliseconds', '00:00:01.5'],
    ['1.5 years', '1 year 6 mons'], ['P1.5Y', '1 year 6 mons'],
  ]) assert.equal(equivalentIntervals(a, b), true, `${a} should equal ${b}`);
});

test('different or unrecognized durations never falsely confirm a retry', () => {
  for (const [a, b] of [
    ['2 hours', '02:00:01'], ['2 hours', '03:00:00'], ['1 day', '24:00:00'],
    ['1 month', '30 days'], ['unknown', '00:00:00'], ['P', '00:00:00'],
    ['0.1 years', '1 mon 6 days'], ['P0.1Y', '1 mon 6 days'], ['0.1 years', '1 mon'],
    ['', '00:00:00'], ['two hours', '02:00:00'], ['1.000001 seconds', '00:00:01.000002'],
  ]) assert.equal(equivalentIntervals(a, b), false, `${a} should not equal ${b}`);
});

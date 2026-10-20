// PostgreSQL keeps months, days and microseconds separate. Do not equate a calendar
// day with 24 clock hours (DST) or a month with 30 days when confirming a retry.
// https://www.postgresql.org/docs/current/datatype-datetime.html#DATATYPE-INTERVAL-INPUT
function intervalParts(input: string): [number, number, number] | null {
  let text = input.trim().toLowerCase().replace(/^@\s*/, '');
  const direction = /\s+ago$/.test(text) ? -1 : 1;
  text = text.replace(/\s+ago$/, '').trim();
  if (!text) return null;
  let months = 0;
  let days = 0;
  let seconds = 0;
  const number = '([+-]?\\d+(?:\\.\\d+)?)';
  const iso = new RegExp(`^p(?:${number}y)?(?:${number}m)?(?:${number}w)?(?:${number}d)?(?:t(?:${number}h)?(?:${number}m)?(?:${number}s)?)?$`).exec(text);
  if (iso && iso.slice(1).some(value => value !== undefined)) {
    const [years, month, weeks, day, hours, minutes, second] = iso.slice(1).map(value => Number(value ?? 0));
    // PostgreSQL rounds sub-month fractions of years rather than spilling to days.
    // Only confirm fractional years that resolve to an exact integral month count.
    if (!Number.isInteger(years * 12)) return null;
    months = years * 12 + month;
    days = weeks * 7 + day;
    seconds = hours * 3600 + minutes * 60 + second;
    text = '';
  } else {
    const clock = /([+-]?\d+):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(text);
    if (clock) {
      const sign = clock[1].startsWith('-') ? -1 : 1;
      if (Number(clock[2]) >= 60 || Number(clock[3] ?? 0) >= 60) return null;
      seconds = sign * (Math.abs(Number(clock[1])) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0));
      text = text.slice(0, clock.index).trim();
      if (/^[+-]?\d+$/.test(text)) { days = Number(text); text = ''; }
    }
    const units: Record<string, ["months" | "days" | "seconds", number]> = {
      y: ['months', 12], yr: ['months', 12], yrs: ['months', 12], year: ['months', 12], years: ['months', 12],
      mon: ['months', 1], mons: ['months', 1], month: ['months', 1], months: ['months', 1],
      w: ['days', 7], week: ['days', 7], weeks: ['days', 7], d: ['days', 1], day: ['days', 1], days: ['days', 1],
      h: ['seconds', 3600], hr: ['seconds', 3600], hrs: ['seconds', 3600], hour: ['seconds', 3600], hours: ['seconds', 3600],
      min: ['seconds', 60], mins: ['seconds', 60], minute: ['seconds', 60], minutes: ['seconds', 60],
      s: ['seconds', 1], sec: ['seconds', 1], secs: ['seconds', 1], second: ['seconds', 1], seconds: ['seconds', 1],
      millisecond: ['seconds', 0.001], milliseconds: ['seconds', 0.001],
      microsecond: ['seconds', 0.000001], microseconds: ['seconds', 0.000001],
    };
    while (text) {
      const token = /^([+-]?\d+(?:\.\d+)?)\s*([a-z]+)(?:\s+|$)/.exec(text);
      if (!token || !units[token[2]]) return null;
      const [field, multiplier] = units[token[2]];
      const value = Number(token[1]) * multiplier;
      if (field === 'months' && multiplier === 12 && !Number.isInteger(value)) return null;
      if (field === 'months') months += value;
      else if (field === 'days') days += value;
      else seconds += value;
      text = text.slice(token[0].length);
    }
    if (!clock && !/[a-z]/.test(input)) return null;
  }
  const integerMonths = Math.trunc(months);
  days += (months - integerMonths) * 30;
  const integerDays = Math.trunc(days);
  seconds += (days - integerDays) * 86400;
  const microseconds = Math.round(seconds * 1_000_000);
  if (![integerMonths, integerDays, microseconds].every(Number.isSafeInteger)) return null;
  return [integerMonths * direction, integerDays * direction, microseconds * direction];
}

/** Unknown syntax is conservatively a conflict; a retry must never hide different data. */
export function equivalentIntervals(left: string, right: string): boolean {
  if (left === right) return true;
  const a = intervalParts(left);
  const b = intervalParts(right);
  return a !== null && b !== null && a.every((value, index) => value === b[index]);
}

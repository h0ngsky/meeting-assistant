const LUNCH_START = { hour: 12, minute: 30 };
const LUNCH_END = { hour: 14, minute: 0 };
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Shanghai';

function hasTimezone(value) {
  const s = String(value).trim();
  return /Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s);
}

function parseLocalDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/**
 * Parse stored datetime.
 * - With Z/offset: real instant (legacy bad saves used toISOString on local picks).
 * - Without timezone: wall-clock components in the app timezone context.
 */
function parseDateTimeValue(value) {
  if (!value) return new Date(NaN);
  const normalized = String(value).trim();
  if (hasTimezone(normalized)) {
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? new Date(NaN) : d;
  }
  const core = normalized.slice(0, 19);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(core)) {
    const [datePart, timePart = '00:00:00'] = core.split('T');
    const [y, mo, d] = datePart.split('-').map(Number);
    const [h, mi, s = 0] = timePart.split(':').map(Number);
    return new Date(y, mo - 1, d, h, mi, s);
  }
  return new Date(normalized);
}

function buildDateTime(date, time) {
  const t = String(time).slice(0, 5);
  return `${date}T${t}:00`;
}

/** Normalize legacy UTC ISO strings to wall-clock "YYYY-MM-DDTHH:mm:00". */
function toWallClockString(value) {
  const normalized = String(value).trim();
  if (!hasTimezone(normalized)) return normalized.slice(0, 19);
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return normalized.slice(0, 19);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`;
}

function datePartOf(value) {
  const d = parseDateTimeValue(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function overlapsLunchBreak(start, end) {
  const lunchStart = new Date(start);
  lunchStart.setHours(LUNCH_START.hour, LUNCH_START.minute, 0, 0);
  const lunchEnd = new Date(start);
  lunchEnd.setHours(LUNCH_END.hour, LUNCH_END.minute, 0, 0);
  return start < lunchEnd && end > lunchStart;
}

function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

module.exports = {
  LUNCH_START,
  LUNCH_END,
  APP_TIMEZONE,
  hasTimezone,
  parseLocalDateTime,
  parseDateTimeValue,
  buildDateTime,
  toWallClockString,
  datePartOf,
  overlapsLunchBreak,
  timeRangesOverlap,
};

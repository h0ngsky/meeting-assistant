const LUNCH_START = { hour: 12, minute: 30 };
const LUNCH_END = { hour: 14, minute: 0 };

function parseLocalDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/** Parse stored datetime as wall-clock local time (fixes Vercel UTC drift). */
function parseDateTimeValue(value) {
  if (!value) return new Date(NaN);
  const normalized = String(value).trim();
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
  parseLocalDateTime,
  parseDateTimeValue,
  buildDateTime,
  datePartOf,
  overlapsLunchBreak,
  timeRangesOverlap,
};

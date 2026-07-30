const LUNCH_START = { hour: 12, minute: 30 };
const LUNCH_END = { hour: 14, minute: 0 };

function parseLocalDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
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
  overlapsLunchBreak,
  timeRangesOverlap,
};

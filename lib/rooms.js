const ROOMS = [
  { id: '201', name: '会议室 201', capacity: 6 },
  { id: '202', name: '会议室 202', capacity: 8 },
  { id: '203', name: '会议室 203', capacity: 10 },
  { id: '204', name: '会议室 204', capacity: 12 },
  { id: '205', name: '会议室 205', capacity: 12 },
];

const LUNCH_START = { hour: 12, minute: 30 };
const LUNCH_END = { hour: 14, minute: 0 };

function getRoom(roomId) {
  return ROOMS.find((r) => r.id === roomId) || null;
}

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
  ROOMS,
  LUNCH_START,
  LUNCH_END,
  getRoom,
  parseLocalDateTime,
  overlapsLunchBreak,
  timeRangesOverlap,
};

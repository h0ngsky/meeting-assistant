const { findRoomById } = require('./db');
const {
  overlapsLunchBreak,
  timeRangesOverlap,
  parseDateTimeValue,
} = require('./rooms');

async function checkMeetingConflicts({
  meetings,
  roomId,
  startTime,
  endTime,
  attendeeIds,
  attendeeCount,
  organizerId,
  excludeMeetingId,
  isAdmin,
  resolveUserName,
}) {
  const errors = [];
  const warnings = [];

  const start = parseDateTimeValue(startTime);
  const end = parseDateTimeValue(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, errors: ['时间格式无效'], warnings: [] };
  }
  if (end <= start) {
    return { ok: false, errors: ['结束时间必须晚于开始时间'], warnings: [] };
  }

  const room = await findRoomById(roomId);
  if (!room) {
    return { ok: false, errors: ['会议室不存在'], warnings: [] };
  }

  const count = attendeeCount || (attendeeIds ? attendeeIds.length + 1 : 1);
  if (count > room.capacity) {
    errors.push(`参会人数 ${count} 超过 ${room.name} 最大容量 ${room.capacity} 人`);
  }

  if (!isAdmin && overlapsLunchBreak(start, end)) {
    errors.push('12:30-14:00 为午休禁约时段，普通成员不可预约（管理员除外）');
  }

  const activeMeetings = meetings.filter(
    (m) => m.id !== excludeMeetingId && m.status !== 'cancelled',
  );

  for (const m of activeMeetings) {
    const mStart = parseDateTimeValue(m.startTime);
    const mEnd = parseDateTimeValue(m.endTime);
    if (String(m.roomId) === String(roomId) && timeRangesOverlap(start, end, mStart, mEnd)) {
      errors.push(`${room.name} 在该时段已被「${m.title}」占用`);
      break;
    }
  }

  const allAttendees = new Set([organizerId, ...(attendeeIds || [])]);

  for (const userId of allAttendees) {
    const userMeetings = activeMeetings.filter(
      (m) =>
        m.organizerId === userId ||
        (m.inviteeIds || []).includes(userId),
    );
    for (const m of userMeetings) {
      if (excludeMeetingId && m.id === excludeMeetingId) continue;
      const mStart = parseDateTimeValue(m.startTime);
      const mEnd = parseDateTimeValue(m.endTime);
      if (timeRangesOverlap(start, end, mStart, mEnd)) {
        const name = resolveUserName
          ? await resolveUserName(userId)
          : `成员#${userId}`;
        warnings.push({
          userId,
          meetingId: m.id,
          meetingTitle: m.title,
          message: `${name} 在该时段已有会议「${m.title}」`,
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    hasScheduleConflict: warnings.length > 0,
  };
}

function toISODateTime(dateStr, timeStr) {
  const { buildDateTime } = require('./rooms');
  return buildDateTime(dateStr, timeStr);
}

module.exports = {
  checkMeetingConflicts,
  toISODateTime,
};

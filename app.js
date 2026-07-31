const express = require('express');
const path = require('path');
const {
  initDb,
  getUsers,
  getMeetings,
  saveMeetings,
  createUser,
  findUserById,
  updateUserProfile,
  updateUserPassword,
  deleteUser,
  getRoomsList,
  findRoomById,
  createRoom,
  deleteRoom,
  publicUser,
  adminUserView,
} = require('./lib/db');
const { authMiddleware, login, requireAdmin } = require('./lib/auth');
const { checkMeetingConflicts } = require('./lib/conflicts');
const { buildDateTime, datePartOf, parseDateTimeValue } = require('./lib/rooms');

const app = express();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

let dbReady = false;
async function ensureDb() {
  if (!dbReady) {
    await initDb();
    dbReady = true;
  }
}

app.use(express.json());
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store');
  }
  next();
});
app.use(asyncHandler(async (_req, _res, next) => {
  await ensureDb();
  next();
}));

// ── Auth ──────────────────────────────────────────────────────────────────

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: '用户名至少 3 个字符' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 个字符' });
  }
  const result = await createUser({ username, password, displayName, role: 'member' });
  if (result.error) return res.status(409).json({ error: result.error });
  const session = await login(username, password);
  res.status(201).json(session);
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  const result = await login(username, password);
  if (result.error) return res.status(401).json({ error: result.error });
  res.json(result);
}));

app.get('/api/auth/me', authMiddleware, asyncHandler(async (req, res) => {
  const user = await findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(publicUser(user));
}));

app.put('/api/auth/profile', authMiddleware, asyncHandler(async (req, res) => {
  const { displayName } = req.body || {};
  const result = await updateUserProfile(req.user.id, { displayName });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(publicUser(result.user));
}));

app.put('/api/auth/password', authMiddleware, asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '请填写原密码和新密码' });
  }
  const result = await updateUserPassword(req.user.id, { oldPassword, newPassword });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

// ── Rooms ─────────────────────────────────────────────────────────────────

app.get('/api/rooms', authMiddleware, asyncHandler(async (_req, res) => {
  res.json(await getRoomsList());
}));

// ── Users ─────────────────────────────────────────────────────────────────

app.get('/api/users', authMiddleware, asyncHandler(async (_req, res) => {
  const { users } = await getUsers();
  res.json(users.map(publicUser));
}));

// ── Admin: member management ────────────────────────────────────────────────

app.get('/api/admin/users', authMiddleware, requireAdmin, asyncHandler(async (_req, res) => {
  const { users } = await getUsers();
  const sorted = [...users].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(sorted.map(adminUserView));
}));

app.post('/api/admin/users', authMiddleware, requireAdmin, asyncHandler(async (req, res) => {
  const { username, password, displayName, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: '用户名至少 3 个字符' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 个字符' });
  }
  const userRole = role === 'admin' ? 'admin' : 'member';
  const result = await createUser({ username, password, displayName, role: userRole });
  if (result.error) return res.status(409).json({ error: result.error });
  res.status(201).json(adminUserView(result.user));
}));

app.delete('/api/admin/users/:id', authMiddleware, requireAdmin, asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (userId === req.user.id) {
    return res.status(400).json({ error: '不能删除当前登录账号' });
  }
  const result = await deleteUser(userId);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

// ── Admin: room management ──────────────────────────────────────────────────

app.get('/api/admin/rooms', authMiddleware, requireAdmin, asyncHandler(async (_req, res) => {
  res.json(await getRoomsList());
}));

app.post('/api/admin/rooms', authMiddleware, requireAdmin, asyncHandler(async (req, res) => {
  const { id, name, capacity } = req.body || {};
  const result = await createRoom({ id, name, capacity });
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json(result.room);
}));

app.delete('/api/admin/rooms/:id', authMiddleware, requireAdmin, asyncHandler(async (req, res) => {
  const result = await deleteRoom(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

// ── Meetings ────────────────────────────────────────────────────────────────

async function enrichMeeting(m) {
  const organizer = await findUserById(m.organizerId);
  const invitees = await Promise.all(
    (m.inviteeIds || []).map((id) => findUserById(id)),
  );
  const room = await findRoomById(m.roomId);
  return {
    ...m,
    organizer: organizer ? publicUser(organizer) : null,
    invitees: invitees.filter(Boolean).map(publicUser),
    room: room || null,
  };
}

app.get('/api/meetings', authMiddleware, asyncHandler(async (req, res) => {
  const { date, roomId, userId } = req.query;
  let { meetings } = await getMeetings();
  meetings = meetings.filter((m) => m.status !== 'cancelled');

  if (date) {
    meetings = meetings.filter((m) => datePartOf(m.startTime) === date);
  }
  if (roomId) meetings = meetings.filter((m) => String(m.roomId) === String(roomId));
  if (userId) {
    const uid = Number(userId);
    meetings = meetings.filter(
      (m) => m.organizerId === uid || (m.inviteeIds || []).includes(uid),
    );
  }
  res.json(await Promise.all(meetings.map(enrichMeeting)));
}));

app.get('/api/meetings/my', authMiddleware, asyncHandler(async (req, res) => {
  const uid = req.user.id;
  const { meetings } = await getMeetings();
  const mine = meetings.filter(
    (m) =>
      m.status !== 'cancelled' &&
      (m.organizerId === uid || (m.inviteeIds || []).includes(uid)),
  );
  res.json(await Promise.all(mine.map(enrichMeeting)));
}));

app.get('/api/meetings/:id/participant-schedules', authMiddleware, asyncHandler(async (req, res) => {
  const { meetings } = await getMeetings();
  const m = meetings.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: '会议不存在' });

  const meetingStart = parseDateTimeValue(m.startTime);
  const meetingEnd = parseDateTimeValue(m.endTime);
  const date = req.query.date || datePartOf(m.startTime);

  const participantIds = [...new Set([m.organizerId, ...(m.inviteeIds || [])])];

  const participants = (await Promise.all(participantIds.map(async (uid) => {
    const user = await findUserById(uid);
    if (!user) return null;

    const dayMeetings = await Promise.all(
      meetings
        .filter(
          (item) =>
            item.status !== 'cancelled' &&
            (item.organizerId === uid || (item.inviteeIds || []).includes(uid)) &&
            datePartOf(item.startTime) === date,
        )
        .sort((a, b) => parseDateTimeValue(a.startTime) - parseDateTimeValue(b.startTime))
        .map(async (item) => {
          const s = parseDateTimeValue(item.startTime);
          const e = parseDateTimeValue(item.endTime);
          const isCurrent = item.id === m.id;
          const overlapsCurrent = !isCurrent && s < meetingEnd && e > meetingStart;
          return {
            id: item.id,
            title: item.title,
            startTime: item.startTime,
            endTime: item.endTime,
            roomId: item.roomId,
            room: (await findRoomById(item.roomId)) || null,
            role: item.organizerId === uid ? 'organizer' : 'invitee',
            isCurrent,
            overlapsCurrent,
          };
        }),
    );

    return {
      user: publicUser(user),
      meetings: dayMeetings,
      hasConflict: dayMeetings.some((item) => item.overlapsCurrent),
    };
  }))).filter(Boolean);

  res.json({
    meeting: await enrichMeeting(m),
    date,
    participants,
  });
}));

app.get('/api/meetings/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { meetings } = await getMeetings();
  const m = meetings.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: '会议不存在' });
  res.json(await enrichMeeting(m));
}));

app.post('/api/meetings/check-conflicts', authMiddleware, asyncHandler(async (req, res) => {
  const { roomId, startTime, endTime, inviteeIds, attendeeCount, excludeMeetingId } = req.body || {};
  const { meetings } = await getMeetings();
  const result = await checkMeetingConflicts({
    meetings,
    roomId,
    startTime,
    endTime,
    attendeeIds: inviteeIds,
    attendeeCount,
    organizerId: req.user.id,
    excludeMeetingId,
    isAdmin: req.user.role === 'admin',
    resolveUserName: (id) => findUserById(id).then((u) => u?.displayName || `成员#${id}`),
  });
  res.json(result);
}));

app.post('/api/meetings', authMiddleware, asyncHandler(async (req, res) => {
  const { title, roomId, date, startTime, endTime, description, inviteeIds, forceScheduleConflict } = req.body || {};

  if (!title || !roomId || !date || !startTime || !endTime) {
    return res.status(400).json({ error: '请填写完整的会议信息' });
  }

  const startISO = buildDateTime(date, startTime);
  const endISO = buildDateTime(date, endTime);
  const data = await getMeetings();
  const conflict = await checkMeetingConflicts({
    meetings: data.meetings,
    roomId,
    startTime: startISO,
    endTime: endISO,
    attendeeIds: inviteeIds || [],
    organizerId: req.user.id,
    isAdmin: req.user.role === 'admin',
    resolveUserName: (id) => findUserById(id).then((u) => u?.displayName || `成员#${id}`),
  });

  if (!conflict.ok) {
    return res.status(409).json({ error: conflict.errors.join('；'), conflicts: conflict });
  }
  if (conflict.hasScheduleConflict && !forceScheduleConflict) {
    return res.status(409).json({
      error: '存在成员日程冲突',
      conflicts: conflict,
      requireConfirm: true,
    });
  }

  const meeting = {
    id: data.nextId++,
    title,
    roomId: String(roomId),
    organizerId: req.user.id,
    startTime: startISO,
    endTime: endISO,
    description: description || '',
    inviteeIds: (inviteeIds || []).map(Number),
    attendeeCount: (inviteeIds || []).length + 1,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
  };
  data.meetings.push(meeting);
  await saveMeetings(data);
  res.status(201).json(await enrichMeeting(meeting));
}));

app.put('/api/meetings/:id', authMiddleware, asyncHandler(async (req, res) => {
  const data = await getMeetings();
  const idx = data.meetings.findIndex((m) => m.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '会议不存在' });

  const existing = data.meetings[idx];
  const isOwner = existing.organizerId === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: '无权修改此会议' });
  }

  const { title, roomId, date, startTime, endTime, description, inviteeIds, attendeeCount, forceScheduleConflict } = req.body || {};
  const startISO = date && startTime ? buildDateTime(date, startTime) : existing.startTime;
  const endISO = date && endTime ? buildDateTime(date, endTime) : existing.endTime;

  const conflict = await checkMeetingConflicts({
    meetings: data.meetings,
    roomId: roomId || existing.roomId,
    startTime: startISO,
    endTime: endISO,
    attendeeIds: inviteeIds !== undefined ? inviteeIds : existing.inviteeIds,
    attendeeCount: attendeeCount || existing.attendeeCount,
    organizerId: existing.organizerId,
    excludeMeetingId: existing.id,
    isAdmin,
    resolveUserName: (id) => findUserById(id).then((u) => u?.displayName || `成员#${id}`),
  });

  if (!conflict.ok) {
    return res.status(409).json({ error: conflict.errors.join('；'), conflicts: conflict });
  }
  if (conflict.hasScheduleConflict && !forceScheduleConflict) {
    return res.status(409).json({
      error: '存在成员日程冲突',
      conflicts: conflict,
      requireConfirm: true,
    });
  }

  const nextInviteeIds = inviteeIds !== undefined ? inviteeIds.map(Number) : existing.inviteeIds;
  data.meetings[idx] = {
    ...existing,
    title: title ?? existing.title,
    roomId: roomId != null ? String(roomId) : existing.roomId,
    startTime: date && startTime ? startISO : existing.startTime,
    endTime: date && endTime ? endISO : existing.endTime,
    description: description ?? existing.description,
    inviteeIds: nextInviteeIds,
    attendeeCount: inviteeIds !== undefined ? nextInviteeIds.length + 1 : (attendeeCount ?? existing.attendeeCount),
    updatedAt: new Date().toISOString(),
  };
  await saveMeetings(data);
  res.json(await enrichMeeting(data.meetings[idx]));
}));

app.delete('/api/meetings/:id', authMiddleware, asyncHandler(async (req, res) => {
  const data = await getMeetings();
  const idx = data.meetings.findIndex((m) => m.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '会议不存在' });

  const existing = data.meetings[idx];
  if (existing.organizerId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权取消此会议' });
  }

  data.meetings[idx] = { ...existing, status: 'cancelled', cancelledAt: new Date().toISOString() };
  await saveMeetings(data);
  res.json({ ok: true });
}));

// ── Schedules ───────────────────────────────────────────────────────────────

app.get('/api/schedules/:userId/busy', authMiddleware, asyncHandler(async (req, res) => {
  const uid = Number(req.params.userId);
  const user = await findUserById(uid);
  if (!user) return res.status(404).json({ error: '成员不存在' });

  const { date } = req.query;
  if (!date) return res.status(400).json({ error: '缺少 date 参数' });

  const { meetings } = await getMeetings();
  const busy = meetings
    .filter(
      (m) =>
        m.status !== 'cancelled' &&
        (m.organizerId === uid || (m.inviteeIds || []).includes(uid)),
    )
    .filter((m) => datePartOf(m.startTime) === date)
    .sort((a, b) => parseDateTimeValue(a.startTime) - parseDateTimeValue(b.startTime))
    .map((m) => ({ startTime: m.startTime, endTime: m.endTime }));

  res.json({ user: publicUser(user), date, busySlots: busy });
}));

app.get('/api/schedules/:userId', authMiddleware, asyncHandler(async (req, res) => {
  const uid = Number(req.params.userId);
  const user = await findUserById(uid);
  if (!user) return res.status(404).json({ error: '成员不存在' });

  const { date } = req.query;
  const { meetings } = await getMeetings();
  let schedule = meetings.filter(
    (m) =>
      m.status !== 'cancelled' &&
      (m.organizerId === uid || (m.inviteeIds || []).includes(uid)),
  );

  if (date) {
    schedule = schedule.filter((m) => datePartOf(m.startTime) === date);
  }

  schedule.sort((a, b) => parseDateTimeValue(a.startTime) - parseDateTimeValue(b.startTime));
  res.json({
    user: publicUser(user),
    meetings: await Promise.all(schedule.map(enrichMeeting)),
  });
}));

// ── Static ──────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

module.exports = app;

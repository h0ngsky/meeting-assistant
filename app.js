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
  publicUser,
  adminUserView,
} = require('./lib/db');
const { authMiddleware, login, requireAdmin } = require('./lib/auth');
const { ROOMS } = require('./lib/rooms');
const { checkMeetingConflicts } = require('./lib/conflicts');

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

app.get('/api/rooms', authMiddleware, (_req, res) => {
  res.json(ROOMS);
});

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

// ── Meetings ────────────────────────────────────────────────────────────────

async function enrichMeeting(m) {
  const organizer = await findUserById(m.organizerId);
  const invitees = await Promise.all(
    (m.inviteeIds || []).map((id) => findUserById(id)),
  );
  const room = ROOMS.find((r) => r.id === m.roomId);
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
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);
    meetings = meetings.filter((m) => {
      const s = new Date(m.startTime);
      return s >= dayStart && s <= dayEnd;
    });
  }
  if (roomId) meetings = meetings.filter((m) => m.roomId === roomId);
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

  const meetingStart = new Date(m.startTime);
  const meetingEnd = new Date(m.endTime);
  const date = req.query.date || meetingStart.toISOString().slice(0, 10);
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  const participantIds = [...new Set([m.organizerId, ...(m.inviteeIds || [])])];

  const participants = (await Promise.all(participantIds.map(async (uid) => {
    const user = await findUserById(uid);
    if (!user) return null;

    const dayMeetings = meetings
      .filter(
        (item) =>
          item.status !== 'cancelled' &&
          (item.organizerId === uid || (item.inviteeIds || []).includes(uid)) &&
          new Date(item.startTime) >= dayStart &&
          new Date(item.startTime) <= dayEnd,
      )
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
      .map((item) => {
        const s = new Date(item.startTime);
        const e = new Date(item.endTime);
        const isCurrent = item.id === m.id;
        const overlapsCurrent = !isCurrent && s < meetingEnd && e > meetingStart;
        return {
          id: item.id,
          title: item.title,
          startTime: item.startTime,
          endTime: item.endTime,
          roomId: item.roomId,
          room: ROOMS.find((r) => r.id === item.roomId) || null,
          role: item.organizerId === uid ? 'organizer' : 'invitee',
          isCurrent,
          overlapsCurrent,
        };
      });

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

  const startISO = `${date}T${startTime}:00`;
  const endISO = `${date}T${endTime}:00`;
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
    roomId,
    organizerId: req.user.id,
    startTime: new Date(startISO).toISOString(),
    endTime: new Date(endISO).toISOString(),
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
  const startISO = date && startTime ? `${date}T${startTime}:00` : existing.startTime;
  const endISO = date && endTime ? `${date}T${endTime}:00` : existing.endTime;

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

  data.meetings[idx] = {
    ...existing,
    title: title ?? existing.title,
    roomId: roomId ?? existing.roomId,
    startTime: date && startTime ? new Date(startISO).toISOString() : existing.startTime,
    endTime: date && endTime ? new Date(endISO).toISOString() : existing.endTime,
    description: description ?? existing.description,
    inviteeIds: inviteeIds !== undefined ? inviteeIds.map(Number) : existing.inviteeIds,
    attendeeCount: attendeeCount ?? existing.attendeeCount,
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
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);
    schedule = schedule.filter((m) => {
      const s = new Date(m.startTime);
      return s >= dayStart && s <= dayEnd;
    });
  }

  schedule.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
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

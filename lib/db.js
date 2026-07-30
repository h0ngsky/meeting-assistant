const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MEETINGS_FILE = path.join(DATA_DIR, 'meetings.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

const DEFAULT_ROOMS = [
  { id: '201', name: '会议室 201', capacity: 6 },
  { id: '202', name: '会议室 202', capacity: 8 },
  { id: '203', name: '会议室 203', capacity: 10 },
  { id: '204', name: '会议室 204', capacity: 12 },
  { id: '205', name: '会议室 205', capacity: 12 },
];

const USE_REDIS = !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL);
const KV_USERS_KEY = 'meeting-assistant:users';
const KV_MEETINGS_KEY = 'meeting-assistant:meetings';
const KV_ROOMS_KEY = 'meeting-assistant:rooms';

function getRedis() {
  if (!USE_REDIS) return null;
  // eslint-disable-next-line global-require
  const { Redis } = require('@upstash/redis');
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return new Redis({ url, token });
  return Redis.fromEnv();
}

async function ensureDataDir() {
  if (USE_REDIS) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJsonFile(file, fallback) {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.writeFile(file, JSON.stringify(fallback, null, 2));
      return structuredClone(fallback);
    }
    throw err;
  }
}

async function writeJsonFile(file, data) {
  await ensureDataDir();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

async function readStore(kind, fallback) {
  if (USE_REDIS) {
    const redis = getRedis();
    const key = kind === 'users' ? KV_USERS_KEY : kind === 'rooms' ? KV_ROOMS_KEY : KV_MEETINGS_KEY;
    const data = await redis.get(key);
    return data || structuredClone(fallback);
  }
  const file = kind === 'users' ? USERS_FILE : kind === 'rooms' ? ROOMS_FILE : MEETINGS_FILE;
  return readJsonFile(file, fallback);
}

async function writeStore(kind, data) {
  if (USE_REDIS) {
    const redis = getRedis();
    const key = kind === 'users' ? KV_USERS_KEY : kind === 'rooms' ? KV_ROOMS_KEY : KV_MEETINGS_KEY;
    await redis.set(key, data);
    return;
  }
  const file = kind === 'users' ? USERS_FILE : kind === 'rooms' ? ROOMS_FILE : MEETINGS_FILE;
  await writeJsonFile(file, data);
}

async function initDb() {
  const users = await readStore('users', { users: [], nextId: 1 });
  if (users.users.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    users.users.push({
      id: 1,
      username: 'admin',
      passwordHash: hash,
      passwordPlain: 'admin123',
      displayName: '系统管理员',
      role: 'admin',
      createdAt: new Date().toISOString(),
    });
    users.nextId = 2;
    await writeStore('users', users);
  }
  await readStore('meetings', { meetings: [], nextId: 1 });
  const rooms = await readStore('rooms', { rooms: [] });
  if (rooms.rooms.length === 0) {
    rooms.rooms = structuredClone(DEFAULT_ROOMS);
    await writeStore('rooms', rooms);
  }
}

async function getUsers() {
  return readStore('users', { users: [], nextId: 1 });
}

async function saveUsers(data) {
  await writeStore('users', data);
}

async function getMeetings() {
  return readStore('meetings', { meetings: [], nextId: 1 });
}

async function saveMeetings(data) {
  await writeStore('meetings', data);
}

async function findUserByUsername(username) {
  const { users } = await getUsers();
  return users.find((u) => u.username === username) || null;
}

async function findUserById(id) {
  const { users } = await getUsers();
  return users.find((u) => u.id === id) || null;
}

async function createUser({ username, password, displayName, role = 'member' }) {
  const data = await getUsers();
  if (data.users.some((u) => u.username === username)) {
    return { error: '用户名已存在' };
  }
  const user = {
    id: data.nextId++,
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    passwordPlain: password,
    displayName: displayName || username,
    role,
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  await saveUsers(data);
  return { user };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

async function updateUserProfile(userId, { displayName }) {
  const data = await getUsers();
  const idx = data.users.findIndex((u) => u.id === userId);
  if (idx === -1) return { error: '用户不存在' };
  if (!displayName || !displayName.trim()) return { error: '姓名不能为空' };
  data.users[idx].displayName = displayName.trim();
  data.users[idx].updatedAt = new Date().toISOString();
  await saveUsers(data);
  return { user: data.users[idx] };
}

async function updateUserPassword(userId, { oldPassword, newPassword }) {
  const data = await getUsers();
  const idx = data.users.findIndex((u) => u.id === userId);
  if (idx === -1) return { error: '用户不存在' };
  const user = data.users[idx];
  if (!bcrypt.compareSync(oldPassword, user.passwordHash)) {
    return { error: '原密码错误' };
  }
  if (!newPassword || newPassword.length < 6) {
    return { error: '新密码至少 6 个字符' };
  }
  data.users[idx].passwordHash = bcrypt.hashSync(newPassword, 10);
  data.users[idx].passwordPlain = newPassword;
  data.users[idx].updatedAt = new Date().toISOString();
  await saveUsers(data);
  return { ok: true };
}

function adminUserView(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    password: user.passwordPlain || '—',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt || null,
  };
}

async function deleteUser(userId) {
  const data = await getUsers();
  const idx = data.users.findIndex((u) => u.id === userId);
  if (idx === -1) return { error: '用户不存在' };
  const user = data.users[idx];
  if (user.role === 'admin') {
    const adminCount = data.users.filter((u) => u.role === 'admin').length;
    if (adminCount <= 1) return { error: '不能删除唯一的管理员账号' };
  }
  data.users.splice(idx, 1);
  await saveUsers(data);
  return { ok: true };
}

async function getRoomsList() {
  const data = await readStore('rooms', { rooms: structuredClone(DEFAULT_ROOMS) });
  return data.rooms;
}

async function findRoomById(roomId) {
  const rooms = await getRoomsList();
  return rooms.find((r) => r.id === roomId) || null;
}

async function createRoom({ id, name, capacity }) {
  const data = await readStore('rooms', { rooms: [] });
  const roomId = String(id || '').trim();
  const roomName = String(name || '').trim();
  const cap = Number(capacity);
  if (!roomId || !roomName) return { error: '请填写会议室编号和名称' };
  if (!Number.isFinite(cap) || cap < 1) return { error: '容量至少 1 人' };
  if (data.rooms.some((r) => r.id === roomId)) return { error: '会议室编号已存在' };
  const room = {
    id: roomId,
    name: roomName,
    capacity: cap,
    createdAt: new Date().toISOString(),
  };
  data.rooms.push(room);
  await writeStore('rooms', data);
  return { room };
}

async function deleteRoom(roomId) {
  const data = await readStore('rooms', { rooms: [] });
  const idx = data.rooms.findIndex((r) => r.id === roomId);
  if (idx === -1) return { error: '会议室不存在' };
  const { meetings } = await getMeetings();
  const hasActive = meetings.some((m) => m.roomId === roomId && m.status !== 'cancelled');
  if (hasActive) return { error: '该会议室仍有未取消的会议，无法删除' };
  data.rooms.splice(idx, 1);
  await writeStore('rooms', data);
  return { ok: true };
}

function isKvMode() {
  return USE_REDIS;
}

module.exports = {
  initDb,
  getUsers,
  saveUsers,
  getMeetings,
  saveMeetings,
  findUserByUsername,
  findUserById,
  createUser,
  updateUserProfile,
  updateUserPassword,
  deleteUser,
  getRoomsList,
  findRoomById,
  createRoom,
  deleteRoom,
  publicUser,
  adminUserView,
  isKvMode,
};

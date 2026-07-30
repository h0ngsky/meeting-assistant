const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MEETINGS_FILE = path.join(DATA_DIR, 'meetings.json');

const USE_REDIS = !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL);
const KV_USERS_KEY = 'meeting-assistant:users';
const KV_MEETINGS_KEY = 'meeting-assistant:meetings';

function getRedis() {
  if (!USE_REDIS) return null;
  if (process.env.UPSTASH_REDIS_REST_URL) {
    // eslint-disable-next-line global-require
    const { Redis } = require('@upstash/redis');
    return Redis.fromEnv();
  }
  // 兼容旧版 Vercel KV
  // eslint-disable-next-line global-require
  return require('@vercel/kv').kv;
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
    const key = kind === 'users' ? KV_USERS_KEY : KV_MEETINGS_KEY;
    const data = await redis.get(key);
    return data || structuredClone(fallback);
  }
  const file = kind === 'users' ? USERS_FILE : MEETINGS_FILE;
  return readJsonFile(file, fallback);
}

async function writeStore(kind, data) {
  if (USE_REDIS) {
    const redis = getRedis();
    const key = kind === 'users' ? KV_USERS_KEY : KV_MEETINGS_KEY;
    await redis.set(key, data);
    return;
  }
  const file = kind === 'users' ? USERS_FILE : MEETINGS_FILE;
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
      displayName: '系统管理员',
      role: 'admin',
      createdAt: new Date().toISOString(),
    });
    users.nextId = 2;
    await writeStore('users', users);
  }
  await readStore('meetings', { meetings: [], nextId: 1 });
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
  data.users[idx].updatedAt = new Date().toISOString();
  await saveUsers(data);
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
  publicUser,
  isKvMode,
};

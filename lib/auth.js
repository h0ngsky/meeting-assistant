const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { findUserByUsername, publicUser } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'meeting-assistant-secret-key-change-in-prod';
const JWT_EXPIRES = '7d';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES },
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '请先登录' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  req.user = payload;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

async function login(username, password) {
  const user = await findUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return { error: '用户名或密码错误' };
  }
  return { token: signToken(user), user: publicUser(user) };
}

module.exports = {
  signToken,
  verifyToken,
  authMiddleware,
  requireAdmin,
  login,
};

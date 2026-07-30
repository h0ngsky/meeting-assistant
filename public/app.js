/* global fetch */

const API = '/api';
let token = localStorage.getItem('token');
let currentUser = null;
let rooms = [];
let users = [];
let selectedInvitees = new Set();

// ── API helpers ─────────────────────────────────────────────────────────────

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || '请求失败');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ── Auth ────────────────────────────────────────────────────────────────────

function showAuth() {
  document.getElementById('auth-page').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-page').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  updateUserBadge();
}

function updateUserBadge() {
  const badge = document.getElementById('user-badge');
  if (!currentUser) return;
  badge.textContent = `${currentUser.displayName} (${currentUser.role === 'admin' ? '管理员' : '成员'})`;
  badge.className = `user-badge${currentUser.role === 'admin' ? ' admin' : ''}`;
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    showApp();
    await initApp();
  } catch (err) {
    showAuthError(err.message);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const displayName = document.getElementById('reg-display').value.trim();
  const password = document.getElementById('reg-password').value;
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName }),
    });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    showApp();
    await initApp();
  } catch (err) {
    showAuthError(err.message);
  }
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  showAuth();
}

async function tryAutoLogin() {
  if (!token) return showAuth();
  try {
    currentUser = await api('/auth/me');
    showApp();
    await initApp();
  } catch {
    token = null;
    localStorage.removeItem('token');
    showAuth();
  }
}

// ── Navigation ──────────────────────────────────────────────────────────────

function switchView(view) {
  document.querySelectorAll('.nav-item').forEach((n) => {
    n.classList.toggle('active', n.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');

  if (view === 'rooms') loadRoomGrid();
  if (view === 'my-meetings') loadMyMeetings();
  if (view === 'schedules') loadSchedule();
  if (view === 'profile') loadProfile();
}

// ── Date helpers ────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return fmtDate(d);
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

// ── Room grid ───────────────────────────────────────────────────────────────

async function loadRoomGrid() {
  const date = document.getElementById('room-date').value || todayStr();
  document.getElementById('room-date').value = date;

  const meetings = await api(`/meetings?date=${date}`);
  const grid = document.getElementById('room-grid');
  grid.innerHTML = '';

  for (const room of rooms) {
    const roomMeetings = meetings.filter((m) => m.roomId === room.id);
    grid.appendChild(buildRoomCard(room, roomMeetings, date));
  }
}

function buildRoomCard(room, meetings, date) {
  const card = document.createElement('div');
  card.className = 'room-card';

  const hours = [];
  for (let h = 8; h <= 20; h++) hours.push(h);

  let slotsHtml = '';
  for (const h of hours) {
    const timeLabel = `${String(h).padStart(2, '0')}:00`;
    const slotStart = new Date(`${date}T${timeLabel}:00`);
    const slotEnd = new Date(slotStart);
    slotEnd.setHours(slotEnd.getHours() + 1);

    const isLunch = h === 12 || h === 13;
    const meeting = meetings.find((m) => {
      const ms = new Date(m.startTime);
      const me = new Date(m.endTime);
      return ms < slotEnd && me > slotStart;
    });

    let barClass = 'free';
    let content = '';
    if (isLunch) {
      barClass = 'lunch';
      content = '<span class="slot-meeting">午休禁约</span>';
    } else if (meeting) {
      barClass = 'busy';
      content = `<span class="slot-meeting">${meeting.title} (${fmtTime(meeting.startTime)}-${fmtTime(meeting.endTime)})</span>`;
    }

    slotsHtml += `
      <div class="time-slot">
        <span class="slot-time">${timeLabel}</span>
        <div class="slot-bar ${barClass}" data-meeting-id="${meeting ? meeting.id : ''}">
          ${content}
        </div>
      </div>`;
  }

  card.innerHTML = `
    <div class="room-card-header">
      <h3>${room.name}</h3>
      <div class="capacity">最大容量 ${room.capacity} 人</div>
    </div>
    <div class="room-timeline">${slotsHtml}</div>`;

  card.querySelectorAll('.slot-bar.busy').forEach((bar) => {
    bar.addEventListener('click', () => {
      const id = bar.dataset.meetingId;
      if (id) showMeetingDetail(Number(id));
    });
  });

  return card;
}

// ── My meetings ─────────────────────────────────────────────────────────────

async function loadMyMeetings() {
  const meetings = await api('/meetings/my');
  const list = document.getElementById('my-meetings-list');

  if (meetings.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>暂无会议，去发起一个吧</p></div>';
    return;
  }

  meetings.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  list.innerHTML = meetings.map((m) => {
    const isOrganizer = m.organizerId === currentUser.id;
    const tag = isOrganizer
      ? '<span class="meeting-tag organizer">我发起的</span>'
      : '<span class="meeting-tag invitee">受邀参加</span>';
    return `
      <div class="meeting-card" data-id="${m.id}">
        <div class="meeting-card-info">
          <h4>${tag}${escapeHtml(m.title)}</h4>
          <p>${m.room?.name || m.roomId} · ${fmtDate(new Date(m.startTime))} ${fmtTime(m.startTime)}-${fmtTime(m.endTime)}</p>
          <p>发起人：${m.organizer?.displayName || '未知'} · 参会 ${m.attendeeCount} 人</p>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.meeting-card').forEach((card) => {
    card.addEventListener('click', () => showMeetingDetail(Number(card.dataset.id)));
  });
}

// ── Schedule ────────────────────────────────────────────────────────────────

async function loadSchedule() {
  const userId = document.getElementById('schedule-user').value;
  const date = document.getElementById('schedule-date').value || todayStr();
  document.getElementById('schedule-date').value = date;

  if (!userId) {
    document.getElementById('schedule-timeline').innerHTML =
      '<div class="empty-state"><div class="icon">👤</div><p>请选择成员</p></div>';
    return;
  }

  const data = await api(`/schedules/${userId}?date=${date}`);
  const container = document.getElementById('schedule-timeline');
  const initial = data.user.displayName.charAt(0).toUpperCase();

  if (data.meetings.length === 0) {
    container.innerHTML = `
      <div class="schedule-user-header">
        <div class="avatar">${initial}</div>
        <div><strong>${escapeHtml(data.user.displayName)}</strong><br><span style="font-size:13px;color:var(--text-secondary)">${date} 无会议安排</span></div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="schedule-user-header">
      <div class="avatar">${initial}</div>
      <div><strong>${escapeHtml(data.user.displayName)}</strong><br><span style="font-size:13px;color:var(--text-secondary)">${date} 共 ${data.meetings.length} 场会议</span></div>
    </div>
    ${data.meetings.map((m) => `
      <div class="schedule-item" data-id="${m.id}" style="cursor:pointer">
        <div class="schedule-time">${fmtTime(m.startTime)}<br>${fmtTime(m.endTime)}</div>
        <div class="schedule-detail">
          <h4>${escapeHtml(m.title)}</h4>
          <p>${m.room?.name || m.roomId} · 发起人：${m.organizer?.displayName || '未知'}</p>
        </div>
      </div>`).join('')}`;

  container.querySelectorAll('.schedule-item').forEach((item) => {
    item.addEventListener('click', () => showMeetingDetail(Number(item.dataset.id)));
  });
}

function populateUserSelect() {
  const sel = document.getElementById('schedule-user');
  sel.innerHTML = users.map((u) =>
    `<option value="${u.id}">${escapeHtml(u.displayName)} (${u.username})</option>`,
  ).join('');
  if (users.length > 0 && currentUser) {
    sel.value = currentUser.id;
  }
}

// ── Profile ─────────────────────────────────────────────────────────────────

function loadProfile() {
  if (!currentUser) return;
  document.getElementById('profile-name').value = currentUser.displayName || '';
  document.getElementById('profile-msg').classList.add('hidden');
  document.getElementById('password-msg').classList.add('hidden');
  document.getElementById('old-password').value = '';
  document.getElementById('new-password').value = '';
  document.getElementById('confirm-password').value = '';
}

function showProfileMsg(elId, msg, type) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.className = `profile-msg ${type}`;
}

async function handleProfileUpdate(e) {
  e.preventDefault();
  const displayName = document.getElementById('profile-name').value.trim();
  if (!displayName) {
    showProfileMsg('profile-msg', '姓名不能为空', 'error');
    return;
  }
  try {
    currentUser = await api('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    });
    updateUserBadge();
    users = await api('/users');
    populateUserSelect();
    renderInviteeList();
    showProfileMsg('profile-msg', '姓名已更新', 'success');
  } catch (err) {
    showProfileMsg('profile-msg', err.message, 'error');
  }
}

async function handlePasswordUpdate(e) {
  e.preventDefault();
  const oldPassword = document.getElementById('old-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;
  if (!oldPassword || !newPassword) {
    showProfileMsg('password-msg', '请填写完整', 'error');
    return;
  }
  if (newPassword.length < 6) {
    showProfileMsg('password-msg', '新密码至少 6 个字符', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showProfileMsg('password-msg', '两次新密码不一致', 'error');
    return;
  }
  try {
    await api('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    document.getElementById('old-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
    showProfileMsg('password-msg', '密码已修改', 'success');
  } catch (err) {
    showProfileMsg('password-msg', err.message, 'error');
  }
}

// ── Meeting form ────────────────────────────────────────────────────────────

function populateRoomSelect() {
  const sel = document.getElementById('m-room');
  sel.innerHTML = rooms.map((r) =>
    `<option value="${r.id}">${r.name}（${r.capacity}人）</option>`,
  ).join('');
}

function renderInviteeList() {
  const container = document.getElementById('invitee-list');
  const others = users.filter((u) => u.id !== currentUser?.id);
  if (others.length === 0) {
    container.innerHTML = '<span style="color:var(--text-secondary);font-size:13px">暂无其他成员</span>';
    return;
  }
  container.innerHTML = others.map((u) => {
    const selected = selectedInvitees.has(u.id);
    return `<label class="invitee-chip${selected ? ' selected' : ''}" data-id="${u.id}">
      <input type="checkbox" ${selected ? 'checked' : ''}>
      ${escapeHtml(u.displayName)}
    </label>`;
  }).join('');

  container.querySelectorAll('.invitee-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const id = Number(chip.dataset.id);
      if (selectedInvitees.has(id)) selectedInvitees.delete(id);
      else selectedInvitees.add(id);
      renderInviteeList();
    });
  });
}

function getMeetingFormData() {
  const inviteeIds = [...selectedInvitees];
  return {
    title: document.getElementById('m-title').value.trim(),
    date: document.getElementById('m-date').value,
    roomId: document.getElementById('m-room').value,
    startTime: document.getElementById('m-start').value,
    endTime: document.getElementById('m-end').value,
    inviteeIds,
    description: document.getElementById('m-desc').value.trim(),
  };
}

function showConflictResult(result) {
  const el = document.getElementById('conflict-result');
  el.classList.remove('hidden', 'error', 'warning', 'success');

  if (!result.ok) {
    el.className = 'conflict-result error';
    el.innerHTML = `<strong>❌ 无法预约</strong><br>${result.errors.map(escapeHtml).join('<br>')}`;
    return;
  }
  if (result.hasScheduleConflict) {
    el.className = 'conflict-result warning';
    const msgs = result.warnings.map((w) => escapeHtml(w.message)).join('<br>');
    el.innerHTML = `<strong>⚠️ 成员日程冲突</strong><br>${msgs}<br><em>仍可强制创建</em>`;
    return;
  }
  el.className = 'conflict-result success';
  el.innerHTML = '<strong>✅ 无冲突，可以预约</strong>';
}

async function checkConflicts() {
  const form = getMeetingFormData();
  if (!form.date || !form.roomId || !form.startTime || !form.endTime) {
    alert('请先填写日期、会议室和时间');
    return null;
  }
  try {
    const result = await api('/meetings/check-conflicts', {
      method: 'POST',
      body: JSON.stringify({
        roomId: form.roomId,
        startTime: `${form.date}T${form.startTime}:00`,
        endTime: `${form.date}T${form.endTime}:00`,
        inviteeIds: form.inviteeIds,
      }),
    });
    showConflictResult(result);
    return result;
  } catch (err) {
    if (err.data?.conflicts) {
      showConflictResult(err.data.conflicts);
      return err.data.conflicts;
    }
    alert(err.message);
    return null;
  }
}

async function createMeeting(e, force = false) {
  e.preventDefault();
  const form = getMeetingFormData();
  if (!form.title) { alert('请输入会议主题'); return; }

  try {
    await api('/meetings', {
      method: 'POST',
      body: JSON.stringify({ ...form, forceScheduleConflict: force }),
    });
    alert('会议创建成功！');
    document.getElementById('meeting-form').reset();
    document.getElementById('m-start').value = '09:00';
    document.getElementById('m-end').value = '10:00';
    selectedInvitees.clear();
    renderInviteeList();
    document.getElementById('conflict-result').classList.add('hidden');
    switchView('my-meetings');
  } catch (err) {
    if (err.data?.requireConfirm) {
      const ok = confirm(`${err.message}\n\n部分成员在该时段已有其他会议，是否仍要创建？`);
      if (ok) {
        await api('/meetings', {
          method: 'POST',
          body: JSON.stringify({ ...form, forceScheduleConflict: true }),
        });
        alert('会议创建成功！');
        switchView('my-meetings');
      }
      return;
    }
    if (err.data?.conflicts) showConflictResult(err.data.conflicts);
    else alert(err.message);
  }
}

// ── Meeting detail modal ────────────────────────────────────────────────────

async function showMeetingDetail(id) {
  const [m, scheduleData] = await Promise.all([
    api(`/meetings/${id}`),
    api(`/meetings/${id}/participant-schedules`),
  ]);
  const overlay = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = m.title;

  const inviteeNames = m.invitees.map((i) => i.displayName).join('、') || '无';

  let participantHtml = '';
  if (scheduleData.participants.length > 0) {
    participantHtml = `
      <div class="participant-schedules">
        <h4>参会人员日程（${scheduleData.date}）</h4>
        ${scheduleData.participants.map((p) => {
          const initial = p.user.displayName.charAt(0).toUpperCase();
          const meetingsHtml = p.meetings.length === 0
            ? '<div class="participant-empty">当日无其他会议</div>'
            : p.meetings.map((item) => {
              const cls = [
                'participant-meeting',
                item.isCurrent ? 'current' : '',
                item.overlapsCurrent ? 'conflict' : '',
              ].filter(Boolean).join(' ');
              const tag = item.isCurrent ? '【本场】' : item.overlapsCurrent ? '【冲突】' : '';
              return `
                <div class="${cls}">
                  <div class="participant-meeting-time">${fmtTime(item.startTime)}-${fmtTime(item.endTime)}</div>
                  <div class="participant-meeting-info">
                    <strong>${tag}${escapeHtml(item.title)}</strong>
                    <span>${item.room?.name || item.roomId}${item.role === 'organizer' ? ' · 发起' : ' · 受邀'}</span>
                  </div>
                </div>`;
            }).join('');
          return `
            <div class="participant-card${p.hasConflict ? ' has-conflict' : ''}">
              <div class="participant-card-header">
                <div class="avatar">${initial}</div>
                <span class="name">${escapeHtml(p.user.displayName)}</span>
                ${p.hasConflict ? '<span class="conflict-badge">日程冲突</span>' : ''}
              </div>
              ${meetingsHtml}
            </div>`;
        }).join('')}
      </div>`;
  }

  document.getElementById('modal-body').innerHTML = `
    <div class="detail-row"><div class="detail-label">会议室</div>${escapeHtml(m.room?.name || m.roomId)}（${m.room?.capacity || '?'}人）</div>
    <div class="detail-row"><div class="detail-label">时间</div>${fmtDate(new Date(m.startTime))} ${fmtTime(m.startTime)} - ${fmtTime(m.endTime)}</div>
    <div class="detail-row"><div class="detail-label">发起人</div>${escapeHtml(m.organizer?.displayName || '未知')}</div>
    <div class="detail-row"><div class="detail-label">参会人数</div>${m.attendeeCount} 人</div>
    <div class="detail-row"><div class="detail-label">受邀成员</div>${escapeHtml(inviteeNames)}</div>
    ${m.description ? `<div class="detail-row"><div class="detail-label">说明</div>${escapeHtml(m.description)}</div>` : ''}
    ${participantHtml}`;

  const actions = document.getElementById('modal-actions');
  const canCancel = m.organizerId === currentUser.id || currentUser.role === 'admin';
  actions.innerHTML = canCancel
    ? '<button class="btn btn-danger" id="cancel-meeting-btn">取消会议</button>'
    : '';

  if (canCancel) {
    document.getElementById('cancel-meeting-btn').addEventListener('click', async () => {
      if (!confirm('确定取消此会议？')) return;
      await api(`/meetings/${id}`, { method: 'DELETE' });
      overlay.classList.add('hidden');
      loadMyMeetings();
      loadRoomGrid();
    });
  }

  overlay.classList.remove('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Init ────────────────────────────────────────────────────────────────────

async function initApp() {
  [rooms, users] = await Promise.all([api('/rooms'), api('/users')]);
  populateRoomSelect();
  populateUserSelect();
  renderInviteeList();

  const today = todayStr();
  document.getElementById('room-date').value = today;
  document.getElementById('schedule-date').value = today;
  document.getElementById('m-date').value = today;

  loadRoomGrid();
}

// ── Event listeners ─────────────────────────────────────────────────────────

document.getElementById('login-form').addEventListener('submit', handleLogin);
document.getElementById('register-form').addEventListener('submit', handleRegister);
document.getElementById('logout-btn').addEventListener('click', logout);

document.querySelectorAll('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    document.getElementById('login-form').classList.toggle('hidden', !isLogin);
    document.getElementById('register-form').classList.toggle('hidden', isLogin);
    document.getElementById('auth-error').classList.add('hidden');
  });
});

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => switchView(item.dataset.view));
});

document.getElementById('room-date').addEventListener('change', loadRoomGrid);
document.getElementById('prev-day').addEventListener('click', () => {
  document.getElementById('room-date').value = addDays(document.getElementById('room-date').value, -1);
  loadRoomGrid();
});
document.getElementById('next-day').addEventListener('click', () => {
  document.getElementById('room-date').value = addDays(document.getElementById('room-date').value, 1);
  loadRoomGrid();
});
document.getElementById('today-btn').addEventListener('click', () => {
  document.getElementById('room-date').value = todayStr();
  loadRoomGrid();
});

document.getElementById('schedule-user').addEventListener('change', loadSchedule);
document.getElementById('schedule-date').addEventListener('change', loadSchedule);

document.getElementById('check-conflict-btn').addEventListener('click', checkConflicts);
document.getElementById('meeting-form').addEventListener('submit', (e) => createMeeting(e, false));
document.getElementById('profile-form').addEventListener('submit', handleProfileUpdate);
document.getElementById('password-form').addEventListener('submit', handlePasswordUpdate);

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.add('hidden');
});
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') {
    document.getElementById('modal-overlay').classList.add('hidden');
  }
});

tryAutoLogin();

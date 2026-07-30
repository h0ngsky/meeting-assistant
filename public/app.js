/* global fetch */

const API = '/api';
let token = localStorage.getItem('token');
let currentUser = null;
let rooms = [];
let users = [];
let selectedInvitees = new Set();
let qbInvitees = new Set();
let quickBookDraft = null;
let dragSelect = null;

const SLOT_MINUTES = 30;
const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 21 * 60;

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
  document.querySelectorAll('.nav-admin').forEach((el) => {
    el.classList.toggle('hidden', currentUser.role !== 'admin');
  });
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
  if (view === 'my-calendar') loadMyCalendar();
  if (view === 'schedules') loadSchedule();
  if (view === 'profile') loadProfile();
  if (view === 'members') loadMembersAdmin();
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

// ── Room grid & drag booking ────────────────────────────────────────────────

function slotOverlapsMeeting(slotStart, slotEnd, meeting) {
  const ms = new Date(meeting.startTime);
  const me = new Date(meeting.endTime);
  return ms < slotEnd && me > slotStart;
}

function isLunchPeriod(slotStart, slotEnd) {
  if (currentUser?.role === 'admin') return false;
  const lunchStart = new Date(slotStart);
  lunchStart.setHours(12, 30, 0, 0);
  const lunchEnd = new Date(slotStart);
  lunchEnd.setHours(14, 0, 0, 0);
  return slotStart < lunchEnd && slotEnd > lunchStart;
}

function buildRoomSlots(date, meetings) {
  const slots = [];
  for (let mins = DAY_START_MIN; mins < DAY_END_MIN; mins += SLOT_MINUTES) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const startStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const endMins = mins + SLOT_MINUTES;
    const endStr = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
    const slotStart = new Date(`${date}T${startStr}:00`);
    const slotEnd = new Date(`${date}T${endStr}:00`);

    let status = 'free';
    let meeting = null;
    if (isLunchPeriod(slotStart, slotEnd)) {
      status = 'lunch';
    } else {
      meeting = meetings.find((item) => slotOverlapsMeeting(slotStart, slotEnd, item));
      if (meeting) status = 'busy';
    }
    slots.push({ index: slots.length, startStr, endStr, slotStart, slotEnd, status, meeting });
  }
  return slots;
}

function formatDurationLabel(startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) return '0 小时';
  if (mins % 60 === 0) return `${mins / 60} 小时`;
  return `${(mins / 60).toFixed(1)} 小时`;
}

function clearDragHighlight(card) {
  if (!card) return;
  card.querySelectorAll('.slot-seg').forEach((el) => {
    el.classList.remove('drag-selecting');
  });
}

function rangeSelectable(slots, fromIdx, toIdx) {
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  for (let i = lo; i <= hi; i++) {
    if (slots[i].status !== 'free') return false;
  }
  return true;
}

function applyDragHighlight(card, slots, fromIdx, toIdx) {
  clearDragHighlight(card);
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  for (let i = lo; i <= hi; i++) {
    const el = card.querySelector(`.slot-seg[data-index="${i}"]`);
    if (el) el.classList.add('drag-selecting');
  }
}

function openQuickBookModal({ room, date, startTime, endTime }) {
  quickBookDraft = { roomId: room.id, roomName: room.name, date, startTime, endTime };
  const duration = formatDurationLabel(startTime, endTime);
  document.getElementById('book-summary').innerHTML = `
    <div class="book-summary-row"><span>会议室</span><strong>${escapeHtml(room.name)}</strong></div>
    <div class="book-summary-row"><span>日期</span><strong>${date}</strong></div>
    <div class="book-summary-row"><span>时段</span><strong>${startTime} – ${endTime}</strong></div>
    <div class="book-summary-row"><span>时长</span><strong class="duration-badge">${duration}</strong></div>`;
  document.getElementById('qb-title').value = '';
  document.getElementById('qb-desc').value = '';
  document.getElementById('qb-conflict-result').classList.add('hidden');
  qbInvitees = new Set();
  renderQbInviteeList();
  document.getElementById('book-modal-overlay').classList.remove('hidden');
}

function renderQbInviteeList() {
  const container = document.getElementById('qb-invitee-list');
  const others = users.filter((u) => u.id !== currentUser?.id);
  if (others.length === 0) {
    container.innerHTML = '<span style="color:var(--text-secondary);font-size:13px">暂无其他成员</span>';
    return;
  }
  container.innerHTML = others.map((u) => {
    const selected = qbInvitees.has(u.id);
    return `<label class="invitee-chip${selected ? ' selected' : ''}" data-id="${u.id}">
      <input type="checkbox" ${selected ? 'checked' : ''}>
      ${escapeHtml(u.displayName)}
    </label>`;
  }).join('');
  container.querySelectorAll('.invitee-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const id = Number(chip.dataset.id);
      if (qbInvitees.has(id)) qbInvitees.delete(id);
      else qbInvitees.add(id);
      renderQbInviteeList();
    });
  });
}

function showQbConflictResult(result) {
  const el = document.getElementById('qb-conflict-result');
  el.classList.remove('hidden', 'error', 'warning', 'success');
  if (!result.ok) {
    el.className = 'conflict-result error';
    el.innerHTML = `<strong>❌ 无法预约</strong><br>${result.errors.map(escapeHtml).join('<br>')}`;
    return;
  }
  if (result.hasScheduleConflict) {
    el.className = 'conflict-result warning';
    el.innerHTML = `<strong>⚠️ 成员日程冲突</strong><br>${result.warnings.map((w) => escapeHtml(w.message)).join('<br>')}<br><em>仍可强制创建</em>`;
    return;
  }
  el.className = 'conflict-result success';
  el.innerHTML = '<strong>✅ 无冲突，可以预约</strong>';
}

async function checkQuickBookConflicts() {
  if (!quickBookDraft) return null;
  const { roomId, date, startTime, endTime } = quickBookDraft;
  try {
    const result = await api('/meetings/check-conflicts', {
      method: 'POST',
      body: JSON.stringify({
        roomId,
        startTime: `${date}T${startTime}:00`,
        endTime: `${date}T${endTime}:00`,
        inviteeIds: [...qbInvitees],
      }),
    });
    showQbConflictResult(result);
    return result;
  } catch (err) {
    if (err.data?.conflicts) {
      showQbConflictResult(err.data.conflicts);
      return err.data.conflicts;
    }
    alert(err.message);
    return null;
  }
}

async function submitQuickBook(e, force = false) {
  e.preventDefault();
  if (!quickBookDraft) return;
  const title = document.getElementById('qb-title').value.trim();
  if (!title) { alert('请输入会议主题'); return; }

  const { roomId, date, startTime, endTime } = quickBookDraft;
  try {
    await api('/meetings', {
      method: 'POST',
      body: JSON.stringify({
        title,
        roomId,
        date,
        startTime,
        endTime,
        inviteeIds: [...qbInvitees],
        description: document.getElementById('qb-desc').value.trim(),
        forceScheduleConflict: force,
      }),
    });
    document.getElementById('book-modal-overlay').classList.add('hidden');
    quickBookDraft = null;
    alert('会议预约成功！');
    loadRoomGrid();
  } catch (err) {
    if (err.data?.requireConfirm) {
      const ok = confirm(`${err.message}\n\n部分成员在该时段已有其他会议，是否仍要创建？`);
      if (ok) {
        await api('/meetings', {
          method: 'POST',
          body: JSON.stringify({
            title,
            roomId,
            date,
            startTime,
            endTime,
            inviteeIds: [...qbInvitees],
            description: document.getElementById('qb-desc').value.trim(),
            forceScheduleConflict: true,
          }),
        });
        document.getElementById('book-modal-overlay').classList.add('hidden');
        quickBookDraft = null;
        alert('会议预约成功！');
        loadRoomGrid();
      }
      return;
    }
    if (err.data?.conflicts) showQbConflictResult(err.data.conflicts);
    else alert(err.message);
  }
}

function setupRoomCardDrag(card, room, slots, date) {
  card.querySelectorAll('.slot-seg.selectable').forEach((seg) => {
    seg.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const idx = Number(seg.dataset.index);
      dragSelect = { room, date, slots, anchorIdx: idx, cardEl: card };
      applyDragHighlight(card, slots, idx, idx);
    });
  });
}

document.addEventListener('mouseup', () => {
  if (!dragSelect) return;
  const { room, date, slots, anchorIdx, cardEl } = dragSelect;
  const selected = cardEl.querySelectorAll('.slot-seg.drag-selecting');
  if (selected.length > 0) {
    const indices = [...selected].map((el) => Number(el.dataset.index)).sort((a, b) => a - b);
    const startTime = slots[indices[0]].startStr;
    const endTime = slots[indices[indices.length - 1]].endStr;
    openQuickBookModal({ room, date, startTime, endTime });
  }
  clearDragHighlight(cardEl);
  dragSelect = null;
});

document.addEventListener('mousemove', (e) => {
  if (!dragSelect) return;
  const target = e.target.closest('.slot-seg.selectable');
  if (!target || !dragSelect.cardEl.contains(target)) return;
  const idx = Number(target.dataset.index);
  if (rangeSelectable(dragSelect.slots, dragSelect.anchorIdx, idx)) {
    applyDragHighlight(dragSelect.cardEl, dragSelect.slots, dragSelect.anchorIdx, idx);
  }
});

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
  const slots = buildRoomSlots(date, meetings);

  let rowsHtml = '';
  for (let h = 8; h < 21; h++) {
    const hourLabel = `${String(h).padStart(2, '0')}:00`;
    const halfSlots = slots.filter((s) => s.slotStart.getHours() === h);
    const segsHtml = halfSlots.map((s) => {
      let cls = `slot-seg ${s.status}`;
      let title = '';
      if (s.status === 'free') cls += ' selectable';
      if (s.status === 'lunch') title = '午休禁约';
      if (s.status === 'busy' && s.meeting) {
        title = `${s.meeting.title} (${fmtTime(s.meeting.startTime)}-${fmtTime(s.meeting.endTime)})`;
      }
      const meetingId = s.meeting ? s.meeting.id : '';
      return `<div class="${cls}" data-index="${s.index}" data-meeting-id="${meetingId}" title="${escapeHtml(title)}"></div>`;
    }).join('');

    rowsHtml += `
      <div class="time-slot">
        <span class="slot-time">${hourLabel}</span>
        <div class="slot-bars">${segsHtml}</div>
      </div>`;
  }

  card.innerHTML = `
    <div class="room-card-header">
      <h3>${room.name}</h3>
      <div class="capacity">最大容量 ${room.capacity} 人 · 拖拽选择时段</div>
    </div>
    <div class="room-timeline">${rowsHtml}</div>`;

  card.querySelectorAll('.slot-seg.busy').forEach((seg) => {
    seg.addEventListener('click', () => {
      const id = seg.dataset.meetingId;
      if (id) showMeetingDetail(Number(id));
    });
  });

  setupRoomCardDrag(card, room, slots, date);
  return card;
}

function addMonths(year, month, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function formatCalDayTitle(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${weekdays[d.getDay()]}`;
}

function getCalendarDays(year, month) {
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  let startPad = first.getDay() - 1;
  if (startPad < 0) startPad = 6;

  const days = [];
  for (let i = startPad - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push({ dateStr: fmtDate(d), dayNum: d.getDate(), otherMonth: true });
  }
  for (let d = 1; d <= lastDay; d++) {
    days.push({ dateStr: fmtDate(new Date(year, month, d)), dayNum: d, otherMonth: false });
  }
  let nextDay = 1;
  while (days.length < 42) {
    const d = new Date(year, month + 1, nextDay++);
    days.push({ dateStr: fmtDate(d), dayNum: d.getDate(), otherMonth: true });
  }
  return days;
}

function groupMeetingsByDate(meetings) {
  const map = {};
  meetings.forEach((m) => {
    const key = fmtDate(new Date(m.startTime));
    if (!map[key]) map[key] = [];
    map[key].push(m);
  });
  Object.values(map).forEach((list) => {
    list.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  });
  return map;
}

let calendarState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selectedDate: todayStr(),
  meetings: [],
};

function renderCalendarDayDetail(dateStr, byDate) {
  const titleEl = document.getElementById('cal-day-title');
  const subEl = document.getElementById('cal-day-subtitle');
  const container = document.getElementById('cal-day-meetings');
  const dayMeetings = byDate[dateStr] || [];

  titleEl.textContent = formatCalDayTitle(dateStr);
  subEl.textContent = dayMeetings.length
    ? `共 ${dayMeetings.length} 场会议`
    : '当天暂无会议安排';

  if (dayMeetings.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>这一天没有会议</p></div>';
    return;
  }

  container.innerHTML = dayMeetings.map((m) => {
    const isOrganizer = m.organizerId === currentUser.id;
    const tag = isOrganizer ? '我发起的' : '受邀参加';
    const tagCls = isOrganizer ? 'organizer' : 'invitee';
    return `
      <div class="cal-meeting-item" data-id="${m.id}">
        <div class="cal-meeting-time">${fmtTime(m.startTime)}<span>–</span>${fmtTime(m.endTime)}</div>
        <div class="cal-meeting-body">
          <div class="cal-meeting-title">
            <span class="meeting-tag ${tagCls}">${tag}</span>
            ${escapeHtml(m.title)}
          </div>
          <p>${escapeHtml(m.room?.name || m.roomId)} · 发起人：${escapeHtml(m.organizer?.displayName || '未知')}</p>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.cal-meeting-item').forEach((item) => {
    item.addEventListener('click', () => showMeetingDetail(Number(item.dataset.id)));
  });
}

function renderCalendarGrid() {
  const { year, month, selectedDate, meetings } = calendarState;
  document.getElementById('cal-month-label').textContent = `${year}年${month + 1}月`;

  const byDate = groupMeetingsByDate(meetings);
  const today = todayStr();
  const days = getCalendarDays(year, month);
  const grid = document.getElementById('calendar-grid');

  grid.innerHTML = days.map((day) => {
    const count = (byDate[day.dateStr] || []).length;
    const classes = [
      'cal-day',
      day.otherMonth ? 'other-month' : '',
      day.dateStr === today ? 'today' : '',
      day.dateStr === selectedDate ? 'selected' : '',
      count ? 'has-events' : '',
    ].filter(Boolean).join(' ');

    const dots = (byDate[day.dateStr] || []).slice(0, 3).map((m) => {
      const cls = m.organizerId === currentUser?.id ? 'dot-organizer' : 'dot-invitee';
      return `<span class="cal-dot ${cls}" title="${escapeHtml(m.title)}"></span>`;
    }).join('');

    return `
      <button type="button" class="${classes}" data-date="${day.dateStr}">
        <span class="cal-day-num">${day.dayNum}</span>
        ${count ? `<span class="cal-day-badge">${count}</span>` : ''}
        ${dots ? `<div class="cal-day-dots">${dots}</div>` : ''}
      </button>`;
  }).join('');

  grid.querySelectorAll('.cal-day').forEach((cell) => {
    cell.addEventListener('click', () => {
      calendarState.selectedDate = cell.dataset.date;
      renderCalendarGrid();
      renderCalendarDayDetail(calendarState.selectedDate, byDate);
    });
  });

  renderCalendarDayDetail(selectedDate, byDate);
}

async function loadMyCalendar() {
  calendarState.meetings = await api('/meetings/my');
  const anchor = calendarState.selectedDate || todayStr();
  const d = new Date(`${anchor}T12:00:00`);
  calendarState.year = d.getFullYear();
  calendarState.month = d.getMonth();
  calendarState.selectedDate = fmtDate(d);
  renderCalendarGrid();
}

// ── Schedule (member) ───────────────────────────────────────────────────────

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

// ── Admin: member management ────────────────────────────────────────────────

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${fmtDate(d)} ${fmtTime(d)}`;
}

function showAdminMsg(msg, type) {
  const el = document.getElementById('admin-user-msg');
  el.textContent = msg;
  el.className = `profile-msg ${type}`;
}

async function loadMembersAdmin() {
  const members = await api('/admin/users');
  const tbody = document.getElementById('members-table-body');
  if (members.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">暂无成员</td></tr>';
    return;
  }
  tbody.innerHTML = members.map((m) => {
    const isSelf = m.id === currentUser.id;
    const roleLabel = m.role === 'admin' ? '管理员' : '成员';
    const deleteBtn = isSelf
      ? '<span class="text-muted">当前账号</span>'
      : `<button class="btn btn-danger btn-sm" data-delete-id="${m.id}">删除</button>`;
    return `
      <tr>
        <td>${escapeHtml(m.username)}</td>
        <td>${escapeHtml(m.displayName)}</td>
        <td><code class="password-cell">${escapeHtml(m.password)}</code></td>
        <td><span class="role-tag ${m.role}">${roleLabel}</span></td>
        <td>${fmtDateTime(m.createdAt)}</td>
        <td>${deleteBtn}</td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.deleteId);
      const member = members.find((m) => m.id === id);
      if (!confirm(`确定删除成员「${member?.displayName || member?.username}」？`)) return;
      try {
        await api(`/admin/users/${id}`, { method: 'DELETE' });
        users = await api('/users');
        populateUserSelect();
        renderInviteeList();
        await loadMembersAdmin();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

async function handleAdminCreateUser(e) {
  e.preventDefault();
  const username = document.getElementById('admin-username').value.trim();
  const displayName = document.getElementById('admin-display').value.trim();
  const password = document.getElementById('admin-password').value;
  const role = document.getElementById('admin-role').value;
  try {
    await api('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName, role }),
    });
    document.getElementById('admin-user-form').reset();
    users = await api('/users');
    populateUserSelect();
    renderInviteeList();
    await loadMembersAdmin();
    showAdminMsg('成员添加成功', 'success');
  } catch (err) {
    showAdminMsg(err.message, 'error');
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
    switchView('my-calendar');
  } catch (err) {
    if (err.data?.requireConfirm) {
      const ok = confirm(`${err.message}\n\n部分成员在该时段已有其他会议，是否仍要创建？`);
      if (ok) {
        await api('/meetings', {
          method: 'POST',
          body: JSON.stringify({ ...form, forceScheduleConflict: true }),
        });
        alert('会议创建成功！');
        switchView('my-calendar');
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
      loadMyCalendar();
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

document.getElementById('cal-prev').addEventListener('click', () => {
  const next = addMonths(calendarState.year, calendarState.month, -1);
  calendarState.year = next.year;
  calendarState.month = next.month;
  renderCalendarGrid();
});
document.getElementById('cal-next').addEventListener('click', () => {
  const next = addMonths(calendarState.year, calendarState.month, 1);
  calendarState.year = next.year;
  calendarState.month = next.month;
  renderCalendarGrid();
});
document.getElementById('cal-today').addEventListener('click', () => {
  const now = new Date();
  calendarState.year = now.getFullYear();
  calendarState.month = now.getMonth();
  calendarState.selectedDate = todayStr();
  renderCalendarGrid();
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
document.getElementById('admin-user-form').addEventListener('submit', handleAdminCreateUser);

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.add('hidden');
});
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') {
    document.getElementById('modal-overlay').classList.add('hidden');
  }
});

document.getElementById('book-modal-close').addEventListener('click', () => {
  document.getElementById('book-modal-overlay').classList.add('hidden');
  quickBookDraft = null;
});
document.getElementById('book-modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'book-modal-overlay') {
    document.getElementById('book-modal-overlay').classList.add('hidden');
    quickBookDraft = null;
  }
});
document.getElementById('quick-book-form').addEventListener('submit', (e) => submitQuickBook(e, false));
document.getElementById('qb-check-conflict').addEventListener('click', checkQuickBookConflicts);

tryAutoLogin();

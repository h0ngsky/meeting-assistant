/**
 * 端到端流程测试：登录 → 注册 → 预约 → 冲突 → 日程
 */
const BASE = process.env.BASE_URL || 'http://localhost:3001/api';

async function req(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function log(step, msg) {
  console.log(`  ✓ [${step}] ${msg}`);
}

async function run() {
  const ts = Date.now();
  const memberUser = `user_${ts}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 7);
  const dateStr = tomorrow.toISOString().slice(0, 10);

  console.log('\n=== 会议助手 E2E 流程测试 ===\n');

  // 1. 管理员登录
  let r = await req('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert(r.ok, `管理员登录: ${JSON.stringify(r.data)}`);
  const adminToken = r.data.token;
  assert(r.data.user && r.data.user.role === 'admin', '管理员角色');
  log('1', '管理员登录成功');

  // 2. 注册普通成员
  r = await req('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: memberUser,
      password: 'test123456',
      displayName: '测试成员A',
    }),
  });
  assert(r.ok, `成员注册: ${r.data.error || r.status}`);
  const memberToken = r.data.token;
  const memberId = r.data.user.id;
  log('2', `成员注册成功 (${memberUser})`);

  // 3. 注册第二个成员
  const memberUser2 = `user2_${ts}`;
  r = await req('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: memberUser2,
      password: 'test123456',
      displayName: '测试成员B',
    }),
  });
  assert(r.ok, `成员2注册: ${r.data.error || r.status}`);
  const member2Id = r.data.user.id;
  log('3', `第二成员注册成功 (${memberUser2})`);

  // 4. 获取会议室列表
  r = await req('/rooms', { headers: { Authorization: `Bearer ${adminToken}` } });
  assert(r.ok && r.data.length === 5, '应返回 5 间会议室');
  assert(r.data.find((x) => x.id === '201' && x.capacity === 6), '201 容量 6');
  log('4', '会议室列表正确 (5间)');

  // 5. 成员创建会议（邀请成员B）
  r = await req('/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      title: '产品评审会',
      roomId: '203',
      date: dateStr,
      startTime: '09:00',
      endTime: '10:30',
      attendeeCount: 4,
      inviteeIds: [member2Id],
      description: 'Q3 产品规划',
    }),
  });
  assert(r.ok, `创建会议: ${r.data.error || r.status}`);
  const meetingId = r.data.id;
  log('5', `会议创建成功 (ID=${meetingId})`);

  // 6. 查询我的会议
  r = await req('/meetings/my', { headers: { Authorization: `Bearer ${memberToken}` } });
  assert(r.ok && r.data.some((m) => m.id === meetingId), '我的会议列表应包含新会议');
  log('6', '我的会议列表正确');

  // 7. 成员B日程应显示该会议
  r = await req(`/schedules/${member2Id}?date=${dateStr}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(r.ok && r.data.meetings.some((m) => m.id === meetingId), '成员B日程应含受邀会议');
  log('7', '成员日程查看正确');

  // 8. 会议室冲突：同房间同时段
  r = await req('/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: '冲突会议',
      roomId: '203',
      date: dateStr,
      startTime: '09:30',
      endTime: '10:00',
      attendeeCount: 2,
    }),
  });
  assert(!r.ok && r.status === 409, '同房间同时段应冲突');
  log('8', '会议室冲突检测正常');

  // 9. 成员日程冲突
  r = await req('/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: '成员B冲突会议',
      roomId: '201',
      date: dateStr,
      startTime: '09:30',
      endTime: '10:00',
      attendeeCount: 2,
      inviteeIds: [member2Id],
    }),
  });
  assert(!r.ok && r.data.requireConfirm, '成员日程冲突应需确认');
  log('9', '成员日程冲突检测正常');

  // 10. 容量超限
  r = await req('/meetings/check-conflicts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      roomId: '201',
      startTime: `${dateStr}T14:00:00`,
      endTime: `${dateStr}T15:00:00`,
      attendeeCount: 10,
    }),
  });
  assert(!r.data.ok && r.data.errors.some((e) => e.includes('容量')), '容量超限应报错');
  log('10', '容量超限检测正常');

  // 11. 午休禁约（普通成员）
  r = await req('/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      title: '午休会议',
      roomId: '202',
      date: dateStr,
      startTime: '13:00',
      endTime: '13:30',
      attendeeCount: 2,
    }),
  });
  assert(!r.ok && r.data.error?.includes('午休'), '普通成员午休禁约');
  log('11', '午休禁约（普通成员）正常');

  // 12. 管理员午休可约
  r = await req('/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: '管理员午休会议',
      roomId: '205',
      date: dateStr,
      startTime: '13:00',
      endTime: '13:30',
      attendeeCount: 2,
    }),
  });
  assert(r.ok, `管理员午休可约: ${r.data.error || r.status}`);
  const adminLunchMeetingId = r.data.id;
  log('12', '管理员午休可预约正常');

  // 13. 取消会议
  r = await req(`/meetings/${meetingId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  assert(r.ok, '取消会议应成功');
  r = await req(`/meetings/${meetingId}`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  assert(r.data.status === 'cancelled', '会议状态应为 cancelled');
  log('13', '取消会议正常');

  // 14. 未登录拒绝
  r = await req('/rooms');
  assert(r.status === 401, '未登录应 401');
  log('14', '未授权访问拦截正常');

  // 15. 修改姓名
  r = await req('/auth/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({ displayName: '新名字A' }),
  });
  assert(r.ok && r.data.displayName === '新名字A', '修改姓名');
  log('15', '修改姓名正常');

  // 16. 修改密码
  r = await req('/auth/password', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({ oldPassword: 'test123456', newPassword: 'newpass123' }),
  });
  assert(r.ok, `修改密码: ${r.data.error || r.status}`);
  r = await req('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: memberUser, password: 'newpass123' }),
  });
  assert(r.ok, '新密码登录成功');
  const memberTokenNew = r.data.token;
  log('16', '修改密码正常');

  // 17. 参会人员日程
  r = await req('/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberTokenNew}` },
    body: JSON.stringify({
      title: '日程测试会',
      roomId: '204',
      date: dateStr,
      startTime: '15:00',
      endTime: '16:00',
      attendeeCount: 3,
      inviteeIds: [member2Id],
    }),
  });
  assert(r.ok, `重建会议: ${r.data.error || r.status}`);
  const testMeetingId = r.data.id;

  r = await req(`/meetings/${testMeetingId}/participant-schedules`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(r.ok && r.data.participants.length >= 2, '应返回参会人员日程');
  assert(r.data.participants.every((p) => Array.isArray(p.meetings)), '每人应有 meetings 数组');
  log('17', '参会人员日程查看正常');

  r = await req(`/meetings/${testMeetingId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${memberTokenNew}` },
    body: JSON.stringify({
      title: '日程测试会（已改）',
      roomId: '205',
      date: dateStr,
      startTime: '16:00',
      endTime: '17:00',
      inviteeIds: [],
    }),
  });
  assert(r.ok && r.data.roomId === '205' && r.data.title.includes('已改'), `修改会议: ${r.data.error || r.status}`);
  log('18', '修改会议（会议室/日期/成员）正常');

  // cleanup
  await req(`/meetings/${testMeetingId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${memberTokenNew}` },
  });
  await req(`/meetings/${adminLunchMeetingId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  console.log('\n=== 全部 18 项测试通过 ✅ ===\n');
}

run().catch((err) => {
  console.error('\n❌', err.message);
  process.exit(1);
});

# 部署到 Vercel

会议助手已适配 Vercel Serverless。Vercel 上**不能写本地文件**，需使用 **Vercel KV** 存储数据。

---

## 一、准备工作

1. 注册 [GitHub](https://github.com) 账号
2. 注册 [Vercel](https://vercel.com) 账号（用 GitHub 登录）
3. 将 `meeting-assistant` 项目推送到 GitHub 仓库

```bash
cd meeting-assistant
git init
git add .
git commit -m "meeting assistant"
git remote add origin https://github.com/你的用户名/meeting-assistant.git
git push -u origin main
```

---

## 二、创建 Upstash Redis 数据库

Vercel 上不能写本地文件，需要用 Redis 存数据（免费额度够用）。

1. 登录 [Vercel Dashboard](https://vercel.com/dashboard)
2. 进入你的项目（或先完成第三步导入项目）
3. 顶部 **Storage** → **Create Database**
4. 选择 **Upstash Redis** → 输入名称（如 `meeting-redis`）→ **Create**
5. 点击 **Connect to Project** 连接到项目

连接后 Vercel 会自动注入 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`。

---

## 三、导入项目并部署

1. Vercel Dashboard → **Add New** → **Project**
2. 选择你的 GitHub 仓库 `meeting-assistant` → **Import**
3. 配置如下（一般自动识别，确认即可）：

| 配置项 | 值 |
|--------|-----|
| Framework Preset | Other |
| Root Directory | `./` |
| Build Command | 留空 |
| Output Directory | 留空 |

4. 展开 **Environment Variables**，添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `JWT_SECRET` | 随机长字符串 | 如 `openssl rand -hex 32` 生成 |

5. 点击 **Deploy**，等待部署完成

---

## 四、连接 Redis 并重新部署

1. 若第三步已连接 Upstash Redis，跳过此步
2. 否则：项目 → **Storage** → 选择 Redis → **Connect to Project**
3. 进入 **Deployments** → 最新部署 → **⋯** → **Redeploy**

---

## 五、访问应用

部署成功后访问：

```
https://你的项目名.vercel.app
```

默认管理员账号：**admin** / **admin123**

建议登录后立即在「个人设置」中修改密码。

---

## 六、本地开发

本地仍使用 JSON 文件存储（`data/` 目录），无需 KV：

```bash
npm install
npm start
# 访问 http://localhost:3001
```

若要在本地测试 KV，在 `.env.local` 中填入 KV 环境变量（从 Vercel 项目 Settings → Environment Variables 复制）。

---

## 七、绑定自定义域名（可选）

1. 项目 → **Settings** → **Domains**
2. 输入你的域名 → 按提示添加 DNS 记录
3. 等待生效

---

## 常见问题

### 登录后数据丢失 / 注册无效
- 检查是否已创建并连接 **Upstash Redis**
- 连接后必须 **Redeploy** 一次

### 500 错误
- 查看 **Deployments** → 函数日志（Runtime Logs）
- 确认 `JWT_SECRET` 已设置

### 和腾讯云部署的区别

| | 腾讯云 VPS | Vercel |
|--|-----------|--------|
| 费用 | 按服务器计费 | 免费额度内免费 |
| 数据存储 | 本地 JSON 文件 | Upstash Redis |
| 适合 | 长期运行、国内访问 | 快速上线、海外访问 |

---

## 项目结构说明

```
meeting-assistant/
├── api/index.js      # Vercel Serverless 入口
├── app.js            # Express 应用（共用）
├── server.js         # 本地开发启动
├── vercel.json       # Vercel 路由配置
├── lib/db.js         # 存储层（本地 JSON / Upstash Redis 自动切换）
└── public/           # 前端静态文件
```

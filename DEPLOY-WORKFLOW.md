# 推送与部署工作流

目标：**先推 GitHub，再由 Vercel 自动同步**。每次部署对应一个 Git 提交，方便回退。

---

## 一、一次性配置（只需做一次）

### 1. 把 Vercel 项目关联到 GitHub

当前项目可能是通过 CLI 手动部署的，需要先接上 Git：

1. 打开 [Vercel Dashboard](https://vercel.com/dashboard) → 项目 **meeting-assistant**
2. **Settings** → **Git**
3. 点击 **Connect Git Repository**
4. 选择 **GitHub** → 仓库 `h0ngsky/meeting-assistant`
5. 确认：
   - **Production Branch**：`main`
   - **Root Directory**：`./`

关联成功后，**不要再**用 `vercel deploy --prod` 手动部署（除非紧急热修）。

### 2. 把本地代码同步到 GitHub（首次）

GitHub 若落后于本地，先全量推送一次：

```bash
cd "/Users/hongsky/Desktop/开发/meeting-assistant"
git push origin main
```

需要 GitHub Token 时，在终端按提示登录，或使用 Personal Access Token。

### 3. 确认 Vercel 环境变量（已有可跳过）

项目 → **Settings** → **Environment Variables**：

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | 随机字符串 |
| `UPSTASH_REDIS_REST_URL` | 连接 Redis 后自动注入 |
| `UPSTASH_REDIS_REST_TOKEN` | 连接 Redis 后自动注入 |

---

## 二、日常开发流程

```
本地改代码 → 测试 → commit → push GitHub → Vercel 自动部署
```

### 方式 A：使用发布脚本（推荐）

```bash
cd "/Users/hongsky/Desktop/开发/meeting-assistant"
./scripts/publish.sh "fix: 修复会议室删除提示"
```

脚本会：跑测试 → 提交 → 推送到 `main`。

### 方式 B：手动命令

```bash
cd "/Users/hongsky/Desktop/开发/meeting-assistant"
npm test                    # 本地验证
git add .
git commit -m "描述你的改动"
git push origin main        # 推送后 Vercel 自动开始部署
```

### 部署进度

- Vercel Dashboard → **Deployments** 查看构建状态
- 通常 1–2 分钟完成
- 生产地址：https://meeting-assistant-topaz.vercel.app

---

## 三、分支策略

| 分支 | 用途 | Vercel 行为 |
|------|------|-------------|
| `main` | 生产环境 | 自动部署到 Production |
| `dev` / `feature/*` | 开发、试验 | 自动生成 Preview URL（可选） |

建议：小改动直接推 `main`；大功能开分支，合并 PR 后再上生产。

---

## 四、回退（Rollback）

### 方法 1：Git 回退（推荐，有记录）

```bash
# 查看历史
git log --oneline -10

# 回退某次提交（生成新的 revert 提交）
git revert <commit-hash>
git push origin main
# Vercel 会自动部署回退后的版本
```

### 方法 2：Vercel 一键回退（最快）

1. Vercel → **Deployments**
2. 找到上一次正常的部署
3. 点击 **⋯** → **Promote to Production**

适合紧急恢复，但 GitHub 代码不会自动变，之后建议再用 `git revert` 对齐。

### 方法 3：回到指定 Git 标签/提交

```bash
git checkout <good-commit-hash>
git checkout -b hotfix/rollback
git push origin hotfix/rollback
# 在 GitHub 提 PR 合并到 main，或直接 reset（慎用）
```

---

## 五、GitHub Actions（CI）

推送或 PR 到 `main` 时，会自动：

1. 安装依赖
2. 启动服务
3. 运行 `npm test`

详见 `.github/workflows/ci.yml`。

---

## 六、不要做的事

| ❌ 避免 | ✅ 改为 |
|--------|--------|
| 只跑 `vercel deploy` 不推 GitHub | 先 `git push`，让 Vercel 从 Git 部署 |
| 直接在 Vercel 改环境变量后不 Redeploy | 改完变量后 Redeploy 一次 |
| 生产环境 force push | 用 `git revert` 回退 |

---

## 七、流程图

```
┌─────────────┐     git push      ┌─────────────┐     webhook      ┌─────────────┐
│  本地开发    │ ───────────────► │   GitHub    │ ───────────────► │   Vercel    │
│  npm test   │                  │  main 分支   │   自动构建部署    │  Production │
└─────────────┘                  └─────────────┘                  └─────────────┘
                                        │                                │
                                        │         回退：git revert        │
                                        └────────────────────────────────┘
                                              或 Vercel Promote 旧部署
```

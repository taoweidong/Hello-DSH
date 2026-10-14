# dsh-codehub-dashboard 设计文档

> 版本：0.1.0 | 最后更新：2026-10-14

## 1. 项目概述

### 1.1 目标

在 DeepSeek Harness（DSH）侧边栏中提供一个 **CodeHub 看板**标签页，聚合多个 GitHub 仓库的 Pull Request、Review、Comment 数据，以统计图表和结构化列表的形式呈现，帮助用户快速识别：

- 待处理的 MR（Merge Request / Pull Request）
- 需要自己评审的 MR
- 未解决的检视意见（Review Comments）
- 需要自己回复的评论
- CI 失败的 MR
- 各仓库的整体健康度

### 1.2 核心约束

| 约束 | 说明 |
|------|------|
| **真实数据** | 不使用模拟/mock 数据，所有数据来自 GitHub API（gh CLI 或 REST） |
| **零外部依赖** | Dashboard SPA 为单文件 vanilla JS + 内联 SVG 图表，无 CDN/第三方库 |
| **DSH 插件规范** | 遵循 cordis 插件体系、better-sidebar 服务契约、webServer 路由规范 |
| **安全** | Token 脱敏、execFile 无 shell、文件权限 best-effort 0600 |
| **离线容错** | gh 不可用时降级到 HTTP API；HTTP 失败时显示明确错误提示 |

### 1.3 技术选型

| 层面 | 选择 | 理由 |
|------|------|------|
| 数据源 | [gh CLI](https://cli.github.com/) v2.102+ | GitHub 官方工具，JSON 输出稳定，支持嵌套字段 |
| 备选数据源 | GitHub REST API v3 | 当 gh 未安装/未登录时通过 PAT 直接调用 |
| 辅助数据源 | git CLI | 补充本地仓库元信息（默认分支、远端 URL） |
| 侧边栏集成 | dsh-better-sidebar `registerTab` | DSH 生态标准扩展点 |
| Dashboard UI | 单文件 HTML + vanilla JS + SVG | 零构建、零依赖、可离线 |
| Host 通信 | Node http prefix route `/codehub` | DSH webServer 标准路由机制 |

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────┐
│                  DSH Desktop App                     │
│  ┌─────────────────────────────────────────────────┐ │
│  │           better-sidebar (client)               │ │
│  │  ┌───────────────────────────────────────────┐  │ │
│  │  │  CodeHub Tab (iframe → /codehub/index.html)│  │ │
│  │  │  • registerTab(id:'codehub:dashboard')     │  │ │
│  │  │  • badge polling (/codehub/api?op=summary) │  │ │
│  │  └───────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────┘ │
│                        ↕ HTTP                         │
│  ┌─────────────────────────────────────────────────┐ │
│  │         codehub-dashboard (host)                │ │
│  │  ┌─────────────┐  ┌──────────┐  ┌───────────┐  │ │
│  │  │ Config Store │  │  Cache   │  │ Aggregator│  │ │
│  │  │ (~/.dsh/    │  │ (TTL +   │  │ (overview, │  │ │
│  │  │  codehub-   │  │  rev)    │  │  summary,  │  │ │
│  │  │  dashboard/)│  │          │  │  filter)   │  │ │
│  │  └──────┬──────┘  └────┬─────┘  └─────┬─────┘  │ │
│  │         │              │               │         │ │
│  │  ┌──────▼──────────────▼───────────────▼──────┐  │ │
│  │  │          Provider Dispatcher               │  │ │
│  │  │  auto → gh → http → git-meta → error       │  │ │
│  │  └──┬──────────┬──────────────┬───────────────┘  │ │
│  │     │          │              │                   │ │
│  │  ┌──▼──┐   ┌───▼───┐    ┌────▼────┐             │ │
│  │  │ gh  │   │ http  │    │  git    │             │ │
│  │  │ CLI │   │ REST  │    │  CLI    │             │ │
│  │  └─────┘   └───────┘    └─────────┘             │ │
│  └─────────────────────────────────────────────────┘ │
│                        ↕                              │
│            GitHub API / Local Git Repos               │
└─────────────────────────────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| Host half | `index.js` | 配置持久化、数据拉取（gh/http/git）、缓存管理、聚合计算、HTTP 路由 |
| Client half | `client.js` | betterSidebar tab 注册、badge 轮询、iframe 容器 |
| Dashboard SPA | `web/index.html` | 5 个视图渲染、SVG 图表、筛选交互、设置表单 |
| Bundle patch | `cordis.patch.yml` | DSH loader 挂载声明 |
| Test harness | `scripts/test-host.mjs` | 独立验证 host API 正确性 |

---

## 3. 数据模型

### 3.1 归一化模型

所有 provider 的输出统一为以下结构，aggregator 只消费此格式：

```typescript
interface Snapshot {
  repoKey: string           // "{instanceId}:{owner/name}"
  source: 'gh' | 'http' | 'git-meta' | 'error'
  fetchedAt: string         // ISO 8601
  error: string | null
  degradedNote?: string     // 降级说明
  elapsedMs?: number
  repo: RepoMeta
  mrs: MR[]
}

interface RepoMeta {
  key: string
  name: string              // repo basename
  owner: string
  path: string              // "owner/name"
  defaultBranch: string
  description: string
  localPath?: string
  remoteUrl?: string
  instanceId?: string
}

interface MR {
  number: number
  title: string
  author: Person
  state: 'open' | 'merged' | 'closed'
  draft: boolean
  sourceBranch: string
  targetBranch: string
  createdAt: string         // ISO 8601
  updatedAt: string
  mergedAt: string | null
  additions: number
  deletions: number
  changedFiles: number
  labels: string[]
  ciState: 'success' | 'failure' | 'pending' | 'none'
  reviewDecision: 'approved' | 'changes_requested' | 'pending' | 'none'
  requestedReviewers: string[]  // logins
  reviews: Review[]
  comments: ReviewComment[]
  url: string
}

interface Review {
  id: string
  author: Person
  state: 'approved' | 'changes_requested' | 'commented'
  submittedAt: string
  body: string
}

interface ReviewComment {
  id: string
  author: Person
  body: string
  file: string | null
  line: number | null
  createdAt: string
  resolved: boolean
}

interface Person { name: string; login: string }
```

### 3.2 派生字段（decorate）

Aggregator 在归一化 MR 上追加以下派生字段：

| 字段 | 计算逻辑 |
|------|----------|
| `needsMyReview` | open && !draft && me ∈ requestedReviewers && me 尚未提交 review |
| `commentCount` | comments.length |
| `unresolvedCount` | comments.filter(!resolved).length |
| `needsReplyCount` | unresolved && author ≠ me && (mr.author = me ∨ reviewDecision = changes_requested) |
| `reviewCount` | reviews.length |

### 3.3 聚合输出（Overview）

```typescript
interface Overview {
  summary: {
    repos: number; errors: number
    openMrs: number; mergedMrs: number; closedMrs: number
    needsReview: number; drafts: number
    unresolvedComments: number; needsReply: number
    failingCi: number; mergedThisWeek: number
    totalComments: number
    me: { login: string; name: string } | null
  }
  repos: RepoSummary[]        // per-repo counts
  statusDist: { open; merged; closed }
  activity: DayBucket[]       // 30 days
  topReviewers: ReviewerAgg[] // top 8
  recent: Event[]             // latest 24
  generatedAt: string
}
```

---

## 4. Provider 设计

### 4.1 调度策略

```
planSource(repo, cfg, ghOk):
  if cfg.provider == 'gh'       → 'gh'
  if cfg.provider == 'http'     → 'http'
  if cfg.provider == 'git'       → 'git-meta'  // 旧配置值 'git-meta' 由 normalize 映射为 'git'
  if cfg.provider == 'auto':
    if ghOk                     → 'gh'
    elif instance has token     → 'http'
    else                        → 'error'
```

### 4.2 gh Provider（主数据源）

**命令映射：**

| 操作 | gh 命令 | JSON 字段 |
|------|---------|-----------|
| PR 列表 | `gh pr list --repo <path> --state all --limit 200 --json <fields>` | number, title, state, isDraft, headRefName, baseRefName, createdAt, updatedAt, mergedAt, additions, deletions, changedFiles, reviewDecision, url, author{login,name}, labels{name}, reviewRequests{login}, latestReviews{...} |
| PR 详情 | `gh pr view <n> --repo <path> --json <fields>` | reviews{author{login,name},state,submittedAt,body}, comments{author{login,name},body,path,line,createdAt} |
| 认证探测 | `gh auth status` | exit code + stderr |
| 版本检查 | `gh --version` | stdout |

**执行方式：** `execFile(ghPath, args, { env: { GH_TOKEN, GH_HOST } })` — 无 shell，固定参数列表。

**Token 传递优先级：**
1. 实例配置的 token → 设为 `GH_TOKEN` 环境变量
2. 用户全局 `gh auth login` 凭据（gh 自动读取）

**降级链：** gh 失败 → 若实例有 token 则降级到 HTTP API → 否则标记 error。

### 4.3 HTTP Provider（备选）

直接调用 GitHub REST API v3：
- `GET /repos/{owner}/{repo}/pulls?state=all&per_page=100`
- `GET /repos/{owner}/{repo}/pulls/{n}/reviews`
- `GET /repos/{owner}/{repo}/pulls/{n}/comments`

认证：`Authorization: Bearer <token>`。超时：可配置（默认 15s）。

### 4.4 Git Provider（辅助）

仅补充元数据：
- `git remote get-url origin` → 解析 owner/name
- `git symbolic-ref refs/remotes/origin/HEAD` → 默认分支
- 不产生 MR 数据

### 4.5 缓存策略

| 参数 | 值 | 说明 |
|------|-----|------|
| TTL | `pollMinutes × 60s` | 可配置，默认 10 分钟 |
| 并发 | 3 | 避免同时发起过多 API 请求 |
| 版本绑定 | cache entry 绑定 config.rev | 配置变更后自动失效 |
| Badge 轮询 | 60s 间隔，读缓存不触发 I/O | 轻量级 |
| 后台刷新 | 60s ticker，仅在 TTL 过期时触发 | 避免无效请求 |
| 初始预热 | 启动后 3s 延迟首次拉取 | 不阻塞插件加载 |

---

## 5. 配置设计

### 5.1 配置文件

路径：`~/.dsh/codehub-dashboard/config.json`（可通过 `configPath` 或 `CODEHUB_DASHBOARD_CONFIG` 环境变量覆盖）

```jsonc
{
  "version": 1,
  "provider": "auto",           // auto | gh | http | git（历史值 git-meta 自动迁移为 git）
  "me": { "name": "", "login": "" },
  "pollMinutes": 10,
  "ghPath": "gh",
  "instances": [
    { "id": "i1", "name": "GitHub", "host": "github.com", "token": "ghp_xxxx" }
  ],
  "repos": [
    { "id": "r1", "instance": "i1", "path": "cli/cli", "localPath": "", "enabled": true }
  ],
  "http": { "perPage": 100, "detailLimit": 25, "timeoutMs": 15000 }
}
```

### 5.2 安全规则

| 规则 | 实现 |
|------|------|
| Token 落盘权限 | `chmod 0o600`（best-effort，Windows 忽略） |
| API 响应脱敏 | `****` + 末 4 位 |
| 保存时保留旧 token | 若传入值以 `****` 开头，保持原值不变 |
| 命令执行 | `execFile`（无 shell），固定参数列表 |
| POST body 上限 | 256 KB |

---

## 6. API 设计

所有端点挂载在 `/codehub` prefix route 下。

### 6.1 端点清单

| 方法 | op | 说明 | 响应 |
|------|-----|------|------|
| GET | `boot` | 初始化：配置 + 摘要 | `{ ok, version, config(masked), summary?, hasData }` |
| GET | `summary` | 轻量摘要（badge 用，纯缓存） | `{ ok, summary, cached }` |
| GET | `overview` | 完整看板数据 | `{ ok, overview, lastRefreshAt }` |
| GET | `mrs` | MR 列表（支持筛选排序） | `{ ok, mrs[], total }` |
| GET | `mr` | 单个 MR 详情 | `{ ok, mr, repo, source }` |
| GET | `reviews` | 检视意见收件箱 | `{ ok, comments[], total }` |
| GET | `activity` | 活跃趋势 + 最近动态 | `{ ok, activity[], recent[], topReviewers[] }` |
| GET | `refresh` | 强制刷新全部仓库 | `{ ok, overview, lastRefreshAt }` |
| GET | `config.get` | 获取配置（脱敏） | `{ ok, config, configPath }` |
| POST | `config.set` | 保存配置并刷新 | `{ ok, config, overview }` |
| POST | `config.test` | 连通性测试 | `{ ok, results[] }` |
| GET | `repos.discover` | 工作区 Git 仓库扫描 | `{ ok, repos[] }` |

### 6.2 MR 列表筛选参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `repoKey` | string | 按仓库过滤 |
| `state` | `all\|open\|merged\|closed` | 状态过滤 |
| `q` | string | 搜索标题/作者/分支/标签/#号 |
| `needsReview` | `1` | 仅待我评审 |
| `unresolved` | `1` | 仅有未解决意见 |
| `sort` | `updated\|created\|comments` | 排序方式 |
| `limit` | number | 返回上限（默认 200，最大 500） |

---

## 7. Dashboard UI 设计

### 7.1 视图结构

| 视图 | Hash Route | 内容 |
|------|-----------|------|
| 概览 | `#/overview` | KPI 卡片 × 6 + 4 张图表 + 最近动态 |
| MR | `#/mrs` | 筛选工具栏 + MR 表格 + 详情抽屉 |
| 检视意见 | `#/reviews` | 筛选 + 按 MR 分组的评论列表 |
| 仓库 | `#/repos` | 仓库卡片网格 |
| 设置 | `#/settings` | 数据源/身份/实例/仓库/gh CLI 配置表单 |

### 7.2 图表实现

全部手写 SVG，无外部依赖：

| 图表 | 类型 | 数据源 |
|------|------|--------|
| 活跃趋势 | 折线图（3 系列：新建/合并/意见） | `overview.activity[]` |
| MR 状态分布 | 环形图（stroke-dasharray） | `overview.statusDist` |
| 各仓库开放 MR | 水平堆叠柱状图（HTML div） | `overview.repos[].counts` |
| 评审活跃 Top | 水平柱状图（HTML div） | `overview.topReviewers[]` |

### 7.3 主题适配

CSS 变量驱动，通过 `@media (prefers-color-scheme: dark)` 切换：

| Token | Light | Dark |
|-------|-------|------|
| `--bg` | #f6f8fa | #0d1117 |
| `--panel` | #ffffff | #161b22 |
| `--accent` | #4d6bfe | #6d8cff |
| `--green` | #1a7f37 | #3fb950 |
| `--red` | #cf222e | #f85149 |

### 7.4 交互模式

- **Hash 路由**：`#/view&param=value` 格式，支持浏览器前进/后退
- **事件委托**：document-level click/change/input 监听，data-* 属性分发
- **防抖搜索**：350ms debounce
- **抽屉**：右侧滑出面板，Esc / 遮罩点击关闭
- **Toast**：底部居中，2.6s 自动消失
- **自动刷新**：60s 间隔，仅页面可见时触发，设置页脏状态时跳过

---

## 8. DSH 插件集成

### 8.1 插件清单（package.json）

```jsonc
{
  "name": "dsh-codehub-dashboard",
  "type": "module",
  "main": "index.js",
  "exports": { ".": "./index.js", "./client": "./client.js" },
  "engines": { "node": ">=18", "dsh": ">=0.1.0-rc.6 <0.3.0" },
  "dsh": {
    "manifestVersion": 1,
    "client": { "platform": "web" },
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

### 8.2 Host Half 契约

```javascript
export const name = 'codehub-dashboard'
export const inject = ['webServer']
export function apply(ctx, loaderConfig) {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix', path: '/codehub',
      handler: async (req, res) => { /* ... */ }
    })
    // interval + warmup timer
    return () => { clearInterval(ticker); clearTimeout(warmup); dispose() }
  })
}
```

### 8.3 Client Half 契约

```javascript
window.__ModuleLoader__.load({
  id: "dsh-codehub-dashboard",
  factory: (require) => {
    // ... styles, icon component, iframe component
    exports.inject = ["betterSidebar"]
    exports.apply = function(ctx) {
      ctx.effect(() => ctx.betterSidebar.registerTab({
        id: "codehub:dashboard",
        title: () => "CodeHub",
        icon: (size) => CodeHubIcon(size),
        order: 45, single: true,
        badge: () => summaryCache?.needsReview || null,
        component: (props) => CodeHubView(props)
      }))
    }
  }
})
```

### 8.4 挂载方式

Profile `package.json` 中添加 dependency + bundles entry：
```json
"dsh-codehub-dashboard": "link:E:/GitHub/Hello-DSH/dsh-codehub-dashboard"
```
Bundle patch (`cordis.patch.yml`) 提供 insert 行：
```yaml
- insert:
    - id: codehub-dashboard
      name: 'dsh-codehub-dashboard'
```

---

## 9. 测试策略

### 9.1 独立测试验证（scripts/test-host.mjs）

无需 DSH 运行环境，创建 fake cordis ctx + 真实 node:http server：

| 测试项 | 验证内容 |
|--------|----------|
| exports | name, inject, apply 导出正确 |
| route | prefix /codehub 注册成功 |
| boot | 返回配置（脱敏）+ 版本号 |
| config.set | 保存成功，token 脱敏，返回 overview |
| config.get | 返回脱敏配置 |
| summary | 返回摘要对象 |
| overview | 返回 repos 数组 |
| mrs | 返回 mrs 数组 |
| reviews | 返回 comments 数组 |
| activity | 返回 activity 数组 |
| refresh | 强制刷新成功 |
| config.test | 返回测试结果（含 git + gh 探测） |
| repos.discover | 发现临时 git 仓库 |
| index.html | 200 + 包含 "CodeHub" |
| unknown op | 返回错误 |

**结果：33/33 通过。**

### 9.2 语法检查

`node --check` 对 index.js 和 client.js 均通过。

---

## 10. 部署与运维

### 10.1 安装流程

```
dsh plugin --profile desktop add <plugin-path>
  ↓
pnpm 创建 link: dependency + 更新 bundles
  ↓
重启 DSH 桌面应用（host 侧变更需重启）
  ↓
硬刷新浏览器（Ctrl+Shift+R）
  ↓
打开 CodeHub 标签页 → 设置 → 添加仓库 → 保存
```

### 10.2 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 标签页不出现 | 插件未加载 | 重启 DSH + 硬刷新 |
| 所有仓库报错 | gh 未登录 | `gh auth login` |
| 部分仓库报错 | 仓库路径错误或无权限 | 检查 owner/name 格式 + gh 权限 |
| 数据不更新 | pollMinutes 过长 | 调小轮询间隔或手动刷新 |
| Token 泄露风险 | 配置文件权限过宽 | 检查 `~/.dsh/codehub-dashboard/config.json` 权限 |

### 10.3 性能考量

| 指标 | 设计 |
|------|------|
| 首次加载 | 3s 延迟预热，不阻塞插件激活 |
| Badge 轮询 | 60s 间隔，纯缓存读取，零 I/O |
| 后台刷新 | 60s ticker + TTL 检查，仅过期时触发 |
| API 并发 | 最多 3 个并行请求 |
| MR 详情增强 | 仅 open + 近 30 天 merged 的 PR 拉取详情，上限 25 |
| Dashboard 渲染 | 字符串拼接 + innerHTML，无虚拟 DOM 开销 |

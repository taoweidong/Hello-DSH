# API Reference

> dsh-codehub-dashboard v0.1.0 HTTP API 完整参考

## Base URL

所有端点挂载在 DSH webServer 的 `/codehub` prefix route 下。
在 DSH GUI 中访问时，base URL 为当前页面的 origin（如 `http://127.0.0.1:19387`）。

---

## GET /codehub/index.html

返回 Dashboard SPA 页面。

**Response:** `text/html; charset=utf-8`

---

## GET /codehub/api?op=boot

初始化端点。Dashboard 加载时首先调用，获取配置和初始摘要。

**Response:**
```json
{
  "ok": true,
  "version": "0.1.0",
  "config": { /* masked config object */ },
  "configPath": "/home/user/.dsh/codehub-dashboard/config.json",
  "summary": { /* Summary object or null */ },
  "hasData": true,
  "generatedAt": "2026-10-14T22:50:00.000Z"
}
```

---

## GET /codehub/api?op=summary

轻量级摘要端点。**纯缓存读取，不触发任何 I/O**。用于 tab badge 的 60s 轮询。

**Response:**
```json
{
  "ok": true,
  "summary": {
    "repos": 3,
    "errors": 0,
    "openMrs": 12,
    "mergedMrs": 45,
    "closedMrs": 3,
    "needsReview": 4,
    "drafts": 2,
    "unresolvedComments": 18,
    "needsReply": 5,
    "failingCi": 1,
    "mergedThisWeek": 8,
    "totalComments": 67,
    "me": { "login": "taowd", "name": "陶伟东" }
  },
  "generatedAt": "2026-10-14T22:50:00.000Z",
  "cached": true
}
```

---

## GET /codehub/api?op=overview

完整看板数据。如果缓存过期会自动触发刷新。

**Query Parameters:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `force` | `1` | 强制刷新所有仓库（忽略 TTL） |

**Response:**
```json
{
  "ok": true,
  "overview": {
    "summary": { /* Summary */ },
    "repos": [ /* RepoSummary[] */ ],
    "statusDist": { "open": 12, "merged": 45, "closed": 3 },
    "activity": [
      { "date": "2026-09-15", "opened": 3, "merged": 2, "comments": 5 }
    ],
    "topReviewers": [
      { "login": "alice", "name": "Alice", "reviews": 12, "approvals": 8, "changesRequested": 2, "comments": 24, "unresolved": 3, "score": 48 }
    ],
    "recent": [ /* Event[] (max 24) */ ],
    "generatedAt": "2026-10-14T22:50:00.000Z"
  },
  "lastRefreshAt": 1728921000000
}
```

### RepoSummary

```json
{
  "key": "github.com:cli/cli",
  "name": "cli",
  "owner": "cli",
  "path": "cli/cli",
  "description": "GitHub 仓库 cli/cli",
  "defaultBranch": "trunk",
  "source": "gh",
  "degradedNote": null,
  "error": null,
  "fetchedAt": "2026-10-14T22:50:00.000Z",
  "demo": false,
  "localPath": "",
  "url": "",
  "counts": {
    "open": 5, "merged": 20, "closed": 1,
    "needsReview": 2, "unresolved": 6,
    "failingCi": 0, "drafts": 1, "mergedWeek": 3, "total": 26
  },
  "lastActivity": "2026-10-14T20:30:00.000Z"
}
```

---

## GET /codehub/api?op=mrs

MR 列表，支持多维度筛选和排序。

**Query Parameters:**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `repoKey` | string | `""` | 按仓库 key 过滤 |
| `state` | string | `"all"` | `all \| open \| merged \| closed` |
| `q` | string | `""` | 搜索标题/作者/分支/标签/#号 |
| `needsReview` | `1` | - | 仅待我评审的 MR |
| `unresolved` | `1` | - | 仅有未解决意见的 MR |
| `author` | string | `""` | 按作者 login/name 过滤 |
| `sort` | string | `"updated"` | `updated \| created \| comments` |
| `limit` | number | `200` | 返回上限（1–500） |

**Response:**
```json
{
  "ok": true,
  "total": 42,
  "mrs": [
    {
      "number": 1234,
      "title": "feat: add dark mode support",
      "author": { "name": "Alice", "login": "alice" },
      "state": "open",
      "draft": false,
      "sourceBranch": "feature/dark-mode",
      "targetBranch": "main",
      "createdAt": "2026-10-10T08:00:00.000Z",
      "updatedAt": "2026-10-14T15:30:00.000Z",
      "mergedAt": null,
      "additions": 342,
      "deletions": 28,
      "changedFiles": 12,
      "labels": ["enhancement", "ui"],
      "ciState": "success",
      "reviewDecision": "pending",
      "requestedReviewers": ["bob", "taowd"],
      "url": "https://github.com/org/repo/pull/1234",
      "needsMyReview": true,
      "commentCount": 5,
      "unresolvedCount": 2,
      "needsReplyCount": 1,
      "reviewCount": 1,
      "repoKey": "github.com:org/repo",
      "repoPath": "org/repo",
      "repoName": "repo"
    }
  ]
}
```

---

## GET /codehub/api?op=mr

单个 MR 详情，包含完整的 reviews 和 comments。

**Query Parameters:**

| 参数 | 必填 | 说明 |
|------|------|------|
| `repoKey` | ✅ | 仓库 key |
| `number` | ✅ | PR 编号 |

**Response:**
```json
{
  "ok": true,
  "mr": { /* decorated MR with full reviews + comments */ },
  "repo": { /* RepoMeta */ },
  "source": "gh"
}
```

---

## GET /codehub/api?op=reviews

检视意见收件箱。跨仓库聚合所有 Review Comment。

**Query Parameters:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `repoKey` | string | 按仓库过滤 |
| `unresolved` | `1` | 仅未解决 |
| `needsReply` | `1` | 仅需我回复 |
| `q` | string | 搜索内容/作者/文件/MR 标题 |
| `limit` | number | 返回上限（默认 300，最大 1000） |

**Response:**
```json
{
  "ok": true,
  "total": 18,
  "comments": [
    {
      "id": "rc-1234-v-0",
      "repoKey": "github.com:org/repo",
      "repoPath": "org/repo",
      "repoName": "repo",
      "mrNumber": 1234,
      "mrTitle": "feat: add dark mode",
      "mrState": "open",
      "mrUrl": "https://github.com/org/repo/pull/1234",
      "author": { "name": "Bob", "login": "bob" },
      "body": "这里建议加个空值判断",
      "file": "src/theme.ts",
      "line": 42,
      "createdAt": "2026-10-12T10:00:00.000Z",
      "resolved": false,
      "needsReply": true,
      "kind": "comment"
    }
  ]
}
```

---

## GET /codehub/api?op=activity

活跃趋势数据和最近动态。

**Response:**
```json
{
  "ok": true,
  "activity": [
    { "date": "2026-09-15", "opened": 3, "merged": 2, "comments": 5 }
  ],
  "recent": [
    { "type": "opened", "at": "...", "repoKey": "...", "repoName": "...", "mrNumber": 1234, "title": "...", "actor": "Alice" }
  ],
  "topReviewers": [
    { "login": "alice", "name": "Alice", "reviews": 12, "approvals": 8, "changesRequested": 2, "comments": 24, "unresolved": 3, "score": 48 }
  ]
}
```

---

## GET /codehub/api?op=refresh

强制刷新所有仓库数据（忽略缓存 TTL）。

**Response:** 同 `overview`。

---

## GET /codehub/api?op=config.get

获取当前配置。**Token 一律脱敏**。

**Response:**
```json
{
  "ok": true,
  "config": {
    "version": 1,
    "provider": "auto",
    "me": { "name": "陶伟东", "login": "taowd" },
    "pollMinutes": 10,
    "ghPath": "gh",
    "instances": [
      { "id": "i1", "name": "GitHub", "host": "github.com", "token": "****abcd", "hasToken": true }
    ],
    "repos": [ /* ... */ ],
    "http": { "perPage": 100, "detailLimit": 25, "timeoutMs": 15000 }
  },
  "configPath": "/home/user/.dsh/codehub-dashboard/config.json"
}
```

---

## POST /codehub/api?op=config.set

保存配置并触发全量刷新。

**Request Body:** 完整或部分配置对象。Token 字段若以 `****` 开头则保留原值。

**Response:**
```json
{
  "ok": true,
  "config": { /* masked config */ },
  "overview": { /* refreshed overview */ }
}
```

---

## POST /codehub/api?op=config.test

连通性测试。检测 git CLI、gh CLI、HTTP API 实例、本地仓库路径。

**Response:**
```json
{
  "ok": true,
  "results": [
    { "target": "git", "kind": "cli", "ok": true, "detail": "git version 2.55.0.windows.2", "ms": null },
    { "target": "gh", "kind": "gh-cli", "ok": true, "detail": "gh version 2.102.0", "ms": 120 },
    { "target": "GitHub", "kind": "http-api", "ok": true, "detail": "HTTP 200 github.com", "ms": 340 },
    { "target": "cli/cli", "kind": "local-repo", "ok": true, "detail": "E:/repos/cli" }
  ]
}
```

---

## GET /codehub/api?op=repos.discover

扫描工作区目录下的 Git 仓库。

**Query Parameters:**

| 参数 | 必填 | 说明 |
|------|------|------|
| `ws` | ✅ | 工作区绝对路径 |
| `depth` | - | 扫描深度（1–3，默认 2） |

**Response:**
```json
{
  "ok": true,
  "repos": [
    {
      "path": "E:/GitHub/my-project",
      "name": "my-project",
      "remote": "git@github.com:org/my-project.git",
      "remotePath": "org/my-project",
      "branch": "main"
    }
  ]
}
```

---

## Error Responses

所有错误响应格式统一：

```json
{ "ok": false, "error": "descriptive error message" }
```

| HTTP Status | 场景 |
|-------------|------|
| 400 | 未知 op / 缺少必填参数 / JSON 解析失败 |
| 404 | MR 未找到 / 非 API 路径 |
| 405 | 需要 POST 但收到 GET |
| 500 | 服务端内部错误 |

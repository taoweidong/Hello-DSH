# gh CLI 命令契约

> 本文档记录 dsh-codehub-dashboard 插件对 [gh CLI](https://cli.github.com/) 的命令依赖和 JSON 字段约定。
> 验证版本：gh 2.102.0 (2026-09-30)

## 1. 认证

插件支持两种认证方式（按优先级）：

| 方式 | 说明 | 适用场景 |
|------|------|----------|
| **实例 Token** | 配置中的 `instances[].token` → 设为 `GH_TOKEN` 环境变量 | 多账号 / GitHub Enterprise |
| **全局登录** | `gh auth login` 持久化凭据 | 单账号日常使用 |

### 探测命令

```sh
gh auth status
# exit 0 = 已登录; exit 1 + stderr "not logged in" = 未登录
```

## 2. PR 列表

```sh
gh pr list \
  --repo <owner/name> \
  --state all \
  --limit 200 \
  --json number,title,state,isDraft,headRefName,baseRefName,\
createdAt,updatedAt,mergedAt,additions,deletions,changedFiles,\
reviewDecision,url,author{login,name},labels{name},\
reviewRequests{login},latestReviews{author{login,name},state,submittedAt,body}
```

### 字段映射

| gh JSON 字段 | 归一化模型字段 | 说明 |
|-------------|---------------|------|
| `number` | `MR.number` | PR 编号 |
| `title` | `MR.title` | 标题 |
| `state` | `MR.state` | `OPEN`→`open`, `MERGED`→`merged`, `CLOSED`→`closed` |
| `isDraft` | `MR.draft` | 布尔 |
| `headRefName` | `MR.sourceBranch` | 源分支名 |
| `baseRefName` | `MR.targetBranch` | 目标分支名 |
| `createdAt` | `MR.createdAt` | ISO 8601 |
| `updatedAt` | `MR.updatedAt` | ISO 8601 |
| `mergedAt` | `MR.mergedAt` | ISO 8601 or null |
| `additions` | `MR.additions` | 新增行数 |
| `deletions` | `MR.deletions` | 删除行数 |
| `changedFiles` | `MR.changedFiles` | 变更文件数 |
| `reviewDecision` | `MR.reviewDecision` | `APPROVED`→`approved`, `CHANGES_REQUESTED`→`changes_requested`, `REVIEW_REQUIRED`→`pending`, else `none` |
| `url` | `MR.url` | Web URL |
| `author.login` | `MR.author.login` | 作者 login |
| `author.name` | `MR.author.name` | 作者显示名 |
| `labels[].name` | `MR.labels[]` | 标签名列表 |
| `reviewRequests[].login` | `MR.requestedReviewers[]` | 待评审人 login 列表 |
| `latestReviews[]` | `MR.reviews[]` | 每个 reviewer 的最新评审状态 |

### latestReviews 子字段

| gh 字段 | 归一化字段 | 说明 |
|---------|-----------|------|
| `author.login` | `Review.author.login` | |
| `author.name` | `Review.author.name` | |
| `state` | `Review.state` | `APPROVED`/`CHANGES_REQUESTED`/`COMMENTED`/`PENDING`（小写，过滤 PENDING） |
| `submittedAt` | `Review.submittedAt` | ISO 8601 |
| `body` | `Review.body` | 评审正文 |

## 3. PR 详情（增强）

对 open + 近 30 天 merged 的 PR（上限 `detailLimit`，默认 25）调用：

```sh
gh pr view <number> \
  --repo <owner/name> \
  --json number,title,state,isDraft,headRefName,baseRefName,\
createdAt,updatedAt,mergedAt,additions,deletions,changedFiles,\
reviewDecision,url,author{login,name},labels{name},\
reviewRequests{login},reviews{author{login,name},state,submittedAt,body},\
comments{author{login,name},body,path,line,createdAt}
```

### 额外字段（相比 list）

| gh 字段 | 用途 |
|---------|------|
| `reviews[]` | 完整评审历史（list 只有 latestReviews） |
| `comments[]` | PR review comments（行内检视意见） |

### comments 子字段映射

| gh 字段 | 归一化字段 | 说明 |
|---------|-----------|------|
| `author.login` | `ReviewComment.author.login` | |
| `author.name` | `ReviewComment.author.name` | |
| `body` | `ReviewComment.body` | 评论内容 |
| `path` | `ReviewComment.file` | 文件路径 |
| `line` | `ReviewComment.line` | 行号 |
| `createdAt` | `ReviewComment.createdAt` | ISO 8601 |

> ⚠️ gh PR comments 不携带 `resolved` 状态。插件默认设为 `false`。

## 4. 版本检查

```sh
gh --version
# stdout: "gh version 2.102.0 (2026-09-30)"
```

## 5. 执行方式

所有 gh 命令通过 Node.js `execFile` 执行：

```javascript
execFile(ghPath, args, {
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
  timeout: 30_000,
  encoding: 'utf8',
  env: { ...process.env, GH_TOKEN: token, GH_HOST: host }
}, callback)
```

- **无 shell**：不使用 `shell: true`，避免注入风险
- **固定参数**：所有参数为静态字符串数组，无用户输入拼接
- **超时**：30 秒硬超时
- **缓冲**：16 MB 上限

## 6. 错误处理

| 场景 | 行为 |
|------|------|
| gh 未安装 | `config.test` 报告失败；auto 模式降级到 HTTP |
| gh 未登录 | `config.test` 报告 "未登录"；auto 模式降级到 HTTP |
| 仓库不存在/无权限 | snapshot.error 记录错误信息 |
| JSON 解析失败 | 降级到 HTTP API（若有 token）或标记 error |
| 超时 | snapshot.error 记录 timeout |
| detail 拉取失败 | 非致命，保留 list 级别数据 |

## 7. 已知限制

| 限制 | 影响 | 缓解 |
|------|------|------|
| gh PR comments 无 resolved 状态 | 无法区分已解决/未解决评论 | 默认 unresolved；未来可通过 GraphQL 获取 |
| gh list 不含 CI status | CI 状态默认为 none | detail 中尝试读取 statusCheckRollup |
| rate limit | GitHub API 有速率限制 | 缓存 TTL + 并发控制 + 降级提示 |
| 嵌套 JSON 字段语法 | `author{login,name}` 需精确格式 | 已在测试中验证 gh 2.102.0 兼容 |

# gh CLI 命令契约

> 本文记录 dsh-codehub-dashboard 对 [gh CLI](https://cli.github.com/) 的命令依赖与 JSON 字段约定。
> 验证版本：gh 2.102.0 (2026-09-30) | 文档更新：2026-10-15

## 0. 最重要的契约：`--json` 只接受平铺顶层字段

`gh --json` **不支持** GraphQL 式嵌套选择器。`author{login,name}` 会在 gh 本地被拒绝（`Unknown JSON field: "author{login"`），**在发出任何 HTTP 请求之前**失败，因此无论用户是否登录都会失败。

由于 gh 已把这些字段作为完整对象返回，插件只申请顶层字段名：

```js
const GH_PR_COMMON_FIELDS = [
  'number','title','state','isDraft','headRefName','baseRefName',
  'createdAt','updatedAt','mergedAt','additions','deletions','changedFiles',
  'reviewDecision','url','author','labels','reviewRequests','statusCheckRollup',
]
GH_PR_LIST_FIELDS = [...COMMON 去掉 statusCheckRollup, 'latestReviews']   // 18 字段，列表主体
GH_PR_CI_FIELDS   = 'number,statusCheckRollup'                            // 有界的 CI 状态查询
GH_PR_VIEW_FIELDS = [...COMMON, 'reviews','comments','body','headRefOid','baseRefOid']
GH_REPO_FIELDS    = 'defaultBranchRef,name,description'
GH_ISSUE_FIELDS   = 'number,title,body,state,author,assignees,labels,createdAt,updatedAt,closedAt,url'
```

字段名以 `gh pr list --json ___`（打印可用字段清单）为准，并由 `scripts/test-host.mjs` 在每次跑测试时用一份无效字段探针**逐条核对** gh 自己列出的可用清单。

### `statusCheckRollup` 为什么不在列表查询里

`statusCheckRollup` 对 `pr list` 合法，但它会让 GraphQL 在一个请求里解析每个 PR 的**全部 check run**。用 gh 2.102.0 对 `cli/cli` 实测（`--state all`）：

| `--limit` | 带 `statusCheckRollup` | 去掉 `statusCheckRollup` |
|-----------|----------------------|--------------------------|
| 200 | `HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)`，两次运行一致 | 成功，446 KB |
| 100 | `HTTP 504` | — |
| 80 | `HTTP 504` | — |
| 60 | 成功，460 KB | 成功，135 KB（同档另有一次 `HTTP 502`，见下） |
| 50 | 成功，352 KB | — |

单查 `statusCheckRollup`（`--limit 200 --json statusCheckRollup`）同样 504，单查 `latestReviews` 则成功——**成本项就是 rollup**，不是总体字节数。因此 rollup 从列表字段里移除，改由一条有界查询补齐：

```sh
gh pr list --repo <owner/name> --state open --limit 200 --json number,statusCheckRollup   # 实测 69 个开放 PR ≈ 209 KB，成功
```

按 `number` 合并回列表；未被覆盖到的 PR（已合并/已关闭）不写该字段，`mapGhPr` 将其映射为 `ciState: 'unknown'`。这是**「没查」与「没有 CI」的区别**，不能混称 `none`。

200 条的轻字段列表也出现过一次 `HTTP 502`（同参数下一次成功一次失败），即 GitHub 侧存在偶发 5xx；所以 CI 查询失败被设计为**软失败**（`ciCoverage: 'unavailable'` + 仓库卡片 ⚠ 提示），列表主体不因它整体报错。

## 1. 认证

| 方式 | 说明 | 适用场景 |
|------|------|----------|
| **实例 Token** | `instances[].token` → `GH_TOKEN`（github.com）或 `GH_ENTERPRISE_TOKEN`（其它 host），并先删除继承的其它 token 变量 | 多账号 / GitHub Enterprise |
| **全局登录** | `gh auth login` 持久化凭据 | 单账号日常使用 |

```sh
gh auth status    # exit 0 = 已登录；含 "not logged in" 的失败 = 未登录
gh --version      # "gh version 2.102.0 (2026-09-30)"
```

探测结果缓存 5 分钟；`config.set` 触发 `invalidate()` 时一并重置，因此改 `ghPath` 不必等缓存过期。

## 2. PR 列表

```sh
gh pr list --repo <owner/name> --state all --limit 200 --json <GH_PR_LIST_FIELDS>      # 不含 statusCheckRollup
gh pr list --repo <owner/name> --state open --limit 200 --json number,statusCheckRollup # CI 状态，按 number 合并
gh repo view <owner/name> --json <GH_REPO_FIELDS>                                       # 默认分支与描述（软失败）
```

| gh 字段 | 归一化字段 | 说明 |
|---------|-----------|------|
| `number` `title` `url` | 同名 | |
| `state` | `MR.state` | `OPEN`→`open`；`MERGED` 或（`CLOSED` 且有 `mergedAt`）→`merged`；`CLOSED`→`closed` |
| `isDraft` | `MR.draft` | 布尔 |
| `headRefName` / `baseRefName` | `sourceBranch` / `targetBranch` | |
| `createdAt` / `updatedAt` / `mergedAt` | 同名 | ISO 8601；`mergedAt` 可为 null |
| `additions` / `deletions` / `changedFiles` | 同名 | 数值 |
| `reviewDecision` | `MR.reviewDecision` | `APPROVED`→`approved`，`CHANGES_REQUESTED`→`changes_requested`，`REVIEW_REQUIRED`→`pending`，其它→`none` |
| `author` | `MR.author{name,login}` | gh 返回对象 |
| `labels` | `MR.labels[]` | 取 `name` |
| `reviewRequests` | `MR.requestedReviewers[]` | 取 `login` |
| `latestReviews` | `MR.reviews[]` | 每位 reviewer 的最新评审；`PENDING` 被过滤 |
| `statusCheckRollup` | `MR.ciState` | 来自 `--state open` 那条查询；未覆盖到的 PR 为 `unknown`，见 §6 |

## 3. Issue 列表

```sh
gh issue list --repo <owner/name> --state all --limit 200 --json <GH_ISSUE_FIELDS>
```

Issue 拉取**独立失败**：失败时快照保留 PR 数据，只在 `issueError` 中记录原因，API 层通过 `op=issues` 的 `errors[]` 暴露给 UI。

## 4. PR 详情（按需）

SPA 打开 PR 详情时按需获取；评论收件箱按 `http.detailLimit`（默认 25/仓库）预算选取目标。

两条路径：

```sh
# gh 路径（统一走 gh api，与 REST 同端点，便于降级对称）
gh api --hostname <host> repos/<owner/name>/pulls/<n>                 # 基础 + head/base sha
gh api --hostname <host> repos/<owner/name>/pulls/<n>/reviews   --paginate --slurp
gh api --hostname <host> repos/<owner/name>/pulls/<n>/comments  --paginate --slurp
gh api --hostname <host> repos/<owner/name>/issues/<n>/comments --paginate --slurp
gh api --hostname <host> repos/<owner/name>/pulls/<n> -H 'Accept: application/vnd.github.diff'
gh api --hostname <host> repos/<owner/name>/pulls/<n>/files    --paginate --slurp
```

`--paginate --slurp` 返回**每页一个数组**的 JSON，插件用 `parseGhPages()` 校验并展平；任何一页失败即整段失败，错误进 `detailErrors[]`，UI 显示「部分信息未返回」。

> ⚠️ gh / REST 的评论都**不携带线程 `resolved` 状态**。插件写 `resolved: null`（未知），统计与筛选只把 `resolved === false` 计为未解决 —— 未知绝不冒充未解决。

## 5. 其它端点

| 用途 | 端点 |
|------|------|
| 组织展开 | `gh api --hostname <host> orgs/<owner>/repos?type=all&sort=updated --paginate --slurp`（过滤 archived/disabled） |
| 发布检视意见 | `gh api --hostname <host> repos/<p>/pulls/<n>/reviews --method POST --input -`，body 固定 `{ event:'COMMENT', body, commit_id }`，正文经 stdin 传入 |
| REST 降级 | 同端点直接 `fetch` `https://api.github.com/…`（或企业 host 的 `/api/v3`） |

## 6. `statusCheckRollup` → `ciState`

rollup 是 CheckRun 与 StatusContext 的并集，gh 历史上既可能返回单对象也可能返回列表，判定值可能落在 `state` 或 `status`+`conclusion`。插件接受全部形态：

| 归一化 `ciState` | 条件 |
|------------------|------|
| `failure` | 存在已完成且结论为 `FAILURE/ERROR/TIMED_OUT/CANCELLED/STARTUP_FAILURE/STALE` |
| `pending` | 存在未定论项（含 `IN_PROGRESS/RUNNING/QUEUED/PENDING`） |
| `success` | 全部定论且为 `SUCCESS/NEUTRAL/SKIPPED/ACTION_REQUIRED` 或未识别结论 |
| `none` | rollup 字段**存在但为空**：该 PR 没有配置任何 check |
| `unknown` | rollup 字段**不存在**：本次没有查询它的 CI（已合并/已关闭的 PR、CI 查询软失败、HTTP provider 全量） |

`unknown` 与 `none` 必须区分：前者是「没查」，后者是「查了，确实没有」。UI 用虚线灰字 `CI 未查询` 并带 title 说明范围，`op=mrs&ci=` 过滤与「CI 失败」计数都只认已定论的值。

## 7. 执行方式

```javascript
execFile(ghPath, args, {
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
  timeout: 30_000,
  encoding: 'utf8',
  env: { ...process.env, GH_HOST: host, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' },
  // + GH_TOKEN（github.com）或 GH_ENTERPRISE_TOKEN（其它 host），当实例配置了 token
}, callback)
```

- **无 shell**：不使用 `shell: true`，避免注入。
- **固定参数**：参数为静态字符串数组，仓库路径先经 `isSafeRepoPath()`（`owner/name`）与 `isSafeHost()` 校验。
- **stdin**：仅写操作通过 `--input -` 传入 body，命令行不出现正文。
- **超时/缓冲**：30 秒硬超时、16 MB 上限，`err.killed` 转为 `timeout after 30000ms` 错误文本。

## 8. 错误处理与回退

| 场景 | 行为 |
|------|------|
| gh 未安装 / 未登录 | `config.test` 报告；`auto` 模式在有 token 时降级 HTTP，否则标记 error |
| 仓库不存在 / 无权限 | `snapshot.error` 记录，UI 保留其它仓库数据 |
| JSON 解析失败 | 视同 gh 失败：仅 GET 可降级 REST，写操作不降级 |
| 超时 | `snapshot.error` 记录 timeout |
| 详情分段失败 | 非致命，错误进 `detailErrors`，保留已取得数据 |
| **写操作失败** | **不换渠道重发**（CLI 退出码无法证明 GitHub 未收到），进入 `publish_unknown` 并要求人工核实 |

## 9. 已知限制

| 限制 | 影响 | 现状 |
|------|------|------|
| 评论无 `resolved` 状态 | 无法区分已解决/未解决 | 写 `null`（未知），不计为未解决；覆盖率说明随 `coverage.note` 呈现 |
| HTTP provider 无 CI | `ciState = unknown` | 诚实降级，避免每 PR 追加 check-runs 请求；`unknown` 表示未查询，不是「没有 CI」 |
| 每仓库 200 条上限 | 统计为样本非全量 | `coverage.limited` + `coverage.note` 明示 |
| GitHub API rate limit | 刷新可能失败 | TTL 缓存 + 并发 3 + 整轮 inflight 去重 |
| 字段清单随 gh 版本变化 | 一个非法字段会让全部仓库报错，而外层仍返回 `ok:true` | `__test` 暴露字段清单与映射，`test-data.mjs` 用本地无效字段请求锁定契约 |

# dsh-codehub-dashboard

DSH 原生 CodeHub 插件：在左侧导航中聚合 GitHub 仓库和组织的 PR、Issue、检视意见及统计，复用 DSH 的模型、会话和目录选择能力，不另建 Agent 或模型认证体系。

## 功能

- 概览、PR 列表、Issue 列表、检视意见、仓库、统计及设置页面。
- 自动展开组织仓库；显式仓库配置可覆盖本地路径，也可禁用某个组织仓库。
- 列表轻量同步，PR 详情、评论和 diff 按需获取；失败时展示错误并保留已同步数据。
- PR AI 检视：确认发送代码后调用配置的 DSH 模型，保存可编辑草稿；再次确认后以 **COMMENT** 发布，绝不自动批准或拒绝 PR。
- Issue 开发：核验本地克隆的 origin 后，由 DSH 原生 sessionController 创建会话并提交 Issue 上下文，再由 uiWorkspace 打开会话。
- 配置保存不等待上游同步，返回后在后台刷新；认证失败和部分数据失败不会伪装成完整空结果。

## 要求与安装

- DSH `>=0.2.0-rc.2 <0.3.0`，Node.js 18+。
- 使用原生 `slots`、`layout`、`uiWorkspace` 与 `connection` 服务，**不需要 dsh-better-sidebar**。
- 默认使用已安装并登录的 [GitHub CLI](https://cli.github.com/)；也可配置 GitHub REST token。
- AI 检视需要宿主提供 `llm` 和 `sessions`，Issue 开发需要 `sessionController`。缺少服务时对应动作不可用，不会降级到自建 Agent。

```sh
gh auth login
dsh plugin --profile desktop add E:\GitHub\Hello-DSH\dsh-codehub-dashboard
```

安装后重启 DSH，在左侧导航选择 **CodeHub**。本项目不会自行修改已安装 DSH 的配置。

## 使用

1. 在设置中选择数据源：`auto`（gh 优先，读取失败时可回退到已配置 token 的 HTTP）、`gh`、`http` 或 `git`（仅本地元信息）。
2. 添加 GitHub 实例、`owner/name` 仓库或组织名。未指定实例时使用 github.com 的 gh 登录态。
3. 填写 GitHub 登录名以启用待我评审、分配给我的 Issue 筛选；需要开发 Issue 的仓库须绑定对应本地克隆。
4. 选择宿主提供的模型和 provider，保存配置，再查看刷新结果。模型凭据仍由 DSH 管理。
5. PR 详情中查看 diff、确认生成 AI 草稿、编辑正文，再单独确认发布。
6. Issue 详情中确认开始开发；已有成功关联的 Issue 会复用原生会话。后续工具执行仍受 DSH 的批准与安全机制控制。

独立浏览器没有 DSH 客户端桥接，不能选择宿主目录或打开原生会话；应在 DSH 内使用这些功能。

## 数据范围与失败处理

- GitHub CLI 每仓库最多同步 200 条 PR 和 200 条 Issue；HTTP 列表为配置大小的首批结果。统计仅基于已同步样本，不是完整历史统计。
- 组织仓库和按需评论使用分页；评论收件箱仍受每仓库 `http.detailLimit` 预算约束。
- REST 评论不包含完整线程解决状态，未知状态显示为未知，**不计为未解决**。普通讨论评论也不自动计为未解决。
- diff、模型输入和输出有大小限制；截断时明确提示检视范围有限。
- 列表页分开呈现三种状态：整列请求失败、部分仓库失败、样本覆盖受限；PR/Issue 详情若某个分段（评论、diff 等）未返回，会在页面内单独提示并建议重新打开详情重试，不会用空列表冒充「没有意见」。
- 检视草稿绑定生成时的 PR head SHA。发布前重新检查 PR 状态和 SHA；已变更或关闭时拒绝发布。
- 远端发布结果不确定时保存 `publish_unknown` 状态，禁止自动重试，避免重复评论；须先到 GitHub 核实。
- Issue 会话创建及 prompt 使用持久化的 sessionId/requestId；重试沿用原身份，不重新提交另一份任务。宿主 `sessionController.prompt(request, signal)` 需要第二个 AbortSignal 参数，它只约束准入（admission）之前的等待；准入超时后关联保持 pending，重试复用同一 requestId 而不是新建任务。

## 已知限制

- 检视草稿与 Issue 会话记录写在插件自己的审计文件中，不进入宿主 Agent 的生命周期；宿主不会替你回滚或清理这些记录。
- 首次 prompt 可能触发宿主的会话标题生成，检视正文存在经由另一个模型 provider 处理的可能；标题 provider 由宿主选择，插件无法固定。
- rc.2 的 prompt 去重只在准入完成后生效，准入窗口内的并发重试仍可能产生两次会话消息；插件用持久化 requestId 收敛，但不保证宿主侧幂等。
- Issue 会话关联标记为 `ready` 时没有独立的落盘屏障；极端崩溃下可能留下已标记但未持久化的关联，重试前应先核对审计文件。

## 持久化与安全

默认配置为 `~/.dsh/codehub-dashboard/config.json`，工作流审计保存在相邻的 `config.json.workflows.json`。可通过 bundle 的 `configPath` 或 `CODEHUB_DASHBOARD_CONFIG` 指定配置位置。

- token 仅在响应中脱敏；更换实例域名时必须清空或重新输入 token，不会向新域名转移旧凭据。
- POSIX 文件使用 0600；**Windows 上 chmod 不提供等效 ACL 保护**，应保护所在目录。配置含明文 token，工作流审计含代码、Issue 和模型输入输出，不要提交或同步这些文件。
- GitHub 内容视为不可信数据，不能授权工具执行、泄密、发布、push 或破坏性操作。AI 检视请求不带工具。
- 本地命令使用 `execFile` 和固定参数，发布正文通过 stdin 传入。写请求不会因失败自动切换传输渠道重发。
- 每个请求先通过 DSH 原生 `ctx.connection.admit(req)` 信任校验：未通过返回 401/403，服务缺失返回 503，校验通过前不会读取配置或访问 GitHub。写 API 还额外要求同源（Origin / `sec-fetch-site`）与 `application/json`，否则返回 405/403/415。页面带 CSP、`nosniff` 和 `no-referrer` 响应头。客户端桥接核验 origin 和 iframe 来源。
- 持久化采用锁和原子替换。进程崩溃后若残留 `.lock`，必须先确认没有写入进程并备份审计记录，再人工恢复；不要自动删除锁或未决发布记录。

## 开发与验证

```sh
npm install
npm test
npm run lint
npm pack --dry-run
npm run dev
```

开发服务默认监听 `127.0.0.1:4173`，使用独立临时配置，退出时清理，不读取或修改真实 DSH 配置；默认无仓库、无模拟数据，也没有原生模型和会话服务。可用 `PORT` 更换端口。测试使用可控的 GitHub/native-service fixture，不会发布真实评论或调用收费模型；CLI 字段检查在本地使用无效字段请求，不依赖真实仓库认证。

运行时无第三方依赖，页面为 vanilla JS、内联 CSS/SVG。

## 结构

| 文件 | 职责 |
|---|---|
| `index.js` | gh/git/HTTP 数据、配置、缓存、统计和 HTTP 路由 |
| `workflows.js` | 原生模型检视、确认发布、Issue 会话及审计持久化 |
| `client.js` | 原生左侧导航注册、iframe 和受限宿主桥接 |
| `web/index.html` | 看板、详情、工作流及设置 UI |
| `scripts/` | 单元/集成测试和隔离开发服务 |
| `cordis.patch.yml` | DSH 插件挂载声明 |

## API

均挂载在 `/codehub/api?op=...`。读取使用 GET，写入使用 JSON POST。

| 操作 | 用途 |
|---|---|
| `boot` / `summary` / `overview` / `activity` | 初始化、服务能力、摘要、统计 |
| `mrs` / `mr` / `mr.diff` | PR 列表、详情、diff（详情需 repoKey 和 number） |
| `issues` / `issue` | Issue 列表与详情 |
| `reviews` | 按需加载的评论收件箱 |
| `models` | DSH provider/model 目录 |
| `review.create` | `{repoKey,number,confirmed:true}` 创建草稿 |
| `review.get` | 按 id 读取审计草稿 |
| `review.publish` | `{id,body,confirmed:true}` 发布 COMMENT |
| `issue.develop` | `{repoKey,number,confirmed:true}` 创建或复用开发会话 |
| `refresh` | 强制同步 |
| `config.get` / `config.set` / `config.test` | 脱敏配置、保存、连通性测试 |
| `repos.discover` | 按 ws/depth 扫描本地 Git 工作区 |

`gh --json` 使用平铺顶层字段（如 `author,labels,reviewRequests`），不支持嵌套选择器。详情、diff、组织展开和发布使用 `gh api --hostname`；分页读取使用 `--paginate --slurp`。

## License

MIT

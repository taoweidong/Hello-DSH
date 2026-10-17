# dsh-codehub-dashboard

> DSH 原生 CodeHub 工作台：在 DSH 左侧导航中聚合 GitHub 仓库 / 组织的 PR、Issue、检视意见与统计，复用宿主的模型、会话和目录选择能力，不另建 Agent 或模型认证体系。

[![CI](https://github.com/taoweidong/dsh-codehub-dashboard/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/taoweidong/dsh-codehub-dashboard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-codehub-dashboard)](https://www.npmjs.com/package/dsh-codehub-dashboard)
[![Release](https://img.shields.io/github/v/tag/taoweidong/dsh-codehub-dashboard?label=release)](https://github.com/taoweidong/dsh-codehub-dashboard/tags)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.18-brightgreen)](package.json)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.2%20%3C0.3.0-blueviolet)](package.json)
[![runtime deps](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)](package.json)

> **npm**：包名 `dsh-codehub-dashboard`；当前发布版本以 `npm view dsh-codehub-dashboard version` 为准。安装、校验、升级 / 回滚与包内容说明见 [docs/npm-package.md](docs/npm-package.md)。

## 特性

- **原生工作台**：概览、PR、Issue、检视意见、仓库、统计、设置共 7 个视图，全部在 DSH 内以原生 UI 呈现。
- **不另建体系**：复用宿主的 `slots` / `layout` / `uiWorkspace` / `connection` 服务与模型、会话能力；**不需要 [dsh-better-sidebar](https://github.com/taoweidong/dsh-better-sidebar)**。
- **按需取数**：列表轻量同步，PR 详情、diff、评论在打开时再拉取；失败时显式报错并保留已同步数据，不用空结果伪装成功。
- **诚实的未知态**：REST 评论不携带线程解决状态时显示「未知」并单独计数，**绝不把「没查到」当成「未解决 0」**；`resolutionAvailable` 只在真正拿到状态或确认已加载为空时才为真。
- **PR AI 检视**：生成可编辑草稿，二次确认后以 **COMMENT** 发布；**绝不自动批准或拒绝 PR**，head SHA 变化或 PR 关闭时拒绝发布。
- **Issue 开发会话**：核验本地克隆的 `origin` 后，用宿主 `sessionController` 创建会话并注入 Issue 上下文，再由 `uiWorkspace` 打开；重试复用持久化 `sessionId` / `requestId`。
- **多数据源**：`auto` / `gh` / `http` / `git`，支持多 GitHub 实例、组织自动展开、显式仓库覆盖与禁用。
- **零运行时依赖**：纯 vanilla JS + 内联 CSS/SVG，`npm` 运行时依赖为 0。

## 环境要求

| 依赖 | 版本 / 说明 |
|---|---|
| DSH | `>=0.2.0-rc.2 <0.3.0`（`engines.dsh`） |
| Node.js | `>=18.18`（`engines.node`；CI 覆盖 18 / 20 / 22） |
| [GitHub CLI](https://cli.github.com/) | `>=2.0`，默认数据源；也可改用 GitHub REST token |
| 宿主服务 | AI 检视需 `llm` + `sessions`；Issue 开发需 `sessionController`。缺失时对应动作不可用 |
| 浏览器 | DSH 内的现代浏览器；独立浏览器没有客户端桥接，不能选择宿主目录或打开原生会话 |

## 安装

### 通过 npm 安装（推荐）

> 当前发布版本以 `npm view dsh-codehub-dashboard version` 为准。

```sh
dsh plugin --profile web add dsh-codehub-dashboard
```

需要固定版本时追加 `@<version>`。npm 包的校验、升级、回滚与包内容说明见 [docs/npm-package.md](docs/npm-package.md)。

### 从源码或本地目录安装

```sh
git clone https://github.com/taoweidong/dsh-codehub-dashboard.git
dsh plugin --profile web add /path/to/dsh-codehub-dashboard
```

### 离线 tgz 安装

```sh
npm pack
dsh plugin --profile web add ./dsh-codehub-dashboard-<version>.tgz --offline
```

完整的打包、离线交付、手动摆放、卸载与回滚步骤见 [docs/packaging-and-offline-install.md](docs/packaging-and-offline-install.md)。

安装后**重启 DSH**，在左侧导航选择 **CodeHub**。本项目不会自行修改已安装 DSH 的配置。

## 快速上手

1. 在设置页选择数据源：`auto`（gh 优先，失败时可回退到已配置 token 的 HTTP）、`gh`、`http` 或 `git`（仅本地元信息）。
2. 添加 GitHub 实例、`owner/name` 仓库或组织名；未指定实例时使用 github.com 的 gh 登录态。
3. 填写 GitHub 登录名以启用「待我评审」「分配给我的 Issue」筛选；需要开发 Issue 的仓库须绑定本地克隆。
4. 选择宿主提供的模型与 provider，保存配置；保存响应不等待上游同步，刷新在后台进行。
5. 在 PR 详情查看 diff → 生成 AI 草稿 → 编辑正文 → 单独确认发布。
6. 在 Issue 详情确认开始开发；已成功关联的 Issue 会复用原生会话。后续工具执行仍受 DSH 的批准与安全机制控制。

默认配置路径为 `~/.dsh/codehub-dashboard/config.json`，工作流审计保存在相邻的 `config.json.workflows.json`。可通过 bundle 的 `configPath` 或 `CODEHUB_DASHBOARD_CONFIG` 指定位置。

## 数据范围与失败处理

- GitHub CLI 每仓库最多同步 200 条 PR 和 200 条 Issue；HTTP 列表为配置大小的首批结果。统计只基于已同步样本，**不是完整历史统计**。
- CI 状态只查询**未合并**的 PR（全状态查询易触发 GitHub GraphQL 网关 502/504）；已合并 / 已关闭的历史 PR 显示「CI 未查询」，与「CI 无 check」是两回事。该查询失败只降级提示，不影响列表主体。
- 仓库默认分支与描述来自 `gh repo view`；取不到时显示「未知」，不会用某条 PR 的目标分支冒充。
- 组织仓库与按需评论使用分页；评论收件箱受每仓库 `http.detailLimit` 预算约束。
- REST 评论不包含完整线程解决状态：未知显示为未知，**不计为未解决**；普通讨论评论也不自动计为未解决。
- diff、模型输入与输出有大小限制，截断时明确提示检视范围有限。
- 列表页区分三种状态：整列请求失败、部分仓库失败、样本覆盖受限；PR / Issue 详情若某个分段（评论、diff 等）未返回，会在页面内单独提示并建议重开详情，不用空列表冒充「没有意见」。
- 检视草稿绑定生成时的 PR head SHA；发布前重新检查 PR 状态与 SHA，已变更或关闭时拒绝发布。
- 远端发布结果不确定时保存 `publish_unknown` 状态并**禁止自动重试**，避免重复评论；须先到 GitHub 核实。
- Issue 会话创建与 prompt 使用持久化的 `sessionId` / `requestId`；重试沿用原身份，不重新提交另一份任务。

## 已知限制

- 检视草稿与 Issue 会话记录写在插件自己的审计文件中，不进入宿主 Agent 的生命周期；宿主不会替你回滚或清理。
- 首次 prompt 可能触发宿主的会话标题生成，检视正文存在经由另一个模型 provider 处理的可能；标题 provider 由宿主选择，插件无法固定。
- rc.2 的 prompt 去重只在准入完成后生效，准入窗口内的并发重试仍可能产生两次会话消息；插件用持久化 `requestId` 收敛，但不保证宿主侧幂等。
- Issue 会话关联标记为 `ready` 时没有独立的落盘屏障；极端崩溃下可能留下已标记但未持久化的关联，重试前应先核对审计文件。

## 安全与隐私

- token 仅在响应中脱敏；更换实例域名时必须清空或重新输入 token，不会向新域名转移旧凭据。
- POSIX 文件使用 `0600`；**Windows 上 chmod 不提供等效 ACL 保护**，应保护所在目录。配置含明文 token，工作流审计含代码、Issue 与模型输入输出，**不要提交或同步**这些文件。
- GitHub 内容视为不可信数据，不能授权工具执行、泄密、发布、push 或破坏性操作；AI 检视请求不带工具。
- 本地命令使用 `execFile` 与固定参数，发布正文通过 stdin 传入；写请求不会因失败自动切换传输渠道重发。
- 每个请求先经 DSH 原生 `ctx.connection.admit(req)` 信任校验：未通过返回 401/403，服务缺失返回 503；校验通过前不读取配置、不访问 GitHub。写 API 额外要求同源（`Origin` / `sec-fetch-site`）与 `application/json`。页面带 CSP、`nosniff`、`no-referrer` 响应头，客户端桥接核验 origin 与 iframe 来源。
- 持久化采用锁与原子替换。进程崩溃后若残留 `.lock`，先确认没有写入进程并备份审计记录，再人工恢复；**不要自动删除锁或未决发布记录**。

## 兼容性

| 组件 | 支持范围 |
|---|---|
| DSH | `>=0.2.0-rc.2 <0.3.0`（peerDependency，optional） |
| Node.js | `>=18.18`（CI：18 / 20 / 22） |
| 操作系统 | Windows（主要验证环境）、Linux / macOS（POSIX 路径与 0600 权限） |
| 数据源 | `gh` CLI、GitHub REST API、本地 git 元信息 |
| 运行时依赖 | 无第三方运行时依赖 |

## 开发与测试

```sh
npm install
npm run lint        # eslint，0 error
npm test            # node --test（117 用例）+ test-host.mjs（91 断言）
npm run dev         # 隔离开发服务，默认 127.0.0.1:4173
npm pack --dry-run  # 检查 9 个打包文件
```

开发服务使用独立临时配置，退出时清理，不读取或修改真实 DSH 配置；默认无仓库、无模拟数据，也没有原生模型与会话服务，可用 `PORT` 更换端口。测试使用可控的 GitHub / native-service fixture，不会发布真实评论或调用收费模型。

## 项目结构

仓库根即插件包根（npm 包名 `dsh-codehub-dashboard`），没有中间层目录。

| 路径 | 职责 |
|---|---|
| `index.js` | gh / git / HTTP 数据、配置、缓存、统计与 HTTP 路由 |
| `workflows.js` | 原生模型检视、确认发布、Issue 会话及审计持久化 |
| `client.js` | 原生左侧导航注册、iframe 与受限宿主桥接 |
| `web/index.html` | 看板、详情、工作流与设置 UI |
| `package.json` / `cordis.patch.yml` | 插件清单（`dsh.client.inject`、`dsh.bundle.patch`）与 DSH 挂载声明 |
| `scripts/` | 单元 / 集成测试与隔离开发服务 |
| `docs/` | 设计、API、gh CLI 契约、npm 发布、打包交付与验证报告 |
| `releases/` | 交付件归档（`.tgz` 不入 git，仅 README 保留目录） |
| `.github/workflows/` | CI（`npm ci` + lint + test，node 18/20/22）与 tag 触发的 staged npm 发布 |
| `AGENTS.md` | 贡献者契约：提交门禁、契约字段交叉核对、真实宿主激活验收 |

## HTTP API

全部挂载在 `/codehub/api?op=...`；读取用 GET，写入用 JSON POST。完整参数、响应与错误码见 [docs/api-reference.md](docs/api-reference.md)。

| 操作 | 用途 |
|---|---|
| `boot` / `summary` / `overview` / `activity` | 初始化、服务能力、摘要、统计 |
| `mrs` / `mr` / `mr.diff` | PR 列表、详情、diff（详情需 `repoKey` 与 `number`） |
| `issues` / `issue` | Issue 列表与详情 |
| `reviews` | 按需加载的评论收件箱 |
| `models` | DSH provider / model 目录 |
| `review.create` | `{repoKey,number,confirmed:true}` 创建草稿 |
| `review.get` | 按 id 读取审计草稿 |
| `review.publish` | `{id,body,confirmed:true}` 发布 COMMENT |
| `issue.develop` | `{repoKey,number,confirmed:true}` 创建或复用开发会话 |
| `refresh` | 强制同步 |
| `config.get` / `config.set` / `config.test` | 脱敏配置、保存、连通性测试 |
| `repos.discover` | 按 ws/depth 扫描本地 Git 工作区 |

`gh --json` 使用平铺顶层字段（如 `author,labels,reviewRequests`），不支持嵌套选择器；详情、diff、组织展开与发布使用 `gh api --hostname`，分页读取使用 `--paginate --slurp`。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/design.md](docs/design.md) | 架构、原生服务契约、数据模型、工作流状态机、测试策略 |
| [docs/api-reference.md](docs/api-reference.md) | `/codehub/api?op=…` 全部 20 个 op 的参数、响应与错误码 |
| [docs/npm-package.md](docs/npm-package.md) | npm 发布状态、安装 / 校验 / 升级 / 回滚、包内容与允许的发布流程 |
| [docs/packaging-and-offline-install.md](docs/packaging-and-offline-install.md) | 打包、离线交付、手动摆放、卸载与回滚（本机实测） |
| [docs/gh-cli-contract.md](docs/gh-cli-contract.md) | gh CLI 字段契约、`statusCheckRollup` 网关上限实测与执行方式 |
| [docs/layout-and-dataflow-optimization.md](docs/layout-and-dataflow-optimization.md) | 布局与取数流程优化**提案**（未实施） |
| `docs/*-2026-10-15.md`、`docs/*-2026-10-16.md`、`docs/*-2026-10-17.md` | 代码审查、质量评估、真实宿主验证与发布记录的**当日现场记录** |
| [AGENTS.md](AGENTS.md) | 贡献者契约：提交门禁、契约字段交叉核对、真实宿主激活验收 |

## 贡献

- 提交前必须执行 `npm run lint` 与 `npm test` 并全绿，细则见 [AGENTS.md](AGENTS.md)；不允许用 `--no-verify` / `--force` 绕过。
- 修改 `dsh.client.inject` 或 `export const inject` 等「一份事实、多处引用」的契约字段时，须同步核对清单、运行时、测试与文档四处。
- 改动 host 半（`index.js` / `workflows.js`）后，交付前须在真实 DSH 中确认激活日志无 `did not activate` / `waiting for services`。
- 提交信息说明「改了什么、为什么」，建议 `fix(scope): 一句话结论`。
- 安全漏洞请通过 GitHub Security Advisories 私下报告，不要公开带 token、配置或审计内容的 issue。

## License

[MIT](LICENSE)

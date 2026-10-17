# dsh-codehub-dashboard 项目分析与任务规划

> 生成时间：2026-10-17 17:56（Asia/Shanghai）  
> 工作区：`E:\GitHub\Hello-DSH`（当前本地目录名；npm 包名与 GitHub 仓库名均为 `dsh-codehub-dashboard`）  
> 版本：`0.1.1`（源码已 bump，**0.1.1 tarball 尚未生成**）  
> 状态：优化任务 1–4 已完成但**未提交**；任务 5（发布同步 + 改名）**尚未执行**。本文件是分析与委托计划，不是发布证明。

---

## 一、结论摘要

| 维度 | 结论 |
|------|------|
| 项目定位 | DSH 0.2 原生 CodeHub 插件：左侧导航聚合 GitHub PR / Issue / 检视意见 / 统计，复用宿主模型、会话与目录选择 |
| 代码质量 | 架构清晰，host/client/workflows/SPA 分层明确；安全围栏、审计持久化、失败降级设计成熟；未发现 P0 安全漏洞 |
| 测试 | `npm test`：**99 用例 / 99 pass / 0 fail**；`test-host.mjs`：**91 断言 / 91 passed / 0 failed**；`npm run lint`：0 error |
| 交付一致性 | **源码 ≠ 已安装运行版本**：两个 DSH profile 仍依赖 0.1.0 旧 tarball；0.1.1 未打包、未安装 |
| 改名 | **未执行**：目录仍是 `Hello-DSH`；包名/仓库名本来就是 `dsh-codehub-dashboard` |
| 工作树 | 16 个已修改文件 + 2 个未跟踪文件（`package-lock.json`、`scripts/check-version.mjs`）；**没有 commit / push** |
| 最大风险 | 发布件落后源码；未跟踪的 lock 与版本门禁脚本若漏提交，CI 的 `npm ci` 会失败；真实宿主激活未在本次改动后复验 |

**给接手 Agent 的一句话**：代码与测试基线已经很好，先完成“0.1.1 打包 → profile 安装 → 真实宿主验收”，再做目录改名；未解决/待回复指标目前仍是“未知”，不要把它当真实 0。

---

## 二、项目结构与运行链路

```
DSH 宿主
 ├─ client.js  (window.__ModuleLoader__)
 │   ├─ slots.register('sidebar.panellist')  → 左侧 CodeHub 入口
 │   └─ slots.register('main')               → iframe /codehub/index.html
 ├─ index.js   (cordis 插件，export const inject = ['webServer','connection'])
 │   ├─ GET  /codehub/index.html              → web/index.html（进程内 mtime 缓存）
 │   ├─ GET  /codehub/api?op=...              → 数据查询
 │   └─ POST /codehub/api?op=...              → 配置/工作流写操作
 └─ workflows.js
     ├─ llm.stream + sessions                  → AI 检视草稿
     ├─ sessionController.create/prompt        → Issue 开发会话
     └─ 审计文件 <configPath>.workflows.json   → 状态机 + 原子写 + 锁
```

数据源优先级：`gh` CLI → HTTP REST（有 token）→ `git` 仅本地元信息。写操作失败后**绝不换通道重试**。

核心文件（当前行数见 `docs/design.md:68-74`）：

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.js` | 1265 | 配置、provider、缓存聚合、HTTP 路由与安全栅栏 |
| `workflows.js` | 502 | AI 检视、COMMENT 发布、Issue 会话、审计持久化 |
| `client.js` | 90 | 原生 slots/iframe/受限 postMessage 桥接 |
| `web/index.html` | 995 | 7 视图 SPA（vanilla JS + 内联 CSS/SVG） |
| `scripts/` | — | 5 个测试文件 + 隔离开发服务 |
| `docs/` | — | 设计、API、gh 契约、打包、评估与验证报告 |

---

## 三、当前工作树快照（交接前必读）

### 3.1 Git

- 分支：`main`；基线 HEAD：`abd9a82`（`refactor(repo): 插件扁平化到仓库根，文档与 CI 全量对齐并更名 dsh-codehub-dashboard`）。
- 工作树**有未提交改动**，没有 commit / push。
- 已修改（16）：
  `.github/workflows/ci.yml`、`.github/workflows/publish.yml`、`.gitignore`、`AGENTS.md`、`README.md`、`docs/api-reference.md`、`docs/design.md`、`docs/packaging-and-offline-install.md`、`docs/quality-assessment-2026-10-16.md`、`index.js`、`package.json`、`scripts/test-api.mjs`、`scripts/test-client.mjs`、`scripts/test-data.mjs`、`scripts/test-host.mjs`、`web/index.html`。
- 未跟踪（必须随提交入库）：
  - `package-lock.json`（39KB，已从 `.gitignore` 移除；CI 改为 `npm ci`，不跟踪会直接失败）
  - `scripts/check-version.mjs`（publish 的 tag/version 门禁）

### 3.2 验证结果（优化完成后实测）

```sh
npm test
# node --test 四件套：tests 99 / pass 99 / fail 0
# node scripts/test-host.mjs：91 passed, 0 failed

npm run lint
# exit 0，0 error
```

测试分布：`test-data` 21 + `test-api` 4 + `test-workflows` 23 + `test-client` 51 = 99；`test-host` 91 断言。合计 190 项检查。

### 3.3 打包与安装状态

- `package.json` / `index.js` 的 `PLUGIN_VERSION` / `package-lock.json` 已统一为 **0.1.1**。
- **0.1.1 tarball 未生成**；`docs/packaging-and-offline-install.md` 中 0.1.1 的字节数仍是 `TODO`。
- `releases/` 里仍是历史 `dsh-codehub-dashboard-0.1.0.tgz`（63,874 B，2026-10-16 14:11）。
- DSH profile 仍指向旧 tarball：
  - `C:\Users\Taowd\.dsh\profiles\web\package.json:5`
    `"dsh-codehub-dashboard": "file:E:/GitHub/Hello-DSH/releases/dsh-codehub-dashboard-0.1.0.tgz"`
  - `C:\Users\Taowd\.dsh\profiles\desktop\package.json:14` 同上。
- 因此当前宿主实际运行的是 0.1.0 旧代码；本次 0.1.1 的 host/SPA 改动**尚未进入运行版本**。

### 3.4 文档状态

任务 4 已把 `AGENTS.md`、`README.md`、`docs/design.md`、`docs/api-reference.md`、`docs/packaging-and-offline-install.md`、`docs/quality-assessment-2026-10-16.md` 更新到 0.1.1 / 99+91 / mrs errors / resolutionAvailable 的新语义。

遗留：

- `docs/packaging-and-offline-install.md` 的 0.1.1 tarball 字节数、packed/unpacked size 是 `TODO`（必须等真实 `npm pack` 后回填）。
- `AGENTS.md` 环境备注、`README.md` 安装命令、`docs/packaging-and-offline-install.md` 的路径仍是 `E:/GitHub/Hello-DSH`；这些是**改名前的正确状态**，改名任务必须统一更新。
- `docs/quality-assessment-2026-10-16.md` 的历史数字保留，新增了 2026-10-17 后续段，属正确归档方式。

---

## 四、已完成的优化（任务 1–4，未提交）

### 4.1 Task-1 Host 数据契约

| 改动 | 位置 | 效果 |
|------|------|------|
| 抽出 `buildCoverage(snapshots)` | `index.js:845` | overview 与 mrs 共用同一 coverage 口径 |
| `summary.resolutionAvailable` | `index.js:923` | 无评论 → true；有评论但全部 `resolved == null` → false；明确“0 是否可信” |
| `mrs` 返回 `errors` / `coverage` | `index.js:1185` | 拉取失败的仓库不再从列表静默消失 |
| 新增测试 | `scripts/test-api.mjs`、`scripts/test-data.mjs` | 覆盖失败仓库聚合、resolutionAvailable 三态、unresolved/needsReply 仍只认 `false` |

注意：这**没有**修复“解决状态拿不到”本身；它只是把“未知”显式披露出来。

### 4.2 Task-2 SPA 交互与失败语义

`web/index.html` 的主要改动：

- 失败三态：`state.overviewError / overviewLoaded`（`web/index.html:380`），加载失败显示可重试错误态（`:506-509`），不再用“还没有仓库，请去设置”冒充空数据。
- 刷新失败保留上次成功数据，并显示 stale 提示；loader 不再先清空旧 rows。
- `mrs` 读取服务端 `errors` / `coverage`，部分仓库失败会列出失败项。
- 工作区发现改为 `prompt` 输入路径（预填 CWD），不再依赖 iframe URL 的 cwd。
- MR 工具栏新增可见的 CI 筛选 `select#fCi`（`:580`），修复“筛选隐藏但生效”。
- MR 详情优先只请求 `mr.diff`，失败再回退 `mr`，避免双倍详情请求。
- `publish_unknown` / `publishing` / `needsVerification` 时禁用生成/预览/发布/编辑，并提示到 GitHub 核实、不会自动重试（`:806-807`）。
- token 输入聚焦全选 + “**** 只是掩码”的提示。
- API 增加 20s 超时（`:313`）；截断时显示“显示前 N / 共 M 条”；空数组文案改为“暂无…”。
- MR 行/评审组头补键盘可达性与 aria（role/tabindex/aria-current）。

### 4.3 Task-3 工程化门禁

- `.gitignore` 不再忽略 `package-lock.json`；lock 变为应跟踪文件。
- CI 与 publish 均改为 `npm ci`。
- publish 增加：
  - `node scripts/check-version.mjs "$GITHUB_REF_NAME"`：tag 必须等于 `v` + package version；
  - `npm pack --dry-run --json` 内容检查：必需 9 个文件、`entryCount === 9`。
- `engines.node` 从 `>=18` 改为 `>=18.18`（ESLint 9 的实际下限）。
- `test-host.mjs` 新增 415、跨站 403、CSP/nosniff、256KB body 上限等断言，总数 84 → 91。

### 4.4 Task-4 文档同步

见 3.4。文档现在与实现基本一致；唯一必须补的是 0.1.1 打包体积。

---

## 五、仍存在的风险与未完成项

### P0（交付阻塞）

1. **0.1.1 未打包、未安装**
   - 源码是 0.1.1，运行中的 profile 是 0.1.0；host/SPA 修复没有被真实宿主加载。
   - 必须先 `npm pack`、更新 profile、重启 DSH，再做真实宿主验收。
2. **未跟踪的 lock 与版本门禁脚本**
   - `package-lock.json` 未 `git add` 时，CI 的 `npm ci` 在干净 checkout 上会失败。
   - `scripts/check-version.mjs` 未跟踪时，publish workflow 会因文件不存在失败。
   - 当前**没有 commit**，所以这两个文件只是工作区状态；提交者必须显式加入。
3. **改名未执行**
   - 目录 `E:\GitHub\Hello-DSH` 与包名 `dsh-codehub-dashboard` 仍不一致。
   - 直接 rename 会中断当前 DSH 会话工作区；正确做法是复制到新目录、更新 profile、保留旧目录备份，再让用户重启并在新目录打开。

### P1（功能/验收）

4. **真实宿主激活未在本次改动后复验**
   - `test-host.mjs` 的 fake ctx 直接 `apply()`，绕过 cordis 服务解析，不能证明插件在真实宿主激活。
   - 需要看真实 DSH 启动日志：出现 `did not activate` / `waiting for services` 即红灯；并验证 `/codehub/api?op=boot`、7 个视图、config 保存、401 围栏。
5. **“未解决/待我回复”仍是结构性未知**
   - `index.js:384` 与 `index.js:545` 两处仍把 `resolved` 固定为 `null`；没有任何路径产生 `true/false`。
   - `commentNeedsReply`（`index.js:823`）要求 `resolved === false`，所以 `unresolvedComments` / `needsReply` / 未解决筛选实际上拿不到真实值。
   - 现在通过 `resolutionAvailable:false` + 文档“未知不计未解决”做到诚实披露，但功能本身仍未实现。
   - 待决策：实现 GraphQL `reviewThreads.isResolved`，或彻底隐藏/禁用相关指标与筛选。当前 SPA 只在详情提示中使用 `resolutionAvailable`，列表筛选仍可能可点但结果恒空，应与文档口径对齐。
6. **文档中的 0.1.1 体积 TODO**
   - 必须用真实 `npm pack` 输出回填，不能沿用 0.1.0 的 65.4kB。
7. **安装/文档路径在改名后需要统一**
   - `AGENTS.md`、`README.md`、`docs/packaging-and-offline-install.md` 目前都写 `Hello-DSH`，这是改名前的正确状态；改名后必须统一改为 `dsh-codehub-dashboard`，否则接手者会 clone/安装到错误目录。

### P2（可排后续版本）

- CSP 仍含 `script-src 'unsafe-inline'`，SPA 依赖内联脚本/样式；要彻底收紧需要 nonce/hash 改造，成本较高。
- token 掩码仍可能被误当新 token 提交；当前只做了聚焦全选与提示。
- “接口返回空数组”与“确实没有数据”仍只能靠文案与 `detailErrors` 区分，没有独立 `missing` 标记。
- 设置页缺少未保存改动（dirty）提示。
- `ghAvailable` 只缓存 `probe.ok`，不缓存 `loggedIn`（`index.js:715-723`），未登录时每个 TTL 周期仍可能重复探测。
- 测试缺口：`ghSnapshot`/gh→http 降级、TTL/invalidate、Origin 负例、stale `.lock`、状态大小上限等仍缺；`test-host` 的 fake ctx 无法证明真实 cordis 激活。
- `publish.yml` 的 `entryCount === 9` 是硬编码，未来增减文件会误报；可改为“必需文件集合 + 禁止文件集合”。
- `package.json` 的 `precommit` 只是 npm script，不是 git hook；不要把它描述成自动强制门禁。
- `scripts/check-version.mjs:3` 注释仍写 `v0.1.0`（示例过期，不影响逻辑）。

---

## 六、委托任务规划

> 说明：Task-1～Task-4 已完成（代码在工作区，未提交）；Task-5 尚未执行。以下按“可独立委托”的粒度列出，**未执行**，接手者按顺序做。

### Task-5：0.1.1 发布同步与真实宿主验收（P0，串行起点）

**目标**：让真实 DSH 运行 0.1.1，并留下可复核的验收证据。

**写作用域**：`docs/packaging-and-offline-install.md`、`docs/design.md`（仅体积/测试数字）、`releases/`、`releases/README.md`；profile 目录（仓库外）；不写业务代码。

**步骤**：

1. 最终门禁（改完文档后也要再跑）：
   ```sh
   npm run lint
   npm test
   ```
2. 生成 tarball：
   ```sh
   npm pack
   # 记录 9 files / package size / unpacked size / 字节数
   ```
3. 回填文档：`docs/packaging-and-offline-install.md` §1.1 的 `TODO`、文件表体积；`docs/design.md` 只改必要的体积描述。
4. 归档：把 tgz 移入 `releases/`，更新 `releases/README.md` 版本清单；`.tgz` 不入 git。
5. 更新两个 profile：
   - `C:\Users\Taowd\.dsh\profiles\web\package.json`
   - `C:\Users\Taowd\.dsh\profiles\desktop\package.json`
   将 `dsh-codehub-dashboard` 依赖改为新 tarball 的绝对路径（最终改名后为 `E:/GitHub/dsh-codehub-dashboard/releases/dsh-codehub-dashboard-0.1.1.tgz`）。
6. 执行可用的安装动作（`dsh plugin --profile ... add` 或等价 pnpm/npm 安装）；桌面 profile 安装前必须完全退出 DSH Desktop。
7. 重启 DSH，验证：
   - 启动日志无 `did not activate` / `waiting for services`；
   - `/codehub/api?op=boot` 返回当前版本与 `config`；
   - 7 个视图可打开，设置保存后刷新，401 围栏仍生效；
   - 若可用，做一次真实 gh/HTTP 数据读取（不要求发布评论）。

**验收**：tarball 存在且 9 文件；文档数字与实际一致；profile 依赖显示 0.1.1；真实宿主 smoke 记录（命令、日志、截图或文字结果）；0.1.0 旧 tgz 保留作回滚。

**风险**：未认证时无法验证数据视图；桌面 GUI 可能需人工双击；安装失败时记录手动 tar 解压/`link:` 回退步骤。

---

### Task-6：目录改名迁移（P0，依赖 Task-5）

**目标**：把本地目录从 `E:\GitHub\Hello-DSH` 迁到 `E:\GitHub\dsh-codehub-dashboard`，同时不中断可回滚。

**写作用域**：文件系统复制；`AGENTS.md`、`README.md`、`docs/packaging-and-offline-install.md` 的路径；profile 路径；不写业务逻辑。

**步骤**：

1. 确认 Task-5 全绿、0.1.1 tarball 已归档。
2. **复制而不是直接 rename**（当前会话/DSH 工作区绑定旧路径）：
   - 复制 `E:\GitHub\Hello-DSH` → `E:\GitHub\dsh-codehub-dashboard`；
   - 建议排除 `node_modules` 与 `.tmp*` 日志，复制后在新目录 `npm ci`；
   - 保留 `.git` 与全部未提交改动。
3. 在新目录验证：
   ```sh
   git status
   git log -1
   npm ci
   npm run lint
   npm test
   npm pack --dry-run
   ```
   与旧目录对比关键文件 SHA-256（`index.js`、`web/index.html`、`workflows.js`、`client.js`）。
4. 更新 profile 依赖到新目录 tarball，执行安装；确认安装后的 `node_modules/dsh-codehub-dashboard` 版本为 0.1.1。
5. 统一文档路径：`AGENTS.md` 环境备注、`README.md` 安装命令、`docs/packaging-and-offline-install.md` 的布局 A/B、开发者 `link:` 示例。
6. 告知用户：重启 DSH，在新目录打开工作区；旧目录保留为备份，用户确认后再删除。

**验收**：新目录 `git status`/HEAD 与旧目录一致；测试 99+91；pack 9 文件；profile 指向新路径且运行 0.1.1；文档不再出现 `Hello-DSH`（历史归档除外）；旧目录仍在。

**风险**：直接 rename 会让当前 DSH 会话工作区失效；不要用 `git clone` 丢失未提交改动；复制前核对绝对路径。

---

### Task-7：评论线程解决状态（P1，产品决策）

**目标**：结束“未解决/待回复永远为 0”的功能缺口。

**两个方案，二选一后委托**：

- **A. 实现 GraphQL `reviewThreads.isResolved`**
  - 作用域：`index.js` provider、`mapGhPr`/detail mapping、`workflows.js`（若 AI 检视需要）、`scripts/test-data.mjs`、`web/index.html`、docs。
  - 要点：分页、`isResolved`/`isOutdated` 映射、失败降级仍保持 `null`、缓存与 detail 合并、`resolutionAvailable` 变 true 的测试。
  - 验收：真实 PR 能读到 true/false；`unresolvedComments`/`needsReply` 非恒 0；未知仍不冒充 0。
- **B. 保持未知并收敛 UI**
  - 作用域：`web/index.html`（未解决/待回复筛选禁用或标注“数据源不支持”）、`README.md`/`docs`。
  - 验收：所有入口不再给出可点击但恒空的筛选；指标明确标“未知”。

**建议**：0.1.1 先走 B 的文案/禁用，A 放到 0.2.0；否则会推迟发布。

---

### Task-8：剩余 P2 与测试补强（P1/P2，可并行）

按性价比排序，可拆给不同 Agent：

1. **SPA**：设置 dirty 提示；空数组 vs 缺失的独立标记；列表键盘可达性复查；若 Task-7 选 B，禁用相关筛选。
2. **Host**：`ghAvailable` 缓存 `loggedIn`；补 `ghSnapshot`/降级/TTL/invalidate/Origin 负例测试；stale lock 恢复策略文档化。
3. **CI/打包**：`publish.yml` 的 `entryCount` 改为集合校验；`precommit` 明确定位为手动脚本或改成真实 hook；`check-version.mjs` 注释更新。
4. **真实宿主**：把“启动日志 + boot + 7 视图”做成可重复的 smoke 清单，减少纯人工判断。

**验收**：新增测试全绿；总用例数更新到 `AGENTS.md`/`design.md`；不引入运行时依赖。

---

### 任务依赖与建议顺序

```
Task-1..4 (已完成，未提交)
        │
        ▼
Task-5 发布同步 + 真实宿主验收  ──► Task-6 目录改名
        │
        ├─► Task-7 解决状态（可与 Task-5 并行做决策，但实现建议 0.2.0）
        └─► Task-8 P2/测试补强（可在 0.1.1 发布后并行）
```

- **不要**在 Task-5 之前改名：否则 profile 指向的路径、tarball 路径和文档路径会同时变化，验收无法区分“改名引入的问题”和“版本引入的问题”。
- **不要**在未跑 `npm test` 的情况下提交；`AGENTS.md` 的门禁是硬性契约。
- 若用户要求“先改名”，至少先完成 Task-5 的打包与安装验收，再做复制迁移。

---

## 七、交接协议（给下一个 Agent）

1. **先读** `AGENTS.md`、本文件、`docs/design.md`、`docs/api-reference.md`。
2. **确认工作树**：`git status --short`；不要假设改动已提交；`package-lock.json` 与 `scripts/check-version.mjs` 是未跟踪文件。
3. **门禁**：
   ```sh
   cd E:\GitHub\Hello-DSH
   npm run lint
   npm test
   ```
   当前基线：99 + 91 全绿；任何改动后必须复跑。
4. **提交**（仅当用户明确授权）：
   - `git add` 必须包含 `package-lock.json` 和 `scripts/check-version.mjs`；
   - 提交信息写“改了什么、为什么”，禁止 `update`/`fix` 这类无信息 message；
   - 禁止 `--no-verify`、`--force`；不要 push 未经用户确认的改动。
5. **真实宿主**：`test-host.mjs` 只证明 `apply()` 逻辑；host 半改动后必须看真实 DSH 启动日志，出现 `did not activate` / `waiting for services` 即失败。
6. **沙箱限制**：本会话中 `npm test` 可跑；若子 Agent 环境出现 `node --test` 的 `spawn EPERM`，那是沙箱限制而非用例失败，可改由 Lead 跑或直接执行 `node scripts/test-client.mjs`（node:test 直跑）。
7. **路径**：当前工作区 `E:\GitHub\Hello-DSH`；profile 在 `C:\Users\Taowd\.dsh\profiles\{web,desktop}`；配置默认 `~/.dsh/codehub-dashboard/config.json`；审计文件为 `<configPath>.workflows.json`。

---

## 八、关键证据索引

| 主题 | 证据 |
|------|------|
| 插件入口/服务注入 | `index.js:47` `export const inject = ['webServer','connection']` |
| 配置原子写/脱敏 | `index.js:144-152`、`index.js:90-92`、`index.js:179-184` |
| 安全围栏 | `index.js:1116-1118`（connection.admit）、`index.js:1139-1146`（POST/Origin/JSON）、`index.js:1127-1133`（CSP/nosniff） |
| coverage 共用 | `index.js:845` `buildCoverage()` |
| resolutionAvailable | `index.js:923`；`resolved: null` 的两处：`index.js:384`、`index.js:545`；`commentNeedsReply`：`index.js:823` |
| mrs errors | `index.js:1185` |
| 审计持久化 | `workflows.js:173-229`（锁 + fsync + rename + fail-closed） |
| 发布状态机 | `workflows.js:390-448`（publish_unknown 不自动重发） |
| SPA 失败三态 | `web/index.html:380`、`:421-423`、`:506-509` |
| SPA CI 筛选 | `web/index.html:580` |
| SPA 发布护栏 | `web/index.html:806-807` |
| SPA 超时 | `web/index.html:313` |
| 文档同步 | `docs/design.md` §2.1/§10、`docs/api-reference.md` mrs/summary、`docs/packaging-and-offline-install.md` §1.1 |
| 旧 tarball | `releases/dsh-codehub-dashboard-0.1.0.tgz`（63,874 B，2026-10-16 14:11） |
| profile 旧依赖 | `C:\Users\Taowd\.dsh\profiles\web\package.json:5`、`...\desktop\package.json:14` |

---

## 九、未决问题（需用户/产品确认）

1. **0.1.1 是否立即发布**，还是先把 Task-7 的“未解决状态”做完再发 0.2.0？
2. **Task-7 选 A 还是 B**：实现 GraphQL 线程状态，还是隐藏/禁用相关指标？
3. **改名时机**：Task-5 验收通过后立即复制迁移，还是先让用户在原目录使用一段时间？
4. **是否允许本地 commit**：当前所有改动未提交；若用户希望留痕，需要明确授权后按门禁提交（不 push）。

---

*本文件由分析/审计过程直接生成，路径与数字均以 2026-10-17 工作区为准；执行时请重新核对 `git status` 与测试输出。*

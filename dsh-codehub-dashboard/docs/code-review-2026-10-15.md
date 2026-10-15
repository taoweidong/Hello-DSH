# 代码审查与修复方案（2026-10-15）

> 范围：`index.js`（host 半）、`web/index.html`（SPA）、`client.js`。审查方式：全文通读 + 数据流追踪 + 渲染路径推演。
> 分级：P0 = 真 bug，必修；P1 = 高价值优化；P2 = 已知限制，记录不改。
> 后续追加：「追加记录：原生契约复核（2026-10-15 第二轮）」、「追加记录：全量复验（2026-10-16）」。

## P0 真 bug（6 项）

| # | 位置 | 问题 | 根因 | 修复 |
|---|------|------|------|------|
| 1 | web:458 | 检视意见分组头渲染出 `chip undefined` 垃圾 | `stateChip(c)` 传入的是 comment 对象（无 `state`/`draft` 字段），应用 `c.mrState` | 改用 `c.mrState` 渲染 |
| 2 | web:render | 搜索框每 350ms 重建导致焦点丢失，无法连续输入 | 防抖 → hashchange → render 全量重建 innerHTML，新 input 元素夺取焦点 | render 前后记录/恢复 `document.activeElement`（id + 光标位置） |
| 3 | index:301 | CI 状态永远 `none`，"CI 失败" KPI 恒为 0 | `GH_PR_VIEW_FIELDS` 未申请 `statusCheckRollup`，enrichment 是死代码（gh --json 只返回请求的字段） | 字段补进 view 请求；老 gh 不支持该字段时降级重试（不带 CI 字段） |
| 4 | web:516 vs index:116 | 设置页选「Git 元信息」静默失效 | UI 值为 `git-meta`，服务端 normalize 白名单为 `git`，被改回 `auto` | UI 选项与 provDesc 键统一为 `git` |
| 5 | web:694 | 一次 hashchange 触发 2 次 mrs/reviews 请求 | `route` 包装里调 refreshMrs，`render()` 内又判 `!state.mrData` 再调一次 | 统一由 render 内的按需加载负责，删除包装里的重复调用 |
| 6 | index:555 | 提交过 comment 评审的 MR 不再计入「待我评审」 | reviews 已在 provider 层过滤 pending，`r.state !== 'pending'` 恒真；GitHub 语义只有 approve / request-changes 才清除 review request | 判定改为只认可 `approved` / `changes_requested` |

## P1 优化（10 项）

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| 7 | index:288 | `existingIds` 去重是死代码（list 阶段不申请 comments，集合恒空） | 删除，view 阶段直接填充 |
| 8 | index:550 | `invalidate()` 不清 `ghOkCache`，改 ghPath 后 5 分钟内仍用旧探测结果 | invalidate 一并重置探测缓存 |
| 9 | index:759 | `ensureBoot` 中 `store.init()` 抛错后 `booted` 已置 true，配置加载失败被永久吞掉 | 失败时回滚 `booted`，允许下次重试 |
| 10 | web:418 / index:655 | mrs 的 CI 过滤在前端对 limit 200 的截断数据做，结果可能不全 | `filterMrs` 增加 `ci` 参数，前端传服务端过滤 |
| 11 | index:744 | `readBody` 超限 reject 后 data 事件仍可能继续 push chunks | 加 `destroyed` 标志，拒绝后立即短路 |
| 12 | web:656/671 | 两个 document `change` 监听器功能耦合、易漏边界 | 合并为单个分派器 |
| 13 | web:596 | `m.commits` 字段 provider 从不产出，死代码 | 删除 |
| 14 | web:455 | `byMr` 解构 `const {c,mrs}` 命名误导（c 是首条 comment） | 改名 `first`/`list` |
| 15 | index:773 | `web/index.html` 每请求全量 readFileSync（56KB） | 进程内缓存 + mtime 校验 |
| 16 | web:532 | `disabled title=未获得工作区路径` 属性值无引号 | 补引号 |

## P2 已知限制（记录，不改）

- **HTTP provider 的 CI 状态**：REST 拉 PR 不含 CI，需对每个 PR 的 head SHA 追加 `/check-runs` 或 `/status` 请求（detailLimit 25 → 每仓库 +25 请求），代价过大，暂不实现；UI 对 HTTP 数据源显示 "CI —"（诚实降级）。
- **ghProbe 的 loggedIn 判定宽松**：`auth status` 非 "not logged in" 错误时误判为已登录，仅影响 UI 提示文案，不影响取数。
- **repos.discover 接受任意路径**：本地单机工具，受 DSH webServer 信任围栏保护，风险可接受。

## 验证计划

| 步骤 | 命令 | 期望 |
|------|------|------|
| Lint | `npm run lint` | 0 error |
| 单测 | `npm test` | 38 断言全过（新增：provider 归一化、filterMrs ci 过滤、SPA 语法检查） |
| 提交 | commit + push | CI 三矩阵通过 |

## 实施记录（2026-10-15）

- P0 六项全部修复；P1 十项全部完成；P2 三项记录为已知限制。
- 实施中测试反向抓出一个新问题：`normalize` 白名单把 `git-meta` 打回 `auto`（方案原以为只改 UI 即可），已在服务端补 `git-meta → git` 兼容映射，防手编/历史配置踩坑。
- 复验：lint 0 error，`npm test` 38/38 通过。

## 追加记录：原生契约复核（2026-10-15 第二轮）

> 触发点：本轮把插件从 dsh-better-sidebar 迁到 DSH 原生 `slots`/`layout`/`uiWorkspace`，并新增 `workflows.js`（AI 检视 + Issue 开发）。复核对象是**宿主真实契约**，不是代码风格。

### 复核方式

对已安装的 `D:/Program Files/deepseek/resources/app.asar` 做只读文本检索（该路径上是文件而非目录，无法按子路径读取），逐一核对被调用的宿主方法签名，再让测试 fixture 强制复现该签名。

### 本轮发现

| 级别 | 位置 | 问题 | 处置 |
|------|------|------|------|
| **HIGH** | `workflows.js` `develop()` | 调用 `ctx.sessionController.prompt(request)` 少传第二个参数。已安装宿主（0.2.0-rc.2）的实现为 `prompt(request, signal) { signal.throwIfAborted(); … }`，缺 signal 会在真实宿主上必抛 TypeError —— **Issue 开发主链路此前从未真正可用**，只因测试 mock 接受单参数而一直显示通过 | 改传 `AbortSignal.timeout(PROMPT_TIMEOUT_MS=60_000)`；同时校验 `create()` 返回的 sessionId 与持久化 id 一致，不一致即 503 |
| **HIGH（测试侧）** | `scripts/test-workflows.mjs` | prompt mock 未声明第二参数，等于把上面的 bug 掩掉 | fixture 改为 `async prompt(input, signal)`，断言 `typeof signal?.throwIfAborted === 'function'` 并记录 signal；新增 `promptSignals[0] instanceof AbortSignal && !aborted` 断言与并发释放包装 |
| MEDIUM | `web/index.html` | 17 项 UI/状态机缺陷：列表失败伪装成空列表、部分仓库失败不显示、coverage 限制不外显、详情分段缺失静默、被取代的路由仍会补发列表请求、设置页文案把 AI 能力限制说成仅 gh、仓库标签回退链缺失等 | 逐项先写失败用例再修：`listFailure` / `partialErrors` / `coverageNote` / `detailErrors`、`routeSeq` 守卫、三态错误 state、`overview 先于列表`、文案修正。38 用例全绿 |
| MEDIUM（记录，暂不改） | `workflows.js` | 四项原生契约边界，见下 | 已在 [README.md](../README.md#已知限制) 与 [design.md](design.md) §3.3 记录 |

### 记录在案的原生契约限制

1. 检视草稿与 Issue 关联写在插件自己的审计文件里，不进入宿主 Agent 生命周期；宿主不会代为回滚或清理。
2. 首次 prompt 可能触发宿主的会话标题生成（`dsh-session-title*` 生产者），检视/Issue 正文存在经由另一个模型 provider 处理的可能，插件无法固定标题 provider。
3. rc.2 的 prompt 去重在准入完成后才生效；准入窗口内的并发重试仍可能产生两条会话消息。插件用持久化 requestId 收敛，但不保证宿主侧幂等。
4. 关联标记 `ready` 时没有额外的落盘屏障（写入本身走 fsync+rename，但状态跃迁与宿主 ack 之间不是原子的），极端崩溃可能留下已标记未持久的关联。

### 本轮验证

| 命令 | 结果 |
|------|------|
| `node --test scripts/test-data.mjs scripts/test-api.mjs scripts/test-workflows.mjs scripts/test-client.mjs` | 77 tests，77 pass，0 fail（13 + 3 + 23 + 38） |
| `node scripts/test-host.mjs` | 77 passed, 0 failed |
| `npm test` | 上述两段全部通过 |
| `npm run lint` | 0 error |
| `npm pack --dry-run` | 9 文件，62.0 kB |

### 复盘要点

**测试 fixture 的签名宽松度就是 bug 的藏身度。** 一个接受单参数就返回成功的 mock，让「Issue 开发」这个核心卖点在整套绿色测试里活了很久。此后凡调用宿主方法，fixture 必须复刻已核实签名的** arity 与必填项**，并对必填对象做类型断言。

## 追加记录：全量复验（2026-10-16）

文档对齐并推送后重跑全量验证，并补上此前未复核的两件事。

| 项目 | 结果 |
|------|------|
| `node --test …`（data/api/workflows/client） | 77 tests，77 pass，0 fail |
| `node scripts/test-host.mjs` | 77 passed, 0 failed |
| `npm run lint` | 0 error |
| `npm pack --dry-run` | 9 文件，62.8 kB / 解包 198.3 kB |
| 独立开发服务 | `node scripts/dev.mjs` 正常启动并服务 `/codehub/index.html`（200）、`op=boot`（含 `capabilities`）、非回环 Host 返回 403 |
| 浏览器复验 SPA | 7 个视图（overview/mrs/issues/repos/stats/settings/reviews）均渲染出内容，无脚本异常 |

- 此前报告的「`npm run dev` 以 exit 1 启动失败」**不是缺陷**：端口 4173 被上一轮遗留的 dev 进程占用，脚本在 0.13s 内打印 `listen EADDRINUSE: address already in use 127.0.0.1:4173` 后退出并清理临时配置。这是预期行为，处理方式在 README 已记录（`PORT` 覆盖）。**教训：把「疑似」写成结论之前先取一次现场证据**（`netstat` + 真实 stderr），否则会追一个不存在的问题。
- 浏览器控制台唯一报错是两次 `op=models` 的 503——独立模式下没有原生 `llm` 目录，属预期降级，设置页对应提示「无法读取 DSH 模型：Required native service unavailable: llm model catalog」。原生模型目录、会话打开与工作区发现仍需**在真实 DSH 宿主内**验证，独立页面只能证明降级路径正确。
- 复验同时暴露两处文档数字漂移（README 打包体积 6.9 KB→8.4 KB、产物 62.0→62.8 kB），已在 [打包与离线安装指南](./packaging-and-offline-install.md) 更正。

### 复盘要点（本轮）

**「疑似」不能当成结论上报。** 上一轮我把 dev 服务失败归为「疑似端口占用」就写进了交付说明，本轮才知道它既是事实（遗留进程占用 4173）也不是缺陷（脚本 0.13s 内打印 EADDRINUSE 并清理临时配置）。一条 `netstat` + 真实 stderr 就能定性，代价远小于让人去修一个不存在的问题。同理，**独立 dev 页面只能证明降级路径正确，不能替代真实宿主验证**——原生 `llm` 目录、会话打开与工作区发现仍需在 DSH 内跑一遍。

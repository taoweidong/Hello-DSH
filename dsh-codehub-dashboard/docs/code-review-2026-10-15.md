# 代码审查与修复方案（2026-10-15）

> 范围：`index.js`（host 半）、`web/index.html`（SPA）、`client.js`。审查方式：全文通读 + 数据流追踪 + 渲染路径推演。
> 分级：P0 = 真 bug，必修；P1 = 高价值优化；P2 = 已知限制，记录不改。

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

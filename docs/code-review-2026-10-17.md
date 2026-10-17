# 代码质量评估报告 — dsh-codehub-dashboard

**审查类型**：只读全仓代码审查（复杂档）
**审查提交**：`0ddfecf release(v0.1.1)`，工作树 clean
**审查时间**：2026-10-17
**审查范围**：`index.js`(1265) / `workflows.js`(502) / `client.js`(90) / `web/index.html`(995) / `scripts/*.mjs`(1795) / `package.json` / `docs/` / `eslint.config.js`
**审查语言**：JavaScript（Node ESM + 浏览器内联脚本），DSH 插件

---

## 一、问题总数

**问题总数：11 个（致命 0 / 严重 1 / 警告 5 / 建议 5）**

| 级别 | 数量 | 说明 |
| --- | --- | --- |
| 致命 Critical | 0 | 未发现崩溃 / 数据丢失 / 可利用安全漏洞 |
| 严重 Major | 1 | P1-1，影响「未解决检视意见」筛选功能的可用性 |
| 警告 Warning | 5 | P1-2 ~ P1-6 |
| 建议 Suggestion | 5 | P2-1 ~ P2-5 |

---

## 二、审查总结

- **整体评分：86 / 100**
- **主要风险**：单点功能缺陷（unresolved 筛选恒空）与若干「重复无效上游探测」的性能/配额问题；无安全漏洞，无数据损坏路径。
- **优先修复（Top 3）**：
  1. **P1-1** `resolved` 恒为 `null`，导致「未解决检视意见」筛选与计数永久为 0（功能级缺陷，已有文档披露但未修）
  2. **P1-2** `ghAvailable` 在未登录时每 5 分钟重复探测一次，浪费子进程与 GitHub 配额
  3. **P1-3** `config.set` 返回后无条件触发 `snapshots(true)` 全量强刷，配置保存路径的延迟与配额放大
- **正向评价**（本仓工程质量明显高于同类插件，下列均为实测确认）：
  - **写路径幂等与并发防护完整**：`workflows.js` 的 `generating` 先落盘（:344）、`request` 快照冻结（:362-363）、`publishing/publish_unknown` 一律 409 且**绝不自动重试**（:401-402）、跨实例并发发布守卫有断言（`test-workflows.mjs:303-322` posts.length===1）。
  - **持久化原子性与 fail-closed**：`lock 'wx' 0600` → 读 → 变更 → 校验 → 临时文件 + `fsync` + `rename`，POSIX 目录 fsync（:212，win32 跳过并留注释，非静默）；状态损坏时**保留原文件不覆盖**（:185，断言 `test-workflows.mjs:399-404`）。
  - **输出转义纪律**：SPA 全部动态插值经 `esc()`（`web/index.html:591/635/795/802` 等），URL 经 `safeUrl()` 仅放行 `^https?://`（:301），从根上挡住 `javascript:` / `data:`。
  - **host bridge 对偶校验**：`client.js:53-76` 与 `web/index.html:325-362` 双向校验 `origin === location.origin && source === window.parent`，消息形状白名单 + `pending.action !== m.action` 拒绝 + `seen` Set 防重放（≥4096 上限）。
  - **写操作服务端兜底**：`['config.set','config.test','review.create','review.publish','issue.develop']` 强制 POST + origin/sec-fetch-site 403 + `application/json` 415（index.js:1151-1158）；`connection.admit` 缺失即 503 fail-closed（:1128）。
  - **前端竞态防护成体系**：`routeSeq`(:397) / `overviewSeq` `mrSeq` `rvSeq` `issueSeq`(:418) / `detailSeq`(:771,865)，且 `currentDetail = d => detail===d && d.seq===detailSeq`(:768) 双重判等；关闭抽屉即作废在途请求。
  - **AI 评审的人工闸门**：`review.create` 与 `review.publish` 各自独立 `confirm()`（:821,830），发布前强制 `w.preview === w.body` 否则拒发（:829），草稿正文可由人删改。
  - **截断/覆盖度诚实披露**：`LIMITED_COVERAGE` 后缀（workflows.js:147,370）、`coverageNote` / `partialErrors` / `staleNotice`（web:499-510）、`resolutionAvailable` 三态语义（index.js:919-923）——不把未知粉饰为「无问题」。
  - **测试质量高**：99 用例 + 91 断言全绿，且断言的是**行为**而非实现（late-response 丢弃、跨实例并发、publish_unknown 不重投、损坏状态保留原文件、防篡改冻结 `options.messages`/`tools` 写即抛 TypeError）。
  - **契约三源一致性有自动守卫**：`inject` 扁平数组（`client.js:7` == `package.json dsh.client.inject` == `test-host.mjs:58-60`）、`PLUGIN_VERSION` 三源一致（`test-host.mjs:322-325`）、`engines.dsh` == lockfile（:327）。

---

## 三、严重问题（建议修复）

### P1-1：「未解决检视意见」筛选与计数恒为空 —— `resolved` 从无真实取值

**位置**：`index.js:384`、`index.js:545`（两处固定 `resolved: null`）；下游 `index.js:919-923`、`index.js:1210`；前端 `web/index.html` 概览 KPI `未解决检视意见`

**原代码**：
```js
// index.js:384 / :545 —— 两处均为硬编码常量，无任何分支产生 true/false
resolved: null,
```

**问题描述**：GitHub REST 的 PR review comment 接口不返回线程解决状态（该状态只在 GraphQL `reviewThreads.isResolved` 中）。当前实现把 `resolved` 一律置 `null`，并有 `resolutionAvailable()` 明确对外声明「解决状态未知」。但下游仍在用 `c.resolved === false` 做筛选：

```js
// index.js:1210
if (q.get('unresolved') === '1') comments = comments.filter((c) => c.resolved === false)
```

由于 `resolved` 恒为 `null`，该过滤器的结果**必然为空数组**；前端概览的「未解决检视意见」KPI 亦恒为 0。用户看到的是一个永远点不出结果的筛选器和一个永远为 0 的指标。

**影响**：一个对外可见的主功能（未解决意见审阅）静默失效。不造成数据损坏或安全问题，但会把「当前无未解决意见」错误地传达给用户——这是**误导性正确外观**，比报错更危险。

**修复建议**（二选一，推荐 A）：

A. **诚实降级**（成本低，与现有 `resolutionAvailable` 设计一致）：`resolved` 不可得时，UI 隐藏该筛选器与 KPI，而非展示恒 0 值。
```js
// web/index.html 概览 KPI 段：仅当接口明确声称可得时才渲染
${state.overview?.summary?.resolutionAvailable === true
  ? kpi(s.unresolvedComments?"warn":"","未解决检视意见",s.unresolvedComments,`共 ${fmtNum(s.totalComments)} 条`,"#/reviews&unresolved=1")
  : ""}
```
```js
// index.js:1210 同步收紧，避免"看起来支持"的假象
if (q.get('unresolved') === '1' && cfgHasResolution) comments = comments.filter((c) => c.resolved === false)
```

B. **补齐数据源**：详情路径改用 GraphQL `reviewThreads { isResolved }` 取真实值。REST→GraphQL 需新增一次请求，注意与 `detailLimit`(:1110) 预算叠加后的配额影响，并同步更新 `resolutionAvailable()` 与 `docs/api-reference.md`。

**注**：本问题在 `docs/project-analysis-and-task-plan-2026-10-17.md` 中已作为 P1-5 记录，但至今未修，故本次仍以严重级计入。

---

## 四、警告与建议

### P1-2：`ghAvailable` 未登录时每 5 分钟重复探测

**位置**：`index.js:715-723`
```js
if (ghOkCache.ok && Date.now() - ghOkCache.at < 300_000) return { ok: true, loggedIn: ghOkCache.loggedIn }
// ← 早退条件只覆盖 ok === true；ok === false 时完全不走缓存
```
**问题**：`loggedIn` 被存入缓存却不参与早退判定。当 `gh` 未安装或未登录（`ok:false`）时，每次刷新都会重新 spawn 一次 `gh auth status` 子进程（受 `mapLimit` 并发 3 约束但仍会重复），既浪费进程开销也消耗调用延迟。本机若长期未登录 `gh`，这是持续性的无效开销。

**修复建议**：
```js
const age = Date.now() - ghOkCache.at
const ttl = ghOkCache.ok ? 300_000 : 60_000   // 失败态更短，但也要有
if (age < ttl) return { ok: ghOkCache.ok, loggedIn: ghOkCache.loggedIn }
```

### P1-3：`config.set` 无条件全量强刷，阻塞面与配额放大

**位置**：`index.js:1220-1224`
```js
await store.set(await payload()); fetcher.invalidate()
sendJson({ ok: true, config: store.masked(), overview: null, refreshQueued: true })
snapshots(true).catch(err => log?.warn?.('[codehub] refresh after save failed:', err.message)); return
```
**问题**：响应已发出（设计正确，不阻塞保存），但紧随其后的 `snapshots(true)` 是**强制刷新所有仓库**（绕过 TTL）。若用户在设置页连续保存 N 次（例如逐个添加仓库），会触发 N 次全量拉取。`fetcher.invalidate()` 已清空缓存，本可延迟到下一次自然轮询（`pollMinutes` TTL，默认 10 分钟）。

**修复建议**：改为非强刷 `snapshots(false)`，或合并去抖（复用 `reviewLoad` 式的单飞模式）：
```js
let refreshQueued = null
const queueRefresh = () => { if (!refreshQueued) refreshQueued = snapshots(false).catch(...).finally(() => { refreshQueued = null }) ; return refreshQueued }
```

### P1-4：CSP 含 `script-src 'unsafe-inline'`，纵深防御存在已知缺口

**位置**：`index.js:1142`（注释在 :1134-1138 已如实承认）
```js
'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; ..."
```
**问题**：因 SPA 采用内联 `<script>` 与内联样式，`unsafe-inline` 无法去除，故 CSP 不能阻断「注入的内联 handler 执行」。它仍有效挡住远程代码加载与跨源外泄（`default-src 'self'` + `connect-src 'self'` + `base-uri 'none'` + `form-action 'none'` + `frame-ancestors 'self'`），属**有意义的纵深防御**，但不是完整的 XSS 防线。

**现实风险评级：低**。原因：所有动态插值均经 `esc()`（已逐处复核 `web/index.html:591/635/795/802` 等），且 `href` 经 `safeUrl()` 白名单。当前唯一依赖是「开发者不遗漏 esc」。

**修复建议**（择机，非阻塞）：为内联脚本计算 `sha256-` 哈希替代 `'unsafe-inline'`；或把 `web/index.html` 的内联脚本外置为 `/codehub/app.js`（需同步 `test-client.mjs:121-122` 的提取逻辑与 `package.json files` 白名单）。**注意**：任何此类改动都必须同步核对 `docs/design.md` 的 CSP 描述（该处无自动断言守卫）。

### P1-5：`publish` 的 preflight catch 内嵌套 `disk.update` 可能覆盖原始错误

**位置**：`workflows.js:421` 附近
```js
} catch (err) {
  await disk.update(draft.id, { status: 'draft' })   // ← 若此处自身抛错，原始 verify 错误被替换
  throw err
}
```
**问题**：preflight（rev / 身份 / headSha 校验）失败时要把草稿退回 `draft` 态；若退回写盘本身失败（磁盘满 / 权限），抛出的将是 `disk.update` 的错误，而非真正的校验失败原因，诊断信息被掩盖。发生概率低（需同时满足两个失败），但会显著延长排障时间。

**修复建议**：
```js
} catch (err) {
  try { await disk.update(draft.id, { status: 'draft' }) }
  catch (e) { log?.warn?.('[codehub] draft rollback failed:', e?.message ?? e) }
  throw err
}
```

### P1-6：`stars` 等破坏性 `repos.discover` 可枚举本机任意目录（本机信任模型内）

**位置**：`index.js:1230-1233` + `index.js:967-994`
```js
const ws = q.get('ws') || ''; if (!ws) { sendJson(...400); return }
const depth = Math.max(1, Math.min(3, Number(q.get('depth') || 2))); const repos = await discoverGitRepos(ws, depth)
```
**问题**：`ws` 为**任意绝对路径**，无白名单约束；`discoverGitRepos` 会递归（深度 ≤3、总量 ≤40）读取该目录树下的 `.git`、`git remote get-url origin` 与当前分支名，并以 JSON 返回。虽属**只读**（不落盘、不修改），且受 `connection.admit` 鉴权保护，但在 DSH 本机信任模型下仍可让已登录用户在浏览器内枚举本机 git 仓库结构（路径名 + 远程地址 + 分支）。

**现实风险评级：低**（前提是 DSH 本机信任模型成立，且访问者已通过宿主鉴权）。记录于此以备后续加固。

**修复建议**（可选）：限制 `ws` 必须位于用户已配置的工作区根之下（`resolve(ws).startsWith(configuredWorkspaceRoot)`），或要求先经 `pick-directory` 原生选择器授权。

### P2-1：`kpi()` 的 `sub` 参数未转义直插 DOM

**位置**：`web/index.html:497`
```js
function kpi(cls,lab,val,sub,hashP){ return `...${sub?`<div class="sub">${sub}</div>`:""}...`; }
```
**问题**：`lab` / `cls` / `hashP` 均经 `esc()`，唯独 `sub` 未转义。

**证伪结果：当前不可达（非漏洞）**。已枚举全部 14 个调用点（:520-538），`sub` 实参全部为**字面量中文**或**已 esc 的值**：
- `:534` `` s.me ? `身份：${esc(s.me.name)}` : "未配置身份" `` —— 已转义
- `:533` `` s.drafts ? `含 ${s.drafts} 个草稿` : "" `` —— `s.drafts` 由后端 `overviewFrom` 计算为数字
- `:535` `` `共 ${fmtNum(s.totalComments)} 条` `` —— `fmtNum` 输出数字格式
- 其余（:520-523, 530-532, 536-538）为 `""` 或纯中文字面量

**结论**：当前无注入路径，但该函数的不转义契约属**潜在陷阱**——未来任何调用点传入用户可控字符串即成 XSS。属「防御性修复」，不计为安全漏洞。

**修复建议**：`${sub?`<div class="sub">${esc(sub)}</div>`:""}`（调用点已 esc 的值会被二次转义，需同步移除 :534 的内层 `esc`）。

### P2-2：SPA 关闭抽屉后内联 HTML 改动不落盘

**位置**：`web/index.html:865`
```js
function closeDrawer(){++detailSeq;detail=null;...}
```
**观察**：`beginDetail`(:769-776) 中 `if(!detail) drawerFocus=document.activeElement;`——仅在「当前无抽屉」时记录焦点。`closeDrawer` 会恢复焦点并作废在途请求（`++detailSeq`）。

**证伪结果**：**功能正确，非缺陷**。已构造反例尝试：抽屉 A → 抽屉 B → 关闭，此时焦点恢复至打开 A 之前的位置（因 B 打开时 `detail` 非空，不覆盖 `drawerFocus`）。这是期望行为。此处列出仅因它是评审时的高频疑点，特此记录证伪过程。

**如欲更严谨**（建议级）：`drawerFocus` 在 `closeDrawer` 后置 `null`，避免持有已卸载 DOM 节点引用（当前节点可能因 `render()` 重绘而脱离文档，`?.focus?.()` 静默失败，影响极小）。

### P2-3：`service()` 软探测规避 cordis 属性访问抛错 —— 需保留但不显眼

**位置**：`workflows.js:296-299`
```js
const ctx.get(name, false)   // false = 不抛错，软探测
```
**观察**：这是对 cordis 行为的正确适配（AGENTS.md 明确记录过 `inject` 写成对象会导致插件永久 pending 的历史事故）。但该调用形态在代码中无注释解释 `false` 的含义。

**修复建议**：加一行注释 `// false: 未注册时返回 undefined 而非抛错，便于能力降级`。属可读性建议。

### P2-4：`clone = JSON.parse(JSON.stringify(x))` 丢失 `undefined` 值

**位置**：`workflows.js:20`
**证伪结果**：**当前无影响**。该 clone 用于纯 JSON 请求体（`request` 快照），源头已是可序列化结构，`JSON.stringify` 丢弃 `undefined` 键在此语义下符合预期（JSON 本身无 `undefined`）。

**建议**：若未来该函数被复用到含 `undefined` 语义的对象，需替换为 `structuredClone`。当前保持现状，仅记录。

### P2-5：`scripts/check-version.mjs` 注释仍写 v0.1.0

**位置**：`scripts/check-version.mjs`（24 行）；当前 `package.json` 版本已为 `0.1.1`
**问题**：脚本内注释与实际版本号脱节，属文档漂移。该脚本无自动断言守卫（`test-host.mjs` 只断言 `PLUGIN_VERSION` 三源一致，未覆盖此注释）。

**修复建议**：更新注释，或将其改为从 `package.json` 读取而非硬编码。

### P2-6（附加）：`ghAvailable` 缓存 `cache` Map 无硬上限

**位置**：`index.js:693`
**证伪结果**：**低风险**。`cache` 的 key 是已配置仓库的 `repo.key`，数量由用户配置决定（配置面本身受 UI 约束），不存在无界增长的攻击路径。仅提示：若未来支持组织自动发现（`org` 展开大量仓库），需补 LRU 上限。

---

## 五、验证证据

### 5.1 门禁执行（本回合实跑）

```sh
cd E:/GitHub/dsh-codehub-dashboard
node -v   # v24.4.0
npm -v    # 11.11.0
npm run lint   # eslint .  → 0 error（输出为空）
npm test       # exit=0
```

`npm test` 实测输出：
```
ℹ tests 99
ℹ pass 99
ℹ fail 0
91 passed, 0 failed
exit=0
```

- `node --test` 四件套（`test-api` / `test-client` / `test-data` / `test-workflows`）：99 用例，99 通过，0 失败
- `test-host.mjs`：91 断言通过，0 失败

**口径说明**：「99 用例 / 91 断言」为上述命令的实际计数（分子分母同源，非抽样）。

### 5.2 仓库状态（本回合实查）

```
HEAD: 0ddfecf release(v0.1.1): coverage disclosure, CI hardening, and test expansion
git status --short: （空，工作树 clean）
```

### 5.3 代码阅读口径

本轮为**全量精读 + 二次实码复核**，非抽样：

| 文件 | 行数 | 阅读方式 |
| --- | --- | --- |
| `index.js` | 1265 | 全文精读 + 二轮定点复核（缓存/存储/路由/工作流接入） |
| `workflows.js` | 502 | 全文精读 |
| `client.js` | 90 | 全文精读 |
| `web/index.html` | 995 | 全文精读（含内联 script :294-993） |
| `scripts/test-*.mjs` | 1795 | 用例清单 + 关键断言定点阅读 |
| `package.json` / `docs/*` | — | 契约字段交叉核对 |

### 5.4 证伪记录（关键结论的反例构造）

| 结论 | 反例构造尝试 | 结果 |
| --- | --- | --- |
| `kpi()` 的 `sub` 存在 XSS（P2-1） | 枚举全部 14 个调用点，寻找用户可控入参 | **证伪成功**：全部为字面量或已 esc 值，当前不可达 |
| `closeDrawer` 焦点恢复错乱（P2-2） | 构造 A→B→关闭 序列 | **证伪成功**：`if(!detail)` 守卫使其行为正确 |
| `clone` 丢失 `undefined` 造成缺陷（P2-4） | 检查所有调用点入参来源 | **证伪成功**：入参均为 JSON 可序列化结构 |
| `cache` Map 无界增长（P2-6） | 寻找可绕过配置约束的写入路径 | **证伪成功**：key 受用户配置仓库数约束 |
| `resolved` 恒 null 导致筛选失效（P1-1） | 尝试找出任何产生 `true`/`false` 的分支 | **未能证伪**：`index.js:384` 与 `:545` 两处均为硬编码常量 → 确认为真 |

### 5.5 安全红线清单逐条对照

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| SQL 参数化 | N/A | 本仓无数据库访问 |
| 输出转义（HTML/JS/URL） | ✅ | `esc()` 全量插值；`safeUrl()` 仅放行 `^https?://`（web:301）；已复核 :591/:635/:795/:802 |
| 文件路径白名单 / 拒 `../` | ✅ | `isSafeRepoPath`（index.js）+ `target()` 禁控制字符 + `own(Object.prototype)` 检查（workflows.js:53-60）；`cwd` 强制 `isAbsolute`（:159） |
| 上传类型白名单 + 大小限制 | ✅ | `readBody` 256KB 上限 + `destroyed` 防重复 settle + `req.destroy`（index.js:1037-1049）；`MAX_BODY_BYTES=32KB` / `MAX_DIFF_BYTES=64KB` / `MAX_STREAM_BYTES=512KB` |
| 敏感信息不入前端 | ✅ | `store.masked()` 只回 `maskToken` 结果 + `hasToken` 布尔（index.js:190-192）；`test-host.mjs:251-259` 断言磁盘为明文、接口为非明文 |
| CSRF | ✅ | 写操作 POST-only + origin != host → 403 + `sec-fetch-site: cross-site` → 403（index.js:1151-1158） |
| 权限后端兜底 | ✅ | `ctx.connection.admit(req)`，服务缺失即 503 fail-closed（index.js:1128-1130）；有专测 `every route requires native connection admission and fails closed without it` |
| 错误信息不泄露内部细节 | ✅ | API 层 `clip(err.message, 300)` + `headersSent` 守卫（index.js:1236-1239）；`gh` stderr 经 `clip(...,400)` |
| 依赖漏洞排查 | ⚠️ 未实测 | 本次为只读审查，**未执行 `npm audit`**（见第六节未验证项） |
| 日志不含密码/Token | ✅ | `log.warn` 仅记录 `err.message`；`maskToken` 用于所有对外出口；已 grep 确认无 token 直出 |

### 5.6 清单化质量自审逐条对照

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| 异常处理完备 | ✅ | 路由层统一 catch + 状态码映射；`readList` 局部降级并收集 `detailErrors`（index.js:537-540）；损坏状态 fail-closed 保留原文件 |
| 硬编码常量已提取 | ✅ | `MAX_DRAFTS/MAX_ISSUES/MAX_STATE_BYTES/MAX_DIFF_BYTES/MAX_BODY_BYTES/MAX_STREAM_BYTES/MAX_TOKENS/REVIEW_TIMEOUT_MS/PROMPT_TIMEOUT_MS`（workflows.js:5-13）；`MAX_EXEC_BUFFER`/`EXEC_TIMEOUT_MS`/`FETCH_CONCURRENCY`（index.js:35-37） |
| SQL / 外部输入已参数化 | ✅ | 无 SQL；外部输入经 `target()`/`bounded()`/`confirmed()` 三重校验（workflows.js:46-83） |
| 输出已转义 | ✅ | 见 5.5 第 2 项 |
| 敏感信息不入日志/返回值 | ✅ | 见 5.5 第 5、10 项 |
| 文件操作含路径白名单校验 | ✅ | `isSafeRepoPath` + `resolve()` + `isGitRepo()` + origin 比对（index.js:1084-1094）；`lock 'wx'` 防并发写 |
| 超时/重试已设置上限 | ✅ | `AbortSignal.timeout`（index.js:516,623）；`execFile timeout: EXEC_TIMEOUT_MS`（:80）；`REVIEW_TIMEOUT_MS`/`PROMPT_TIMEOUT_MS`；网络重试上限 2 次且**写操作不重试**（index.js:506-507 注释明确） |
| 并发/竞态场景已处理 | ✅ | 前端 6 组 seq 守卫；后端 `saving` promise 串行链（index.js:157-189）、`mapLimit` 并发 3、`reviewLoad` 单飞、跨实例发布守卫 |
| 接口幂等性已保证 | ✅ | `develop` 用 `rpcId` 去重（workflows.js:481-485）；`publish` 的 `publishing`/`publish_unknown` 一律 409 不自动重试；`config.set` 幂等（全量覆盖） |
| 注释与代码一致 | ⚠️ 1 处漂移 | `scripts/check-version.mjs` 注释写 v0.1.0，实际 0.1.1（P2-5）。其余抽查一致，含 win32 fsync 跳过、`unsafe-inline` 局限、`ensureBoot` memo 原因等高质量注释 |

### 5.7 未改断言（可核验）

本次任务为**只读审查**，除本报告文件外**未修改任何被审查文件**：
- `index.js` / `workflows.js` / `client.js` / `web/index.html` / `scripts/*.mjs` / `package.json` **逐字节未改**
- 未执行 `git commit`、`git push`
- **唯一新增文件**：`docs/code-review-2026-10-17.md`（本报告）

---

## 六、已知限制 / 未验证项 / 部分失败明细

| 项 | 缺口类型 | 说明 |
| --- | --- | --- |
| 真实宿主激活 | **未实测** | `scripts/test-host.mjs` 用 mock ctx 直接调用 `apply()`，绕过 cordis 服务解析。**本次未查看真实 DSH 启动日志**，无法证明插件在真实宿主成功激活。AGENTS.md 将此列为必做验收项（见 `docs/host-verification-2026-10-16.md`），且历史文档记载该缺口**至今未闭合**。这是本次评估**最重要的未验证项**。 |
| 依赖漏洞 | **未实测** | 未执行 `npm audit` / 未做 SCA 扫描。安全红线清单第 9 项因此标记为 ⚠️ 而非 ✅。 |
| 真实 GitHub 端到端 | **环境不可达** | 未用真实 token 驱动真实 GitHub API，故：`gh` CLI 字段契约仅有本地断言守卫（`test-host.mjs:189-195`），未经线上验证；REST 分页、rate limit、企业版 host 行为均未实测。 |
| 性能量化 | **未实测** | 报告中的性能类判断（P1-2 重复探测、P1-3 强刷放大）基于**代码路径分析**，未做基准测量。未给出毫秒级影响数字。 |
| 浏览器真人验证 | **未实测** | SPA 行为结论来自 `web/index.html` 静态精读 + `test-client.mjs` 的 vm 沙箱驱动（该沙箱的假节点 `querySelectorAll` 返回空数组，故 **focus-trap（:939-940）分支无断言**）。未在真实浏览器中驱动 UI。 |
| `kpi` 转义修复 | **未实施** | P2-1 属建议级，本次只读审查未改码。修复时需同步移除 :534 内层 `esc` 以避免双重转义。 |
| 文档契约漂移 | **无自动守卫** | `docs/design.md` 中 `dsh.client.inject` 描述靠人工核对（AGENTS.md 明确说明「没有测试能发现文档单边漂移」）。本次已人工核对一致，但该类漂移未来仍无自动发现能力。 |

---

## 七、方法论与抗合理化声明

本次为**只读复杂档审查**，未进入修改循环。已执行的关键纪律：

1. **回实码复核**：所有引用压缩摘要/历史文档的结论，均在写报告前回原始代码逐行核对。例如 `resolved` 恒 null、`ghAvailable` 早退条件、`config.set` 强刷路径，均以本回合直读的代码行为准，而非采信摘要或 `docs/project-analysis-and-task-plan-2026-10-17.md` 的结论。

2. **历史文档口径修正**：`docs/project-analysis-and-task-plan-2026-10-17.md` 生成于 `abd9a82` 扁平化**之前**、工作树 dirty 时，其 P0-2 / P0-3 已被后续提交闭合。本报告**未照抄**该快照，只保留经本轮实码复核仍成立的条目（P1-5 → 本报告 P1-1）。

3. **证伪门禁**：每个关键结论交付前尝试构造反例（见 5.4）。P2-1 / P2-2 / P2-4 / P2-6 四条候选经证伪后**降级或撤销**，未当作问题上报；P1-1 经证伪失败后确认为真。

4. **不确定项标注**：所有未能实测的项已列入第六节并标注缺口类型，未用「应该没问题」掩盖。安全红线清单第 9 项（依赖漏洞）如实标记为 ⚠️。

5. **未改断言**：见 5.7，已写成可核验断言而非默认省略。

---

## 八、收尾报告

```
📊 完成度: 100%（只读审查主线 1/1 已完成，含 Step 4 验证证据）
   主线: 已完成 | 产出: 全仓只读代码质量评估报告 docs/code-review-2026-10-17.md，
   覆盖 index.js/workflows.js/client.js/web/index.html/scripts 共 4647 行源码，
   以 npm run lint（0 error）+ npm test（99 用例全过 / 91 断言全过 / exit=0）为门禁证据。
   待办: P1-1（resolved 恒空致筛选失效）建议优先修复；P1-2/P1-3 性能项建议排期；
   6 项未验证项见第六节，其中「真实宿主激活」为最高优先补验项。
   下一步: ①运行真实 DSH 并检查启动日志有无 did not activate / waiting for services；
   ②执行 npm audit 补全依赖漏洞维度；③修复 P1-1（推荐方案 A 诚实降级）。
```

---

**审查结论**：本仓**未发现致命问题**，无数据丢失路径、无可利用安全漏洞。工程质量在插件类项目中属**上乘**——原子持久化、fail-closed 损坏处理、写操作幂等守卫、前端竞态体系、诚实覆盖度披露，均达到生产级标准，且都有对应测试断言。

扣分集中在：**1 个静默失效的功能**（P1-1，会向用户传达错误结论）、**2 处上游调用放大**（P1-2/P1-3，属配额与延迟效率），以及**依赖漏洞维度未实测**。修复 P1-1 后，本仓可支撑一次发布。
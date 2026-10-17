# 复审修复记录：v0.1.2（2026-10-17）

> 版本：0.1.2 | 上一版：0.1.1（`0ddfecf`）
> 基线来源：[code-review-2026-10-17.md](code-review-2026-10-17.md) 的 P1/P2 清单。
> 本文档**只写本轮真实做过的改动**；未做的在文末「未修复项」如实列出，理由一并给出。**没有把未做说成已做**。

---

## 0. 一句话结论

本轮修复 **P1-1（后端半+前端半）、P1-2、P1-3、P2-1、P2-5** 共 5 项；**未修复** P1-4、P1-5、P1-6、P2-2、P2-3、P2-4、P2-6 与 1 项测试期新发现的 tooltip 守卫缺失。
版本 bump 0.1.1 → 0.1.2，落点 4 处（全部有断言守卫）。

---

## 1. 版本 bump 0.1.1 → 0.1.2（4 处断言点 + 1 处注释）

| # | 位置 | 改动前 | 改动后 | 守卫 |
|---|------|--------|--------|------|
| 1 | `package.json:3` | `"version": "0.1.1",` | `"version": "0.1.2",` | 版本门禁 |
| 2 | `package-lock.json:3` 与 `:9` | `"version": "0.1.1",` | `"version": "0.1.2",` | `npm ci` / lockfile 断言 |
| 3 | `index.js:33` | `const PLUGIN_VERSION = '0.1.1'` | `const PLUGIN_VERSION = '0.1.2'` | `test-host.mjs` boot version |
| 4 | `scripts/test-host.mjs:86` | `boot.data.version === '0.1.1'` | `boot.data.version === '0.1.2'` | 自身即断言 |
| 5 | `scripts/check-version.mjs:3` | `// Usage: node scripts/check-version.mjs v0.1.0` | `// Usage: node scripts/check-version.mjs v0.1.2` | 注释（P2-5） |

**关于 package-lock.json**：用 `npm install --package-lock-only` 重算，未手改格式。lockfile 的根版本出现在**两处**（顶层 `version` 与 `packages[""].version`），两者同步更新；`git diff --stat package-lock.json` 为 `2 insertions(+), 2 deletions(-)`，即只有这两行，无格式抖动。
依赖自身的 `0.1.x` 版本（`deep-is@0.1.4`、`imurmurhash@0.1.4`、`yocto-queue@0.1.0`）**未改动**。

**关于 index.js**：只改第 33 行的版本字符串字面量。`git diff -U0 -- index.js` 中属于本任务的行有且只有：
```
-const PLUGIN_VERSION = '0.1.1'
+const PLUGIN_VERSION = '0.1.2'
```
其余 index.js 差异（`:719-721`、`:1107-1114`、`:1220+`、`:1236`）属 backend-fixer 的 P1-1/P1-2/P1-3 修复，非本次版本任务所写。

---

## 2. 已修复项

### P1-1 — 「未解决」指标在数据源未知时诚实降级（后端半 + 前端半）

**问题**：gh/REST 评论不携带线程解决状态，`resolved` 恒为 `null`；此前 UI 把 `unresolvedCount` 的恒 0 当成「真的没有未解决意见」展示，属于把「未知」冒充成「已知的 0」。同一根因导致「有未解决意见 / 未解决」筛选入口永远返回空列表。

**位置**：
- 后端 `index.js:1220-1221`（注释补强，语义不变）
- 前端 `web/index.html`：`viewOverview`（`resKnown` 定义）、`viewStats` KPI「未解决检视意见」、`viewMrs`（`fUnres`）、`viewReviews`（`rUnres`）、`repoCard`
- 样式 `web/index.html:137`：新增 `.tgl:disabled{opacity:.55;cursor:not-allowed}`

**改动前后**：

后端（`index.js:1220` 附近）：筛选语义保持不变，仅补注释说明该筛选依赖线程解决状态、当前数据源恒 `null` 故结果必然为空，且前端已在 `resolutionAvailable !== true` 时禁用入口。**未**把 `resolved` 改成 `false`，**未**引入 GraphQL。

前端：
```js
// 前：无 resKnown，恒 0 直接展示
${kpi(s.unresolvedComments?"warn":"","未解决检视意见",s.unresolvedComments,`共 ${fmtNum(s.totalComments)} 条`,"#/reviews&unresolved=1")}
// 后：未知时显示「—」与说明文案
const resKnown=s.resolutionAvailable===true;
${kpi(s.unresolvedComments?"warn":"","未解决检视意见",resKnown?s.unresolvedComments:"—",resKnown?`共 ${fmtNum(s.totalComments)} 条`:"线程解决状态未知","#/reviews&unresolved=1")}
```
```html
<!-- fUnres / rUnres：未知时 disabled + title 说明，且未勾选态不被强制点亮 -->
<label class="tgl${unresOn?" on":""}" title="${resKnown?"":"线程解决状态未知，暂不可用"}"><input type="checkbox" id="fUnres"${unresOn?" checked":""}${resKnown?"":" disabled"}/>有未解决意见</label>
```
`repoCard` 的「未解决意见」数字同样在未知时显示 `—` 并带 `title`。

**设计选择**：采用「**保留入口 + 置灰禁用 + tooltip 说明**」而非隐藏。理由：隐藏会让布局在两种数据状态下跳动，且 KPI 卡片本身带 `#/reviews&unresolved=1` 深链，隐藏入口反而让深链无落点；置灰保留了「这里本该有个筛选」的可发现性，同时不产生误导结果。

**验证方式（实测）**：
- `node --test scripts/test-client.mjs` 通过；W4 新增的降级双分支断言（`resolutionAvailable !== true` 与 `=== true` 两条对照）通过。
- `node --test scripts/test-data.mjs` 通过，含既有 `unknown comment resolution does not inflate unresolved counts` 与 `overview reports whether comment resolution is knowable`，以及 W2 新增的「未知 ≠ 未解决」断言。
- 全量 `npm test` → **tests 116 / pass 116 / fail 0**。

---

### P1-2 — `ghAvailable` 失败态不缓存，导致每次刷新都重新 spawn gh

**问题**：原判断 `if (Date.now() - ghOkCache.at < 5 * 60_000) return ghOkCache.ok` 在 `ok === false` 时逻辑上并不短路（失败态缓存窗口内仍会重新探测），gh 未安装/未登录时每次刷新都重新执行 `gh --version` + `gh auth status` 两个子进程。

**位置**：`index.js:719-721`

**改动前后**：
```js
// 前
if (Date.now() - ghOkCache.at < 5 * 60_000) return ghOkCache.ok
// 后：成功态 300s、失败态 60s 的非对称 TTL，两种状态都走缓存
const age = Date.now() - ghOkCache.at
const ttl = ghOkCache.ok ? 300_000 : 60_000
if (age < ttl) return ghOkCache.ok
```
返回值仍为 `boolean`（调用方 `fetchOne(repo, cfg, ghOk, ...)` 只吃 boolean）。`invalidate()` 把缓存重置为 `{at:0,...}`，`age` 极大必然重新探测，语义正确且未改动。

**验证方式（实测）**：`node --test scripts/test-data.mjs` 通过（W2 新增失败态缓存窗口断言）。**忠实说明**：`ghAvailable` 是 `createFetcher` 内部闭包，外部无法直接观测 `ghProbe` 调用次数；W2 的断言覆盖的是可通过 `__test` 观测到的行为面，未逐次计数子进程调用。全量 116/116、lint exit 0。

---

### P1-3 — `config.set` 保存后无条件全量强刷

**问题**：保存配置后无条件 `snapshots(true)`（绕过 TTL 的强制全量刷新），连续保存 N 次即触发 N 次全量拉取，且未做并发去重。

**位置**：`index.js:1107-1114`（新增 `saveRefresh` 与 `queueRefreshAfterSave`）、调用点 `index.js:1236`

**改动前后**：
```js
// 前（调用点）
snapshots(true).catch(err => log?.warn?.('[codehub] refresh after save failed:', err.message)); return

// 后（新增 helper，单飞去抖 + 非强刷）
let saveRefresh = null
const queueRefreshAfterSave = () => {
  if (saveRefresh) return saveRefresh
  saveRefresh = snapshots(false)
    .catch(err => log?.warn?.('[codehub] refresh after save failed:', err.message))
    .finally(() => { saveRefresh = null })
  return saveRefresh
}
// 调用点
queueRefreshAfterSave(); return
```
响应形状与时机未变：`sendJson({ ok:true, config: store.masked(), overview: null, refreshQueued: true })` 仍在 `await` 之前发出；`overview: null` 与 `refreshQueued: true` 字段保持原样（前端依赖 `overview: null` 保留旧值）。并发保存只触发一次实际拉取；不再传 `true`（强制）。

**验证方式（实测）**：`node --test scripts/test-data.mjs` 通过（W2 新增保存路径去抖断言）；全量 `npm test` 116/116。

---

### P2-1 — `kpi()` 的 `sub` 未转义（XSS/渲染缺陷）

**问题**：`kpi(cls,lab,val,sub,hashP)` 把 `sub` 直接插入 `<div class="sub">${sub}</div>`，未转义。同时有调用点已对内层做了 `esc()`，若只在外层补转义会双重转义，把身份名显示成 `&amp;lt;` 之类。

**位置**：`web/index.html:498`（函数本体）、调用点 `web/index.html:538`（原 `:534`）

**改动前后**：
```js
// 前
function kpi(cls,lab,val,sub,hashP){ return `...<div class="val">${fmtNum(val)}</div>${sub?`<div class="sub">${sub}</div>`:""}</a>`; }
// 后：sub 统一 esc；val 做类型感知兜底（数字走 fmtNum，非数字走 esc，覆盖 P1-1 传入的 "—"）
function kpi(cls,lab,val,sub,hashP){ return `...<div class="val">${typeof val==="number"?fmtNum(val):esc(val)}</div>${sub?`<div class="sub">${esc(sub)}</div>`:""}</a>`; }
```
调用点去掉内层预转义，避免双重转义：
```js
// 前：s.me?`身份：${esc(s.me.name)}`:"未配置身份"
// 后：s.me?`身份：${s.me.name}`:"未配置身份"
```
全部 14 个 `kpi(` 调用点已逐条复核：其余 `sub` 实参为字面量中文 / 数字 / 模板字符串，均不含预先 `esc()` 的值（唯一弊处即 `:538` 的身份名，已修正）。

**验证方式（实测）**：`node --test scripts/test-client.mjs` 通过；W4 新增断言用含 `<img src=x onerror=alert(1)>` 的 `sub` 实参，断言渲染输出中被转义为 `&lt;img…`（断言渲染结果，不是「代码里有 esc(」）。全量 `npm test` 116/116。

---

### P2-5 — `check-version.mjs` 注释漂移

**问题**：注释示例仍是 `v0.1.0`，而 `package.json` 已到 0.1.1+，属文档/注释漂移（该文件不硬编码版本，逻辑本身正确：`:12` 由 `package.json` 推导期望 tag）。

**位置**：`scripts/check-version.mjs:3`

**改动前后**：`// Usage: node scripts/check-version.mjs v0.1.0` → `// Usage: node scripts/check-version.mjs v0.1.2`

**验证方式（实测）**：`node scripts/check-version.mjs v0.1.2` → 输出 `tag v0.1.2 matches package.json version 0.1.2`，**exit 0**；`node scripts/check-version.mjs v0.1.1` → 输出 `tag "v0.1.1" does not match package.json version "0.1.2" (expected v0.1.2)`，**exit 1**（证明门禁真的在拦）；无参调用亦 exit 1 并打印 usage。

---

## 3. 文档口径同步

| 文件 | 位置 | 改动 |
|------|------|------|
| `docs/design.md` | `:3` | 版本行 → 0.1.2 |
| `docs/api-reference.md` | `:3`、`:44` | 标题版本与 boot 响应 `"version"` → 0.1.2 |
| `docs/packaging-and-offline-install.md` | `:3` | 标题版本 → 0.1.2 |
| 同上 | `:28`、`:73`、`:140`、`:163`、`:177`、`:319`、`:321`、`:325` | tgz 文件名 → `dsh-codehub-dashboard-0.1.2.tgz`（共 8 处） |
| 同上 | `:32` | 0.1.1 的体积数字标注为历史实测值；0.1.2 体积标「待 `npm pack` 后回填」 |
| 同上 | `:143` | 历史实测输出说明改为「0.1.1/0.1.2 仅文件名不同」 |
| 同上 | `:262` | 升级示例 → `# 例：0.1.2 → 0.1.3` |
| `docs/quality-assessment-2026-10-16.md` | 文末新增 `### 5.1` | 追加 0.1.2 复审修复进展条目 |
| `releases/README.md` | `:18-24` | 新增 0.1.2 归档行（tgz 实测 68,505 B / 2026-10-17 20:19）+ 更新「最新交付版本」表述 |

**保留未改（有意为之）**：
- `docs/packaging-and-offline-install.md:131/:132/:148` 的 `0.1.0` 是**历史实测输出**的引用，照抄事实，改动会失真。
- `docs/quality-assessment-2026-10-16.md:7`、`:76`、`:78` 属该文档「2026-10-17 后续更新」段对当日状态的记录，**不回溯改写**；0.1.2 进展以新增 `5.1` 小节追加，并在其中标注「上文 §5 的 99/91 为 10-17 早间数字，保留不改」。
- `docs/project-analysis-and-task-plan-2026-10-17.md`：历史快照，按任务要求不动。
- `docs/code-review-2026-10-17.md`：本轮审查报告，属历史记录，不动。

---

## 4. 契约字段交叉核对（AGENTS.md 要求，无自动守卫）

`dsh.client.inject` 的四处引用已重新人工核对，**一致**：

| 引用处 | 值 |
|--------|-----|
| `package.json:58-62` | `["slots","layout","uiWorkspace"]` |
| `client.js:7` | `const inject = ["slots", "layout", "uiWorkspace"];` |
| `docs/design.md:95` | 明述同一三元素数组 |
| `scripts/test-host.mjs` | 含 `client inject declares native services` 断言（实测 ✅ 通过） |

另核对 `index.js` 的 host 侧 `export const inject` 为**扁平服务名数组**（`['webServer', 'connection']`），与 `design.md:86` 一致——AGENTS.md 特别警告的对象形式会把 `required`/`optional` 当成服务名导致真实宿主永久 pending，此处未回归。

---

## 5. 未修复项（如实列出，**本轮未做**）

| 编号 | 问题 | 为什么本轮不修 |
|------|------|----------------|
| **P1-4** | CSP 含 `script-src 'self' 'unsafe-inline'`，内联脚本降低了 XSS 防护强度 | 内联 `<script>` 是当前 SPA 的唯一脚本载体（单文件 `web/index.html`）。移除 `unsafe-inline` 需要把内联脚本外置为独立文件并改造构建/打包链路（`package.json` 的 `files`、CSP 头、host 静态路由都要跟着动），属于结构性改造而非本轮复审修复范围，须单独排期 |
| **P1-5** | `workflows.js:421` 附近 preflight 的 `catch` 分支覆盖面不足 | 需要先确定「preflight 失败时究竟应降级还是应快速失败」的产品语义，涉及可选服务缺失（`service(name)` 探测返回 undefined）与 503 的既有约定；语义未定前改动会引入行为回归风险 |
| **P1-6** | `repos.discover` 的仓库枚举不完整（受 gh 分页/上限影响） | 完整枚举需要翻页与配额控制设计，且与 `coverage.note` 的样本口径披露耦合；当前已在文档与 UI 中如实披露「样本受限」，属**已知限制**而非静默错误 |
| **P2-2** | 抽屉焦点：`drawerFocus` 在 `closeDrawer` 后未置 `null`，可能持有已卸载 DOM 节点引用（`web/index.html:865`） | **证伪成功**：功能正确，非缺陷（抽屉 A→B→关闭 时焦点恢复行为经反例验证为期望行为）。剩下的仅是「持有已卸载节点引用」的建议级整洁性问题，`?.focus?.()` 会静默失败，无用户可见影响 |
| **P2-3** | `service()` 的 `ctx.get(name,false)` 软探测缺少注释解释 `false` 含义（`workflows.js:296-299`） | 纯可读性建议（加一行注释）。属文档性改动，与本次「修复 + 发布」的缺陷修复主线无关；改动 `workflows.js` 还会牵动未被本轮测试覆盖的 host 半代码，性价比低 |
| **P2-4** | `clone = JSON.parse(JSON.stringify(x))` 会丢弃 `undefined`（`workflows.js:20`） | **证伪成功**：该 clone 只用于纯 JSON 请求体快照，源头已是可序列化结构，JSON 语义下丢弃 `undefined` 符合预期。报告原结论即「当前保持现状，仅记录」 |
| **P2-6** | `ghAvailable` 的 `cache` Map 无硬上限（`index.js:693`） | **证伪成功**：key 为已配置仓库的 `repo.key`，数量由用户配置决定，无无界增长路径；报告标注为「低风险」。仅在未来支持组织自动发现大量仓库时才需补 LRU |
| **新增（测试期发现）** | `web/index.html:491` 的 `hbarReviewers`（函数定义于 `:488`）tooltip 仍无 `resKnown` 守卫，降级时会显示「未解决 0」 | 与 P1-1 **同根因**；影响面仅限悬停 tooltip（不在正文列表与 KPI 上），且**不在原报告清单内**。经 Lead 裁定为「已知未覆盖项」，**本轮不改代码**，遗留待后续 |

---

## 6. 本轮门禁实测结果（原始输出）

```
$ npm run lint
> dsh-codehub-dashboard@0.1.2 lint
> eslint .
（无输出，exit 0）

$ npm test
ℹ tests 116
ℹ pass 116
ℹ fail 0
91 passed, 0 failed
（exit 0）

$ node scripts/check-version.mjs v0.1.2
tag v0.1.2 matches package.json version 0.1.2
（exit 0）

$ node scripts/check-version.mjs v0.1.1
tag "v0.1.1" does not match package.json version "0.1.2" (expected v0.1.2)
（exit 1）
```

> 基线对比：0.1.1 时期的 `node --test` 为 99 用例；本轮 W2/W4 新增 17 条回归断言后为 **116**，`test-host.mjs` 保持 **91**。

---

## 7. 交付状态

- **已提交并推送**（由 Lead 统一执行，本任务作者未 commit/add/push）。
- **回填已完成**：`releases/README.md:22` 的 0.1.2 tgz 字节数与生成时间、`docs/packaging-and-offline-install.md:32` 的 packed/unpacked size 均已用真实 `npm pack` 输出填入（见下）。

### 7.1 发布事实（2026-10-17）

- **提交**：`04a4cbc` `release(v0.1.2): honest degradation for unknowable thread resolution, gh probe caching, save de-bounce`（15 文件、+1090/−32），已 push 到 `origin/main`（`0ddfecf..04a4cbc`）。
- **Tag**：`v0.1.2` 已创建并推送。
- **CI**（main push，run `39032194511`）：**成功**，三矩阵 job 全绿 —— `lint-and-test (18)` / `(20)` / `(22)`。
- **Publish 工作流**（tag `v0.1.2`，run `39032203051`）：`Verify tag matches package version` ✅ → `Test` **116 tests / 116 pass / 0 fail + 91 passed, 0 failed** ✅ → `Verify packed contents` ✅（9 文件白名单齐）→ **`npm publish` 失败**。
  - 原因是远端 runner 无 npm 凭据（`NPM_AUTH_TOKEN` 为空 → `npm error code ENEEDAUTH / need auth`），属**既知环境问题，不是本轮代码回归**；0.1.1 同路径同样如此。
  - **故看到 publish 红灯时不要误判为回归**：本仓库的发布范式是本地 `npm pack` + `releases/` 归档。
- **实际交付件**：`releases/dsh-codehub-dashboard-0.1.2.tgz`，**68,505 字节**（package size 68.5 kB / unpacked 217.0 kB / 9 文件），生成于 2026-10-17 20:19；`releases/` 被 `.gitignore` 忽略，tgz 不入库。

---

## 相关文档

- 审查来源：[code-review-2026-10-17.md](code-review-2026-10-17.md)
- 设计与契约：[design.md](design.md)
- 打包与离线安装：[packaging-and-offline-install.md](packaging-and-offline-install.md)
- 质量历程：[quality-assessment-2026-10-16.md](quality-assessment-2026-10-16.md)
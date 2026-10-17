# 项目质量评估（2026-10-16）

> 对象：`dsh-codehub-dashboard` v0.1.0（HEAD = 4582367）。
> 方式：全量复跑 lint/test + git 考古（`git log -S` 追溯契约变更）+ 三处契约交叉核对（`package.json` / `client.js` / `docs/design.md`）。
> 结论先行：**整体质量高，但 HEAD 处于测试全红状态；两处失败均为「无信息提交引入的单边契约漂移」，本轮已修复并复验全绿。**
>
> 归档说明：文中的用例数（77/77）、体积（62.8 kB）与目录路径是**当日 HEAD 的快照**，不随后续改动回填。截至当日：仓库根已扁平化为插件包根、`npm test` 为 84 用例 + 84 断言、`npm pack --dry-run` 为 9 文件 65.4 kB，见 [design.md](design.md) §2.1/§10 与 [packaging-and-offline-install.md](packaging-and-offline-install.md) §1。（2026-10-17 后续：测试已增至 99 用例 + 91 断言、版本 0.1.1；最新状态见文末「五、2026-10-17 后续更新」。）

## 一、评估矩阵

| 维度 | 结果 | 说明 |
|------|------|------|
| Lint（eslint flat config） | ✅ 0 error | `npm run lint` |
| 单元测试（node --test） | ✅ 77/77 | data 13 + api 3 + workflows 23 + client 38 |
| Host 集成断言（test-host.mjs） | ✅ 77 断言全过 | 含契约一致性、安全围栏、SPA 语法 |
| CI | ✅ 三矩阵 | ubuntu-latest × node 18/20/22，push/PR 触发 |
| 依赖卫生 | ✅ 零运行时依赖 | host 半与 SPA 均无第三方库；devDeps 仅 eslint |
| 安全设计 | ✅ 有测试背书 | fail-closed 连接准入、origin 校验、CSP、token 掩码、路径白名单 |
| 文档 | ✅ 1461 行 / 6 份 | design.md 与实现对齐；契约、API、打包指南齐全 |
| 版本一致性 | ✅ 三重断言 | `PLUGIN_VERSION` = package.json = 运行时 banner |
| 打包卫生 | ✅ files 白名单 9 项 | `npm pack --dry-run` 62.8 kB，无越界文件 |
| 提交信息质量 | ⚠️ 有反例 | 6b5edb4 为无信息 "update"，且正是它引入回归（见下） |
| 可重复构建 | ⚠️ 弱 | `package-lock.json` 被 gitignore，CI 走 `npm install` 非 `npm ci` |
| 工作区卫生 | ⚠️ 有堆积 | `.acl-recovery/`（ACL 工具备份）与根目录 `.tgz` 未清理 |

## 二、本轮发现：HEAD 测试全红（2 项失败）

### 失败 1：`client inject declares native services` —— 无依据的单边契约漂移（P0 级回归）

| 项 | 内容 |
|----|------|
| 现象 | `test-host.mjs` 断言 `pkg.dsh.client.inject` 为 `["slots","layout","uiWorkspace"]`，实际为 `@deepseek-ai/dsh-client-ui-*` 全名三件套 |
| 引入提交 | `6b5edb4` "update"（07:12），提交信息无任何动机说明 |
| 根因 | 该提交单方面修改 `package.json` 的 `dsh.client.inject`，但**运行时实现未动**：`client.js` 传给 `window.__ModuleLoader__.load()` 的仍是短名 `["slots","layout","uiWorkspace"]`；`docs/design.md:94` 权威描述也是短名。三处契约两真一假，假的那处会让宿主 loader 按全名去解析不存在的服务 |
| 考古证据 | `7f509f6`（接入 DSH 原生服务的落地提交）把 inject 从 `betterSidebar` 改为短名三件套时，`client.js` 与 `design.md` 同步同源；`6b5edb4` 只改 package.json 一处 |
| 影响依赖 | 宿主侧 loader 契约 + `client.js` 运行时 + `design.md` 文档 + `test-host.mjs` 断言，四方中三方指向短名 |
| 修复 | `package.json` 的 inject 回退为短名三件套，恢复 `7f509f6` 的同源形态 |

### 失败 2：`exports name` —— 修复提交没跑测试（P1 级失同步）

| 项 | 内容 |
|----|------|
| 现象 | `test-host.mjs:53` 断言 `mod.name === 'codehub-dashboard'`，实际导出已是 `dsh-codehub-dashboard` |
| 引入提交 | `4582367` "fix: align plugin name export with cordis.patch.yml"（07:26），该修改本身正确——`cordis.patch.yml` 的 `name` 与 `package.json` 的 `name` 均为 `dsh-codehub-dashboard`，导出名对齐有据 |
| 根因 | 改代码后未执行 `npm test`，测试断言停留在旧值。**不是代码错，是验证缺失** |
| 修复 | 断言更新为 `dsh-codehub-dashboard` |

### 复验结果

| 命令 | 结果 |
|------|------|
| `npm run lint` | 0 error |
| `npm test` | 77 passed, 0 failed；test-host.mjs 断言 0 ❌ |
| `npm pack --dry-run` | 9 文件，62.8 kB（未重新打包，files 白名单未动） |

## 三、遗留风险与建议

| # | 风险 | 级别 | 建议 |
|---|------|------|------|
| 1 | 提交前未跑测试的流程缺口：`6b5edb4` 与 `4582367` 连续两个提交都带着红测试进库，与「提交前 lint/build/test 三连」的既定习惯相悖 | 中 | 提交前固定执行 `npm test`；CI 已有矩阵兜底，但红灯进 main 会阻断后续打包 |
| 2 | `package-lock.json` 被 `.gitignore` 忽略，CI 用 `npm install` | 低 | 零运行时依赖场景影响有限；如要更强可重复性，放开 lock 文件并改 `npm ci` |
| 3 | `.acl-recovery/`（ACL 工具备份，约 58 KB）与根目录 `dsh-codehub-dashboard-0.1.0.tgz` 堆积未清 | 低 | 本轮已在 `.gitignore` 补 `.acl-recovery/`；tgz 已被既有 `*.tgz` 规则忽略，确认交付后物理删除即可 |
| 4 | 原生宿主实机验证缺口：llm 模型目录、会话打开、工作区发现三项能力在独立 dev 页面只能证明降级路径 | 中 | 已在 code-review 文档记录；发布前需在真实 DSH 宿主内跑一遍 |

## 四、复盘要点

**「无信息提交」是回归的放大器。** 本次两个失败的引入提交 `6b5edb4`，message 只有一个 "update"——如果它有写「inject 全名化 + 打包文档重写」，审查者第一件事就是问「client.js 为什么没同步」。提交信息不是形式，是后来人的现场证据。

**契约类字段的修改必须做交叉核对。** `dsh.client.inject` 同时存在于 package.json（清单）、client.js（运行时）、design.md（文档）、test-host.mjs（断言）四处，改一处不跑测试 = 三处静默不一致。这类「一份事实、四处引用」的字段，测试断言已经在守门，缺的只是提交前那一次 `npm test`。

## 五、2026-10-17 后续更新

> 本节是后续进展，不修改上文 2026-10-16 的当日结论与数字。

- 测试：`node --test` 四件套 **99 用例 / 99 pass / 0 fail**；`test-host.mjs` **91 断言 / 91 passed / 0 failed**；合计 **190** 项检查；`npm run lint` exit 0。
- 版本：**0.1.1**（`package.json`、`index.js` 的 `PLUGIN_VERSION`、`package-lock.json` 同步）。
- 工程化：CI 改用 `npm ci`；publish workflow 增加 tag 与 `package.json` 版本一致性、`npm pack` 9 文件白名单门禁；`package-lock.json` 已从 `.gitignore` 移除，提交时需随改动入库，否则 `npm ci` 在 CI 会因无 lock 失败。
- 文档：`design.md`、`api-reference.md`、`README.md`、`packaging-and-offline-install.md` 已按 0.1.1 与 99/91 同步；0.1.1 tarball 字节数待生成后补（packaging §1.1 已标 TODO）。
- 未闭合：真实宿主启动日志验收仍只能人工执行（`test-host.mjs` 的 fake ctx 直接 `apply()`，证明不了 cordis 服务解析），与 AGENTS.md「绿灯之外」一致。

### 5.1 2026-10-17 晚：0.1.2 复审修复（同日后段）

> 承 [code-review-2026-10-17.md](code-review-2026-10-17.md) 的 P1/P2 清单，本轮修复 P1-1、P1-2、P1-3、P2-1、P2-5；逐条证据见 [fix-release-2026-10-17.md](fix-release-2026-10-17.md)。

- 测试：`node --test` 四件套 **116 用例 / 116 pass / 0 fail**；`test-host.mjs` **91 断言 / 91 passed / 0 failed**；`npm run lint` exit 0。上文 §5 的 99/91 为 10-17 早间数字，保留不改。
- 版本：**0.1.2**（`package.json`、`index.js` 的 `PLUGIN_VERSION`、`package-lock.json`、`scripts/test-host.mjs:86` 断言四处同步）。
- 文档：`design.md`、`api-reference.md`、`packaging-and-offline-install.md`、`releases/README.md` 已按 0.1.2 同步。
- 未修复：P1-4（CSP `unsafe-inline`）、P1-5（`workflows.js` preflight catch）、P1-6（`repos.discover` 枚举）、P2-2/3/4/6，以及 `web/index.html:491` 的 `hbarReviewers` tooltip 守卫缺失——均为已知未覆盖项，理由见 fix-release 文档「未修复项」一节。

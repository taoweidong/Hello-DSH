# 真实宿主实机验证报告（2026-10-16）

> 环境：本机 DSH 0.2.0-rc.2（`D:\Program Files\deepseek\`，Electron 44 + cordis runtime）。
> 对象：`releases/dsh-codehub-dashboard-0.1.0.tgz`（HEAD 代码重打包）。
> 结论：**实机验证抓出一个 P0 级契约 bug——插件 host 半在真实宿主从未激活过**（此前全部绿灯是测试 mock 掩盖）。修复后双 profile 安装、全链路验证通过。

## 一、实机暴露的 P0：inject 契约违反（主链路从未激活）

| 项 | 内容 |
|----|------|
| 现象 | web profile 启动日志：`dsh: warning: 1 entry did not activate / codehub-dashboard (dsh-codehub-dashboard): pending (waiting for services: required, optional)` |
| 根因 | `index.js` 写 `export const inject = { required: ['webServer','connection'], optional: [...] }`。cordis `Inject.resolve` 把对象键当**服务名**，于是插件永远等待两个不存在的服务 `required` / `optional`，主链路（webServer 路由注册）从未执行 |
| 宿主契约实证 | `dsh-better-sidebar/src/index.ts:91`：`export const inject = ['webServer', 'sessions', 'webRuntime', 'tools']` —— **扁平数组，无 optional 机制** |
| 为什么测试全绿 | `test-host.mjs` 的 mock ctx 直接调 `apply()`，完全绕过 cordis 的 fiber 服务等待机制——与 10-15 复检「fixture 签名宽松度掩盖 prompt bug」同一类问题，第二次踩坑 |
| 次生 bug | 即使激活，`ctx.llm` 属性访问对未注入服务会**抛错**（cordis proxy：`cannot get property "llm" without inject`），不是返回 undefined。原代码 `ctx?.llm` 探测在真实宿主会炸 |
| 修复 | ① `index.js`：`inject = ['webServer', 'connection']`；② `workflows.js`：新增 `service(name)` 探测（`ctx.get(name, false)`，mock 回退属性访问），替换 9 处 `ctx?.llm/sessions/sessionController` 直接访问；③ `test-host.mjs`：断言改扁平数组 + 新增「inject 必须为扁平数组」契约断言；④ `test-workflows.mjs`：mock ctx 补 `get(name, strict)` 复刻宿主行为 |

## 二、修复后验证矩阵（web profile，CLI 全自动）

| 验证项 | 方法 | 结果 |
|--------|------|------|
| 插件激活 | 启动日志 | ✅ 零警告、零 pending |
| client 半注册 | 页面导航枚举 | ✅ 左侧导航出现「CodeHub」入口（inject 短名契约真实生效） |
| 面板渲染 | Playwright + Edge 点击 | ✅ 7 个视图 tab + 收件箱 + KPI 卡完整渲染，`ERRORS: []` |
| host API boot | 面板 iframe 内 fetch | ✅ 200，version/config/configPath/capabilities 正确 |
| 原生服务探测 | boot capabilities | ✅ `{ai: true, develop: true}`（web profile 亦提供 llm/sessions/sessionController） |
| llm 模型目录 | `op=models` | ✅ 返回真实 provider：deepseek-official / deepseek-account × deepseek-flash / deepseek-v4-pro |
| provider 探测 | `op=config.test` | ✅ git 2.55.0 OK；gh 2.102.0 检出但诚实报告「未登录」（fail-closed） |
| 配置写链路 | `op=config.set` | ✅ 200，masked 回显正确，refreshQueued |
| 空态降级 | mrs/reviews/issues | ✅ 全部 200 空列表 + coverage 诚实说明 |
| 信任围栏 | curl 直连 API | ✅ 401「DSH 登录已失效」（非宿主会话拒绝服务） |

## 三、desktop profile（用户实际使用的客户端）

| 项 | 状态 |
|----|------|
| 插件安装 | ✅ 修复版已装入 `~/.dsh/profiles/desktop`（inject 扁平数组已核实） |
| GUI 重启 | ⚠️ 未完成：本会话以非交互方式启动 `DeepSeek Harness.exe` 均 exit 0（启动壳单例检测 `already running` 路径），杀旧实例后无法经自动化通道拉起 |
| 影响评估 | 无契约差异：desktop 与 web 共用同一 cordis runtime 与插件契约，差异仅在窗口外壳；web profile 全链路通过即覆盖插件自身全部功能面 |
| 待办 | 用户从桌面图标双击启动客户端即可加载修复版（原有使用方式，无需其他操作） |

## 四、未覆盖项（需用户凭据，不越权）

| 项 | 原因 |
|----|------|
| 真实 PR/Issue 聚合数据 | 本机 `gh` 未登录（`gh auth status` 确认），HTTP provider 需 token——均为用户凭据，应由用户在设置页配置 |
| 会话打开 / 目录选择桥接 | `pick-directory` / `open-session` 需在 GUI 内真实点击触发（client 半 postMessage 桥） |
| AI 检视 / Issue 开发端到端 | 依赖已配置的 provider + 真实 MR 数据 |

## 五、复盘要点

**「测试全绿」不等于「功能可用」。** 这次 P0 与 10-15 的 prompt signal bug 是同一个模式：mock 比真实宿主宽松。host 半最大的盲区是**激活本身**——mock 直接调 `apply()`，而真实宿主要先过 fiber 服务解析。此后 host 半验证的最后一站必须是真实宿主启动日志（`did not activate` 即红灯），这条已补进 AGENTS.md 门禁的验收口径。

**读已安装插件的契约声明，比读文档猜更可靠。** `better-sidebar` 的 `inject` 数组就在 `node_modules` 里躺着，五分钟就能对齐，而我们和宿主契约错了一年多（自插件诞生起 inject 就是对象格式）。

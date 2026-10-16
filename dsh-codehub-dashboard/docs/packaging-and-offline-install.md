# 打包与离线安装操作手册

> dsh-codehub-dashboard v0.1.0 | 文档更新：2026-10-16
>
> 本手册的命令与输出**均在本机（Windows + DSH 0.2.0-rc.2）实测**，实测产生的临时 profile 已删除。标注「未实测」的条目除外。

## 0. 结论速查

| 场景 | 用什么 |
|------|--------|
| 有网 / 内网可访问 npm | `dsh plugin --profile <name> add dsh-codehub-dashboard` |
| **完全离线，交付一个压缩包** | `npm pack` 产 tgz → 拷到目标机 → `dsh plugin --profile <name> add ./x.tgz --offline` |
| 离线且目标机跑不了 `dsh` CLI | 手动摆放（见 §3.3，已实测可解析） |
| 开发者本机改代码调试 | `add link:<插件绝对路径>` |
| 桌面应用（Desktop）的 profile | 先用界面装；命令行装 `--profile desktop` 需**先完全退出 Desktop** |

安装成功的判据只有一条：`dsh --profile <name> --dump-config` 能打印出 `# == dsh-codehub-dashboard` 层。

---

## 1. 打包

### 1.1 用 npm pack（推荐）

```bash
cd dsh-codehub-dashboard
npm pack          # 产出 ./dsh-codehub-dashboard-0.1.0.tgz
mv dsh-codehub-dashboard-*.tgz ../releases/   # 归档到仓库根 releases/，保持根目录整洁
```

本机实测：`62,773` 字节，`npm pack --dry-run` 报 **9 个文件、package size 62.8 kB、unpacked size 198.3 kB**。归档根为 `package/`（npm 规范前缀）。

> 打包产物统一归档到仓库根 [releases/](../../releases/) 目录（目录内有版本清单），不留在插件目录或仓库根。`releases/*.tgz` 已被 `.gitignore` 排除，交付时按需单独拷贝。

内容清单由 `package.json` 的 `files` 字段决定：

| 文件 | 大小 | 说明 |
|------|------|------|
| `index.js` | 70.2 KB | Host half（gh / HTTP / git provider + 缓存聚合 + 路由与鉴权栅栏） |
| `workflows.js` | 26.3 KB | 原生模型检视、COMMENT 发布、Issue 开发会话、审计持久化 |
| `web/index.html` | 84.7 KB | Dashboard SPA（vanilla JS + 内联 CSS/SVG，7 个视图） |
| `client.js` | 5.0 KB | Client half（原生 `slots` 左导航注册 + 受限宿主桥接） |
| `package.json` | 1.6 KB | 插件清单（含 `dsh.bundle.patch` 声明） |
| `cordis.patch.yml` | 509 B | DSH bundle patch |
| `icon.svg` | 638 B | 插件图标 |
| `README.md` | 8.4 KB | 使用文档 |
| `LICENSE` | 1.1 KB | MIT 许可证 |

> `docs/` 与 `scripts/` **不进产物**（未在 `files` 中声明）；需要交付文档请单独打包。
> 运行时依赖为零，`eslint` 只在 `devDependencies`，不进入产物 —— 这是离线安装能成功的关键。

### 1.2 用 tar 直接打包目录（也可以）

`dsh plugin` 的安装参数最终交给 pnpm，pnpm 接受任意 tarball。本机实测两种非 npm 布局**都能装上**：

```bash
# 布局 A：单一顶层目录（实测通过）
tar -czf codehub.tar.gz dsh-codehub-dashboard/

# 布局 B：文件平铺在归档根（实测通过）
tar -czf codehub-flat.tar.gz -C dsh-codehub-dashboard .
```

判据只有一条：解压后能找到 `package.json`。包名与版本取自其中，与归档名无关（把 tar 命名为 `x.tar.gz` 不会改变安装结果）。

仍推荐 `npm pack`：`files` 字段自动控制内容、排除 `node_modules`/`docs`，且与上游发布产物一致。

### 1.3 交付前校验

```bash
npm pack --dry-run                     # 预览文件与体积
tar -tzf dsh-codehub-dashboard-0.1.0.tgz | head    # 确认归档布局
node -e "console.log(require('./package.json').dsh.bundle)"  # 确认 bundle 声明存在
```

`dsh.bundle.patch` 必须存在。若缺失，安装会成功但 DSH 打印 `declares no dsh.bundle ... installed as a plain dependency, not a profile layer`，左侧导航不会出现入口。

### 1.4 发布到 npm（可选，在线场景）

```bash
npm publish --access public
```

发布后即可 `dsh plugin --profile <name> add dsh-codehub-dashboard`，无需拷包。

---

## 2. 前置条件

| 依赖 | 要求 | 检查命令 |
|------|------|---------|
| DSH | ≥ 0.2.0-rc.2 且 < 0.3.0（`engines.dsh`） | `dsh -V`（本机输出 `0.2.0-rc.2`） |
| `dsh` CLI | 安装自带，路径 `<安装目录>\resources\runtime\cli\bin\dsh.cmd` | 见下方 Windows 说明 |
| pnpm | **无需自装**：由 DSH 安装自带（本机观察到 v11.7.0） | 失败时 `dsh` 报 `pnpm was not found` |
| Node.js | ≥ 18（宿主自带，本机 runtime 报 node 24.18.1） | `node --version` |
| gh CLI | ≥ 2.0（数据源，非安装必需） | `gh --version` |

> **不需要 dsh-better-sidebar**。早期草案依赖它注册标签页，现版本直接注入 DSH 原生 slots（左侧导航 `sidebar.panellist` + 主区 `main`）。
> AI 检视与 Issue 开发是可选能力：宿主缺少 `llm`/`sessions`/`sessionController` 时对应按钮禁用，看板本身不受影响。

### Windows / Git Bash 调用注意

- `dsh` 是 `.cmd` 批处理，Git Bash 的 `which dsh` 找不到它；要么用 `cmd`/`PowerShell`，要么写全名：

  ```bash
  "/d/Program Files/deepseek/resources/runtime/cli/bin/dsh.cmd" plugin --profile web add ./x.tgz
  ```

- 它做的事是把 Electron 当 Node 用，执行 app.asar 内的 `@deepseek-ai/dsh-desktop-host/lib/cli.js`，因此必须用**安装目录下那一个** `dsh.cmd`，不要自己拼 node 调用。

### `dsh plugin` 的真实语义（读宿主代码确认）

```
dsh plugin --profile <name> <pnpm-args...>
```

- 参数**逐字转发给 pnpm**，在 profile 目录内执行；`add` / `install` / `i` 之后 DSH 额外做一次 reconcile。
- DSH 自己只接管三个子命令：`allow-version`、`revoke-version`、`version-exemptions`（版本兼容豁免），其余都归 pnpm。
- 相对路径按**调用目录**解析，不是 profile 目录 —— 所以要在存放 tgz 的目录里执行，或直接给绝对路径。
- profile 不存在时，`plugin add` 会先初始化它并打印 `dsh: initialized profile <name> at <path>`。注意 `--dump-config` **不会**自动初始化，对不存在的 profile 会报 `profile "x" does not exist`。

---

## 3. 离线安装

### 3.1 拷贝

把 tgz 放到目标机一个**长期存在**的路径（例如 `D:/dsh-plugins/`）。

> ⚠️ 安装后 profile 记录的是 `file:<绝对路径>`。实测：依赖项写成
> `"dsh-codehub-dashboard": "file:E:/tmp/dsh-offline-demo/dsh-codehub-dashboard-0.1.0.tgz"`。
> 之后任何一次 `dsh plugin --profile <name> install`（或换机重建）都要求这个文件还在原处。
> 交付时连同 tgz 一起归档，别装完就删。

### 3.2 CLI 安装（推荐，已实测）

```bash
cd D:/dsh-plugins
dsh plugin --profile web add ./dsh-codehub-dashboard-0.1.0.tgz --offline
```

`--offline` 强制只用本地归档/store，便于确认「真离线」。实测输出：

```
dsh: initialized profile codehub-offline-test at C:\Users\<you>\.dsh\profiles\codehub-offline-test
dependencies:
+ dsh-codehub-dashboard file:E:/.../dsh-codehub-dashboard-0.1.0.tgz
Packages: +1
Done in 1.8s using pnpm v11.7.0
```

DSH 随后自动完成两件事（实测确认）：

1. `dependencies` 写入上面那条 `file:` 绝对路径；
2. `dsh.profile.bundles` **追加**包名，得到 `["@deepseek-ai/dsh-base","dsh-codehub-dashboard"]`。

写入用原子替换，产物**无 BOM**（实测首字节 `7b`，即 `{`）。

对 Desktop 的 profile：

```bash
dsh plugin --profile desktop add ./dsh-codehub-dashboard-0.1.0.tgz --offline
```

前提是先**完全退出** DSH Desktop（托盘也退出）。否则按宿主代码给出的提示失败：
`Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it before running dsh plugin --profile desktop.`
`desktop` profile 由应用独占管理，只有安装自带的这个 `dsh.cmd` 有权限操作它，其它入口会报 `profile "desktop" is managed exclusively by the Electron application`。

### 3.3 手动安装（目标机跑不了 CLI）

不需要 pnpm、不写 lockfile，只要文件摆对位置即可。本机实测：仅创建 `node_modules` + `package.json` + `cordis.patch.yml` 三样，`--dump-config` 就能组合出该插件层。

```bash
P=~/.dsh/profiles/<profile>            # Windows: %USERPROFILE%\.dsh\profiles\<profile>
mkdir -p "$P/node_modules"
tar -xzf dsh-codehub-dashboard-0.1.0.tgz -C "$P/node_modules"
mv "$P/node_modules/package" "$P/node_modules/dsh-codehub-dashboard"   # 布局 A/B 解压后按实际目录名调整

# $P/package.json —— 只需 bundles，无需 dependencies
{
  "name": "dsh-profile-<profile>",
  "private": true,
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "dsh-codehub-dashboard"] } }
}

printf -- '[]\n' > "$P/cordis.patch.yml"
```

> ⚠️ **BOM 警告**（历史踩坑）：`package.json` 必须是 **UTF-8 无 BOM**。Windows 记事本 / PowerShell `Set-Content` 默认可能写 BOM，DSH 用 `JSON.parse` 读 profile manifest，BOM 会让整条插件加载链失败并报 `SyntaxError: Unexpected token ''`。
>
> ```bash
> # 首字节应为 7b（'{'），若是 ef bb bf 就是带 BOM
> xxd ~/.dsh/profiles/<profile>/package.json | head -1
> ```
>
> ```powershell
> $b = [IO.File]::ReadAllBytes("$env:USERPROFILE\.dsh\profiles\<profile>\package.json")
> "Has BOM: $($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)"   # 期望 False
> ```

手动路径的缺点：绕过了 pnpm 与 lockfile，升级要自己覆盖 `node_modules` 下的目录。

### 3.4 开发者本机（link）

```bash
dsh plugin --profile desktop add link:E:/GitHub/Hello-DSH/dsh-codehub-dashboard
```

装完后 `dependencies` 记录 `link:<绝对路径>`，`bundles` 同样自动追加。改 host half 要重启 DSH，改 client half / SPA 通常热加载即可。

---

## 4. 安装后验证

```bash
# 1) profile 是否组合出插件层（不启动应用，最可靠）
dsh --profile <name> --dump-config | grep -A2 "dsh-codehub-dashboard"

# 2) 归档/目录是否齐
ls ~/.dsh/profiles/<name>/node_modules/dsh-codehub-dashboard

# 3) 界面链路
# 启动 DSH → 左侧导航 CodeHub → 设置页保存 → 刷新
```

第 1 步实测输出：

```
# == dsh-codehub-dashboard
- id: codehub-dashboard
  name: dsh-codehub-dashboard
```

浏览器侧还要**硬刷新**（Ctrl+Shift+R）清掉旧的 SPA 缓存。

---

## 5. 卸载

```bash
dsh plugin --profile <name> remove dsh-codehub-dashboard
```

实测：`dependencies` 中的条目被删，`dsh.profile.bundles` 同步**收回**为 `["@deepseek-ai/dsh-base"]` —— reconcile 会自动清理，不用手改 bundles。

卸载**不删除数据文件**：

- `~/.dsh/codehub-dashboard/config.json`（含明文 token）
- `~/.dsh/codehub-dashboard/config.json.workflows.json`（含代码、Issue 正文与模型输入输出）

需要按需自行安全删除或归档，不要提交或同步。

---

## 6. 升级

```bash
# 打包侧
npm version patch        # 0.1.0 → 0.1.1
npm pack

# 目标机：把新 tgz 放到同一目录，覆盖安装
cd D:/dsh-plugins
dsh plugin --profile <name> add ./dsh-codehub-dashboard-0.1.1.tgz --offline
```

重启 DSH + 硬刷新浏览器生效。建议保留**当前在用**的 tgz 直到新版本验证通过（§3.1 的绝对路径依赖）。

若宿主版本与插件 `engines.dsh` 区间不符，`dsh` 会给出精确命令（原样照抄即可，但请确认你接受风险）：

```
dsh: to accept the risk, run: dsh plugin --profile <name> allow-version <pkg>@<version> --dsh-version <exact> --accept-risk
```

回滚用 `revoke-version <pkg>@<version> --dsh-version <exact>`，或直接重新 `add` 旧 tgz。

---

## 7. 故障排查

| 现象 | 原因 | 处理 |
|------|------|------|
| `which: no dsh in ...` | Git Bash 不解析 `.cmd` | 用全名 `dsh.cmd`，或改在 cmd/PowerShell 执行 |
| `error: profile "desktop" is managed exclusively by the Electron application` | 用了非安装自带的 dsh 入口 | 用 `<安装目录>\resources\runtime\cli\bin\dsh.cmd` |
| `Open DeepSeek Harness Desktop once ... then fully quit it` | Desktop 仍在运行，profile 被占用 | 完全退出 Desktop（含托盘）后重试 |
| `dsh: pnpm was not found; install pnpm and make it available on PATH.` | 安装自带的 pnpm 缺失 | 重装 DSH，或临时自装 pnpm |
| `dsh: plugin command failed; diagnostics: <path>` | pnpm/安装失败 | 打开该日志（同 `<profile>/.plugin-manager/logs`）看尾部原因 |
| `profile "x" does not exist`（`--dump-config`） | 该 profile 还没初始化 | 先 `dsh plugin --profile x add <package>` |
| `cannot resolve profile bundle "dsh-codehub-dashboard" ...` | bundles 有名字但 node_modules 里没有 | `dsh plugin --profile x install`，或按 §3.3 补齐目录 |
| `declares no dsh.bundle ... not a profile layer` | 包缺 `dsh.bundle` 声明 | 检查 `package.json`，重新打包 |
| 左侧导航无 CodeHub 入口 | bundles 未含本插件 / 宿主版本过低 | `--dump-config` 验证；确认 DSH ≥ 0.2.0-rc.2 |
| `SyntaxError: Unexpected token ''` / 所有插件消失 | `package.json` 带 BOM | 用 Node.js 或 VS Code 重写为 UTF-8 无 BOM |
| 换机后 `install` 报找不到归档 | 依赖记的是 tgz 绝对路径 | 把 tgz 放回原路径，或重新 `add` 新路径 |
| 仓库全部报错 | gh 未登录 | `gh auth login`，或为实例配置 token 走 HTTP |
| 所有请求 503 | `connection` 服务不可用 | 查 DSH 启动日志，重新登录宿主 |
| 401 / 登录已失效 | `ctx.connection.admit` 拒绝 | 从 DSH 内重新打开页面 |
| AI 检视按钮禁用 | `capabilities.ai=false` 或未配置 provider/model | 设置页选宿主模型，确认宿主提供 `llm`/`sessions` |
| 开始开发失败 | 未绑定本地克隆或 origin 与仓库不一致 | 设置页绑定对应本地目录（会校验 origin） |
| 发布提示需核实 | `publish_unknown`（远端结果不确定） | 先到 GitHub 确认评论，不要直接重发 |
| `/codehub/api` 返回 404 | Host half 未加载 | 检查启动日志，确认插件在 bundles 中 |

### gh CLI 认证

```bash
gh auth login                                   # 浏览器 OAuth
echo "ghp_xxx" | gh auth login --with-token     # PAT
gh auth status                                  # 验证
```

---

## 8. 一次离线交付的最小动作

```bash
# 打包机
cd dsh-codehub-dashboard && npm pack                      # → *.tgz
tar -tzf dsh-codehub-dashboard-0.1.0.tgz | head           # 抽查布局

# 目标机（离线）
cd D:/dsh-plugins
dsh plugin --profile web add ./dsh-codehub-dashboard-0.1.0.tgz --offline
dsh --profile web --dump-config | grep -A2 dsh-codehub-dashboard   # 必须看到插件层
# 完全退出并重启 DSH，硬刷新浏览器 → 设置页保存 → 刷新
```

---

## 9. 已知坑与未验证项

- **`dsh` CLI 会在调用目录物化 runtime 投影**：本机在 git 仓库根目录发现过 `package.json`（`@deepseek-ai/dsh-desktop-runtime`）与 2.8 MB 的 `desktop-runtime.json`，内容与本仓库无关；已移到 `E:/tmp/dsh-cli-runtime-artifacts/` 保留。**触发条件未定位**（`-V`、`--dump-config` 在干净空目录实测都不生成）。稳妥做法：在仓库外的空目录执行 `dsh`，并在 `git add` 前看一次 `git status`。
- 归档名不影响安装（包名取自内层 `package.json`），但**安装后 profile 里记的是绝对路径**，换机/换目录需重新 `add`。
- `--offline` 在 `dsh plugin` 上实测有效；DSH Desktop **界面内**的插件管理流程本文未覆盖（未实测），界面装完同样可用 `--dump-config` 验证。
- 在线 registry 安装（`add dsh-codehub-dashboard`）**未实测**：本插件包尚未发布到 npm。命令面与 registry spec 的预检逻辑已从宿主代码确认。
- `allow-version` / `revoke-version` 的完整行为未实测，仅确认命令面与提示文案存在（读宿主代码）。
- profile 的 `pnpm-workspace.yaml`、`pnpm-lock.yaml` 由 DSH/pnpm 生成，手动安装路径（§3.3）不需要它们。

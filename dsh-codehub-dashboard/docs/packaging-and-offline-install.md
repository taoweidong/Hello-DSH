# 打包与离线安装指南

> dsh-codehub-dashboard v0.1.0 | 文档更新：2026-10-15

## 1. 打包

### 1.1 使用 npm pack（推荐）

```bash
cd dsh-codehub-dashboard
npm pack
```

产出文件：`dsh-codehub-dashboard-0.1.0.tgz`（约 62 KB，解包后约 197 KB，共 9 个文件）

包含的文件由 `package.json` 的 `files` 字段控制：

| 文件 | 大小 | 说明 |
|------|------|------|
| `index.js` | 70.2 KB | Host half（gh / HTTP / git provider + 缓存聚合 + 路由与鉴权栅栏） |
| `workflows.js` | 26.3 KB | 原生模型检视、COMMENT 发布、Issue 开发会话、审计持久化 |
| `web/index.html` | 84.7 KB | Dashboard SPA（vanilla JS + 内联 CSS/SVG，7 个视图） |
| `client.js` | 5.0 KB | Client half（原生 `slots` 左导航注册 + 受限宿主桥接） |
| `package.json` | 1.6 KB | 插件清单 |
| `cordis.patch.yml` | 509 B | DSH bundle patch |
| `icon.svg` | 638 B | 插件图标 |
| `README.md` | 6.9 KB | 使用文档 |
| `LICENSE` | 1.1 KB | MIT 许可证 |

> ⚠️ `docs/` 和 `scripts/` 目录**不包含**在打包产物中（未在 `files` 字段中声明）。如需分发文档，请单独提供或添加到 `files` 数组。
> 运行时依赖为零；`eslint` 仅出现在 `devDependencies`，不进入产物。

### 1.2 验证打包内容

```bash
# 预览包含的文件（不实际打包）
npm pack --dry-run

# 检查 tgz 内容
tar -tzf dsh-codehub-dashboard-0.1.0.tgz
```

### 1.3 发布到 npm（可选）

```bash
npm publish --access public
```

发布后用户可通过 `dsh plugin add dsh-codehub-dashboard` 在线安装。

---

## 2. 离线安装方式

### 方式一：tgz 文件安装（推荐）

将 `dsh-codehub-dashboard-0.1.0.tgz` 拷贝到目标机器后：

```bash
dsh plugin --profile desktop add ./dsh-codehub-dashboard-0.1.0.tgz
```

DSH CLI 会自动：
1. 解压 tgz 到 profile 的 node_modules
2. 更新 `package.json` 的 dependencies 和 bundles
3. 运行 pnpm install 解析依赖

安装完成后**重启 DSH 桌面应用** + **硬刷新浏览器**（Ctrl+Shift+R）。

### 方式二：目录直接安装

将整个 `dsh-codehub-dashboard/` 目录拷贝到目标机器后：

```bash
dsh plugin --profile desktop add /path/to/dsh-codehub-dashboard
```

### 方式三：手动安装（无 CLI 环境）

当目标机器没有 `dsh` CLI 时，可手动安装：

```bash
# 1. 复制插件到 profile 的 node_modules
cp -r dsh-codehub-dashboard/ ~/.dsh/profiles/desktop/node_modules/dsh-codehub-dashboard

# 2. 编辑 ~/.dsh/profiles/desktop/package.json
#    在 dependencies 中添加：
#      "dsh-codehub-dashboard": "link:<插件绝对路径>"
#    在 dsh.profile.bundles 数组末尾添加：
#      "dsh-codehub-dashboard"

# 3. 确保 package.json 是 UTF-8 无 BOM 编码！
#    ⚠️ Windows 记事本/PowerShell Set-Content 默认写入带 BOM 的 UTF-8，
#    会导致 DSH JSON 解析失败。请使用 VS Code / Node.js 等工具保存。

# 4. 重启 DSH + 硬刷新浏览器
```

> ⚠️ **BOM 警告**：这是已知的坑。DSH 的 `readProfileManifest` 使用 `JSON.parse()` 解析 package.json，UTF-8 BOM（`EF BB BF`）会导致 `SyntaxError: Unexpected token ''`，使整个 profile 的插件加载链断裂。务必确保 package.json 是 **UTF-8 无 BOM** 编码。

验证无 BOM：
```bash
# Linux/macOS
xxd ~/.dsh/profiles/desktop/package.json | head -1
# 正确：首字节为 7b（即 '{'）
# 错误：首字节为 ef bb bf（BOM）

# Windows PowerShell
$bytes = [System.IO.File]::ReadAllBytes("$env:USERPROFILE\.dsh\profiles\desktop\package.json")
Write-Host "Has BOM: $($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)"
# 应输出 False
```

---

## 3. 前置条件检查

安装前确保目标机器满足：

| 依赖 | 最低版本 | 检查命令 | 说明 |
|------|---------|---------|------|
| DSH | ≥ 0.2.0-rc.2（< 0.3.0） | `dsh --version` | 需要原生 `slots` / `layout` / `uiWorkspace` / `connection` 服务 |
| gh CLI | ≥ 2.0 | `gh --version` | 主数据源，需 `gh auth login`；也可只用实例 token |
| Node.js | ≥ 18 | `node --version` | DSH 运行时要求 |

> **不需要 dsh-better-sidebar**。早期草案依赖它注册标签页，现版本直接注入 DSH 原生 slots（左侧导航 `sidebar.panellist` + 主区 `main`）。
> AI 检视与 Issue 开发为可选能力：宿主缺少 `llm`/`sessions`/`sessionController` 时对应按钮禁用，看板本身不受影响。

### gh CLI 认证

```bash
# 交互式登录（浏览器 OAuth）
gh auth login

# 或使用 Personal Access Token
echo "ghp_xxxxxxxxxxxx" | gh auth login --with-token

# 验证
gh auth status
```

---

## 4. 卸载

```bash
dsh plugin --profile desktop remove dsh-codehub-dashboard
```

或手动：从 `~/.dsh/profiles/desktop/package.json` 中移除 dependency 和 bundle entry，删除 node_modules 中的插件目录，重启 DSH。

卸载**不会删除数据文件**：`~/.dsh/codehub-dashboard/config.json`（含明文 token）与 `config.json.workflows.json`（含代码、Issue 正文与模型输入输出）需按需自行安全删除或归档。

---

## 5. 升级

```bash
# 重新打包新版本
cd dsh-codehub-dashboard
npm version patch   # 0.1.0 → 0.1.1
npm pack

# 覆盖安装
dsh plugin --profile desktop add ./dsh-codehub-dashboard-0.1.1.tgz
```

重启 DSH + 硬刷新浏览器即可生效。Client half 变更支持 HMR 热加载（无需重启），但 host half 变更必须重启。

---

## 6. 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| 左侧导航无 CodeHub 入口 | 插件未加载，或宿主 < 0.2.0-rc.2 无原生 slots | 重启 DSH + 硬刷新；确认 bundles 含 `dsh-codehub-dashboard` |
| 所有请求 503 | `connection` 服务不可用（DSH 原生鉴权异常） | 检查 DSH 启动日志，重新登录宿主 |
| 401 / 登录已失效 | `ctx.connection.admit` 拒绝 | 从 DSH 内重新打开页面 |
| 所有插件消失 | package.json 有 BOM | 用 Node.js 重写 package.json（无 BOM） |
| `SyntaxError: Unexpected token ''` | package.json BOM | 同上 |
| 仓库全部报错 | gh 未登录 | `gh auth login`，或为实例配置 token 走 HTTP |
| AI 检视按钮禁用 | `capabilities.ai=false` 或未配置 provider/model | 设置页选择宿主模型；确认宿主提供 `llm`/`sessions` |
| 开始开发失败 | 未绑定本地克隆或 origin 与仓库不一致 | 设置页绑定对应本地目录（会校验 origin） |
| 发布提示需核实 | `publish_unknown`（远端结果不确定） | 先到 GitHub 确认评论，不要直接重发 |
| 数据不更新 | 缓存 TTL | 调小 pollMinutes 或点击刷新 |
| `/codehub/api` 返回 404 | Host half 未加载 | 检查 DSH 启动日志，确认插件在 bundles 列表中 |

# dsh-codehub-dashboard

> DSH 插件：基于 [gh CLI](https://cli.github.com/) 的 GitHub PR / 检视意见聚合看板

在 DeepSeek Harness 侧边栏中新增 **CodeHub** 标签页，自动拉取多个 GitHub 仓库的 Pull Request、Review、Comment 数据，汇总展示统计图表与评审收件箱，帮助你快速识别待处理 MR 和未解决检视意见。

## ✨ 功能

- **📊 概览看板**：KPI 卡片（开放 MR / 待我评审 / 未解决意见 / CI 失败 / 本周合并）、30 天活跃趋势图、MR 状态分布、各仓库开放 MR 柱状图、评审活跃 Top 排行
- **🔀 MR 列表**：多条件筛选（仓库 / 状态 / 搜索 / 待我评审 / 有未解决意见），点击展开详情抽屉（评审记录 + 行内检视意见）
- **💬 检视意见收件箱**：跨仓库聚合所有 Review Comment，支持按未解决 / 需我回复过滤
- **📚 仓库卡片**：每个仓库的状态概览、CI 健康度、最近活动时间
- **⚙️ 设置面板**：多实例 token 管理、仓库增删、从工作区自动发现 Git 仓库、连通性测试
- **🏷️ Tab 角标**：实时显示「待我评审」数量

## 📦 数据源

| 数据源 | 说明 |
|--------|------|
| **gh CLI**（默认） | 使用 `gh pr list/view` 拉取真实 PR / Review / Comment 数据。需 `gh auth login` 或配置 `GH_TOKEN` |
| **REST API** | 直接调用 GitHub REST API v3，需在设置中配置 Personal Access Token |
| **Git 元信息** | 从本地 git 仓库补充默认分支、远端 URL 等元数据（辅助） |

> ⚠️ 本插件**不包含模拟数据**。所有数据均来自真实 GitHub API。请先完成 gh CLI 认证或配置 token。

## 🚀 安装

### 前置条件

- DSH ≥ 0.1.0-rc.6（推荐 0.2.0-rc.1+）
- [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 已安装
- [gh CLI](https://cli.github.com/) 已安装并完成认证：
  ```sh
  gh auth login
  ```

### 方式一：CLI 安装（推荐）

```sh
dsh plugin --profile desktop add E:\GitHub\Hello-DSH\dsh-codehub-dashboard
```

### 方式二：手动安装

1. 将本目录链接到 profile 的 node_modules：

   **Windows（CMD 管理员）：**
   ```sh
   cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-codehub-dashboard" "E:\GitHub\Hello-DSH\dsh-codehub-dashboard"
   ```

   **macOS / Linux：**
   ```sh
   ln -s "$PWD/dsh-codehub-dashboard" ~/.dsh/profiles/desktop/node_modules/dsh-codehub-dashboard
   ```
2. 编辑 `~/.dsh/profiles/desktop/package.json`：
   - `dependencies` 中添加 `"dsh-codehub-dashboard": "link:E:/GitHub/Hello-DSH/dsh-codehub-dashboard"`
   - `dsh.profile.bundles` 数组末尾添加 `"dsh-codehub-dashboard"`
3. **重启 DeepSeek Harness 桌面应用**（host 侧变更需要重启才能加载新插件）
4. 硬刷新浏览器（Ctrl+Shift+R）

## 🔧 使用

1. 重启后，在右侧栏 **+** 菜单中找到 **CodeHub** 标签页并打开
2. 首次打开时前往「⚙️ 设置」：
   - 确认 gh CLI 已登录（点击「🔌 测试连接」验证）
   - 添加要监控的 GitHub 仓库（格式：`owner/name`，如 `cli/cli`）
   - 或使用「🔍 从工作区发现」自动扫描本地 Git 仓库
   - 填写「我的登录名」以启用「待我评审 / 需我回复」过滤
3. 点击「💾 保存并刷新」即可看到真实数据

## 🏗️ 架构

```
dsh-codehub-dashboard/
├── package.json          # DSH 插件清单（manifestVersion 1, client.platform: web）
├── cordis.patch.yml      # Bundle patch（挂载插件行）
├── index.js              # Host half: gh/git/http providers, cache, aggregation, HTTP routes
├── client.js             # Client half: betterSidebar.registerTab + badge polling + iframe
├── icon.svg              # Plugin icon
├── web/
│   └── index.html        # Dashboard SPA (vanilla JS, hand-crafted SVG charts, no deps)
├── scripts/
│   └── test-host.mjs     # Standalone test harness
├── LICENSE
└── README.md
```

### gh CLI 命令契约

插件通过以下 gh 命令获取数据：

| 用途 | 命令 |
|------|------|
| PR 列表 | `gh pr list --repo <owner/name> --state all --limit 200 --json <fields>` |
| PR 详情 | `gh pr view <number> --repo <owner/name> --json <fields>` |
| 认证状态 | `gh auth status` |
| 版本检查 | `gh --version` |

JSON 字段包括：`number, title, state, isDraft, headRefName, baseRefName, createdAt, updatedAt, mergedAt, additions, deletions, changedFiles, reviewDecision, url, author{login,name}, labels{name}, reviewRequests{login}, latestReviews{...}, reviews{...}, comments{...}`

### API 端点

所有端点挂载在 `/codehub` 前缀下：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/codehub/index.html` | Dashboard SPA |
| GET | `/codehub/api?op=boot` | 初始化（配置 + 摘要） |
| GET | `/codehub/api?op=summary` | 轻量摘要（badge 轮询用） |
| GET | `/codehub/api?op=overview` | 完整看板数据 |
| GET | `/codehub/api?op=mrs&...` | MR 列表（支持筛选） |
| GET | `/codehub/api?op=mr&repoKey=&number=` | MR 详情 |
| GET | `/codehub/api?op=reviews&...` | 检视意见收件箱 |
| GET | `/codehub/api?op=activity` | 活跃趋势 + 最近动态 |
| GET | `/codehub/api?op=refresh` | 强制刷新 |
| GET | `/codehub/api?op=config.get` | 获取配置（token 脱敏） |
| POST | `/codehub/api?op=config.set` | 保存配置 |
| POST | `/codehub/api?op=config.test` | 连通性测试 |
| GET | `/codehub/api?op=repos.discover&ws=` | 工作区 Git 仓库发现 |

## 🧪 开发

```sh
npm install   # 仅开发依赖（eslint）
npm run lint  # eslint（flat config）
npm test      # 独立 harness：假 cordis ctx + 真 HTTP server，验证全部 API 端点
```

运行时零第三方依赖：host 半只用 Node 内置模块，SPA 为 vanilla JS + 内联 SVG。

## 🔐 安全

- Token 持久化在 `~/.dsh/codehub-dashboard/config.json`：POSIX 下尽力设成 0600；**Windows 上 `chmod` 是空操作**，保护依赖用户目录 ACL（该文件为明文，请勿把 `~/.dsh` 放进同步盘）
- API 响应中 token 一律脱敏为 `****xxxx`
- 所有外部命令通过 `execFile` 执行（无 shell 注入风险）
- 路由受 DSH webServer 信任围栏保护

## 📄 License

MIT

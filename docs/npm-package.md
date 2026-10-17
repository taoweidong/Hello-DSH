# npm 发布与安装说明

> 包名：`dsh-codehub-dashboard`（unscoped）｜当前版本：`0.1.5`｜首次发布：2026-10-17
>
> **发布状态（2026-10-17）**：`0.1.5` 正在按 staged 流程发布——CI 执行 `npm stage publish` 后等待维护者 2FA 批准；批准后 `latest` 由 `0.1.4` 切换为 `0.1.5`（`0.1.4` 与 `0.1.3` 仍可安装）。安装见第 2 节；staging 与 2FA 批准流程见第 1、6 节。
>
> 相关文档：[README](../README.md)｜[使用说明与依赖](usage-and-dependencies.md)｜[打包与离线安装](packaging-and-offline-install.md)｜[GitHub Actions 发布工作流](../.github/workflows/publish.yml)

---

## 1. 批准 staged 版本（维护者）

npm 自 2026-09 起限制 bypass-2FA token 直接发布：直接 `npm publish` 会报 `E_STAGE_REQUIRED`，只能先 staging，再由维护者用 2FA 批准。`0.1.3`、`0.1.4` 已按此流程批准；`0.1.5` 按同一流程发布（见文首发布状态）。以下步骤适用于后续版本。背景见 [stage-only token 公告](https://github.blog/changelog/2026-09-18-stage-only-npm-tokens-for-safer-automation/) 与 [staged publishing 文档](https://docs.npmjs.com/cli/v12/commands/npm-stage)。

**方式一：网页（推荐，2FA 不出浏览器）**

登录 [npmjs.com](https://www.npmjs.com/package/dsh-codehub-dashboard) → 包页面 / Staged versions → **Approve** → 完成 2FA。

**方式二：CLI（需要 npm ≥ 11.15.0）**

```sh
npm config set //registry.npmjs.org/:_authToken <npm-token>
npm stage approve <stage-id> --registry=https://registry.npmjs.org/
# 会提示输入 2FA 验证码；完成后删除凭据：
npm config delete //registry.npmjs.org/:_authToken
```

**批准结果校验**

```sh
npm view dsh-codehub-dashboard version dist-tags --registry=https://registry.npmjs.org/
# 0.1.5 发布后：version = '0.1.5'；dist-tags.latest = '0.1.5'（0.1.4、0.1.3 仍在 versions 中）
```

> 如果 `latest` 仍是 `0.0.0-stage`，说明批准尚未生效（可能是 2FA 未完成或登录账号不对），不要安装或升级。

---

## 2. 安装

### 2.1 安装到 DSH（推荐）

```sh
# 安装 latest（当前为 0.1.5）
dsh plugin --profile <profile> add dsh-codehub-dashboard

# 固定版本，避免跟随 latest
dsh plugin --profile <profile> add dsh-codehub-dashboard@0.1.5
```

安装后**完全退出并重启 DSH**，左侧导航出现 **CodeHub**。`dsh plugin` 最终交给 pnpm 解析 npm 包，因此 `@<version>` 语法与 npm 一致。

### 2.2 仅用 npm 拉取包（不激活插件）

```sh
npm install dsh-codehub-dashboard
```

这只把包放进 `node_modules`，**不会注册 DSH 插件**，也不会修改任何 DSH 配置。排查包内容或做二次分发时可这样取包。

### 2.3 离线 / 无 npm 网络

npm 包与仓库归档的 `.tgz` **文件清单一致**（9 个文件），但字节数可能不同：本机 Windows `npm pack` 按 CRLF 换行打包（`0.1.5` 为 65,153 B），npm 由 CI 在 Linux 上以 LF 打包，体积略小。以 npm 上的 shasum 为准。离线安装仍走 tgz，完整步骤见 [打包与离线安装](packaging-and-offline-install.md)：

```sh
dsh plugin --profile <profile> add ./dsh-codehub-dashboard-0.1.5.tgz --offline
```

---

## 3. 安装后校验

```sh
# 1) 包确实被解析（版本号应与安装目标一致）
npm view dsh-codehub-dashboard version --registry=https://registry.npmjs.org/

# 2) DSH 配置里出现插件层
dsh --profile <profile> --dump-config    # 输出中应包含 dsh-codehub-dashboard

# 3) 真实宿主激活：重启 DSH 后看日志
#    出现 did not activate 或 waiting for services 即未被激活
```

浏览器打开 DSH，左侧导航 → **CodeHub** → 设置页保存数据源。若导航入口未出现，先确认 `package.json` 的 `dsh.bundle.patch` 与 `dsh.client.inject` 未被改动，再检查 DSH 版本是否落在 `>=0.2.0-rc.2 <0.3.0`。

---

## 4. 升级、回滚与卸载

```sh
# 升级到 latest
dsh plugin --profile <profile> add dsh-codehub-dashboard@latest

# 升级/回滚到指定版本
dsh plugin --profile <profile> add dsh-codehub-dashboard@0.1.5

# 卸载
dsh plugin --profile <profile> remove dsh-codehub-dashboard
```

> **回滚**：`0.1.5` 发布后，npm 上有 `0.1.5`、`0.1.4`、`0.1.3`，可直接 `add dsh-codehub-dashboard@0.1.4` 回滚。`0.1.2` 及更早版本从未发布到 npm，回退更早版本请使用 [releases/](../releases/README.md) 中归档的 `.tgz` 离线安装。
>
> 升级或回滚后都应重启 DSH 并硬刷新浏览器；插件配置与审计文件不会随包卸载被删除（见 README「安全与隐私」）。

---

## 5. 包内容

`package.json` 的 `files` 白名单决定发布内容；`publishConfig.access` 为 `public`。本机 `0.1.5` 打包结果（Windows CRLF）：

| 文件 | 大小（字节） |
|---|---:|
| `index.js` | 77,017 |
| `workflows.js` | 27,163 |
| `web/index.html` | 94,955 |
| `README.md` | 3,949 |
| `client.js` | 4,990 |
| `package.json` | 1,659 |
| `LICENSE` | 1,079 |
| `icon.svg` | 638 |
| `cordis.patch.yml` | 509 |

- 合计 **9 个文件**；本机 tarball **65,153 B**，解包 **211,959 B**。
- npm 发布件由 CI 在 Linux 上以 LF 打包，体积略小（`0.1.4` 的发布件为 69,663 B / 220,387 B，shasum `a6b07905…`）；**交付校验以 npm registry 上的 shasum 为准**。
- 文件清单：`index.js`、`workflows.js`、`client.js`、`web/index.html`、`cordis.patch.yml`、`icon.svg`、`README.md`、`LICENSE`、`package.json`。
- **无第三方运行时依赖**；`eslint` 仅在 `devDependencies`，不进入产物。
- `peerDependencies.@deepseek-ai/dsh` 为 optional；不安装 DSH 也能取包，但插件只有在 DSH 宿主内才会激活。
- `docs/`、`scripts/`、`releases/`、`.github/`、`AGENTS.md`、`eslint.config.js` 均**不进入** npm 包。

---

## 6. 维护者发布流程

发布由 GitHub Actions 完成，不在本地 `npm publish`。

1. **升版本**：`package.json`、`package-lock.json`（两处）、`index.js` 的 `PLUGIN_VERSION`、`scripts/test-host.mjs` 的 boot 断言、`check-version.mjs` 注释，以及 `design.md` / `api-reference.md` / 本文档与打包手册的版本引用。
2. **跑门禁**：`npm run lint` 与 `npm test` 全绿（当前基线：117 用例 + 92 host 断言）。
3. **提交并打 tag**：

   ```sh
   git commit -am "release(vX.Y.Z): ..."
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```

4. **CI 自动 staging**：`.github/workflows/publish.yml` 校验 tag 与版本一致、执行 lint/test、检查 9 文件打包白名单，然后执行 `npm stage publish`（使用仓库 secret `NPM_TOKEN`，stage-only token）。
5. **维护者批准**：按第 1 节完成 2FA 批准，版本才真正上线。
6. **可选：对已推 tag 复跑**（不移动 tag）：

   ```sh
   gh workflow run publish.yml -f tag=vX.Y.Z
   ```

> 发布凭证只存于 GitHub Actions secret `NPM_TOKEN`，不要写入仓库、脚本或文档。长期建议迁移到 [Trusted Publishing (OIDC)](https://docs.npmjs.com/trusted-publishers)，npm 计划自 2027-01 起停止 bypass-2FA token 的直接发布。

---

## 7. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `npm publish` 报 `E_STAGE_REQUIRED` | 使用的是 stage-only token | 改用 `npm stage publish`，由维护者 2FA 批准 |
| `npm view ... version` 返回 `0.0.0-stage` | staged 版本尚未批准 | 完成第 1 节批准，不要安装 |
| `npm publish` 报 403 `You may not perform that action with these credentials` | token 缺少 package write（如仅 org 权限） | 新建 granular token，Packages 选 Read and write |
| `npm stage approve` 提示 2FA | 批准必须人工 proof-of-presence | 在网页或 CLI 输入 2FA 验证码；bypass token 不能批准 |
| 安装后 DSH 无 CodeHub 入口 | 宿主版本不符、bundle patch 缺失或未重启 | 检查 `engines.dsh`、`dsh.bundle.patch`，完全退出后重启 DSH |
| 升级后行为未变化 | 旧进程或浏览器缓存 | 完全退出 DSH、重启并硬刷新 |

---

## 8. 相关链接

- npm 包页：<https://www.npmjs.com/package/dsh-codehub-dashboard>
- 发布工作流：<https://github.com/taoweidong/dsh-codehub-dashboard/actions/workflows/publish.yml>
- 版本与交付归档：[releases/README.md](../releases/README.md)
- 提交门禁与贡献契约：[AGENTS.md](../AGENTS.md)

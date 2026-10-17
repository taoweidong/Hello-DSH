# AGENTS.md

本文件是本仓库对所有 AI Agent 与贡献者的**强制契约**。违反其中「提交门禁」的改动不得进入 git 历史。

## 提交门禁（硬性契约）

**任何代码提交与推送之前，必须完整执行单元测试；测试全绿之后，才能进行 commit 和 push。**

在仓库根执行（仓库根就是插件包根，没有子目录）：

```sh
npm run lint   # eslint，必须 0 error
npm test       # node --test 四件套（84 用例）+ test-host.mjs（84 断言），必须 0 fail
```

- 两项有任一失败：**禁止 `git commit`，禁止 `git push`**。先修到全绿，或明确记录「本次仅文档改动、不触及被测代码」并说明理由。
- 不允许以 `--no-verify`、`--force` 或任何方式跳过门禁。
- CI（`.github/workflows/ci.yml`，node 18/20/22 矩阵）是兜底，不是替代——红灯不得先进库再等 CI 报错。
- 打包交付件归档在 `releases/`（内容不入 git），文档在 `docs/`，两者都不参与门禁判定。

## 为什么有这条门禁

2026-10-16 质量评估发现：`6b5edb4`、`4582367` 两个提交连续带着失败的测试进入 main，直接原因均为「改完代码没跑测试」。测试断言本已覆盖这些问题，缺的只是提交前那一次执行。

## 契约字段修改必须交叉核对

`dsh.client.inject` 这类「一份事实、多处引用」的字段同时存在于 `package.json`（清单）、`client.js`（运行时）、`docs/design.md`（文档）、`scripts/test-host.mjs`（断言）四处。修改任何一处，必须核对其余三处并跑测试；单边修改即回归。

`index.js` 的 `export const inject` 同属此类：cordis 只接受**扁平服务名数组**（如 `['webServer', 'connection']`），写成 `{required, optional}` 对象会被当作两个名为 `required`/`optional` 的服务，插件在真实宿主永久 pending 而测试依旧全绿。

## 绿灯之外：真实宿主激活

`scripts/test-host.mjs` 的 mock ctx 直接调用 `apply()`，绕过 cordis 的服务解析，证明不了插件能激活。改动 host 半（`index.js` / `workflows.js`）后，交付前必须看真实 DSH 启动日志：出现 `did not activate` 或 `waiting for services` 即红灯（见 [docs/host-verification-2026-10-16.md](docs/host-verification-2026-10-16.md)）。

## 提交信息规范

- 必须说明「改了什么、为什么」；`update`、`fix`、`修改` 等无信息 message 禁止使用——提交信息是后来人的现场证据，无信息提交会让回归无法追溯。
- 建议格式：`fix(scope): 一句话结论`，正文列根因与影响面。

## 仓库结构（2026-10-17 起）

仓库根**就是**插件包根（`package.json`、`index.js`、`workflows.js`、`client.js`、`web/`、`scripts/` 都在根目录），历史上曾放在 `dsh-codehub-dashboard/` 子目录，已扁平化。GitHub 仓库名同步为 `dsh-codehub-dashboard`。

## 环境备注

- 本机 Bash 工具 shell 状态不持久，每条命令都要显式带上仓库根 `cd E:/GitHub/dsh-codehub-dashboard`（重命名后本地 clone 目录名同样为 `dsh-codehub-dashboard`）。
- 推送走 SSH（`git@github.com:taoweidong/dsh-codehub-dashboard.git`），勿用凭据助手。

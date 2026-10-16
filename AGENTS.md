# AGENTS.md

本文件是本仓库对所有 AI Agent 与贡献者的**强制契约**。违反其中「提交门禁」的改动不得进入 git 历史。

## 提交门禁（硬性契约）

**任何代码提交与推送之前，必须完整执行单元测试；测试全绿之后，才能进行 commit 和 push。**

```sh
cd dsh-codehub-dashboard
npm run lint   # eslint，必须 0 error
npm test       # node --test 四件套 + test-host.mjs，必须 0 fail
```

- 两项有任一失败：**禁止 `git commit`，禁止 `git push`**。先修到全绿，或明确记录「本次仅文档改动、不触及被测代码」并说明理由。
- 不允许以 `--no-verify`、`--force` 或任何方式跳过门禁。
- CI（`.github/workflows/ci.yml`，node 18/20/22 矩阵）是兜底，不是替代——红灯不得先进库再等 CI 报错。

## 为什么有这条门禁

2026-10-16 质量评估发现：`6b5edb4`、`4582367` 两个提交连续带着失败的测试进入 main，直接原因均为「改完代码没跑测试」。测试断言本已覆盖这些问题，缺的只是提交前那一次执行。

## 契约字段修改必须交叉核对

`dsh.client.inject` 这类「一份事实、多处引用」的字段同时存在于 `package.json`（清单）、`client.js`（运行时）、`docs/design.md`（文档）、`scripts/test-host.mjs`（断言）四处。修改任何一处，必须核对其余三处并跑测试；单边修改即回归。

## 提交信息规范

- 必须说明「改了什么、为什么」；`update`、`fix`、`修改` 等无信息 message 禁止使用——提交信息是后来人的现场证据，无信息提交会让回归无法追溯。
- 建议格式：`fix(scope): 一句话结论`，正文列根因与影响面。

## 环境备注

- 本机 Bash 工具 shell 状态不持久，每条命令都需先 `cd dsh-codehub-dashboard`。
- 推送走 SSH（`git@github.com:taoweidong/Hello-DSH.git`），勿用凭据助手。

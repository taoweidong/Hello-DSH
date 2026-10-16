# Hello-DSH

DSH（DeepSeek Harness）插件实验仓库。当前收录一个插件：

## 📂 目录结构

| 目录 | 内容 |
|------|------|
| `dsh-codehub-dashboard/` | 插件源码（host 半 + SPA + 测试 + 文档） |
| `releases/` | 交付件归档（npm pack 产物，不纳入版本控制） |
| `.github/workflows/` | CI（node 18/20/22 矩阵跑 lint + test） |
| `AGENTS.md` | 贡献者契约：**测试全绿方可提交推送** |

## 📦 插件列表

| 插件 | 说明 | 状态 |
|------|------|------|
| [dsh-codehub-dashboard](./dsh-codehub-dashboard) | GitHub PR / 检视意见聚合看板：在 DSH 侧边栏新增 CodeHub 标签页，基于 gh CLI 跨仓库聚合 MR、Review、Comment，输出统计图表与评审收件箱 | v0.1.0 |

## 🛠️ 开发

```sh
cd dsh-codehub-dashboard
npm install       # 仅安装开发依赖（eslint）
npm run lint      # eslint（flat config）
npm test          # 独立 harness 验证 host 半全部 API
```

插件为**零运行时依赖**设计：host 半（Node）与 Dashboard SPA（vanilla JS + 内联 SVG）均不引入任何第三方库。

## 📄 License

MIT

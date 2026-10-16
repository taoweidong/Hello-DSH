# releases/ — 交付件归档目录

本目录存放本仓库的**交付打包产物**（npm pack 产出的 `.tgz` 等 tar 类归档），按版本号命名保留，便于回溯与离线交付。

## 规则

- 打包产物统一归档到这里，**不放在插件源码目录或仓库根目录**——根目录只允许出现项目内容（README、AGENTS.md、源码目录）。
- 目录内容不纳入 git 版本控制（见根 `.gitignore`），仅本 README 入库以保留目录结构。
- 打包命令仍在插件目录执行（`npm pack` 按调用目录产出），完成后把产物移入本目录：

  ```sh
  cd dsh-codehub-dashboard
  npm pack
  mv dsh-codehub-dashboard-*.tgz ../releases/
  ```

## 当前归档

| 文件 | 大小 | 生成时间 | 对应提交 |
|------|------|----------|----------|
| dsh-codehub-dashboard-0.1.0.tgz | 63,874 B | 2026-10-16 14:11 | 布局优化版（设计 token 化重排版），已装入 web profile 实机验证 |

> 交付与离线安装操作详见 [dsh-codehub-dashboard/docs/packaging-and-offline-install.md](../dsh-codehub-dashboard/docs/packaging-and-offline-install.md)。

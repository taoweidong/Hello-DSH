# 布局与数据获取流程优化方案（2026-10-15）

> 范围：`web/index.html`（SPA 布局与交互）、`index.js`（provider 调度 / 缓存 / 聚合）。
> 基线：`b776022` 之后的最新代码（gh 扁平字段契约、CI 上提 list、行内评论走 gh api、ensureBoot promise 化均已落地，本方案不重复这些点）。
> 方法：调用链追踪 + 渲染路径推演 + DOM 成本估算。

## 1. 数据获取流程：现状与瓶颈

### 1.1 当前调用链

```
SPA op=overview ──► snapshots() ──► refreshAll(force)
                                     ├─ inflight 去重（并发合并 ✓）
                                     ├─ ghAvailable（5min 探测缓存 ✓）
                                     └─ mapLimit(repos, 3) ──► fetchOne
                                          ├─ cache 检查（TTL=pollMinutes + rev ✓）
                                          └─ ghSnapshot
                                               ├─ 1× gh pr list（200 条全字段）
                                               └─ N×（gh pr view + gh api --paginate）  ← detail 串在 list 后
SPA op=mrs / reviews / activity / refresh ──► 同样走 snapshots()
SPA op=summary（badge 60s） ──► cached() ──► buildOverview 全量重算
```

### 1.2 瓶颈定位（按影响排序）

| # | 瓶颈 | 根因 | 影响 |
|---|------|------|------|
| B1 | **首屏延迟 = 全仓库 × (list + detail)** | snapshot 只有 detail 全部完成后才入 cache 并响应；`gh api --paginate` 遇多页评论时单 PR 可达数秒 | 20 仓库看板首屏 10s+；detail 慢的仓库拖垮整体 |
| B2 | **派生计算重复 5 份** | overview/mrs/reviews/activity/refresh 各自 `decorate` 全量 MR；`buildOverview` 每次重算 dayMap / events sort / reviewerAgg | badge 60s 一次全量聚合，CPU 浪费；数据量大时 op 响应劣化 |
| B3 | **badge 轮询走全量聚合** | `op=summary` 调 `buildOverview` 而非轻量路径 | 每 60s 一次全量计算，仅为一个数字 |
| B4 | **gh 挂掉时慢速失败** | `ghOkCache` 缓存失败态仅 5min，但 `refreshAll` 仍按仓库逐个 `gh pr list`（每个 30s timeout，并发 3） | gh 未安装/未登录时，N 仓库要 N/3 × 30s 才全部落 error |
| B5 | **快照无持久化** | cache 仅进程内存；重启后 warmup 3s + 全量重拉 | 每次重开 sidebar 都是冷启动白屏 |
| B6 | **无瞬时重试** | gh/http 一次失败即进 fallback 链 | Windows 进程抖动、限流 502 被当作硬失败 |
| B7 | **REST provider 无条件请求** | `httpJson` 不带 `If-None-Match` | 轮询周期内数据未变也全量传输（per_page=100） |

## 2. 数据获取流程优化方案

| ID | 方案 | 做法 | 收益 | 风险 | 优先级 |
|----|------|------|------|------|--------|
| D1 | **派生结果 memo** | `buildOverview`/`decorate` 结果按 `(rev, meLogin, snapshotsFingerprint)` 缓存，op 间共享 | 消除 B2/B3：5 op 变 1 次聚合；badge 轮询开销降一个量级 | 低 | **P0** |
| D2 | **两阶段快照** | `ghSnapshot` 拆 `listSnapshot`（立即入 cache 并响应）+ `enrichSnapshot`（后台增量，带 `detailRev` 自增）；SPA overview/mrs 响应带 `partial` 标记，detail 完成后经 `op=overview` 增量刷新 | 首屏从「全仓库 list+detail」降为「全仓库 list」；detail 慢不再阻塞首屏（B1） | 中：需设计 snapshot 版本与前端增量渲染 | P1 |
| D3 | **快照持久化（SWR）** | snapshot 序列化落盘 `~/.dsh/codehub-dashboard/cache.json`（带 fetchedAt + schema 版本）；启动时先返回 stale，后台 revalidate 覆盖 | 重启秒开，消除 B5 的冷启动白屏 | 中：文件体积（200 PR/仓库）、版本兼容、写竞争（已有原子写可复用） | P1 |
| D4 | **gh 不可用快速失败** | `refreshAll` 内若 `ghOkCache.ok===false`，直接按 fallback 链（http→error）分发，不再逐仓库试 gh | 消除 B4：gh 缺失时首屏秒级落 error 态 | 低 | **P0** |
| D5 | **瞬时失败重试一次** | `run()`/`httpJson` 对网络类失败（timeout、ECONNRESET、5xx）重试 1 次，退避 500ms；认证类（401/403、not logged in）不重试 | 降低 B6 的误判降级 | 低 | P1 |
| D6 | **REST 条件请求** | `httpJson` 带 `If-None-Match`（ETag 缓存于进程内 Map），304 时复用上次 body | 轮询流量降 ~90%（B7） | 低：需缓存 body 与 URL 键 | P2 |
| D7 | **detail 预算统一** | `detailLimit` 从 `cfg.http.detailLimit` 提到顶层 `cfg.detailLimit`，gh/http 共用；detail 选取策略（开放 + 近 30 天合并）可配置 | 配置语义清晰，gh 不再借用 http 命名空间的字段 | 低 | P2 |

## 3. 布局：现状与问题

### 3.1 现状

- 单文件 SPA，`render()` 全量 `innerHTML` 重建（焦点恢复已修 ✓）
- MR 列表 200 条**全量 DOM 行**，无虚拟化/分页
- 图表（30 天线图 / donut / 双 hbar）每次 render 重算 SVG 字符串
- reviews 收件箱**全量展开**，无分组折叠
- 加载态为纯文本「加载中…」，无骨架屏
- 窄屏（DSH 侧边栏 iframe 常见 380–560px）：topbar 四项换行、hbar 标签列 170px 挤压、KPI 2 列
- 键盘仅 Esc 可用；MR 行鼠标专属

### 3.2 问题定位

| # | 问题 | 量化 |
|---|------|------|
| L-1 | MR 列表全量渲染 | 200 行 × ~12 节点 ≈ 2400 DOM 节点；每次筛选/搜索全量重建 |
| L-2 | 无骨架屏 | 首屏/刷新白屏 + 纯文本，感知延迟被放大 |
| L-3 | 图表重复重建 | 每次 render（含 toast 后的 render）重跑 4 个图表的 SVG 序列化 |
| L-4 | 窄屏挤压 | ≤560px：topbar 两行、hbar 标签列占 30% 宽度、metrics 与 title 抢空间 |
| L-5 | 收件箱无折叠 | 长列表（100+ 意见）扫描深，无分组 collapse |
| L-6 | 无密度切换 | 信息密集型看板缺紧凑模式，一屏行数固定 |
| L-7 | 键盘不可达 | 无 j/k 移动、Enter 打开、`/` 聚焦搜索 |

## 4. 布局优化方案

| ID | 方案 | 做法 | 收益 | 风险 | 优先级 |
|----|------|------|------|------|--------|
| L1 | **列表窗口化** | MR 列表按视口高度渲染 ~30 行 + 上下缓冲，IntersectionObserver 哨兵增量；保留 `limit` 参数语义（总数不变） | DOM 节点 2400→~400；筛选响应 100ms→10ms 级 | 中：键盘导航与滚动锚需协同 | P1 |
| L2 | **骨架屏** | KPI / 图表 / 列表三态 `.skeleton`（CSS shimmer），替换「加载中…」 | 感知延迟大降，与 D2 的 partial 渲染天然搭配 | 低 | **P0** |
| L3 | **图表 memo** | 图表 HTML 按数据指纹缓存，render 复用；仅数据变化时重算 | 消除 L-3 的重复 SVG 序列化 | 低 | P1 |
| L4 | **窄屏适配** | ≤560px 断点：topbar nav 横向滚动、KPI 2×3、hbar 标签列 90px、MR 行 metrics 换行下沉 | 侧边栏 iframe 主力宽度可用性 | 低 | P1 |
| L5 | **收件箱分组折叠** | 按 MR 分组默认折叠，仅展开「需我回复」组；折叠态记忆于 state | 长收件箱扫描效率 | 低 | P1 |
| L6 | **紧凑密度** | `.compact` 类 + localStorage 持久化：行高 44→32px、字号 14→12.5px | 一屏多看 ~30% 行 | 低 | P2 |
| L7 | **键盘导航** | j/k 移动焦点行、Enter 开 drawer、`/` 聚焦搜索、g+o/g+m/g+r/g+s 切视图 | 高频用户效率，与 L1 窗口化天然搭配 | 低 | P2 |

## 5. 实施顺序与验收

| 批次 | 内容 | 验收标准 |
|------|------|----------|
| 第一批（低风险高感知） | D1 派生 memo + D4 gh 快速失败 + L2 骨架屏 + L3 图表 memo | lint 0 error；test ≥ 现有断言全过 + 新增 memo 命中断言；badge 轮询不再触发全量聚合（计时断言） |
| 第二批（中风险） | D2 两阶段快照 + L1 列表窗口化 | 首屏响应时间中位数降 ≥50%（20 仓库场景）；DOM 节点 ≤600；乱序/部分数据不崩 |
| 第三批（增强） | D3 持久化 SWR + D5 重试 + L4–L7 | 重启首屏 ≤200ms（stale）；gh 瞬时失败重试后成功；键盘全流程可达 |

## 6. 明确不做（记录决策）

- **HTTP provider 的 CI 状态**：需每 PR +1 请求（`/check-runs`），detailLimit 25 → 每仓库 +25 请求，代价过大；UI 显示 "CI —" 为诚实降级。
- **list 阶段裁剪重字段**（additions/deletions/changedFiles）：gh 单次 GraphQL 返回，字段成本可忽略，拆字段反而增加一次调用。
- **虚拟滚动替换为分页**：分页改变 URL 语义与「一屏纵览」心智，窗口化保留全量滚动语义，优先。

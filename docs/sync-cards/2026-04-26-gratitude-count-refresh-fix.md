# 同步卡：感恩计数删除后不刷新修复

**状态：** ✅ 已完成  
**日期：** 2026-04-26  
**commit：** `34d3e5c`

---

## 问题描述

用户删除当天的感恩笔记后，写作页顶部的今日感恩计数不会同步减少。

典型表现：
- 今天已有 1 条感恩记录，写作页显示 `●○○`
- 从记录页删除这条感恩记录后，回到写作页仍显示 `●○○`
- 只有整页重载或重新挂载 HomePage 后，才会变成 `○○○`

## 根本原因

不是 `ThreadDetailPage` 的 `onDeleted={() => pop()}`。

那条链路删除的是脉络 `threads`，不会改 `journal_entries`，因此和感恩计数无关。

真正根因有两个：

1. `MainLayout` 的 Tab 采用“常驻挂载，只切 display”模式，HomePage 不会因切回写作页而自动重新 mount
2. `HomePage` 的 `gratitudeCount` 只在两种时机刷新：
   - 首次挂载
   - 保存感恩日记成功后

记录删除链路在 `RecordsPage.handleDelete()` / `handleBatchDelete()`，原先只会刷新记录列表，不会通知 HomePage 重新拉取今日感恩计数。

## 最终方案

- 保留现有 `refreshKey` 作为统一的 entry 变更信号，不另开第二套 state
- `MainLayout` 把 `refreshKey` 同时传给 `RecordsPage` 和 `HomePage`
- `HomePage` 新增 `gratitudeRefreshTrigger`，统一走 `loadGratitudeCount()` 重拉计数
- `RecordsPage` 单删 / 批删成功后，通过 `onEntriesMutated` 上报给 `MainLayout`

这样保存、编辑、删除、批量删除都能走同一条刷新总线。

## Codex 介入的改动

| Task | 问题 | Codex 方案 | 改动文件 |
|---|---|---|---|
| Task 1 | `HomePage` 的 `gratitudeCount` 只在 mount 和“保存感恩成功”后刷新 | 抽出统一 `loadGratitudeCount()`，新增 `gratitudeRefreshTrigger`，监听外部 entry 变更后重新 fetch | `src/pages/HomePage.jsx` |
| Task 2 | `RecordsPage` 删除记录后只刷新自身列表，不会通知写作页 | 单删 / 批删成功后调用 `onEntriesMutated`，把 entry 变更上报到上层 | `src/pages/RecordsPage.jsx` |
| Task 3 | `MainLayout` 的 `refreshKey` 只驱动 RecordsPage，没有连到 HomePage | 让 `refreshKey` 同时作为 `gratitudeRefreshTrigger` 传给 HomePage，并给 RecordsPage 注入 `onEntriesMutated` | `src/components/MainLayout.jsx` |

## 误判澄清

- `ThreadDetailPage onDeleted` 删的是脉络，不是日记记录
- 本次 bug 的真实数据面是 `journal_entries`
- 因此修复点必须落在 `RecordsPage` 删除链路 + `HomePage` 计数刷新链路，而不是脉络删除回调

## 验证

- 删除当天单条感恩记录后，写作页计数会同步 `1 → 0`
- 批量删除当天多条感恩记录后，写作页计数会同步回落
- 保存感恩记录后，写作页计数仍会正常增加
- `npm run build` 已通过

# 同步卡：详情页修改后感恩计数不刷新修复

**状态：** ✅ 已完成  
**日期：** 2026-04-27  
**commit：** `—`

---

## 问题描述

已有 entry 原本是“觉察”等非感恩分类。

用户在 `RecordDetail` 里手动改成“感恩”后，切回“写”页，顶部今日感恩计数不会立刻 `+1`。
同类问题也包括：把感恩记录的时间改出/改进今天后，计数不会立刻变化。

只有整页刷新后，写作页才会显示正确计数。

---

## 根本原因

这次不是 `entry` 本身没更新。

P0 后，`RecordDetail` 保存字段会经 `entryRepository.updateEntry()` 拿到权威 row，详情页实体本身是新的。

真正漏掉的是：

- `HomePage` 今日感恩计数不是 entry 行本身，而是派生聚合查询
- 这个派生查询依赖 MainLayout 现有 `refreshKey -> gratitudeRefreshTrigger` 链路
- `RecordsPage` 删除已经会走 `onEntriesMutated`
- 但 `RecordDetail.handleFieldSave()` 之前只保存字段，不会上报“这次改动会影响聚合计数”

所以表现成：

- 详情页数据新了
- 写作页派生计数没收到重拉信号

---

## 最终方案

不新建第二套刷新系统，直接复用现有总线：

- `MainLayout.refreshKey`
- `HomePage.gratitudeRefreshTrigger`
- `RecordsPage / RecordDetail -> onEntriesMutated`

新增一个很小的字段判断辅助：

- `src/lib/entryMutationSignals.js`
- 当前只把 `template_type` 和 `created_at` 认定为“会影响今日感恩计数”的字段

`RecordDetail` 保存成功后：

- 若改的是这两类字段
- 就调用 `onEntriesMutated`
- 让 `MainLayout` bump `refreshKey`
- `HomePage` 重新查询今日感恩计数

其它字段保存不触发，避免把普通详情编辑都变成一次额外聚合刷新。

---

## 改动文件

| 文件 | 改动 |
|---|---|
| `src/lib/entryMutationSignals.js` | 新增聚合刷新字段判断辅助 |
| `src/components/RecordDetail.jsx` | 聚合相关字段保存成功后上报 `onEntriesMutated` |
| `src/components/MainLayout.jsx` | 给 `RecordDetail` 注入现有 `handleEntriesMutated` |
| `docs/arch-context.md` | 补真实结构与同步日志 |

---

## 验证

- `node --test src/lib/entryMutationSignals.test.js`

预期交互：

- 详情页把非感恩记录改成感恩，回到“写”页计数立刻 `+1`
- 详情页把感恩记录改成非感恩，回到“写”页计数立刻 `-1`
- 详情页修改 `created_at` 跨过“今天”边界时，计数也立刻同步
  - 注：这条在 `576c5e7` 当时只完成了“刷新信号”半边；查询语义 `[todayStart, tomorrowStart)` 于后续同步卡 `2026-04-27-entry-status-day-range-followup.md` 补齐
- 普通字段如摘要、需求、标注保存，不会额外触发感恩计数刷新

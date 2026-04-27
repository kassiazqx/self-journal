# 同步卡：entry 状态契约 + 日范围语义补齐

**状态：** 已完成，核心路径已手工验证  
**日期：** 2026-04-27  
**分支：** `dev`

---

## 背景

架构审查指出两处真实缺口：

1. P0 把导航改成只传 `entryId` 后，`useEntry()` 仍把所有失败都压成 `null`
   - 结果：已删除记录、网络失败、RLS、瞬时查询异常，调用方都可能只看到“加载中…”
2. 今日感恩计数虽然有刷新信号，但查询语义仍是半截
   - 只有 `created_at >= todayStart`
   - 没有 `< tomorrowStart`

本轮只补这两个契约，不把 `AIConversation.full_conversation` 的旧债混进来。

---

## 最终决策

### 1. `getEntryById()` 改用 `.maybeSingle()`

- 0 行：视为 `missing`
- 真实 query error：保留在 `error`
- 若 0 行，则同步从 RTK entry store `removeOne(id)`

### 2. `useEntry()` 升级为资源状态契约

返回：

- `entry`
- `status`
- `error`
- `retry`

当前状态至少区分：

- `loading`
- `ready`
- `missing`
- `error`

### 3. 所有现有调用方一起接这套契约

- `RecordDetail`
- `EditEntryPage`
- `MainLayout` 里的 `awareness` / `editHome`

行为：

- `missing`：显示“记录已删除或不存在”
- `error`：显示“加载失败，可返回或重试”

### 4. 今日感恩计数改为 `[todayStart, tomorrowStart)`

- 新增 `dateUtils.getDayRange(date)`
- `queryTodayGratitudeCount()` 改用本地时区日范围 helper

---

## 实际改动文件

| 文件 | 改动 |
|---|---|
| `src/lib/dateUtils.js` | 新增 `getDayRange()` |
| `src/lib/dateUtils.test.js` | 覆盖日范围 helper |
| `src/lib/entryReadQueries.js` | 今日感恩计数改为 `[todayStart, tomorrowStart)` |
| `src/lib/entryRepository.js` | `getEntryById()` 改用 `.maybeSingle()`，0 行同步移除 store 实体 |
| `src/hooks/useEntryState.js` | 新增纯状态判定 helper |
| `src/hooks/useEntry.js` | 返回 `{ entry, status, error, retry }` |
| `src/hooks/useEntry.test.js` | 覆盖 missing / error / ready 判定 |
| `src/components/EntryStatusFallback.jsx` | 新增共享兜底 UI |
| `src/components/RecordDetail.jsx` | 接 `missing/error` 契约 |
| `src/pages/EditEntryPage.jsx` | 接 `missing/error` 契约 |
| `src/components/MainLayout.jsx` | `awareness/editHome` 接 `missing/error` 契约 |
| `docs/arch-context.md` | 更新 §3 / §4 / §6 |

---

## 自动验证

已执行并通过：

- `node --test src/lib/dateUtils.test.js src/hooks/useEntry.test.js src/lib/entrySnapshots.test.js src/store/entrySlice.test.js src/lib/entryMutationSignals.test.js`
- `npm run lint`
- `npm run build`

构建仍有既有大包体 warning，不是本轮新增。

---

## 待手工验证

- 从回顾信点一个已删除记录：
  - 不再永远 loading
  - 能看到“记录已删除或不存在”
  - 2026-04-27 已由用户手测确认通过
- 临时制造查询异常时：
  - 不会误判成 missing
  - 能看到“加载失败，可返回或重试”
- 把感恩记录日期改到明天：
  - 今日感恩计数立刻去掉它
- 把明天的感恩记录改回今天：
  - 今日感恩计数立刻加回来

---

## 本轮明确不做

- 不处理 `AIConversation.jsx` 仍读取 `entry.full_conversation` 的旧契约风险
- 不回写或清理 `review_letters.entry_ids` 历史引用

这两项继续单列后续债，不和本轮 `useEntry` 契约补齐混在一起。

# 同步卡：P0 数据层收口

**状态：** ✅ 已完成  
**日期：** 2026-04-27  
**commit：** `2ea97e3`  
**分支：** `dev`

---

## 目标

按 `docs/superpowers/plans/2026-04-27-architecture-consolidation-plan.md` 和
`docs/superpowers/plans/2026-04-27-p0-data-layer.md`，
先只收口 `journal_entries` 这一条链，建立单一真源，消灭：

- `allEntries / entryCache / screen.entry / RecordDetail.entry` 多真源并存
- 后台写回后详情页和列表页旧快照不同步
- 导航层传整条 entry 快照导致返回后闪旧

本轮**不改产品方向**，也**不扩大到其它实体**。

---

## 最终决策

### 1. `journal_entries` 改为 RTK EntityStore 单一真源

- 新建 `src/store/entrySlice.js`
- 归一化按 `id` 存 `journal_entries`
- 核心规则是 `upsertIfNewer`：按 `updated_at` 判新旧，旧行不覆盖新行
- `_stale` 只作为后台写后“下次查看自动 refetch”的标记

### 2. 交互读写统一收口到 `entryRepository`

- 新建 `src/lib/entryRepository.js`
- `create / update / getById / list / delete / deleteMany` 都返回完整权威行
- 所有交互写入成功后立即 upsert 进 store
- 新增 `invalidateEntry(id)` 给后台批量写路径使用

### 3. 导航层只传 `entryId`

- `MainLayout` 的 `screens` 栈不再存 entry 快照
- `RecordDetail` / `EditEntryPage` / `AwarenessFlow` 都改为按 `entryId` 取实体
- 页面读实体统一通过 `useEntry()`

### 4. 只读查询单独收口

- 新建 `src/lib/entryReadQueries.js`
- 仅承接导出、今日感恩计数等只读查询
- 继续通过 `db.js` 访问数据层，不直碰 `supabase`

### 5. 后台写入分两类处理

- `conversationService.saveConversation -> _backgroundProcess`
  - 提取字段写回后，走 repository `updateEntry()`，直接 upsert 权威行
- `extractSummaryService` / `reviewLetterService`
  - 写回 DB 后只 `invalidateEntry(id)`
  - 用户下次查看时再自动 refetch

---

## 实际实现范围

### 新增文件

| 文件 | 作用 |
|---|---|
| `src/store/index.js` | RTK store 根配置 |
| `src/store/entrySlice.js` | EntityAdapter + `upsertIfNewer / markStale / removeMany` |
| `src/hooks/useEntry.js` | store miss 自动 fetch；stale 自动 refetch；支持 `suspendRefetch` |
| `src/lib/entryRepository.js` | `journal_entries` 唯一交互读写入口 |
| `src/lib/entryReadQueries.js` | `journal_entries` 只读查询入口 |
| `src/lib/entrySnapshots.test.js` | 断言 `JOURNAL_ENTRY_FULL_SELECT` 含 `updated_at` |
| `src/store/entrySlice.test.js` | 断言 `upsertIfNewer / removeMany / markStale` 行为 |

### 删除文件

| 文件 | 原因 |
|---|---|
| `src/contexts/EntryCacheContext.jsx` | 被 EntityStore 完整取代 |
| `src/lib/journalService.js` | entry CRUD 已迁到 repository / read queries |

### 主要迁移文件

| 文件 | 本轮改动 |
|---|---|
| `src/main.jsx` | 包 `Provider` |
| `src/components/MainLayout.jsx` | screens 栈只传 `entryId`；切 session/user 时清空 entries store |
| `src/pages/RecordsPage.jsx` | 列表显示优先从 store 读；分页/筛选/删除接 repository |
| `src/components/RecordDetail.jsx` | 改为 `entryId + useEntry()`；字段保存和 AI 分析走 repository |
| `src/pages/EditEntryPage.jsx` | 改为 `entryId + useEntry({ suspendRefetch })` |
| `src/pages/HomePage.jsx` | 新建/编辑先拿权威 row 再导航；今日感恩计数查询迁到 `entryReadQueries` |
| `src/pages/SettingsPage.jsx` | 导出前全量读取迁到 `queryAllEntries()` |
| `src/lib/conversationService.js` | 改用 repository `updateEntry()` |
| `src/lib/extractSummaryService.js` | 批量写后 `invalidateEntry(id)` |
| `src/lib/reviewLetterService.js` | 回写 `covered_by_letter_id` 后 `invalidateEntry(id)` |
| `src/lib/entrySnapshots.js` | `FULL_SELECT` 补 `updated_at` 和 `covered_by_letter_id` |

---

## 验证

- `node --test src/lib/entrySnapshots.test.js src/store/entrySlice.test.js`
- `npm run build`
- `npm run lint`

以上三项在本轮完成后均已通过。

---

## 本轮没有纳入的内容

- 没有改“普通保存就自动跑 AI 提取”的产品逻辑
- 没有新增第二套派生状态机制
- 没有处理“RecordDetail 手动把模板改成感恩后，写页感恩计数不立刻刷新”这个小 patch

最后这一项属于现有 `refreshKey` 派生刷新链路的缺口，不属于本次 commit 已完成范围，后续单独补。

---

## 给下个 session 的一句话

现在 `journal_entries` 主链已经收口到：

`UI -> useEntry / entryRepository -> entrySlice(EntityStore) -> db.js`

后续小修先优先复用这条链，不要再把 `entry` 快照塞回导航层或页面本地缓存里。

# P0 数据层收口实施 Plan

> 目标：建立 EntryRepository + EntityStore，消灭多真源，实现 journal_entries 全局一致。
> 前置文档：`docs/superpowers/plans/2026-04-27-architecture-consolidation-plan.md` §1

---

## 改动总览

| 文件 | 动作 | 说明 |
|---|---|---|
| `package.json` | 修改 | 安装 `@reduxjs/toolkit` + `react-redux` |
| `src/store/index.js` | 新建 | RTK store 配置 |
| `src/store/entrySlice.js` | 新建 | EntityAdapter + upsertIfNewer + markStale + removeMany |
| `src/lib/entryRepository.js` | 新建 | 唯一交互读写口，连 store，经 `db.js` 访问数据层 |
| `src/lib/entryReadQueries.js` | 新建 | 只读查询（统计/导出/AI 上下文），不连 store，经 `db.js` 访问数据层 |
| `src/main.jsx` | 修改 | 包 Redux Provider |
| `src/lib/journalService.js` | 修改 | updateEntry 加 .select().single()；其余函数逐步迁移到 repository |
| `src/lib/conversationService.js` | 修改 | _backgroundProcess 写完后 upsertIfNewer |
| `src/lib/extractSummaryService.js` | 修改 | 写完后 invalidate(id) |
| `src/lib/reviewLetterService.js` | 修改 | 写 journal_entries 后 invalidate(id) |
| `src/components/MainLayout.jsx` | 修改 | 导航只传 entryId，移除 EntryCacheProvider |
| `src/pages/RecordsPage.jsx` | 修改 | 列表管 ids，从 store 读 entry；删 resolveEntry/storeEntries |
| `src/components/RecordDetail.jsx` | 修改 | 改用 useEntry(id)，删 getCachedEntry/isLocalEntryProtected/storeEntry |
| `src/pages/EditEntryPage.jsx` | 修改 | 改用 useEntry(id)，保存后走 repository.update |
| `src/pages/HomePage.jsx` | 修改 | insert 后走 repository.create，upsert 进 store |
| `src/contexts/EntryCacheContext.jsx` | 删除（P0 末） | 由 EntityStore 取代 |
| `src/lib/entrySnapshots.js` | 保留 | JOURNAL_ENTRY_FULL_SELECT 继续使用，hasCompleteEntry 可在 P0 末删除 |

---

## Task 0：确认前置条件

- [ ] `npm run build` 当前通过
- [ ] 安装依赖：`npm install @reduxjs/toolkit react-redux`
- [ ] `git tag checkpoint-p0-start-$(date +%Y%m%d)` 打 checkpoint
- [ ] 确认 `src/lib/entrySnapshots.js` 中 `JOURNAL_ENTRY_FULL_SELECT` 字段与 Supabase 表结构一致
- [ ] 明确本轮接缝决策：`entryRepository.js` / `entryReadQueries.js` 继续通过 `db.js` 访问 `journal_entries`，不直接 import `supabase`

---

## Task 1：建立 EntityStore

**新建 `src/store/entrySlice.js`**

```javascript
import { createEntityAdapter, createSlice } from '@reduxjs/toolkit'

const adapter = createEntityAdapter()

const entrySlice = createSlice({
  name: 'entries',
  initialState: adapter.getInitialState(),
  reducers: {
    upsertIfNewer(state, action) {
      const incoming = action.payload
      const current = state.entities[incoming.id]
      if (!current) {
        adapter.upsertOne(state, { ...incoming, _stale: false })
        return
      }
      const incomingTime = new Date(incoming.updated_at).getTime()
      const currentTime = new Date(current.updated_at).getTime()
      if (incomingTime >= currentTime) {
        adapter.upsertOne(state, { ...incoming, _stale: false })
      }
    },
    upsertManyIfNewer(state, action) {
      action.payload.forEach(incoming => {
        const current = state.entities[incoming.id]
        if (!current) {
          adapter.upsertOne(state, { ...incoming, _stale: false })
          return
        }
        const incomingTime = new Date(incoming.updated_at).getTime()
        const currentTime = new Date(current.updated_at).getTime()
        if (incomingTime >= currentTime) {
          adapter.upsertOne(state, { ...incoming, _stale: false })
        }
      })
    },
    markStale(state, action) {
      const id = action.payload
      if (state.entities[id]) {
        state.entities[id]._stale = true
      }
    },
    removeOne: adapter.removeOne,
    removeMany: adapter.removeMany,
    clearAll: adapter.removeAll,
  },
})

export const entryActions = entrySlice.actions
export const entrySelectors = adapter.getSelectors(state => state.entries)
export default entrySlice.reducer
```

**新建 `src/store/index.js`**

```javascript
import { configureStore } from '@reduxjs/toolkit'
import entryReducer from './entrySlice'

export const store = configureStore({
  reducer: {
    entries: entryReducer,
  },
})
```

**验收：**
- `npm run build` 通过
- store 可以正常 dispatch upsertIfNewer / markStale / removeOne / removeMany

---

## Task 2：建立 EntryRepository

**新建 `src/lib/entryRepository.js`**

所有交互实体读写的唯一入口。内部通过 `db.js` 适配层访问 `journal_entries`，写入后同步 store。

```javascript
import { db } from './db'
import { JOURNAL_ENTRY_FULL_SELECT } from './entrySnapshots'
import { store } from '../store'
import { entryActions, entrySelectors } from '../store/entrySlice'

// ─── 读 ────────────────────────────────────────────────────────
export async function getEntryById(id, { force = false } = {}) {
  if (!force) {
    const cached = entrySelectors.selectById(store.getState(), id)
    if (cached && !cached._stale) return { data: cached, error: null }
  }
  const result = await db
    .from('journal_entries')
    .select(JOURNAL_ENTRY_FULL_SELECT)
    .eq('id', id)
    .single()
  if (result.data) store.dispatch(entryActions.upsertIfNewer(result.data))
  return result
}

export async function listEntries({ userId, from, limit }) {
  const result = await db
    .from('journal_entries')
    .select(JOURNAL_ENTRY_FULL_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1)
  if (result.data) store.dispatch(entryActions.upsertManyIfNewer(result.data))
  return result
}

// ─── 写 ────────────────────────────────────────────────────────
export async function createEntry(entry) {
  const result = await db
    .from('journal_entries')
    .insert(entry)
    .select(JOURNAL_ENTRY_FULL_SELECT)
    .single()
  if (result.data) store.dispatch(entryActions.upsertIfNewer(result.data))
  return result
}

export async function updateEntry({ id, userId, fields }) {
  const result = await db
    .from('journal_entries')
    .update(fields)
    .eq('id', id)
    .eq('user_id', userId)
    .select(JOURNAL_ENTRY_FULL_SELECT)
    .single()
  if (result.data) store.dispatch(entryActions.upsertIfNewer(result.data))
  return result
}

export async function deleteEntry({ id, userId }) {
  const result = await db
    .from('journal_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (!result.error) store.dispatch(entryActions.removeOne(id))
  return result
}

export async function deleteEntries({ ids, userId }) {
  const result = await db
    .from('journal_entries')
    .delete()
    .in('id', ids)
    .eq('user_id', userId)
  if (!result.error) store.dispatch(entryActions.removeMany(ids))
  return result
}

// ─── invalidate（后台服务用）──────────────────────────────────
export function invalidateEntry(id) {
  store.dispatch(entryActions.markStale(id))
}
```

**验收：**
- createEntry / updateEntry 都返回完整行（用 console.log 确认字段数量 = FULL_ENTRY_FIELDS 长度）
- deleteEntry 后 store 里对应 id 消失
- deleteEntries 后 store 里对应 ids 全部消失（验证 `removeMany` 路径）

---

## Task 3：建立 EntryReadQueries

**新建 `src/lib/entryReadQueries.js`**

统计/导出/AI 上下文用，只读，不连 store。
把现在散落在各 service 里的直接 `db.from('journal_entries')` 只读查询收口到这里。

```javascript
import { db } from './db'

// 导出用（fetchAllEntries 替代）
export async function queryAllEntries({ userId }) {
  return db
    .from('journal_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
}

// 统计用（InsightsPage）
export async function queryEntriesForInsights({ userId, ...filters }) {
  // 保持现有 insightsService 的查询逻辑，只是统一入口
  return db
    .from('journal_entries')
    .select('id, created_at, emotions, emotion_display, overall_state_score, category_tags, template_type')
    .eq('user_id', userId)
}

// AI 上下文用（reviewLetterService / threadService 读 entries）
export async function queryEntriesForAI({ userId, ids }) {
  let query = db
    .from('journal_entries')
    .select('id, content, created_at, emotions, emotion_display, entry_summary, category_tags, people_involved')
    .eq('user_id', userId)
  if (ids?.length) query = query.in('id', ids)
  return query
}

// 今日感恩计数（保持现有逻辑）
export async function queryTodayGratitudeCount(userId) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const { count, error } = await db
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('template_type', 'gratitude')
    .gte('created_at', todayStart.toISOString())
  return { count: Math.min(count ?? 0, 3), error }
}
```

**验收：**
- insightsService、exportService、reviewLetterService 的只读查询逐步迁入
- 这些 service 不再直接碰 `supabase.from('journal_entries')`

---

## Task 4：建立 useEntry hook

**新建 `src/hooks/useEntry.js`**

```javascript
import { useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { entrySelectors } from '../store/entrySlice'
import { getEntryById } from '../lib/entryRepository'

export function useEntry(id, { suspendRefetch = false } = {}) {
  const dispatch = useDispatch()
  const entry = useSelector(state => entrySelectors.selectById(state, id))

  useEffect(() => {
    if (!id) return
    if (!entry) {
      // store miss，主动拉取
      getEntryById(id)
      return
    }
    if (entry._stale && !suspendRefetch) {
      // 标记为旧，且调用方没有暂停 refetch（非编辑态）
      getEntryById(id, { force: true })
    }
  }, [id, entry?._stale, suspendRefetch])

  return entry ?? null
}

export function useEntryList() {
  return useSelector(state => entrySelectors.selectAll(state))
}
```

**验收：**
- RecordDetail 改用 `useEntry(entryId)` 后，进入详情不再需要 `initialEntry` 传参
- 编辑态传 `suspendRefetch={true}` 后，后台 invalidate 不会立即覆盖本地

---

## Task 5：接入 Provider，迁移 main.jsx

**修改 `src/main.jsx`**

```javascript
import { Provider } from 'react-redux'
import { store } from './store'

// 包在 App 外层
<Provider store={store}>
  <App />
</Provider>
```

**验收：**
- useSelector / useDispatch 在所有组件里可用
- `npm run build` 通过

---

## Task 6：迁移后台写入服务

### 6a. conversationService._backgroundProcess

写完后调用 updateEntry（从 entryRepository），拿到 full row，upsertIfNewer：

```javascript
// 修改前
await updateEntry({ id, userId, fields: extractedFields })

// 修改后（从 entryRepository 导入）
import { updateEntry } from './entryRepository'
const { data } = await updateEntry({ id, userId, fields: extractedFields })
// data 已自动 upsertIfNewer 进 store，无需额外操作
```

### 6b. extractSummaryService

批量写完后 invalidate：

```javascript
import { invalidateEntry } from './entryRepository'
import { db } from './db'

// 写完 DB 后
await db.from('journal_entries').update(fields).eq('id', entryId)
invalidateEntry(entryId)  // 标记 stale，下次用户查看时自动 refetch
```

### 6c. reviewLetterService（写 covered_by_letter_id）

```javascript
import { invalidateEntry } from './entryRepository'
import { db } from './db'

// 写完 DB 后
await db.from('journal_entries').update({ covered_by_letter_id: letterId }).eq('id', entryId)
invalidateEntry(entryId)
```

**验收：**
- 对话结束后，RecordDetail 立即显示 AI 提取的 emotions/core_needs，不再需要等刷新

---

## Task 7：迁移 UI 层

### 7a. MainLayout.jsx

- `handleOpenDetail(entry)` → `handleOpenDetail(entryId)`
- `handleEditEntry(entry)` → `handleEditEntry(entryId)`
- screens 栈只存 `{ type, entryId }` 而不是 `{ type, entry }`
- 移除 `EntryCacheProvider` 包裹

### 7b. RecordsPage.jsx

- `allEntries` 继续存（作为列表 id 来源和排序依据）
- 列表渲染时，每个 item 从 store 读完整 entry：`useSelector(state => entrySelectors.selectById(state, item.id))`
- 或建立 `useEntryList()` selector，按 ids 顺序返回 store 里的 entries
- load/refresh 调用 `listEntries()` from entryRepository（自动 upsertManyIfNewer）
- 删除 `resolveEntry`、`storeEntries`、`removeCachedEntry` 调用
- 单删改用 `deleteEntry()` from entryRepository
- 批量删改用 `deleteEntries()` from entryRepository；成功后由 `removeMany` 同步清 store，不能只清本地列表 state

### 7c. RecordDetail.jsx

- 接收 `entryId` 而非 `entry` 对象
- 改用 `const entry = useEntry(entryId)`
- 标注保存后调 `updateEntry({ id, userId, fields: { annotations } })` from entryRepository
- 删除 `getCachedEntry`、`isLocalEntryProtected`、`storeEntry` 调用

### 7d. EditEntryPage.jsx

- 接收 `entryId` 而非 `entry` 对象
- 改用 `const entry = useEntry(entryId, { suspendRefetch: isDirty })`
- 保存调 `updateEntry` from entryRepository
- 删除 `resolveEntry`、`storeEntry` 调用

### 7e. HomePage.jsx

- 新建日记改用 `createEntry` from entryRepository
- 非 AI 直存路径：`await createEntry()` 拿到完整行（含 `updated_at` + FULL_SELECT 字段）后，再 `onDone(createdEntry, gotoAwareness)`
- 不再把当前 `optimisticEntry` 直接喂给 store / 导航主流程；它缺 `updated_at`，会破坏 upsertIfNewer 判新旧
- 如需保留“先跳转再上传图片”的体验，可以继续复用 `createEntry()` 返回的真实 `entry.id` 做后续异步图片上传

**验收（Task 7 整体）：**
- 保存后返回列表，再点进详情，不再闪旧
- 导航层不再传 entry 对象
- `EntryCacheContext` 所有 import 已清零（可以删文件了）

---

## Task 8：清理

- [ ] 删除 `src/contexts/EntryCacheContext.jsx`
- [ ] 删除 `src/lib/entrySnapshots.js` 中的 `hasCompleteEntry`（已无调用）
- [ ] 删除 `src/lib/journalService.js` 中已被 entryRepository 替代的函数（fetchEntries、fetchEntryById、updateEntry、deleteEntry、insertEntry）
- [ ] 检查 `refreshKey` 中是否还有 entry 相关的副作用，逐步摘除
- [ ] `npm run build` 通过，无 lint 警告
- [ ] 完整手动验证清单（见下）

---

## 验收清单

- [ ] 保存标注后返回列表再进详情，不闪旧
- [ ] 保存情绪后返回列表再进详情，不闪旧
- [ ] 若当前流程本来会触发后台提取（如对话完成后的 `saveConversation -> _backgroundProcess`），返回详情后可立即看到提取字段（不需要手动刷新）
- [ ] 新建日记后，列表立即出现新条目
- [ ] 删除条目后，store 里清除，列表不再显示
- [ ] 批量删除条目后，store 里对应 ids 全部清除，列表与筛选结果都不再显示旧条目
- [ ] 编辑态下后台 invalidate 不会覆盖本地输入
- [ ] 取消编辑后，看到最新远端值
- [ ] `npm run build` 通过
- [ ] `npm run lint`（或 `npm run dev` 无 lint 警告）

---

## 风险与注意事项

1. **refreshKey 不能一刀全删**：它还挂着回顾信刷新、pending count、gratitude count 等非 entry 逻辑。Task 7 只摘 entry 相关的部分，其余留到 P2 再处理。

2. **迁移期双真源**：Task 7 是最高风险阶段。迁移过程中会短暂存在"部分页面用 store，部分页面还用 EntryCacheContext"的状态。建议每个子任务（7a-7e）完成后立即验证，不要批量堆叠。

3. **updated_at 精度**：Supabase 返回的 updated_at 是 ISO 字符串，精度到毫秒。如果同一毫秒内两次写入，upsertIfNewer 取 `>=`，后写的会覆盖。这在当前产品场景下不会出现问题。

4. **deleteEntries（批量删除）**：不能留到 Task 8 才补。RecordsPage 当前已在用批量删，Task 7b 迁移时就要接 `deleteEntries()` + `removeMany`，否则删完 DB 后 store 还残留旧 entry。

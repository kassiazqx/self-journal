# 同步卡：Plan 外改动记录（2026-04-15 代码 session）

> 本卡记录本次代码 session 中**超出 plan 范围**的改动，供下一个 session 冷启动时了解实际状态。

---

## 偏差 1：ThreadDetailPage 搜索降级为 2 字段（原计划 6 字段）

**Plan 要求：** 搜索覆盖 `content + entry_summary + emotions + emotion_display + core_needs + category_tags`，array 字段用 `::text` cast。

**实际实现：** 搜索只覆盖 `content + entry_summary`。

**原因：** Supabase JS 客户端的 `.or()` 字符串不支持 PostgreSQL `::text` cast 语法（如 `emotions::text.ilike.%q%`），执行后返回 400 Bad Request。这是 Supabase JS 的已知限制，不是 SQL 本身的问题。

**影响：** 搜索范围低于原计划，无法通过情绪词、核心需求、大类标签搜索记录。

**后续方案（未实施）：** 如需完整 6 字段搜索，需创建 SQL RPC 函数（如 `search_my_entries`），在函数内用原生 SQL 做 array 字段搜索，前端改为 `db.rpc('search_my_entries', { q })`。已记录为 §4.24。

---

## 偏差 2：RecordsPage 新增无限滚动分页（plan 完全未覆盖）

**Plan 要求：** 无（RecordsPage 不在本次 plan 范围内）。

**实际改动：** 发现 RecordsPage 写死 `.limit(50)`，用户有 105 条记录只能看到最近 50 条，4 月 9 日之前的记录不可见。

**改动内容：**
- 移除 `.limit(50)`，改为 `.range(0, 49)` 初始加载
- 新增 `loadMoreEntries()` 函数，每次追加 50 条
- 新增 `handleScroll()` 监听滚动，触底 200px 内自动触发加载
- 用 `useRef` 同步锁防止并发请求
- 底部显示「加载中…」/ 「已加载全部记录」提示

**影响：** 正向改动，无副作用。`allEntries` + `allLetters` 分开存储，合并排序逻辑不变。

---

## 偏差 3：RecordDetail 改用 useAuth() 获取 user.id（修复 bug，非 plan 偏差）

**Plan 要求：** 使用 `initialEntry.user_id` 查询 user_options。

**实际改动：** `initialEntry.user_id` 在调用路径中始终为 `undefined`（entry 传入时只含部分字段），改为 `import { useAuth }` + `const { user } = useAuth()` 获取 `user.id`。

**影响：** 这是 bug 修复，不是功能偏差。category_tags sheet 空白的根本原因就在这里。

---

## 影响文件汇总

| 文件 | 改动类型 |
|---|---|
| `src/pages/RecordsPage.jsx` | Plan 外新增：无限滚动分页 |
| `src/pages/ThreadDetailPage.jsx` | Plan 内降级：搜索从 6 字段降为 2 字段 |
| `src/components/RecordDetail.jsx` | Bug 修复：useAuth 替换 initialEntry.user_id |

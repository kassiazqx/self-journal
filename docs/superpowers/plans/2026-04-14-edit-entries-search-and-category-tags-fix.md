# 编辑关联记录搜索升级 + category_tags 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复编辑关联记录无默认列表、搜索仅覆盖 content 字段、category_tags 新用户空白、孤儿标签不可编辑、重命名不回写历史等五个问题。

**Architecture:** Task 0 在 Supabase 创建 RPC 函数（DB 层）；Task 1 修改 ThreadDetailPage（默认列表 + 分页 + 6字段搜索）；Task 2 修改 RecordDetail（自动种入默认标签 + 孤儿标签合并）；Task 3 修改 SettingsPage（✎ 重命名按钮 + RPC 批量回写）。

**Tech Stack:** React, Supabase JS client (`db.from`, `db.rpc`), PostgreSQL `array_replace`

---

### Task 0：Supabase SQL Editor — 创建 replace_category_tag RPC 函数

> ⚠️ 此步骤由**用户**在 Supabase 控制台手动执行，不是代码改动。

**Files:**
- 无代码文件改动

- [ ] **Step 1：打开 Supabase SQL Editor**

访问 https://supabase.com/dashboard → 进入 self-journal 项目 → 左侧菜单「SQL Editor」

- [ ] **Step 2：粘贴并执行以下 SQL**

```sql
CREATE OR REPLACE FUNCTION replace_category_tag(p_old TEXT, p_new TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE journal_entries
  SET category_tags = array_replace(category_tags, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(category_tags);
$$;
```

点击「Run」执行。

- [ ] **Step 3：确认执行结果**

预期：右侧输出显示 `Success. No rows returned`。

若出现 `ERROR`，检查是否已有同名函数签名冲突（`CREATE OR REPLACE` 应自动覆盖，正常不报错）。

- [ ] **Step 4：回复"Task 0 完成"**

告知代码 session 可以继续 Task 1。

---

### Task 1：ThreadDetailPage.jsx — 默认列表 + 无限滚动 + 6字段搜索

**Files:**
- Modify: `src/pages/ThreadDetailPage.jsx`

- [ ] **Step 1：新增 state 变量**

在现有 state 块（第 38–42 行）的 `arcStale` 之前，添加：

```js
// 编辑关联记录模式
const [editingEntries, setEditingEntries] = useState(false)
const [searchQuery, setSearchQuery] = useState('')
const [searchResults, setSearchResults] = useState([])
const [searching, setSearching] = useState(false)
// 新增：默认列表分页
const [defaultEntries, setDefaultEntries] = useState([])
const [defaultOffset, setDefaultOffset] = useState(0)
const [hasMore, setHasMore] = useState(true)
const [loadingMore, setLoadingMore] = useState(false)
const [arcStale, setArcStale] = useState(false)
```

（即把原来的 4 行 state 替换为上面 9 行，保留 arcStale）

- [ ] **Step 2：新增 loadDefaultEntries 函数**

在 `doSearch` 函数（第 102 行）前面插入：

```js
// ── 编辑关联记录：加载默认列表（按时间倒序，每页 30 条）─────
async function loadDefaultEntries(offset = 0) {
  const allExistingIds = new Set((rawEntries ?? []).map(r => r.entry_id))
  const { data } = await db.from('journal_entries')
    .select('id, entry_summary, created_at, content')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + 29)
  const filtered = (data ?? []).filter(e => !allExistingIds.has(e.id))
  if (offset === 0) {
    setDefaultEntries(filtered)
  } else {
    setDefaultEntries(prev => [...prev, ...filtered])
  }
  setHasMore((data ?? []).length === 30)
  setDefaultOffset(offset)
}

async function loadMore() {
  if (loadingMore || !hasMore) return
  setLoadingMore(true)
  await loadDefaultEntries(defaultOffset + 30)
  setLoadingMore(false)
}
```

- [ ] **Step 3：替换 doSearch 函数**

将现有 `doSearch`（第 102–114 行）完整替换：

```js
async function doSearch(q) {
  setSearching(true)
  const escaped = q.replace(/%/g, '\\%').replace(/_/g, '\\_')
  const { data } = await db.from('journal_entries')
    .select('id, entry_summary, created_at, content')
    .eq('user_id', user.id)
    .or(`content.ilike.%${escaped}%,entry_summary.ilike.%${escaped}%,emotions::text.ilike.%${escaped}%,emotion_display::text.ilike.%${escaped}%,core_needs::text.ilike.%${escaped}%,category_tags::text.ilike.%${escaped}%`)
    .order('created_at', { ascending: false })
    .limit(30)
  const allExistingIds = new Set((rawEntries ?? []).map(r => r.entry_id))
  setSearchResults((data ?? []).filter(e => !allExistingIds.has(e.id)))
  setSearching(false)
}
```

- [ ] **Step 4：更新搜索 useEffect**

将现有 useEffect（第 95–100 行）替换：

```js
useEffect(() => {
  if (!editingEntries) return
  if (!searchQuery.trim()) {
    setSearchResults([])
    // 进入编辑模式或清空搜索时，加载默认列表
    loadDefaultEntries(0)
    return
  }
  const timer = setTimeout(() => doSearch(searchQuery), 300)
  return () => clearTimeout(timer)
}, [searchQuery, editingEntries])
```

- [ ] **Step 5：更新"完成"按钮的 onClick，清除默认列表 state**

找到第 245 行：
```js
onClick={() => { setEditingEntries(false); setSearchQuery(''); setSearchResults([]) }}
```
替换为：
```js
onClick={() => { setEditingEntries(false); setSearchQuery(''); setSearchResults([]); setDefaultEntries([]); setDefaultOffset(0); setHasMore(true) }}
```

- [ ] **Step 6：在 JSX 中，搜索结果区下方增加"默认列表"区块**

找到第 263–288 行的搜索结果区块（`{editingEntries && searchQuery.trim() && ...}`），在其结束的 `)}` 之后立即插入：

```jsx
{/* 默认列表（搜索框为空时展示） */}
{editingEntries && !searchQuery.trim() && (
  <div style={{ marginBottom: 16 }}>
    <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>未关联记录</div>
    {defaultEntries.length === 0 && !loadingMore ? (
      <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>暂无可添加的记录</div>
    ) : defaultEntries.map(entry => (
      <div key={entry.id}
        style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'white', borderRadius: 10, padding: '10px 12px', marginBottom: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: '#bbb', marginBottom: 2 }}>{formatDate(entry.created_at)}</div>
          <div style={{ fontSize: 13, color: '#333', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {entry.entry_summary ?? entry.content?.slice(0, 60) ?? ''}
          </div>
        </div>
        <button onClick={() => handleAddEntry(entry)}
          style={{ flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: '#e8f5e9', border: '1.5px solid #81c784', color: '#43a047', fontSize: 18, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          +
        </button>
      </div>
    ))}
    {hasMore && (
      <button onClick={loadMore} disabled={loadingMore}
        style={{ width: '100%', padding: '10px', border: '1px solid #ede9e2', borderRadius: 10, background: 'none', color: '#c9a96e', fontSize: 13, cursor: loadingMore ? 'default' : 'pointer' }}>
        {loadingMore ? '加载中…' : '加载更多'}
      </button>
    )}
    <div style={{ height: 1, background: '#ede9e2', margin: '12px 0' }} />
  </div>
)}
```

- [ ] **Step 7：handleAddEntry 添加后从 defaultEntries 中移除**

找到现有 `handleAddEntry`：
```js
setSearchResults(prev => prev.filter(e => e.id !== entry.id))
```
在其后追加一行：
```js
setDefaultEntries(prev => prev.filter(e => e.id !== entry.id))
```

- [ ] **Step 8：运行构建检查**

```bash
npm run build
```
预期：无报错。

---

### Task 2：RecordDetail.jsx — A1 自动种入默认标签 + B1 孤儿标签合并

**Files:**
- Modify: `src/components/RecordDetail.jsx`

- [ ] **Step 1：替换 loadCategoryOptions useEffect**

找到第 154–165 行：
```js
  // 读取用户自定义内容大类标签（⚠️ 实际列名：field_name / option_value）
  useEffect(() => {
    async function loadCategoryOptions() {
      const { data } = await db.from('user_options')
        .select('id, option_value, sort_order')
        .eq('user_id', initialEntry.user_id)
        .eq('field_name', 'content_category')
        .order('sort_order', { ascending: true })
      setCategoryOptions((data ?? []).map(r => r.option_value))
    }
    loadCategoryOptions()
  }, [initialEntry.user_id])
```

完整替换为：

```js
  // 读取用户自定义内容大类标签（含 A1 自动种入 + B1 孤儿标签）
  useEffect(() => {
    async function loadCategoryOptions() {
      const { data } = await db.from('user_options')
        .select('id, option_value, sort_order')
        .eq('user_id', initialEntry.user_id)
        .eq('field_name', 'content_category')
        .order('sort_order', { ascending: true })

      // A1：新用户首次打开，静默种入 11 个默认标签
      if ((data ?? []).length === 0) {
        const defaults = ['工作','家庭','恋爱与亲密关系','个人成长','学习','财务','运动健康','社交','玩乐休闲','灵性修行','日常生活']
        const rows = defaults.map((label, i) => ({
          user_id: initialEntry.user_id,
          field_name: 'content_category',
          option_value: label,
          sort_order: i,
        }))
        const { data: inserted } = await db.from('user_options').insert(rows).select('id, option_value, sort_order')
        setCategoryOptions((inserted ?? []).map(r => r.option_value))
        return
      }

      // B1：孤儿标签合并（entry 上有、但 user_options 里已删除的标签）
      const userOptionLabels = (data ?? []).map(r => r.option_value)
      const orphans = (entry.category_tags ?? []).filter(t => !userOptionLabels.includes(t))
      setCategoryOptions([...userOptionLabels, ...orphans])
    }
    loadCategoryOptions()
  }, [initialEntry.user_id])
```

注意：`entry` 在此 useEffect 执行时已由上方 `loadFull` useEffect 加载，两者都依赖 `initialEntry.id`/`user_id`，顺序上 `entry` 可能还是 `initialEntry`（简化版）。保险起见，把依赖数组改为 `[initialEntry.user_id, entry.id]` 确保 entry 更新后重新合并孤儿：

```js
  }, [initialEntry.user_id, entry.id])
```

- [ ] **Step 2：运行构建检查**

```bash
npm run build
```
预期：无报错。

---

### Task 3：SettingsPage.jsx — ✎ 重命名按钮 + handleRenameTag RPC 回写

**Files:**
- Modify: `src/pages/SettingsPage.jsx`

- [ ] **Step 1：新增 state 变量**

在第 51 行 `const [dragIndex, setDragIndex] = useState(null)` 之后插入：

```js
const [editingTagId, setEditingTagId] = useState(null)    // 当前正在编辑的标签 id
const [editingTagValue, setEditingTagValue] = useState('') // 编辑框当前值
```

- [ ] **Step 2：新增 handleRenameTag 函数**

在第 184 行 `handleDragEnd` 函数之后、`handleTest` 之前插入：

```js
// ── 内容大类标签：重命名 + 批量回写历史 entry ──────────────
async function handleRenameTag(tag) {
  const newValue = editingTagValue.trim()
  const oldValue = tag.option_value
  setEditingTagId(null)
  if (!newValue || newValue === oldValue) return

  // 1. 更新 user_options 显示名
  await db.from('user_options')
    .update({ option_value: newValue })
    .eq('id', tag.id)

  // 2. 批量回写所有历史 journal_entries（RPC 内部用 auth.uid()，无需传 user_id）
  await db.rpc('replace_category_tag', { p_old: oldValue, p_new: newValue })

  // 3. 刷新本地 state
  setTagOptions(prev =>
    prev.map(t => t.id === tag.id ? { ...t, option_value: newValue } : t)
  )
}
```

- [ ] **Step 3：在标签列表 JSX 中加入 ✎ 编辑按钮和内联输入框**

找到第 554–563 行的标签条目内部（`☰` 图标和 `−` 按钮之间），现有代码：

```jsx
<span style={{ fontSize: 16, color: '#ccc', cursor: 'grab', flexShrink: 0 }}>☰</span>
<span style={{ flex: 1, fontSize: 13, color: '#333', padding: '3px 10px', background: '#f5f3ef', borderRadius: 20, display: 'inline-block' }}>
  {tag.option_value}
</span>
<button
  onClick={() => handleDeleteTag(tag.id)}
  style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', border: '1px solid #e0dbd4', background: 'white', color: '#e57373', fontSize: 16, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
>
  −
</button>
```

替换为：

```jsx
<span style={{ fontSize: 16, color: '#ccc', cursor: 'grab', flexShrink: 0 }}>☰</span>

{/* 标签名：正常展示 or 内联编辑输入框 */}
{editingTagId === tag.id ? (
  <input
    autoFocus
    value={editingTagValue}
    onChange={e => setEditingTagValue(e.target.value)}
    onKeyDown={e => {
      if (e.key === 'Enter') handleRenameTag(tag)
      if (e.key === 'Escape') setEditingTagId(null)
    }}
    onBlur={() => handleRenameTag(tag)}
    style={{ flex: 1, border: '1px solid #c9a96e', borderRadius: 20, padding: '3px 10px', fontSize: 13, outline: 'none', background: 'white', fontFamily: 'inherit' }}
  />
) : (
  <span style={{ flex: 1, fontSize: 13, color: '#333', padding: '3px 10px', background: '#f5f3ef', borderRadius: 20, display: 'inline-block' }}>
    {tag.option_value}
  </span>
)}

{/* ✎ 编辑按钮 */}
<button
  onClick={() => { setEditingTagId(tag.id); setEditingTagValue(tag.option_value) }}
  style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', border: '1px solid #e0dbd4', background: 'white', color: '#c9a96e', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
>
  ✎
</button>

{/* − 删除按钮 */}
<button
  onClick={() => handleDeleteTag(tag.id)}
  style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', border: '1px solid #e0dbd4', background: 'white', color: '#e57373', fontSize: 16, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
>
  −
</button>
```

- [ ] **Step 4：运行构建检查**

```bash
npm run build
```
预期：无报错。

---

## 自检（Self-Review）

### Spec 覆盖检查

| Spec 要求 | 对应 Task |
|---|---|
| 搜索框为空时展示 30 条未关联 entry（时间倒序） | Task 1 Step 2 `loadDefaultEntries` |
| 滑到底追加 30 条（offset 分页） | Task 1 Step 2 `loadMore` + Step 6 加载更多按钮 |
| 排除已在 thread_entries 的 entry（含 removed_by_user=true） | Task 1 Step 2 `allExistingIds` 过滤 |
| 搜索覆盖 6 个字段（含 ::text cast + 通配符转义） | Task 1 Step 3 `doSearch` |
| 搜索结果上限 30 条，不分页 | Task 1 Step 3 `.limit(30)` |
| 添加后从默认列表移除 | Task 1 Step 7 |
| A1：user_options 为空时自动种入 11 个默认标签 | Task 2 Step 1 |
| B1：孤儿标签合并到 categoryOptions | Task 2 Step 1 `orphans` 逻辑 |
| ✎ 重命名按钮（− 左侧） | Task 3 Step 3 |
| 点 ✎ → 内联输入框预填当前值 → Enter/失焦保存，Esc 取消 | Task 3 Step 3 |
| 保存后更新 user_options + RPC 批量回写 journal_entries | Task 3 Step 2 `handleRenameTag` |
| RPC 函数在 DB 中已创建（Task 0 先执行） | Task 0 |

### Placeholder 扫描
无 TBD / TODO / 省略号占位。

### 类型一致性
- `handleRenameTag(tag)` 接收完整 tag 对象 `{ id, option_value, sort_order }`，与 `tagOptions` 数组元素类型一致。
- `db.rpc('replace_category_tag', { p_old, p_new })` 参数名与 Task 0 SQL 函数签名一致（无 `p_user_id`）。
- `loadDefaultEntries(offset)` 与 `loadMore` 调用链一致（`defaultOffset + 30`）。

---

### Task 4：构建验证 + 手动测试清单 + Commit

**Files:**
- 无新改动

- [ ] **Step 1：全量构建**

```bash
npm run build
```
预期：无 error，无 warning（可忽略 chunk size 提示）。

- [ ] **Step 2：启动开发服务器**

```bash
npm run dev
```

- [ ] **Step 3：手动验证清单（请用户逐项点一遍）**

| # | 操作 | 预期结果 |
|---|---|---|
| 1 | 进入任意一个已确认脉络 → 点「···」→「📝 编辑关联记录」 | 搜索框下方立即出现「未关联记录」列表（时间倒序，最多 30 条） |
| 2 | 在上述列表滑到底，点「加载更多」 | 追加下一批记录；若已无更多，按钮消失 |
| 3 | 搜索框输入「工作」 | 默认列表消失，出现搜索结果（命中 content / category_tags 等字段的记录） |
| 4 | 清空搜索框 | 搜索结果消失，默认列表重新出现 |
| 5 | 点 + 添加一条记录 | 该记录从默认列表和搜索结果中消失；关联记录列表顶部出现该记录 |
| 6 | 打开任意一条记录详情 → 点 Header 区 category_tags（内容大类）| 底部 sheet 出现标签列表（若新用户首次打开，应看到 11 个默认标签） |
| 7 | 找一条 AI 已打过某标签的记录（如「日常生活」），打开 category sheet | 该标签出现在列表中，可点选/取消 |
| 8 | 进入「我的」→「内容大类标签管理」→ 点任意标签左侧 ✎ 按钮 | 标签名变为可编辑输入框，预填当前值 |
| 9 | 修改标签名 → 按 Enter（或点外部失焦） | 标签名更新；打开之前有该标签的记录详情，Header 展示的标签名已同步 |
| 10 | 修改标签名 → 按 Esc | 输入框取消，标签名不变 |

- [ ] **Step 4：用户确认「没问题」后执行 commit**

```bash
git add src/pages/ThreadDetailPage.jsx src/components/RecordDetail.jsx src/pages/SettingsPage.jsx
git commit -m "fix: 编辑关联记录默认列表+6字段搜索；category_tags自动种入+孤儿标签+重命名RPC回写"
```

- [ ] **Step 5：用户确认上线后 push**

```bash
git push
```

Vercel 自动部署，约 1 分钟后线上生效。

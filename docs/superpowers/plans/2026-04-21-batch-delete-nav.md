# 批量多选删除 + 导航栏统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 长按进入多选模式批量删除日记条目，并将所有详情页「← 返回」统一为 `‹` 图标。

**Architecture:** RecordsPage 新增 `isSelecting` / `selectedIds` state，EntryCard 在多选模式下显示 checkbox 并切换选中；日期组标题出现两态「全选当天」按钮；顶部 header 在多选时切换为「取消 / 已选N条 / 删除」行。`deleteEntries` 批量函数新增到 journalService.js；删除前先并发清理 Storage 图片。返回按钮改动各自独立，直接 Edit 对应文件即可。

**Tech Stack:** React（useState / useRef）、Supabase（`.in('id', ids).delete()`）、imageStorage.js `deleteImage`

---

## 文件改动地图

| 文件 | 操作 |
|---|---|
| `src/lib/journalService.js` | 新增 `deleteEntries` 批量函数 |
| `src/pages/RecordsPage.jsx` | 多选 state + EntryCard checkbox + 日期组全选 + header 切换 + 删除 sheet |
| `src/components/RecordDetail.jsx` | 返回按钮 → `‹` |
| `src/pages/CandidateDetailPage.jsx` | 返回按钮 → `‹` |
| `src/pages/ThreadDetailPage.jsx` | 返回按钮 → `‹` |
| `src/components/ReviewLetterDetail.jsx` | 返回按钮 → `‹` |
| `src/pages/ReviewLetterListPage.jsx` | 返回按钮 → `‹` |
| `src/pages/ThreadsPage.jsx` | 返回按钮 → `‹` |

---

## Task 1：新增 `deleteEntries` 批量函数

**Files:**
- Modify: `src/lib/journalService.js`

- [ ] **Step 1：在 journalService.js 末尾追加函数**

打开 `src/lib/journalService.js`，在文件末尾（第 52 行 `deleteEntry` 之后）追加：

```js
// ─── 批量删除 ──────────────────────────────────────────────
// ids: string[]  userId: string
// 原子性：全删或全不删，CASCADE 联表在同一事务内执行
export function deleteEntries({ ids, userId }) {
  return supabase
    .from('journal_entries')
    .delete()
    .in('id', ids)
    .eq('user_id', userId)
}
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望输出：`built in ...`（无 error）

- [ ] **Step 3：Commit**

```bash
git add src/lib/journalService.js
git commit -m "feat: journalService 新增 deleteEntries 批量删除函数"
```

---

## Task 2：RecordsPage — 多选 state + EntryCard checkbox

**Files:**
- Modify: `src/pages/RecordsPage.jsx`（第 177–132 行区域）

### Step 1：在 RecordsPage 顶部新增两个 state

- [ ] 找到第 177 行 `export default function RecordsPage({ onOpenDetail, onOpenLetter, onOpenLetterList, onEdit }) {`，在 `const { user } = useAuth()` 之后插入：

```js
  // ── 多选模式 ────────────────────────────────────────────────
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
```

### Step 2：在 import 区新增 deleteEntries 和 deleteImage

- [ ] 找到第 7 行 `import { deleteEntry } from '../lib/journalService'`，改为：

```js
import { deleteEntry, deleteEntries } from '../lib/journalService'
```

- [ ] 找到第 6 行 `import { getImageUrl } from '../lib/imageStorage'`，改为：

```js
import { getImageUrl, deleteImage } from '../lib/imageStorage'
```

### Step 3：改造 EntryCard 组件接受多选 props

- [ ] 找到第 34 行 `function EntryCard({ entry, onOpen, onLongPress }) {`，改为：

```js
function EntryCard({ entry, onOpen, onLongPress, isSelecting, isSelected, onToggle }) {
```

- [ ] 找到 `handleClick` 函数（第 54–57 行）：

```js
  function handleClick() {
    if (didLongPress.current) { didLongPress.current = false; return }
    onOpen(entry)
  }
```

替换为：

```js
  function handleClick() {
    if (didLongPress.current) { didLongPress.current = false; return }
    if (isSelecting) { onToggle?.(entry.id); return }
    onOpen(entry)
  }
```

- [ ] 找到 EntryCard 最外层 `<div` 的 style（第 71–77 行），在 style 对象中追加 `outline` 高亮：

```jsx
      style={{
        background: isSelected ? '#fffbf0' : 'white',
        borderRadius: 12, padding: '12px 14px',
        marginBottom: 8, cursor: 'pointer',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        WebkitUserSelect: 'none', userSelect: 'none',
        display: 'flex', gap: 10, alignItems: 'flex-start',
        outline: isSelected ? '2px solid #c9a96e' : 'none',
        outlineOffset: -2,
      }}
```

- [ ] 在卡片最外层 `<div>` 内部、`{/* 左侧文字区 */}` **之前**插入 checkbox：

```jsx
      {/* 多选 checkbox */}
      {isSelecting && (
        <div style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          alignSelf: 'center',
          background: isSelected ? '#c9a96e' : 'none',
          border: isSelected ? 'none' : '1.5px solid #ddd',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {isSelected && (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 5.5L4.5 8L9 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      )}
```

- [ ] **验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

### Step 4：把多选 props 传给 EntryCard（RecordsPage 渲染处）

- [ ] 找到第 618–625 行渲染 `<EntryCard>` 的地方：

```jsx
              {group.items.map(item => (
                <EntryCard
                  key={item.id}
                  entry={item}
                  onOpen={onOpenDetail}
                  onLongPress={e => { setActionEntry(e); setConfirmDelete(false) }}
                />
              ))}
```

替换为：

```jsx
              {group.items.map(item => (
                <EntryCard
                  key={item.id}
                  entry={item}
                  onOpen={onOpenDetail}
                  onLongPress={e => {
                    if (isSelecting) return   // 已在多选模式，长按不重复触发
                    setIsSelecting(true)
                    setSelectedIds(new Set([e.id]))
                  }}
                  isSelecting={isSelecting}
                  isSelected={selectedIds.has(item.id)}
                  onToggle={id => setSelectedIds(prev => {
                    const next = new Set(prev)
                    next.has(id) ? next.delete(id) : next.add(id)
                    return next
                  })}
                />
              ))}
```

- [ ] **验证编译**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add src/pages/RecordsPage.jsx src/lib/journalService.js src/lib/imageStorage.js
git commit -m "feat: EntryCard 支持多选模式 checkbox + 长按进入多选"
```

---

## Task 3：RecordsPage — 日期组「全选当天」+ header 多选态

**Files:**
- Modify: `src/pages/RecordsPage.jsx`

### Step 1：日期组标题行加「全选当天」按钮

- [ ] 找到第 613–617 行渲染 group 日期标题的地方：

```jsx
            <div key={group.date} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#bbb', marginBottom: 8,
                letterSpacing: '0.5px' }}>
                {group.date}
              </div>
```

替换为：

```jsx
            <div key={group.date} style={{ marginBottom: 20 }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 8,
              }}>
                <div style={{ fontSize: 11, color: '#bbb', letterSpacing: '0.5px' }}>
                  {group.date}
                </div>
                {isSelecting && (() => {
                  const dayIds = group.items.map(i => i.id)
                  const allSelected = dayIds.every(id => selectedIds.has(id))
                  return (
                    <div
                      onClick={() => setSelectedIds(prev => {
                        const next = new Set(prev)
                        if (allSelected) {
                          dayIds.forEach(id => next.delete(id))
                        } else {
                          dayIds.forEach(id => next.add(id))
                        }
                        return next
                      })}
                      style={{
                        width: 18, height: 18, borderRadius: '50%', cursor: 'pointer',
                        background: allSelected ? '#c9a96e' : 'none',
                        border: allSelected ? 'none' : '1.5px solid #ddd',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {allSelected && (
                        <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                          <path d="M2 5.5L4.5 8L9 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                  )
                })()}
              </div>
```

### Step 2：顶部 header 在多选时切换为「取消 / 已选N条 / 删除」

- [ ] 找到第 452–472 行的 header `<div>`（包含「记录」标题和 🔍 按钮）：

```jsx
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px 10px',
          background: '#faf8f4', borderBottom: '1px solid #ede9e2',
        }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>记录</span>
          <button
            onClick={() => {
              if (showSearch) {
                setShowSearch(false)
                setFilteredEntries(null)
              } else {
                setShowSearch(true)
              }
            }}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 20, color: '#888', lineHeight: 1, padding: '0 2px' }}
          >
            {showSearch ? '✕' : '🔍'}
          </button>
        </div>
```

替换为：

```jsx
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px 10px',
          background: '#faf8f4', borderBottom: '1px solid #ede9e2',
        }}>
          {isSelecting ? (
            <>
              <button
                onClick={() => { setIsSelecting(false); setSelectedIds(new Set()) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14, color: '#888' }}
              >
                取消
              </button>
              <span style={{ fontSize: 14, color: '#555' }}>
                已选 {selectedIds.size} 条
              </span>
              <button
                onClick={() => selectedIds.size > 0 && setShowBatchDeleteConfirm(true)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14,
                  color: selectedIds.size > 0 ? '#c9a96e' : '#ccc',
                }}
              >
                删除
              </button>
            </>
          ) : (
            <>
              <span style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>记录</span>
              <button
                onClick={() => {
                  if (showSearch) {
                    setShowSearch(false)
                    setFilteredEntries(null)
                  } else {
                    setShowSearch(true)
                  }
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 20, color: '#888', lineHeight: 1, padding: '0 2px' }}
              >
                {showSearch ? '✕' : '🔍'}
              </button>
            </>
          )}
        </div>
```

### Step 3：新增 `showBatchDeleteConfirm` state

- [ ] 在 Task 2 Step 1 新增的两行 state 之后紧接着加一行：

```js
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false)
```

- [ ] **验证编译**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add src/pages/RecordsPage.jsx
git commit -m "feat: 多选模式 header 切换 + 全选当天按钮"
```

---

## Task 4：RecordsPage — 批量删除确认 sheet + 执行逻辑

**Files:**
- Modify: `src/pages/RecordsPage.jsx`

### Step 1：新增批量删除处理函数

- [ ] 找到第 389–394 行的 `handleDelete` 函数，在其**之后**插入：

```js
  async function handleBatchDelete() {
    // 1. 收集选中条目的所有图片路径
    const selectedEntries = allEntries.filter(e => selectedIds.has(e.id))
    const paths = selectedEntries.flatMap(e => e.image_urls ?? []).filter(Boolean)

    // 2. 并发清理 Storage（失败只 console.error，不阻塞）
    if (paths.length > 0) {
      await Promise.all(paths.map(p => deleteImage(p)))
    }

    // 3. 单次批量 DB 删除
    await deleteEntries({ ids: [...selectedIds], userId: user.id })

    // 4. 退出多选，刷新列表
    setShowBatchDeleteConfirm(false)
    setIsSelecting(false)
    setSelectedIds(new Set())
    load()
  }
```

### Step 2：在 JSX 末尾（`{/* pending_core_needs 处理卡片 */}` 之前）插入批量删除确认 sheet

- [ ] 找到第 736 行 `{/* pending_core_needs 处理卡片 */}`，在其**之前**插入：

```jsx
      {/* 批量删除确认 sheet */}
      {showBatchDeleteConfirm && (
        <div
          onClick={() => setShowBatchDeleteConfirm(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 210,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', background: 'white',
              borderRadius: '16px 16px 0 0',
              padding: '20px 0 env(safe-area-inset-bottom)',
            }}
          >
            <div style={{ padding: '0 20px 16px', fontSize: 15, color: '#333', fontWeight: 500 }}>
              删除 {selectedIds.size} 条记录？
            </div>
            <div style={{ padding: '0 20px 16px', fontSize: 13, color: '#999' }}>
              此操作不可恢复。
            </div>
            <button
              onClick={handleBatchDelete}
              style={{
                width: '100%', padding: '16px 20px', background: 'none',
                border: 'none', textAlign: 'left', fontSize: 15,
                color: '#e05252', cursor: 'pointer', fontWeight: 500,
                borderTop: '1px solid #f5f3ef',
              }}
            >
              确认删除
            </button>
            <button
              onClick={() => setShowBatchDeleteConfirm(false)}
              style={{
                width: '100%', padding: '16px 20px', background: 'none',
                border: 'none', textAlign: 'left', fontSize: 15,
                color: '#bbb', cursor: 'pointer',
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
```

- [ ] **验证编译**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add src/pages/RecordsPage.jsx
git commit -m "feat: 批量删除确认 sheet + Storage 图片清理 + 退出多选"
```

---

## Task 5：返回按钮统一为 `‹`

**Files:**
- Modify: `src/components/RecordDetail.jsx:543-551`
- Modify: `src/pages/CandidateDetailPage.jsx:67-70`
- Modify: `src/pages/ThreadDetailPage.jsx:313-315`
- Modify: `src/components/ReviewLetterDetail.jsx:33-37`
- Modify: `src/pages/ReviewLetterListPage.jsx:18-22`
- Modify: `src/pages/ThreadsPage.jsx:206`

所有改动都把现有 button 的文字内容和 style 替换成统一样式，`onBack` / `onClick` 保持不变。

统一样式：
```jsx
style={{
  background: 'none', border: 'none',
  color: '#bbb', cursor: 'pointer',
  fontSize: 20, fontWeight: 300,
  padding: '6px 8px', margin: '-6px -8px',
  lineHeight: 1,
}}
```
字符：`‹`（U+2039，单书名号）

---

- [ ] **Step 1：改 RecordDetail.jsx（第 543–551 行）**

找到：
```jsx
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: '#bbb', cursor: 'pointer', fontSize: 14,
          }}
        >
          ← 返回
        </button>
```

替换为：
```jsx
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: '#bbb', cursor: 'pointer',
            fontSize: 20, fontWeight: 300,
            padding: '6px 8px', margin: '-6px -8px',
            lineHeight: 1,
          }}
        >
          ‹
        </button>
```

---

- [ ] **Step 2：改 CandidateDetailPage.jsx（第 67–70 行）**

找到：
```jsx
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 14 }}>
          ← 脉络
        </button>
```

替换为：
```jsx
        <button onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: '#bbb', cursor: 'pointer',
            fontSize: 20, fontWeight: 300,
            padding: '6px 8px', margin: '-6px -8px',
            lineHeight: 1,
          }}>
          ‹
        </button>
```

---

- [ ] **Step 3：改 ThreadDetailPage.jsx（第 313–315 行）**

找到：
```jsx
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 14 }}>
          ← 脉络
        </button>
```

替换为：
```jsx
        <button onClick={onBack} style={{
          background: 'none', border: 'none',
          color: '#bbb', cursor: 'pointer',
          fontSize: 20, fontWeight: 300,
          padding: '6px 8px', margin: '-6px -8px',
          lineHeight: 1,
        }}>
          ‹
        </button>
```

---

- [ ] **Step 4：改 ReviewLetterDetail.jsx（第 33–37 行）**

找到：
```jsx
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 14 }}>
          ← 返回
        </button>
```

替换为：
```jsx
        <button onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: '#bbb', cursor: 'pointer',
            fontSize: 20, fontWeight: 300,
            padding: '6px 8px', margin: '-6px -8px',
            lineHeight: 1,
          }}>
          ‹
        </button>
```

---

- [ ] **Step 5：改 ReviewLetterListPage.jsx（第 18–22 行）**

找到：
```jsx
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 14, marginRight: 12 }}>
          ← 返回
        </button>
```

替换为：
```jsx
        <button onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: '#bbb', cursor: 'pointer',
            fontSize: 20, fontWeight: 300,
            padding: '6px 8px', margin: '-6px -8px',
            lineHeight: 1, marginRight: 4,
          }}>
          ‹
        </button>
```

---

- [ ] **Step 6：改 ThreadsPage.jsx（第 206 行）**

找到：
```jsx
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 14 }}>← 返回</button>
```

替换为：
```jsx
        <button onClick={onBack} style={{
          background: 'none', border: 'none',
          color: '#bbb', cursor: 'pointer',
          fontSize: 20, fontWeight: 300,
          padding: '6px 8px', margin: '-6px -8px',
          lineHeight: 1,
        }}>‹</button>
```

---

- [ ] **Step 7：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 8：Commit**

```bash
git add src/components/RecordDetail.jsx \
        src/pages/CandidateDetailPage.jsx \
        src/pages/ThreadDetailPage.jsx \
        src/components/ReviewLetterDetail.jsx \
        src/pages/ReviewLetterListPage.jsx \
        src/pages/ThreadsPage.jsx
git commit -m "feat: 所有返回按钮统一为 ‹ 图标（EditEntryPage 取消保留）"
```

---

## Task 6：验收与收尾

- [ ] **本地启动**

```bash
npm run dev
```

**手动验证清单（按 §4 验收标准）：**

批量多选：
1. 长按任意日记条目约 0.6 秒 → 进入多选模式，该条目自动选中，顶栏显示「取消 / 已选1条 / 删除（金色）」
2. 点击其他条目 → checkbox 切换，顶栏计数更新
3. 点日期组右侧圆圈 → 当天所有可见条目全选（圆圈变金色对勾）；再点 → 全取消
4. 打开 FilterBar 过滤，进入多选，点「全选当天」→ 只选过滤后可见的条目
5. 选中 N 条后点「删除」→ 底部弹出确认 sheet，显示「删除 N 条记录？此操作不可恢复。」
6. 点确认删除 → 条目消失，退出多选
7. 点「取消」→ 退出多选，条目不删
8. 回顾信固定卡片无 checkbox，点击正常跳转

返回按钮：
9. 进入脉络页 → 顶部左侧显示 `‹`（不含文字），点击正常返回
10. 进入详情、回顾信详情、候选脉络、回顾信列表页，同样都是 `‹`
11. EditEntryPage 顶部依然显示「取消」文字（确认未被改动）

- [ ] **等用户确认无问题后 commit 收尾**（代码已在上面各 Task commit，此步无额外 commit）

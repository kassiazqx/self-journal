# 回顾信详情页「相关脉络」展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 替换 ReviewLetterDetail 占位符，展示 AI 为本封信生成的候选脉络卡片，支持内嵌接受/忽略操作和跳转详情页。

**Architecture:** DB 新增 `threads.review_letter_id` 外键关联；`threadService.js` 新增 `fetchThreadsByLetterId`；`reviewLetterService.js` Step 7 写入该字段；`ReviewLetterDetail` 通过 `useAuth` 取 userId，加载并渲染脉络卡片，操作通过已有的 `updateThread` 完成；`MainLayout` 补传两个导航 prop。

**Tech Stack:** React useState/useEffect、Supabase JS client、useAuth（AuthContext）

---

## 文件改动地图

| 文件 | 改动 |
|---|---|
| Supabase DB | `threads` 表新增 `review_letter_id uuid` 列（Task 0，手动执行） |
| `src/lib/threadService.js` | 新增 `fetchThreadsByLetterId(letterId)` |
| `src/lib/reviewLetterService.js` | Step 7 insert thread 时写入 `review_letter_id` |
| `src/components/ReviewLetterDetail.jsx` | 新增 props、useAuth、threads 加载与卡片 UI |
| `src/components/MainLayout.jsx` | 补传 `onOpenCandidateDetail` / `onOpenThreadDetail` |

---

## Task 0：DB 迁移（⚠️ 阻塞，必须先于代码执行）

**操作：** 在 Supabase 控制台 → SQL Editor 执行：

```sql
ALTER TABLE threads
ADD COLUMN IF NOT EXISTS review_letter_id uuid
REFERENCES review_letters(id) ON DELETE SET NULL;
```

- [ ] **Step 1：在 Supabase SQL Editor 执行上述 SQL**

打开 https://supabase.com/dashboard/project/bmvojccasvrjzvqdrnse/sql，粘贴并运行。

期望：执行成功，无报错

- [ ] **Step 2：确认列已存在**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'threads' AND column_name = 'review_letter_id';
```

期望：返回一行

---

## Task 1：`threadService.js` 新增 `fetchThreadsByLetterId`

**Files:**
- Modify: `src/lib/threadService.js`（在现有函数末尾追加）

- [ ] **Step 1：追加函数**

在文件末尾追加：

```js
// 查询某封回顾信关联的候选脉络（通过 review_letter_id 外键）
export async function fetchThreadsByLetterId(letterId) {
  const { data, error } = await db.from('threads')
    .select('id, name, status, arc_summary')
    .eq('review_letter_id', letterId)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[fetchThreadsByLetterId]', error.message)
    return []
  }
  return data ?? []
}
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：Commit**

```bash
git add src/lib/threadService.js
git commit -m "feat: threadService 新增 fetchThreadsByLetterId"
```

---

## Task 2：`reviewLetterService.js` Step 7 写入 `review_letter_id`

**Files:**
- Modify: `src/lib/reviewLetterService.js:156-165`

- [ ] **Step 1：在 thread insert 里加入 `review_letter_id`**

找到第 156-165 行的 `db.from('threads').insert({...})`：

```js
    const { data: newThread, error: threadErr } = await db.from('threads')
      .insert({
        user_id: userId,
        name: t.thread_name.trim(),
        status: 'candidate',
        trigger_source: 'review',
        arc_summary: t.discovery_reason?.trim() || null,
        arc_updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()
```

替换为：

```js
    const { data: newThread, error: threadErr } = await db.from('threads')
      .insert({
        user_id: userId,
        name: t.thread_name.trim(),
        status: 'candidate',
        trigger_source: 'review',
        arc_summary: t.discovery_reason?.trim() || null,
        arc_updated_at: new Date().toISOString(),
        review_letter_id: letter.id,
      })
      .select('id')
      .single()
```

（`letter` 对象在 Step 5 第 120-130 行的 `.select('id').single()` 中已取得，在当前作用域可访问）

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：Commit**

```bash
git add src/lib/reviewLetterService.js
git commit -m "feat: 回顾信生成时写入 review_letter_id 到 threads 表"
```

---

## Task 3：`ReviewLetterDetail.jsx` 新增脉络卡片区域

**Files:**
- Modify: `src/components/ReviewLetterDetail.jsx`

- [ ] **Step 1：扩展 import 区**

找到第 3 行：
```js
import { useState, useEffect } from 'react'
import { db } from '../lib/db'
```

替换为：
```js
import { useState, useEffect } from 'react'
import { db } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { fetchThreadsByLetterId, updateThread } from '../lib/threadService'
```

- [ ] **Step 2：扩展函数签名，新增 state**

找到第 12 行：
```js
export default function ReviewLetterDetail({ letter: initialLetter, onBack, onOpenEntry }) {
  const [letter, setLetter] = useState(initialLetter)
```

替换为：
```js
export default function ReviewLetterDetail({ letter: initialLetter, onBack, onOpenEntry, onOpenCandidateDetail, onOpenThreadDetail }) {
  const { user } = useAuth()
  const [letter, setLetter] = useState(initialLetter)
  const [threads, setThreads] = useState([])
```

- [ ] **Step 3：新增 threads 加载 useEffect**

在现有的 `useEffect`（标记已读，第 16-23 行）之后插入：

```js
  // 加载本封信关联的候选脉络
  useEffect(() => {
    if (!letter?.id) return
    fetchThreadsByLetterId(letter.id).then(setThreads)
  }, [letter?.id])
```

- [ ] **Step 4：新增操作函数**

在 `return (` 之前插入：

```js
  async function handleAccept(thread) {
    if (!user) return
    await updateThread(thread.id, user.id, { status: 'confirmed' })
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, status: 'confirmed' } : t))
  }

  async function handleIgnore(thread) {
    if (!user) return
    await updateThread(thread.id, user.id, { status: 'rejected' })
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, status: 'rejected' } : t))
  }

  function handleCardClick(thread) {
    if (thread.status === 'candidate') {
      onOpenCandidateDetail?.(thread)
    } else if (thread.status === 'confirmed') {
      onOpenThreadDetail?.(thread)
    }
    // rejected：不可点击
  }
```

- [ ] **Step 5：替换占位符 JSX**

找到第 88-94 行的占位符：
```jsx
        {/* 相关 threads（占位，后续 threads 系统上线承接） */}
        <div style={{ borderTop: '1px solid #ede9e2', paddingTop: 16 }}>
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>相关 threads</div>
          <div style={{ fontSize: 12, color: '#bbb', lineHeight: 1.6 }}>
            后续 threads 系统上线后，从这里承接延展入口。
          </div>
        </div>
```

替换为：
```jsx
        {/* 相关脉络 */}
        {threads.length > 0 && (
          <div style={{ borderTop: '1px solid #ede9e2', paddingTop: 16 }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>AI 发现的规律 · 相关脉络</div>

            {threads.map(thread => {
              const isPending = thread.status === 'candidate'
              const isAccepted = thread.status === 'confirmed'
              const isIgnored = thread.status === 'rejected'

              return (
                <div
                  key={thread.id}
                  onClick={() => handleCardClick(thread)}
                  style={{
                    marginBottom: 10,
                    background: isAccepted ? '#f8fdf8' : isIgnored ? '#fafafa' : 'white',
                    border: `1px solid ${isAccepted ? '#d4edda' : isIgnored ? '#e8e8e8' : '#ede9e2'}`,
                    borderRadius: 14,
                    overflow: 'hidden',
                    opacity: isIgnored ? 0.7 : 1,
                    cursor: isIgnored ? 'default' : 'pointer',
                  }}
                >
                  {/* 卡片主体 */}
                  <div style={{ padding: '14px 14px 12px' }}>
                    {/* 名称 + 状态 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{
                        fontSize: 14, fontWeight: 600,
                        color: isIgnored ? '#aaa' : '#333',
                      }}>
                        {thread.name}
                      </span>
                      <span style={{
                        fontSize: 10, borderRadius: 4, padding: '1px 6px', fontWeight: 500,
                        color: isAccepted ? '#6aaa6a' : isIgnored ? '#bbb' : '#c9a96e',
                        background: isAccepted ? '#f0faf0' : isIgnored ? '#f5f5f5' : '#fdf5e6',
                        border: `1px solid ${isAccepted ? '#c8e6c8' : isIgnored ? '#e0e0e0' : '#f0e4cc'}`,
                      }}>
                        {isAccepted ? '已接受' : isIgnored ? '已忽略' : '待确认'}
                      </span>
                    </div>
                    {/* 发现理由 */}
                    {thread.arc_summary && (
                      <div style={{
                        fontSize: 12, color: isIgnored ? '#bbb' : '#888',
                        lineHeight: 1.65,
                        display: '-webkit-box', WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {thread.arc_summary}
                      </div>
                    )}
                  </div>

                  {/* 操作行 */}
                  {isPending && (
                    <div style={{
                      display: 'flex',
                      borderTop: '1px solid #f0ece6',
                    }}>
                      <button
                        onClick={e => { e.stopPropagation(); handleIgnore(thread) }}
                        style={{
                          flex: 1, height: 42, background: 'none', border: 'none',
                          borderRight: '1px solid #f0ece6',
                          fontSize: 13, color: '#bbb', cursor: 'pointer',
                        }}
                      >
                        忽略
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleAccept(thread) }}
                        style={{
                          flex: 1, height: 42, background: 'none', border: 'none',
                          fontSize: 13, color: '#c9a96e', fontWeight: 500, cursor: 'pointer',
                        }}
                      >
                        接受脉络
                      </button>
                    </div>
                  )}
                  {isAccepted && (
                    <div style={{
                      height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderTop: '1px solid #f0ece6', fontSize: 12, color: '#6aaa6a',
                    }}>
                      ✓ 已加入脉络追踪
                    </div>
                  )}
                  {isIgnored && (
                    <div style={{
                      height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderTop: '1px solid #f0ece6', fontSize: 12, color: '#ccc',
                    }}>
                      已忽略，不再追踪
                    </div>
                  )}
                </div>
              )
            })}

            {/* 全部处理完提示 */}
            {threads.every(t => t.status !== 'candidate') && (
              <div style={{ fontSize: 12, color: '#bbb', textAlign: 'center', padding: '4px 0 8px' }}>
                全部脉络已处理 · 可在「洞察」Tab 查看
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 6：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 7：Commit**

```bash
git add src/components/ReviewLetterDetail.jsx
git commit -m "feat: ReviewLetterDetail 替换占位符为相关脉络卡片（内嵌接受/忽略）"
```

---

## Task 4：`MainLayout.jsx` 补传两个导航 prop

**Files:**
- Modify: `src/components/MainLayout.jsx:182-187`

- [ ] **Step 1：补传 prop**

找到第 182-187 行：
```jsx
        <ReviewLetterDetail
          letter={screen.letter}
          onBack={pop}
          onOpenEntry={entryId => push({ type: 'detail', entry: { id: entryId } })}
        />
```

替换为：
```jsx
        <ReviewLetterDetail
          letter={screen.letter}
          onBack={pop}
          onOpenEntry={entryId => push({ type: 'detail', entry: { id: entryId } })}
          onOpenCandidateDetail={handleOpenCandidate}
          onOpenThreadDetail={thread => handleOpenThread(thread, 'view')}
        />
```

（`handleOpenCandidate` 在第 132 行，`handleOpenThread` 在第 127 行，均已存在）

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：Commit**

```bash
git add src/components/MainLayout.jsx
git commit -m "feat: MainLayout 给 ReviewLetterDetail 补传 onOpenCandidateDetail / onOpenThreadDetail"
```

---

## Task 5：本地验收

```bash
npm run dev
```

**验收清单：**

1. 打开一封有 AI 建议脉络的回顾信 → 底部出现「AI 发现的规律 · 相关脉络」区域和脉络卡片
2. 点「接受脉络」→ 卡片变绿，显示「✓ 已加入脉络追踪」，刷新后状态持久
3. 点「忽略」→ 卡片变灰 opacity 0.7，显示「已忽略，不再追踪」
4. 所有卡片处理完 → 底部出现「全部脉络已处理 · 可在「洞察」Tab 查看」
5. 点待确认卡片（非按钮区域）→ 跳转 CandidateDetailPage
6. 点已接受卡片 → 跳转 ThreadDetailPage
7. 已忽略卡片点击无反应
8. 无脉络的老信（`review_letter_id` 为 NULL 的 threads）→ 不显示此区域

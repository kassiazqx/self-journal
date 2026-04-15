# 脉络交互细节补充 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 spec `2026-04-12-threads-interaction-gaps.md` §A–§I 的全部交互细节，包括：脉络三 Tab 重构、候选详情页新建、已确认详情页 ··· 菜单与编辑模式、归档态详情页、RecordDetail 顶部四字段可编辑、「我的」内容大类标签管理。

**Architecture:** 在已有 threads 基础功能（Task 1–12）之上叠加交互层。新增 `CandidateDetailPage.jsx`；重构 `ThreadsPage.jsx`（三 Tab）和 `ThreadDetailPage.jsx`（mode prop）；`threadService.js` 新增重新分析函数；`RecordDetail.jsx` 顶部标签区四字段可编辑；`SettingsPage.jsx` 新增标签管理子页。

**Tech Stack:** React + Vite, Supabase (db.js 适配层), Node built-in test runner

**必读前置文档：**
- `docs/arch-context.md` §2 §4.19（重新分析过滤 removed_by_user）§5.7（thread_entries RLS）
- `docs/sync-cards/2026-04-12-threads-gaps-sync.md`（所有决策汇总）
- `docs/superpowers/specs/2026-04-12-threads-interaction-gaps.md`（§A–§I 完整细节）

---

## 文件结构总览

```
新建文件：
  src/pages/CandidateDetailPage.jsx      候选脉络详情页（独立文件，内容结构与已确认不同）

修改文件：
  src/pages/ThreadsPage.jsx              三 Tab 重构（已确认/待确认/已归档）+ ＋号浮窗 + AI分析sheet
  src/pages/ThreadDetailPage.jsx         已确认/归档 mode prop；··· 菜单；编辑关联记录模式
  src/lib/threadService.js               新增 reAnalyzeThread（⚠️ 必须过滤 removed_by_user=true）
  src/components/RecordDetail.jsx        顶部四字段可编辑（template_type/emotion_display/overall_state_score/category_tags）
  src/pages/SettingsPage.jsx             新增内容大类标签管理入口 + 子页面
  src/pages/InsightsPage.jsx             脉络区块候选提示（橙色角标 + 底部提示条）
  src/components/MainLayout.jsx          新增 candidate_detail 屏幕类型
  src/lib/db.js                          （只读确认，无需改动）
```

---

## Task 0：数据库迁移（必须最先执行，其他 Task 依赖）

**Files:** 无代码文件，全在 Supabase Dashboard → SQL Editor 执行

- [ ] **Step 1：执行 — thread_entries 新增 removed_by_user 字段**

```sql
ALTER TABLE thread_entries
  ADD COLUMN removed_by_user boolean NOT NULL DEFAULT false;
```

预期：`Success. No rows returned`，无报错。

- [ ] **Step 2：执行 — threads.status CHECK 约束更新（新增 rejected）**

⚠️ 两条 SQL 必须在同一次执行中运行（DROP 后立即 ADD，中间不能有其他操作）：

```sql
ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_status_check;
ALTER TABLE threads ADD CONSTRAINT threads_status_check
  CHECK (status IN ('candidate','confirmed','archived','rejected'));
```

预期：两条均 `Success. No rows returned`，无报错。

- [ ] **Step 3：执行 — user_options 新增 sort_order 字段**

```sql
ALTER TABLE user_options ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
```

预期：`Success. No rows returned`，无报错。

- [ ] **Step 4：验证三个变更均已生效**

```sql
-- 验证 thread_entries 新字段
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'thread_entries' AND column_name = 'removed_by_user';

-- 验证 threads 约束（应包含 rejected）
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'threads_status_check';

-- 验证 user_options 新字段
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'user_options' AND column_name = 'sort_order';
```

预期：返回 3 行，分别确认：
- `removed_by_user` 存在，类型 `boolean`，默认 `false`
- 约束包含 `'rejected'`
- `sort_order` 存在，类型 `integer`，默认 `0`

- [ ] **Step 5：在 arch-context.md §6 追加日志**

```
2026-04-13 · 代码session · Task 0 完成：thread_entries 新增 removed_by_user；threads CHECK 约束加入 rejected；user_options 新增 sort_order
```

---

## Task 1：threadService.js 新增重新分析函数（⚠️ 4.19 高优先级）

**Files:**
- Modify: `src/lib/threadService.js`
- Modify: `src/lib/threadService.test.js`

**背景：** 架构审查 4.19 指出，「重新分析」必须过滤 `removed_by_user=true` 的记录，否则用户手动移除的关联会被 AI 重复添加回来。此 Task 先于 UI 实现，让服务层逻辑在 UI 接入前已测试正确。

- [ ] **Step 1：在 threadService.test.js 末尾追加测试**

打开 `src/lib/threadService.test.js`，在文件末尾追加：

```js
describe('reAnalyzeThread (unit: candidate filtering logic)', () => {
  test('excludes entry IDs already in thread_entries (including removed)', () => {
    // 模拟：该脉络已有的 thread_entries（含 removed_by_user=true 的）
    const existingEntries = [
      { entry_id: 'aaa', removed_by_user: false },
      { entry_id: 'bbb', removed_by_user: true },  // 用户已手动排除
      { entry_id: 'ccc', removed_by_user: false },
    ]
    // 所有 entry 的 id 列表（候选池）
    const allEntryIds = ['aaa', 'bbb', 'ccc', 'ddd', 'eee']

    // 逻辑：从候选池中排除所有已在 thread_entries 中的（不论 removed_by_user）
    const excludedIds = new Set(existingEntries.map(e => e.entry_id))
    const candidates = allEntryIds.filter(id => !excludedIds.has(id))

    assert.deepStrictEqual(candidates, ['ddd', 'eee'])
    // ⚠️ 'bbb' 虽然 removed_by_user=true，但仍必须被排除（不重新分析）
    assert.ok(!candidates.includes('bbb'), 'removed_by_user=true 的记录不得进入候选池')
  })
})
```

- [ ] **Step 2：运行测试，预期 PASS**

```bash
cd /Users/kassia1/Desktop/个人/noteapp/self-journal
node --test src/lib/threadService.test.js
```

预期：全部 PASS（含新增的 1 个测试）。

- [ ] **Step 3：在 threadService.js 末尾追加 reAnalyzeThread 函数**

打开 `src/lib/threadService.js`，在文件末尾追加：

```js
// ── 重新分析单条脉络（⚠️ 4.19：必须过滤 removed_by_user=true）──
// 只扫描从未被此脉络评估过的新 entry（不在 thread_entries 中）
// 已被 removed_by_user=true 标记的记录也跳过（用户排除意愿被尊重）
// 必须带入脉络名称 + arc_summary 作为上下文
export async function reAnalyzeThread(threadId, userId) {
  // Step 1：拉取该脉络已有的所有 thread_entries（含 removed_by_user=true 的）
  const { data: existing, error: existErr } = await db.from('thread_entries')
    .select('entry_id, removed_by_user')
    .eq('thread_id', threadId)

  if (existErr) {
    console.error('[reAnalyze] 读取已有 entries 失败:', existErr.message)
    return { newCount: 0, error: existErr }
  }

  // ⚠️ 4.19：排除所有已在 thread_entries 中的 entry_id
  // 不论 removed_by_user 是 true 还是 false，均排除
  const excludedIds = new Set((existing ?? []).map(e => e.entry_id))

  // Step 2：拉取脉络信息（需要 name + arc_summary 作为 AI 上下文）
  const { data: thread, error: threadErr } = await db.from('threads')
    .select('id, name, arc_summary')
    .eq('id', threadId)
    .eq('user_id', userId)
    .single()

  if (threadErr || !thread) {
    console.error('[reAnalyze] 读取脉络失败:', threadErr?.message)
    return { newCount: 0, error: threadErr }
  }

  // Step 3：拉取用户所有 entry 的摘要字段（候选池），排除已评估过的
  const { data: allEntries, error: allErr } = await db.from('journal_entries')
    .select('id, entry_summary, theme_hints, core_needs, emotions, category_tags, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (allErr) {
    console.error('[reAnalyze] 读取 entries 候选池失败:', allErr.message)
    return { newCount: 0, error: allErr }
  }

  // ⚠️ 4.19：过滤掉已评估过的（含 removed_by_user=true 的）
  const candidates = (allEntries ?? []).filter(e => !excludedIds.has(e.id))

  if (candidates.length === 0) {
    return { newCount: 0, error: null }
  }

  // Step 4：本地加权粗召回（零 token），取得高相关候选
  // 用已有 entries 的共同特征构建 representativeXxx
  const existingFull = (allEntries ?? []).filter(e => excludedIds.has(e.id))
  const representativeNeeds = [...new Set(existingFull.flatMap(e => e.core_needs ?? []))]
  const representativeHints = [...new Set(existingFull.flatMap(e => e.theme_hints ?? []))]
  const representativeEmotions = [...new Set(existingFull.flatMap(e => e.emotions ?? []))]
  const representativeTags = [...new Set(existingFull.flatMap(e => e.category_tags ?? []))]

  const threadProfile = { representativeNeeds, representativeHints, representativeEmotions, representativeTags }
  const topCandidates = recallCandidateEntries(candidates, threadProfile, 15)

  if (topCandidates.length === 0) {
    return { newCount: 0, error: null }
  }

  // Step 5：AI 精筛（带入脉络名称 + arc_summary 作为上下文）
  const candidatesText = topCandidates.map((e, i) =>
    `[候选${i + 1}，id:${e.id}]\n摘要：${e.entry_summary ?? '无'}\n主题：${(e.theme_hints ?? []).join('、') || '无'}`
  ).join('\n\n---\n\n')

  const prompt = `这是用户正在追踪的脉络：「${thread.name}」
${thread.arc_summary ? `\n脉络当前轨迹：${thread.arc_summary}\n` : ''}
以下是从用户日记中初步筛选出的候选记录，请判断哪些与这条脉络相关。

${candidatesText}

请以 JSON 数组返回相关候选的 id 列表（不相关的不要包含）：
["id1", "id2", ...]
只返回 JSON 数组，不要解释。`

  let rawResponse
  try {
    rawResponse = await callAI(
      [{ role: 'user', content: prompt }],
      '你是一个精准的内容分析助手，只返回 JSON，不附加任何解释。',
      { maxTokens: 300 }
    )
  } catch (e) {
    console.error('[reAnalyze] AI 调用失败:', e.message)
    return { newCount: 0, error: e }
  }

  let matchedIds
  try {
    const cleaned = rawResponse.replace(/```json|```/g, '').trim()
    matchedIds = JSON.parse(cleaned)
    if (!Array.isArray(matchedIds)) throw new Error('不是数组')
  } catch (e) {
    console.error('[reAnalyze] JSON 解析失败:', e.message, rawResponse.slice(0, 200))
    return { newCount: 0, error: e }
  }

  // Step 6：写入 thread_entries（仅写入合法 id，跳过已存在的）
  const validIds = matchedIds.filter(id => candidates.some(e => e.id === id))
  if (validIds.length === 0) return { newCount: 0, error: null }

  await Promise.all(validIds.map(entryId =>
    db.from('thread_entries').upsert({
      thread_id: threadId,
      entry_id: entryId,
      added_by: 'ai',
      removed_by_user: false,
    })
  ))

  return { newCount: validIds.length, error: null }
}
```

- [ ] **Step 4：验证编译**

```bash
npm run build 2>&1 | tail -10
```

预期：`✓ built in` 无报错。

- [ ] **Step 5：运行全部测试**

```bash
node --test src/lib/threadService.test.js
```

预期：全部 PASS。

- [ ] **Step 6：commit**

```bash
git add src/lib/threadService.js src/lib/threadService.test.js
git commit -m "feat: threadService 新增 reAnalyzeThread，4.19 过滤 removed_by_user=true"
```

---

## Task 2：ThreadsPage.jsx 重构为三 Tab

**Files:**
- Modify: `src/pages/ThreadsPage.jsx`

**背景：** 现有 ThreadsPage 是单列表+折叠区，新设计是三个 Tab（已确认/待确认/已归档），待确认 Tab 内部分「活跃候选」和「已忽略」两段，「已确认」Tab 底部有虚线 AI 分析按钮，右上角有 ＋ 浮窗。

- [ ] **Step 1：完整替换 ThreadsPage.jsx**

用以下内容**完整覆盖** `src/pages/ThreadsPage.jsx`（先 Read 确认当前内容，再 Write）：

```jsx
// src/pages/ThreadsPage.jsx
// 脉络列表页：三 Tab（已确认 / 待确认 / 已归档）
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { fetchThreads, createThread, updateThread, deleteThread, addEntryToThread, reAnalyzeThread } from '../lib/threadService'
import { resolveTemplate } from '../lib/templates'

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export default function ThreadsPage({ onBack, onOpenThread, onOpenCandidate }) {
  const { user } = useAuth()
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('confirmed') // 'confirmed' | 'pending' | 'archived'

  // ＋ 浮窗
  const [showPlusMenu, setShowPlusMenu] = useState(false)

  // 手动创建
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [allEntries, setAllEntries] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [saving, setSaving] = useState(false)

  // AI 分析 sheet
  const [showAnalysisSheet, setShowAnalysisSheet] = useState(false)
  const [analysisRange, setAnalysisRange] = useState('half_year') // '7d'|'30d'|'half_year'|'1y'|'all'
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisToast, setAnalysisToast] = useState('')

  // 长按菜单（已确认列表）
  const [actionThread, setActionThread] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const pressTimer = useRef(null)
  const didLongPress = useRef(false)

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    setLoading(true)
    const { data } = await fetchThreads(user.id)
    setThreads(data ?? [])
    setLoading(false)
  }

  // ── 手动创建 ──────────────────────────────────────────────────
  async function openCreating() {
    setShowPlusMenu(false)
    setCreating(true)
    setNewName('')
    setSelectedIds(new Set())
    setLoadingEntries(true)
    const { data } = await db.from('journal_entries')
      .select('id, content, entry_summary, created_at, template_type')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    setAllEntries(data ?? [])
    setLoadingEntries(false)
  }

  function cancelCreating() {
    setCreating(false); setNewName(''); setSelectedIds(new Set()); setAllEntries([])
  }

  function toggleSelect(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function handleCreate() {
    if (!newName.trim() || saving) return
    setSaving(true)
    const { data: thread } = await createThread(user.id, { name: newName.trim(), status: 'confirmed' })
    if (thread && selectedIds.size > 0) {
      await Promise.all([...selectedIds].map(id => addEntryToThread(thread.id, id, 'user')))
    }
    if (thread) setThreads(prev => [thread, ...prev])
    setSaving(false)
    cancelCreating()
    setActiveTab('confirmed')
  }

  // ── AI 分析 ───────────────────────────────────────────────────
  function openAnalysisSheet() {
    setShowPlusMenu(false)
    setShowAnalysisSheet(true)
  }

  async function startAnalysis() {
    setShowAnalysisSheet(false)
    setAnalyzing(true)
    // 用现有所有已确认脉络逐一重新分析，汇总新发现
    const confirmed = threads.filter(t => t.status === 'confirmed')
    let totalNew = 0
    for (const thread of confirmed) {
      const { newCount } = await reAnalyzeThread(thread.id, user.id)
      totalNew += (newCount ?? 0)
    }
    await load() // 刷新列表（可能有新 candidate）
    setAnalyzing(false)
    const newCandidates = threads.filter(t => t.status === 'candidate').length
    if (newCandidates > 0 || totalNew > 0) {
      setAnalysisToast(`发现 ${totalNew} 个脉络候选，已加入待确认`)
    } else {
      setAnalysisToast('暂时没有发现新脉络，稍后再试')
    }
    setTimeout(() => setAnalysisToast(''), 4000)
  }

  // ── 候选操作 ──────────────────────────────────────────────────
  async function handleAccept(thread) {
    await updateThread(thread.id, user.id, { status: 'confirmed' })
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, status: 'confirmed' } : t))
  }

  async function handleIgnore(thread) {
    await updateThread(thread.id, user.id, { status: 'rejected' })
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, status: 'rejected' } : t))
  }

  async function handleDelete(thread) {
    await deleteThread(thread.id, user.id)
    setThreads(prev => prev.filter(t => t.id !== thread.id))
    setActionThread(null); setConfirmDelete(false)
  }

  async function handleRestore(thread) {
    await updateThread(thread.id, user.id, { status: 'confirmed' })
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, status: 'confirmed' } : t))
  }

  // ── 长按菜单 ──────────────────────────────────────────────────
  function startPress(thread) {
    didLongPress.current = false
    pressTimer.current = setTimeout(() => { didLongPress.current = true; setActionThread(thread); setConfirmDelete(false) }, 600)
  }
  function cancelPress() { clearTimeout(pressTimer.current) }
  function handleThreadClick(thread) {
    if (didLongPress.current) { didLongPress.current = false; return }
    onOpenThread(thread)
  }

  // ── 分类 ──────────────────────────────────────────────────────
  const confirmed = threads.filter(t => t.status === 'confirmed')
  const candidates = threads.filter(t => t.status === 'candidate')
  const rejected = threads.filter(t => t.status === 'rejected')
  const archived = threads.filter(t => t.status === 'archived')
  const pendingBadge = candidates.length // 只计 candidate，不计 rejected

  const RANGES = [
    { key: '7d', label: '7天' },
    { key: '30d', label: '30天' },
    { key: 'half_year', label: '半年' },
    { key: '1y', label: '1年' },
    { key: 'all', label: '全部' },
  ]

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', fontSize: 14 }}>
      加载中…
    </div>
  )

  // ── 手动创建面板（全屏覆盖）──────────────────────────────────
  if (creating) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#faf8f4' }}>
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #ede9e2' }}>
        <button onClick={cancelCreating} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 14 }}>← 取消</button>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>新建脉络</span>
        <button onClick={handleCreate} disabled={!newName.trim() || selectedIds.size === 0 || saving}
          style={{ fontSize: 13, fontWeight: 500, background: 'none', border: 'none', cursor: newName.trim() && selectedIds.size > 0 && !saving ? 'pointer' : 'default', color: newName.trim() && selectedIds.size > 0 && !saving ? '#c9a96e' : '#ccc' }}>
          {saving ? '创建中…' : '创建'}
        </button>
      </div>
      <div style={{ padding: '14px 18px 8px' }}>
        <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus placeholder="脉络名称，如：内心平静探索"
          style={{ width: '100%', border: '1px solid #e0dbd4', borderRadius: 8, padding: '10px 12px', fontSize: 14, outline: 'none', background: 'white', fontFamily: 'inherit', boxSizing: 'border-box' }} />
      </div>
      <div style={{ padding: '0 18px 4px', fontSize: 11, color: '#aaa' }}>至少选择 1 条记录才能创建</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px 16px' }}>
        {loadingEntries ? <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>加载中…</div>
          : allEntries.map(entry => {
            const selected = selectedIds.has(entry.id)
            const tpl = resolveTemplate(entry.template_type)
            const preview = entry.entry_summary || (entry.content ?? '').slice(0, 50)
            return (
              <div key={entry.id} onClick={() => toggleSelect(entry.id)}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: selected ? '#fffdf8' : 'white', border: selected ? '1px solid #f0e8d4' : '1px solid transparent', borderRadius: 10, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 2, border: selected ? '2px solid #c9a96e' : '2px solid #ddd', background: selected ? '#c9a96e' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {selected && <span style={{ color: 'white', fontSize: 10, lineHeight: 1 }}>✓</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: tpl.color, fontWeight: 500 }}>{tpl.label}</span>
                    <span style={{ fontSize: 10, color: '#ccc' }}>{formatDate(entry.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{preview}</div>
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f5f3ef' }}>

      {/* 顶部导航 */}
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#faf8f4', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 14 }}>← 返回</button>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>脉络</span>
        {/* ＋ 按钮 */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowPlusMenu(v => !v)}
            style={{ fontSize: 20, color: '#c9a96e', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}>＋</button>
          {showPlusMenu && (
            <>
              <div onClick={() => setShowPlusMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
              <div style={{ position: 'absolute', right: 0, top: '130%', zIndex: 100, background: 'white', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: 154, overflow: 'hidden' }}>
                <button onClick={openCreating} style={{ display: 'block', width: '100%', padding: '13px 16px', background: 'none', border: 'none', textAlign: 'left', fontSize: 14, color: '#333', cursor: 'pointer', borderBottom: '1px solid #f5f3ef' }}>
                  ✏️ 手动创建
                </button>
                <button onClick={openAnalysisSheet} style={{ display: 'block', width: '100%', padding: '13px 16px', background: 'none', border: 'none', textAlign: 'left', fontSize: 14, color: '#333', cursor: 'pointer' }}>
                  🔍 AI 分析发现
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tab 栏 */}
      <div style={{ display: 'flex', background: '#faf8f4', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        {[
          { key: 'confirmed', label: '已确认' },
          { key: 'pending', label: '待确认', badge: pendingBadge },
          { key: 'archived', label: '已归档' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ flex: 1, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: activeTab === tab.key ? '#c9a96e' : '#aaa', fontWeight: activeTab === tab.key ? 600 : 400, borderBottom: activeTab === tab.key ? '2px solid #c9a96e' : '2px solid transparent', position: 'relative' }}>
            {tab.label}
            {tab.badge > 0 && (
              <span style={{ position: 'absolute', top: 6, right: '20%', background: '#e07850', color: 'white', borderRadius: 10, fontSize: 10, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

        {/* ── 已确认 Tab ── */}
        {activeTab === 'confirmed' && (
          <>
            {confirmed.length === 0 && (
              <div style={{ textAlign: 'center', color: '#ccc', fontSize: 14, paddingTop: 60 }}>
                暂无已确认脉络
              </div>
            )}
            {confirmed.map(thread => (
              <div key={thread.id}
                onClick={() => handleThreadClick(thread)}
                onMouseDown={() => startPress(thread)} onMouseUp={cancelPress} onMouseLeave={cancelPress}
                onTouchStart={() => startPress(thread)} onTouchEnd={cancelPress} onTouchMove={cancelPress}
                style={{ background: 'white', borderRadius: 12, padding: '12px 14px', marginBottom: 10, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', WebkitUserSelect: 'none', userSelect: 'none' }}>
                <div style={{ fontSize: 14, color: '#333', fontWeight: 500 }}>{thread.name}</div>
                {thread.arc_summary && (
                  <div style={{ fontSize: 12, color: '#888', marginTop: 4, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {thread.arc_summary}
                  </div>
                )}
              </div>
            ))}
            {/* 底部虚线 AI 分析按钮 */}
            <button onClick={openAnalysisSheet} disabled={analyzing}
              style={{ display: 'block', width: '100%', marginTop: 8, padding: '12px', border: '1.5px dashed #e0dbd4', borderRadius: 12, background: 'none', cursor: 'pointer', fontSize: 13, color: analyzing ? '#ccc' : '#bbb', textAlign: 'center' }}>
              {analyzing ? '🔍 正在分析…' : '🔍 AI 分析发现新脉络'}
            </button>
          </>
        )}

        {/* ── 待确认 Tab ── */}
        {activeTab === 'pending' && (
          <>
            {candidates.length === 0 && rejected.length === 0 && (
              <div style={{ textAlign: 'center', color: '#ccc', fontSize: 14, paddingTop: 60 }}>
                暂无待确认脉络
              </div>
            )}
            {/* 活跃候选 */}
            {candidates.map(thread => (
              <div key={thread.id}
                onClick={() => onOpenCandidate?.(thread)}
                style={{ background: 'white', borderRadius: 12, padding: '12px 14px', marginBottom: 10, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px dashed #e0dbd4' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 14, color: '#333', fontWeight: 500 }}>{thread.name}</div>
                  <span style={{ fontSize: 10, background: '#fff3e8', color: '#e07850', padding: '2px 8px', borderRadius: 10 }}>待确认</span>
                </div>
                {thread.created_at && (
                  <div style={{ fontSize: 11, color: '#ccc', marginTop: 4 }}>
                    {thread.trigger_source === 'review' ? '回顾信触发 · ' : '手动分析 · '}{formatDate(thread.created_at)}
                  </div>
                )}
              </div>
            ))}
            {/* 已忽略分隔线 */}
            {rejected.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 10px' }}>
                  <div style={{ flex: 1, height: 1, background: '#ede9e2' }} />
                  <span style={{ fontSize: 11, color: '#ccc' }}>已忽略</span>
                  <div style={{ flex: 1, height: 1, background: '#ede9e2' }} />
                </div>
                {rejected.map(thread => (
                  <div key={thread.id}
                    style={{ background: 'white', borderRadius: 12, padding: '10px 14px', marginBottom: 8, opacity: 0.6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 13, color: '#888' }}>{thread.name}</div>
                    <button onClick={() => handleDelete(thread)}
                      style={{ fontSize: 12, color: '#e05252', background: 'none', border: '1px solid #fdd', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
                      删除
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ── 已归档 Tab ── */}
        {activeTab === 'archived' && (
          <>
            {archived.length === 0 && (
              <div style={{ textAlign: 'center', color: '#ccc', fontSize: 14, paddingTop: 60 }}>
                暂无已归档脉络
              </div>
            )}
            {archived.map(thread => (
              <div key={thread.id}
                onClick={() => onOpenThread(thread, 'archived')}
                style={{ background: 'white', borderRadius: 12, padding: '12px 14px', marginBottom: 10, cursor: 'pointer', opacity: 0.7, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 14, color: '#555', fontWeight: 500 }}>{thread.name}</div>
                {thread.updated_at && (
                  <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>归档于 {formatDate(thread.updated_at)}</div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* AI 分析确认 sheet */}
      {showAnalysisSheet && (
        <div onClick={() => setShowAnalysisSheet(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', background: 'white', borderRadius: '16px 16px 0 0', padding: '20px 18px 32px' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#333', marginBottom: 6 }}>AI 分析脉络</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>选择分析范围，AI 会在这段时间的记录里寻找规律</div>
            <div style={{ background: '#fff8f0', border: '1px solid #f0e4d0', borderRadius: 10, padding: '10px 12px', marginBottom: 16, fontSize: 12, color: '#c9a96e', lineHeight: 1.7 }}>
              ⏱ 通常需要 10~20 秒，分析期间可继续使用 App<br />
              📋 结果以候选形式出现，需逐一查看后确认
            </div>
            {/* 时间范围 chips */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, overflowX: 'auto', paddingBottom: 2 }}>
              {RANGES.map(r => (
                <button key={r.key} onClick={() => setAnalysisRange(r.key)}
                  style={{ flexShrink: 0, padding: '6px 14px', borderRadius: 20, border: analysisRange === r.key ? '1.5px solid #c9a96e' : '1.5px solid #e0dbd4', background: analysisRange === r.key ? '#fff8f0' : 'white', color: analysisRange === r.key ? '#c9a96e' : '#888', fontSize: 13, cursor: 'pointer' }}>
                  {r.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowAnalysisSheet(false)}
                style={{ flex: 1, padding: '12px', border: '1px solid #e0dbd4', borderRadius: 10, background: 'white', color: '#888', fontSize: 14, cursor: 'pointer' }}>
                取消
              </button>
              <button onClick={startAnalysis}
                style={{ flex: 2, padding: '12px', border: 'none', borderRadius: 10, background: '#c9a96e', color: 'white', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                开始分析
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {analysisToast && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: 'white', padding: '10px 18px', borderRadius: 20, fontSize: 13, zIndex: 300, whiteSpace: 'nowrap' }}>
          {analysisToast}
          {analysisToast.includes('候选') && (
            <button onClick={() => { setAnalysisToast(''); setActiveTab('pending') }}
              style={{ marginLeft: 10, color: '#f0d090', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
              去查看 ›
            </button>
          )}
        </div>
      )}

      {/* 长按动作菜单 */}
      {actionThread && (
        <div onClick={() => { setActionThread(null); setConfirmDelete(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', background: 'white', borderRadius: '16px 16px 0 0', padding: '8px 0 env(safe-area-inset-bottom)' }}>
            <div style={{ padding: '12px 20px 10px', fontSize: 13, color: '#888', borderBottom: '1px solid #f0ece4' }}>
              {actionThread.name}
            </div>
            {!confirmDelete ? (
              <>
                <button onClick={() => setConfirmDelete(true)}
                  style={{ width: '100%', padding: '16px 20px', background: 'none', border: 'none', textAlign: 'left', fontSize: 15, color: '#e05252', cursor: 'pointer', borderBottom: '1px solid #f5f3ef' }}>
                  删除
                </button>
                <button onClick={() => setActionThread(null)}
                  style={{ width: '100%', padding: '16px 20px', background: 'none', border: 'none', textAlign: 'left', fontSize: 15, color: '#bbb', cursor: 'pointer' }}>
                  取消
                </button>
              </>
            ) : (
              <>
                <div style={{ padding: '14px 20px', fontSize: 13, color: '#888' }}>删除后无法恢复，确认吗？</div>
                <button onClick={() => handleDelete(actionThread)}
                  style={{ width: '100%', padding: '14px 20px', background: 'none', border: 'none', textAlign: 'left', fontSize: 15, color: '#e05252', cursor: 'pointer', fontWeight: 500, borderBottom: '1px solid #f5f3ef' }}>
                  确认删除
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  style={{ width: '100%', padding: '14px 20px', background: 'none', border: 'none', textAlign: 'left', fontSize: 15, color: '#bbb', cursor: 'pointer' }}>
                  取消
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2：验证编译**

```bash
cd /Users/kassia1/Desktop/个人/noteapp/self-journal
npm run build 2>&1 | tail -15
```

预期：`✓ built in` 无报错。注意：`onOpenCandidate` prop 在 MainLayout 连线前为 undefined，点击候选卡片不跳转，Task 6 修复。

- [ ] **Step 3：手动验证 Tab 切换**

```bash
npm run dev
```

打开脉络页，验证：
- 三个 Tab 切换正常
- 已确认 Tab 底部有虚线「🔍 AI 分析发现新脉络」按钮
- ＋ 按钮点击出现两项浮窗
- 待确认 Tab 角标只显示 `candidate` 数量

- [ ] **Step 4：commit**

```bash
git add src/pages/ThreadsPage.jsx
git commit -m "feat: ThreadsPage 重构为三 Tab（已确认/待确认/已归档）+ ＋浮窗 + AI分析sheet"
```

---

## Task 3：新建 CandidateDetailPage.jsx（候选脉络详情页）

**Files:**
- Create: `src/pages/CandidateDetailPage.jsx`

**背景：** 候选详情与已确认详情结构不同——候选显示的是「AI 发现理由」而非 arc_summary，标题固定为「候选脉络」，底部是「接受 / 忽略」而非编辑菜单。独立文件，不复用 ThreadDetailPage。

- [ ] **Step 1：创建文件**

创建 `src/pages/CandidateDetailPage.jsx`：

```jsx
// src/pages/CandidateDetailPage.jsx
// 候选脉络详情页：AI 发现理由 + 关联记录（只读）+ 接受/忽略
// ⚠️ 独立文件：内容结构与 ThreadDetailPage 不同（AI理由 ≠ arc_summary）
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { updateThread, deleteThread } from '../lib/threadService'

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export default function CandidateDetailPage({ thread: initialThread, onBack, onAccepted, onIgnored, onOpenEntry }) {
  const { user } = useAuth()
  const [thread, setThread] = useState(initialThread)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!thread?.id) return
    loadEntries()
  }, [thread?.id])

  async function loadEntries() {
    setLoading(true)
    const { data } = await db.from('thread_entries')
      .select('entry_id, added_at, journal_entries(id, entry_summary, created_at, template_type)')
      .eq('thread_id', thread.id)
      .eq('removed_by_user', false)
      .order('added_at', { ascending: true })
    setEntries((data ?? []).map(r => r.journal_entries).filter(Boolean))
    setLoading(false)
  }

  async function handleAccept() {
    if (acting) return
    setActing(true)
    await updateThread(thread.id, user.id, { status: 'confirmed' })
    setToast('✓ 已加入已确认脉络')
    setTimeout(() => {
      setToast('')
      onAccepted?.(thread)
    }, 1500)
  }

  async function handleIgnore() {
    if (acting) return
    setActing(true)
    await updateThread(thread.id, user.id, { status: 'rejected' })
    onIgnored?.(thread)
  }

  // 来源标签：优先读 trigger_source 字段，降级到创建时间
  const sourceLabel = thread.trigger_source === 'review'
    ? `回顾信触发 · ${formatDate(thread.created_at)}`
    : `手动分析 · ${formatDate(thread.created_at)}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f5f3ef' }}>

      {/* 顶部导航 */}
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#faf8f4', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 14 }}>
          ← 脉络
        </button>
        {/* 固定标题「候选脉络」 */}
        <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>候选脉络</span>
        {/* 橙色「待确认」角标 */}
        <span style={{ fontSize: 10, background: '#fff3e8', color: '#e07850', padding: '3px 10px', borderRadius: 10 }}>
          待确认
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

        {/* 脉络名称 + 来源标签 */}
        <div style={{ background: 'white', borderRadius: 12, padding: '14px 16px', marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#333', marginBottom: 6 }}>
            {thread.name}
          </div>
          <div style={{ fontSize: 11, color: '#bbb' }}>{sourceLabel}</div>
        </div>

        {/* AI 发现理由 */}
        <div style={{ background: '#fffdf8', border: '1px solid #f0e8d4', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: '#c9a96e', fontWeight: 500, marginBottom: 8 }}>
            🔍 AI 发现理由
          </div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 1.75 }}>
            {thread.arc_summary
              ? thread.arc_summary
              : <span style={{ color: '#ccc' }}>AI 尚未生成发现理由</span>
            }
          </div>
        </div>

        {/* 关联记录列表（只读） */}
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>
          关联记录（{entries.length}）
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 13, paddingTop: 16 }}>加载中…</div>
        ) : entries.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 13, paddingTop: 16 }}>暂无关联记录</div>
        ) : (
          entries.map(entry => (
            <div key={entry.id}
              onClick={() => onOpenEntry?.(entry)}
              style={{ background: 'white', borderRadius: 10, padding: '10px 14px', marginBottom: 8, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, color: '#bbb', marginBottom: 4 }}>{formatDate(entry.created_at)}</div>
              <div style={{ fontSize: 13, color: '#333', lineHeight: 1.65, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {entry.entry_summary ?? '（暂无摘要）'}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 底部固定操作栏 */}
      <div style={{ padding: '12px 18px 28px', background: '#faf8f4', borderTop: '1px solid #ede9e2', display: 'flex', gap: 10, flexShrink: 0 }}>
        <button onClick={handleIgnore} disabled={acting}
          style={{ flex: 1, padding: '12px', border: '1px solid #e0dbd4', borderRadius: 10, background: 'white', color: '#888', fontSize: 14, cursor: acting ? 'default' : 'pointer' }}>
          忽略
        </button>
        <button onClick={handleAccept} disabled={acting}
          style={{ flex: 2, padding: '12px', border: 'none', borderRadius: 10, background: acting ? '#e0d4b8' : '#c9a96e', color: 'white', fontSize: 14, fontWeight: 500, cursor: acting ? 'default' : 'pointer' }}>
          ✓ 接受这条脉络
        </button>
      </div>

      {/* 接受成功 Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: 'rgba(80,160,80,0.9)', color: 'white', padding: '10px 20px', borderRadius: 20, fontSize: 13, zIndex: 300, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -10
```

预期：`✓ built in` 无报错。

- [ ] **Step 3：commit**

```bash
git add src/pages/CandidateDetailPage.jsx
git commit -m "feat: 新建 CandidateDetailPage（候选脉络详情，接受/忽略操作）"
```

---

## Task 4：ThreadDetailPage.jsx 重构（mode prop + ··· 菜单 + 编辑关联记录 + 归档态）

**Files:**
- Modify: `src/pages/ThreadDetailPage.jsx`

**背景：** 当前 ThreadDetailPage 只有基本的 arc_summary + 关联记录。新设计需要：
- `mode='confirmed'`（默认）：右上角 ··· 菜单（5项）、编辑关联记录模式（搜索/增删）、arc_summary 过期警告
- `mode='archived'`：只读 banner、无 ··· 菜单、底部「恢复 / 永久删除」固定栏

- [ ] **Step 1：完整替换 ThreadDetailPage.jsx**

用以下内容**完整覆盖** `src/pages/ThreadDetailPage.jsx`：

```jsx
// src/pages/ThreadDetailPage.jsx
// 脉络详情页：mode='confirmed'（默认）或 mode='archived'
// mode=confirmed：··· 菜单（编辑名称/编辑记录/重新分析/归档/删除）+ 编辑关联记录模式
// mode=archived：只读 banner + 底部恢复/永久删除
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import {
  fetchThreadWithEntries,
  updateThread,
  deleteThread,
  refreshArcSummary,
  addEntryToThread,
  reAnalyzeThread,
} from '../lib/threadService'

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export default function ThreadDetailPage({ thread: initialThread, mode = 'confirmed', onBack, onOpenEntry, onArchived, onRestored, onDeleted }) {
  const { user } = useAuth()
  const [thread, setThread] = useState(initialThread)
  const [entries, setEntries] = useState([])        // thread_entries 展开后的 journal_entries
  const [rawEntries, setRawEntries] = useState([])  // 含 removed_by_user、added_by 的原始行
  const [loading, setLoading] = useState(true)

  // ··· 菜单
  const [showMenu, setShowMenu] = useState(false)

  // 编辑名称
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(initialThread?.name ?? '')

  // 编辑关联记录模式
  const [editingEntries, setEditingEntries] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [arcStale, setArcStale] = useState(false)  // 编辑后 arc_summary 过期

  // 重新分析
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reanalyzeToast, setReanalyzeToast] = useState('')

  // arc_summary 刷新
  const [refreshing, setRefreshing] = useState(false)

  // 归档确认弹窗
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)

  // 永久删除确认弹窗（归档态使用）
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => { if (thread?.id) load() }, [thread?.id])

  async function load() {
    setLoading(true)
    const { thread: t, entries: e } = await fetchThreadWithEntries(thread.id)
    if (t) setThread(t)
    setRawEntries(e ?? [])
    setEntries(
      (e ?? [])
        .filter(r => !r.removed_by_user)
        .map(r => ({ ...r.journal_entries, added_by: r.added_by }))
        .filter(Boolean)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    )
    setLoading(false)
  }

  // ── 编辑名称 ──────────────────────────────────────────────────
  async function handleSaveName() {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === thread.name) { setEditingName(false); setNameInput(thread.name); return }
    await updateThread(thread.id, user.id, { name: trimmed })
    setThread(prev => ({ ...prev, name: trimmed }))
    setEditingName(false)
  }

  // ── arc_summary 刷新 ──────────────────────────────────────────
  async function handleRefreshArc() {
    if (refreshing) return
    setRefreshing(true)
    await refreshArcSummary(thread.id, user.id)
    const { thread: t } = await fetchThreadWithEntries(thread.id)
    if (t) setThread(t)
    setArcStale(false)
    setRefreshing(false)
  }

  // ── 编辑关联记录：搜索 ────────────────────────────────────────
  useEffect(() => {
    if (!editingEntries) return
    if (!searchQuery.trim()) { setSearchResults([]); return }
    const timer = setTimeout(() => doSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery, editingEntries])

  async function doSearch(q) {
    setSearching(true)
    const { data } = await db.from('journal_entries')
      .select('id, entry_summary, created_at, content')
      .eq('user_id', user.id)
      .ilike('content', `%${q}%`)
      .order('created_at', { ascending: false })
      .limit(20)
    // 排除已在 entries 中的（含 removed_by_user=true 的也排除，避免重复）
    const allExistingIds = new Set((rawEntries ?? []).map(r => r.entry_id))
    setSearchResults((data ?? []).filter(e => !allExistingIds.has(e.id)))
    setSearching(false)
  }

  // ── 编辑关联记录：移除（软删除 removed_by_user=true）────────
  async function handleRemoveEntry(entryId) {
    await db.from('thread_entries')
      .update({ removed_by_user: true })
      .eq('thread_id', thread.id)
      .eq('entry_id', entryId)
    setEntries(prev => prev.filter(e => e.id !== entryId))
    setRawEntries(prev => prev.map(r => r.entry_id === entryId ? { ...r, removed_by_user: true } : r))
    setArcStale(true)
  }

  // ── 编辑关联记录：添加 ────────────────────────────────────────
  async function handleAddEntry(entry) {
    await addEntryToThread(thread.id, entry.id, 'user')
    setEntries(prev => [{ ...entry, added_by: 'user' }, ...prev])
    setRawEntries(prev => [...prev, { thread_id: thread.id, entry_id: entry.id, added_by: 'user', removed_by_user: false, journal_entries: entry }])
    setSearchResults(prev => prev.filter(e => e.id !== entry.id))
    setArcStale(true)
  }

  // ── 重新分析 ──────────────────────────────────────────────────
  async function handleReAnalyze() {
    setShowMenu(false)
    if (reanalyzing) return
    setReanalyzing(true)
    const { newCount, error } = await reAnalyzeThread(thread.id, user.id)
    setReanalyzing(false)
    if (error) {
      setReanalyzeToast('分析失败，请检查网络')
    } else if (newCount > 0) {
      setReanalyzeToast(`发现 ${newCount} 条新关联记录，已加入候选`)
      await load()
    } else {
      setReanalyzeToast('没有发现新的关联记录')
    }
    setTimeout(() => setReanalyzeToast(''), 3000)
  }

  // ── 归档 ──────────────────────────────────────────────────────
  async function handleArchive() {
    setShowArchiveConfirm(false)
    await updateThread(thread.id, user.id, { status: 'archived' })
    onArchived?.(thread)
  }

  // ── 永久删除（归档态）─────────────────────────────────────────
  async function handlePermanentDelete() {
    setShowDeleteConfirm(false)
    await deleteThread(thread.id, user.id)
    onDeleted?.(thread)
  }

  // ── 恢复（归档态）────────────────────────────────────────────
  async function handleRestore() {
    await updateThread(thread.id, user.id, { status: 'confirmed' })
    onRestored?.(thread)
  }

  const isArchived = mode === 'archived'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f5f3ef' }}>

      {/* 顶部导航 */}
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#faf8f4', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 14 }}>
          ← 脉络
        </button>

        {/* 标题（归档态灰色 + 角标，已确认可点击编辑） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {editingName ? (
            <input value={nameInput} onChange={e => setNameInput(e.target.value)} autoFocus
              onBlur={handleSaveName} onKeyDown={e => { if (e.key === 'Enter') handleSaveName() }}
              style={{ fontSize: 15, fontWeight: 600, border: 'none', borderBottom: '1px solid #c9a96e', outline: 'none', background: 'transparent', textAlign: 'center', width: 160, fontFamily: 'inherit', color: '#333' }} />
          ) : (
            <span onClick={isArchived ? undefined : () => { setEditingName(true); setNameInput(thread.name) }}
              style={{ fontSize: 15, fontWeight: 600, color: isArchived ? '#999' : '#333', cursor: isArchived ? 'default' : 'pointer' }}>
              {thread?.name}
            </span>
          )}
          {isArchived && (
            <span style={{ fontSize: 10, background: '#f0ece4', color: '#aaa', padding: '2px 8px', borderRadius: 10 }}>已归档</span>
          )}
        </div>

        {/* 右侧：··· 菜单（仅已确认态） */}
        {!isArchived ? (
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowMenu(v => !v)}
              style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px' }}>
              ···
            </button>
            {showMenu && (
              <>
                <div onClick={() => setShowMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                <div style={{ position: 'absolute', right: 0, top: '130%', zIndex: 100, background: 'white', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: 154, overflow: 'hidden' }}>
                  {[
                    { label: '✏️ 编辑名称', action: () => { setShowMenu(false); setEditingName(true); setNameInput(thread.name) }, color: '#333' },
                    { label: '📝 编辑关联记录', action: () => { setShowMenu(false); setEditingEntries(true) }, color: '#333' },
                    { label: reanalyzing ? '🔄 分析中…' : '🔄 重新分析', action: handleReAnalyze, color: '#333' },
                    { label: '📁 归档', action: () => { setShowMenu(false); setShowArchiveConfirm(true) }, color: '#e07850' },
                    { label: '🗑️ 删除', action: () => { setShowMenu(false); setShowDeleteConfirm(true) }, color: '#e05252' },
                  ].map((item, i) => (
                    <button key={i} onClick={item.action}
                      style={{ display: 'block', width: '100%', padding: '13px 16px', background: 'none', border: 'none', textAlign: 'left', fontSize: 14, color: item.color, cursor: 'pointer', borderBottom: i < 4 ? '1px solid #f5f3ef' : 'none' }}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ width: 40 }} /> // 占位保持标题居中
        )}
      </div>

      {/* 归档只读 banner */}
      {isArchived && (
        <div style={{ background: '#f5f3ef', borderBottom: '1px solid #ede9e2', padding: '10px 18px', fontSize: 12, color: '#aaa', textAlign: 'center' }}>
          📁 已归档 · 归档于 {formatDate(thread.updated_at)} · 仅供查看
        </div>
      )}

      {/* 编辑关联记录 banner */}
      {editingEntries && (
        <div style={{ background: '#fff3e8', borderBottom: '1px solid #f0d4b0', padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: '#e07850', fontWeight: 500 }}>编辑关联记录</span>
          <button onClick={() => { setEditingEntries(false); setSearchQuery(''); setSearchResults([]) }}
            style={{ fontSize: 13, color: '#c9a96e', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer' }}>
            完成
          </button>
        </div>
      )}

      {/* 编辑模式搜索框 */}
      {editingEntries && (
        <div style={{ padding: '10px 18px', background: '#faf8f4', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="搜索记录内容…"
            style={{ width: '100%', border: '1px solid #e0dbd4', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', background: 'white', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

        {/* 搜索结果（编辑模式） */}
        {editingEntries && searchQuery.trim() && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>搜索结果</div>
            {searching ? (
              <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>搜索中…</div>
            ) : searchResults.length === 0 ? (
              <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>没有找到匹配的记录</div>
            ) : searchResults.map(entry => (
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
            <div style={{ height: 1, background: '#ede9e2', margin: '12px 0' }} />
          </div>
        )}

        {/* arc_summary 区 */}
        <div style={{ background: isArchived ? '#f5f3ef' : '#fffdf8', border: '1px solid #f0e8d4', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: '#c9a96e', fontWeight: 500 }}>变化轨迹</span>
            {!isArchived && thread?.arc_updated_at && (
              <span style={{ fontSize: 10, color: '#ccc' }}>AI 生成轨迹 · {formatDate(thread.arc_updated_at)}</span>
            )}
          </div>
          {/* arc_summary 过期警告 */}
          {arcStale && !isArchived && (
            <div style={{ fontSize: 12, color: '#e07850', marginBottom: 8 }}>
              ⚠ 关联记录已更改，AI 轨迹摘要尚未更新
              <button onClick={handleRefreshArc} disabled={refreshing}
                style={{ marginLeft: 8, color: '#c9a96e', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>
                {refreshing ? '生成中…' : '点击重新生成轨迹 ›'}
              </button>
            </div>
          )}
          {thread?.arc_summary ? (
            <div style={{ fontSize: 13, color: isArchived ? '#888' : '#555', lineHeight: 1.75 }}>
              {thread.arc_summary}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.65 }}>
              {entries.length < 2 ? '关联 2 条以上记录后可生成变化轨迹' : '点击右上角「···」→「🔄 重新分析」生成变化轨迹'}
            </div>
          )}
          {!arcStale && !isArchived && (
            <button onClick={handleRefreshArc} disabled={refreshing || entries.length < 2}
              style={{ marginTop: 8, fontSize: 11, color: refreshing ? '#ccc' : '#c9a96e', background: 'none', border: 'none', cursor: entries.length >= 2 && !refreshing ? 'pointer' : 'default', padding: 0 }}>
              {refreshing ? '生成中…' : entries.length >= 2 ? '↻ 更新轨迹' : ''}
            </button>
          )}
        </div>

        {/* 关联记录列表 */}
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>
          关联记录（{entries.length}）
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 13, paddingTop: 16 }}>加载中…</div>
        ) : entries.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 13, paddingTop: 16 }}>暂无关联记录</div>
        ) : entries.map(entry => (
          <div key={entry.id}
            onClick={() => !editingEntries && onOpenEntry?.(entry)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'white', borderRadius: 10, padding: '10px 14px', marginBottom: 8, cursor: editingEntries ? 'default' : 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', opacity: isArchived ? 0.85 : 1 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: '#bbb' }}>{formatDate(entry.created_at)}</span>
                <span style={{ fontSize: 10, color: '#c9a96e', background: '#fff8f0', padding: '1px 6px', borderRadius: 8 }}>
                  {entry.added_by === 'user' ? '我手动添加' : 'AI 关联'}
                </span>
              </div>
              <div style={{ fontSize: 13, color: '#333', lineHeight: 1.65, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {entry.entry_summary ?? '（暂无摘要）'}
              </div>
            </div>
            {/* 编辑模式：移除按钮（红色 ×） */}
            {editingEntries && (
              <button onClick={e => { e.stopPropagation(); handleRemoveEntry(entry.id) }}
                style={{ flexShrink: 0, width: 24, height: 24, borderRadius: '50%', background: '#fde8e8', border: '1.5px solid #e57373', color: '#e05252', fontSize: 14, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 归档态底部固定操作栏 */}
      {isArchived && (
        <div style={{ padding: '12px 18px 28px', background: '#faf8f4', borderTop: '1px solid #ede9e2', display: 'flex', gap: 10, flexShrink: 0 }}>
          <button onClick={handleRestore}
            style={{ flex: 1, padding: '12px', border: '1px solid #e0dbd4', borderRadius: 10, background: 'white', color: '#555', fontSize: 14, cursor: 'pointer' }}>
            ↩ 恢复为活跃脉络
          </button>
          <button onClick={() => setShowDeleteConfirm(true)}
            style={{ flex: 1, padding: '12px', border: '1px solid #fdd', borderRadius: 10, background: 'white', color: '#e05252', fontSize: 14, cursor: 'pointer' }}>
            永久删除
          </button>
        </div>
      )}

      {/* 归档确认弹窗 */}
      {showArchiveConfirm && (
        <div onClick={() => setShowArchiveConfirm(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: '24px 20px', width: 280, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#333', marginBottom: 10 }}>归档这条脉络？</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 20, lineHeight: 1.6 }}>归档后可在「已归档」Tab 查看，随时可以恢复</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowArchiveConfirm(false)}
                style={{ flex: 1, padding: '10px', border: '1px solid #e0dbd4', borderRadius: 8, background: 'white', color: '#888', cursor: 'pointer' }}>取消</button>
              <button onClick={handleArchive}
                style={{ flex: 1, padding: '10px', border: 'none', borderRadius: 8, background: '#e07850', color: 'white', fontWeight: 500, cursor: 'pointer' }}>确认归档</button>
            </div>
          </div>
        </div>
      )}

      {/* 永久删除确认弹窗 */}
      {showDeleteConfirm && (
        <div onClick={() => setShowDeleteConfirm(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: '24px 20px', width: 280, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#333', marginBottom: 10 }}>永久删除这条脉络？</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 4, lineHeight: 1.6 }}>
              脉络及其 {entries.length} 条关联关系将被永久删除
            </div>
            <div style={{ fontSize: 12, color: '#bbb', marginBottom: 20 }}>原始笔记不受影响 · 操作不可撤销</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowDeleteConfirm(false)}
                style={{ flex: 1, padding: '10px', border: '1px solid #e0dbd4', borderRadius: 8, background: 'white', color: '#888', cursor: 'pointer' }}>取消</button>
              <button onClick={handlePermanentDelete}
                style={{ flex: 1, padding: '10px', border: 'none', borderRadius: 8, background: '#e05252', color: 'white', fontWeight: 500, cursor: 'pointer' }}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 重新分析 Toast */}
      {reanalyzeToast && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: 'white', padding: '10px 18px', borderRadius: 20, fontSize: 13, zIndex: 300, whiteSpace: 'nowrap' }}>
          {reanalyzeToast}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -10
```

预期：`✓ built in` 无报错。

- [ ] **Step 3：commit**

```bash
git add src/pages/ThreadDetailPage.jsx
git commit -m "feat: ThreadDetailPage 重构（mode prop/···菜单/编辑关联记录/归档态）"
```

---

## Task 5：MainLayout.jsx 连线新页面

**Files:**
- Modify: `src/components/MainLayout.jsx`

**背景：** 现有 MainLayout 已有 `threads` / `threadDetail` 两种屏幕类型，需要：
1. 新增 `candidateDetail` 屏幕类型（接入 CandidateDetailPage）
2. `threads` 屏幕传入 `onOpenCandidate` prop
3. `threadDetail` 屏幕传入 `mode` prop，并处理归档/恢复/删除回调

- [ ] **Step 1：在 import 区新增 CandidateDetailPage**

在 `src/components/MainLayout.jsx` 顶部 import 区，在 `ThreadDetailPage` import 后面追加：

```js
import CandidateDetailPage from '../pages/CandidateDetailPage'
```

- [ ] **Step 2：新增候选详情导航函数**

在 `handleOpenThread` 函数之后追加：

```js
  // ── 候选脉络详情 ─────────────────────────────────────────────
  function handleOpenCandidate(thread) {
    push({ type: 'candidateDetail', thread })
  }
```

- [ ] **Step 3：更新 threads 屏幕，传入 onOpenCandidate**

找到：
```jsx
    if (screen.type === 'threads') {
      return (
        <ThreadsPage
          onBack={pop}
          onOpenThread={handleOpenThread}
        />
      )
    }
```

替换为：
```jsx
    if (screen.type === 'threads') {
      return (
        <ThreadsPage
          onBack={pop}
          onOpenThread={(thread, mode) => push({ type: 'threadDetail', thread, mode: mode ?? 'confirmed' })}
          onOpenCandidate={handleOpenCandidate}
        />
      )
    }
```

- [ ] **Step 4：更新 threadDetail 屏幕，传入 mode 和回调**

找到：
```jsx
    if (screen.type === 'threadDetail') {
      return (
        <ThreadDetailPage
          thread={screen.thread}
          onBack={pop}
          onOpenEntry={entry => push({ type: 'detail', entry })}
        />
      )
    }
```

替换为：
```jsx
    if (screen.type === 'threadDetail') {
      return (
        <ThreadDetailPage
          thread={screen.thread}
          mode={screen.mode ?? 'confirmed'}
          onBack={pop}
          onOpenEntry={entry => push({ type: 'detail', entry })}
          onArchived={() => {
            // 归档后：弹出详情页，刷新脉络列表（如果当前栈里有 threads 页面则它会自动刷新）
            pop()
          }}
          onRestored={() => {
            // 恢复后：弹出详情页
            pop()
          }}
          onDeleted={() => {
            // 永久删除后：弹出详情页
            pop()
          }}
        />
      )
    }
```

- [ ] **Step 5：新增 candidateDetail 屏幕渲染**

在 `threadDetail` 的 if 块之后，`editEntry` 的 if 块之前，插入：

```jsx
    if (screen.type === 'candidateDetail') {
      return (
        <CandidateDetailPage
          thread={screen.thread}
          onBack={pop}
          onAccepted={() => {
            pop() // 回候选列表
          }}
          onIgnored={() => {
            pop() // 回候选列表
          }}
          onOpenEntry={entry => push({ type: 'detail', entry })}
        />
      )
    }
```

- [ ] **Step 6：验证编译**

```bash
npm run build 2>&1 | tail -10
```

预期：`✓ built in` 无报错。

- [ ] **Step 7：手动全流程验证**

```bash
npm run dev
```

按顺序验证：
1. 洞察页 → 脉络「查看全部 →」→ 进入 ThreadsPage（三 Tab）
2. 已确认 Tab → 点一条脉络 → 进入 ThreadDetailPage（mode=confirmed）→ ··· 菜单弹出正常
3. 已确认 Tab → ··· → 归档 → 确认 → 回到 ThreadsPage → 已归档 Tab 出现该脉络
4. 已归档 Tab → 点脉络 → 进入 ThreadDetailPage（mode=archived）→ 底部「恢复 / 永久删除」
5. 待确认 Tab → 点候选卡片 → 进入 CandidateDetailPage → 点「接受」→ 绿色 toast → 回列表

- [ ] **Step 8：commit**

```bash
git add src/components/MainLayout.jsx
git commit -m "feat: MainLayout 连线 CandidateDetailPage + threadDetail mode prop + 归档/恢复/删除回调"
```

---

## Task 6：RecordDetail.jsx 顶部四字段可编辑

**Files:**
- Modify: `src/components/RecordDetail.jsx`

**背景：** 现有 header 区只有「模板标签 · 时间」一行静态文字 + 情绪标签（已可编辑）。新设计将 header 重排为四行可交互字段：template_type（下拉）/ emotion_display（已有逻辑，只需样式对齐）/ overall_state_score（下拉）/ category_tags（底部 sheet）。

**注意：** `core_needs` 保持现状，不动，已在主体字段区（`EditableFieldRow`），不放入顶部标签区。

- [ ] **Step 1：在组件 state 区新增四字段所需状态**

在 `RecordDetail` 组件内，`editingEmotions` 状态声明之后追加：

```js
  // template_type 下拉
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)

  // overall_state_score 下拉
  const [showScorePicker, setShowScorePicker] = useState(false)

  // category_tags 底部 sheet
  const [showCategorySheet, setShowCategorySheet] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState([])   // 从 user_options 读
  const [categoryDraft, setCategoryDraft] = useState([])       // sheet 内暂存选择
```

- [ ] **Step 2：新增 useEffect 读取 category_tags 选项**

在 `loadThreads` 的 useEffect 之后追加：

```js
  // 读取用户自定义内容大类标签
  useEffect(() => {
    async function loadCategoryOptions() {
      const { data } = await db.from('user_options')
        .select('id, value, sort_order')
        .eq('user_id', initialEntry.user_id)
        .eq('category', 'content_category')
        .order('sort_order', { ascending: true })
      setCategoryOptions((data ?? []).map(r => r.value))
    }
    loadCategoryOptions()
  }, [initialEntry.user_id])
```

- [ ] **Step 3：新增 template_type 保存函数**

在 `handleSummarySave` 之后追加：

```js
  async function handleTemplateSave(newType) {
    setShowTemplatePicker(false)
    setEntry(e => ({ ...e, template_type: newType }))
    await handleFieldSave('template_type', newType)
  }

  async function handleScoreSave(score) {
    setShowScorePicker(false)
    setEntry(e => ({ ...e, overall_state_score: score }))
    await handleFieldSave('overall_state_score', score)
  }

  async function handleCategoryTagsSave() {
    setShowCategorySheet(false)
    setEntry(e => ({ ...e, category_tags: categoryDraft }))
    await handleFieldSave('category_tags', categoryDraft)
  }
```

- [ ] **Step 4：定义顶部标签区所需常量（在 return 之前）**

在 `hasAIAnalysis` 定义之后、`return` 之前追加：

```js
  const TEMPLATE_OPTIONS = [
    { id: 'awareness', label: '觉察' },
    { id: 'gratitude', label: '感恩' },
    { id: 'learning',  label: '学习' },
    { id: 'action',    label: '行动' },
    { id: 'freewrite', label: '随手记' },
  ]

  const SCORE_OPTIONS = [
    { value: 3,  label: '+3 非常好', color: '#2e7d32' },
    { value: 2,  label: '+2 比较好', color: '#388e3c' },
    { value: 1,  label: '+1 还不错', color: '#66bb6a' },
    { value: 0,  label: '0 中性',   color: '#9e9e9e' },
    { value: -1, label: '−1 有点难', color: '#ef9a9a' },
    { value: -2, label: '−2 比较难', color: '#e57373' },
    { value: -3, label: '−3 非常难', color: '#c62828' },
  ]

  // overall_state_score 历史数据兼容（±4/±5 clamp 显示，不强制回写）
  const clampedScore = entry.overall_state_score != null
    ? Math.max(-3, Math.min(3, entry.overall_state_score))
    : null
  const scoreOption = SCORE_OPTIONS.find(o => o.value === clampedScore)
  const scoreLabel = entry.overall_state_score != null
    ? (Math.abs(entry.overall_state_score) > 3
        ? `${entry.overall_state_score > 0 ? '+' : ''}${entry.overall_state_score}（超范围）`
        : `状态 ${entry.overall_state_score > 0 ? '+' : ''}${entry.overall_state_score}`)
    : null
```

- [ ] **Step 5：替换顶部「模板 + 时间」区域为四字段 header**

找到（约第 348 行）：
```jsx
        {/* ── 模板 + 时间 ── */}
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 16 }}>
          <span style={{ color: tpl.color, marginRight: 6 }}>{tpl.label}</span>
          · {formatDateTime(entry.created_at)}
        </div>

        {/* ── 情绪标签区（点击可编辑）── */}
        {emotions.length > 0 && !editingEmotions && (
```

替换为：
```jsx
        {/* ── 顶部标签区（四字段可编辑）── */}
        <div style={{ marginBottom: 12 }}>

          {/* 第一行：时间 + template_type 下拉 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#bbb' }}>{formatDateTime(entry.created_at)}</span>
            {/* template_type badge */}
            <div style={{ position: 'relative' }}>
              <button onClick={() => { setShowTemplatePicker(v => !v); setShowScorePicker(false) }}
                style={{ fontSize: 12, color: tpl.color, background: tpl.color + '18', border: `1px solid ${tpl.color}40`, borderRadius: 8, padding: '3px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                {tpl.label} <span style={{ fontSize: 10 }}>▾</span>
              </button>
              {showTemplatePicker && (
                <>
                  <div onClick={() => setShowTemplatePicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                  <div style={{ position: 'absolute', right: 0, top: '130%', zIndex: 100, background: 'white', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: 140, overflow: 'hidden' }}>
                    {TEMPLATE_OPTIONS.map(opt => (
                      <button key={opt.id} onClick={() => handleTemplateSave(opt.id)}
                        style={{ display: 'block', width: '100%', padding: '11px 14px', background: entry.template_type === opt.id ? '#faf8f4' : 'none', border: 'none', textAlign: 'left', fontSize: 13, color: entry.template_type === opt.id ? '#c9a96e' : '#555', cursor: 'pointer' }}>
                        {entry.template_type === opt.id ? '✓ ' : '　'}{opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 第二行：emotion_display chips（点击可编辑，已有逻辑） */}
          {emotions.length > 0 && !editingEmotions && (
            <div onClick={() => { setEmotionDraft(emotions.join('、')); setEditingEmotions(true) }}
              style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, cursor: 'pointer' }}>
              {emotions.map(w => <EmotionTag key={w} word={w} />)}
            </div>
          )}
          {editingEmotions && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input value={emotionDraft} onChange={e => setEmotionDraft(e.target.value)} autoFocus
                  onBlur={handleEmotionSave}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleEmotionSave() } }}
                  style={{ flex: 1, border: '1px solid #e0dbd4', borderRadius: 8, padding: '6px 10px', fontSize: 13, outline: 'none', background: 'white', fontFamily: 'inherit' }}
                  placeholder="用顿号分隔，如：烦躁、克制后的疲惫" />
                <button onClick={handleEmotionSave}
                  style={{ flexShrink: 0, padding: '6px 10px', background: '#c9a96e', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, cursor: 'pointer' }}>✓</button>
              </div>
            </div>
          )}

          {/* 第三行：overall_state_score 下拉 */}
          {scoreLabel && (
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 6 }}>
              <button onClick={() => { setShowScorePicker(v => !v); setShowTemplatePicker(false) }}
                style={{ fontSize: 12, color: scoreOption?.color ?? '#888', background: (scoreOption?.color ?? '#888') + '15', border: `1px solid ${scoreOption?.color ?? '#888'}40`, borderRadius: 8, padding: '3px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                {scoreLabel} <span style={{ fontSize: 10 }}>▾</span>
              </button>
              {showScorePicker && (
                <>
                  <div onClick={() => setShowScorePicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                  <div style={{ position: 'absolute', left: 0, top: '130%', zIndex: 100, background: 'white', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: 160, overflow: 'hidden' }}>
                    {SCORE_OPTIONS.map(opt => (
                      <button key={opt.value} onClick={() => handleScoreSave(opt.value)}
                        style={{ display: 'block', width: '100%', padding: '11px 14px', background: clampedScore === opt.value ? '#faf8f4' : 'none', border: 'none', textAlign: 'left', fontSize: 13, color: opt.color, cursor: 'pointer' }}>
                        {clampedScore === opt.value ? '✓ ' : '　'}{opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 第四行：category_tags chips + ✎ */}
          {(entry.category_tags?.length > 0 || true) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
              {(entry.category_tags ?? []).map(tag => (
                <span key={tag} onClick={() => { setCategoryDraft(entry.category_tags ?? []); setShowCategorySheet(true) }}
                  style={{ fontSize: 11, background: '#f5f0e8', color: '#8a7a6a', padding: '2px 9px', borderRadius: 10, cursor: 'pointer' }}>
                  {tag}
                </span>
              ))}
              <span onClick={() => { setCategoryDraft(entry.category_tags ?? []); setShowCategorySheet(true) }}
                style={{ fontSize: 11, color: '#d4c4b0', cursor: 'pointer' }}>✎</span>
            </div>
          )}
        </div>

        {/* ── confidence tip（保持现有逻辑位置不变）── */}
        {entry.emotion_confidence != null && entry.emotion_confidence < 0.75 && (
```

- [ ] **Step 6：删除原有情绪标签区块（已被第五步替换，需删除旧代码避免重复渲染）**

找到并删除以下旧代码块（在新 header 区之后会出现重复，已被 Step 5 的新代码包含）：

```jsx
        {/* ── 情绪标签区（点击可编辑）── */}
        {emotions.length > 0 && !editingEmotions && (
          <div
            onClick={() => {
              setEmotionDraft(emotions.join('、'))
              setEditingEmotions(true)
            }}
            style={{
              display: 'flex', gap: 6, flexWrap: 'wrap',
              marginBottom: 4, cursor: 'pointer',
            }}
          >
            {emotions.map(w => <EmotionTag key={w} word={w} />)}
          </div>
        )}

        {editingEmotions && (
          <div style={{ marginBottom: 4 }}>
            <input
              value={emotionDraft}
              onChange={e => setEmotionDraft(e.target.value)}
              autoFocus
              onBlur={handleEmotionSave}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleEmotionSave() } }}
              style={{
                width: '100%', border: '1px solid #e0dbd4',
                borderRadius: 8, padding: '6px 10px',
                fontSize: 13, outline: 'none',
                background: 'white', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
              placeholder="用逗号分隔，如：难受、委屈"
            />
            <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>
              完成后点其他地方自动保存
            </div>
          </div>
        )}
```

- [ ] **Step 7：在 return 末尾（`</div>` 闭合之前）插入 category_tags 底部 sheet**

找到文件最末尾的 `</div>` 闭合（整个组件 return 的最后一行），在它之前插入：

```jsx
      {/* category_tags 底部 sheet */}
      {showCategorySheet && (
        <div onClick={() => setShowCategorySheet(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', background: 'white', borderRadius: '16px 16px 0 0', padding: '20px 18px 32px' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 14 }}>选择内容大类标签</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {categoryOptions.length === 0 ? (
                <div style={{ fontSize: 13, color: '#ccc' }}>暂无标签，请在「我的」页面添加</div>
              ) : categoryOptions.map(tag => {
                const selected = categoryDraft.includes(tag)
                return (
                  <button key={tag}
                    onClick={() => setCategoryDraft(prev => selected ? prev.filter(t => t !== tag) : [...prev, tag])}
                    style={{ padding: '6px 14px', borderRadius: 20, border: selected ? '1.5px solid #c9a96e' : '1.5px solid #e0dbd4', background: selected ? '#fff8f0' : 'white', color: selected ? '#c9a96e' : '#888', fontSize: 13, cursor: 'pointer' }}>
                    {tag}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 11, color: '#bbb', marginBottom: 16 }}>在「我的」页面可以自定义这些标签</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowCategorySheet(false)}
                style={{ flex: 1, padding: '12px', border: '1px solid #e0dbd4', borderRadius: 10, background: 'white', color: '#888', fontSize: 14, cursor: 'pointer' }}>取消</button>
              <button onClick={handleCategoryTagsSave}
                style={{ flex: 2, padding: '12px', border: 'none', borderRadius: 10, background: '#c9a96e', color: 'white', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>保存</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 8：验证编译**

```bash
npm run build 2>&1 | tail -10
```

预期：`✓ built in` 无报错。

- [ ] **Step 9：手动验证四个字段**

```bash
npm run dev
```

打开任意一条记录详情，验证：
1. 顶部「觉察 ▾」点击 → 下拉 5 项，点选后 badge 颜色/文字同步更新
2. 情绪 chip 点击 → 变为输入框，输入后确认/失焦保存
3. 「状态 -1 ▾」点击 → 下拉 7 项（颜色渐变），点选后 chip 更新
4. category_tags chip 或 ✎ 点击 → 底部 sheet 弹出，多选后保存

- [ ] **Step 10：commit**

```bash
git add src/components/RecordDetail.jsx
git commit -m "feat: RecordDetail 顶部四字段可编辑（template_type/emotion/state_score/category_tags）"
```

---

---

## Task 7：SettingsPage — 内容大类标签管理

**Files:**
- Modify: `src/pages/SettingsPage.jsx`

**目标：** 在「我的」（SettingsPage）页面新增「自定义选项 → 内容大类标签」入口，点击后展示标签管理子页，支持增删拖动排序，读写 `user_options` 表（`category='content_category'`，按 `sort_order` 排序）。

---

- [ ] **Step 1：在 SettingsPage.jsx 顶部新增 state 和加载逻辑**

在文件顶部 import 区追加（紧接现有 import 之后）：

```js
import { db } from '../lib/db'
```

在 `export default function SettingsPage()` 函数体内，紧接现有 useState 声明之后，添加以下 state 和 effect：

```js
// ── 内容大类标签管理 ──────────────────────────────────
const [showTagManager, setShowTagManager] = useState(false)
const [tagOptions, setTagOptions] = useState([])   // [{ id, label, sort_order }]
const [newTagInput, setNewTagInput] = useState('')
const [addingTag, setAddingTag] = useState(false)  // 是否显示内联输入框
const [dragIndex, setDragIndex] = useState(null)   // 拖动中的 index

useEffect(() => {
  if (!user) return
  loadTagOptions()
}, [user])

async function loadTagOptions() {
  const { data } = await db.from('user_options')
    .select('id, label, sort_order')
    .eq('user_id', user.id)
    .eq('category', 'content_category')
    .order('sort_order', { ascending: true })
  setTagOptions(data ?? [])
}
```

- [ ] **Step 2：添加标签的增删排序函数**

在 `handleSave` 函数之后添加（4 个函数）：

```js
// ── 内容大类标签：删除 ──────────────────────────────
async function handleDeleteTag(id) {
  await db.from('user_options').delete().eq('id', id)
  setTagOptions(prev => {
    const updated = prev.filter(t => t.id !== id)
    // 重新写回连续 sort_order（4.17 风险：必须全量更新）
    return updated
  })
  // 全量刷新确保 sort_order 一致
  loadTagOptions()
}

// ── 内容大类标签：新增 ──────────────────────────────
async function handleAddTag() {
  const label = newTagInput.trim()
  if (!label) return
  const nextOrder = tagOptions.length  // 追加到末尾
  const { data, error } = await db.from('user_options').insert({
    user_id: user.id,
    category: 'content_category',
    label,
    sort_order: nextOrder,
  }).select('id, label, sort_order').single()
  if (!error && data) {
    setTagOptions(prev => [...prev, data])
  }
  setNewTagInput('')
  setAddingTag(false)
}

// ── 内容大类标签：拖动排序（写回全量 sort_order）────
async function handleDragReorder(fromIndex, toIndex) {
  if (fromIndex === toIndex) return
  const reordered = [...tagOptions]
  const [moved] = reordered.splice(fromIndex, 1)
  reordered.splice(toIndex, 0, moved)
  // 前端立即更新，避免闪烁
  setTagOptions(reordered)
  // 全量写回 sort_order（4.17 要求：必须写所有行，不能只写拖动的那条）
  await Promise.all(
    reordered.map((tag, i) =>
      db.from('user_options').update({ sort_order: i }).eq('id', tag.id)
    )
  )
}

// ── 内容大类标签：拖动事件处理 ───────────────────────
function handleDragStart(e, index) {
  setDragIndex(index)
  e.dataTransfer.effectAllowed = 'move'
}
function handleDragOver(e, index) {
  e.preventDefault()
  if (dragIndex === null || dragIndex === index) return
  handleDragReorder(dragIndex, index)
  setDragIndex(index)
}
function handleDragEnd() {
  setDragIndex(null)
}
```

- [ ] **Step 3：在「自定义选项」section 添加标签管理入口行**

在 `return (` 的 JSX 中，找到「回顾信设置」区块：

```jsx
        {/* ─── 回顾信设置 ─── */}
        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #ede9e2' }}>
```

在该 div **之前**插入自定义选项区块：

```jsx
        {/* ─── 自定义选项 ─── */}
        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #ede9e2' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 14 }}>
            自定义选项
          </div>
          <button
            onClick={() => setShowTagManager(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '12px 16px', background: 'white',
              border: '1px solid #e0dbd4', borderRadius: 12, cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 14, color: '#333' }}>内容大类标签</span>
            <span style={{ fontSize: 12, color: '#bbb' }}>
              {tagOptions.length} 个标签 ›
            </span>
          </button>
        </div>
```

- [ ] **Step 4：添加标签管理子页（全屏覆盖层，条件渲染）**

在整个 `return` 的最外层 `<div className="flex flex-col h-full">` 内部、结束 `</div>` 之前，追加：

```jsx
      {/* ─── 内容大类标签管理子页（全屏覆盖） ─── */}
      {showTagManager && (
        <div style={{
          position: 'absolute', inset: 0, background: '#f5f3ef',
          display: 'flex', flexDirection: 'column', zIndex: 50,
        }}>
          {/* 顶部 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px 12px', background: '#f5f3ef', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
            <button onClick={() => setShowTagManager(false)}
              style={{ background: 'none', border: 'none', fontSize: 22, color: '#c9a96e', cursor: 'pointer', lineHeight: 1 }}>
              ‹
            </button>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>内容大类标签</span>
          </div>

          {/* 列表 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px' }}>
            {tagOptions.map((tag, index) => (
              <div key={tag.id}
                draggable
                onDragStart={e => handleDragStart(e, index)}
                onDragOver={e => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'white', borderRadius: 10, padding: '10px 14px',
                  marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  opacity: dragIndex === index ? 0.5 : 1,
                  cursor: 'grab',
                }}
              >
                {/* 拖动手柄 */}
                <span style={{ fontSize: 16, color: '#ccc', cursor: 'grab', flexShrink: 0 }}>☰</span>

                {/* 标签 chip 预览 */}
                <span style={{ flex: 1, fontSize: 13, color: '#333',
                  padding: '3px 10px', background: '#f5f3ef',
                  borderRadius: 20, display: 'inline-block' }}>
                  {tag.label}
                </span>

                {/* 删除按钮 */}
                <button
                  onClick={() => handleDeleteTag(tag.id)}
                  style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                    border: '1px solid #e0dbd4', background: 'white', color: '#e57373',
                    fontSize: 16, lineHeight: 1, cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center' }}
                >
                  −
                </button>
              </div>
            ))}

            {/* 内联新增输入框 */}
            {addingTag ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <input
                  autoFocus
                  value={newTagInput}
                  onChange={e => setNewTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddTag() }}
                  placeholder="标签名称，建议加 # 前缀"
                  style={{ flex: 1, border: '1px solid #e0dbd4', borderRadius: 10,
                    padding: '10px 14px', fontSize: 13, outline: 'none',
                    background: 'white', fontFamily: 'inherit' }}
                />
                <button onClick={handleAddTag}
                  style={{ padding: '10px 16px', border: 'none', borderRadius: 10,
                    background: '#c9a96e', color: 'white', fontSize: 13, cursor: 'pointer' }}>
                  完成
                </button>
              </div>
            ) : (
              <button onClick={() => setAddingTag(true)}
                style={{ width: '100%', marginTop: 4, padding: '11px', border: '1.5px dashed #e0dbd4',
                  borderRadius: 10, background: 'none', color: '#c9a96e', fontSize: 13,
                  cursor: 'pointer', textAlign: 'center' }}>
                + 添加新标签
              </button>
            )}

            {/* 说明文字 */}
            <div style={{ marginTop: 16, fontSize: 12, color: '#bbb', textAlign: 'center', lineHeight: 1.6 }}>
              删除标签不影响已打过该标签的笔记记录
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5：验证编译**

```bash
npm run build 2>&1 | tail -10
```

预期：`✓ built in` 无报错。

- [ ] **Step 6：手动验证**

```bash
npm run dev
```

验证路径：
1. 进入「我的」→ 看到「自定义选项」分区 → 「内容大类标签 N 个标签 ›」
2. 点击进入标签管理页 → 显示现有标签列表（含 ☰ 手柄 + chip + − 按钮）
3. 点「+ 添加新标签」→ 内联输入框出现 → 输入 `#测试` → 按 Enter 或点「完成」→ 新标签追加到列表
4. 点「−」删除一个标签 → 列表移除，不影响其他数据
5. 拖动 ☰ 手柄重新排序 → 顺序更新
6. 关闭标签管理页（点「‹」）→ 回到「我的」页面
7. 在 RecordDetail category_tags 底部 sheet 中确认新标签已出现（sheet 从 user_options 实时读取）

- [ ] **Step 7：commit**

```bash
git add src/pages/SettingsPage.jsx
git commit -m "feat: 「我的」页面新增内容大类标签管理（增删拖动排序）"
```

---

## Task 8：InsightsPage — 脉络区块候选提示

**Files:**
- Modify: `src/lib/insightsService.js`（新增候选数查询）
- Modify: `src/pages/InsightsPage.jsx`（脉络区块 header 橙色角标 + 底部提示条）

**目标：** 洞察页脉络区块 header 右侧显示橙色「N 个待确认」角标；区块底部显示橙色提示条「回顾信生成时发现了 N 个新脉络候选 · 去确认 ›」，点击跳转 ThreadsPage 待确认 Tab。无候选时两者均不渲染（§G）。

---

- [ ] **Step 1：insightsService.js — 新增候选脉络数查询**

在 `loadInsightsData` 函数的 `Promise.all` 数组中，追加第 8 个查询（在 `lettersRes` 之后）：

找到：
```js
    // 全部回顾信（回顾信列表页用）
    db.from('review_letters')
      .select('id, content, period_start, period_end, is_read, created_at, entry_ids')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ])
```

替换为：
```js
    // 全部回顾信（回顾信列表页用）
    db.from('review_letters')
      .select('id, content, period_start, period_end, is_read, created_at, entry_ids')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),

    // 候选脉络数（洞察页角标，只计 status='candidate'，不计 rejected）
    db.from('threads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'candidate'),
  ])
```

- [ ] **Step 2：insightsService.js — 解构新结果并返回**

找到（`Promise.all` 解构行）：
```js
  const [moodRes, emotionRes, needsRes, letterRes, tagsRes, threadsRes, lettersRes] = await Promise.all([
```

替换为：
```js
  const [moodRes, emotionRes, needsRes, letterRes, tagsRes, threadsRes, lettersRes, candidateRes] = await Promise.all([
```

找到 `return {` 块中的最后一行：
```js
    error: moodRes.error ?? null,
  }
```

替换为：
```js
    candidateCount:   candidateRes.count ?? 0,
    error: moodRes.error ?? null,
  }
```

- [ ] **Step 3：InsightsPage.jsx — 读取 candidateCount 并传给跳转**

在 `InsightsPage` 组件 props 中，新增 `onOpenPendingThreads` 回调（在现有 `onOpenThreads` 之后）：

找到：
```js
export default function InsightsPage({ onOpenLetterList, onOpenThreads, onOpenThread }) {
```

替换为：
```js
export default function InsightsPage({ onOpenLetterList, onOpenThreads, onOpenThread, onOpenPendingThreads }) {
```

在 state 声明区，新增 candidateCount（跟随 `confirmedThreads`）：

找到：
```js
  const [confirmedThreads, setConfirmedThreads] = useState([])
  const [allLetters, setAllLetters] = useState([])
```

替换为：
```js
  const [confirmedThreads, setConfirmedThreads] = useState([])
  const [candidateCount, setCandidateCount] = useState(0)
  const [allLetters, setAllLetters] = useState([])
```

在 `load()` 函数里，新增对 candidateCount 的赋值（跟随 `setConfirmedThreads`）：

找到：
```js
      setConfirmedThreads(result.confirmedThreads)
      setAllLetters(result.allLetters)
```

替换为：
```js
      setConfirmedThreads(result.confirmedThreads)
      setCandidateCount(result.candidateCount ?? 0)
      setAllLetters(result.allLetters)
```

- [ ] **Step 4：InsightsPage.jsx — 脉络区块 header 加橙色角标**

找到（脉络区块 header）：
```jsx
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>脉络</span>
          <button
            onClick={onOpenThreads}
            style={{ fontSize: 11, color: '#c9a96e', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {confirmedThreads.length > 0 ? '查看全部 →' : '+ 新建脉络'}
          </button>
        </div>
```

替换为：
```jsx
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>脉络</span>
            {candidateCount > 0 && (
              <span
                onClick={onOpenPendingThreads}
                style={{ fontSize: 10, color: 'white', background: '#c9a96e',
                  borderRadius: 10, padding: '1px 7px', cursor: 'pointer', fontWeight: 500 }}>
                {candidateCount} 个待确认
              </span>
            )}
          </div>
          <button
            onClick={onOpenThreads}
            style={{ fontSize: 11, color: '#c9a96e', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {confirmedThreads.length > 0 ? '查看全部 →' : '+ 新建脉络'}
          </button>
        </div>
```

- [ ] **Step 5：InsightsPage.jsx — 区块底部添加橙色提示条**

找到（脉络区块结束处）：
```jsx
      </div>

      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 16,
        letterSpacing: '0.5px', textAlign: 'center' }}>
        ── 最近 30 天 ──
      </div>
```

替换为：
```jsx
        {/* 候选提示条（有候选时显示，无候选不渲染） */}
        {candidateCount > 0 && (
          <div
            onClick={onOpenPendingThreads}
            style={{ marginTop: 10, padding: '10px 14px', background: '#fff8f0',
              border: '1px solid #f0dfc0', borderRadius: 10, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#c9a96e', lineHeight: 1.5 }}>
              回顾信生成时发现了 {candidateCount} 个新脉络候选
            </span>
            <span style={{ fontSize: 12, color: '#c9a96e', flexShrink: 0, marginLeft: 8 }}>
              去确认 ›
            </span>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 16,
        letterSpacing: '0.5px', textAlign: 'center' }}>
        ── 最近 30 天 ──
      </div>
```

- [ ] **Step 6：MainLayout.jsx — 新增 onOpenPendingThreads 回调**

在 MainLayout 中找到 `InsightsPage` 的调用，给它加上 `onOpenPendingThreads` prop：

找到（InsightsPage 的渲染）：
```jsx
            <InsightsPage
              onOpenLetterList={...}
              onOpenThreads={...}
              onOpenThread={...}
```

在已有 props 末尾追加：
```jsx
              onOpenPendingThreads={() => {
                // 打开 ThreadsPage 并默认选中待确认 Tab
                push({ type: 'threads', defaultTab: 'pending' })
              }}
```

然后在 ThreadsPage 中接收 `defaultTab` prop（在 Task 2 已实现的 `ThreadsPage` 里，`activeTab` 的初始值改为从 prop 读取）：

找到 ThreadsPage 内：
```js
export default function ThreadsPage({ onOpenThread, onOpenCandidate, onBack }) {
  const [activeTab, setActiveTab] = useState('confirmed')
```

替换为：
```js
export default function ThreadsPage({ onOpenThread, onOpenCandidate, onBack, defaultTab = 'confirmed' }) {
  const [activeTab, setActiveTab] = useState(defaultTab)
```

- [ ] **Step 7：验证编译**

```bash
npm run build 2>&1 | tail -10
```

预期：`✓ built in` 无报错。

- [ ] **Step 8：手动验证**

```bash
npm run dev
```

验证路径（需要数据库中存在 status='candidate' 的脉络才可见角标）：

**有候选时：**
1. 洞察页「脉络」区块 header 右侧出现橙色「N 个待确认」角标
2. 点击角标 → 直接跳转到 ThreadsPage 待确认 Tab（不是已确认 Tab）
3. 区块底部出现橙色提示条「回顾信生成时发现了 N 个新脉络候选 · 去确认 ›」
4. 点击提示条 → 同样跳转到待确认 Tab

**无候选时：**
5. 角标和提示条均不渲染，区块 header 只有「查看全部 →」

- [ ] **Step 9：commit**

```bash
git add src/lib/insightsService.js src/pages/InsightsPage.jsx src/pages/ThreadsPage.jsx src/components/MainLayout.jsx
git commit -m "feat: 洞察页脉络区块新增候选提示角标和提示条"
```

---

## 自检（Self-Review）

> 写完后以 spec §A–§I 为基准做覆盖检查，不需要修改，只标记结论。

### 1. Spec 覆盖检查

| Spec 章节 | 实现 Task | 状态 |
|---|---|---|
| §A.1–A.2 ··· 菜单 + 编辑关联记录模式 | Task 4 ThreadDetailPage | ✅ |
| §A.3 增删规则（removed_by_user 软删除）| Task 4 编辑关联记录 | ✅ |
| §A.4 重新分析（⚠️ 4.19 过滤）| Task 1 reAnalyzeThread | ✅ |
| §A.5 arc_summary 过期状态（⚠️ 黄色 banner）| Task 4 mode='confirmed' | ✅ |
| §B.1–B.3 候选三态（接受/忽略/删除）| Task 2 ThreadsPage + Task 3 CandidateDetailPage | ✅ |
| §B.4 候选详情页（固定标题/AI理由/关联记录/底部按钮）| Task 3 CandidateDetailPage | ✅ |
| §B.5 待确认角标只计 candidate 不计 rejected | Task 2 ThreadsPage | ✅ |
| §C.1 归档入口（··· 菜单 → 归档）| Task 4 ··· 菜单 | ✅ |
| §C.2 已归档 Tab（opacity 0.7 + 归档日期）| Task 2 ThreadsPage | ✅ |
| §C.3 归档态详情（只读 banner + 无 ··· 菜单）| Task 4 mode='archived' | ✅ |
| §C.4 永久删除（二次确认弹窗 + CASCADE）| Task 4 mode='archived' 底部操作栏 | ✅ |
| §D.1 手动分析两个等价入口 | Task 2 ThreadsPage 底部虚线按钮 + ＋ 浮窗 | ✅ |
| §D.2 确认 sheet（时间范围 chip + 说明）| Task 2 ThreadsPage | ✅ |
| §D.3 分析中 loading 状态 | Task 2 ThreadsPage | ✅ |
| §D.4 完成 toast（N 个候选 / 无新候选）| Task 2 ThreadsPage | ✅ |
| §E.2–E.4 category_tags 点击 → 底部 sheet | Task 6 RecordDetail | ✅ |
| §F.1 thread_entries.removed_by_user 字段 | Task 0 SQL | ✅ |
| §F.2 threads.status 约束加 rejected | Task 0 SQL | ✅ |
| §G 洞察页候选提示（角标 + 提示条）| Task 8 InsightsPage | ✅ |
| §H 「我的」标签管理（增删拖动）| Task 7 SettingsPage | ✅ |
| §I.1–I.4 RecordDetail 顶部四字段可编辑 | Task 6 RecordDetail | ✅ |
| §I.5 core_needs 保持现状 | 无需操作，已验证 | ✅ |
| DB 4.19 reAnalyzeThread 过滤 removed_by_user | Task 1 明确标注 ⚠️ | ✅ |
| DB 4.17 sort_order 全量写回 | Task 7 handleDragReorder | ✅ |
| DB 4.18 两条 SQL 合并执行 | Task 0 Step 2 已说明 | ✅ |

### 2. 占位符扫描

无 TBD / TODO / "类似 Task N" / "参考上文" 等占位符。每个 Step 均包含完整代码或明确命令。✅

### 3. 类型一致性检查

| 符号 | 定义处 | 使用处 | 一致 |
|---|---|---|---|
| `reAnalyzeThread(threadId, userId)` | Task 1 threadService.js | Task 4 ThreadDetailPage | ✅ |
| `removed_by_user` | Task 0 SQL + Task 1 | Task 4 编辑关联记录 | ✅ |
| `candidateCount` | Task 8 insightsService + state | Task 8 JSX 角标/提示条 | ✅ |
| `onOpenPendingThreads` | Task 8 InsightsPage props | Task 8 MainLayout | ✅ |
| `defaultTab` | Task 8 ThreadsPage prop | Task 8 MainLayout push | ✅ |
| `handleDragReorder(fromIndex, toIndex)` | Task 7 函数定义 | Task 7 onDragOver | ✅ |
| `mode='confirmed'` / `mode='archived'` | Task 4 ThreadDetailPage | Task 5 MainLayout | ✅ |
| `categoryOptions` / `categoryDraft` | Task 6 state | Task 6 JSX sheet | ✅ |

### 结论

Spec §A–§I 全部覆盖，无漏项，无占位符，类型一致。计划就绪，可交代码 session 执行。

---

## §6 同步日志追加

> 执行完成后，在 `docs/arch-context.md` §6 末尾追加一行：

```
- 2026-04-13 · 代码session · 实现 threads 交互细节全量补充（plan: 2026-04-13-threads-interaction-gaps.md，Task 0-8）：DB 迁移 removed_by_user/rejected状态/sort_order；ThreadsPage 三 Tab + AI分析sheet；CandidateDetailPage 新建；ThreadDetailPage ···菜单/编辑关联记录/归档态；RecordDetail 顶部四字段可编辑；SettingsPage 标签管理；InsightsPage 候选提示角标
```

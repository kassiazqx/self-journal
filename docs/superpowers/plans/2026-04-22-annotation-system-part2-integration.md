# 富文本标注系统 Part 2：集成层 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Part 1 的基础组件接入三个阅读页面，实现长按弹出菜单交互、debounce 自动保存、AI 预标注解析写入，以及编辑保存时清空标注。

**Architecture:** `AnnotationMenu`（浮层菜单）+ `useAnnotationInteraction`（选区捕获 + 菜单显隐）封装交互逻辑，三个页面（RecordDetail / ReviewLetterDetail / ThreadDetailPage）各自接入。AI 预标注在生成侧解析并写 DB，读取侧只需传 `annotations` prop 给 `AnnotatedText`。

**Tech Stack:** React hooks, `window.getSelection()`, `setTimeout(0)`（移动端守门），Supabase PATCH，`useCallback`/`useRef`/debounce，Tailwind CSS（现有配置）

**Spec 文件：** `docs/superpowers/specs/2026-04-22-annotation-system-design.md`

**前置条件：** Part 1 全部 Task 已完成（DB 字段已建，`annotationConfig.js` / `useAnnotations.js` / `AnnotatedText.jsx` 已存在）

---

## 文件改动地图

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/components/AnnotationMenu.jsx` | **新建** | 长按弹出浮层（B / U / ▌ / 四色点） |
| `src/hooks/useAnnotationInteraction.js` | **新建** | 选区捕获（含 `setTimeout(0)` 移动端守门）、菜单定位、调用 addAnnotation |
| `src/components/RecordDetail.jsx` | **修改** | 接入 AnnotatedText + useAnnotations + 长按菜单 + debounce 保存 |
| `src/components/ReviewLetterDetail.jsx` | **修改** | 接入 AnnotatedText（letter.annotations）+ 长按菜单 + debounce 保存 |
| `src/pages/ThreadDetailPage.jsx` | **修改** | 接入 AnnotatedText（thread.current_state_annotations）+ 长按菜单 + debounce 保存 |
| `src/pages/EditEntryPage.jsx` | **修改** | handleSave 写 `annotations: null`，编辑保存时清空标注 |
| `src/lib/reviewLetterService.js` | **修改** | 先提取 annotations JSON，再跑 suggested_threads 清洗（解决贪婪正则冲突） |
| `src/lib/threadService.js` | **修改** | generateThreadAnalysis 解析 AI 预标注，写 `current_state_annotations` |

---

## Task 1：AnnotationMenu.jsx — 长按弹出菜单组件

**Files:**
- Create: `src/components/AnnotationMenu.jsx`

浮层菜单，绝对定位在选区上方。接收当前 `activeColor`、`onBold` / `onHighlight` / `onUnderline` / `onColorChange` 回调。不处理选区逻辑，只负责渲染和分发点击。

- [ ] **Step 1：创建文件**

```jsx
// src/components/AnnotationMenu.jsx
import React from 'react'
import { DEFAULT_ANNOTATION_COLORS } from '../lib/annotationConfig'

/**
 * 长按弹出标注菜单。
 * 绝对定位，由父组件控制 `position`（{ top, left }）和 `visible`。
 *
 * @param {{ top: number, left: number }} position - 菜单左上角坐标（相对最近 position:relative 祖先）
 * @param {boolean} visible
 * @param {string} activeColor - 当前活动色 id（'straw'|'pink'|'sage'|'slate'）
 * @param {() => void} onBold
 * @param {() => void} onHighlight
 * @param {() => void} onUnderline
 * @param {(colorId: string) => void} onColorChange
 * @param {() => void} onClose - 点菜单外部关闭时调用
 */
export default function AnnotationMenu({
  position,
  visible,
  activeColor,
  onBold,
  onHighlight,
  onUnderline,
  onColorChange,
  onClose,
}) {
  if (!visible) return null

  const btnStyle = {
    padding: '4px 10px',
    color: 'white',
    fontSize: 13,
    borderRight: '1px solid #3a3a3c',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    borderRight: '1px solid #3a3a3c',
  }

  function stop(e) { e.stopPropagation() }

  return (
    <>
      {/* 透明遮罩，点外部关闭 */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 199 }}
        onMouseDown={onClose}
        onTouchStart={onClose}
      />
      <div
        onMouseDown={stop}
        onTouchStart={stop}
        style={{
          position: 'absolute',
          top: position.top,
          left: position.left,
          transform: 'translateX(-50%) translateY(-100%)',
          marginTop: -8,
          background: '#1c1c1e',
          borderRadius: 12,
          padding: '6px 0',
          display: 'flex',
          boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
          zIndex: 200,
        }}
      >
        {/* 向下箭头 */}
        <div style={{
          position: 'absolute',
          bottom: -7, left: '50%',
          transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '7px solid transparent',
          borderRight: '7px solid transparent',
          borderTop: '7px solid #1c1c1e',
        }} />

        {/* B 加粗 */}
        <button style={{ ...btnStyle, fontWeight: 700, letterSpacing: 0.5 }} onClick={onBold}>B</button>

        {/* U 下划线 */}
        <button style={{ ...btnStyle, textDecoration: 'underline', textDecorationColor: '#8FAABC', textDecorationThickness: 1.5 }} onClick={onUnderline}>U</button>

        {/* ▌ 高亮 */}
        <button style={btnStyle} onClick={onHighlight}>▌</button>

        {/* 四色点 */}
        {DEFAULT_ANNOTATION_COLORS.map((c, idx) => (
          <button
            key={c.id}
            style={{
              ...btnStyle,
              borderRight: idx === DEFAULT_ANNOTATION_COLORS.length - 1 ? 'none' : '1px solid #3a3a3c',
              padding: '4px 8px',
            }}
            onClick={() => onColorChange(c.id)}
          >
            <span style={{
              width: 12, height: 12, borderRadius: '50%',
              background: c.hex, opacity: 0.9,
              display: 'inline-block',
              outline: activeColor === c.id ? `2px solid white` : 'none',
              outlineOffset: 1,
            }} />
          </button>
        ))}
      </div>
    </>
  )
}
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：Commit**

```bash
git add src/components/AnnotationMenu.jsx
git commit -m "feat: AnnotationMenu 长按弹出菜单组件"
```

---

## Task 2：useAnnotationInteraction.js — 选区捕获 Hook

**Files:**
- Create: `src/hooks/useAnnotationInteraction.js`

封装选区捕获逻辑，处理移动端 `touchend` → `setTimeout(0)` 时序问题。返回菜单所需的位置状态和事件处理器，供父组件绑到内容容器上。

**关键设计（来自架构审查）：**
- `touchend` / `mouseup` 都用 `setTimeout(0)` 延迟读取 `getSelection()`
- 先判断 `selection.toString().length > 0` 再继续
- `start/end` 用 `containerRef.current.textContent` 作为基准（即 `AnnotatedText` 渲染的纯文本）
- 不使用 `Range.toString()` 直接做偏移计算，用 `TreeWalker` 遍历文本节点求偏移

- [ ] **Step 1：创建文件**

```js
// src/hooks/useAnnotationInteraction.js
import { useState, useCallback, useRef } from 'react'

/**
 * 封装「长按/选区 → 弹出菜单 → addAnnotation」的交互逻辑。
 *
 * @param {object} params
 * @param {React.RefObject} params.containerRef - 绑在文本容器上的 ref（position: relative）
 * @param {string} params.rawText - 原始纯文本（与 DB 存储、AnnotatedText 接收的完全一致）
 * @param {Function} params.addAnnotation - useAnnotations 返回的 addAnnotation
 * @param {string} params.activeColor - useAnnotations 返回的 activeColor
 *
 * @returns {{
 *   menuVisible: boolean,
 *   menuPosition: { top: number, left: number },
 *   handleMouseUp: Function,
 *   handleTouchEnd: Function,
 *   closeMenu: Function,
 *   pendingRange: { start: number, end: number } | null,
 * }}
 */
export function useAnnotationInteraction({ containerRef, rawText, addAnnotation, activeColor }) {
  const [menuVisible, setMenuVisible] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const pendingRangeRef = useRef(null)

  /**
   * 从 DOM Range 计算相对于 containerRef 纯文本的 start/end 偏移。
   * ⚠️ 架构约束：基准文本必须与 rawText prop 一致（不能 trim）。
   */
  function getRangeOffsets(range) {
    if (!containerRef.current) return null
    const container = containerRef.current

    function getOffset(targetNode, targetOffset) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      let offset = 0
      while (walker.nextNode()) {
        const node = walker.currentNode
        if (node === targetNode) return offset + targetOffset
        offset += node.textContent.length
      }
      return offset
    }

    try {
      const start = getOffset(range.startContainer, range.startOffset)
      const end   = getOffset(range.endContainer, range.endOffset)
      if (start >= end) return null
      if (start < 0 || end > rawText.length) return null
      return { start, end }
    } catch {
      return null
    }
  }

  function tryShowMenu() {
    const selection = window.getSelection()
    if (!selection || selection.toString().length === 0) return
    if (selection.rangeCount === 0) return

    let range
    try {
      range = selection.getRangeAt(0)
    } catch {
      return
    }

    if (!containerRef.current?.contains(range.commonAncestorContainer)) return

    const offsets = getRangeOffsets(range)
    if (!offsets) return

    pendingRangeRef.current = offsets

    // 计算菜单位置（选区中点上方）
    const rect = range.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    const top  = rect.top  - containerRect.top  - 4   // 稍微在选区上方
    const left = rect.left - containerRect.left + rect.width / 2

    setMenuPosition({ top, left })
    setMenuVisible(true)
  }

  const handleMouseUp = useCallback(() => {
    setTimeout(tryShowMenu, 0)
  }, [rawText, activeColor])

  const handleTouchEnd = useCallback(() => {
    setTimeout(tryShowMenu, 0)
  }, [rawText, activeColor])

  const closeMenu = useCallback(() => {
    setMenuVisible(false)
    pendingRangeRef.current = null
    window.getSelection()?.removeAllRanges()
  }, [])

  function applyAnnotation(type, color) {
    const r = pendingRangeRef.current
    if (!r) return
    addAnnotation(type, color, r.start, r.end)
    closeMenu()
  }

  const handleBold       = useCallback(() => applyAnnotation('bold', undefined),      [pendingRangeRef.current, addAnnotation])
  const handleHighlight  = useCallback(() => applyAnnotation('highlight', activeColor),[pendingRangeRef.current, addAnnotation, activeColor])
  const handleUnderline  = useCallback(() => applyAnnotation('underline', activeColor),[pendingRangeRef.current, addAnnotation, activeColor])

  return {
    menuVisible,
    menuPosition,
    handleMouseUp,
    handleTouchEnd,
    closeMenu,
    handleBold,
    handleHighlight,
    handleUnderline,
    pendingRange: pendingRangeRef.current,
  }
}
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：Commit**

```bash
git add src/hooks/useAnnotationInteraction.js
git commit -m "feat: useAnnotationInteraction hook（选区捕获 + 移动端 setTimeout 守门）"
```

---

## Task 3：reviewLetterService.js — AI 预标注解析（阻塞性修复）

**Files:**
- Modify: `src/lib/reviewLetterService.js`

**问题：** 现有 Step 4（L140-186）先用贪婪正则 `\{[\s\S]*"suggested_threads"[\s\S]*$` 清洗 suggested_threads。若 AI 在 `{"suggested_threads":[...]}` 之前输出了 `{"annotations":[...]}` 块，贪婪匹配会从第一个 `{` 开始匹配，把 annotations JSON 也吃掉，导致：①annotations 无法解析；②信的正文也被截断。

**修复：** 在 Step 4 开头，用精确非贪婪正则先提取 annotations 块，从 `rawLetter` 中剥离，再跑现有 suggested_threads 清洗链。

- [ ] **Step 1：在 Step 4 开头插入 annotations 提取逻辑**

在 [src/lib/reviewLetterService.js](src/lib/reviewLetterService.js) 第 136 行（`// Step 4: ...` 注释）之后、`fencedMatch` 变量定义之前，插入以下代码：

```js
  // Step 4a: 先提取 annotations 预标注（必须在 suggested_threads 清洗之前）
  // 使用精确非贪婪正则，只匹配 {"annotations":[...]} 块，不触发贪婪回溯
  let letterAnnotations = null
  const annotationsMatch = rawLetter.match(/\{"annotations"\s*:\s*(\[[\s\S]*?\])\}/)
  if (annotationsMatch) {
    try {
      const parsed = JSON.parse(annotationsMatch[0])
      // 过滤非法标注（start/end 超出正文范围的留空处理，正文长度此处用 rawLetter 估算，
      // 精确过滤在存入 DB 后渲染时由 buildSegments 自动忽略越界片段）
      if (Array.isArray(parsed.annotations)) {
        letterAnnotations = parsed.annotations.filter(
          a => typeof a.start === 'number' && typeof a.end === 'number' && a.start < a.end
        )
      }
    } catch (e) {
      console.warn('[reviewLetter] annotations JSON 解析失败:', e)
    }
  }
  // 从 rawLetter 中剥离 annotations 块，防止干扰后续 suggested_threads 清洗
  const rawLetterNoAnnotations = annotationsMatch
    ? rawLetter.replace(annotationsMatch[0], '')
    : rawLetter
```

然后将后续代码中所有 `rawLetter` 的引用（Step 4 的 `fencedMatch` 等四个 match 变量，以及 `letterContent` 的三条 `.replace()` 链）改为使用 `rawLetterNoAnnotations`：

```js
  // Step 4: 提取末尾 JSON（兼容 AI 输出的各种格式）
  const fencedMatch  = rawLetterNoAnnotations.match(/(?:```+|~~~+)\s*json\s*([\s\S]*?)(?:```+|~~~+)/)
  const fencedMatch2 = rawLetterNoAnnotations.match(/(?:```+|~~~+)\s*(\[[\s\S]*"thread_name"[\s\S]*?\])[\s\S]*?(?:```+|~~~+)/)
  const objectMatch  = rawLetterNoAnnotations.match(/(\{[\s\S]*"suggested_threads"[\s\S]*\})[\s\S]*$/)
  const arrayMatch   = rawLetterNoAnnotations.match(/(\[[\s\S]*"thread_name"[\s\S]*\])/)

  let insights = { suggested_threads: [] }
  let rawJsonStr = null

  if (fencedMatch) {
    rawJsonStr = fencedMatch[1]
  } else if (fencedMatch2) {
    rawJsonStr = fencedMatch2[1]
  } else if (objectMatch) {
    rawJsonStr = objectMatch[1]
  } else if (arrayMatch) {
    rawJsonStr = arrayMatch[1]
  }

  if (rawJsonStr) {
    try {
      const parsed = JSON.parse(rawJsonStr.trim())
      if (Array.isArray(parsed)) {
        insights = { suggested_threads: parsed }
      } else {
        insights = parsed
      }
    } catch (e) {
      console.warn('[reviewLetter] insights JSON 解析失败:', e)
      console.warn('[reviewLetter] rawJsonStr:', rawJsonStr?.slice(0, 300))
      console.warn('[reviewLetter] rawLetter 末尾 500 字符:', rawLetterNoAnnotations.slice(-500))
    }
  } else {
    console.warn('[reviewLetter] 未找到 JSON 块')
    console.warn('[reviewLetter] rawLetter 末尾 500 字符:', rawLetterNoAnnotations.slice(-500))
  }

  const letterContent = rawLetterNoAnnotations
    .replace(/(?:```+|~~~+)\s*(?:json)?\s*[\s\S]*?(?:```+|~~~+)[\s\S]*$/, '')
    .replace(/\{[\s\S]*"suggested_threads"[\s\S]*$/, '')
    .replace(/\[[\s\S]*"thread_name"[\s\S]*$/, '')
    .trim()
```

- [ ] **Step 2：在 Step 5（insert review_letters）中加入 annotations 字段**

找到 `src/lib/reviewLetterService.js` 中 `db.from('review_letters').insert({...})` 的调用（约 L189-198），在对象里追加 `annotations` 字段：

```js
  const { data: letter, error } = await db.from('review_letters').insert({
    user_id: userId,
    entry_ids: entries.map(e => e.id),
    content: letterContent,
    annotations: letterAnnotations,      // ← 新增
    insights,
    trigger_type: prefs.type,
    period_start: periodStart ?? entries[0]?.created_at,
    period_end: periodEnd,
    is_read: false,
  }).select('id').single()
```

- [ ] **Step 3：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 4：Commit**

```bash
git add src/lib/reviewLetterService.js
git commit -m "fix: 回顾信 AI 预标注解析（先提取 annotations 再清洗 suggested_threads）"
```

---

## Task 4：threadService.js — 脉络 AI 预标注解析

**Files:**
- Modify: `src/lib/threadService.js`

在 `generateThreadAnalysis` 函数里，`buildThreadAnalysisPrompt` 目前只要求 AI 输出 `fragments` + `current_state`。需要在 prompt 末尾追加标注指令，解析输出，写入 `current_state_annotations`。

- [ ] **Step 1：在 `buildThreadAnalysisPrompt` 末尾追加标注指令**

打开 [src/lib/prompts.js](src/lib/prompts.js)，在 `buildThreadAnalysisPrompt` 函数的输出格式说明之后、`以下是记录：` 之前，追加：

```js
  return `...（保留原有内容不变）...

────────────────────────────────────
【附加任务：预标注】

写完 fragments 和 current_state 之后，在 JSON 里附加 annotations 字段：
- 加粗（bold）：current_state 里最值得注意的词或短句，不超过 2 处
- 高亮（highlight，straw 色）：最想让用户停留感受的一句话，最多 1 处
- start/end 是 current_state 字符串中的字符偏移（从 0 开始，UTF-16 单位）

{
  "fragments": [...],
  "current_state": "3–5句话，此刻这里。",
  "annotations": [
    { "type": "bold", "start": N, "end": N },
    { "type": "highlight", "color": "straw", "start": N, "end": N }
  ]
}

如果没有合适的标注，annotations 返回空数组 []。

以下是记录：

${entriesText}`
```

完整修改：找到 [src/lib/prompts.js](src/lib/prompts.js) 里 `buildThreadAnalysisPrompt` 的 return 语句末尾，将：

```js
以下是记录：

${entriesText}\``
```

替换为：

```js
────────────────────────────────────
【附加任务：预标注】

写完 fragments 和 current_state 之后，在 JSON 里附加 annotations 字段：
- 加粗（bold）：current_state 里最值得注意的词或短句，不超过 2 处
- 高亮（highlight，straw 色）：最想让用户停留感受的一句话，最多 1 处
- start/end 是 current_state 字符串中的字符偏移（从 0 开始，UTF-16 单位）

输出格式：
{
  "fragments": [...],
  "current_state": "3–5句话，此刻这里。",
  "annotations": [
    { "type": "bold", "start": N, "end": N },
    { "type": "highlight", "color": "straw", "start": N, "end": N }
  ]
}

如果没有合适的标注，annotations 返回空数组 []。

以下是记录：

${entriesText}\``
```

- [ ] **Step 2：在 `generateThreadAnalysis` 的 JSON 解析段落中提取 annotations**

找到 [src/lib/threadService.js](src/lib/threadService.js) L307-318（`let parsed` 开始的 try/catch），在解析后追加 annotations 验证：

```js
  let parsed
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('未找到 JSON 对象')
    parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed.fragments) || typeof parsed.current_state !== 'string') {
      throw new Error('JSON 结构不符预期')
    }
  } catch (e) {
    console.error('[generateThreadAnalysis] JSON 解析失败:', e.message, raw.slice(-300))
    return { error: e }
  }

  // 提取 AI 预标注，过滤非法条目
  const currentStateText = parsed.current_state.trim()
  const rawAnnotations = Array.isArray(parsed.annotations) ? parsed.annotations : []
  const currentStateAnnotations = rawAnnotations.filter(
    a => typeof a.start === 'number'
      && typeof a.end === 'number'
      && a.start >= 0
      && a.end <= currentStateText.length
      && a.start < a.end
  )
```

- [ ] **Step 3：在 DB update 调用中加入 `current_state_annotations`**

找到 L321-328（`db.from('threads').update({...})`），修改为：

```js
  const { error: saveErr } = await db.from('threads')
    .update({
      fragments: parsed.fragments,
      current_state: currentStateText,
      current_state_annotations: currentStateAnnotations.length > 0 ? currentStateAnnotations : null,
      analysis_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId)
    .eq('user_id', userId)
```

- [ ] **Step 4：更新 return 值，包含 `current_state_annotations`**

找到 L336（`return { fragments, current_state, error: null }`），修改为：

```js
  return {
    fragments: parsed.fragments,
    current_state: currentStateText,
    current_state_annotations: currentStateAnnotations.length > 0 ? currentStateAnnotations : null,
    error: null,
  }
```

- [ ] **Step 5：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 6：Commit**

```bash
git add src/lib/threadService.js src/lib/prompts.js
git commit -m "feat: 脉络分析 AI 预标注（current_state_annotations）"
```

---

## Task 5：EditEntryPage.jsx — 编辑保存时清空标注

**Files:**
- Modify: `src/pages/EditEntryPage.jsx`

**规则（来自 spec §九 + 架构审查）：** 清空时机是**保存时**（`handleSave`），不是进入编辑模式时，防止用户取消编辑后标注永久丢失。

- [ ] **Step 1：在 `handleSave` 的两处 `updateEntry` 调用中加入 `annotations: null`**

找到 [src/pages/EditEntryPage.jsx](src/pages/EditEntryPage.jsx) L134-136（无觉察流时的更新）：

```js
        await updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent, created_at: editDatetime.toISOString() } })
```

改为：

```js
        await updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent, created_at: editDatetime.toISOString(), annotations: null } })
```

找到 L145（有觉察流时的更新）：

```js
          updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent, created_at: editDatetime.toISOString() } }),
```

改为：

```js
          updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent, created_at: editDatetime.toISOString(), annotations: null } }),
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：Commit**

```bash
git add src/pages/EditEntryPage.jsx
git commit -m "feat: 编辑保存时清空 annotations（不在进入编辑模式时清空）"
```

---

## Task 6：RecordDetail.jsx — 接入标注系统

**Files:**
- Modify: `src/components/RecordDetail.jsx`

日记正文（`entry.content`）替换为 `<AnnotatedText>`，接入 `useAnnotations` + `useAnnotationInteraction` + `AnnotationMenu`，debounce 1.5 秒自动保存 `annotations` 到 DB。

**范围：** 只标注 `entry.content` 纯文本正文部分，不标注觉察卡片答案。

- [ ] **Step 1：在文件顶部追加 import**

在 [src/components/RecordDetail.jsx](src/components/RecordDetail.jsx) 的已有 import 语句末尾追加：

```jsx
import AnnotatedText from './AnnotatedText'
import AnnotationMenu from './AnnotationMenu'
import { useAnnotations } from '../hooks/useAnnotations'
import { useAnnotationInteraction } from '../hooks/useAnnotationInteraction'
import { updateEntry } from '../lib/journalService'
```

- [ ] **Step 2：在 RecordDetail 组件内初始化 hook + debounce ref**

在 RecordDetail 组件函数体内（`const [fullscreenImg, ...` 等状态变量附近），追加：

```jsx
  // ── 标注系统 ──
  const { annotations, activeColor, setActiveColor, addAnnotation, removeAnnotation, markSaved, dirty } =
    useAnnotations(entry.annotations)

  const contentContainerRef = React.useRef(null)
  const { menuVisible, menuPosition, handleMouseUp, handleTouchEnd, closeMenu, handleBold, handleHighlight, handleUnderline } =
    useAnnotationInteraction({
      containerRef: contentContainerRef,
      rawText: entry.content ?? '',
      addAnnotation,
      activeColor,
    })

  // debounce 1.5 秒自动保存
  const saveTimerRef = React.useRef(null)
  React.useEffect(() => {
    if (!dirty) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        await updateEntry({ id: entry.id, userId: entry.user_id, fields: { annotations } })
        markSaved()
      } catch (e) {
        console.error('[RecordDetail] annotations 保存失败:', e)
      }
    }, 1500)
    return () => clearTimeout(saveTimerRef.current)
  }, [dirty, annotations])
```

- [ ] **Step 3：用 AnnotatedText 替换正文渲染（无觉察流分支）**

找到 L1037-1039（`messages.length === 0` 时的正文 `div`）：

```jsx
              <div style={{ fontSize: 14, color: '#2d2d2d', lineHeight: 1.85, whiteSpace: 'pre-wrap',
                marginBottom: (entry.image_urls ?? []).length > 0 ? 8 : 0 }}>
                {entry.content}
              </div>
```

替换为：

```jsx
              <div
                ref={contentContainerRef}
                style={{ position: 'relative', fontSize: 14, color: '#2d2d2d', lineHeight: 1.85,
                  marginBottom: (entry.image_urls ?? []).length > 0 ? 8 : 0 }}
                onMouseUp={handleMouseUp}
                onTouchEnd={handleTouchEnd}
              >
                <AnnotatedText text={entry.content ?? ''} annotations={annotations} />
                <AnnotationMenu
                  visible={menuVisible}
                  position={menuPosition}
                  activeColor={activeColor}
                  onBold={handleBold}
                  onHighlight={handleHighlight}
                  onUnderline={handleUnderline}
                  onColorChange={setActiveColor}
                  onClose={closeMenu}
                />
              </div>
```

- [ ] **Step 4：用 AnnotatedText 替换正文渲染（有觉察流 raw_entry 分支）**

找到 L1064-1071（`msg.nodeType === 'raw_entry'` 时的正文 `div`）：

```jsx
                    <div style={{
                      fontSize: 14, color: '#2d2d2d',
                      lineHeight: 1.85, marginBottom: imgs.length > 0 ? 8 : 20,
                      whiteSpace: 'pre-wrap',
                    }}>
                      {msg.content}
                    </div>
```

替换为：

```jsx
                    <div
                      ref={contentContainerRef}
                      style={{
                        position: 'relative',
                        fontSize: 14, color: '#2d2d2d',
                        lineHeight: 1.85, marginBottom: imgs.length > 0 ? 8 : 20,
                      }}
                      onMouseUp={handleMouseUp}
                      onTouchEnd={handleTouchEnd}
                    >
                      <AnnotatedText text={msg.content ?? ''} annotations={annotations} />
                      <AnnotationMenu
                        visible={menuVisible}
                        position={menuPosition}
                        activeColor={activeColor}
                        onBold={handleBold}
                        onHighlight={handleHighlight}
                        onUnderline={handleUnderline}
                        onColorChange={setActiveColor}
                        onClose={closeMenu}
                      />
                    </div>
```

- [ ] **Step 5：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 6：Commit**

```bash
git add src/components/RecordDetail.jsx
git commit -m "feat: 日记详情接入标注系统（AnnotatedText + 长按菜单 + debounce 保存）"
```

---

## Task 7：ReviewLetterDetail.jsx — 接入标注系统

**Files:**
- Modify: `src/components/ReviewLetterDetail.jsx`

回顾信正文替换为 `<AnnotatedText>`，初始 `annotations` 从 `letter.annotations`（DB 读取，含 AI 预标注）加载，用户可追加，debounce 1.5 秒保存到 `review_letters.annotations`。

- [ ] **Step 1：在文件顶部追加 import**

```jsx
import AnnotatedText from './AnnotatedText'
import AnnotationMenu from './AnnotationMenu'
import { useAnnotations } from '../hooks/useAnnotations'
import { useAnnotationInteraction } from '../hooks/useAnnotationInteraction'
import { db } from '../lib/db'
```

- [ ] **Step 2：在组件内初始化 hook + debounce**

```jsx
  // ── 标注系统 ──
  const { annotations, activeColor, setActiveColor, addAnnotation, markSaved, dirty } =
    useAnnotations(letter.annotations)

  const letterContainerRef = React.useRef(null)
  const { menuVisible, menuPosition, handleMouseUp, handleTouchEnd, closeMenu, handleBold, handleHighlight, handleUnderline } =
    useAnnotationInteraction({
      containerRef: letterContainerRef,
      rawText: letter.content ?? '',
      addAnnotation,
      activeColor,
    })

  const saveTimerRef = React.useRef(null)
  React.useEffect(() => {
    if (!dirty) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        await db.from('review_letters')
          .update({ annotations })
          .eq('id', letter.id)
        markSaved()
      } catch (e) {
        console.error('[ReviewLetterDetail] annotations 保存失败:', e)
      }
    }, 1500)
    return () => clearTimeout(saveTimerRef.current)
  }, [dirty, annotations])
```

- [ ] **Step 3：替换正文渲染（L95-101）**

将：

```jsx
        <div style={{
          fontSize: 15, color: '#2d2d2d', lineHeight: 1.85,
          marginBottom: 24, whiteSpace: 'pre-wrap',
        }}>
          {letter.content}
        </div>
```

替换为：

```jsx
        <div
          ref={letterContainerRef}
          style={{ position: 'relative', fontSize: 15, color: '#2d2d2d', lineHeight: 1.85, marginBottom: 24 }}
          onMouseUp={handleMouseUp}
          onTouchEnd={handleTouchEnd}
        >
          <AnnotatedText text={letter.content ?? ''} annotations={annotations} />
          <AnnotationMenu
            visible={menuVisible}
            position={menuPosition}
            activeColor={activeColor}
            onBold={handleBold}
            onHighlight={handleHighlight}
            onUnderline={handleUnderline}
            onColorChange={setActiveColor}
            onClose={closeMenu}
          />
        </div>
```

- [ ] **Step 4：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 5：Commit**

```bash
git add src/components/ReviewLetterDetail.jsx
git commit -m "feat: 回顾信接入标注系统（AI 预标注 + 用户追加 + debounce 保存）"
```

---

## Task 8：ThreadDetailPage.jsx — 接入标注系统

**Files:**
- Modify: `src/pages/ThreadDetailPage.jsx`

「此刻这里」（`thread.current_state`）替换为 `<AnnotatedText>`，初始 `annotations` 从 `thread.current_state_annotations` 加载。归档脉络（`thread.status === 'archived'`）只读展示，不挂长按事件。

- [ ] **Step 1：在文件顶部追加 import**

```jsx
import AnnotatedText from '../components/AnnotatedText'
import AnnotationMenu from '../components/AnnotationMenu'
import { useAnnotations } from '../hooks/useAnnotations'
import { useAnnotationInteraction } from '../hooks/useAnnotationInteraction'
import { db } from '../lib/db'
```

- [ ] **Step 2：在组件内初始化 hook + debounce**

注意：`thread` 对象在异步加载后才有值。`useAnnotations(thread?.current_state_annotations)` 在 mount 时 thread 为 null，所以 annotations 初始为 `[]`。thread 加载完成后 hook 内部的 state 不会自动更新——必须用 `resetAnnotations` 显式同步：

```jsx
  // ── 标注系统（此刻这里）──
  const { annotations, activeColor, setActiveColor, addAnnotation, markSaved, resetAnnotations, dirty } =
    useAnnotations(thread?.current_state_annotations)

  // thread 异步加载后，同步初始标注（防止 mount 时 thread 为 null 导致初始值为 []）
  const prevThreadIdRef = React.useRef(null)
  React.useEffect(() => {
    if (thread?.id && thread.id !== prevThreadIdRef.current) {
      prevThreadIdRef.current = thread.id
      resetAnnotations(thread.current_state_annotations)
    }
  }, [thread?.id, thread?.current_state_annotations])

  const currentStateRef = React.useRef(null)
  const isArchived = thread?.status === 'archived'
  const { menuVisible, menuPosition, handleMouseUp, handleTouchEnd, closeMenu, handleBold, handleHighlight, handleUnderline } =
    useAnnotationInteraction({
      containerRef: currentStateRef,
      rawText: thread?.current_state ?? '',
      addAnnotation,
      activeColor,
    })

  const saveTimerRef = React.useRef(null)
  React.useEffect(() => {
    if (!dirty || !thread?.id) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        await db.from('threads')
          .update({ current_state_annotations: annotations })
          .eq('id', thread.id)
        markSaved()
      } catch (e) {
        console.error('[ThreadDetailPage] current_state_annotations 保存失败:', e)
      }
    }, 1500)
    return () => clearTimeout(saveTimerRef.current)
  }, [dirty, annotations, thread?.id])
```

- [ ] **Step 3：替换「此刻这里」渲染（L503-507）**

将：

```jsx
            <div style={{ fontSize: 14, color: '#444', lineHeight: 1.85, whiteSpace: 'pre-wrap' }}>
              {thread.current_state}
            </div>
```

替换为：

```jsx
            <div
              ref={currentStateRef}
              style={{ position: 'relative', fontSize: 14, color: '#444', lineHeight: 1.85 }}
              onMouseUp={isArchived ? undefined : handleMouseUp}
              onTouchEnd={isArchived ? undefined : handleTouchEnd}
            >
              <AnnotatedText text={thread.current_state ?? ''} annotations={annotations} />
              {!isArchived && (
                <AnnotationMenu
                  visible={menuVisible}
                  position={menuPosition}
                  activeColor={activeColor}
                  onBold={handleBold}
                  onHighlight={handleHighlight}
                  onUnderline={handleUnderline}
                  onColorChange={setActiveColor}
                  onClose={closeMenu}
                />
              )}
            </div>
```

- [ ] **Step 4：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 5：Commit**

```bash
git add src/pages/ThreadDetailPage.jsx
git commit -m "feat: 脉络详情「此刻这里」接入标注系统（归档只读）"
```

---

## 自检结果

**Spec 覆盖检查：**

| Spec 章节 | 对应 Task |
|---|---|
| §三 长按弹出菜单（B/U/▌/四色点） | Task 1 AnnotationMenu ✅ |
| §三 活动色记忆（localStorage） | Part 1 Task 2 useAnnotations ✅ |
| §四 日记 content 用户标注 | Task 6 RecordDetail ✅ |
| §四 回顾信 AI 预标注 + 用户追加 | Task 3 reviewLetterService + Task 7 ✅ |
| §四 脉络 current_state AI 预标注 + 用户追加 | Task 4 threadService + Task 8 ✅ |
| §四 归档脉络只读 | Task 8（isArchived 判断）✅ |
| §六 AI 预标注触发时机 + 格式 | Task 3（回顾信）+ Task 4（脉络）✅ |
| §六 start/end 合法性过滤 | Task 3 + Task 4 均有 filter ✅ |
| §七 AnnotatedText 接入阅读视图 | Task 6/7/8 ✅ |
| §八 debounce 1.5 秒保存 | Task 6/7/8 均有 setTimeout 1500 ✅ |
| §九 编辑保存时清空 annotations: null | Task 5 EditEntryPage ✅ |
| §九 AI 标注 start/end 超出则过滤 | Task 3 + Task 4 ✅ |
| §九 多条标注重叠允许 | AnnotatedText.buildSegments 已处理（Part 1）✅ |
| §九 归档脉络标注只读 | Task 8 isArchived ✅ |

**阻塞性问题修复确认：**
1. ✅ annotations JSON 解析在 suggested_threads 清洗之前（Task 3 Step 1 先提取再剥离）
2. ✅ 移动端 getSelection() 用 `setTimeout(0)` + `length > 0` 守门（Task 2 `tryShowMenu`）
3. ✅ start/end 基准是同一原始 text 字符串（useAnnotationInteraction 用 `rawText` prop，同源于 DB `content` 字段）
4. ✅ 清空标注在 updateEntry 保存时（Task 5），不在进入编辑模式时

**占位符扫描：** 无 TBD / TODO / "类似上面"

**类型一致性：**
- `useAnnotations.addAnnotation(type, color, start, end)` 参数顺序与 `useAnnotationInteraction` 内部调用一致
- `AnnotationMenu.onColorChange(colorId)` 与 `useAnnotations.setActiveColor(colorId)` 签名一致
- `useAnnotationInteraction` 的 `rawText` prop 与 `AnnotatedText` 的 `text` prop 必须来自同一 DB 字段（`entry.content` / `letter.content` / `thread.current_state`），不得做任何变换
- `resetAnnotations(newAnnotations)` 由 Part 1 useAnnotations 导出，Task 8 Step 2 在 thread 异步加载后调用，解决 mount 时初始值为 `[]` 的陷阱

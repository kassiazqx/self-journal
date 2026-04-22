# 富文本标注系统 Part 1：基础层 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立标注系统的基础设施：DB 字段、颜色配置、`useAnnotations` hook、`AnnotatedText` 渲染组件。

**Architecture:** 标注以 JSON 数组独立存储，不嵌入文本字段，保持 `content` / `current_state` 等字段纯文本。`annotationConfig.js` 集中管理颜色，`useAnnotations.js` 封装所有状态与持久化逻辑，`AnnotatedText.jsx` 负责将文字 + 标注数组渲染为 SVG 高亮/下划线/加粗效果。Part 2 负责把这些组件接入各页面并实现长按交互。

**Tech Stack:** React hooks, SVG, localStorage, Supabase jsonb, Tailwind CSS（现有项目配置）

**Spec 文件：** `docs/superpowers/specs/2026-04-22-annotation-system-design.md`

---

## 文件改动地图

| 文件 | 动作 | 说明 |
|---|---|---|
| Supabase SQL（控制台手动执行） | 新增 3 个 jsonb 字段 | annotations × 2，current_state_annotations × 1 |
| `src/lib/annotationConfig.js` | **新建** | 莫兰迪四色配置，唯一颜色来源 |
| `src/hooks/useAnnotations.js` | **新建** | 标注 state、add/remove、activeColor + localStorage |
| `src/components/AnnotatedText.jsx` | **新建** | 渲染组件，输入 text + annotations，输出带 SVG 标注的内联块 |

---

## Task 0：数据库迁移（手动在 Supabase 控制台执行）

**Files:**
- 无代码改动，在 Supabase 控制台 SQL Editor 执行

这三条语句给现有表加上 jsonb 标注字段，默认值为 `null`（无标注时不占空间）。

- [ ] **Step 1：登录 Supabase 控制台**

前往 https://supabase.com → 进入 self-journal 项目 → 左侧菜单 SQL Editor

- [ ] **Step 2：执行以下 SQL**

```sql
-- 日记原文的用户标注
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS annotations jsonb DEFAULT NULL;

-- 回顾信的 AI 预标注 + 用户追加
ALTER TABLE review_letters
  ADD COLUMN IF NOT EXISTS annotations jsonb DEFAULT NULL;

-- 脉络「此刻这里」的 AI 预标注 + 用户追加
ALTER TABLE threads
  ADD COLUMN IF NOT EXISTS current_state_annotations jsonb DEFAULT NULL;
```

- [ ] **Step 3：验证字段已创建**

在 SQL Editor 执行：

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('journal_entries', 'review_letters', 'threads')
  AND column_name IN ('annotations', 'current_state_annotations')
ORDER BY table_name, column_name;
```

期望输出 3 行：
- `journal_entries` / `annotations` / `jsonb`
- `review_letters` / `annotations` / `jsonb`
- `threads` / `current_state_annotations` / `jsonb`

---

## Task 1：annotationConfig.js — 颜色配置

**Files:**
- Create: `src/lib/annotationConfig.js`

颜色系统的唯一来源。所有组件从这里读颜色，不写死在 JSX 里。预留 `user_preferences.annotation_colors` 字段供未来用户自定义（Part 2 以后的事）。

- [ ] **Step 1：创建文件**

```js
// src/lib/annotationConfig.js

export const DEFAULT_ANNOTATION_COLORS = [
  { id: 'straw', label: '暖米', hex: '#C8A87A' },
  { id: 'pink',  label: '藕粉', hex: '#C4A0A2' },
  { id: 'sage',  label: '雾绿', hex: '#8DB0A4' },
  { id: 'slate', label: '灰蓝', hex: '#8FAABC' },
]

/**
 * 根据 color id 返回 hex 值。找不到则返回默认暖米色。
 * @param {string} colorId - 'straw' | 'pink' | 'sage' | 'slate'
 * @returns {string} hex 颜色字符串
 */
export function getAnnotationColor(colorId) {
  return (
    DEFAULT_ANNOTATION_COLORS.find(c => c.id === colorId)?.hex
    ?? DEFAULT_ANNOTATION_COLORS[0].hex
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
git add src/lib/annotationConfig.js
git commit -m "feat: 标注颜色配置（annotationConfig.js）"
```

---

## Task 2：useAnnotations.js — 标注状态 Hook

**Files:**
- Create: `src/hooks/useAnnotations.js`

封装全部标注逻辑，页面层只调用这个 hook，不直接操作 localStorage 或 DB。

**规则：**
- `activeColor` 存 `localStorage`，key 为 `annotation_active_color`，初始值为 `'straw'`
- `addAnnotation` 追加一条，重叠处理交给渲染层
- `removeAnnotation(idx)` 按数组下标删除
- `dirty` 为 true 表示有未持久化变更（供父组件 debounce 保存）

- [ ] **Step 1：创建文件**

```js
// src/hooks/useAnnotations.js
import { useState, useCallback } from 'react'

const LS_COLOR_KEY = 'annotation_active_color'

/**
 * @param {Array} initialAnnotations - 从 DB 读取的初始标注数组（可为 null/undefined）
 */
export function useAnnotations(initialAnnotations) {
  const [annotations, setAnnotations] = useState(
    Array.isArray(initialAnnotations) ? initialAnnotations : []
  )
  const [activeColor, setActiveColorState] = useState(() => {
    try {
      return localStorage.getItem(LS_COLOR_KEY) ?? 'straw'
    } catch {
      return 'straw'
    }
  })
  const [dirty, setDirty] = useState(false)

  const setActiveColor = useCallback((colorId) => {
    setActiveColorState(colorId)
    try {
      localStorage.setItem(LS_COLOR_KEY, colorId)
    } catch { /* ignore */ }
  }, [])

  /**
   * 新增一条标注。
   * @param {'bold'|'highlight'|'underline'} type
   * @param {string|undefined} color - bold 时传 undefined；否则传 colorId
   * @param {number} start - UTF-16 字符偏移，inclusive
   * @param {number} end   - UTF-16 字符偏移，exclusive
   */
  const addAnnotation = useCallback((type, color, start, end) => {
    if (start >= end) return
    const entry = type === 'bold'
      ? { type, start, end }
      : { type, start, end, color }
    setAnnotations(prev => [...prev, entry])
    setDirty(true)
  }, [])

  /**
   * 删除指定下标的标注。
   * @param {number} idx
   */
  const removeAnnotation = useCallback((idx) => {
    setAnnotations(prev => prev.filter((_, i) => i !== idx))
    setDirty(true)
  }, [])

  /**
   * 外部保存成功后调用，重置 dirty。
   */
  const markSaved = useCallback(() => setDirty(false), [])

  /**
   * 清空所有标注（日记内容编辑保存时调用）。
   */
  const clearAll = useCallback(() => {
    setAnnotations([])
    setDirty(true)
  }, [])

  /**
   * 重置为新的初始标注数组（用于异步加载场景，如 ThreadDetailPage）。
   * 调用后 dirty 重置为 false，视为"刚从 DB 加载"的干净状态。
   * @param {Array|null} newAnnotations
   */
  const resetAnnotations = useCallback((newAnnotations) => {
    setAnnotations(Array.isArray(newAnnotations) ? newAnnotations : [])
    setDirty(false)
  }, [])

  return { annotations, activeColor, setActiveColor, addAnnotation, removeAnnotation, markSaved, clearAll, resetAnnotations, dirty }
}
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：Commit**

```bash
git add src/hooks/useAnnotations.js
git commit -m "feat: useAnnotations hook（标注状态 + activeColor + localStorage）"
```

---

## Task 3：AnnotatedText.jsx — 渲染组件

**Files:**
- Create: `src/components/AnnotatedText.jsx`

将纯文本 + 标注数组渲染为内联带标注的 React 元素。

**核心设计：**
1. 按 `start` 排序 annotations，将文本切割为片段
2. 每个片段可能叠加多种标注（highlight 在最底层，bold 在最上层）
3. 高亮和下划线用 SVG，加粗用 `font-weight: 700`
4. SVG 单位坐标（0–1），`preserveAspectRatio="none"` 自适应文字宽度
5. 每条高亮/下划线用 `useMemo` 生成随机旋转角，避免每次 render 重新随机

- [ ] **Step 1：创建文件**

```jsx
// src/components/AnnotatedText.jsx
import React, { useMemo } from 'react'
import { getAnnotationColor } from '../lib/annotationConfig'

/**
 * 将文本切割为带标注信息的片段。
 * 允许同一位置叠加多个标注（如 bold + highlight）。
 *
 * @param {string} text
 * @param {Array} annotations - [{type, start, end, color?}]
 * @returns {Array} segments: [{text, start, end, types: Set, colors: {highlight?, underline?}}]
 */
function buildSegments(text, annotations) {
  if (!annotations.length) return [{ text, start: 0, end: text.length, types: new Set(), colors: {} }]

  // 收集所有边界点
  const points = new Set([0, text.length])
  for (const a of annotations) {
    if (a.start >= 0 && a.start < text.length) points.add(a.start)
    if (a.end > 0 && a.end <= text.length) points.add(a.end)
  }
  const sorted = [...points].sort((a, b) => a - b)

  return sorted.slice(0, -1).map((s, i) => {
    const e = sorted[i + 1]
    const types = new Set()
    const colors = {}
    for (const a of annotations) {
      if (a.start <= s && a.end >= e) {
        types.add(a.type)
        if (a.color) colors[a.type] = a.color
      }
    }
    return { text: text.slice(s, e), start: s, end: e, types, colors }
  })
}

// SVG path 数据：手写风格高亮笔刷（单位坐标 0–1）
const HIGHLIGHT_PATHS = [
  'M0.01,0.18 C0.08,0.10 0.22,0.22 0.38,0.14 C0.54,0.06 0.70,0.20 0.86,0.12 C0.94,0.08 0.98,0.14 0.99,0.16 L0.99,0.82 C0.92,0.90 0.78,0.78 0.62,0.86 C0.46,0.94 0.30,0.80 0.14,0.88 C0.07,0.92 0.02,0.86 0.01,0.84 Z',
  'M0.01,0.20 C0.09,0.10 0.25,0.24 0.42,0.14 C0.58,0.04 0.74,0.22 0.88,0.12 C0.94,0.08 0.99,0.16 0.99,0.18 L0.99,0.80 C0.91,0.90 0.75,0.76 0.58,0.86 C0.42,0.96 0.26,0.78 0.11,0.88 C0.06,0.92 0.01,0.84 0.01,0.82 Z',
  'M0.01,0.22 C0.10,0.10 0.28,0.26 0.46,0.14 C0.62,0.04 0.78,0.22 0.90,0.12 C0.95,0.08 0.99,0.16 0.99,0.18 L0.99,0.82 C0.90,0.92 0.72,0.76 0.55,0.86 C0.39,0.96 0.23,0.78 0.09,0.88 C0.04,0.92 0.01,0.84 0.01,0.82 Z',
]

// SVG path 数据：波浪下划线（viewBox "0 0 100 6"）
const WAVE_PATH = 'M0,3 C8,1 16,5 24,3 C32,1 40,5 48,3 C56,1 64,5 72,3 C80,1 88,5 96,3 C98,2.5 99.5,3 100,3'

/**
 * 单个文字片段的渲染单元。
 * isBold / hasHighlight / hasUnderline 决定叠加效果。
 */
function Segment({ seg, rotation, pathIdx }) {
  const isBold = seg.types.has('bold')
  const hasHighlight = seg.types.has('highlight')
  const hasUnderline = seg.types.has('underline')
  const highlightColor = seg.colors.highlight
  const underlineColor = seg.colors.underline
  const hlHex = highlightColor ? getAnnotationColor(highlightColor) : null
  const ulHex = underlineColor ? getAnnotationColor(underlineColor) : null

  // 纯文字，无任何标注
  if (!isBold && !hasHighlight && !hasUnderline) {
    return <span>{seg.text}</span>
  }

  const textNode = <span style={{ position: 'relative', zIndex: 1, fontWeight: isBold ? 700 : undefined }}>{seg.text}</span>

  // 下划线包裹
  const withUnderline = hasUnderline ? (
    <span style={{ display: 'inline', position: 'relative', whiteSpace: 'nowrap' }}>
      <svg
        style={{ position: 'absolute', left: 0, bottom: -3, width: '100%', height: 6, pointerEvents: 'none' }}
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
      >
        <path d={WAVE_PATH} fill="none" stroke={ulHex} strokeWidth="1.8" strokeOpacity="0.75" strokeLinecap="round" />
      </svg>
      {textNode}
    </span>
  ) : textNode

  // 高亮包裹（在下划线之外，层级更低）
  if (hasHighlight) {
    const svgId = `hl-${seg.start}-${seg.end}`
    const gradId = `g-${seg.start}-${seg.end}`
    const path = HIGHLIGHT_PATHS[pathIdx % HIGHLIGHT_PATHS.length]
    return (
      <span style={{ display: 'inline', position: 'relative', whiteSpace: 'nowrap' }}>
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            left: -3,
            top: '50%',
            transform: `translateY(-55%) rotate(${rotation}deg)`,
            width: 'calc(100% + 6px)',
            height: '1.6em',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
              <stop stopColor={hlHex} offset="0%"   stopOpacity="0.82" />
              <stop stopColor={hlHex} offset="8%"   stopOpacity="0.50" />
              <stop stopColor={hlHex} offset="50%"  stopOpacity="0.40" />
              <stop stopColor={hlHex} offset="92%"  stopOpacity="0.52" />
              <stop stopColor={hlHex} offset="100%" stopOpacity="0.82" />
            </linearGradient>
          </defs>
          <path d={path} fill={`url(#${gradId})`} />
        </svg>
        {withUnderline}
      </span>
    )
  }

  return withUnderline
}

/**
 * AnnotatedText：将 text + annotations 渲染为带高亮/加粗/下划线的内联内容。
 *
 * ⚠️ 架构约束：text 和 annotations 的 start/end 必须基于同一个原始字符串，
 *    不能对 text 进行任何 trim() 或变换后再传入。
 *
 * @param {string} text - 原始纯文本（与 DB 中存储的字段完全一致）
 * @param {Array}  annotations - [{type, start, end, color?}]，可为 null/undefined
 * @param {object} style - 透传给外层 span 的 style
 */
export default function AnnotatedText({ text, annotations, style }) {
  const sorted = useMemo(() => {
    if (!Array.isArray(annotations) || !annotations.length) return []
    return [...annotations].sort((a, b) => a.start - b.start)
  }, [annotations])

  // 每条高亮的随机旋转角和路径索引，mount 时固定，不随 render 变
  const hlMeta = useMemo(() => {
    return sorted.map((a, i) => ({
      rotation: (((i * 137 + 11) % 9) - 4) * 0.1, // 伪随机 ±0.4°，无真随机确保 SSR 稳定
      pathIdx: i % HIGHLIGHT_PATHS.length,
    }))
  }, [sorted])

  const segments = useMemo(() => buildSegments(text ?? '', sorted), [text, sorted])

  return (
    <span style={style}>
      {segments.map((seg, i) => (
        <Segment
          key={`${seg.start}-${seg.end}`}
          seg={seg}
          rotation={hlMeta[i]?.rotation ?? 0}
          pathIdx={hlMeta[i]?.pathIdx ?? 0}
        />
      ))}
    </span>
  )
}
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：本地验收（目视检查）**

```bash
npm run dev
```

在浏览器控制台里临时测试渲染：在任意页面打开 React DevTools，找到任意组件，确认 `AnnotatedText` 可以被 import。（正式集成在 Part 2）

- [ ] **Step 4：Commit**

```bash
git add src/components/AnnotatedText.jsx
git commit -m "feat: AnnotatedText 渲染组件（高亮/加粗/下划线 SVG）"
```

---

## 自检结果

**Spec 覆盖检查：**

| Spec 章节 | 对应 Task |
|---|---|
| §二 颜色系统 / annotationConfig.js | Task 1 ✅ |
| §五 数据模型 / DB 字段 | Task 0 ✅ |
| §七 渲染方案 / AnnotatedText 组件 | Task 3 ✅ |
| §八 useAnnotations hook | Task 2 ✅ |
| §八 activeColor → localStorage | Task 2 ✅ |
| §九 编辑时清空标注（clearAll） | Task 2 ✅（clearAll 方法） |
| 异步加载重置初始标注（ThreadDetailPage） | Task 2 ✅（resetAnnotations 方法） |

**Part 2 负责（本计划不涉及）：**
- §三 长按弹出菜单交互
- §六 AI 预标注解析（annotations JSON 先于 suggested_threads 提取）
- §四 各页面集成 AnnotatedText + useAnnotations
- §八 debounce 1.5 秒保存到 DB
- §九 编辑保存时调用 clearAll + 写 annotations: null

**占位符扫描：** 无 TBD / TODO / "类似上面"

**类型一致性：**
- `useAnnotations` 返回的 `annotations` 数组格式与 `AnnotatedText` 接受的 `annotations` prop 格式一致（均为 `[{type, start, end, color?}]`）
- `addAnnotation(type, color, start, end)` 的参数顺序在 hook 和后续 Part 2 调用点一致
- `getAnnotationColor(colorId)` 在 Task 1 定义，Task 3 调用，函数名一致
- `resetAnnotations(newAnnotations)` 导出给 Part 2 Task 8（ThreadDetailPage 异步加载后同步初始值）

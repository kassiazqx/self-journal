# 富文本标注系统 Part 2.5：交互增强 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有标注系统基础上，实现三条交互规则：Rule 1（选区重叠已标注 → 菜单加取消按钮），Rule 2（选区全覆盖同类型 → 点击 toggle），Rule 3（单击已标注区域 → 唤起菜单）。

**Architecture:** `useAnnotations` 新增 `clipAnnotations` 方法；`useAnnotationInteraction` 新增 `annotations`/`clipAnnotations` 输入参数和 `hasOverlap`/`handleCancel`/`openMenuForRange` 输出；`AnnotationMenu` 新增取消按钮；`AnnotatedText` 新增 `onAnnotatedClick` prop；三个接入页更新 hook 调用和组件 prop。

**Tech Stack:** 现有技术栈（React hooks，无新依赖）

**Spec 文件：** `docs/superpowers/specs/2026-04-22-annotation-interaction-enhancement-design.md`

**前置条件：** Part 1 & 2 已完成。以下文件已存在且可正常工作：
- `src/hooks/useAnnotations.js`
- `src/hooks/useAnnotationInteraction.js`
- `src/components/AnnotationMenu.jsx`
- `src/components/AnnotatedText.jsx`
- `src/components/RecordDetail.jsx`
- `src/components/ReviewLetterDetail.jsx`
- `src/pages/ThreadDetailPage.jsx`

---

## 文件改动地图

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/hooks/useAnnotations.js` | **修改** | 新增 `clipAnnotations` 方法 |
| `src/hooks/useAnnotationInteraction.js` | **修改** | 新增 `annotations`/`clipAnnotations` 参数，新增 `hasOverlap`/`handleCancel`/`openMenuForRange`，更新 handle* toggle 逻辑 |
| `src/components/AnnotationMenu.jsx` | **修改** | 新增 `showCancel`/`onCancel` prop，渲染「✕」按钮 |
| `src/components/AnnotatedText.jsx` | **修改** | 新增 `onAnnotatedClick` prop，Segment 有标注时注册 onClick |
| `src/components/RecordDetail.jsx` | **修改** | 传新 props：`annotations`/`clipAnnotations` → interaction hook；`showCancel`/`onCancel` → Menu；`onAnnotatedClick` → AnnotatedText |
| `src/components/ReviewLetterDetail.jsx` | **修改** | 同上 |
| `src/pages/ThreadDetailPage.jsx` | **修改** | 同上 |

---

## Task 1：useAnnotations.js — 新增 clipAnnotations

**Files:**
- Modify: `src/hooks/useAnnotations.js`

- [ ] **Step 1：在 `clearAll` 之后、`resetAnnotations` 之前插入 `clipAnnotations`**

找到文件中 `resetAnnotations` 函数定义的上方，插入：

```js
  /**
   * 剪切掉 [clipStart, clipEnd) 范围内的标注（或指定类型）。
   * 超出范围的部分保留为新的标注条目。
   *
   * @param {number} clipStart
   * @param {number} clipEnd
   * @param {'all'|'bold'|'highlight'|'underline'} typesToClip - 'all' 剪切所有类型
   */
  const clipAnnotations = useCallback((clipStart, clipEnd, typesToClip = 'all') => {
    setAnnotations(prev => {
      const result = []
      for (const a of prev) {
        const shouldClip = typesToClip === 'all' || typesToClip === a.type
        if (!shouldClip || a.end <= clipStart || a.start >= clipEnd) {
          result.push(a)   // 不在范围内，或不是目标类型 → 原样保留
          continue
        }
        // 与剪切区间重叠且是目标类型：两侧残留加入，中间剪掉
        if (a.start < clipStart) result.push({ ...a, end: clipStart })
        if (a.end > clipEnd)     result.push({ ...a, start: clipEnd })
      }
      return result
    })
    setDirty(true)
  }, [])
```

- [ ] **Step 2：把 `clipAnnotations` 加入 return**

找到文件末尾的 return 语句：

```js
  return { annotations, activeColor, setActiveColor, addAnnotation, removeAnnotation, markSaved, clearAll, resetAnnotations, dirty }
```

改为：

```js
  return { annotations, activeColor, setActiveColor, addAnnotation, removeAnnotation, markSaved, clearAll, clipAnnotations, resetAnnotations, dirty }
```

- [ ] **Step 3：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 4：Commit**

```bash
git add src/hooks/useAnnotations.js
git commit -m "feat: useAnnotations 新增 clipAnnotations（剪切指定范围标注）"
```

---

## Task 2：useAnnotationInteraction.js — 新增参数和逻辑

**Files:**
- Modify: `src/hooks/useAnnotationInteraction.js`

改动较多，分步进行。

- [ ] **Step 1：更新函数签名，新增 `annotations` 和 `clipAnnotations` 参数**

找到：

```js
export function useAnnotationInteraction({ containerRef, rawText, addAnnotation, activeColor }) {
```

改为：

```js
export function useAnnotationInteraction({ containerRef, rawText, addAnnotation, clipAnnotations, activeColor, annotations }) {
```

- [ ] **Step 2：新增 `isFullyCovered` 工具函数**

在 `export function useAnnotationInteraction` 函数体内部，`const [menuVisible, ...]` 之前，插入：

```js
  // 判断 [selStart, selEnd) 内每个字符是否都被 type 类型标注覆盖
  function isFullyCovered(selStart, selEnd, type) {
    const ofType = (annotations ?? []).filter(
      a => a.type === type && a.end > selStart && a.start < selEnd
    )
    if (!ofType.length) return false
    const sorted = [...ofType].sort((a, b) => a.start - b.start)
    let covered = selStart
    for (const a of sorted) {
      if (a.start > covered) return false   // 有间隙
      covered = Math.max(covered, a.end)
      if (covered >= selEnd) return true
    }
    return covered >= selEnd
  }
```

- [ ] **Step 3：新增 `hasOverlap` state**

在 `const [menuVisible, ...]` 那行之后追加：

```js
  const [hasOverlap, setHasOverlap] = useState(false)
```

- [ ] **Step 4：在 `tryShowMenu` 中计算 `hasOverlap`**

找到 `tryShowMenu` 函数内，`setMenuPosition(...)` 之前，找到：

```js
    setMenuPosition({ top, left })
    setMenuVisible(true)
```

改为：

```js
    const overlaps = (annotations ?? []).some(
      a => a.start < offsets.end && a.end > offsets.start
    )
    setHasOverlap(overlaps)
    setMenuPosition({ top, left })
    setMenuVisible(true)
```

- [ ] **Step 5：在 `closeMenu` 中重置 `hasOverlap`**

找到 `closeMenu` 函数体：

```js
  const closeMenu = useCallback(() => {
    setMenuVisible(false)
    pendingRangeRef.current = null
    window.getSelection()?.removeAllRanges()
  }, [])
```

改为：

```js
  const closeMenu = useCallback(() => {
    setMenuVisible(false)
    setHasOverlap(false)
    pendingRangeRef.current = null
    window.getSelection()?.removeAllRanges()
  }, [])
```

- [ ] **Step 6：更新 `handleBold` / `handleHighlight` / `handleUnderline` 加入 toggle 逻辑（Rule 2）**

找到原有的 `applyAnnotation` 函数和三个 handle 定义：

```js
  function applyAnnotation(type, color) {
    const r = pendingRangeRef.current
    if (!r) return
    addAnnotation(type, color, r.start, r.end)
    closeMenu()
  }

  const handleBold      = useCallback(() => applyAnnotation('bold', undefined),       [addAnnotation, closeMenu])
  const handleHighlight = useCallback(() => applyAnnotation('highlight', activeColor), [addAnnotation, activeColor, closeMenu])
  const handleUnderline = useCallback(() => applyAnnotation('underline', activeColor), [addAnnotation, activeColor, closeMenu])
```

替换为：

```js
  function applyAnnotation(type, color) {
    const r = pendingRangeRef.current
    if (!r) return
    if (isFullyCovered(r.start, r.end, type)) {
      // Rule 2：toggle — 选区被该类型完全覆盖，点击 = 取消
      clipAnnotations(r.start, r.end, type)
    } else {
      addAnnotation(type, color, r.start, r.end)
    }
    closeMenu()
  }

  const handleBold      = useCallback(() => applyAnnotation('bold', undefined),       [addAnnotation, clipAnnotations, activeColor, closeMenu, annotations])
  const handleHighlight = useCallback(() => applyAnnotation('highlight', activeColor), [addAnnotation, clipAnnotations, activeColor, closeMenu, annotations])
  const handleUnderline = useCallback(() => applyAnnotation('underline', activeColor), [addAnnotation, clipAnnotations, activeColor, closeMenu, annotations])
```

- [ ] **Step 7：新增 `handleCancel`（Rule 1 取消）**

在 handleUnderline 之后追加：

```js
  // Rule 1：取消 — 剪切选区内所有类型的所有标注
  const handleCancel = useCallback(() => {
    const r = pendingRangeRef.current
    if (!r) return
    clipAnnotations(r.start, r.end, 'all')
    closeMenu()
  }, [clipAnnotations, closeMenu])
```

- [ ] **Step 8：新增 `openMenuForRange`（Rule 3 单击已标注区域）**

在 `handleCancel` 之后追加：

```js
  // Rule 3：单击已标注 Segment → 以覆盖该 segment 的所有标注的并集为虚拟选区，弹出菜单
  const MENU_HALF_W = 120
  const openMenuForRange = useCallback((e, segStart, segEnd) => {
    e.stopPropagation()
    if (!containerRef.current) return
    // 找到所有与点击 segment 重叠的标注
    const overlapping = (annotations ?? []).filter(
      a => a.start < segEnd && a.end > segStart
    )
    if (!overlapping.length) return
    // 计算并集
    const unionStart = Math.min(...overlapping.map(a => a.start))
    const unionEnd   = Math.max(...overlapping.map(a => a.end))
    pendingRangeRef.current = { start: unionStart, end: unionEnd }
    // 菜单定位：以点击点为基准，夹紧在容器内
    const containerRect = containerRef.current.getBoundingClientRect()
    const containerW = containerRef.current.offsetWidth
    const rawLeft = e.clientX - containerRect.left
    const left = Math.max(MENU_HALF_W, Math.min(rawLeft, containerW - MENU_HALF_W))
    const top  = e.clientY - containerRect.top - 4
    setHasOverlap(true)   // 有重叠标注（进到这里一定有）
    setMenuPosition({ top, left })
    setMenuVisible(true)
  }, [annotations, containerRef])
```

- [ ] **Step 9：更新 return**

找到原有 return：

```js
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
```

改为：

```js
  return {
    menuVisible,
    menuPosition,
    handleMouseUp,
    handleTouchEnd,
    closeMenu,
    handleBold,
    handleHighlight,
    handleUnderline,
    handleCancel,
    openMenuForRange,
    hasOverlap,
    pendingRange: pendingRangeRef.current,
  }
```

- [ ] **Step 10：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 11：Commit**

```bash
git add src/hooks/useAnnotationInteraction.js
git commit -m "feat: useAnnotationInteraction 新增 Rule 1/2/3 逻辑（cancel/toggle/tap）"
```

---

## Task 3：AnnotationMenu.jsx — 新增取消按钮

**Files:**
- Modify: `src/components/AnnotationMenu.jsx`

- [ ] **Step 1：更新 props 声明，新增 `showCancel` 和 `onCancel`**

找到：

```js
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
```

改为：

```js
export default function AnnotationMenu({
  position,
  visible,
  activeColor,
  onBold,
  onHighlight,
  onUnderline,
  onColorChange,
  onClose,
  showCancel,
  onCancel,
}) {
```

- [ ] **Step 2：在四色点之后、`</div>` 之前追加取消按钮**

找到四色点渲染块结束处（`})}`之后，第一个 `</div>` 之前），追加：

```jsx
        {/* ✕ 取消（仅选区与已有标注重叠时显示）*/}
        {showCancel && (
          <button
            style={{
              ...btnStyle,
              borderRight: 'none',
              borderLeft: '1px solid #3a3a3c',
              color: '#ff453a',
              fontWeight: 600,
              padding: '4px 10px',
            }}
            onClick={onCancel}
          >
            ✕
          </button>
        )}
```

- [ ] **Step 3：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 4：Commit**

```bash
git add src/components/AnnotationMenu.jsx
git commit -m "feat: AnnotationMenu 新增取消按钮（showCancel prop）"
```

---

## Task 4：AnnotatedText.jsx — 新增 onAnnotatedClick

**Files:**
- Modify: `src/components/AnnotatedText.jsx`

- [ ] **Step 1：给 `AnnotatedText` 新增 `onAnnotatedClick` prop，传给 Segment**

找到 `AnnotatedText` 组件定义：

```jsx
export default function AnnotatedText({ text, annotations, style }) {
```

改为：

```jsx
export default function AnnotatedText({ text, annotations, style, onAnnotatedClick }) {
```

找到 `Segment` 渲染处：

```jsx
      {segments.map((seg) => (
        <Segment
          key={`${seg.start}-${seg.end}`}
          seg={seg}
        />
      ))}
```

改为：

```jsx
      {segments.map((seg) => (
        <Segment
          key={`${seg.start}-${seg.end}`}
          seg={seg}
          onAnnotatedClick={onAnnotatedClick}
        />
      ))}
```

- [ ] **Step 2：在 `Segment` 组件上接收 `onAnnotatedClick` 并绑定 onClick**

找到 `Segment` 组件定义：

```jsx
function Segment({ seg }) {
```

改为：

```jsx
function Segment({ seg, onAnnotatedClick }) {
```

找到 Segment 内无标注时的早返回：

```jsx
  if (!isBold && !hasHighlight && !hasUnderline) {
    return <span>{seg.text}</span>
  }
```

改为：

```jsx
  if (!isBold && !hasHighlight && !hasUnderline) {
    return <span>{seg.text}</span>
  }

  // 有标注时，注册 onClick 供 Rule 3 单击唤起菜单
  const handleClick = onAnnotatedClick
    ? (e) => onAnnotatedClick(e, seg.start, seg.end)
    : undefined
```

找到 Segment 的 return 语句：

```jsx
  return <span style={style}>{seg.text}</span>
```

改为：

```jsx
  return <span style={style} onClick={handleClick}>{seg.text}</span>
```

- [ ] **Step 3：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 4：Commit**

```bash
git add src/components/AnnotatedText.jsx
git commit -m "feat: AnnotatedText 新增 onAnnotatedClick（Rule 3 单击已标注区域）"
```

---

## Task 5：三个接入页更新 props

**Files:**
- Modify: `src/components/RecordDetail.jsx`
- Modify: `src/components/ReviewLetterDetail.jsx`
- Modify: `src/pages/ThreadDetailPage.jsx`

三个页面改动模式完全一样，逐一执行。

### 5A：RecordDetail.jsx

- [ ] **Step 1：更新 `useAnnotations` 解构，加入 `clipAnnotations`**

找到：

```jsx
  const { annotations, activeColor, setActiveColor, addAnnotation, markSaved, resetAnnotations, dirty } =
    useAnnotations(entry.annotations)
```

改为：

```jsx
  const { annotations, activeColor, setActiveColor, addAnnotation, clipAnnotations, markSaved, resetAnnotations, dirty } =
    useAnnotations(entry.annotations)
```

- [ ] **Step 2：更新 `useAnnotationInteraction` 调用，传入 `annotations` 和 `clipAnnotations`，解构新返回值**

找到 `useAnnotationInteraction` 调用，在 `{` 里追加 `annotations` 和 `clipAnnotations` 参数，解构中追加 `hasOverlap, handleCancel, openMenuForRange`：

```jsx
  const {
    menuVisible, menuPosition, handleMouseUp, handleTouchEnd,
    closeMenu, handleBold, handleHighlight, handleUnderline,
    handleCancel, openMenuForRange, hasOverlap,
  } = useAnnotationInteraction({
    containerRef: contentContainerRef,
    rawText: entry.content ?? '',
    addAnnotation,
    clipAnnotations,
    activeColor,
    annotations,
  })
```

- [ ] **Step 3：给 `AnnotationMenu` 传 `showCancel` 和 `onCancel`**

找到页面中所有 `<AnnotationMenu` 实例（无觉察流和有觉察流各一处），在每处追加：

```jsx
                  showCancel={hasOverlap}
                  onCancel={handleCancel}
```

- [ ] **Step 4：给 `AnnotatedText` 传 `onAnnotatedClick`**

找到页面中所有 `<AnnotatedText` 实例，追加：

```jsx
                  onAnnotatedClick={openMenuForRange}
```

- [ ] **Step 5：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

### 5B：ReviewLetterDetail.jsx

同 5A，执行相同的四步（hook 解构、interaction 参数、Menu props、AnnotatedText prop）。

- [ ] **Step 1：useAnnotations 解构加 `clipAnnotations`**
- [ ] **Step 2：useAnnotationInteraction 新增两个入参，解构三个新输出**
- [ ] **Step 3：AnnotationMenu 加 `showCancel`/`onCancel`**
- [ ] **Step 4：AnnotatedText 加 `onAnnotatedClick`**
- [ ] **Step 5：验证编译**

```bash
npm run build 2>&1 | tail -5
```

### 5C：ThreadDetailPage.jsx

同 5A，注意 `annotations` 入参用 `annotations`（来自 `useAnnotations`）。

- [ ] **Step 1：useAnnotations 解构加 `clipAnnotations`**
- [ ] **Step 2：useAnnotationInteraction 新增两个入参，解构三个新输出**
- [ ] **Step 3：AnnotationMenu 加 `showCancel`/`onCancel`**
- [ ] **Step 4：AnnotatedText 加 `onAnnotatedClick`**
- [ ] **Step 5：验证编译**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 6：Commit 三个页面**

```bash
git add src/components/RecordDetail.jsx src/components/ReviewLetterDetail.jsx src/pages/ThreadDetailPage.jsx
git commit -m "feat: 三个阅读页接入 Rule 1/2/3（cancel/toggle/tap 标注交互）"
```

---

## 自检结果

**Spec 覆盖检查：**

| Spec 章节 | 对应 Task |
|---|---|
| Rule 1：选区重叠 → 取消按钮 | Task 2（hasOverlap）+ Task 3（showCancel）+ Task 5（props 传递）✅ |
| Rule 1：点取消 → 剪切语义 | Task 1（clipAnnotations）+ Task 2（handleCancel）✅ |
| Rule 2：完全覆盖 → toggle | Task 2（isFullyCovered + applyAnnotation 分支）✅ |
| Rule 3：单击已标注 → 唤起菜单 | Task 2（openMenuForRange）+ Task 4（onAnnotatedClick）+ Task 5（props）✅ |
| Rule 3：并集范围计算 | Task 2 openMenuForRange 内 min/max 逻辑 ✅ |
| Rule 3 与 selectionchange 不冲突 | selectionchange 内 length===0 返回，onClick 单独路径 ✅ |

**占位符扫描：** 无 TBD / TODO

**类型一致性：**
- `clipAnnotations(clipStart, clipEnd, typesToClip)` 在 Task 1 定义，Task 2 调用，签名一致
- `openMenuForRange(e, segStart, segEnd)` 在 Task 2 定义，Task 4 中 Segment 调用为 `(e, seg.start, seg.end)`，签名一致
- `handleCancel` 无参数，AnnotationMenu 的 `onCancel` 也无参数，一致
- `hasOverlap` boolean，AnnotationMenu 的 `showCancel` 接收 boolean，一致

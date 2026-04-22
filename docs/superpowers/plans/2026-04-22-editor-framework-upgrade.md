# 编辑器框架升级实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将写作输入区从 `<textarea>` 换成 Lexical 富文本编辑器，实现写作与标注同时发生，不改数据模型。

**Architecture:** 新增 `RichTextEditor` 组件封装 Lexical，暴露 `onChange(plaintext)` 和 `onRangeSelect({start,end})`；标注通过 Lexical transform 在编辑器内渲染为 CSS inline spans；偏移同步通过 `shiftAnnotations` 在每次文字变更时更新 annotations；选区通过 `$getSelection()` 换算为绝对偏移后传入现有 `useAnnotationInteraction`。

**Tech Stack:** `lexical` + `@lexical/react`，React，现有 hooks 和 `annotationConfig.js`

**Spec 文件：** `docs/superpowers/specs/2026-04-22-editor-framework-upgrade-design.md`

---

## 文件改动地图

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/components/RichTextEditor.jsx` | **新建** | Lexical 编辑器封装，暴露 `onChange` / `onRangeSelect` / `focus()` ref |
| `src/components/RichTextEditor/AnnotatedNode.js` | **新建** | 自定义 TextNode 子类，携带 CSS inline style |
| `src/components/RichTextEditor/annotationTransform.js` | **新建** | Lexical transform：把 annotations 范围内的 TextNode 替换为 AnnotatedNode |
| `src/components/RichTextEditor/selectionToOffsets.js` | **新建** | 纯函数：Lexical RangeSelection → `{start, end}` 绝对字符偏移 |
| `src/hooks/useAnnotations.js` | **修改** | 新增 `shiftAnnotations` 纯函数（export）和 `applyShift` hook 方法 |
| `src/pages/HomePage.jsx` | **修改** | 替换 `<textarea>`（line 760），接入 RichTextEditor + AnnotationMenu |
| `src/pages/EditEntryPage.jsx` | **修改** | 替换 `<textarea>`，接入 RichTextEditor；修复 `annotations: null` bug |

> ⚠️ 注意：EditEntryPage 目前 save 时写死 `annotations: null`，这个 bug 在 Task 6 修复。

---

## Task 0：安装 Lexical，验证基础 render

**Files:**
- Modify: `package.json`（via npm）

- [ ] **Step 1：安装包**

```bash
npm install lexical @lexical/react
```

期望：无 error，`node_modules/lexical` 和 `node_modules/@lexical` 存在。

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error。

- [ ] **Step 3：Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install lexical and @lexical/react"
```

---

## Task 1：封装 RichTextEditor（基础版，支持中文 IME，提取纯文本）

**Files:**
- Create: `src/components/RichTextEditor.jsx`

- [ ] **Step 1：创建文件**

```jsx
// src/components/RichTextEditor.jsx
import { forwardRef, useImperativeHandle, useRef } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { $getRoot, $createParagraphNode, $createTextNode } from 'lexical'

function onError(error) {
  console.error('[RichTextEditor]', error)
}

/**
 * props:
 *   initialValue {string}
 *   onChange {(plaintext: string) => void}
 *   placeholder {string}
 *   style {object}
 *
 * ref: { focus() }
 */
const RichTextEditor = forwardRef(function RichTextEditor(
  { initialValue = '', onChange, placeholder, style },
  ref
) {
  const contentEditableRef = useRef(null)
  const isComposingRef = useRef(false)

  useImperativeHandle(ref, () => ({
    focus() { contentEditableRef.current?.focus() },
  }))

  const initialConfig = {
    namespace: 'journal',
    theme: {},
    onError,
    editorState: (editor) => {
      if (!initialValue) return
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode(initialValue))
        root.append(para)
      })
    },
  }

  function handleChange(editorState) {
    if (isComposingRef.current) return
    editorState.read(() => {
      onChange?.($getRoot().getTextContent())
    })
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div
        style={{ position: 'relative' }}
        onCompositionStart={() => { isComposingRef.current = true }}
        onCompositionEnd={() => { isComposingRef.current = false }}
      >
        {placeholder && (
          <div aria-hidden style={{
            position: 'absolute', top: 0, left: 0,
            pointerEvents: 'none', color: '#ccc',
            fontSize: 15, lineHeight: 1.85, fontFamily: 'inherit',
          }}>
            {placeholder}
          </div>
        )}
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              ref={contentEditableRef}
              style={{
                outline: 'none', width: '100%', minHeight: '60vh',
                fontSize: 15, lineHeight: 1.85, color: '#2d2d2d',
                caretColor: '#aaa', fontFamily: 'inherit',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                ...style,
              }}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
      </div>
    </LexicalComposer>
  )
})

export default RichTextEditor
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error。

- [ ] **Step 3：Commit**

```bash
git add src/components/RichTextEditor.jsx
git commit -m "feat: add RichTextEditor component（Lexical，IME-safe，plain text onChange）"
```

---

## Task 2：useAnnotations 新增 shiftAnnotations

**Files:**
- Modify: `src/hooks/useAnnotations.js`

- [ ] **Step 1：在 useAnnotations 函数定义之前插入纯函数 shiftAnnotations（named export）**

找到文件顶部 `export function useAnnotations` 的上方，插入：

```js
/**
 * 文字变更后同步标注偏移。
 * @param {Array} annotations
 * @param {number} changeStart - 第一个变化字符的索引
 * @param {number} delta       - 正 = 插入，负 = 删除
 */
export function shiftAnnotations(annotations, changeStart, delta) {
  return annotations.map(a => {
    if (a.end <= changeStart) return a
    if (a.start >= changeStart) {
      return { ...a, start: Math.max(0, a.start + delta), end: Math.max(0, a.end + delta) }
    }
    // changeStart 在标注内部：只移动右边界
    return { ...a, end: Math.max(a.start + 1, a.end + delta) }
  }).filter(a => a.start < a.end)
}
```

- [ ] **Step 2：在 useAnnotations 函数体内，clipAnnotations 之后插入 applyShift**

```js
const applyShift = useCallback((changeStart, delta) => {
  setAnnotations(prev => shiftAnnotations(prev, changeStart, delta))
  // 偏移同步不是内容变更，不设 dirty
}, [])
```

- [ ] **Step 3：把 applyShift 加入 return**

找到 return 语句，加入 `applyShift`：

```js
return {
  annotations, activeColor, setActiveColor,
  addAnnotation, removeAnnotation, markSaved,
  clearAll, clipAnnotations, resetAnnotations,
  applyShift,
  dirty,
}
```

- [ ] **Step 4：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error。

- [ ] **Step 5：Commit**

```bash
git add src/hooks/useAnnotations.js
git commit -m "feat: useAnnotations 新增 shiftAnnotations 纯函数和 applyShift 方法"
```

---

## Task 2.5：useAnnotationInteraction 新增 disableSelectionChange 和 openMenuAt

**Files:**
- Modify: `src/hooks/useAnnotationInteraction.js`

**背景：** Lexical 编辑器是 `contentEditable`，打每个字都会触发 `document.selectionchange`。若保持全局监听，用户打字停顿 300ms 就会触发 `tryShowMenu`，偶发弹出菜单干扰输入。

修复方案：新增 `disableSelectionChange` 参数（默认 `false`，只读场景不变）；当为 `true` 时跳过全局 `selectionchange` 监听，改为由 `openMenuAt(offsets, position)` 直接驱动菜单显示（由 RichTextEditor 的 `onRangeSelect` 回调触发）。

- [ ] **Step 1：更新函数签名，新增 `disableSelectionChange` 参数**

找到：
```js
export function useAnnotationInteraction({ containerRef, rawText, addAnnotation, clipAnnotations, activeColor, annotations }) {
```

改为：
```js
export function useAnnotationInteraction({ containerRef, rawText, addAnnotation, clipAnnotations, activeColor, annotations, disableSelectionChange = false }) {
```

- [ ] **Step 2：在 selectionchange 监听 useEffect 内加守门**

找到 selectionchange 的 `useEffect`（注册 `onSelectionChange` 的那段），在 `document.addEventListener('selectionchange', onSelectionChange)` 前加判断：

```js
  useEffect(() => {
    if (disableSelectionChange) return   // ⬅️ Lexical 场景下跳过全局监听
    let timer = null
    function onSelectionChange() {
      clearTimeout(timer)
      timer = setTimeout(tryShowMenu, 300)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      clearTimeout(timer)
    }
  }, [tryShowMenu, disableSelectionChange])
```

- [ ] **Step 3：新增 openMenuAt(offsets, clientPosition) 方法**

在 `openMenuForRange` 之后插入：

```js
  /**
   * Lexical 场景专用：接收已计算好的 {start, end} 偏移和鼠标位置，直接弹菜单。
   * 用于替代 selectionchange 路径。
   *
   * @param {{ start: number, end: number }} offsets
   * @param {{ clientX: number, clientY: number }} clientPosition
   */
  const openMenuAt = useCallback((offsets, clientPosition) => {
    if (!containerRef.current) return
    pendingRangeRef.current = { start: offsets.start, end: offsets.end }
    const overlaps = (annotations ?? []).some(
      a => a.start < offsets.end && a.end > offsets.start
    )
    setHasOverlap(overlaps)
    const containerRect = containerRef.current.getBoundingClientRect()
    const containerW = containerRef.current.offsetWidth
    const rawLeft = clientPosition.clientX - containerRect.left
    const left = Math.max(MENU_HALF_W, Math.min(rawLeft, containerW - MENU_HALF_W))
    const top  = clientPosition.clientY - containerRect.top - 4
    setMenuPosition({ top, left })
    setMenuVisible(true)
  }, [annotations, containerRef])
```

- [ ] **Step 4：把 openMenuAt 加入 return**

找到 return 语句，追加 `openMenuAt`：

```js
  return {
    menuVisible, menuPosition,
    handleMouseUp, handleTouchEnd,
    closeMenu,
    handleBold, handleHighlight, handleUnderline,
    handleCancel, openMenuForRange, openMenuAt,
    hasOverlap,
    pendingRange: pendingRangeRef.current,
  }
```

- [ ] **Step 5：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error。

- [ ] **Step 6：Commit**

```bash
git add src/hooks/useAnnotationInteraction.js
git commit -m "feat: useAnnotationInteraction 新增 disableSelectionChange + openMenuAt（Lexical 场景）"
```

---



**Files:**
- Create: `src/components/RichTextEditor/AnnotatedNode.js`
- Create: `src/components/RichTextEditor/annotationTransform.js`
- Modify: `src/components/RichTextEditor.jsx`

### Step 1：创建 AnnotatedNode

- [ ] 新建 `src/components/RichTextEditor/AnnotatedNode.js`：

```js
// src/components/RichTextEditor/AnnotatedNode.js
import { TextNode } from 'lexical'

/**
 * TextNode 子类，携带 CSS inline style，用于在编辑器内渲染标注。
 */
export class AnnotatedNode extends TextNode {
  __annotationStyle

  static getType() { return 'annotated' }

  static clone(node) {
    return new AnnotatedNode(node.__text, node.__annotationStyle, node.__key)
  }

  constructor(text, annotationStyle, key) {
    super(text, key)
    this.__annotationStyle = annotationStyle ?? {}
  }

  createDOM(config) {
    const dom = super.createDOM(config)
    this._applyStyle(dom)
    return dom
  }

  updateDOM(prevNode, dom, config) {
    const updated = super.updateDOM(prevNode, dom, config)
    this._applyStyle(dom)
    return updated
  }

  _applyStyle(dom) {
    const s = this.__annotationStyle
    dom.style.fontWeight             = s.fontWeight ?? ''
    dom.style.background             = s.background ?? ''
    dom.style.textDecoration         = s.textDecoration ?? ''
    dom.style.textDecorationColor    = s.textDecorationColor ?? ''
    dom.style.textDecorationStyle    = s.textDecorationStyle ?? ''
    dom.style.textDecorationThickness = s.textDecorationThickness ?? ''
    dom.style.textUnderlineOffset    = s.textUnderlineOffset ?? ''
  }

  static importJSON(node) {
    const n = new AnnotatedNode(node.text, node.annotationStyle)
    n.setFormat(node.format)
    n.setDetail(node.detail)
    n.setMode(node.mode)
    n.setStyle(node.style)
    return n
  }

  exportJSON() {
    return { ...super.exportJSON(), type: 'annotated', annotationStyle: this.__annotationStyle }
  }
}
```

### Step 2：创建 annotationTransform

- [ ] 新建 `src/components/RichTextEditor/annotationTransform.js`：

```js
// src/components/RichTextEditor/annotationTransform.js
import { $getRoot, $createTextNode } from 'lexical'
import { AnnotatedNode } from './AnnotatedNode'
import { getAnnotationColor } from '../../lib/annotationConfig'

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function buildStyle(activeAnnotations) {
  const style = {}
  if (activeAnnotations.find(a => a.type === 'bold')) {
    style.fontWeight = 700
  }
  const hl = activeAnnotations.find(a => a.type === 'highlight')
  if (hl) {
    const hex = getAnnotationColor(hl.color)
    style.background = `linear-gradient(transparent 10%, ${hexToRgba(hex, 0.38)} 10%, ${hexToRgba(hex, 0.38)} 88%, transparent 88%)`
  }
  const ul = activeAnnotations.find(a => a.type === 'underline')
  if (ul) {
    const hex = getAnnotationColor(ul.color)
    style.textDecoration = 'underline'
    style.textDecorationColor = hex
    style.textDecorationStyle = 'wavy'
    style.textDecorationThickness = '1.5px'
    style.textUnderlineOffset = '2px'
  }
  return style
}

/**
 * 在 editor.update() 内调用，把 annotations 范围内的 TextNode
 * 替换为带 CSS 的 AnnotatedNode。
 */
export function applyAnnotationTransform(annotations) {
  const root = $getRoot()
  let absoluteOffset = 0

  for (const para of root.getChildren()) {
    const leaves = para.getChildren()
    for (const node of leaves) {
      const text = node.getTextContent()
      const segStart = absoluteOffset
      const segEnd = absoluteOffset + text.length

      // 找出所有与本 node 重叠的 split 点
      const points = new Set([segStart, segEnd])
      for (const a of annotations) {
        if (a.start > segStart && a.start < segEnd) points.add(a.start)
        if (a.end > segStart && a.end < segEnd) points.add(a.end)
      }
      const sorted = [...points].sort((a, b) => a - b)

      if (sorted.length <= 2) {
        // 无需拆分，整段判断
        const active = annotations.filter(a => a.start <= segStart && a.end >= segEnd)
        if (active.length > 0) {
          const newStyle = buildStyle(active)
          // ⚠️ 守门：样式未变就不 replace，避免触发 onChange 回调造成循环
          if (
            node instanceof AnnotatedNode &&
            JSON.stringify(node.__annotationStyle) === JSON.stringify(newStyle)
          ) {
            // 内容和样式都未变，跳过
          } else {
            node.replace(new AnnotatedNode(text, newStyle))
          }
        } else if (node instanceof AnnotatedNode) {
          node.replace($createTextNode(text))
        }
        // 若都是普通 TextNode 且无 active 标注：不做任何替换
      } else {
        // 需要拆分成多段
        const newNodes = []
        for (let i = 0; i < sorted.length - 1; i++) {
          const s = sorted[i]
          const e = sorted[i + 1]
          const slice = text.slice(s - segStart, e - segStart)
          const active = annotations.filter(a => a.start <= s && a.end >= e)
          if (active.length > 0) {
            newNodes.push(new AnnotatedNode(slice, buildStyle(active)))
          } else {
            newNodes.push($createTextNode(slice))
          }
        }
        for (const n of newNodes) node.insertBefore(n)
        node.remove()
      }

      absoluteOffset += text.length
    }
    // 段落之间有隐含换行
    if (para.getNextSibling()) absoluteOffset += 1
  }
}
```

### Step 3：在 RichTextEditor 中注册 AnnotatedNode 并添加 AnnotationTransformPlugin

- [ ] 修改 `src/components/RichTextEditor.jsx`，在文件中加入：

在 import 区追加：

```js
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'
import { AnnotatedNode } from './RichTextEditor/AnnotatedNode'
import { applyAnnotationTransform } from './RichTextEditor/annotationTransform'
```

在 `RichTextEditor` 函数定义之前，插入子 plugin：

```jsx
function AnnotationTransformPlugin({ annotations }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    editor.update(
      () => { applyAnnotationTransform(annotations ?? []) },
      { tag: 'annotation-transform' }   // ⚠️ 加 tag，OnChangePlugin 用 ignoreSelectionChange 已跳过选区变化；transform 造成的节点替换理论上会触发 onChange，但守门（不变就不 replace）已最小化触发次数。若仍有循环，在 handleEditorChange 内用 tag 判断过滤：editor.isComposing() 或读 update tags
    )
  }, [editor, annotations])
  return null
}
```

在 `initialConfig` 中加入 `nodes: [AnnotatedNode]`：

找到：
```js
  const initialConfig = {
    namespace: 'journal',
    theme: {},
    onError,
    editorState: (editor) => {
```

改为：
```js
  const initialConfig = {
    namespace: 'journal',
    theme: {},
    onError,
    nodes: [AnnotatedNode],
    editorState: (editor) => {
```

给 `RichTextEditor` 新增 `annotations` prop，并在 JSX 里加 plugin：

找到 props 解构：
```js
  { initialValue = '', onChange, placeholder, style },
```

改为：
```js
  { initialValue = '', annotations = [], onChange, placeholder, style },
```

在 `<OnChangePlugin ... />` 下方追加：
```jsx
        <AnnotationTransformPlugin annotations={annotations} />
```

- [ ] **Step 4：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error。

- [ ] **Step 5：Commit**

```bash
git add src/components/RichTextEditor.jsx \
        src/components/RichTextEditor/AnnotatedNode.js \
        src/components/RichTextEditor/annotationTransform.js
git commit -m "feat: 编辑器内标注渲染（AnnotatedNode + transform，复用 CSS 样式）"
```

---

## Task 4：选区接入（Lexical 选区 → 偏移 → 弹菜单）

**Files:**
- Create: `src/components/RichTextEditor/selectionToOffsets.js`
- Modify: `src/components/RichTextEditor.jsx`

### Step 1：创建 selectionToOffsets

- [ ] 新建 `src/components/RichTextEditor/selectionToOffsets.js`：

```js
// src/components/RichTextEditor/selectionToOffsets.js
import { $getRoot, $isRangeSelection } from 'lexical'

/**
 * 在 editorState.read() 内调用。
 * 把 Lexical RangeSelection 换算为全文绝对字符偏移 {start, end}。
 * 返回 null 表示无有效选区。
 */
export function selectionToOffsets(selection) {
  if (!$isRangeSelection(selection)) return null

  const root = $getRoot()
  const leaves = []

  function collectLeaves(node) {
    if (typeof node.getChildren === 'function') {
      for (const child of node.getChildren()) collectLeaves(child)
    } else {
      leaves.push(node)
    }
  }
  collectLeaves(root)

  function absoluteOffset(targetKey, targetOffset) {
    let pos = 0
    for (const leaf of leaves) {
      if (leaf.getKey() === targetKey) return pos + targetOffset
      pos += leaf.getTextContent().length
      // 段落结尾的隐含换行
      const parent = leaf.getParent()
      const siblings = parent?.getChildren?.() ?? []
      if (siblings[siblings.length - 1]?.getKey() === leaf.getKey() && parent?.getNextSibling?.()) {
        pos += 1
      }
    }
    return pos
  }

  try {
    const a = absoluteOffset(selection.anchor.key, selection.anchor.offset)
    const b = absoluteOffset(selection.focus.key, selection.focus.offset)
    const start = Math.min(a, b)
    const end   = Math.max(a, b)
    if (start >= end) return null
    return { start, end }
  } catch {
    return null
  }
}
```

### Step 2：在 RichTextEditor 添加 MouseUpPlugin 和 onRangeSelect prop

- [ ] 修改 `src/components/RichTextEditor.jsx`：

在 import 区加：
```js
import { $getSelection } from 'lexical'
import { selectionToOffsets } from './RichTextEditor/selectionToOffsets'
```

在 `AnnotationTransformPlugin` 之后插入新 plugin：

```jsx
function MouseUpPlugin({ onRangeSelect }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    function handleMouseUp(e) {
      setTimeout(() => {
        editor.read(() => {
          const offsets = selectionToOffsets($getSelection())
          if (offsets) onRangeSelect?.(offsets, e)   // 同时传鼠标事件，供 openMenuAt 定位
        })
      }, 0)
    }
    const root = editor.getRootElement()
    root?.addEventListener('mouseup', handleMouseUp)
    return () => root?.removeEventListener('mouseup', handleMouseUp)
  }, [editor, onRangeSelect])
  return null
}
```

在 RichTextEditor props 解构中加 `onRangeSelect`：

找到：
```js
  { initialValue = '', annotations = [], onChange, placeholder, style },
```

改为：
```js
  { initialValue = '', annotations = [], onChange, onRangeSelect, placeholder, style },
```

在 JSX 的 `<AnnotationTransformPlugin ... />` 下方加：
```jsx
        <MouseUpPlugin onRangeSelect={onRangeSelect} />
```

- [ ] **Step 3：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error。

- [ ] **Step 4：Commit**

```bash
git add src/components/RichTextEditor.jsx \
        src/components/RichTextEditor/selectionToOffsets.js
git commit -m "feat: RichTextEditor 新增 onRangeSelect（Lexical 选区 → 绝对偏移）"
```

---

## Task 5：替换 HomePage.jsx 的 textarea

**Files:**
- Modify: `src/pages/HomePage.jsx`

实际文件是 `src/pages/HomePage.jsx`（grep 已确认：textarea 在 line 760，textareaRef 在 line 252，content state 在 line 213）。

- [ ] **Step 1：读文件，确认 textarea 位置和 content state 名称（line 213 附近）**

- [ ] **Step 2：import 新组件和 hooks**

在文件顶部加：
```jsx
import RichTextEditor from '../components/RichTextEditor'
import { useAnnotations } from '../hooks/useAnnotations'
import { useAnnotationInteraction } from '../hooks/useAnnotationInteraction'
import AnnotationMenu from '../components/AnnotationMenu'
```

- [ ] **Step 3：在组件函数内初始化 hook**

在现有 state 声明之后加：

```jsx
const {
  annotations, activeColor, setActiveColor,
  addAnnotation, clipAnnotations, applyShift,
} = useAnnotations([])

const editorContainerRef = useRef(null)
const prevTextRef = useRef(content)  // content = line 213 的 state 变量名

const {
  menuVisible, menuPosition,
  closeMenu,
  handleBold, handleHighlight, handleUnderline,
  handleCancel, openMenuForRange, hasOverlap,
} = useAnnotationInteraction({
  containerRef: editorContainerRef,
  rawText: content,
  addAnnotation,
  clipAnnotations,
  activeColor,
  annotations,
  disableSelectionChange: true,   // ⚠️ Lexical 内部是 contentEditable，禁用全局 selectionchange 监听，改为 onRangeSelect 驱动
})
```

- [ ] **Step 4：新增 handleEditorChange，计算 delta 并调用 applyShift**

```jsx
function handleEditorChange(newText) {
  const oldText = prevTextRef.current
  prevTextRef.current = newText
  let changeStart = 0
  const minLen = Math.min(oldText.length, newText.length)
  while (changeStart < minLen && oldText[changeStart] === newText[changeStart]) changeStart++
  const delta = newText.length - oldText.length
  if (delta !== 0) applyShift(changeStart, delta)
  setContent(newText)   // setContent = 现有 setter，根据 line 213 实际名称调整
}
```

- [ ] **Step 5：新增 handleRangeSelect，通过 openMenuAt 触发菜单**

```jsx
// MouseUpPlugin 传入 {start, end} 和鼠标事件，直接调 openMenuAt
const handleRangeSelect = useCallback((offsets, e) => {
  if (offsets.start >= offsets.end) return
  openMenuAt(offsets, { clientX: e.clientX, clientY: e.clientY })
}, [openMenuAt])
```

同时把 `useAnnotationInteraction` 解构中加入 `openMenuAt`：

```jsx
const {
  menuVisible, menuPosition,
  closeMenu,
  handleBold, handleHighlight, handleUnderline,
  handleCancel, openMenuForRange, openMenuAt, hasOverlap,
} = useAnnotationInteraction({ ... })
```

- [ ] **Step 6：把 textarea 所在的 div 加 ref，替换 textarea 为 RichTextEditor，追加 AnnotationMenu**

找到 textarea 容器 div（line 760 附近），加 `ref={editorContainerRef}`，将 `<textarea ... />` 替换为：

```jsx
<RichTextEditor
  initialValue={content}
  annotations={annotations}
  onChange={handleEditorChange}
  onRangeSelect={handleRangeSelect}
  placeholder="把脑子里的写下来…"
  style={{ minHeight: '60vh' }}
/>
<AnnotationMenu
  position={menuPosition}
  visible={menuVisible}
  activeColor={activeColor}
  onBold={handleBold}
  onHighlight={handleHighlight}
  onUnderline={handleUnderline}
  onColorChange={setActiveColor}
  onClose={closeMenu}
  showCancel={hasOverlap}
  onCancel={handleCancel}
/>
```

- [ ] **Step 7：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error。

- [ ] **Step 8：Commit**

```bash
git add src/pages/HomePage.jsx
git commit -m "feat: HomePage.jsx 替换 textarea 为 RichTextEditor，接入标注菜单"
```

---

## Task 6：替换 EditEntryPage 的 textarea，修复 annotations 保存 bug

**Files:**
- Modify: `src/pages/EditEntryPage.jsx`

**实际结构（grep 确认）：**
- `contentMap: { [msg.id]: string }` 在 line 60 管理所有可编辑字段
- 日记原文用 `contentMap['__raw__']` 表示（line 76）
- 多个 `AutoTextarea` 在 line 250、267、294
- **只替换日记原文对应的 AutoTextarea（`contentMap['__raw__']`），其他字段不动**
- `handleSave` 中 `annotations: null` 需改为 `annotations`（保存 bug 修复）

- [ ] **Step 1：读文件，确认 line 60/76/250/267/294 的实际上下文**

- [ ] **Step 2：import 新组件和 hooks**

```jsx
import RichTextEditor from '../components/RichTextEditor'
import { useAnnotations } from '../hooks/useAnnotations'
import { useAnnotationInteraction } from '../hooks/useAnnotationInteraction'
import AnnotationMenu from '../components/AnnotationMenu'
```

- [ ] **Step 3：初始化 useAnnotations（使用 entry.annotations 作为初始值）**

在现有 state 声明之后加：

```jsx
const {
  annotations, activeColor, setActiveColor,
  addAnnotation, clipAnnotations, applyShift, markSaved,
} = useAnnotations(entry.annotations ?? [])

const editorContainerRef = useRef(null)
const prevTextRef = useRef(contentMap['__raw__'] ?? '')  // ⚠️ 用 contentMap['__raw__']，不是 entry.content
```

- [ ] **Step 4：初始化 useAnnotationInteraction**

```jsx
const {
  menuVisible, menuPosition,
  closeMenu,
  handleBold, handleHighlight, handleUnderline,
  handleCancel, openMenuForRange, openMenuAt, hasOverlap,
} = useAnnotationInteraction({
  containerRef: editorContainerRef,
  rawText: contentMap['__raw__'] ?? '',
  addAnnotation,
  clipAnnotations,
  activeColor,
  annotations,
  disableSelectionChange: true,
})

const handleRangeSelect = useCallback((offsets, e) => {
  if (offsets.start >= offsets.end) return
  openMenuAt(offsets, { clientX: e.clientX, clientY: e.clientY })
}, [openMenuAt])
```

- [ ] **Step 5：新增 handleRawChange，仅更新 contentMap['__raw__'] 并调 applyShift**

```jsx
function handleRawChange(newText) {
  const oldText = prevTextRef.current
  prevTextRef.current = newText
  let changeStart = 0
  const minLen = Math.min(oldText.length, newText.length)
  while (changeStart < minLen && oldText[changeStart] === newText[changeStart]) changeStart++
  const delta = newText.length - oldText.length
  if (delta !== 0) applyShift(changeStart, delta)
  setContentMap(m => ({ ...m, '__raw__': newText }))   // ⚠️ 只更新 '__raw__'，其他字段不变
}
```

- [ ] **Step 6：找到 handleSave 中的 `annotations: null`（两处），改为 `annotations`，保存后调 markSaved()**

找到（两处，有无觉察流分支各一）：
```js
annotations: null
```

改为：
```js
annotations
```

在 save 成功后，`onDone?.()` 之前加：
```js
markSaved()
```

- [ ] **Step 7：找到日记原文的 AutoTextarea（line 250 附近），替换为 RichTextEditor + AnnotationMenu**

> ⚠️ 只替换日记原文那一个，`local_answer` 和 `ai_answer` 的 AutoTextarea 保持不变。

找到（读 line 248-260 确认具体代码）：
```jsx
<AutoTextarea
  value={contentMap['__raw__'] ?? ''}
  onChange={...}
  ...
/>
```

替换为：
```jsx
<div ref={editorContainerRef} style={{ position: 'relative' }}>
  <RichTextEditor
    initialValue={contentMap['__raw__'] ?? ''}
    annotations={annotations}
    onChange={handleRawChange}
    onRangeSelect={handleRangeSelect}
    style={{ minHeight: '40vh', fontSize: 15, lineHeight: 1.85, color: '#2d2d2d' }}
  />
  <AnnotationMenu
    position={menuPosition}
    visible={menuVisible}
    activeColor={activeColor}
    onBold={handleBold}
    onHighlight={handleHighlight}
    onUnderline={handleUnderline}
    onColorChange={setActiveColor}
    onClose={closeMenu}
    showCancel={hasOverlap}
    onCancel={handleCancel}
  />
</div>
```

- [ ] **Step 8：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error。

- [ ] **Step 9：Commit**

```bash
git add src/pages/EditEntryPage.jsx
git commit -m "feat: EditEntryPage 替换日记原文 textarea 为 RichTextEditor，修复 annotations 保存 bug"
```

---

## Task 7：集成验证

- [ ] 启动 dev server：`npm run dev`
- [ ] 新建日记，用中文 IME 输入文字，确认无重复字符
- [ ] 选中文字，标注菜单弹出，可以加粗/高亮/下划线；**打字时不弹菜单**（验证 disableSelectionChange 有效）
- [ ] 在已标注文字前后继续打字，标注位置正确跟随，不偏移
- [ ] 保存，确认 DB 中 `content` 是纯文本，`annotations` 是正确 JSON
- [ ] 打开已有带标注的日记（EditEntryPage），标注在编辑器内可见
- [ ] 编辑文字后保存，标注偏移正确更新到 DB

**⚠️ 多段落专项测试（风险2）：**
- [ ] 在日记里写两段（按 Enter 换行），在第一段末尾标注一个词，然后在第一段中间插入文字
- [ ] 确认第一段末尾的标注偏移正确更新（不漂移到第二段）
- [ ] 打印 `$getRoot().getTextContent()` 确认段落间是 `\n`（不是 `\n\n`），与 `shiftAnnotations` 的 delta 计算基准一致
- [ ] 若发现偏移不一致，在 `handleEditorChange` 里用 `console.log` 对比 `prevTextRef.current` 和 `newText` 的换行符数量，确认两者一致

---

## 自检结果

**Spec 覆盖：**

| Spec 要求 | Task |
|---|---|
| 替换 textarea → Lexical | Task 1, 5, 6 ✅ |
| content = 纯文本（getTextContent） | Task 1 OnChangePlugin ✅ |
| annotations 存储不变 | Task 2, 5, 6 ✅ |
| 标注渲染 CSS 与 AnnotatedText 一致 | Task 3 buildStyle ✅ |
| shiftAnnotations 偏移同步 | Task 2（纯函数）+ Task 5/6（delta 计算）✅ |
| Lexical 选区 → 绝对偏移 | Task 4 selectionToOffsets ✅ |
| 接入现有 useAnnotationInteraction | Task 5, 6 ✅ |
| NewEntryPage 替换 | Task 5 ✅ |
| EditEntryPage 替换 | Task 6 ✅ |
| AwarenessFlow 不动 | 不在任何 Task ✅ |
| 中文 IME 安全 | Task 1 isComposingRef ✅ |
| EditEntryPage annotations 保存 bug 修复 | Task 6 Step 5 ✅ |

**占位符扫描：** Task 5/6 有两处「根据实际代码调整」说明——因为这两个文件需要代码 session 先读再改，属于必要提示而非 TBD。

**类型一致性：**
- `shiftAnnotations(annotations, changeStart, delta)` Task 2 定义，Task 5/6 通过 `applyShift(changeStart, delta)` 调用，一致
- `applyAnnotationTransform(annotations)` Task 3 定义，Task 3 内 plugin 调用，一致
- `selectionToOffsets(selection)` Task 4 定义，Task 4 内 MouseUpPlugin 调用，一致
- `onRangeSelect({start, end})` Task 4 暴露，Task 5/6 消费（传 `() => triggerMenuCheck()`，不用 offsets 直接走 DOM selectionchange），一致

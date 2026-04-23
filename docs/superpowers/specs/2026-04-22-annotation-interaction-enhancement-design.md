# 标注交互增强设计（Part 2.5）

**日期：** 2026-04-22
**状态：** ✅ 设计确认，待实现（Part 1 & 2 已完成后执行）
**前置：** Part 1（基础层）和 Part 2（集成层）已完成并 push 到 dev

---

## 一、背景

Part 2 的标注菜单只支持「新增标注」。本 spec 补充三条交互规则，使标注系统支持取消、切换、和通过单击已有标注唤起菜单。

---

## 二、当前已实现架构（Part 1 & 2 实际状态）

**渲染：** 纯 CSS，无 SVG
- 高亮：`linear-gradient(transparent 10%, rgba(hex, 0.38) 10%, … 88%, transparent 88%)`
- 下划线：`text-decoration: underline wavy`
- 加粗：`fontWeight: 700`

**选区检测：** `document.selectionchange` + 300ms 防抖（非 `touchend + setTimeout`）

**颜色 ID：** `straw / pink / sage / slate`（`annotationConfig.js` 实际值）

**`useAnnotations` 当前 API：**
```js
{ annotations, activeColor, setActiveColor, addAnnotation,
  removeAnnotation, markSaved, clearAll, resetAnnotations, dirty }
```

**`useAnnotationInteraction` 当前 params：**
```js
{ containerRef, rawText, addAnnotation, activeColor }
```

**`useAnnotationInteraction` 当前 return：**
```js
{ menuVisible, menuPosition, handleMouseUp, handleTouchEnd,
  closeMenu, handleBold, handleHighlight, handleUnderline, pendingRange }
```

**`AnnotationMenu` 当前 props：**
```js
{ visible, position, activeColor, onBold, onHighlight, onUnderline, onColorChange, onClose }
```

**`AnnotatedText` 当前 props：**
```js
{ text, annotations, style }
```

---

## 三、三条交互规则

### Rule 1：选区与已有标注重叠 → 菜单加「✕ 取消」按钮

**触发条件：** `pendingRange` 与任意已有标注存在重叠（哪怕一个字符）

**菜单变化：** 在四色点之后追加「✕」按钮

**点击取消的行为（剪切语义）：**
对所有与选区重叠的标注（不分类型），在选区边界处剪切：
- 选区内的部分：移除
- 选区外的部分：保留（生成新标注条目）

**示例：**
```
原始：{ bold, start:0, end:5 }  →  "12345" 全部加粗
选区：start:2, end:4
点取消后：
  { bold, start:0, end:2 }  →  "12" 保留
  { bold, start:4, end:5 }  →  "5" 保留
  "34" 的加粗消失
```

---

### Rule 2：选区全部被同类型覆盖 → 点击该类型 = toggle 取消

**触发条件：** 选区 `[start, end)` 内每个字符都被至少一条该类型标注覆盖

**行为：** 对该类型执行剪切（同 Rule 1，只处理该类型）

**示例：**
```
"12345" 全部加粗。选中 "34"（start:2, end:4）
→ "34" 完全被 bold 覆盖
→ 点 B → 取消 "34" 的 bold
→ 结果：{ bold,0,2 } + { bold,4,5 }
```

选区只有部分被覆盖时 → 正常新增。

---

### Rule 3：单击已标注区域 → 唤起菜单

**触发条件：** `onClick` 落在已标注的 Segment 上（`seg.types.size > 0`）

**「虚拟选区」的计算：** 取点击位置所覆盖的所有标注的 start/end **并集**

```
标注 A：{ bold, 0, 3 }       →  "123"
标注 B：{ highlight, 2, 5 }  →  "345"
单击 "3"（该 segment start:2, end:3）
→ 重叠标注：A + B
→ 并集 = { start:0, end:5 }  →  "12345"
→ pendingRange = { start:0, end:5 }，菜单弹出
```

**Rule 1 & 2 在 Rule 3 下自然生效：**
- 并集范围内肯定有标注 → `hasOverlap = true` → 菜单显示「✕」
- 若并集范围内某类型完全覆盖 → 点该类型 = toggle

**实现路径：** `AnnotatedText` 的 `Segment` 组件接收 `onAnnotatedClick(e, segStart, segEnd)` prop，`useAnnotationInteraction` 暴露 `openMenuForRange(e, segStart, segEnd)` 函数，父组件把 `openMenuForRange` 传给 `AnnotatedText` 的 `onAnnotatedClick` prop。

**与 selectionchange 的关系：** 单击不产生新选区（会清空旧选区），`tryShowMenu` 内 `selection.toString().length === 0` 检测为空 → 直接 return，不冲突。

---

## 四、数据操作

### 4.1 clipAnnotations（新增到 useAnnotations）

```js
const clipAnnotations = useCallback((clipStart, clipEnd, typesToClip = 'all') => {
  setAnnotations(prev => {
    const result = []
    for (const a of prev) {
      const shouldClip = typesToClip === 'all' || typesToClip === a.type
      if (!shouldClip || a.end <= clipStart || a.start >= clipEnd) {
        result.push(a)   // 不在范围内，或不是目标类型 → 原样保留
        continue
      }
      // 重叠且是目标类型：剪切
      if (a.start < clipStart) result.push({ ...a, end: clipStart })   // 左侧残留
      if (a.end > clipEnd)     result.push({ ...a, start: clipEnd })   // 右侧残留
      // 中间被剪掉，不加入 result
    }
    return result
  })
  setDirty(true)
}, [])
```

### 4.2 isFullyCovered（工具函数，放在 useAnnotationInteraction 内部）

```js
function isFullyCovered(annotations, selStart, selEnd, type) {
  const ofType = annotations.filter(a => a.type === type && a.end > selStart && a.start < selEnd)
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

---

## 五、API 变更汇总

### useAnnotations（新增一个方法）

```js
// 新增
clipAnnotations(clipStart, clipEnd, typesToClip = 'all')
// return 里加上它
{ ..., clipAnnotations }
```

### useAnnotationInteraction（新增 2 个 param，新增 3 个 return 值）

```js
// params 新增
{ ..., annotations, clipAnnotations }

// return 新增
{ ..., hasOverlap, handleCancel, openMenuForRange }
```

- `hasOverlap`：boolean，pendingRange 与任意 annotation 有重叠时为 true
- `handleCancel`：Rule 1 取消，剪切所有类型
- `openMenuForRange(e, segStart, segEnd)`：Rule 3，从 Segment 的 onClick 调用

### AnnotationMenu（新增 2 个 prop）

```js
{ ..., showCancel, onCancel }
// showCancel 为 true 时渲染「✕」按钮
```

### AnnotatedText（新增 1 个 prop）

```js
{ ..., onAnnotatedClick }
// onAnnotatedClick(e, segStart, segEnd)
// 仅在 seg.types.size > 0 时触发
```

---

## 六、菜单样式

```
┌─────────────────────────────────────────────────────┐
│  B  │  U  │  ▌  │  🟤  │  🌸  │  🌿  │  🔵  │  ✕  │
└─────────────────────────────────────────────────────┘
```

「✕」按钮仅 `showCancel === true` 时渲染，颜色偏红（`#ff453a`）以示危险操作。

---

## 七、成功标准

1. 选中包含已标注的文字 → 菜单出现「✕」→ 点击 → 选区内标注消失，两侧保留
2. 选中完全加粗的 "34" → 点 B → "34" 加粗消失，"12" 和 "5" 保留
3. 单击已高亮文字 → 菜单弹出 → 可取消或追加其他类型
4. 菜单位置不被选区文字遮挡（现有夹紧逻辑已处理）
5. 所有操作触发 dirty → debounce 保存到 DB
6. AI 预标注与用户标注行为一致

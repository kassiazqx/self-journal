# 同步卡：编辑器框架升级（写作时即可标注）

**日期：** 2026-04-22
**Commit：** 4c8497e
**分支：** dev

---

## 变更摘要

将写作页（HomePage）和编辑页（EditEntryPage）的 `<textarea>` 全部替换为 Lexical 富文本编辑器，实现「写作时即可圈字标注」。存储模型不变：正文仍存纯文本，标注 JSONB 独立存储。

---

## 新增文件

| 文件 | 说明 |
|------|------|
| `src/components/RichTextEditor.jsx` | Lexical 编辑器封装，暴露 `onChange(plaintext)` 和 `onRangeSelect({start,end}, DOMRect)` |
| `src/components/RichTextEditor/AnnotatedNode.js` | TextNode 子类，携带 `__annotationStyle`，`createDOM` 时渲染内联样式 |
| `src/components/RichTextEditor/annotationTransform.js` | `editor.update()` 按标注边界分割 TextNode，替换为 AnnotatedNode；guard 防无限循环 |
| `src/components/RichTextEditor/selectionToOffsets.js` | Lexical `RangeSelection` → `{start, end}` 绝对字符偏移，处理段落隐式换行 |

---

## 修改文件

### `src/hooks/useAnnotations.js`
- 新增 `shiftAnnotations(annotations, changeStart, delta)` 纯函数（named export）
- 新增 `applyShift(changeStart, delta)` hook 方法：文字变更时移动标注偏移，**不 set dirty**

### `src/hooks/useAnnotationInteraction.js`
- 新增 `openMenuAt(offsets, selectionRect: DOMRect)`：Lexical 专用菜单触发路径
  - 接收 DOMRect（选区边界框），而非 clientY，定位更精确
  - 写入 `lastOpenMenuAtRef.current = Date.now()` 防止 selectionchange 500ms 内重复触发
- 新增 `flipDown` 逻辑：手机端始终 true；桌面端选区离容器顶部 < 52px 时也为 true
- `menuPosition` 形状从 `{top, left}` 改为 `{top, left, flipDown}`
- selectionchange 处理器：如距 `openMenuAt` 调用 < 500ms 则跳过，防双触发

### `src/components/AnnotationMenu.jsx`
- 新增 `flipDown` 支持：`true` 时菜单显示在选区**下方**（箭头朝上）；`false` 时显示在上方
- 适用场景：手机端（系统菜单占据选区上方）、选区靠近页面顶端时

### `src/pages/HomePage.jsx`
- `<textarea>` → `<RichTextEditor>` + `<AnnotationMenu>`，包裹在 `ref={editorContainerRef}` 的 div 内
- 新增 `handleEditorChange(newText)`：计算 delta → 调 `applyShift` → 更新 content state
- 新增 `handleRangeSelect(offsets, selectionRect)` → 调 `openMenuAt(offsets, selectionRect)`
- **关键 bug 修复**：`handleDone` 和 `handleDeepAwareness` 的 `useCallback` 补 `annotations` 到依赖数组
  - 根因：stale closure 导致两个路径保存的 annotations 始终为初始 `[]`

### `src/pages/EditEntryPage.jsx`
- 无觉察流（`messages.length === 0`）和有觉察流 `raw_entry` 节点均换为 `RichTextEditor`
- 新增 `handleRawChange(newText)`：同 HomePage，计算 delta + applyShift + 写 contentMap['__raw__']
- **load effect 修复**：flow 分支也写入 `contentMap['__raw__']`（from raw_entry content）
- **handleSave 修复**：flow 分支读 `contentMap['__raw__']` 而非 `contentMap[msg.id]` 作为 raw_entry 内容

---

## 架构决策

**存储模型不变：**
- `content` 字段仍存纯文本（Lexical `$getRoot().getTextContent()`）
- `annotations` 字段仍存独立 JSONB（`[{type, start, end, color?}]`）
- Lexical 仅作为编辑器 UI 层，不影响数据层

**IME 安全：**
- `isComposingRef` 守门：compositionstart/end 期间 onChange 不触发
- 中文输入确认后文本才同步到 state

**双触发防护（Lexical 特有）：**
- `MouseUpPlugin` 在 mouseup 后调 `openMenuAt` 并打时间戳
- `selectionchange` 监听器在 500ms 内跳过，防止 mouseup + selectionchange 双重弹出

---

## 修复的 Bug

| Bug | 根因 | 修复 |
|-----|------|------|
| 写作页保存后标注消失 | `handleDone` useCallback 缺 `annotations` dep，始终用初始 `[]` | 补依赖数组 |
| 深入觉察保存后标注消失 | `handleDeepAwareness` 同上 | 补依赖数组 |
| 菜单覆盖选中文字 | 传 clientY（选区底部）作为 top，再 translateY(-100%) 导致菜单遮住选区 | 改传 DOMRect，用 selectionRect.top 定位 |
| 菜单被导航栏遮挡 | 选区靠近页面顶端时菜单渲染在上方 | flipDown：自动切换到选区下方 |
| 菜单位置跳动两次 | mouseup + selectionchange 各触发一次定位 | lastOpenMenuAtRef 防双触发 |
| 手机端无法唤起标注菜单 | 禁用了 selectionchange 监听 | 恢复 selectionchange（tryShowMenu 空选区守卫已足够） |
| 手机端菜单被系统菜单遮挡 | 菜单渲染在选区上方，与系统 copy/paste 菜单重叠 | isTouchDevice → 始终 flipDown |

---

## 已知限制

- **AwarenessFlow 不动**：觉察流引导问答仍用 AutoTextarea（设计意图，不在本批次范围）
- **RecordDetail 不动**：详情页正文标注用 AnnotatedText + 旧选区路径（不需要 Lexical）
- **Lexical 只用 PlainTextPlugin**：不引入 RichTextPlugin，避免 Markdown/HTML 格式化

---

## 验证清单

- [x] 写作页写字 → 圈字 → 保存 → 详情页标注显示正确
- [x] 编辑页打开 → 标注已渲染 → 修改正文 → 保存 → 标注偏移正确
- [x] 手机端选字 → 菜单出现在选区下方（不被系统菜单遮挡）
- [x] 桌面端选字靠近顶端 → 菜单自动切到下方
- [x] 中文输入不触发多余 onChange
- [x] 深入觉察后保存，标注正确写入 DB

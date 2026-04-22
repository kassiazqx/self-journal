# 同步卡：文字标注系统

**日期：** 2026-04-22
**类型：** 代码 session
**Commit：** 已 push 到 dev 分支
**影响范围：** RecordDetail / ReviewLetterDetail / ThreadDetailPage / 5 个新文件 / 3 个 DB 新列

---

## 实现了什么

用户在记录详情、回顾信、脉络详情的文字区域，可以**选中文字后标记高亮、加粗、下划线**，标注持久化到数据库，再次打开依然可见。

### 新文件（lib/）
- `annotationConfig.js`：颜色 ID → hex 映射（amber / emerald / violet / rose），`getAnnotationColor(id)` 工具函数

### 新文件（hooks/）
- `useAnnotations.js`：标注状态机
  - state: `annotations[]`, `activeColor`, `dirty`（是否有未保存变更）
  - API: `addAnnotation(type, color, start, end)` / `markSaved()` / `resetAnnotations(arr)`
  - dedup guard：同 type+start+end 已存在则跳过，防止重复标注
- `useAnnotationInteraction.js`：选区 → 弹菜单交互
  - 输入：`containerRef`, `rawText`, `addAnnotation`, `activeColor`
  - 输出：`menuVisible`, `menuPosition`, `handleMouseUp`, `handleTouchEnd`, `closeMenu`, `handleBold`, `handleHighlight`, `handleUnderline`

### 新文件（components/）
- `AnnotatedText.jsx`：将 `text + annotations[]` 渲染为带样式的 inline spans
  - 核心：`buildSegments()` 按标注起止点切割文本，允许同一片段叠加多个标注
  - 渲染策略：全 CSS，无 SVG
    - 高亮：`background: linear-gradient(...)` 半透明背景，天然跨行
    - 下划线：`text-decoration: underline wavy`，天然跨行
    - 加粗：`fontWeight: 700`
- `AnnotationMenu.jsx`：选区后弹出的操作浮层
  - B（加粗）/ 高亮 / 下划线 三个操作按钮 + 颜色选择器（4 色）
  - `position: absolute`，位置由 `useAnnotationInteraction` 计算并夹紧在容器边界内

---

## 接入位置

| 页面 | 可标注区域 | 持久化字段 |
|------|-----------|-----------|
| RecordDetail | 正文（content）+ 摘要（entry_summary） | `journal_entries.annotations` |
| ReviewLetterDetail | 信的正文（content） | `review_letters.annotations` |
| ThreadDetailPage | 此刻这里（current_state） | `threads.current_state_annotations` |

所有接入页均：
- `onContextMenu={e => e.preventDefault()}` + `WebkitTouchCallout: 'none'`（阻止浏览器原生菜单覆盖自定义菜单）
- 防抖 500ms 自动保存
- mount 时补拉完整数据（含标注字段），调 `resetAnnotations(data.annotations)` 正确初始化

---

## DB 变更

以下三列已在 Supabase SQL Editor 执行：

```sql
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS annotations jsonb DEFAULT '[]';
ALTER TABLE review_letters  ADD COLUMN IF NOT EXISTS annotations jsonb DEFAULT '[]';
ALTER TABLE threads         ADD COLUMN IF NOT EXISTS current_state_annotations jsonb DEFAULT '[]';
```

数据格式：`[{ type: 'highlight'|'bold'|'underline', start: number, end: number, color?: string }]`

`start/end` 是相对于原始纯文本字符串的字符偏移量（UTF-16 码元，与 JS `string.slice(start, end)` 一致）。

---

## 新增 service 方法

**`reviewLetterService.js`：**
```js
export async function updateReviewLetter(letterId, userId, fields) {
  const { error } = await db.from('review_letters')
    .update(fields)
    .eq('id', letterId)
    .eq('user_id', userId)
  if (error) throw error
}
```

**`threadService.js`**（已有 `updateThread`）：支持传入任意字段，包括 `current_state_annotations`。

---

## 解决的问题及根因

### 1. 移动端选区检测
**症状：** 长按弹菜单太早（未拖拽完），或拖完什么都没有。

**根因：** 移动端文字选区分两阶段——①长按识别（touchend 冒泡到我们的 div）；②拖动 selection handle（浏览器原生 UI，touch 事件不冒泡）。touchend 只覆盖第一阶段。

**方案：** `document.selectionchange` 事件 + 300ms 防抖。拖动中持续触发（计时器一直重置），停手 300ms 后弹菜单。

```js
useEffect(() => {
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
}, [tryShowMenu])
```

### 2. 标注不持久化
**症状：** 划完高亮退出重进，高亮消失。

**根因：** 列表查询（RecordsPage select）不含 `annotations` 字段，父组件传入的 prop 为 `undefined`。`useAnnotations` 用 `useState(prop ?? [])` 只初始化一次，后续 `setEntry(data)` 不会重新初始化标注。

**方案：** 所有接入页在 `loadFull()` / `load()` / mount fetch 之后，必须显式调 `resetAnnotations(data.annotations ?? [])`。

### 3. 水平页面溢出
**症状：** 标注后出现横向滚动条。

**根因：** 最初版本在标注 span 上设置了 `whiteSpace: 'nowrap'`，阻止文字换行。

**方案：** 删除 `nowrap`，改用纯 CSS 装饰。

### 4. 多行标注只覆盖部分行
**症状：** 选中三行文字，高亮只显示中间一条横线。

**根因：** 最初使用 `position: absolute` 的 SVG 覆盖。SVG 的包围盒是从第一行起点到最后一行终点的矩形，中间行左右两侧空白也被覆盖，形成视觉上只有中心线的效果。

**方案：** 完全换用 CSS：
- 高亮：`background: linear-gradient(transparent 10%, rgba(…, 0.38) 10%, … 88%, transparent 88%)`
- 下划线：`text-decoration: underline wavy`

两种 CSS 属性都是 inline 流，天然随文本换行，每行独立渲染。

> 注：CSS 无法实现手绘晕染笔刷效果。若未来需要，需要用 `Range.getClientRects()` 为每一行独立创建 SVG，工程量较大。当前暂不实现。

---

## 架构规则（新增）

- **§4.47**：移动端选区用 `selectionchange` 300ms 防抖，不用 touchend。
- **§4.48**：标注初始化必须在 loadFull 后调 `resetAnnotations(data.annotations)`，不能依赖 useState prop 更新。

---

## 已知局限

- `AnnotatedText` 的 `key` 是 `${seg.start}-${seg.end}`，如果标注完全相同（两个标注区间完全重合）会有 key 冲突，实际使用中极少发生，暂不处理。
- 写作中的文字（正在输入，未保存）不能标注——因为标注的 `start/end` 基于已保存的 rawText，输入中的内容尚未同步，不适合标注。这是设计上的边界，不是 bug。
- 碎片（fragments）区域暂未接入标注，因为它是 AI 生成的引用列表，结构不是纯文本，接入复杂度高，暂不做。

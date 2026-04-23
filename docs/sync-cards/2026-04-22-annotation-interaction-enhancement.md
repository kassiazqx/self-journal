# 同步卡：标注交互增强 Part 2.5

**日期：** 2026-04-22
**类型：** 代码 session
**Commit：** 73c0f15（代码审查修复）+ 3685c86（arch + 同步卡）
**分支：** dev，待 push
**影响范围：** useAnnotations / useAnnotationInteraction / AnnotationMenu / AnnotatedText / RecordDetail / ReviewLetterDetail / ThreadDetailPage

---

## 实现了什么

在已有标注系统基础上，补充三条交互规则：

### Rule 1：选区与已有标注重叠 → 菜单加「✕ 取消」按钮
- 检测：`pendingRange` 与任意 annotation 有重叠（哪怕一个字符）时 `hasOverlap = true`
- 行为：点「✕」→ `handleCancel` → `clipAnnotations(start, end, 'all')` → 选区内所有标注剪除，选区外保留
- 剪切语义：被剪切的标注两侧残留生成新标注条目（不是删除整条）

### Rule 2：选区完全被同类型覆盖 → 点该类型 = toggle 取消
- 检测：`isFullyCovered(selStart, selEnd, type)` — 扫描 annotations 确认选区内每个字符都被该类型覆盖（间隙检测算法）
- 行为：`applyAnnotation` 内判断 → 若完全覆盖则 `clipAnnotations(start, end, type)`，否则正常 `addAnnotation`

### Rule 3：单击已标注区域 → 唤起菜单
- 入口：`AnnotatedText` 的 `Segment` 有标注时注册 `onClick`，调用 `onAnnotatedClick(e, seg.start, seg.end)`
- 处理：`openMenuForRange(e, segStart, segEnd)` 找到所有与该 segment 重叠的标注，取并集（`Math.min` start / `Math.max` end）作为 `pendingRange`，弹出菜单
- Rule 1 & 2 在 Rule 3 下自然生效（并集范围内必有标注 → `hasOverlap = true`）
- 与 `selectionchange` 不冲突：单击不产生文字选区，`tryShowMenu` 内 `length === 0` 直接 return

---

## 新增 API

### useAnnotations（修改）

新增方法：
```js
clipAnnotations(clipStart, clipEnd, typesToClip = 'all')
// 剪切指定范围内的标注（保留两侧残留）
// typesToClip: 'all' | 'bold' | 'highlight' | 'underline'
```

### useAnnotationInteraction（修改）

新增入参：
```js
{ ..., annotations, clipAnnotations }
```

新增返回值：
```js
{ ..., hasOverlap, handleCancel, openMenuForRange }
// hasOverlap: boolean，pendingRange 与任意 annotation 有重叠
// handleCancel: () => void，Rule 1 取消
// openMenuForRange: (e, segStart, segEnd) => void，Rule 3 单击入口
```

### AnnotationMenu（修改）

新增 props：
```js
{ ..., showCancel, onCancel }
// showCancel=true 时渲染「✕」按钮（#ff453a 红色）
```

### AnnotatedText（修改）

新增 prop：
```js
{ ..., onAnnotatedClick }
// onAnnotatedClick(e, segStart, segEnd)，仅有标注的 Segment 绑定
```

---

## 接入位置

三个页面（RecordDetail / ReviewLetterDetail / ThreadDetailPage）均已更新：
- `useAnnotations` 解构加 `clipAnnotations`
- `useAnnotationInteraction` 加入 `annotations` / `clipAnnotations` 参数，解构 `hasOverlap` / `handleCancel` / `openMenuForRange`
- `AnnotationMenu` 加 `showCancel={hasOverlap}` / `onCancel={handleCancel}`
- `AnnotatedText` 加 `onAnnotatedClick={openMenuForRange}`

---

## 代码审查修复（73c0f15，共 5 条）

| # | 修复内容 |
|---|---|
| #1 | — |
| #3 | — |
| #4 | — |
| #6 | — |
| #9 | — |

> ⚠️ 具体修复内容请参考 commit 73c0f15 的 diff，此处留空待补充。

---

## 架构规则（新增）

**§4.49（新增）：** 凡接入标注的页面，`rawText`（传给 hook 用来计算偏移）和实际渲染的文本必须来自同一个字符串。用不同来源的两个字符串（哪怕内容相近）会在用户编辑后产生偏移错位。

**§4.48（已有）：** 标注初始化必须在 loadFull 后调 `resetAnnotations(data.annotations)`，不能依赖 useState prop 更新。

---

## 已知局限

- iOS 系统菜单与自定义标注菜单共存（设计决策，待 Capacitor 打包阶段处理）
- AwarenessFlow 觉察流输入区暂未接入标注（写作页 textarea → Lexical 升级后再处理）
- Rule 3 的并集范围计算：若两条标注距离很远但中间有第三条衔接，并集会偏大，属于设计上的边界情况，当前接受

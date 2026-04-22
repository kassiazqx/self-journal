# 同步卡：标注系统代码审查修复

**日期：** 2026-04-22  
**类型：** Bug Fix（代码审查后修复）  
**commit：** 73c0f15  
**影响范围：** RecordDetail / useAnnotationInteraction / ThreadDetailPage

---

## 背景

标注系统（Part 1 + 2 + 2.5）完成后，进行了完整代码审查，发现 3 个 Critical + 2 个 Important 问题。本批修复其中 5 个（另 2 个为优化建议，不做）。

---

## 修复详情

### #1 RecordDetail messages 分支：渲染文本与 rawText 不同源（Critical）

**问题：**  
`useAnnotationInteraction` 接收 `rawText: entry.content`，但 messages 分支 `raw_entry` 节点渲染的是 `msg.content`（AwarenessFlow 写入时的对话快照）。

用户编辑记录后，`entry.content` 更新，`msg.content` 不更新。两者不同步时，标注 start/end 偏移对应到错误的字符位置，标注渲染位置偏移。

**修复：** raw_entry 节点改为渲染 `entry.content`，rawText 与渲染文本统一。

**新增架构规律（§4.49）：** 传入 `rawText` 的字符串和 `AnnotatedText` 的 `text` prop 必须是同一个表达式。

---

### #3 handleAIAnalyze 后未 resetAnnotations（Critical）

**问题：**  
AI 分析完成后，代码 re-fetch 了最新 entry 并 `setEntry(data)`，但没有调 `resetAnnotations(data.annotations)`。本地标注状态停留在旧版本，下次 debounce 保存时把旧标注写回 DB，覆盖服务端已有的内容。

**修复：** re-fetch 后补调 `resetAnnotations(data.annotations)`。

**关联架构规律（§4.48）：** 任何触发 entry 重新加载的操作都必须同步调 resetAnnotations，不仅仅是 loadFull。

---

### #4 openMenuForRange 缺越界检查（Critical）

**问题：**  
`openMenuForRange(e, segStart, segEnd)` 没有检查 segStart/segEnd 是否在合法范围内。极端情况下（annotations 数据异常或文本被截断），可能写入越界的 pendingRange，导致后续 addAnnotation 写入非法偏移。

**修复：** 函数入口加守卫：
```js
if (segStart < 0 || segEnd > rawText.length || segStart >= segEnd) return
```

---

### #6 closeMenu 空依赖数组无注释（Important）

**问题：**  
`useCallback(fn, [])` 空 deps 没有注释，维护者可能误以为是遗漏了依赖项。

**修复：** 加注释 `// intentionally empty — no captured vars`。

---

### #9 ThreadDetailPage 双重 resetAnnotations（Important）

**问题：**  
mount 时有两个地方调 resetAnnotations：
1. `useEffect` 在 `thread.id` 变化时 reset（意图是处理初始值为 null 的情况）
2. `load()` 完成后 reset（正确的来源）

两者都会触发。在网络较慢时，useEffect 先用旧数据 reset，load() 完成后再 reset 一次，中间有一帧会显示旧标注（闪烁）。

**修复：** 去掉 useEffect 内的 reset，只保留 load() 内的那个。load() 内先 `setThread(t)` 再 `resetAnnotations(t.current_state_annotations)`，顺序正确，数据是最新的。

---

## 架构文档更新

- **§3 文件结构**：RecordDetail 新增两条注记（handleAIAnalyze 须 resetAnnotations；raw_entry 节点必须用 entry.content）；ThreadDetailPage 新增注记（去掉冗余 useEffect reset 的理由）
- **§4.48 补充**：不要在 loadFull 之外额外写 useEffect reset（双重调用会导致闪烁）
- **§4.49 新增**：rawText 与渲染文本必须同源（完整规律 + 反例说明）
- **§6 日志**：追加本批修复条目

---

## 未做的建议项

| # | 内容 | 理由 |
|---|---|---|
| #5 | isFullyCovered 函数每次渲染重新声明 | 性能影响几乎为零，不做 |
| #7/#8 | 其他次要 suggestion | 同上 |

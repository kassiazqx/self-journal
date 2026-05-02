# Lexical JSON Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在隔离 playground 中验证“现有 Lexical 壳切到 RichTextPlugin 后，是否能用 Lexical JSON 作为原型真源，并与现有自动识别函数稳定共存”

**Architecture:** 不改正式 `RichTextEditor`、`HomePage`、保存链、DB。新建独立原型页面 / 组件，直接复用现有 `detectPeopleFromText()`、`inferDatetime()` 做实时验证。原型只服务交互验证，不承诺正式数据格式。

**Tech Stack:** React, Lexical RichTextPlugin, Lexical JSON, existing contacts/date utils

---

## 文件结构

**Create:**
- `src/components/prototypes/LexicalJsonPrototype.jsx`
- `src/lib/prototypes/lexicalPlainText.js`

**Modify:**
- `src/pages/SettingsPage.jsx`

**Notes:**
- 原型入口先挂到 Settings 页一个实验区按钮或内联 demo 容器，不改 MainLayout 导航结构
- 不复用正式 `RichTextEditor.jsx`，避免把 plain-text/annotations 逻辑和原型富文本逻辑缠死

---

### Task 1: 搭建原型入口

**Files:**
- Create: `src/components/prototypes/LexicalJsonPrototype.jsx`
- Modify: `src/pages/SettingsPage.jsx`

- [ ] 新建隔离原型组件，使用 `LexicalComposer + RichTextPlugin + HistoryPlugin + ContentEditable + OnChangePlugin`
- [ ] Settings 页新增“文本原型实验”区块，只在本地手工进入，不接业务导航
- [ ] 原型组件只持有本地 state：
  - `editorJson`
  - `plainText`
  - `detectedPeople`
  - `detectedDatetime`

### Task 2: 接通 JSON 真源和纯文字语义

**Files:**
- Create: `src/lib/prototypes/lexicalPlainText.js`
- Modify: `src/components/prototypes/LexicalJsonPrototype.jsx`

- [ ] 在 `onChange` 中同时导出：
  - `editorState.toJSON()` 作为原型保存真源
  - `$getRoot().getTextContent()` 作为纯文字语义
- [ ] 把纯文字语义送入现有：
  - `detectPeopleFromText()`
  - `inferDatetime()`
- [ ] 页面上同时展示：
  - 可视编辑区
  - JSON 预览
  - 纯文字语义预览
  - 人物识别结果
  - 时间识别结果

### Task 3: 验证“样式变化不干扰识别”

**Files:**
- Modify: `src/components/prototypes/LexicalJsonPrototype.jsx`

- [ ] 提供最小工具栏：
  - 粗体
  - 下划线
  - 高亮占位（可先用 theme/class 或简单 mark 节点方案）
  - 颜色占位（若当轮实现成本过高，可先明确标成 TODO-not-in-prototype）
- [ ] 在 UI 上显示上一次 `plainText`，只在纯文字变化时刷新识别结果
- [ ] 验证最小交互：
  - 同一段文字只改样式，`plainText` 不变
  - 人物 / 时间识别不闪断

### Task 4: round-trip 本地验证

**Files:**
- Modify: `src/components/prototypes/LexicalJsonPrototype.jsx`

- [ ] 提供“导出当前 JSON”“从当前 JSON 重载”按钮
- [ ] 验证：
  - 段落保留
  - 空行保留
  - 样式重载后仍可见
  - 纯文字语义重载前后不变

### Task 5: 原型结论记录

**Files:**
- Modify: `docs/superpowers/plans/2026-04-29-text-source-direction.md`

- [ ] 在总文档追加原型观察结论区：
  - 哪些成立
  - 哪些卡住
  - 是否值得进入正式 spec


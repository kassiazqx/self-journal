# TipTap JSON Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在隔离 playground 中验证“TipTap JSON 是否比 Lexical 更适合这个产品的轻量 WYSIWYG 写作 + 纯文字语义提取”

**Architecture:** 新增完全隔离的 TipTap 原型组件，不改正式编辑器链路。原型只验证交互质量、JSON round-trip、纯文字语义提取和现有自动识别兼容性。

**Tech Stack:** React, TipTap, StarterKit, Highlight, Color, Underline, existing contacts/date utils

---

## 文件结构

**Create:**
- `src/components/prototypes/TipTapJsonPrototype.jsx`
- `src/lib/prototypes/tiptapPlainText.js`

**Modify:**
- `src/pages/SettingsPage.jsx`
- `package.json`

**Notes:**
- 依赖需先安装：
  - `@tiptap/react`
  - `@tiptap/starter-kit`
  - `@tiptap/extension-highlight`
  - `@tiptap/extension-text-style`
  - `@tiptap/extension-color`
  - `@tiptap/extension-underline`

---

### Task 1: 安装依赖并建立隔离入口

**Files:**
- Modify: `package.json`
- Create: `src/components/prototypes/TipTapJsonPrototype.jsx`
- Modify: `src/pages/SettingsPage.jsx`

- [ ] 安装 TipTap 依赖
- [ ] 新建独立 TipTap 原型组件
- [ ] Settings 页新增 TipTap 原型入口，与 Lexical 原型并列

### Task 2: 接通 JSON 真源和纯文字语义

**Files:**
- Create: `src/lib/prototypes/tiptapPlainText.js`
- Modify: `src/components/prototypes/TipTapJsonPrototype.jsx`

- [ ] 在 `onUpdate` 中同时导出：
  - `editor.getJSON()` 作为原型保存真源
  - `editor.getText({ blockSeparator: '\\n\\n' })` 作为纯文字语义
- [ ] 复用现有：
  - `detectPeopleFromText()`
  - `inferDatetime()`
- [ ] 页面上展示：
  - 可视编辑区
  - JSON 预览
  - 纯文字语义预览
  - 人物识别结果
  - 时间识别结果

### Task 3: 验证基础样式和识别稳定性

**Files:**
- Modify: `src/components/prototypes/TipTapJsonPrototype.jsx`

- [ ] 工具栏最小集：
  - 粗体
  - 下划线
  - 高亮
  - 颜色
- [ ] 验证“只改样式不改语义”时：
  - `plainText` 不变
  - 人物 / 时间识别不闪断

### Task 4: round-trip 本地验证

**Files:**
- Modify: `src/components/prototypes/TipTapJsonPrototype.jsx`

- [ ] 提供“导出当前 JSON”“从当前 JSON 重载”按钮
- [ ] 验证：
  - 段落保留
  - 空行保留
  - 样式重载正确
  - 纯文字语义重载前后不变

### Task 5: 与 Lexical 原型并排对比

**Files:**
- Modify: `src/pages/SettingsPage.jsx`
- Modify: `docs/superpowers/plans/2026-04-29-text-source-direction.md`

- [ ] 在 Settings 原型区加入对比提示：
  - 中文输入顺滑度
  - 选区 / 样式手感
  - 识别稳定性
  - 手机端体验
- [ ] 在总文档追加 TipTap 原型观察结论区

# 编辑器框架升级设计

**日期：** 2026-04-22
**状态：** 📋 设计存档，待 Part 1 & 2 & 2.5 完成后执行
**优先级：** 在标注系统全部跑通 + AI 标注 prompt 校准完成后开始

---

## 一、目标

将所有文字输入区从 `<textarea>` 换成富文本编辑器，实现**写作与标注同时发生**，消灭「先写完再切到详情页才能标注」的割裂体验。

---

## 二、当前架构限制

`<textarea>` 由浏览器内核控制文本渲染，无法在其内部注入任何自定义 HTML 元素（CSS inline spans、标注覆盖层等）。现有标注系统（AnnotatedText）是纯 CSS inline spans，只能在只读视图下工作。

当前存储设计（纯文本 `content` + 独立 `annotations` JSON）与编辑器框架**完全兼容**，不需要改数据模型。

---

## 三、技术选型：Lexical

**选择 Lexical（Meta 出品）的理由：**

| 对比项 | Lexical | TipTap | Slate |
|---|---|---|---|
| 维护方 | Meta（生产级） | 开源社区 | 社区 |
| 中文 IME（输入法）| 最好 | 好 | 历史 bug 多 |
| 移动端 | 专项优化 | 一般 | 一般 |
| React 集成 | 原生 | 插件 | 原生 |
| Capacitor 兼容性 | 已验证 | 一般 | 未知 |
| Bundle 大小 | 中 | 中 | 中 |

---

## 四、架构设计

### 4.1 存储方案不变

```
DB 存储：
  content              TEXT    ← 纯文本，AI 直接读取，不含任何格式标记
  annotations          JSONB   ← 标注数组 [{type, start, end, color?}]
```

从编辑器状态提取纯文本（`editor.getEditorState().read(() => $getRoot().getTextContent())`），存入 `content`。标注仍以 JSON 独立存储，不使用 Lexical 的内置 mark/decoration 系统。

### 4.2 编辑器内的标注渲染

Lexical 支持自定义 inline 节点，可在编辑器内部对文本节点应用 CSS 样式。

原理：
- 编辑器文本层：Lexical 管理（负责光标、输入、IME）
- 标注渲染：通过 Lexical **transform**，在 `onChange` 后把标注范围内的 TextNode 替换为带 CSS inline style 的自定义 `AnnotatedNode`（复用 AnnotatedText 的同一套样式逻辑：highlight 用 `linear-gradient` 背景色，underline 用 `text-decoration wavy`，bold 用 `fontWeight: 700`）
- 提取纯文本：`editor.getEditorState().read(() => $getRoot().getTextContent())`，不含任何格式标记，直接存 DB

**注意：** 不使用 Lexical 内置的 bold/italic 格式系统，保持 annotations 独立于 Lexical 内部状态，只在渲染层生效。

### 4.3 输入时偏移同步

用户在已有标注的文字前方插入或删除字符时，需要更新后续所有标注的 `start` / `end`。

```js
// 监听 Lexical 的 onChange，计算字符增删位置和数量
// 对所有 annotations 执行偏移修正
function shiftAnnotations(annotations, changeStart, delta) {
  return annotations.map(a => {
    if (a.end <= changeStart) return a                        // 在变更点之前，不受影响
    if (a.start >= changeStart) return { ...a,               // 整条在变更点之后，整体平移
      start: Math.max(0, a.start + delta),
      end: Math.max(0, a.end + delta),
    }
    // 变更点在标注内部：end 平移，start 不变（标注被拉伸/收缩）
    return { ...a, end: Math.max(a.start + 1, a.end + delta) }
  }).filter(a => a.start < a.end)   // 过滤掉被删光的标注
}
```

此逻辑加入 `useAnnotations` hook，在编辑器 onChange 时调用。

---

## 五、影响的页面

| 页面 / 组件 | 当前 | 改后 |
|---|---|---|
| NewEntryPage（写新日记） | `<textarea>` | Lexical 编辑器 |
| EditEntryPage（编辑已有日记） | `<textarea>` | Lexical 编辑器 |
| AwarenessFlow（觉察流文字输入） | `<textarea>` | Lexical 编辑器（仅输入区，非展示区） |
| RecordDetail（详情只读） | AnnotatedText（已实现）| 不变 |
| ReviewLetterDetail（回顾信只读）| AnnotatedText（已实现）| 不变 |
| ThreadDetailPage（脉络只读） | AnnotatedText（已实现）| 不变 |

---

## 六、系统菜单策略

### 手机浏览器（开发阶段）

iOS Safari：无法压制系统 copy/paste 菜单。

采用**职责分离方案**：
- 系统菜单：处理 copy / cut / paste（让系统管）
- 自定义标注菜单：处理 B / U / ▌ / 取消（我们管）
- 两个菜单在时机上错开，不强求合并

### Capacitor 打包后

**Android（WebView）：** 可以完全控制，自定义菜单包揽所有操作（含 copy/cut/paste）。

**iOS（WKWebView）：** WKWebView 比 Safari 给的权限更多，但 Apple 系统菜单仍是系统级 UI。可通过 Capacitor 插件拦截部分行为，但完全压制不可靠。

**最终策略：** Android 实现自定义菜单统一接管；iOS 接受系统菜单 + 自定义标注菜单共存，用户体验上可接受（与 Notion iOS 方案一致）。

---

## 七、不做的事（YAGNI）

- **不自己实现 contentEditable**：直接用 Lexical，不造轮子
- **不改数据模型**：content 继续存纯文本，annotations 继续独立 JSON
- **不做协同编辑**：单用户场景，Lexical 的协同功能不引入
- **不做版本历史**：编辑器不需要 undo 超过会话范围
- **不把 Lexical marks 存 DB**：格式标记只用于渲染，不存储为编辑器内部格式

---

## 八、实现顺序（写 plan 时参考）

```
Task 0：安装 Lexical + @lexical/react，验证基础 render
Task 1：封装 RichTextEditor 组件（替代 textarea，支持中文输入，提取纯文本）
Task 2：实现 shiftAnnotations（onChange 时偏移同步），加入 useAnnotations
Task 3：实现编辑器内标注渲染（AnnotatedNode 自定义节点 + Lexical transform，复用 CSS 样式逻辑）
Task 4：选区接入（Lexical 选区 → 偏移 → useAnnotationInteraction，弹菜单）
Task 5：替换 NewEntryPage 的 textarea
Task 6：替换 EditEntryPage 的 textarea
Task 7：集成测试（写日记 → 标注 → 保存 → AI 提取 → 验证纯文本正确）
```

**注：** AwarenessFlow 的觉察流输入区（结构化短文本）暂不接入，优先级低。

---

## 九、成功标准

1. 在写新日记时可以选中文字、弹出标注菜单、加粗/高亮，标注随输入实时更新
2. 继续在已标注文字前后打字，标注位置正确跟随（不偏移）
3. 保存后，`content` 字段是纯文本（不含任何格式标记），AI 可直接读取
4. `annotations` 字段与详情页格式一致，详情页 AnnotatedText 可直接渲染
5. 中文拼音输入过程中不出现乱码或重复字符
6. Android Capacitor 打包后，自定义菜单正常工作，系统菜单被压制

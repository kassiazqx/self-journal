# Text Source Direction Decision Doc

> **Document role:** This is the global direction and architecture-boundary document for the next text-system evolution. It is not a code-ready implementation plan. Its job is to fix background, requirements, hard boundaries, and phased scope before any coding plan or migration plan is written.

**Goal:** 为 self-journal 确定下一阶段文本系统的最稳方向：在不破坏现有人物识别、时间推断、AI 上下文、搜索预览和移动端输入稳定性的前提下，把 `journal_entries` 写作主路径升级为真正的所见即所得轻量富文本写作，并为后续阶段统一详情页、编辑页、回顾信、脉络分析留出清晰边界。

**Architecture:** 当前线上真实模型是 `content` 纯文本 + `annotations` offset 样式层 + `AnnotatedText` 只读渲染。本轮方向已经收敛为：**编辑器选 Lexical；用户编辑层永远保持可视化写作；第一阶段只正式落地 `journal_entries` 写入页；保存模型内部区分“编辑状态 / 保存真源 / 纯文字语义”，但不在第一阶段直接启动全站迁移。**

**Tech Stack:** React, Lexical, plain-text semantic extraction, current `content + annotations` compatibility bridge, Supabase now, future APK + local-first storage

---

## 0. 决策状态

### 0.1 已决定

- 编辑器方向：`Lexical`
- 用户编辑层：只允许 WYSIWYG，可视化写作，不允许直接编辑 Markdown / HTML / JSON 源码
- 第一阶段正式落地范围：`journal_entries` 写入主路径（HomePage）
- 第一阶段工具栏：固定底部，不做选区浮动栏
- 第一阶段样式能力：
  - 分段
  - 粗体
  - 单一下划线
  - 单一高亮
  - 固定几种文字颜色
  - 清除样式
- 第一阶段不做：
  - 多色高亮
  - 多色下划线
  - 全站统一迁移
  - APK 专项适配

### 0.2 已延后

- 详情页统一富文本渲染
- 编辑已有日记统一富文本编辑
- 回顾信 / 脉络分析统一到同一真源
- 正式去除旧 `annotations` 依赖
- 列表、引用、对齐、todo checklist

### 0.3 暂不拍板

- `journal_entries` 新增 JSON 真源字段的最终命名
- 第二阶段何时切详情页 / 编辑页
- 第三阶段是否统一回顾信 / threads 真源模型
- 最终是否保留 `annotations` 长期共存

---

## 1. 背景：现有代码真实状态

### 1.1 当前文本链路实际上怎么工作

从现有代码看，项目当前并不是“富文本真源”架构，而是三段式文本链路：

1. **写作 / 编辑态**
   - `HomePage.jsx` 和 `EditEntryPage.jsx` 都使用 `RichTextEditor`
   - 但 `RichTextEditor.jsx` 内部当前仍是 Lexical `PlainTextPlugin`
   - 编辑器输出的是纯文本，不是结构化富文本文档

2. **样式层**
   - 样式没有进入正文真源
   - 当前样式通过独立 offset 数组保存：
     - `journal_entries.annotations`
     - `review_letters.annotations`
     - `threads.current_state_annotations`
   - 正文和样式目前是两份并行数据

3. **只读展示层**
   - `RecordDetail.jsx`、`ReviewLetterDetail.jsx`、`ThreadDetailPage.jsx`
   - 当前都通过 `AnnotatedText(text, annotations)` 渲染样式

这意味着当前线上真实模型是：

- `content` / `current_state` = 纯文字主内容
- `annotations` = 样式偏移层
- `RichTextEditor` = 纯文本输入壳 + 编辑态样式显示

而不是：

- `content` 直接存 Markdown
- `content` 直接存 HTML-like tag
- 编辑器 doc model 成为唯一保存真源

### 1.2 现有代码里已经存在的纯文本消费者

当前代码里，直接或间接把 `content` / `current_state` 当纯文字使用的链路已经很多，不止编辑器一处：

- `HomePage.jsx`
  - `inferDatetime(content)` 做时间识别
  - `detectPeopleFromText(content, contacts)` 做人物识别
- `AwarenessFlow.jsx`
  - `buildAwarenessContext(entry.content, ctxMessages)` 直接把正文送入 AI 上下文
- `prompts.js`
  - `getInitialUserMessage(entry, ...)`
  - `buildAwarenessContext(rawContent, answeredMessages)`
- `entryFullText.js`
  - `buildEntryFullText()`
  - `buildReviewLetterRichContent()`
- `RecordsPage.jsx`、`ThreadsPage.jsx`、`ThreadDetailPage.jsx`
  - 列表预览直接对 `content` 做裁切
- `threadService.js`
  - `generateThreadAnalysis()` 直接把 `journal_entries.content` 作为分析输入
- `exportService.js`
  - 直接导出当前文本字段

因此，任何未来的文本真源调整，都不是“只换编辑器”这么简单，而是会波及：

- 自动识别
- AI 上下文
- 列表预览
- 搜索 / 摘要
- 回顾信 / 脉络分析
- 导出 / 备份

### 1.3 当前实现已经暴露出的矛盾和维护成本

现有文本系统已经暴露出几类真实矛盾：

1. `RichTextEditor` 名字已经是富文本，但核心输入仍是纯文本
2. 样式与正文分离，用户一改字就要维护 offset
3. 这套 offset 模型已经复用到 `journal_entries / review_letters / threads`
4. 编辑页已经存在正文、对话快照、标注三套同步成本
5. 自动识别默认读纯文字，天然不适合直接读格式源码
6. 预览链路默认假设 `content` 可直接裁切，不能突然变成带源码标记的保存串

结论不是“现有方向错了”，而是：

**当前链路适合只读标注和纯文本写作，但不适合继续承担‘真正的富文本编辑真源’。**

---

## 2. 用户真实需求与优先级

### 2.1 第一优先级：必须满足

当前确认的真实需求是：

1. 分段
2. 粗体
3. 单一下划线
4. 单一高亮
5. 固定几种文字颜色
6. 用户看到的就是最终效果，不是 `**`、`<mark>` 或 JSON 源码
7. 时间 / 人物自动识别不能因为样式操作而闪断、撤回、再恢复
8. 写作主路径保持顺滑，尤其是移动端和中文输入

### 2.2 当前明确不做

当前不做：

- 多色高亮
- 多色下划线
- 浮动选区工具栏
- Markdown 源码编辑
- HTML 源码编辑
- 全站一口气迁移
- 为了这轮选型专门启动 APK 适配工程

### 2.3 后续可能再做

后续可能再做，但不属于第一阶段：

- 对齐
- 引用
- 无序列表
- 有序列表
- todo checklist
- 详情页统一富文本渲染
- 编辑页统一富文本编辑
- 回顾信 / threads 统一真源

说明：

- Lexical 官方支持列表和 checklist 能力，但它们不进入第一阶段范围
- 当前先把主路径收窄到最小稳定写作集合

---

## 3. 核心架构结论

### 3.1 编辑器选 Lexical

原因不是“Lexical 理论上最强”，而是结合当前项目形态，Lexical 是阻力最小、迁移成本最低、输入稳定性信心最高的路线：

- 项目里已经有 Lexical
- 当前原型手感已通过基础验证
- 中文 / IME / 移动端维护信号比 TipTap 更稳
- 当前需求范围还不需要为了扩展生态承担额外迁移成本

### 3.2 用户编辑层必须始终是可视化写作

用户编辑层不应被理解为：

- 编辑 Markdown 源码
- 编辑 HTML-like tag
- 编辑 JSON

正确理解是：

**用户编辑层 = 受限但真实的 WYSIWYG 写作层**

也就是：

- 用户只看到分段、粗体、高亮、下划线、颜色效果
- 系统内部保存什么，是内部实现细节
- 内部保存真源不等于用户直接操作对象

### 3.3 三层模型

这轮方向统一采用三层模型：

1. **编辑状态**
   - 用户正在改的可视化写作状态
   - 第一真相

2. **保存真源**
   - 编辑器导出的结构化持久化结果
   - 当前推荐为 Lexical JSON doc model

3. **纯文字语义**
   - 给人物识别、时间推断、AI、搜索、列表预览使用的干净文字

最关键的一句：

**编辑状态是主状态；保存真源和纯文字语义都是派生结果。**

### 3.4 第一阶段推荐保存策略

第一阶段不推荐直接把 `content` 改造成 JSON 真源。

推荐策略是：

- `content` 继续保持纯文字语义
- 新增一个 JSON 真源字段保存 Lexical doc model
- `annotations` 在第一阶段继续作为兼容桥接输出存在，用来喂现有详情页 / 旧编辑链路

也就是说，第一阶段的推荐落法是：

- `content` = 给旧系统和现有消费者继续使用的干净文字
- `content_source` = 新增的结构化真源字段（文档中的推荐命名，最终字段名可在实现 plan 中定）
- `annotations` = 从结构化真源导出的兼容层，不再是写作主真相

这不是长期终局，而是第一阶段最稳的兼容桥接。

---

## 4. 为什么现在不能直接做全站统一迁移

如果现在直接宣布“整个产品统一成 Lexical JSON 真源”，风险会立刻扩大为：

- 写入主路径改造
- 详情页渲染改造
- 编辑页回填改造
- 回顾信 / threads 改造
- AI 输入链路改造
- 搜索和预览链路改造
- 历史数据兼容改造

这会把问题从“先把写作主路径做好”放大成“重做整个文本系统”。

当前不这么做，原因有四个：

1. 先把主路径体验做稳，比先追求全站统一更重要
2. 当前旧 `annotations` 体系仍然承担正式读链路责任，不能在第一阶段一起硬切
3. 详情页 / 编辑页 / 回顾信 / threads 的节奏和风险不相同，应该分批处理
4. 先写全站迁移 plan，容易把第一阶段写作需求卷入不必要的大范围架构改动

---

## 5. 阶段路线图

### 5.1 阶段 A：`journal_entries` 写入主路径正式落地

目标：

- 让 HomePage 正式进入 Lexical WYSIWYG 写作
- 保存时同时导出：
  - 纯文字 `content`
  - Lexical JSON 真源
  - 兼容用 `annotations`
- 自动识别继续吃纯文字语义
- 现有详情页 / AI / 搜索 / 预览先不被破坏

说明：

- 阶段 A 的重点是正式写入主路径，不是全产品统一真源

### 5.2 阶段 B：详情页 / 编辑页统一

目标：

- 详情页优先支持直接渲染结构化真源
- 编辑已有日记切换到同一套正式 Lexical 编辑器
- 逐步降低对兼容 `annotations` 的依赖

说明：

- 阶段 B 才是“entry 自己的读写闭环统一”
- 这一步完成后，`journal_entries` 才算真正完成文本真源升级

### 5.3 阶段 C：回顾信 / threads 评估是否并入同一真源模型

目标：

- 评估 `review_letters`、`threads.current_state` 是否需要同样升级
- 再决定是否统一字段策略、渲染策略、编辑器策略

说明：

- 这一步不能默认自动发生
- 必须在 entry 主路径稳定之后，再单独判断收益与复杂度

---

## 6. 第一阶段硬边界

### 6.1 第一阶段包含

第一阶段包含：

- `HomePage` 写入主路径
- 正式 Lexical 写作编辑器
- 固定底部工具栏
- 最小样式集：
  - 粗体
  - 下划线
  - 单一高亮
  - 固定文字颜色
  - 清除样式
- 纯文字提取继续供：
  - `detectPeopleFromText()`
  - `inferDatetime()`
  - 现有 AI / 搜索 / 预览链路
- 保存时输出兼容 `annotations`
- 草稿恢复支持结构化真源

### 6.2 第一阶段不包含

第一阶段不包含：

- 回顾信
- 脉络分析
- `threads.current_state`
- 详情页统一富文本渲染
- 编辑已有日记统一富文本编辑
- 多色高亮 / 多色下划线
- 选区浮动工具栏
- 列表 / 引用 / 对齐 / todo checklist
- APK 专项适配
- 字段删除
- 历史数据回填迁移

### 6.3 第一阶段上线前必须满足的兼容前提

虽然第一阶段中心是 HomePage，但上线前必须满足两个兼容前提：

1. **详情页必须仍能正常显示新写入 entry 的样式**
   - 第一阶段通过 `annotations` 兼容桥接解决

2. **旧编辑链路不能把新的结构化真源默默写乱**
   - 在第二阶段统一编辑页落地前，必须对 legacy edit path 加防护
   - 可选防护方式：
     - rich-source entry 暂不走旧编辑页
     - 或旧编辑页保存时显式清理 / 降级 `content_source`
   - 不能允许 stale `content_source` 静默长期存在

---

## 7. 待后续 spec 决定的问题

下面这些问题明确留给后续详细 spec / implementation plan，不在本总纲里写死：

1. `content_source` 字段最终命名
2. JSON 包装结构的最终 schema
3. 是否需要额外的 source version 标记
4. 兼容 `annotations` 的导出规则精度
5. 详情页最终渲染优先级：
   - 先渲染 `content_source`
   - 还是继续先走 `annotations`
6. 旧编辑页的具体防护方案
7. 搜索和导出后续是否也要直接消费结构化真源

---

## 8. 风险闸门与暂停条件

如果出现以下任一情况，当前路线应暂停继续扩展，先回到 spec / plan 层重新评估：

1. 样式操作频繁干扰自动识别
2. 编辑器实现无法清楚区分“文字变化”和“样式变化”
3. 中文输入、移动端输入或选区出现明显硬伤
4. 草稿恢复无法稳定 round-trip
5. 兼容 `annotations` 导出成本明显失控
6. 旧编辑链路与新真源形成双真相混乱

继续推进的通过条件是：

1. 写作体验明显好于当前纯文本 + offset 标注
2. `content` 继续保持干净纯文字
3. 样式变化不触发人物 / 时间识别闪断
4. 详情页在第一阶段仍可正确显示样式
5. 新旧 entry 可以并存，不破坏现有正式数据

---

## 9. 下一份文档是什么

本总纲之后，下一步不是直接写代码，也不是直接写全站迁移 plan。

下一步应当写：

**`journal_entries` 写入主路径（HomePage）详细 spec**

这份详细 spec 负责回答：

- HomePage 正式 Lexical 写作体验怎么设计
- 底部工具栏怎么交互
- 保存时如何同时导出纯文字 / JSON 真源 / 兼容 annotations
- 草稿、识别、提及人物、图片、时间 pill 如何并存
- legacy edit path 在第二阶段前如何防护

只有这份 spec 确认后，才进入 implementation plan。

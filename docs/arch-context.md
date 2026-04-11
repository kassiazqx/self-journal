# 架构上下文 | arch-context.md

> 这是给架构/debug session 冷启动用的核心文档。
> 每次架构 session 被唤醒，必须先读这个文件，再读相关 spec/plan，才能开始工作。
>
> **各区块维护责任：**
> - §1 §2 → 产品 session 维护
> - §3 → 代码 session 维护
> - §4 §5 → 架构 session 维护
> - §6 → 三方都写（变更后追加一行）

---

## §1 当前产品目标

**产品名：** 自我觉察日记（self-journal）

**核心方向（不能偏离）：**
用户写下内容 → 被温和地引导看清楚自己 → 数据在后台默默沉淀 → 随着时间积累成洞察。

这是一个**觉察工具**，不是 AI 聊天室，不是分析平台。

```
四个主 Tab：
写   记录   洞察   我的
（图标字段已预留，当前仅显示文字标签）
```

**三层数据结构：**
```
用户感知层
  └── 写 (Write Tab)
  └── 看 (Records Tab + Insights Tab)

数据层
  ├── journal_entries    每次写的原始内容 + AI 提取字段
  ├── conversations      每次写作的完整问答流（含本地引导 + AI 引导）
  └── review_letters     定期的跨条目阶段性回望信件
```

**当前阶段：** 阶段二重设计（AwarenessFlow 单屏觉察流 + 回顾信系统）已在代码 session 实现中。

---

## §2 已确认架构决策

> 每条决策都包含"为什么"和"不要改成什么"。

### 2.1 数据路径（最容易混淆，必读）

```
写作流保存路径：
  journal_entries   ← 原始写作内容 + 基础字段（keywordDetection 结果）
  conversations     ← 完整问答流（含本地卡片Q&A + AI引导Q&A）

AI 提取路径（手动触发，不在保存时自动跑）：
  用户在详情页点「AI 分析」→ extractFields() → 写回 journal_entries 的提取字段

旧路径（兼容保留，不是 bug）：
  full_conversation 字段（JSONB）← 阶段二之前的旧 AIConversation 写入
  ⚠️ 两条路径同时存在是故意的，conversations 表是新主路径
```

**不要改成什么：**
- 不要在保存时自动调 AI 提取
- 不要把 full_conversation 和 conversations 表混用或合并
- 不要认为"conversations 表不存在"是 bug（它是阶段二新建的）

### 2.2 db.js 适配层（架构接缝）

```
所有数据访问必须通过 db.js：
  import { db } from './db'    ✅
  import { supabase } from './supabase'  ❌（仅 db.js 内部允许）

db.js 现在是透传 supabase，未来切换 SQLite / 本地存储只改 db.js 一个文件。
```

**不要改成什么：**
- 不要在 pages/ 或 components/ 里直接 import supabase
- 不要在 db.js 里加 `if (error) throw error`（调用方负责处理错误）

**当前已知例外：** `journalService.js` 仍直接用 supabase（存量问题，下次专项迁移）

### 2.3 conversations 表的 UPSERT 规则

```
UNIQUE(entry_id, context_type) → 每条 entry 只有一行对话记录
再次进入 AwarenessFlow 时必须用 UPSERT，不是 INSERT

保存逻辑：
  前端 state 维护完整 messages 数组（含历史 + 当次新增）
  保存时用完整数组覆盖，不在数据库层做数组合并
```

**不要改成什么：**
- 不要用 INSERT 往 conversations 写（会因 UNIQUE 冲突报错）
- 不要只把当次新增的消息传给数据库（需要完整数组）

### 2.4 情绪字段分工

```
emotion_display  （text[]）← AI 提取的描述层，自然语言，用于展示
emotions         （text[]）← 本地映射后的基础层 57 词，用于统计
emotion_confidence（float）← mapDisplayToBase() 返回的 minConfidence

映射函数：mapDisplayToBase() 在 emotionMap.js，本地运行，零 token
```

**不要改成什么：**
- 不要把 emotions 和 emotion_display 互换使用
- 不要在用户编辑情绪词时调 AI（只用本地映射）
- 不要自动扩展基础层 57 词词库

### 2.5 AI 调用策略

```
手动触发：
  - 深入觉察对话（用户点 ✦）
  - 字段提取（用户在详情页点「AI 分析」）
  - 回顾信生成（按设置周期 或 用户手动点「立即生成」）

自动（零 token）：
  - 本地关键词检测（保存时自动）
  - 情绪基础层映射（AI 分析完成后本地运行）

绝对不做：
  - 保存动作本身触发任何 AI 调用
  - 用户写作途中（未点 ✓）触发 AI 网络请求
```

### 2.6 AI 记忆存储

```
AI 跨对话记忆 → Supabase user_memory 表（多端同步）
  rolling_summary：历史对话压缩摘要
  user_profile：用户画像（包含 letter_prefs 等设置）

对话临时缓存 → localStorage（防刷新丢失，key: chat_session_{entry.id}）
问题库 → 硬编码在 prompts.js（不存 DB，更新靠 git push）
```

### 2.7 模板系统

```
新模板 ID：awareness / gratitude / learning / freewrite / action
旧模板 ID：emotion / free（历史数据里存的）

兼容方式：resolveTemplate(id) 函数处理新旧 ID 映射
随记（freewrite）：点 ✓ 直接保存，不进 AwarenessFlow
```

---

## §3 当前代码真实结构

> 由代码 session 维护。记录代码现在"实际上"长什么样，包括与设计的偏差。

**最后更新：** 2026-04-11（基于 git log 083b7ce）

### 文件结构（当前）

```
src/
├── main.jsx / App.jsx / index.css
├── contexts/
│   └── AuthContext.jsx         登录状态
├── hooks/
│   └── useSpeechRecognition.js 语音输入
├── lib/
│   ├── supabase.js             DB客户端（仅供 db.js 使用）
│   ├── db.js                   数据访问适配层（新建，透传 supabase）
│   ├── aiClient.js             AI调用层（Gemini/Deepseek）
│   ├── memory.js               AI记忆读写（Supabase user_memory）
│   ├── journalService.js       日记 CRUD（⚠️ 仍直接用 supabase，待迁移）
│   ├── conversationService.js  对话保存 + AI 字段提取
│   ├── storage.js              localStorage 工具
│   ├── contentAnalysis.js      内容分析 + getAwarenessStartTier()
│   ├── keywordDetection.js     本地关键词检测
│   ├── emotionMap.js           57词情绪词库 + mapDisplayToBase()
│   ├── templates.js            模板配置（含新旧ID兼容）
│   ├── prompts.js              AI系统提示词 + 问题库 + 回顾信prompt
│   ├── reviewLetterService.js  回顾信触发 + 生成
│   ├── awarenessFlowState.js   觉察流状态机（已有）
│   ├── awarenessFlowState.test.js
│   ├── conversationMessages.js  消息格式处理（⚠️ 无生产代码依赖，仅 test 文件引用，待阶段二确认后删除）
│   ├── conversationMessages.test.js
│   └── localDB.js              ⚠️ 孤儿文件，待删除
├── components/
│   ├── MainLayout.jsx          4-Tab导航（写/记录/洞察/我的）+ 全屏覆盖层管理
│   ├── AwarenessFlow.jsx       单屏觉察流（本地+AI+自动保存）
│   ├── RecordDetail.jsx        记录详情（紧凑布局+AI分析按钮）
│   └── ReviewLetterDetail.jsx  回顾信详情（只读）
└── pages/
    ├── AuthPage.jsx            登录注册
    ├── HomePage.jsx            写作页（模板标签+引导词+草稿恢复）
    ├── RecordsPage.jsx         记录列表（⚠️ 当前仍为旧版，只显示 journal_entries；entry+letter 混合时间流待 Task 10 完成后生效）
    ├── InsightsPage.jsx        洞察页（占位，Task 13 补全）
    └── SettingsPage.jsx        我的页（AI配置/API Key/测试连接/AI记忆/数据导出/退出登录；回顾信设置 Task 14 待补）
```

**已删除（阶段二重设计移除）：**
- `TaggingPage.jsx`（情绪标注流程取消）
- `ReflectionPage.jsx`（被 AwarenessFlow 替代）

**待删除：**
- `localDB.js`（孤儿文件，已被 memory.js 替代）

### 当前 Supabase 表结构

```
journal_entries：
  - 原始字段：id, user_id, content, template_type, created_at, updated_at
  - AI提取字段：emotions(text[]), emotion_display(text[]), emotion_confidence(float),
    body_sensations, current_thought, core_needs(text[]), reflection_insight,
    overall_state_score, category_tags(text[]), people_involved(text[]),
    cognitive_analysis, cognitive_distortion_type, current_behavior, handling_rating
  - 预留字段：attachments(jsonb), full_conversation(jsonb)（旧路径）

conversations：
  - id, user_id, entry_id(→journal_entries), letter_id(→review_letters)
  - context_type: 'entry' | 'letter'
  - messages: jsonb（完整问答流数组）
  - UNIQUE(entry_id, context_type)

review_letters：
  - id, user_id, entry_ids(uuid[]), content, insights(jsonb)
  - trigger_type: 'count' | 'days' | 'manual'
  - period_start, period_end, is_read

user_memory：
  - 每用户一行，rolling_summary + user_profile(jsonb)
  - user_profile.letter_prefs 存回顾信触发设置

user_options：
  - 用户自定义下拉选项
```

---

## §4 已知架构风险 / 技术债

> 由架构 session 维护。发现新风险时追加，不删除旧条目（加"已修复"标记即可）。

### 4.1 journalService.js 未迁移到 db.js
**风险：** 将来切换存储层时，journalService.js 还需要单独改
**当前处理：** 新增调用都走 db.js，存量代码等专项重构
**优先级：** 低（功能稳定后再迁移）

### 4.2 conversations 表与 full_conversation 字段的双路径
**风险：** 代码 session 可能混淆两条路径
**防护：** §2.1 已有明确说明；RecordDetail 读取时优先 conversations 表，其次 full_conversation
**优先级：** 中（每次涉及对话存取时必须确认路径）

### 4.3 user_memory 记忆固化风险（待讨论）
**风险：** AI 可能用"过去的用户印象"解读"当下状态"，无法看见变化和成长
**影响：** 心理健康产品的核心体验
**当前状态：** spec 附录 A 已记录，需要在 conversationService.js + prompts.js 实现前讨论
**优先级：** 高（Step 9 执行前必须定案）

### 4.4 localDB.js 孤儿文件
**风险：** 造成混乱，可能被误 import
**当前处理：** 待删除
**优先级：** 低

### 4.5 conversationMessages.js 无生产代码依赖
**风险：** 文件存在但无任何生产代码 import（只有 conversationMessages.test.js 引用），造成维护混乱、可能被误认为是有效路径
**当前处理：** 暂时保留，等阶段二 threads 功能确认后再决定是否删除；test 文件提供了消息格式的规格说明，有保留价值
**优先级：** 低（但每次涉及消息格式时必须确认：生产路径走 AwarenessFlow 直接组装，不走此文件）

---

## §5 后续扩展约束

> 由架构 session 维护。这些是未来功能必须在当前架构内能容纳的边界。

### 5.1 Capacitor APK 打包
- 当前代码已保持"零修改"可套壳原则
- Web Speech API 在安卓不可用，未来需接入讯飞 API（通过 useSpeechRecognition.js 接缝替换）
- localStorage 未来需替换为 Capacitor Preferences
- 接缝已预留：db.js（存储层）、useSpeechRecognition.js（语音层）

### 5.2 Threads / 事件线系统（Phase 2）
- 当前 conversations 表的 context_type 已预留 'letter'（回顾信对话）
- review_letters 详情页已预留 threads 占位区
- 新功能应在不破坏现有 conversations / journal_entries 结构的前提下扩展

### 5.3 从回顾信发起写作
- 不写入 review_letters.user_response
- 而是创建新的普通 journal_entry
- 建议预留：origin_context_type / origin_context_id 字段做来源关联（Phase 2 实现）

### 5.4 本地优先存储路线
- 替换点：db.js 内部实现（Supabase → SQLite）
- 上层调用不需要改
- 当前阶段继续用 Supabase，但代码不能绕过 db.js 直连 supabase

### 5.5 UI 整体重设计
- 产品有意向重新设计交互布局
- 业务逻辑必须从 UI 组件中分离（现状：部分已分离，journalService.js 等待迁移）
- 重设计时，lib/ 层不应需要大改

---

## §6 同步摘要日志

> 每次重大变更后，三方任一 session 追加一行。格式：日期 · session类型 · 一句话摘要

- 2026-04-11 · 协调session · §3 经代码session验证校正：conversationMessages.js标注⚠️无生产依赖、RecordsPage标注⚠️待Task10、SettingsPage描述更正；§4新增4.5条目
- 2026-04-11 · 代码session · 完成阶段二全量实现（Task 10-14 + 导航修复）：RecordsPage混合时间流、reviewLetterService完整逻辑、ReviewLetterDetail详情页、InsightsPage洞察页、SettingsPage回顾信设置；删除废弃文件 TaggingPage/ReflectionPage；修复底部Tab宽度均等
- 2026-04-11 · 协调session · 建立 multi-session 协作规范，新建 arch-context.md 和 session-protocol.md
- 2026-04-11 · 产品session校验 · §1 Tab名称修正：「设置」改为「我的」；threads表/§5.2待brainstorming结束后补充
- 2026-04-09 · 产品session · 完成阶段二全量重设计：AwarenessFlow + conversations表 + review_letters + InsightsPage，spec 和 plan 已写入 docs/superpowers/
- 2026-04-07 · 产品session · 深度复盘功能设计（现已被阶段二设计替代）

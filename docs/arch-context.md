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

**当前阶段：** 阶段二重设计（AwarenessFlow 单屏觉察流 + 回顾信系统）已在代码 session 实现中。第二阶段第二批（脉络 / 洞察增强 / 回顾信增强）设计文档已完成，见 `docs/superpowers/specs/2026-04-11-threads-insights-design.md`。

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
emotions         （text[]）← 本地映射后的基础层 61 词，用于统计
emotion_confidence（float）← mapDisplayToBase() 返回的 minConfidence

映射函数：mapDisplayToBase() 在 emotionMap.js，本地运行，零 token
```

**不要改成什么：**
- 不要把 emotions 和 emotion_display 互换使用
- 不要在用户编辑情绪词时调 AI（只用本地映射）
- 不要自动扩展基础层 61 词词库

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

**最后更新：** 2026-04-14（交互细节批次全部实现，基于 git HEAD a04b695）

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
│   ├── db.js                   数据访问适配层（透传 supabase，切换存储层只改这里）
│   ├── aiClient.js             AI调用层（Gemini/Deepseek）
│   ├── memory.js               AI记忆读写（Supabase user_memory）
│   ├── journalService.js       日记 CRUD（⚠️ 仍直接用 supabase，待迁移）
│   ├── conversationService.js  对话保存 + AI 字段提取
│   ├── insightsService.js      洞察页数据查询服务层（含候选数 candidateCount 查询）
│   ├── storage.js              localStorage 工具
│   ├── contentAnalysis.js      内容分析 + getAwarenessStartTier()
│   ├── keywordDetection.js     本地关键词检测
│   ├── emotionMap.js           61词情绪词库 + mapDisplayToBase()
│   ├── templates.js            模板配置（含新旧ID兼容）
│   ├── prompts.js              AI系统提示词 + 问题库 + 回顾信prompt
│   │                           ⚠️ category_tags 选项硬编码（见4.21）
│   ├── reviewLetterService.js  回顾信触发 + 生成
│   ├── awarenessFlowState.js   觉察流状态机
│   ├── awarenessFlowState.test.js
│   ├── extractSummaryService.js     摘要索引批量提取服务
│   ├── extractSummaryService.test.js
│   ├── threadService.js             脉络 CRUD + 加权召回 + arc_summary + reAnalyzeThread
│   └── threadService.test.js
├── components/
│   ├── MainLayout.jsx          4-Tab导航 + 全屏覆盖层管理
│   │                           含 candidateDetail 屏幕类型 + onOpenPendingThreads 回调
│   ├── AwarenessFlow.jsx       单屏觉察流（本地+AI+自动保存）
│   ├── RecordDetail.jsx        记录详情（顶部四字段可编辑：template_type/emotions/state_score/category_tags）
│   │                           含 category_tags 自动种入默认标签逻辑（A1方案）
│   └── ReviewLetterDetail.jsx  回顾信详情（只读）
└── pages/
    ├── AuthPage.jsx            登录注册
    ├── HomePage.jsx            写作页（模板标签+引导词+草稿恢复）
    ├── RecordsPage.jsx         记录列表（混合时间流：entry + letter，按时间降序分组）
    ├── InsightsPage.jsx        洞察页（脉络区块含候选角标 + 提示条）
    ├── ThreadsPage.jsx         脉络三Tab页（已确认/待确认/已归档）
    │                           含 ＋浮窗（手动创建/AI分析）+ AI分析sheet + defaultTab prop
    ├── CandidateDetailPage.jsx 候选脉络详情（独立文件，接受/忽略操作）⭐新增
    ├── ThreadDetailPage.jsx    脉络详情（mode='confirmed'|'archived'；··· 菜单；编辑关联记录模式）
    ├── ReviewLetterListPage.jsx 回顾信列表页
    ├── EditEntryPage.jsx       统一编辑器（原文+觉察流）
    └── SettingsPage.jsx        我的页（AI配置/API Key/AI记忆/数据导出/回顾信设置）
                                含内容大类标签管理子页（增删 ✎ 重命名 + 拖动排序）
```

**已删除：**
- `TaggingPage.jsx`（情绪标注流程取消）
- `ReflectionPage.jsx`（被 AwarenessFlow 替代）
- `localDB.js`（被 memory.js 替代，已删除）
- `reflectionQuestions.js`（服务已删 ReflectionPage，已删除）

**待删除：**
- `conversationMessages.js`（无生产代码依赖，等第二批确认后删除）

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
  - insights v1: {recurring_emotions,...} / v2: {suggested_threads:[{action,thread_id,thread_name}]}

threads：（第二批新增）
  - id, user_id, name, status('candidate'|'confirmed'|'archived'|'rejected')
    ⚠️ 新增 'rejected' 状态（候选被忽略，灰色保留，AI 不重复提议）
  - arc_summary, arc_updated_at, created_at, updated_at
  - CHECK 约束需更新：加入 'rejected'

thread_entries：（第二批新增，无 user_id，RLS 通过 threads 子查询）
  - thread_id → threads, entry_id → journal_entries
  - added_at, added_by('ai'|'user')
  - removed_by_user: boolean DEFAULT false  ⚠️ 新增字段（用户手动移除标记，AI 不重复添加）
  - PRIMARY KEY (thread_id, entry_id)

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

### 4.4 localDB.js 孤儿文件（已删除）
**风险：** 造成混乱，可能被误 import
**已修复：** 已删除 localDB.js（代码 session 阶段二实现时）
**优先级：** 已处理

### 4.5 conversationMessages.js 无生产代码依赖（已删除）
**风险：** 文件存在但无任何生产代码 import（只有 conversationMessages.test.js 引用），造成维护混乱、可能被误认为是有效路径
**已修复：** 第二批功能确认完成后删除（2026-04-12）
**优先级：** 已处理

### 4.6 reviewLetterService.generateReviewLetter 读全文传 AI（与新 spec 不符）
**风险：** 现有实现读原始 content 字段传给 AI；新 spec §5.2 要求改为读 entry_summary + theme_hints + core_needs，不传原始 content
**影响：** 实现 threads 功能前必须先重构此函数，否则 token 消耗大且与新流程逻辑冲突
**当前处理：** 待第二批功能实现时一并重构（建表后 Step 1）
**优先级：** 高（第二批功能 Task 0 必须处理）

### 4.7 covered_by_letter_id 回写逻辑缺失
**风险：** 新 spec §5.1 依赖 `covered_by_letter_id IS NULL` 计数未覆盖 entry；但现有 generateReviewLetter 生成信件后没有回写此字段，字段建好后若不补写回写逻辑，触发条件将永远满足（每次都把历史 entry 当未覆盖）
**影响：** 数据层逻辑错误，可能导致频繁重复生成回顾信
**当前处理：** 字段尚未建立，与 4.6 一起在第二批功能 Step 1 修复
**优先级：** 高（字段建好必须同步补写回写逻辑，不能分开）

### 4.8 回顾信触发计数白名单与新 spec 不一致
**风险：** 现有 checkAndGenerateLetter 用正向白名单 `['awareness', 'emotion', 'gratitude']`；新 spec §5.1 改为负向排除 `template_type != 'freewrite'`——导致 learning / action 两种模板当前不计入但 spec 要求计入
**当前处理：** 待第二批功能切换 covered_by_letter_id 计数逻辑时一并修改
**优先级：** 中（不阻塞当前版本，但第二批上线必须同步修）

### 4.9 InsightsPage 数据查询散落在 useEffect（无服务层封装）
**风险：** 现有 5 个并发查询直接写在组件 useEffect 里；新 spec §6.1 还要新增 threads 查询，届时查询数量增至 7~8 个，维护成本极高，违反 §5.5 「UI 整体重设计时 lib/ 层不应需要大改」约束
**建议：** 实现新区块前，先把查询逻辑提取到 `insightsService.js`
**优先级：** 中（不阻塞第二批功能，但建议在加新区块时同步重构，否则债务翻倍）

### 4.10 「正文末尾嵌 JSON」解析模式调试可见性不足
**风险：** reviewLetterService 用 regex 解析 AI 返回的 ```json 块；新 spec §5.2 的 suggested_threads 沿用此模式，解析失败时静默降级，无法排查 AI 输出格式问题
**已修复：** 解析失败和未找到 JSON 块时均打印 rawLetter 前 300-500 字符到控制台（2026-04-11）
**优先级：** 已处理

### 4.11 reflectionQuestions.js 孤儿文件（已删除）
**风险：** 服务旧 ReflectionPage.jsx（已删除），但 reflectionQuestions.js 遗留在 lib/ 里，无任何生产代码引用，造成混淆
**已修复：** 已删除 reflectionQuestions.js（2026-04-11）
**优先级：** 已处理

### 4.12 EditableFieldRow 组件不存在
**风险：** 新 spec §7.1 写「复用现有 EditableFieldRow 组件」，但 RecordDetail.jsx 里只有 FieldRow（只读），EditableFieldRow 根本不存在
**影响：** 代码 session 照 spec 写代码时会找不到该组件，需要新建
**当前处理：** 第二批功能实现时，由代码 session 在 RecordDetail.jsx 里新建 EditableFieldRow 组件，供 entry_summary 和 theme_hints 的编辑使用
**优先级：** 中（不阻塞，但代码 session 必须知道这是新建而非复用）

### 4.13 prompts.js 回顾信 JSON 结构与新 spec 不对齐
**风险：** 现有 getReviewLetterPrompt 末尾 JSON 结构是 `{recurring_emotions, recurring_people, ...}`；新 spec §5.2 要求 `{suggested_threads: [{action, thread_id, thread_name}]}`
**已处理：** 已在 prompts.js 添加迁移注释，明确第二批实现时需同步改 prompt + reviewLetterService.js 解析逻辑（2026-04-11）
**优先级：** 中（第二批实现时必须同步修改两处：prompts.js + reviewLetterService.js）

### 4.14 reviewLetterService.js 动态 import 模式（await import()）
**风险：** Task 2B 中 `generateReviewLetter` 通过 `await import('./extractSummaryService.js')` 动态加载；这是项目中唯一一处动态 import，Vite 会将其打成独立 chunk（增加运行时首次调用延迟），且路径拼写错误在 build 阶段不报错，只在运行时 crash，调试摩擦高。
**建议：** 代码 session 实现 Task 2 时，改为静态 `import { extractEntrySummaries } from './extractSummaryService.js'`；`extractSummaryService` 不是可选插件，不需要懒加载。
**优先级：** 低（功能正常，但增加调试摩擦；Task 2 实现前修正成本最低）

### 4.15 review_letters.insights JSONB 字段语义转变（兼容风险）
**风险：** 旧版 `insights` 存 `{recurring_emotions, recurring_people, ...}`，第二批后改存 `{suggested_threads: [...]}`。字段名相同但结构完全不同。`ReviewLetterDetail.jsx` 展示历史回顾信时，若不做版本判断，旧信的 insights 区域会渲染异常（找不到 suggested_threads 字段）。
**当前处理：** Plan 未覆盖 ReviewLetterDetail 的旧 insights 兼容展示，代码 session 执行 Task 8（ReviewLetterListPage）时需同步处理。
**兼容方案：** `const isV2 = Array.isArray(insights?.suggested_threads)`；UI 层先判断版本再渲染。
**优先级：** 中（影响历史数据展示；Task 8 执行前必须处理）

### 4.16 overall_state_score 历史数据超范围（-5/+5 → -3/+3 改动后）
**风险：** AI 提取 prompt 已从 `-5到5` 改为 `-3到3`，但历史 journal_entries 中可能存在 ±4、±5 的值。
**影响：** RecordDetail.jsx 的 state_score 下拉框（7档）无法覆盖这些历史值，展示时 chip 可能显示 "+4" 但找不到对应高亮选项。
**处理方案：** 代码 session 实现下拉框时，若当前值 > 3 则 clamp 显示为 "+3"，若 < -3 则 clamp 为 "−3"，或展示原始值并在列表里多加一条「当前：+4（超范围，保存后将调整）」提示。不强制回写旧数据。
**优先级：** 低（历史数据极少有 ±4/±5，对大多数用户无影响）

### 4.17 user_options.sort_order 初始全为 0 导致排序不稳定
**风险：** `ALTER TABLE user_options ADD COLUMN sort_order integer NOT NULL DEFAULT 0` 执行后，存量数据所有行 sort_order=0，首次拖动排序后若只写单条 sort_order，其余行仍为 0，下次加载时 DB 返回顺序不稳定（PG 不保证同值排序顺序）。
**处理：** 代码 session 实现拖动排序保存时，必须将当前列表所有条目的 sort_order 按新顺序写回连续整数（0,1,2,…N），不能只改被拖动的那一条。
**优先级：** 中（用户感知为"排序保存不住"）

### 4.18 threads.status 约束变更的执行顺序风险
**风险：** DROP CONSTRAINT 和 ADD CONSTRAINT 两条 SQL 若不在同一次执行，中间窗口期 status 字段无约束保护，任意值均可写入。
**处理：** 代码 session 在 Supabase SQL Editor 执行时，必须将两条语句合并为一次粘贴执行，不能分两次。
**优先级：** 低（操作纪律问题，时间窗口极短，但值得标记）

### 4.19 「重新分析」逻辑必须过滤 removed_by_user=true
**风险：** `removed_by_user` 字段是 2026-04-12 补充 spec 新增，原 Plan Task 4 `scoreEntryForThread` / 重新分析逻辑写于该字段存在之前，极有可能未加此过滤。若不过滤，被用户手动排除的 entry 会被 AI 反复重新关联，用户排除意愿被无视。
**处理：** 代码 session 实现「重新分析」查询 entry 时，WHERE 条件必须加 `AND (removed_by_user = false OR removed_by_user IS NULL)`。
**优先级：** 高（影响用户排除意愿被尊重这一核心体验承诺）

### 4.20 replace_category_tag RPC 函数尚未在 DB 创建
**风险：** `SettingsPage.jsx` 标签重命名功能调用 `db.rpc('replace_category_tag', ...)` 批量回写历史 entry；但该 PostgreSQL 函数尚未在 Supabase 中创建。代码 session 部署后，用户点击重命名会 runtime crash（rpc 找不到函数名）。
**处理：** 代码 session 执行前，**必须先在 Supabase SQL Editor 执行以下 SQL 创建函数**（属于 Task 0）：
```sql
CREATE OR REPLACE FUNCTION replace_category_tag(
  p_user_id UUID,
  p_old TEXT,
  p_new TEXT
)
RETURNS void LANGUAGE sql AS $$
  UPDATE journal_entries
  SET category_tags = array_replace(category_tags, p_old, p_new)
  WHERE user_id = p_user_id AND p_old = ANY(category_tags);
$$;
```
**优先级：** 高（功能上线必须，否则重命名 crash）

### 4.21 prompts.js category_tags 选项与 user_options 长期脱节
**风险：** `prompts.js` 中 `getExtractionPrompt()` 硬编码了 11 个 category_tags 候选选项。用户在「我的」页面增删自定义标签后，AI 提取仍使用旧硬编码列表，导致：
1. 用户新增的自定义标签 AI 不会自动匹配
2. 用户删除的标签 AI 可能仍提取（产生孤儿标签）
**当前处理：** 已知局限，可接受。B1 方案（孤儿标签在 category sheet 中可见可取消）缓解了用户感知。
**未来优化方向：** AI 提取时动态读取当前用户的 user_options 并注入 prompt。
**优先级：** 低（不阻塞功能，体验影响小）

---

## §5 后续扩展约束

> 由架构 session 维护。这些是未来功能必须在当前架构内能容纳的边界。

### 5.1 Capacitor APK 打包
- 当前代码已保持"零修改"可套壳原则
- Web Speech API 在安卓不可用，未来需接入讯飞 API（通过 useSpeechRecognition.js 接缝替换）
- localStorage 未来需替换为 Capacitor Preferences
- 接缝已预留：db.js（存储层）、useSpeechRecognition.js（语音层）

### 5.2 Threads / 脉络系统（Phase 2 第二批）

已确认设计，见 `docs/superpowers/specs/2026-04-11-threads-insights-design.md`。

关键约束：
- threads 和 review_letters 平行，不从属
- entry_summary / theme_hints 懒触发提取，不在保存时自动调 AI
- arc_summary 缓存在 threads 表，浏览不重新调用 AI
- thread 候选召回：本地加权评分粗召回（零 token），AI 只看轻量摘要
- 新增表：threads、thread_entries；新增字段：journal_entries.entry_summary / theme_hints / covered_by_letter_id

### 5.6 conversations 表的 thread 扩展点

当前 conversations 表 `context_type` 只有 `'entry' | 'letter'`，`UNIQUE(entry_id, context_type)`。

若未来新增「对脉络发起对话」功能：
- 需要 ALTER TABLE conversations ADD COLUMN thread_id uuid REFERENCES threads(id)
- UNIQUE 约束需要调整（当前约束仅覆盖 entry_id + context_type，加 thread 后需重新设计）
- **当前 spec 明确不做此功能（§8）**，但代码 session 遇到 context_type 判断时应预留此扩展点，不要写死 `if (type === 'entry' || type === 'letter')` 的判断

### 5.7 thread_entries 表的 RLS 策略约束

`thread_entries` 联结表没有 `user_id` 字段，RLS 必须通过 `threads` 表 JOIN 过滤：

```sql
-- threads 表：直接过滤
CREATE POLICY "threads_user_isolation" ON threads
  USING (user_id = auth.uid());

-- thread_entries 表：通过子查询过滤
CREATE POLICY "thread_entries_user_isolation" ON thread_entries
  USING (
    thread_id IN (
      SELECT id FROM threads WHERE user_id = auth.uid()
    )
  );
```

**代码 session 不得自行简化为 `user_id = auth.uid()` 直接加在 thread_entries 上**（该表无此字段，会报错）。

### 5.8 review_letters.insights JSONB 字段版本兼容策略

`review_letters.insights` 字段存在语义断层：
- **v1**（第二批前生成的信）：`{ recurring_emotions, recurring_people, core_needs, patterns, growth_notes }`
- **v2**（第二批后生成的信）：`{ suggested_threads: [{action, thread_id, thread_name}] }`

任何读取 `insights` 字段的 UI 代码，必须先做版本判断：
```js
const isV2 = Array.isArray(insights?.suggested_threads)
// v2：渲染 suggested_threads 脉络建议
// v1：优雅降级（不展示 insights 区域，或展示旧字段摘要）
```

**不得假设 `insights` 一定包含 `suggested_threads`（历史数据不保证）。**
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

- 2026-04-14 · 产品session · 发现两个问题并完成设计：编辑关联记录默认展示30条+搜索扩展6字段（content/entry_summary/emotions/emotion_display/core_needs/category_tags）；category_tags三项修复（A1默认标签种入/B1孤儿标签/C1重命名+RPC批量回写）；spec: 2026-04-14-edit-entries-search-and-category-tags-fix.md；新增§4.20（RPC函数未创建）§4.21（prompts.js脱节）
- 2026-04-13 · 产品session · 脉络交互细节补充设计完成：threads.status 新增 rejected；thread_entries 新增 removed_by_user 字段；候选三态（candidate/rejected/deleted）流程；脉络编辑模式/重新分析/归档/手动分析 UI；RecordDetail Header 四字段可编辑（template_type下拉/emotion_display内联/state_score-3~+3/category_tags底部sheet）；spec: 2026-04-12-threads-interaction-gaps.md
- 2026-04-13 · 架构session · 对 spec §A–§I + 同步卡做架构兼容性审查：无违反§2约束；新增4.17（sort_order排序不稳定）/4.18（status约束执行顺序）/4.19（重新分析必须过滤removed_by_user，高优先级）；修复§4.15-4.16编号混乱；整体评级98分
- 2026-04-12 · 代码session · 收尾补漏：suggested_threads→threads落库（candidate脉络生成闭环）；ThreadsPage长按删除菜单+归档占位；RecordsPage未读信左侧金线；MainLayout四Tab同时挂载消除来回切换加载
- 2026-04-12 · 代码session · 完成第二批功能全量实现（Task 1-12）：DB建表+RLS；reviewLetterService重构（摘要索引/covered_by_letter_id回写/suggested_threads→threads落库）；extractSummaryService/threadService新建；ThreadsPage/ThreadDetailPage/ReviewLetterListPage新建；RecordDetail摘要索引区+EditableFieldRow+脉络标签；HomePage未读回顾信气泡；MainLayout连线所有新屏幕；额外新增EditEntryPage统一编辑器/RecordsPage长按编辑删除/ThreadsPage新建时选记录+已确认脉络长按删除
- 2026-04-12 · 架构session · emotionMap.js 词库扩展完成：58词→61词（+渴望/敬佩/欣赏，完整覆盖 Cowen & Keltner 27种情绪）；崇敬从敬畏组移入敬佩组；§2.4 同步更新
- 2026-04-11 · 架构session · 对 spec+plan 做联合架构兼容性终审：4.4标注已删除；新增4.14（动态import风险）、4.15（insights JSONB版本断层）；新增§5.8 insights字段兼容策略；确认所有§2约束无违反，Plan Task 1/2/3/4 架构正确
- 2026-04-11 · 架构session · 预开工整备：删除孤儿文件 reflectionQuestions.js；新建 insightsService.js（InsightsPage 服务层）；修复 reviewLetterService JSON 解析调试可见性；prompts.js 添加第二批迁移注释；§3 更新为真实代码状态；§4 新增 4.11-4.13 条目
- 2026-04-11 · 架构session · 对 threads-insights spec 做架构兼容性审查：新增 §4.6-4.10 五条风险（核心：covered_by_letter_id 回写缺失/generateReviewLetter 读全文需重构/InsightsPage 无服务层）；新增 §5.6 conversations 表 thread 扩展点 / §5.7 thread_entries RLS 约束规范
- 2026-04-11 · 协调session · §3 经代码session验证校正：conversationMessages.js标注⚠️无生产依赖、RecordsPage标注⚠️待Task10、SettingsPage描述更正；§4新增4.5条目
- 2026-04-11 · 代码session · 完成阶段二全量实现（Task 10-14 + 导航修复）：RecordsPage混合时间流、reviewLetterService完整逻辑、ReviewLetterDetail详情页、InsightsPage洞察页、SettingsPage回顾信设置；删除废弃文件 TaggingPage/ReflectionPage；修复底部Tab宽度均等
- 2026-04-11 · 产品session · 完成第二阶段第二批设计：脉络/洞察/回顾信增强，新 spec: 2026-04-11-threads-insights-design.md；更新 §1 当前阶段描述和 §5.2 threads 扩展约束
- 2026-04-11 · 协调session · 建立 multi-session 协作规范，新建 arch-context.md 和 session-protocol.md
- 2026-04-11 · 产品session校验 · §1 Tab名称修正：「设置」改为「我的」；threads表/§5.2待brainstorming结束后补充
- 2026-04-09 · 产品session · 完成阶段二全量重设计：AwarenessFlow + conversations表 + review_letters + InsightsPage，spec 和 plan 已写入 docs/superpowers/
- 2026-04-07 · 产品session · 深度复盘功能设计（现已被阶段二设计替代）

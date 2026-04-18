# 同步卡：people_involved + core_needs · 代码执行交接

> **代码 session 冷启动读这一份即可。**
>
> - 完整 plan：`docs/superpowers/plans/2026-04-18-people-coreneeds.md`
> - 完整 spec：`docs/superpowers/specs/2026-04-17-people-coreneeds-design.md`
> - 设计看板：`docs/superpowers/design-boards/2026-04-17-people-coreneeds.html`（用浏览器打开，6 个交互屏）
> - 架构上下文：`docs/arch-context.md`（必读 §2、§4）

---

## 任务概述

建立用户联系人库（`user_contacts`）和 core_needs 固定词库，支持 @ 输入识别人物、AI 提取匹配词库、未匹配项持久提醒，并在 RecordDetail 和设置页提供完整编辑能力。

**涉及文件（共 10 个）：**

| 文件 | 操作 |
|---|---|
| `src/lib/contactsService.js` | 新建 |
| `src/lib/coreNeedsService.js` | 新建 |
| `src/pages/HomePage.jsx` | 修改 |
| `src/components/RecordDetail.jsx` | 修改 |
| `src/pages/RecordsPage.jsx` | 修改 |
| `src/pages/SettingsPage.jsx` | 修改 |
| `src/lib/conversationService.js` | 修改 |
| `src/lib/prompts.js` | 修改 |
| `src/lib/extractSummaryService.js` | 修改 |
| `src/lib/reviewLetterService.js` | 修改 |

---

## ⚠️ Task 0 必须先做（手动，不是代码）

**Task 0 需要用户在 Supabase 控制台 SQL Editor 手动执行两段 SQL，才能开始写代码。**

Plan Task 0 里有完整 SQL（建 `user_contacts` 表、`pending_core_needs` 表、`replace_person_name` RPC、`replace_core_need` RPC）。

确认用户已执行 Task 0 后，再从 Task 1 开始写代码。

---

## 执行顺序

按 Task 顺序执行，每个 Task 做完跑 `npm run build` 确认无报错再继续。

### Task 1：新建 contactsService.js + coreNeedsService.js

Plan 有完整代码，直接写入。

**关键注意点：**
- `db` 从 `'./db'` 导入，不从 supabase.js（§2.2）
- `seedDefaultContacts()` 先查 count，count > 0 时跳过，避免重复 seed
- `detectPeopleFromText(text, contacts)` 是纯内存函数，不查 DB
- `coreNeedsService` 的 `createPendingCoreNeed` 只传 `entry_id` + `proposed`，`user_id` 由 RLS 自动从 `auth.uid()` 取

### Task 2：修改 HomePage.jsx

Plan 有分步说明（Step 1–10），核心改动：

1. import `contactsService` + `coreNeedsService`
2. 新增 state：`contacts`（数组）、`mentionQuery`（null = 关闭）、`mentionAnchor`（@ 的位置索引）、`selectedPeople`（底部 chip 数组）
3. `useEffect` on mount：`seedDefaultContacts()` + `seedDefaultCoreNeeds()` + `loadContacts()` → 存内存
4. `handleContentChange` 替换原来的 `onChange`：检测 @ 字符位置触发浮层
5. `handleMentionSelect`：去掉 @，alias 留在文本，canonical 加入 `selectedPeople`
6. `handleDone`：`detectPeopleFromText(content, contacts)` + `selectedPeople` 合并去重 → 写 `people_involved`
7. 浮层位置：在 textarea **外层相对定位容器内**，绝对定位在 textarea 下方
8. 底部 chip 区：在浮动底栏（✦ + ✓ 按钮）**上方**插入

**@mention 行为（spec §3.1）：**
```
输入：今天和@宝宝吃饭
        ↓ 浮层选「男友」（aliases 包含「宝宝」）
文本变：今天和宝宝吃饭   ← @ 去掉，「宝宝」保留
底部chip：[男友 ✕]       ← 显示 canonical
```

### Task 3：修改 RecordDetail.jsx

Plan 有分步说明（Step 1–8），核心改动：

1. import `contactsService` + `coreNeedsService`
2. 新增 state：contacts、showPeopleSheet、coreNeeds、showNeedsSheet 等
3. `useEffect` 加载联系人和词库（loadContacts + loadCoreNeeds）
4. 操作函数：`handlePersonRemove`、`handlePersonAdd`、`handlePersonAddNew`、`handleNeedRemove`、`handleNeedAdd`
5. 插入「涉及的人」行（蓝灰 chip，`background: #e8f0f5, color: #5a7a8a`）→ 位置：情绪行之后
6. 替换原有 `core_needs` 展示为 chip 行（紫色，`background: #ede8f5, color: #7a6a9a`）
7. 两个底部 sheet 浮层：`position: fixed, inset: 0`，点外部关闭

**chip 样式对照：**
- 涉及的人：蓝灰色 `#e8f0f5 / #5a7a8a`
- 内心需求：紫色 `#ede8f5 / #7a6a9a`

### Task 4：修改 RecordsPage.jsx

Plan 有分步说明（Step 1–9），核心改动：

1. import `coreNeedsService` 的 5 个函数 + `updateEntry`
2. 新增 state：`pendingCount`、`showPendingCard`、`pendingItems`、三个编辑/合并开关
3. 在 `load` 函数末尾追加 `getPendingCoreNeedsCount()` 更新 `pendingCount`
4. 橙色 banner：`background: #fff7ed, borderLeft: 3px solid #f97316`，插在 FilterBar 之后
5. 处理弹卡片：`position: fixed, inset: 0, zIndex: 200`，不可点背景关闭（spec §7.2）
6. 三个操作路径：加入词库 / 改措辞后加入 / 合并到已有词条，每条完成后删除 pending 行并推进

**⚠️ 处理卡片不提供「跳过/忽略」按钮（spec §7.2）**

### Task 5：修改 SettingsPage.jsx

Plan 有分步说明（Step 1–8），采用和现有「内容大类标签」子页（`showTagManager`）完全相同的模式：

- 子页用 `position: absolute, inset: 0, zIndex: 50` 全屏覆盖
- 顶部 ‹ 返回按钮
- 两个新入口在「账号」区域**上方**

**人物管理：** 列表卡片内联展开编辑，canonical 改名调 `updateContact`（内部执行 `replace_person_name` RPC）

**词库管理：** chip 网格点击展开编辑面板，输入校验：
- 长度 ≤ 20 字
- 不含英文引号 `"` `'`、反斜杠 `\`、换行符 `\n`

### Task 6：修改 conversationService.js + prompts.js

Plan 有分步说明（Step 1–6），核心改动：

1. 新增 `getUserCoreNeeds(userId)` 辅助函数
2. `_backgroundProcess` 里并行拉 categoryTags + coreNeeds 词库
3. `getExtractionPrompt(categoryTags, coreNeedsVocab)` 新增第二参数
4. prompts.js 的 `getExtractionPrompt` 函数：签名加 `coreNeedsVocab = []`，在 core_needs 字段说明里拼入词库列表，要求 AI 从中选词；词库外的词放 `unmatched_core_needs`
5. 提取结果里的 `unmatched_core_needs` 逐条调 `createPendingCoreNeed(entry.id, word)`

### Task 7：修改 extractSummaryService.js + reviewLetterService.js

Plan 有分步说明（Step 1–7），核心改动：

**`extractSummaryService.js`：**
1. `buildSummaryPrompt(entries, { coreNeedsVocab, categoryTags, contacts })` 新增第二参数
2. 拼入四个词库说明段（情绪词库硬编码 34 词、core_needs 词库、内容大类词库、联系人库）
3. JSON 格式扩展：新增 `emotions`、`core_needs`、`unmatched_core_needs`、`category_tags`、`people_involved`
4. **`maxTokens: 800` → `maxTokens: 1200`**（必须改，否则 JSON 截断静默失败）
5. 写回时跳过已有值的字段（先 SELECT 再决定 patch 哪些字段）
6. unmatched 写 pending_core_needs

**`reviewLetterService.js`：**
在调用 `extractEntrySummaries` 前先查三个词库（core_need、content_category、user_contacts），组成 `vocabOptions` 传入。

### Task 8：整体验证

Plan 有 10 条验证清单（spec §11 的成功标准），逐一确认后才推送。

---

## 架构约束（必须遵守）

- **§2.2**：db 层调用从 `'../lib/db'` 导入，不从 supabase.js 直接导入
- **§4.22**：RPC 函数用 `SECURITY DEFINER` + 内部 `auth.uid()`，不接受 user_id 参数（`replace_person_name` / `replace_core_need` 已按此模式建表）
- **§4.25**：组件内部通过 `useAuth()` 获取 user，不接受 userId prop
- **§4.28**：`extractSummaryService` 的 `maxTokens` 必须从 800 改为 1200，否则扩展字段 JSON 截断导致批量补提取静默失败
- **§4.29**：用户自定义词条写入前前端校验：长度 ≤ 20 字，不含 `"` `'` `\` `\n`

---

## 偏差处理规范

代码 session 执行过程中，如发现 plan 描述与实际代码有出入（行号偏差、原有代码结构不同等），**自行判断修正，不需要停下来请示**。

如发现架构层面的问题（Supabase API 行为异常、新的 §4.x 限制），**停下来报告，列明偏差内容，不自行修复，等用户确认**。

---

## Task 9（Tasks 1–8 全部完成后再做）：user_contacts 增加 group_name 分组字段

**需要用户先执行 SQL：**

```sql
ALTER TABLE user_contacts ADD COLUMN group_name text;
```

**改动范围：**
- `contactsService.js`：DEFAULT_CONTACTS 每条加 group_name、addContact/updateContact 加参数
- `SettingsPage.jsx`：人物管理编辑表单加「分组」输入框
- `HomePage.jsx`：@ 浮层按 group_name 分组展示
- `docs/arch-context.md`：§2.8 追加 group_name 说明

**默认分组映射：**
- 家人：妈妈/爸爸/奶奶/爷爷/外婆/外公/哥哥/弟弟/姐姐/妹妹/婆婆
- 伴侣：男友/女友/老公/老婆
- 同事：老板/同事/客户
- 朋友：朋友/闺蜜/同学/室友

完整代码见 plan Task 9。

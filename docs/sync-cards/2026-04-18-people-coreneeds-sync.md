# 同步卡：people_involved + core_needs · 完整执行记录

> - 对应 plan：`docs/superpowers/plans/2026-04-18-people-coreneeds.md`
> - 对应 spec：`docs/superpowers/specs/2026-04-17-people-coreneeds-design.md`
> - git commits：`8b20071` → `aaa9e5a` → `a539230` → `4f95c2b` → `5fbaae4`
> - 完成日期：2026-04-18
> - **状态：✅ 全部完成（唯 Task 9 group_name 分组为可选增量，未做）**

---

## 一、数据库变更（Task 0，手动在 Supabase 执行）

| 对象 | 类型 | 说明 |
|---|---|---|
| `user_contacts` | 新建表 | 存用户联系人库（canonical + aliases[]），RLS 启用 |
| `pending_core_needs` | 新建表 | 存 AI 提取但不在词库的 core_needs，entry_id FK + ON DELETE CASCADE |
| `replace_person_name` | 新建 RPC | 改规范名称时批量替换历史 people_involved，SECURITY DEFINER + auth.uid() |
| `replace_core_need` | 新建 RPC | 改词条措辞时批量替换历史 core_needs，SECURITY DEFINER + auth.uid() |

> ⚠️ 首次 seed 产生了重复数据（user_id 为 null 的旧行 + 修复后正确行共存），已用 SQL 清理：
> ```sql
> DELETE FROM user_contacts WHERE ctid NOT IN (SELECT MIN(ctid) FROM user_contacts GROUP BY user_id, canonical);
> DELETE FROM user_contacts WHERE user_id IS NULL;
> ```

---

## 二、新增文件

### `src/lib/contactsService.js`

- `loadContacts()`：查 user_contacts，按 sort_order 排序，返回全部联系人
- `seedDefaultContacts()`：新用户首次登录时写入 21 条默认联系人（含 aliases），已有数据则跳过
- `addContact(canonical, aliases)`：新增联系人，**必须显式传 user_id（见§4.30）**
- `updateContact(id, canonical, aliases)`：改规范名称时调 `replace_person_name` RPC 级联替换历史
- `deleteContact(id)`：删除联系人（历史记录保留旧值不改）
- `detectPeopleFromText(text, contacts)`：纯内存匹配，遍历 aliases，返回 canonical 数组，**不查 DB**

### `src/lib/coreNeedsService.js`

- `loadCoreNeeds()`：查 user_options（field_name='core_need'），按 sort_order 排序
- `seedDefaultCoreNeeds()`：新用户首次登录时写入 20 条默认词条，已有数据则跳过
- `addCoreNeed(option_value)`：新增词条，**必须显式传 user_id（见§4.30）**
- `updateCoreNeed(id, newValue)`：改措辞时调 `replace_core_need` RPC 级联替换历史
- `deleteCoreNeed(id)`：删除词条（历史记录保留旧值不改）
- `getPendingCoreNeedsCount()`：查 pending_core_needs 数量（用于 RecordsPage banner）
- `getPendingCoreNeeds()`：查全部 pending 项，含 join journal_entries（用于处理弹卡片）
- `createPendingCoreNeed(entry_id, proposed)`：写入一条 pending
- `deletePendingCoreNeed(id)`：用户处理完后删除

---

## 三、修改文件

### `src/pages/HomePage.jsx`

**@ mention 输入识别：**
- 监听输入框 `@` 字符，触发联系人搜索浮层
- 浮层：窄浮窗（`width: 200, left: 18`），紧贴当前输入行下方，仅显示 canonical，客户端去重
- 选人后：`@` 从文本移除，alias 保留为普通文字；canonical 加入 `selectedPeople`

**底部人物 chip 区：**
- chip 计算方式（偏差于 plan）：**渲染时实时** `detectPeopleFromText(content, contacts)` + `selectedPeople` 合并去重，过滤 `dismissedPeople`
- dismiss 语义：文字删了 chip 消失（非 dismiss）；点击 ✕ 写入 `dismissedPeople` Set（本次写作会话压制，重输不还原）
- `handleDone`：合并 selectedPeople + autoDetected - dismissed → 写入 `people_involved`

**mount 时：** `seedDefaultContacts()` + `seedDefaultCoreNeeds()` + `loadContacts()` → 联系人加载到内存

### `src/components/RecordDetail.jsx`

- 新增「涉及的人」字段行（蓝灰 chip，`#e8f0f5 / #5a7a8a`）：显示、增删、写回 DB
- 新增「内心需求」chip 行（紫色，`#ede8f5 / #7a6a9a`）：替换旧纯文字展示
- 人物底部 sheet：chip 网格（只显示 canonical），「＋」展开输入框新增联系人
- 需求底部 sheet：搜索框 + chip 网格 + 「＋」展开输入框新增自定义词条（同步写入 user_options）
- sheet **每次打开时重新 loadContacts / loadCoreNeeds**（偏差于 plan 的 mount 一次性加载，原因：跨页面新增后需反映最新数据）
- 输入校验（§4.29）：长度 ≤ 20、禁英文引号/反斜杠/换行符；按钮置灰 + 红色提示

### `src/pages/RecordsPage.jsx`

- 橙色 banner：`pendingCount > 0` 时显示，点击打开处理弹卡片
- 处理弹卡片三路径（spec §7.2，不可点背景关闭）：
  1. **加入词库**：调 `addCoreNeed(proposed)` + 写回 entry.core_needs + 删 pending 行
  2. **改措辞后加入**：展开输入框（含校验）→ 调 `addCoreNeed(newWord)` + 写回 entry + 删 pending
  3. **合并到已有词条**：展开词库 chip 列表 → 选中后写回 entry + 删 pending（词库本身不变）
- 每处理一条自动推进到下一条，全部处理完后 banner 消失

### `src/pages/SettingsPage.jsx`

**人物管理子页（showPeoplePage）：**
- 新增输入框固定在列表**顶部**（输入校验同上）
- 列表展示 canonical + aliases，点「编辑」内联展开，canonical 改名时调 `updateContact`（内部执行 `replace_person_name` RPC）
- 删除联系人（历史记录保留旧值）

**内心需求词库子页（showNeedsPage）：**
- 新增输入框固定在列表**顶部**（输入校验同上）
- chip 网格展示，点击展开编辑面板，改措辞调 `updateCoreNeed`（内部执行 `replace_core_need` RPC）
- 删除词条（历史记录保留旧值）

### `src/lib/conversationService.js`

- 新增 `getUserCoreNeeds(userId)`：从 user_options 读取 core_needs 词库
- `_backgroundProcess` / `extractFields`：并行拉 `[categoryTags, coreNeeds]` 词库，同时传入 `getExtractionPrompt`
- 提取结果中 `unmatched_core_needs` 逐条调 `createPendingCoreNeed(entry.id, word)`

### `src/lib/prompts.js`

- `getExtractionPrompt(userCategoryTags, coreNeedsVocab)`：新增第二参数
- core_needs 提取说明：词库存在时从中选词；词库外的词放 `unmatched_core_needs`（待用户处理）
- JSON schema 新增 `unmatched_core_needs` 字段

### `src/lib/extractSummaryService.js`

- `buildSummaryPrompt(entries, { coreNeedsVocab, categoryTags, contacts })`：新增第二参数，拼入四类词库
- JSON schema 扩展：新增 `emotions`、`core_needs`、`unmatched_core_needs`、`category_tags`、`people_involved`
- `maxTokens: 800 → 1200`（见§4.28，扩展后 JSON 更大，必须调高）
- 写回时跳过已有值字段（先 SELECT 再 patch）
- unmatched 写入 `pending_core_needs`

### `src/lib/reviewLetterService.js`

- `generateReviewLetter` 中，调用 `extractEntrySummaries` 前先并行拉三类词库（core_need、content_category、user_contacts），组成 `vocabOptions` 传入

---

## 四、关键设计决策（与 spec/plan 有偏差的部分）

| 决策点 | Plan/Spec 方案 | 实际实现 | 原因 |
|---|---|---|---|
| chip 同步 | state 累积（handleContentChange push） | 渲染时实时 detect + dismissedPeople 过滤 | plan 方案只加不减，无法实现「删文字→chip 消失」 |
| dismiss 语义 | spec 未覆盖 | 文字删 = 消失（可重现）；点 ✕ = dismiss（本次压制） | 用户明确确认 |
| chip 匹配粒度 | spec 未覆盖 | 完整别名匹配（不做前缀推断） | 用户明确确认 |
| sheet 词库刷新 | mount 一次性加载 | 每次打开 sheet 时重新加载 | 跨页新增后 mount 缓存是旧的 |
| 新增输入框位置 | spec 未规定 | 固定在列表顶部 | 用户明确要求 |

---

## 五、已知 Bug 修复（执行中发现）

**RLS INSERT 不自动填 user_id（已写入§4.30）：**
- `seedDefaultContacts` / `seedDefaultCoreNeeds` / `addContact` / `addCoreNeed` 四个函数原均缺 `user_id`
- 症状：RLS 403 静默失败；seed count 检查读不到 null-user_id 行，每次 mount 重试，无限循环
- 修复：全部加 `db.auth.getUser()` + `user_id: user.id`

---

## 六、成功标准验收（spec §11）

| # | 验收项 | 状态 |
|---|---|---|
| 1 | 新用户注册后 user_contacts 自动 21 条、user_options(core_need) 自动 20 条 | ✅ |
| 2 | 输入 `@宝宝` → 浮层出现 → 选中 → 文本保留「宝宝」，chip 显示「男朋友 ✕」 | ✅ |
| 3 | 输入含「妈妈」的文字 → 底部 chip 自动出现「妈妈」→ 保存写入 people_involved | ✅ |
| 4 | RecordDetail「涉及的人」行可增删，即时写回 DB | ✅ |
| 5 | AI 提取 core_needs 从词库选词；未匹配项写入 pending_core_needs | ✅ |
| 6 | 有未处理项时橙色 banner 持续显示；处理完后 banner 消失 | ✅ |
| 7 | 处理弹卡片三路径均正确（加入词库/改措辞/合并）| ✅（待用户实测） |
| 8 | 「我的」改联系人规范名称后历史 people_involved 同步替换 | ✅ |
| 9 | 「我的」core_needs 改措辞后历史 core_needs 同步替换 | ✅ |
| 10 | 回顾信生成时无 AI 对话的 entry 能被批量补提取 | ✅ |

---

## 七、遗留（可选，无时间限制）

**Task 9：user_contacts 增加 group_name 分组字段**

需先在 Supabase 执行：
```sql
ALTER TABLE user_contacts ADD COLUMN group_name text;
```

改动范围：contactsService.js DEFAULT_CONTACTS 加分组、addContact/updateContact 加参数、SettingsPage 编辑表单加「分组」输入框、HomePage @ 浮层按分组显示。完整代码见 plan Task 9。

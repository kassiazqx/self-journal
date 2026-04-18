# people_involved + core_needs 功能设计

> 版本：2026-04-17
> 设计看板：`docs/superpowers/design-boards/2026-04-17-people-coreneeds.html`

---

## §1 背景与目标

### 当前问题

| 字段 | 现状 | 问题 |
|---|---|---|
| `people_involved` | AI 提取后写入 DB，从未在 UI 展示 | 用户看不到；AI 自由提取人名格式不一致 |
| `core_needs` | AI 自由提取写入 DB，RecordDetail 未展示 | 表述不一致（「被理解」/「感到被理解」/「获得理解」），无法筛选 |

### 本次目标

1. **`people_involved`**：建立用户人物联系人库（`user_contacts`），支持 `@` 输入 + 关键词自动识别，RecordDetail 可见可编辑，「我的」可管理联系人
2. **`core_needs`**：建立固定词库（存 `user_options`），AI 提取时匹配词库；未匹配项持久提醒用户处理；RecordDetail 展示；「我的」可管理词库
3. **批量补提取扩展**：`extractSummaryService` 补提取范围从 `entry_summary + theme_hints` 扩展到包含 `emotions`、`core_needs`、`category_tags`、`people_involved`

---

## §2 数据模型

### 2.1 新建表：`user_contacts`

用户个人联系人库，存储规范名称及其识别别名。

```sql
CREATE TABLE user_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical    text NOT NULL,          -- 规范名称，如「男朋友」「妈妈」
  aliases      text[] NOT NULL DEFAULT '{}',  -- 识别关键词，如 ['宝宝','小宝']
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_contacts_own" ON user_contacts
  FOR ALL USING (user_id = auth.uid());
```

**默认数据：** 新用户首次登录时，从代码硬编码的 `PEOPLE_KEYWORD_MAP`（`keywordDetection.js`，21 条）自动写入该用户的 `user_contacts`，每条 `canonical = 规范名称`，`aliases = 关键词数组`。已有用户迁移：首次打开 app 时检测若 `user_contacts` 为空则自动写入默认数据。

### 2.2 复用表：`user_options`（core_needs 词库）

复用现有 `user_options` 表，`field_name = 'core_need'`，`option_value` 存词条名称。

新用户首次登录时自动写入默认 20 个词条：

```
被理解、被看见、被接纳、被爱、被需要、被认可、被信任、
安全感、掌控感、归属感、独立自主、公平、边界被尊重、
被支持、休息、成就感、意义感、自我表达、连接感、被倾听
```

### 2.3 新建表：`pending_core_needs`

存储 AI 提取到但词库无匹配的待处理项（A3 持久化）。

```sql
CREATE TABLE pending_core_needs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_id     uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  proposed     text NOT NULL,    -- AI 提议的词，如「渴望被倾诉」
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pending_core_needs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pending_core_needs_own" ON pending_core_needs
  FOR ALL USING (user_id = auth.uid());
```

用户处理完一条（加入词库 / 合并 / 放弃）后删除该行。RecordsPage 每次加载时查询当前用户是否有未处理行，有则显示橙色 banner。

---

## §3 people_involved · HomePage 输入体验

### 3.1 @ 触发浮层

用户在输入框任意位置输入 `@` 字符时，立即触发联系人搜索浮层。

**浮层行为：**
- 出现位置：紧贴当前输入行**下方**，不遮挡正在打的文字
- 搜索范围：`@` 后的文字同时匹配 `canonical` 和 `aliases`（不区分大小写）
- 显示内容：每条显示 `canonical`（规范名称）+ 包含匹配关键词的 aliases 摘要
- 实时更新：随用户继续输入过滤结果
- 末尾固定一条：「＋ 新增「xxx」为新人物」（xxx = 当前 @ 后的输入文字）
- 点浮层外或按 Esc：关闭浮层，`@xxx` 保留为普通文字

**选人后的行为：**

```
输入前：今天和@宝宝吃饭
        ↓ 用户在浮层选「男朋友」（canonical，aliases 包含「宝宝」）
输入后：今天和宝宝吃饭   ← @ 去掉，alias「宝宝」保留为普通文字
底部：  [男朋友 ✕]       ← chip 显示 canonical
```

- `@` 符号从文本移除，用户输入的 alias 保留为普通文字
- 底部 chip 区出现对应的 canonical 名称 chip
- 同一个人重复 @ 不重复添加 chip

**新增人物：**
- 选「＋ 新增 xxx」→ 直接将 `xxx` 作为 canonical 写入 `user_contacts`（aliases 为空），chip 出现在底部
- 用户之后可在「我的」补充 aliases

### 3.2 关键词自动识别

保存时（点「完成对话」或手动保存），对文本内容运行 `detectPeople()`，使用用户自己的 `user_contacts` 映射（不再使用硬编码的 `PEOPLE_KEYWORD_MAP`）。

- 识别结果与用户手动 @ 的结果合并（去重）
- 合并结果写入 `journal_entry.people_involved`（canonical 名称数组）

### 3.3 底部 chip 区

位于输入框底部，始终可见（即使为空也保留区域，不塌缩）：

```
涉及的人   [妈妈 ✕]  [男朋友 ✕]  [＋]
```

- `✕`：从 chip 区移除，不影响文本内容
- `＋`：弹出联系人选择浮层（不需要输入 @），可从列表选人或搜索

---

## §4 people_involved · RecordDetail 展示与编辑

### 4.1 展示

在现有字段展示区新增「涉及的人」一行，位置在「情绪」之后、「内心需求」之前：

```
情绪         [委屈] [释然]
涉及的人     [妈妈 ✕] [男朋友 ✕]  [＋]
内心需求     [被理解] [被倾听]  [＋]
```

- chip 样式：蓝灰色系（`background: #e8f0f5, color: #5a7a8a`）
- 始终显示编辑态（直接显示 ✕ 和 ＋），无需进入单独编辑模式

### 4.2 编辑

**删除：** 点 chip 上的 ✕，从 `people_involved` 数组移除，立即写回 DB。

**新增：** 点 ＋ 弹出联系人选择浮层（与输入框的 ＋ 相同），选人后写入数组并写回 DB。

**浮层内容：**
- 搜索框（可输入过滤）
- 已有联系人列表（排除已在 chip 里的）
- 末尾「＋ 新增人物」（输入新 canonical 直接创建并添加）

---

## §5 people_involved · 「我的」人物管理

入口：SettingsPage 新增「人物管理」选项，进入独立子页。

### 5.1 列表页

每条联系人显示：

```
[妈妈]          别名：母亲 · 老妈 · 阿妈        [编辑]  [删除]
[男朋友]        别名：宝宝 · 小宝               [编辑]  [删除]
[老板]          别名：上司 · 领导               [编辑]  [删除]

[＋ 新增人物]
```

### 5.2 编辑态（内联展开，不跳新页）

点「编辑」在当前卡片位置展开：

```
规范名称   [男朋友        ]
识别关键词  [宝宝  小宝    ]   ← 空格分隔多个别名
           [保存（级联替换历史）]  [取消]
```

**保存逻辑：**
- canonical 改变 → 调用 `replace_person_name` RPC，批量把 `journal_entries.people_involved` 里所有旧 canonical 替换为新 canonical（类似 `replace_category_tag`）
- aliases 改变 → 仅更新 `user_contacts`，不影响历史数据

### 5.3 删除逻辑

点「删除」弹确认提示：

> 删除后「男朋友」不再出现为选项。已有记录里的标记**保留**（不会自动清除）。

确认后仅删 `user_contacts` 行，`journal_entries.people_involved` 里的历史值保留不动。

### 5.4 需要新建的 Supabase RPC

```sql
CREATE OR REPLACE FUNCTION replace_person_name(p_old TEXT, p_new TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE journal_entries
  SET people_involved = array_replace(people_involved, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(people_involved);
$$;
```

记录到 `docs/supabase-manual-sql.md`，换项目时手动执行。

---

## §6 core_needs · 词库系统

### 6.1 词库存储

复用 `user_options` 表，`field_name = 'core_need'`。新用户首次登录自动写入默认 20 个词（`sort_order` 按顺序递增）。

### 6.2 AI 提取时的匹配逻辑

`conversationService.js` 的提取 prompt 修改：提取 `core_needs` 时，在 system prompt 里传入用户当前词库列表，要求 AI 从词库中选择最匹配的词（可多选），而不是自由生成。

```
system: 以下是用户的 core_needs 词库：
[被理解, 被看见, 被接纳, 被爱, 被需要, 被认可, 被信任, 安全感, 掌控感, 归属感, 独立自主, 公平, 边界被尊重, 被支持, 休息, 成就感, 意义感, 自我表达, 连接感, 被倾听]

提取 core_needs 时，请从以上词库中选择，返回数组。
如果日记内容涉及的内心需求在词库中找不到合适的词，返回 unmatched_core_needs 字段，值为你建议的新词字符串数组。
```

**提取结果格式（JSON）：**

```json
{
  "core_needs": ["被理解", "被倾听"],
  "unmatched_core_needs": ["渴望被倾诉"]
}
```

- `core_needs`：直接写入 `journal_entries.core_needs`
- `unmatched_core_needs`：每条写一行到 `pending_core_needs`（附 `entry_id`）

---

## §7 core_needs · A3 持久提醒与处理流程

### 7.1 RecordsPage 橙色 banner

RecordsPage 加载时查询 `pending_core_needs`（当前用户，`count` 查询即可）：

- count > 0 → 在 header 下方显示橙色 banner：
  ```
  ● 有 N 个新的内心需求待确认   查看 →
  ```
- count = 0 → 不显示 banner
- banner 持续显示，直到所有待处理项处理完毕

### 7.2 处理弹卡片

点击 banner → 弹出底部卡片，逐条处理（处理完一条自动展示下一条，全部完成后卡片关闭，banner 消失）。

**卡片内容：**

```
─────────────────────────────────────────
  来源记录（可点击跳转）
  ┌─────────────────────────────────────┐
  │ 4月16日 22:14                  查看→│
  │ 今天和妈妈说了很多，感觉有点被误解… │
  └─────────────────────────────────────┘

  AI 提议
  渴望被倾诉

  [✓ 加入词库]
  [✎ 改措辞后加入]        ← 点击展开输入框，可编辑后保存
  [合并到已有词条 ›]       ← 点击展开词库列表，选一条合并
─────────────────────────────────────────
```

**三个操作的逻辑：**

| 操作 | 词库变化 | entry 的 core_needs | pending 行 |
|---|---|---|---|
| 加入词库 | 新增词条 | 追加新词 | 删除 |
| 改措辞后加入 | 新增改后的词条 | 追加改后词 | 删除 |
| 合并到已有词条 X | 不变 | 追加 X | 删除 |

**注意：** 卡片不提供「跳过/忽略」按钮。只有处理完才能关闭。点击卡片外部区域不关闭。

### 7.3 跳转到来源 entry

点击卡片里的来源记录卡（「查看 →」）→ 打开对应 RecordDetail，卡片保持在后台，返回后继续处理。

---

## §8 core_needs · RecordDetail 展示

在「涉及的人」下方新增「内心需求」行：

```
涉及的人     [妈妈 ✕]  [＋]
内心需求     [被理解 ✕]  [被倾听 ✕]  [＋]
```

- chip 样式：紫色系（`background: #ede8f5, color: #7a6a9a`）
- 始终显示 ✕ 和 ＋（不需要进入编辑模式）
- ✕ 删除：从 `core_needs` 数组移除，立即写回 DB
- ＋ 新增：弹出词库选择浮层（列表 + 搜索框），选词后写入数组并写回 DB

---

## §9 core_needs · 「我的」词库管理

入口：SettingsPage 新增「内心需求词库」选项，进入独立子页。

### 9.1 词库展示

chip 平铺展示所有词条（紫色系），点击某个 chip 展开编辑面板（内联，不跳页）：

```
[被理解] [被看见] [被接纳] [被爱] [安全感] [成就感] … [＋ 新增]

── 点击「被理解」后展开 ──
  [被理解          ]   ← 可编辑输入框
  [保存（级联替换历史）]   [删除词条]
```

### 9.2 编辑逻辑

- **保存：** 调用 `replace_core_need` RPC，批量替换 `journal_entries.core_needs` 里所有旧词为新词；同步更新 `user_options` 里的 `option_value`
- **删除：** 仅删 `user_options` 行，历史 `journal_entries.core_needs` 保留旧值

**前端输入校验（§4.29，防 prompt injection）：** 词条内容写入前需满足：
- 长度 ≤ 20 字
- 不含英文引号（`"` `'`）、反斜杠（`\`）、换行符（`\n`）

校验不通过时在输入框下方提示「词条过长或含无效字符」，不提交。

### 9.3 需要新建的 Supabase RPC

```sql
CREATE OR REPLACE FUNCTION replace_core_need(p_old TEXT, p_new TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE journal_entries
  SET core_needs = array_replace(core_needs, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(core_needs);
$$;
```

记录到 `docs/supabase-manual-sql.md`。

---

## §10 extractSummaryService 批量补提取扩展

### 10.1 触发时机（不变）

回顾信生成前，对 `entry_summary` 为空的 entry 批量补提取。

### 10.2 扩展提取字段

在现有 `entry_summary + theme_hints` 基础上，同时补提取以下字段（仅补空字段，不覆盖已有值）：

| 字段 | 方式 |
|---|---|
| `emotions` | 从固定情绪词库（61词）中选 |
| `core_needs` | 从用户 `user_options` 词库中选；未匹配写 `pending_core_needs` |
| `category_tags` | 从用户 `user_options`（content_category）中选 |
| `people_involved` | 用用户 `user_contacts` 映射扫描文本（`detectPeople` 逻辑） |

### 10.3 补提取 prompt 调整

在现有 `buildSummaryPrompt` 中追加以上字段的提取要求，传入各自词库。

**⚠️ `maxTokens` 必须从 800 改为 1200：** 词库传入增加约 150–200 token，返回字段从 2 个增至 7 个，800 会截断 JSON 导致批量补提取静默失败（§4.28）。

返回格式扩展：

```json
{
  "id": "entry-uuid",
  "entry_summary": "...",
  "theme_hints": ["..."],
  "emotions": ["焦虑", "释然"],
  "core_needs": ["被理解"],
  "unmatched_core_needs": ["渴望被倾诉"],
  "category_tags": ["家庭"],
  "people_involved": ["妈妈"]
}
```

写回时跳过已有值的字段（`WHERE ... IS NULL OR ... = '{}'`）。

---

## §11 成功标准

1. 新用户注册后，`user_contacts` 自动有 21 条默认联系人，`user_options`（core_need）自动有 20 条默认词
2. HomePage 输入 `@宝宝` → 浮层显示「男朋友（别名包含：宝宝）」→ 选中后文本变「宝宝」，底部 chip 显示「男朋友 ✕」
3. 输入包含「妈妈」的文字 → 保存时底部 chip 自动出现「妈妈」，写入 `people_involved`
4. RecordDetail 的「涉及的人」行可增删，即时写回 DB
5. AI 提取后 `core_needs` 从词库里选词，格式一致；未匹配项写入 `pending_core_needs`
6. RecordsPage 有未处理项时橙色 banner 持续显示；处理完后 banner 消失
7. 处理弹卡片：加入词库 / 改措辞 / 合并，三条路径均正确更新词库 + entry + 删除 pending 行
8. 「我的」人物管理：改规范名称后所有历史记录的 `people_involved` 同步替换
9. 「我的」core_needs 词库：改措辞后所有历史记录的 `core_needs` 同步替换
10. 回顾信生成时，无 AI 对话的 entry 也能被批量补提取到 emotions / core_needs / people_involved

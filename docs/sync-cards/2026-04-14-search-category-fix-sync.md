# 同步卡：编辑关联记录搜索升级 + category_tags 修复

> **代码 session / 架构 session 冷启动时读这一份即可。**
>
> - 完整 spec：`docs/superpowers/specs/2026-04-14-edit-entries-search-and-category-tags-fix.md`
> - 实施计划：`docs/superpowers/plans/2026-04-14-edit-entries-search-and-category-tags-fix.md`
> - 上轮同步卡：`docs/sync-cards/2026-04-12-threads-gaps-sync.md`

---

## 一、背景

代码 session 已实现 `2026-04-13-threads-interaction-gaps.md` 全部 Task 0–8（含 RecordDetail 四字段可编辑、SettingsPage 标签管理、InsightsPage 候选角标）。用户使用后发现两个问题，本卡记录修复设计决策。

---

## 二、问题 1：编辑关联记录展示 + 搜索

### 现状问题
进入 `ThreadDetailPage` 编辑关联记录模式，搜索框为空时无内容展示，体验差；搜索只覆盖 `content` 字段。

### 新行为（已确认）

**默认列表（搜索框为空时）：**
- 按时间倒序展示所有未关联此脉络的 entry（排除所有 thread_entries 中已有的，含 removed_by_user=true）
- 首次加载 30 条，滑动到底追加 30 条（offset 分页，无限滚动）

**搜索模式（搜索框有内容时）：**
- 搜索结果替换默认列表
- 覆盖 6 个字段：content + entry_summary + emotions + emotion_display + core_needs + category_tags
- 实现：搜索前转义通配符，再用 Supabase `.or()` 拼接，array 字段用 `::text` cast：
  ```js
  // 先转义，防止 % _ 被当作 ilike 特殊字符（§4.23）
  const escaped = q.replace(/%/g, '\\%').replace(/_/g, '\\_')
  .or(`content.ilike.%${escaped}%,entry_summary.ilike.%${escaped}%,emotions::text.ilike.%${escaped}%,emotion_display::text.ilike.%${escaped}%,core_needs::text.ilike.%${escaped}%,category_tags::text.ilike.%${escaped}%`)
  ```
- 上限 30 条，不分页

**修改文件：** `src/pages/ThreadDetailPage.jsx`

---

## 三、问题 2：category_tags 三项修复

### 3.1 根本原因
`prompts.js` 硬编码 11 个 category_tags 候选词，新用户 `user_options` 表无 `field_name='content_category'` 记录 → category sheet 空 → AI 提取的标签（如「日常生活」）显示在 header 但无法编辑取消。

### 3.2 修复 A：自动种入默认标签（已确认 A1 方案）

**时机：** `RecordDetail.jsx` 的 `loadCategoryOptions` useEffect 完成后，若 `data.length === 0`，静默批量 INSERT 11 个默认标签到 `user_options`。仅触发一次（幂等）。

**默认 11 个标签（与 prompts.js 完全一致）：**
工作 / 家庭 / 恋爱与亲密关系 / 个人成长 / 学习 / 财务 / 运动健康 / 社交 / 玩乐休闲 / 灵性修行 / 日常生活

**DB 列名（注意）：** `field_name='content_category'`，`option_value`（不是 category/label）

**修改文件：** `src/components/RecordDetail.jsx`

### 3.3 修复 B：Sheet 展示孤儿标签（已确认 B1 方案）

**孤儿标签定义：** `entry.category_tags` 里存在，但不在当前用户 `user_options` 中的字符串（主要来源：用户在「我的」里删掉了某标签，但过去记录已打过该标签）。

**实现：** `categoryOptions = union(user_options 的 option_value 列表, entry.category_tags 里不在前者中的孤儿标签)`

孤儿标签与普通标签外观**完全一致**，可正常选中/取消，无灰色区分。

**合并到修复 A 的 loadCategoryOptions 函数中，不需要额外改动。**

### 3.4 修复 C：标签重命名 + RPC 批量回写历史 entry（已确认）

**背景：** `category_tags` 存字符串本身（非 ID），改 `user_options.option_value` 不会自动同步历史 entry，必须主动批量更新。设计决策：维持存字符串（简单、AI 提取无缝），用 RPC 一次性搞定。

#### ⚠️ Task 0（必须最先执行）：在 Supabase SQL Editor 创建 RPC 函数

> **安全说明（§4.22）：** 函数使用 `auth.uid()` 而非接收 `p_user_id`，防止越权篡改他人数据。

```sql
CREATE OR REPLACE FUNCTION replace_category_tag(p_old TEXT, p_new TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE journal_entries
  SET category_tags = array_replace(category_tags, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(category_tags);
$$;
```

预期：`Success. No rows returned`。函数创建后代码才能正常调用重命名功能。

**UI 入口：** SettingsPage 标签管理页，每个标签条目新增 ✎ 编辑按钮（ − 按钮左侧）。

**交互：** 点 ✎ → 内联输入框预填当前值 → Enter/失焦保存，Esc 取消。

**保存逻辑：**
1. 更新 `user_options.option_value`
2. 调用 `db.rpc('replace_category_tag', { p_old, p_new })` 批量回写（**无需传 user_id**，DB 函数内用 `auth.uid()`）

**修改文件：** `src/pages/SettingsPage.jsx`

---

## 四、prompts.js 与用户自定义标签的脱节（已知局限，不在本次修复范围）

AI 提取时使用 `prompts.js` 硬编码列表，不读 user_options：
- 用户新增自定义标签 → AI 不会自动选出
- 用户删除标签 → AI 可能仍提取（产生孤儿标签，B1 方案缓解）

可接受，后续优化方向：AI 提取时动态注入当前用户的 user_options 标签列表。

---

## 五、架构风险（新增，见 arch-context.md §4.20–4.23）

| 编号 | 风险 | 优先级 |
|---|---|---|
| 4.20 | replace_category_tag RPC 函数未创建，重命名功能会 runtime crash | ⚠️ 高（Task 0 必须先建） |
| 4.21 | prompts.js category_tags 与 user_options 长期脱节 | 低（已知局限，B1 缓解） |
| 4.22 | RPC 函数签名含 p_user_id 有越权风险 | ⚠️ 高（已修复：改用 auth.uid()） |
| 4.23 | 搜索词含 % 或 _ 时 ilike 通配符未转义 | 低（已处理：加转义一行） |

---

## 六、影响文件汇总

| 文件 | 变更 |
|---|---|
| Supabase SQL Editor | Task 0：创建 `replace_category_tag` RPC 函数 |
| `src/pages/ThreadDetailPage.jsx` | 编辑关联记录：默认列表 + 分页 + 6字段搜索 |
| `src/components/RecordDetail.jsx` | loadCategoryOptions：A1 默认种入 + B1 孤儿标签合并 |
| `src/pages/SettingsPage.jsx` | ✎ 重命名按钮 + handleRenameTag（RPC 回写） |

---

## 七、全部已确认，无待决策项

所有交互细节、字段名、RPC 方案均已最终确认，代码 session 可直接实施。

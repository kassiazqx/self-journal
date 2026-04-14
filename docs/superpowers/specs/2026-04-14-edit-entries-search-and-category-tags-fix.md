# 编辑关联记录搜索升级 + category_tags 编辑体验修复

> 修复版本：针对 2026-04-14 发现的两个问题。
> 前置 spec：`2026-04-12-threads-interaction-gaps.md`（§A 编辑关联记录 / §E §H category_tags）

---

## 一、问题 1：编辑关联记录 — 默认列表 + 搜索升级

### 1.1 现状

`ThreadDetailPage.jsx` 编辑关联记录模式下，当搜索框为空时不展示任何列表，用户必须先输入关键词才能看到可添加的 entry，体验差。搜索仅覆盖 `content`（原始正文）字段。

### 1.2 新行为

**默认列表（搜索框为空时）：**
- 按时间倒序展示所有**未关联此脉络**的 entry，首次加载 30 条
- 滑动到底部继续下拉 → 追加加载 30 条（offset 分页）
- 排除规则：已在 `thread_entries` 中的 entry（含 `removed_by_user=true`）一律不展示

**搜索模式（搜索框有内容时）：**
- 搜索结果**替换**默认列表（不合并）
- 搜索字段：6 个字段，一次查询全覆盖
  - `content`（原始正文，text）
  - `entry_summary`（AI 摘要，text）
  - `emotions`（情绪词，text[]）
  - `emotion_display`（情绪描述，text[]）
  - `core_needs`（核心需求，text[]）
  - `category_tags`（内容大类，text[]）
- 实现：搜索前先转义通配符，再用 Supabase `.or()` 拼接，array 字段用 `::text` cast 做 ilike：
  ```js
  // ⚠️ 先转义，防止用户输入 % 或 _ 被当作 ilike 特殊字符
  const escaped = q.replace(/%/g, '\\%').replace(/_/g, '\\_')
  .or(`content.ilike.%${escaped}%,entry_summary.ilike.%${escaped}%,emotions::text.ilike.%${escaped}%,emotion_display::text.ilike.%${escaped}%,core_needs::text.ilike.%${escaped}%,category_tags::text.ilike.%${escaped}%`)
  ```
  PostgreSQL 把 `text[]` 转换为 `{焦虑,委屈}` 形式，ilike `%焦虑%` 可以匹配。
- 搜索结果不分页，上限 30 条

### 1.3 加载更多实现

```
state: { defaultEntries: [], offset: 0, hasMore: true, loadingMore: false }

滚动到底触发 loadMore()：
  offset += 30
  查询 LIMIT 30 OFFSET offset
  追加到 defaultEntries
  若返回 < 30 条 → hasMore = false
```

---

## 二、问题 2：category_tags 三项修复

### 2.1 根本原因

AI 提取 prompt（`prompts.js`）使用硬编码标签列表：
```
工作 / 家庭 / 恋爱与亲密关系 / 个人成长 / 学习 / 财务 / 运动健康 / 社交 / 玩乐休闲 / 灵性修行 / 日常生活
```
新用户 `user_options` 表无任何 `field_name='content_category'` 记录，导致：
1. RecordDetail category sheet 显示「暂无标签」
2. AI 已提取的标签（如「日常生活」）无法在 sheet 里取消
3. SettingsPage 标签管理无法重命名，重命名后历史 entry 不同步

### 2.2 prompts.js 与用户自定义标签的脱节（已知局限）

- `prompts.js` 里的硬编码列表：① 作为 A1 方案的一次性默认种子，② 作为 AI 提取时的参考选项
- 用户在「我的」里新增自定义标签后，`prompts.js` 不会自动更新 → AI 提取时不会选出用户新增的标签
- 用户删除某标签后，AI 可能仍提取旧名称 → 形成孤儿标签
- 这是当前架构的已知局限，可接受，后续优化方向：AI 提取时动态读 user_options 注入 prompt

**孤儿标签定义**：`journal_entries.category_tags` 中存在、但不在当前用户 `user_options` 里的标签字符串。常见来源：在「我的」里删掉某标签，但过去的记录已打过该标签。

---

### 2.3 修复 A — 自动种入默认标签（A1 方案）

**时机**：RecordDetail `loadCategoryOptions` useEffect 执行后，若 `data.length === 0`，静默批量 INSERT 默认标签。

**触发条件**：`user_options` 中 `field_name='content_category'` 记录数为 0（只会触发一次）。

**默认 11 个标签**（与 `prompts.js` 完全一致，sort_order 从 0 开始递增）：
```
0: 工作
1: 家庭
2: 恋爱与亲密关系
3: 个人成长
4: 学习
5: 财务
6: 运动健康
7: 社交
8: 玩乐休闲
9: 灵性修行
10: 日常生活
```

**实现要点（RecordDetail.jsx）：**
```js
async function loadCategoryOptions() {
  const { data } = await db.from('user_options')
    .select('id, option_value, sort_order')
    .eq('user_id', initialEntry.user_id)
    .eq('field_name', 'content_category')
    .order('sort_order', { ascending: true })

  if (data?.length === 0) {
    // 静默种入默认标签
    const defaults = ['工作','家庭','恋爱与亲密关系','个人成长','学习','财务','运动健康','社交','玩乐休闲','灵性修行','日常生活']
    const rows = defaults.map((label, i) => ({
      user_id: initialEntry.user_id,
      field_name: 'content_category',
      option_value: label,
      sort_order: i,
    }))
    const { data: inserted } = await db.from('user_options').insert(rows).select('id, option_value, sort_order')
    setCategoryOptions((inserted ?? []).map(r => r.option_value))
    return
  }
  // 孤儿标签合并（见修复 B）
  const userOptionLabels = (data ?? []).map(r => r.option_value)
  const orphans = (entry.category_tags ?? []).filter(t => !userOptionLabels.includes(t))
  setCategoryOptions([...userOptionLabels, ...orphans])
}
```

---

### 2.4 修复 B — Sheet 展示孤儿标签（B1 方案）

孤儿标签在 category sheet 里与普通标签外观**完全一致**（不加灰色区分），可以正常选中/取消。用户取消选中孤儿标签并保存后，该 entry 不再有该标签，孤儿自然消失。

**已合并到修复 A 的 `loadCategoryOptions` 实现中**（见上方代码末尾 orphans 逻辑）。

---

### 2.5 修复 C — 标签重命名 + 回写历史 entry

**数据模型说明：** `journal_entries.category_tags` 存储的是字符串本身（`["日常生活","工作"]`），不是 user_options 的 ID。因此改 user_options 的显示名**不会自动同步**到 entry 里，必须主动更新。

**实现方式：Supabase RPC**，一条 SQL 一次扫描更新所有相关 entry（高效，无需逐条循环）。

**Task 0 需新增一条 SQL（Supabase SQL Editor 执行）：**

> ⚠️ **安全说明（§4.22）：** 函数内使用 `auth.uid()` 而非接收 `p_user_id` 参数，防止前端传入伪造 user_id 越权篡改他人数据。`SECURITY DEFINER` 确保函数以定义者权限运行，RLS 通过 `auth.uid()` 绑定当前登录用户。

```sql
CREATE OR REPLACE FUNCTION replace_category_tag(p_old TEXT, p_new TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE journal_entries
  SET category_tags = array_replace(category_tags, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(category_tags);
$$;
```

预期：`Success. No rows returned`。

**入口**：SettingsPage 标签管理页，每个标签条目增加 ✎ 编辑按钮（ − 按钮左侧）。

**交互：**
- 点 ✎ → 该条目 chip 变为内联输入框，预填当前值
- 按 Enter 或失焦 → 保存；按 Esc → 取消

**实现（SettingsPage.jsx）：**
```js
// state 新增
const [editingTagId, setEditingTagId] = useState(null)
const [editingTagValue, setEditingTagValue] = useState('')

async function handleRenameTag(tag) {
  const newValue = editingTagValue.trim()
  const oldValue = tag.option_value
  setEditingTagId(null)
  if (!newValue || newValue === oldValue) return

  // 1. 更新 user_options
  await db.from('user_options')
    .update({ option_value: newValue })
    .eq('id', tag.id)

  // 2. 批量回写所有历史 entry（RPC 内部用 auth.uid()，无需传 user_id）
  await db.rpc('replace_category_tag', { p_old: oldValue, p_new: newValue })

  // 3. 刷新本地 state
  setTagOptions(prev =>
    prev.map(t => t.id === tag.id ? { ...t, option_value: newValue } : t)
  )
}
```

---

## 三、影响文件

| 文件 | 变更内容 |
|---|---|
| Supabase SQL Editor | Task 0 新增 `replace_category_tag` RPC 函数 |
| `src/pages/ThreadDetailPage.jsx` | 编辑关联记录：默认列表（30条 + 加载更多）+ 搜索升级（6字段） |
| `src/components/RecordDetail.jsx` | 修复 A+B：loadCategoryOptions 自动种入默认标签 + 孤儿标签合并 |
| `src/pages/SettingsPage.jsx` | 修复 C：标签列表加 ✎ 编辑按钮 + handleRenameTag（RPC 回写历史） |

---

## 四、成功标准

1. 进入编辑关联记录模式 → 立即显示 30 条未关联 entry（时间倒序）
2. 滑到底 → 追加 30 条，直到加载完
3. 搜索框输入「焦虑」→ 匹配 emotions 字段的 entry 出现；输入「自我认同」→ 匹配 core_needs；输入「工作」→ 匹配 category_tags
4. 新用户首次打开 category_tags sheet → 自动出现 11 个默认标签
5. 已被 AI 标记「日常生活」的记录 → 打开 sheet 可看到并取消该标签
6. 「我的」标签管理 → 每个标签可点 ✎ 重命名 → 保存后所有历史 entry 的该标签同步更新（包括 RecordDetail 的 header 展示）

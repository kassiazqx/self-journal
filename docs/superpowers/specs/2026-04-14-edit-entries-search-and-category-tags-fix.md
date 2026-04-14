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
- 搜索字段：`content`（原始正文） + `entry_summary`（AI 摘要）
  - 实现：Supabase `.or('content.ilike.%q%,entry_summary.ilike.%q%')`
  - 搜索结果不分页，上限 30 条
- **扩展留口**：`core_needs`、`emotion_display` 等 `text[]` 字段后续可通过 Supabase RPC 加入，当前不实现

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
3. SettingsPage 标签管理无法重命名，重命名后历史也不同步

---

### 2.2 修复 A — 自动种入默认标签（A1 方案）

**时机**：RecordDetail `loadCategoryOptions` useEffect 执行后，若 `data.length === 0`，静默批量 INSERT 默认标签。

**触发条件**：`user_options` 中 `field_name='content_category'` 记录数为 0。

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
  setCategoryOptions((data ?? []).map(r => r.option_value))
}
```

**⚠️ 幂等性**：只在 count=0 时触发，不重复执行。

---

### 2.3 修复 B — Sheet 展示「孤儿标签」（B1 方案）

**孤儿标签**：在 `entry.category_tags` 中存在，但不在 `user_options` 中的标签（多见于 A1 修复前由 AI 提取的历史数据）。

**新的 categoryOptions 构建逻辑：**
```js
const userOptionLabels = (data ?? []).map(r => r.option_value)
const orphans = (entry.category_tags ?? []).filter(t => !userOptionLabels.includes(t))
const allOptions = [...userOptionLabels, ...orphans]
setCategoryOptions(allOptions)
```

sheet 里孤儿标签和普通标签外观一致，可以正常选中/取消。用户取消选中孤儿标签并保存后，该 entry 就不再有该标签，孤儿自然消失。

---

### 2.4 修复 C — 标签重命名（回写历史 entry）

**入口**：SettingsPage 标签管理页，每个标签条目右侧增加 ✎ 编辑按钮（在删除按钮左侧）。

**交互：**
- 点 ✎ → 该条目 chip 变为内联输入框，预填当前值
- 按 Enter 或点外部失焦 → 保存；按 Esc → 取消
- 保存时同步执行以下两步（顺序执行，非并发）：
  1. 更新 `user_options.option_value = newValue` WHERE `id = tag.id`
  2. 查出所有 `category_tags @> ARRAY['oldValue']` 的 `journal_entries`（当前用户）
  3. 逐条 update，把 `category_tags` 数组里的 oldValue 替换为 newValue

**实现（SettingsPage.jsx）：**
```js
async function handleRenameTag(tag, newValue) {
  const oldValue = tag.option_value
  if (!newValue.trim() || newValue === oldValue) return

  // 1. 更新 user_options
  await db.from('user_options')
    .update({ option_value: newValue.trim() })
    .eq('id', tag.id)

  // 2. 查找并回写所有历史 entry
  const { data: entries } = await db.from('journal_entries')
    .select('id, category_tags')
    .eq('user_id', user.id)
    .contains('category_tags', [oldValue])

  if (entries?.length > 0) {
    await Promise.all(entries.map(entry =>
      db.from('journal_entries')
        .update({
          category_tags: entry.category_tags.map(t => t === oldValue ? newValue.trim() : t)
        })
        .eq('id', entry.id)
    ))
  }

  // 3. 刷新本地 state
  setTagOptions(prev =>
    prev.map(t => t.id === tag.id ? { ...t, option_value: newValue.trim() } : t)
  )
}
```

**说明：**
- 历史 entry 数量小（个人日记 App），client-side 逐条 update 性能可接受
- 重命名后 RecordDetail 的 category sheet 自动读取新名称（从 user_options 读）

---

### 2.5 ⚠️ 附：Task 7 计划列名纠错

Task 7（`2026-04-13-threads-interaction-gaps.md`）写计划时误用了错误的列名，代码 session 执行时已自动修正（当前代码已正确）。文档记录如下：

| 计划中写的（错误）| 实际 DB 列名（正确）|
|---|---|
| `category` | `field_name` |
| `label` | `option_value` |

Task 7 的计划文本无需修改（已实现，改文档意义不大），后续新 task 直接使用正确列名。

---

## 三、影响文件

| 文件 | 变更内容 |
|---|---|
| `src/pages/ThreadDetailPage.jsx` | 编辑关联记录：默认列表 + 分页加载 + 搜索升级（content + entry_summary） |
| `src/components/RecordDetail.jsx` | 修复 A：loadCategoryOptions 自动种入默认标签；修复 B：孤儿标签加入 options |
| `src/pages/SettingsPage.jsx` | 修复 C：标签列表每条加 ✎ 编辑按钮 + handleRenameTag 函数（回写历史） |

---

## 四、成功标准

1. 进入编辑关联记录模式 → 立即显示 30 条未关联 entry（时间倒序）
2. 滑动到底 → 追加 30 条，直到全部加载完
3. 搜索框输入关键词 → 搜索结果替换列表，覆盖 content + entry_summary
4. 新用户首次打开 category_tags sheet → 自动出现 11 个默认标签，无需手动添加
5. 已被 AI 标记「日常生活」的记录 → 打开 sheet 可以看到并取消该标签
6. 「我的」标签管理 → 每个标签可点 ✎ 重命名 → 保存后该用户所有历史 entry 的该标签同步更新

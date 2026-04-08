# 事件名称自动补全 实现设计

## 目标

为首页的「事件名称」输入框添加历史记录自动补全功能，减少重复输入，方便跨时间段找回同一事件的记录（如"和妈妈吵架"横跨数年）。同时为未来「根据日记内容自动识别事件名」功能预留架构入口。

## 架构概述

新增独立的数据层（`user_options` 表 + `userOptions.js`）和检测层（`eventDetection.js`），`HomePage.jsx` 的 event_name 输入框替换为自动补全组件。各层职责单一，未来升级只改对应层。

## 技术栈

- 前端：React（现有）
- 数据库：Supabase PostgreSQL（现有）
- 新增：`user_options` 表、PostgreSQL RPC 函数

---

## 数据层设计

### user_options 表

```sql
CREATE TABLE user_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  field_name text NOT NULL,      -- 'event_name'，未来可扩展 'people' 等
  value text NOT NULL,
  use_count integer DEFAULT 1,
  last_used_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, field_name, value)
);

ALTER TABLE user_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户只能访问自己的选项"
  ON user_options FOR ALL
  USING (auth.uid() = user_id);
```

`field_name` 列使此表通用，本次只用 `'event_name'`，未来 `'people'` 等字段可复用同一张表。

### RPC 函数（处理 upsert + 计数递增）

```sql
CREATE OR REPLACE FUNCTION upsert_user_option(
  p_user_id uuid,
  p_field text,
  p_value text
) RETURNS void AS $$
BEGIN
  INSERT INTO user_options (user_id, field_name, value, use_count, last_used_at)
  VALUES (p_user_id, p_field, p_value, 1, now())
  ON CONFLICT (user_id, field_name, value)
  DO UPDATE SET
    use_count = user_options.use_count + 1,
    last_used_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 历史数据一次性回填

在 Supabase SQL Editor 跑一次，将现有 `journal_entries` 的 event_name 导入 user_options：

```sql
INSERT INTO user_options (user_id, field_name, value, use_count, last_used_at)
SELECT
  user_id,
  'event_name',
  event_name,
  COUNT(*) AS use_count,
  MAX(created_at) AS last_used_at
FROM journal_entries
WHERE event_name IS NOT NULL AND event_name <> ''
GROUP BY user_id, event_name
ON CONFLICT (user_id, field_name, value)
DO UPDATE SET
  use_count = EXCLUDED.use_count,
  last_used_at = EXCLUDED.last_used_at;
```

---

## 排序规则

下拉列表的排序逻辑（在 `userOptions.js` 前端实现）：

1. **1天内用过的优先**（`last_used_at > now - 24h`），按 `last_used_at` 降序
2. **1天外的**，按 `use_count` 降序
3. 两组各自内部排好后拼接

---

## 新增文件

### `src/lib/userOptions.js`

职责：读取用户选项列表、保存选项（调用 RPC）。

```js
import { supabase } from './supabase'

// 获取指定字段的所有历史选项，返回排序后的数组
export async function getUserOptions(fieldName) {
  const { data, error } = await supabase
    .from('user_options')
    .select('value, use_count, last_used_at')
    .eq('field_name', fieldName)
    .order('use_count', { ascending: false })
  if (error) { console.error('[userOptions]', error); return [] }

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
  const recent = data.filter(r => new Date(r.last_used_at) > oneDayAgo)
    .sort((a, b) => new Date(b.last_used_at) - new Date(a.last_used_at))
  const older = data.filter(r => new Date(r.last_used_at) <= oneDayAgo)
    .sort((a, b) => b.use_count - a.use_count)

  return [...recent, ...older].map(r => r.value)
}

// 保存一条新选项（或递增计数）
export async function saveUserOption(userId, fieldName, value) {
  if (!value?.trim()) return
  const { error } = await supabase.rpc('upsert_user_option', {
    p_user_id: userId,
    p_field: fieldName,
    p_value: value.trim(),
  })
  if (error) console.error('[userOptions] 保存失败:', error)
}
```

### `src/lib/eventDetection.js`

职责：从日记内容中检测已知事件名（纯关键词匹配，为未来升级预留接口）。

```js
// 从 content 中检测是否包含 knownOptions 里的事件名
// 返回匹配到的第一个事件名，或 null
export function detectEventFromContent(content, knownOptions) {
  if (!content || !knownOptions?.length) return null
  return knownOptions.find(opt => content.includes(opt)) ?? null
}

// 未来升级为 AI 检测时，只替换此文件的实现，接口不变
```

---

## 修改文件

### `src/pages/HomePage.jsx`

**改动点：**

1. **挂载时**：调用 `getUserOptions('event_name')` 获取历史选项，存入 state
2. **event_name 输入框**：替换为自定义自动补全组件（内联实现，不单独抽文件）
3. **内容输入框 onChange**：调用 `detectEventFromContent(content, options)` — 若检测到且 event_name 为空，自动填入（并提示用户，可覆盖）
4. **保存成功后**：调用 `saveUserOption(user.id, 'event_name', eventName)` 写入历史

**自动补全组件行为：**
- 点击 / 聚焦：展开下拉，显示全部历史（已排序）
- 输入时：本地过滤（`value.includes(input)` 模糊匹配），不再请求网络
- 点击某条历史：填入输入框，关闭下拉
- 点击输入框外：关闭下拉
- 下拉最多展示 **8 条**（避免遮挡过多内容）

---

## 不在本次范围内

- 历史记录的删除、编辑、归档（待进阶，在设置页实现）
- `people_involved` 等其他字段的自动补全
- AI 检测事件名（`eventDetection.js` 接口已预留，实现留待后续）

---

## 成功标准

- [ ] 首次使用：历史下拉正常展示（回填脚本跑完后有数据）
- [ ] 全新用户：下拉为空，手动输入后保存，下次出现在历史里
- [ ] 1天内用过的排在前面，1天外按频次排
- [ ] 输入时实时过滤，不触发网络请求
- [ ] 内容里包含已知事件名时，event_name 为空则自动填入
- [ ] 保存日记后，该事件名的 use_count 递增，下次下拉里排序更新

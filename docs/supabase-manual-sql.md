# Supabase 手动执行 SQL 记录

> ⚠️ 这些 SQL 函数存在 Supabase 数据库里，**不在 git 里**。
> 换 Supabase 项目时，必须手动在 SQL Editor 逐条执行。

---

## 函数列表

### 1. replace_category_tag
**创建时间：** 2026-04-15  
**用途：** 标签重命名时，批量把所有历史 journal_entries 里的旧标签字符串替换为新名称  
**调用方：** `src/pages/SettingsPage.jsx` → `handleRenameTag()`

```sql
CREATE OR REPLACE FUNCTION replace_category_tag(p_old TEXT, p_new TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE journal_entries
  SET category_tags = array_replace(category_tags, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(category_tags);
$$;
```

**安全说明：** 函数内用 `auth.uid()` 限定用户，不接受 user_id 参数，防止越权。

### 2. replace_person_name
**创建时间：** 2026-04-17（spec §5.4）  
**用途：** 人物联系人改规范名称时，批量把所有历史 journal_entries 里的旧 canonical 替换为新名称  
**调用方：** 「我的」→「人物管理」→ 编辑保存时

```sql
CREATE OR REPLACE FUNCTION replace_person_name(p_old TEXT, p_new TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE journal_entries
  SET people_involved = array_replace(people_involved, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(people_involved);
$$;
```

**安全说明：** 函数内用 `auth.uid()` 限定用户，不接受 user_id 参数，防止越权。

---

### 3. replace_core_need
**创建时间：** 2026-04-17（spec §9.3）  
**用途：** core_needs 词库改措辞时，批量把所有历史 journal_entries 里的旧词替换为新词  
**调用方：** 「我的」→「内心需求词库」→ 编辑保存时

```sql
CREATE OR REPLACE FUNCTION replace_core_need(p_old TEXT, p_new TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE journal_entries
  SET core_needs = array_replace(core_needs, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(core_needs);
$$;
```

**安全说明：** 函数内用 `auth.uid()` 限定用户，不接受 user_id 参数，防止越权。

---

## 换项目时的执行顺序

1. 在 Supabase UI 建好所有表（参考 `docs/arch-context.md §3` 表结构）
2. 在 SQL Editor 按上方顺序逐条执行函数
3. 检查 RLS 策略是否已启用

---

## 备注

- 表结构（journal_entries / threads / thread_entries 等）通过 Supabase UI 创建，未在此记录
- 如果将来新增函数，在「函数列表」里追加一条

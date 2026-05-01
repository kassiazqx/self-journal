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

### 0. trigger_insert_default_options compatibility fix
**创建时间：** 2026-04-30  
**用途：** 修复旧的 `auth.users` 注册触发器调用路径，防止 `/signup` 因运行时找不到 `insert_default_options(uuid)` 而报 500。  
**说明：** 过渡期内保留 `insert_default_options()` 原逻辑，等 App 侧 bootstrap 重构验证通过后，再改成空函数。

```sql
create or replace function public.trigger_insert_default_options()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.insert_default_options(new.id);
  return new;
end;
$$;
```

### 0.5 默认数据唯一约束（并发首登保护）
**创建时间：** 2026-05-01  
**用途：** 防止同一用户双端/双窗口首次登录时，默认分类、默认联系人被重复插入。  
**说明：** App 侧 bootstrap 仍负责初始化时机；数据库侧唯一约束负责兜住并发重复写。

```sql
with ranked as (
  select ctid,
         row_number() over (
           partition by user_id, field_name, option_value
           order by ctid
         ) as rn
  from public.user_options
)
delete from public.user_options u
using ranked r
where u.ctid = r.ctid
  and r.rn > 1;

with ranked as (
  select ctid,
         row_number() over (
           partition by user_id, canonical
           order by ctid
         ) as rn
  from public.user_contacts
)
delete from public.user_contacts c
using ranked r
where c.ctid = r.ctid
  and r.rn > 1;

create unique index if not exists user_options_user_field_value_uniq
on public.user_options(user_id, field_name, option_value);

create unique index if not exists user_contacts_user_canonical_uniq
on public.user_contacts(user_id, canonical);
```

### 0.1 insert_default_options retirement
**创建时间：** 2026-04-30  
**用途：** 在 App 侧默认数据 bootstrap 验证通过后，停用旧的 DB 侧默认分类写入逻辑。  
**说明：** trigger 仍可存在，但函数体为空；真正的默认数据初始化由 App 代码负责。

```sql
create or replace function public.insert_default_options(p_user_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  return;
end;
$$;
```

---

## 换项目时的执行顺序

1. 在 Supabase UI 建好所有表（参考 `docs/arch-context.md §3` 表结构）
2. 先执行 `0 / 0.5` 兼容与唯一约束 SQL，再执行业务 RPC
3. App 侧 bootstrap 验证通过后，再执行 `0.1`
3. 检查 RLS 策略是否已启用

---

## 备注

- 表结构（journal_entries / threads / thread_entries 等）通过 Supabase UI 创建，未在此记录
- 如果将来新增函数，在「函数列表」里追加一条

# Default User Data Code-Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate default content categories, core needs, and contacts into a single code source, seed them exactly once for brand-new users, and stop later app versions from silently changing existing users' data.

**Architecture:** Move all default user data into one code module. Keep the seeded-version marker in `storage.js` as a Web-phase transition aid, but make bootstrap behavior transition-safe: if the old DB-side category seeder has already inserted only `content_category`, app bootstrap must still backfill the missing `core_need` and `user_contacts` rows for zero-entry users instead of misclassifying them as legacy. Bootstrap writes must be idempotent under parallel first-login attempts by relying on DB uniqueness plus duplicate-safe upsert behavior. `MainLayout` owns one shared bootstrap status and passes it down so `HomePage` / `SettingsPage` do not race ahead of initialization. UI should not full-screen block while bootstrap runs: only the contact-management area in Settings gets a small inline loading hint, `正在准备联系人词库...`, until contacts are ready.

**Tech Stack:** React, existing `db.js` adapter, Supabase (transitional web phase), `storage.js` local-storage abstraction, Node `node:test`, Vite

---

## File Structure

**Create**

- `src/lib/defaultUserData.js` — single code source for default content categories, core needs, and contacts; exports row-builder helpers for DB insert.
- `src/lib/defaultUserData.test.js` — unit tests for default row builders and shape invariants.
- `src/lib/defaultUserBootstrap.js` — one-time bootstrap coordinator; contains “brand-new vs legacy user” decision and insert orchestration.
- `src/lib/defaultUserBootstrap.test.js` — unit tests for seed-version gating and legacy-user no-reseed behavior.

**Modify**

- `src/lib/storage.js` — add seed-version read/write helpers through the existing storage abstraction.
- `src/lib/storage.test.js` — add tests for seed-version helpers.
- `src/pages/HomePage.jsx` — stop page-level auto-seeding; only load contacts after app-level bootstrap.
- `src/components/RecordDetail.jsx` — stop `data.length === 0` category auto-insert; only read user data and merge orphan tags for display.
- `src/lib/entryExtractionService.js` — stop inserting default categories from the extraction path; read user rows only.
- `src/lib/contactsService.js` — remove embedded default contacts constant; keep CRUD + detection only.
- `src/lib/coreNeedsService.js` — remove embedded default core-needs constant; keep CRUD + pending management only.
- `src/components/MainLayout.jsx` — call `ensureDefaultUserData(user.id)` once after auth is ready.
- `src/pages/SettingsPage.jsx` — show a small inline “正在准备联系人词库...” hint for the contact-management entry / subpage while bootstrap-backed contacts are not ready; no full-page blocking, no retry button.
- `docs/supabase-manual-sql.md` — document the temporary SQL compatibility shim for broken signup and note that app-level bootstrap owns defaults now.
- `docs/arch-context.md` — update architecture notes and log.
- `docs/sync-cards/2026-04-27-apk-packaging-todo.md` — append follow-up notes for how this default-data bootstrap should evolve when APK local-first / offline writing work starts.

**Do Not Create**

- No new Supabase trigger for defaults.
- No DB-driven “if count is zero then reseed” fallback.
- No automatic version migration that overwrites user-edited rows.

---

## Rules This Plan Must Enforce

1. Default values live in code in exactly one place.
2. Brand-new users get defaults once.
3. Existing users never receive new defaults automatically just because app code changed.
4. If a user later deletes all categories, app must respect the empty state and must not add defaults back.
5. Current web phase still needs signup to stop failing, so broken DB-side default seeding must be neutralized.
6. This batch does **not** add a “恢复推荐默认项” button for legacy users.
7. Bootstrap progress must not blank the whole Settings page; only the contact-related area may show the inline hint `正在准备联系人词库...`.
8. During the transition window, if DB-side signup logic has already inserted only categories, app bootstrap must still补齐 missing `core_need` / `user_contacts` for zero-entry users.
9. Default-data inserts must be duplicate-safe under double login / double device races, especially for `user_contacts`.
10. Only `HomePage` and `SettingsPage` get explicit bootstrap gating in this batch; `RecordsPage` / `ThreadDetailPage` / `RecordDetail` are accepted to keep their current read timing, because they are secondary paths after login.

---

### Task 0: Restore Signup Compatibility While App-Level Bootstrap Takes Over

**Files:**
- Modify: `docs/supabase-manual-sql.md`
- Verify in Supabase SQL Editor

- [ ] **Step 1: Reproduce the current failure with a fresh signup**

Run:

```bash
node - <<'NODE'
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1)]
    })
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const email = `plan-signup-check-${Date.now()}@example.com`

;(async () => {
  const { error } = await supabase.auth.signUp({ email, password: 'test1234' })
  console.log(error?.message ?? 'OK')
})()
NODE
```

Expected before SQL fix:

```text
Database error saving new user
```

- [ ] **Step 2: Inspect and fix the trigger caller in Supabase SQL Editor**

Paste into Supabase SQL Editor:

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

Expected: SQL runs successfully with no error. This step fixes the real production issue found in logs: the trigger function existed, but it was not resolving `public.insert_default_options(...)` correctly at runtime.

- [ ] **Step 3: Re-run the signup reproduction**

Run the same command from Step 1 again.

Expected after SQL fix:

```text
OK
```

Or a non-500 Auth response such as successful signup / email confirmation required. The key assertion is: **no more `Database error saving new user`**.

- [ ] **Step 4: Keep the current `insert_default_options(p_user_id uuid)` body in place temporarily**

Important:

- Do **not** make `insert_default_options()` a no-op yet.
- During the transition window, the old DB-side category seeding must stay alive until app-level bootstrap is fully implemented and verified.
- If you empty this function too early, signup may succeed but brand-new users in the current web build may miss default `content_category` rows before the app bootstrap lands.

- [ ] **Step 5: Record the trigger fix in `docs/supabase-manual-sql.md`**

Add this section:

```md
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
```

- [ ] **Step 6: Do not commit yet**

Reason: project workflow requires `npm run build` + `npm run dev` + user manual validation before any commit. Carry this SQL/doc change into later tasks.

---

### Task 0.5: Harden DB Uniqueness For Parallel First Login

**Files:**
- Modify: `docs/supabase-manual-sql.md`
- Verify in Supabase SQL Editor

- [ ] **Step 1: Clean existing duplicate default rows before adding unique indexes**

Run in Supabase SQL Editor:

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
```

Expected:

```text
DELETE 0
```

Or a small positive number if old duplicate rows existed. Both are acceptable.

- [ ] **Step 2: Add unique indexes for default-data identity**

Run in Supabase SQL Editor:

```sql
create unique index if not exists user_options_user_field_value_uniq
on public.user_options(user_id, field_name, option_value);

create unique index if not exists user_contacts_user_canonical_uniq
on public.user_contacts(user_id, canonical);
```

Expected: both SQL statements succeed.

- [ ] **Step 3: Record the uniqueness hardening in `docs/supabase-manual-sql.md`**

Add this section:

```md
### 0.5 默认数据唯一约束（并发首登保护）
**创建时间：** 2026-05-01  
**用途：** 防止同一用户双端/双窗口首次登录时，默认分类、默认联系人被重复插入。  
**说明：** App 侧 bootstrap 仍负责初始化时机；数据库侧唯一约束负责兜住并发重复写。

```sql
create unique index if not exists user_options_user_field_value_uniq
on public.user_options(user_id, field_name, option_value);

create unique index if not exists user_contacts_user_canonical_uniq
on public.user_contacts(user_id, canonical);
```
```

- [ ] **Step 4: Do not treat this as optional**

This is part of the short-term correctness fix, not a “later if convenient” hardening item. Without it, `user_contacts` can still double-insert under parallel brand-new login.

---

### Task 1: Create the Single Code Source for Default User Data

**Files:**
- Create: `src/lib/defaultUserData.js`
- Create: `src/lib/defaultUserData.test.js`
- Modify: `src/lib/contactsService.js`
- Modify: `src/lib/coreNeedsService.js`

- [ ] **Step 1: Write the failing test for centralized default row builders**

Create `src/lib/defaultUserData.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_CONTENT_CATEGORIES,
  DEFAULT_CORE_NEEDS,
  DEFAULT_CONTACTS,
  createDefaultCategoryRows,
  createDefaultCoreNeedRows,
  createDefaultContactRows,
} from './defaultUserData.js'

test('createDefaultCategoryRows 生成 content_category 行和递增 sort_order', () => {
  const rows = createDefaultCategoryRows('u1')

  assert.equal(rows.length, DEFAULT_CONTENT_CATEGORIES.length)
  assert.equal(rows[0].user_id, 'u1')
  assert.equal(rows[0].field_name, 'content_category')
  assert.equal(rows[0].sort_order, 0)
  assert.equal(rows.at(-1).sort_order, rows.length - 1)
})

test('createDefaultCoreNeedRows 生成 core_need 行和递增 sort_order', () => {
  const rows = createDefaultCoreNeedRows('u1')

  assert.equal(rows.length, DEFAULT_CORE_NEEDS.length)
  assert.equal(rows[0].field_name, 'core_need')
  assert.equal(rows[0].option_value, DEFAULT_CORE_NEEDS[0])
})

test('createDefaultContactRows 保留 canonical aliases group_name 和 sort_order', () => {
  const rows = createDefaultContactRows('u1')

  assert.equal(rows.length, DEFAULT_CONTACTS.length)
  assert.equal(rows[0].user_id, 'u1')
  assert.equal(typeof rows[0].canonical, 'string')
  assert.ok(Array.isArray(rows[0].aliases))
  assert.equal(rows[0].sort_order, 0)
})
```

- [ ] **Step 2: Run the test and confirm it fails because module does not exist**

Run:

```bash
node --test src/lib/defaultUserData.test.js
```

Expected:

```text
ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: Create `src/lib/defaultUserData.js`**

```js
export const DEFAULT_CONTENT_CATEGORIES = [
  '工作',
  '家庭',
  '恋爱与亲密关系',
  '个人成长',
  '学习',
  '财务',
  '运动健康',
  '社交',
  '玩乐休闲',
  '灵性修行',
  '日常生活',
]

export const DEFAULT_CORE_NEEDS = [
  '被理解', '被看见', '被接纳', '被爱', '被需要',
  '被认可', '被信任', '安全感', '掌控感', '归属感',
  '独立自主', '公平', '边界被尊重', '被支持', '休息',
  '成就感', '意义感', '自我表达', '连接感', '被倾听',
]

export const DEFAULT_CONTACTS = [
  { canonical: '妈妈', aliases: ['妈妈', '母亲', '老妈', '阿妈'], group_name: '家人' },
  { canonical: '爸爸', aliases: ['爸爸', '父亲', '老爸', '阿爸'], group_name: '家人' },
  { canonical: '奶奶', aliases: ['奶奶', '祖母'], group_name: '家人' },
  { canonical: '爷爷', aliases: ['爷爷', '祖父'], group_name: '家人' },
  { canonical: '外婆', aliases: ['外婆', '姥姥', '外祖母'], group_name: '家人' },
  { canonical: '外公', aliases: ['外公', '姥爷', '外祖父'], group_name: '家人' },
  { canonical: '哥哥', aliases: ['哥哥', '大哥', '兄长'], group_name: '家人' },
  { canonical: '弟弟', aliases: ['弟弟', '小弟'], group_name: '家人' },
  { canonical: '姐姐', aliases: ['姐姐', '大姐'], group_name: '家人' },
  { canonical: '妹妹', aliases: ['妹妹', '小妹'], group_name: '家人' },
  { canonical: '男友', aliases: ['男友', '男朋友', '男盆友'], group_name: '伴侣' },
  { canonical: '女友', aliases: ['女友', '女朋友', '女盆友'], group_name: '伴侣' },
  { canonical: '老公', aliases: ['老公', '丈夫', '先生'], group_name: '伴侣' },
  { canonical: '老婆', aliases: ['老婆', '妻子', '太太'], group_name: '伴侣' },
  { canonical: '婆婆', aliases: ['婆婆'], group_name: '家人' },
  { canonical: '老板', aliases: ['老板', '上司', '领导'], group_name: '同事' },
  { canonical: '同事', aliases: ['同事'], group_name: '同事' },
  { canonical: '客户', aliases: ['客户', '甲方'], group_name: '同事' },
  { canonical: '朋友', aliases: ['朋友', '好友', '好朋友'], group_name: '朋友' },
  { canonical: '闺蜜', aliases: ['闺蜜', '死党'], group_name: '朋友' },
  { canonical: '同学', aliases: ['同学'], group_name: '朋友' },
  { canonical: '室友', aliases: ['室友'], group_name: '朋友' },
]

export function createDefaultCategoryRows(userId) {
  return DEFAULT_CONTENT_CATEGORIES.map((label, index) => ({
    user_id: userId,
    field_name: 'content_category',
    option_value: label,
    sort_order: index,
  }))
}

export function createDefaultCoreNeedRows(userId) {
  return DEFAULT_CORE_NEEDS.map((label, index) => ({
    user_id: userId,
    field_name: 'core_need',
    option_value: label,
    sort_order: index,
  }))
}

export function createDefaultContactRows(userId) {
  return DEFAULT_CONTACTS.map((contact, index) => ({
    user_id: userId,
    canonical: contact.canonical,
    aliases: contact.aliases,
    group_name: contact.group_name ?? null,
    sort_order: index,
  }))
}
```

- [ ] **Step 4: Remove duplicated constants from services and import centralized defaults**

In `src/lib/contactsService.js`, replace the local `DEFAULT_CONTACTS` constant with:

```js
import { db } from './db'
import { DEFAULT_CONTACTS } from './defaultUserData'
```

In `src/lib/coreNeedsService.js`, replace the local `DEFAULT_CORE_NEEDS` constant with:

```js
import { db } from './db'
import { DEFAULT_CORE_NEEDS } from './defaultUserData'
```

Leave behavior unchanged for now; only remove duplicated source-of-truth arrays.

- [ ] **Step 5: Run the new tests**

Run:

```bash
node --test src/lib/defaultUserData.test.js
```

Expected:

```text
# pass 3
```

- [ ] **Step 6: Do not commit yet**

Reason: commit is deferred until the full default-data flow is verified end-to-end.

---

### Task 2: Add Explicit Seed-Version Storage Helpers

**Files:**
- Modify: `src/lib/storage.js`
- Modify: `src/lib/storage.test.js`

- [ ] **Step 1: Write failing tests for seed-version helpers**

Append to `src/lib/storage.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeProviderSettings,
  mergeProviderSettings,
  getDefaultUserDataSeedVersion,
  saveDefaultUserDataSeedVersion,
} from './storage.js'

function createFakeStorage() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, value)
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

test('getDefaultUserDataSeedVersion 空存储时返回 0', () => {
  globalThis.localStorage = createFakeStorage()
  assert.equal(getDefaultUserDataSeedVersion('u1'), 0)
})

test('saveDefaultUserDataSeedVersion 写入后可读回 version', () => {
  globalThis.localStorage = createFakeStorage()

  saveDefaultUserDataSeedVersion('u1', 3)

  assert.equal(getDefaultUserDataSeedVersion('u1'), 3)
})
```

- [ ] **Step 2: Run the test and confirm the new helpers are missing**

Run:

```bash
node --test src/lib/storage.test.js
```

Expected:

```text
SyntaxError
```

Or named export missing for `getDefaultUserDataSeedVersion`.

- [ ] **Step 3: Add seed-version helpers to `src/lib/storage.js`**

Insert below the existing AI settings helpers:

```js
const DEFAULT_USER_DATA_SEED_PREFIX = 'default_user_data_seed'

function getDefaultUserDataSeedKey(scopeId) {
  return `${DEFAULT_USER_DATA_SEED_PREFIX}_${scopeId}`
}

export function getDefaultUserDataSeedVersion(scopeId) {
  const parsed = safeParse(_get(getDefaultUserDataSeedKey(scopeId)))
  return Number.isInteger(parsed?.version) ? parsed.version : 0
}

export function saveDefaultUserDataSeedVersion(scopeId, version) {
  _set(getDefaultUserDataSeedKey(scopeId), JSON.stringify({
    version,
    savedAt: new Date().toISOString(),
  }))
}
```

- [ ] **Step 4: Run the storage tests**

Run:

```bash
node --test src/lib/storage.test.js
```

Expected:

```text
# pass 4
```

- [ ] **Step 5: Do not commit yet**

Reason: bootstrap coordinator and integration tasks still depend on this storage API.

---

### Task 3: Add the One-Time Bootstrap Coordinator With Legacy-User Protection

**Files:**
- Create: `src/lib/defaultUserBootstrap.js`
- Create: `src/lib/defaultUserBootstrap.test.js`

- [ ] **Step 1: Write failing tests for brand-new vs legacy behavior**

Create `src/lib/defaultUserBootstrap.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_USER_DATA_SEED_VERSION,
  shouldSeedDefaultUserData,
  getMissingDefaultUserDataKinds,
  ensureDefaultUserData,
} from './defaultUserBootstrap.js'

test('shouldSeedDefaultUserData 只对真正全空的新用户返回 true', () => {
  assert.equal(shouldSeedDefaultUserData({
    entryCount: 0,
    categoryCount: 0,
    coreNeedCount: 0,
    contactCount: 0,
  }), true)

  assert.equal(shouldSeedDefaultUserData({
    entryCount: 1,
    categoryCount: 0,
    coreNeedCount: 0,
    contactCount: 0,
  }), false)
})

test('getMissingDefaultUserDataKinds 返回缺失集合', () => {
  assert.deepEqual(getMissingDefaultUserDataKinds({
    categoryCount: 11,
    coreNeedCount: 0,
    contactCount: 0,
  }), ['core_need', 'user_contacts'])
})

test('ensureDefaultUserData 对 brand-new user 执行插入并写 seed version', async () => {
  const calls = []
  let savedVersion = 0

  const result = await ensureDefaultUserData('u1', {
    getVersion: () => 0,
    saveVersion: (_scopeId, version) => { savedVersion = version },
    fetchState: async () => ({
      entryCount: 0,
      categoryCount: 0,
      coreNeedCount: 0,
      contactCount: 0,
    }),
    insertRows: async () => { calls.push('insert') },
  })

  assert.equal(result.status, 'seeded')
  assert.deepEqual(calls, ['insert'])
  assert.equal(savedVersion, DEFAULT_USER_DATA_SEED_VERSION)
})

test('ensureDefaultUserData marker 丢失但默认数据已存在时不重复插入', async () => {
  const calls = []
  let savedVersion = 0

  const result = await ensureDefaultUserData('u1', {
    getVersion: () => 0,
    saveVersion: (_scopeId, version) => { savedVersion = version },
    fetchState: async () => ({
      entryCount: 0,
      categoryCount: 11,
      coreNeedCount: 20,
      contactCount: 22,
    }),
    insertRows: async () => { calls.push('insert') },
  })

  assert.equal(result.status, 'already-present')
  assert.deepEqual(calls, [])
  assert.equal(savedVersion, DEFAULT_USER_DATA_SEED_VERSION)
})

test('ensureDefaultUserData 对过渡期只写了默认分类的新用户补齐缺失集合', async () => {
  const calls = []
  let savedVersion = 0

  const result = await ensureDefaultUserData('u1', {
    getVersion: () => 0,
    saveVersion: (_scopeId, version) => { savedVersion = version },
    fetchState: async () => ({
      entryCount: 0,
      categoryCount: 11,
      coreNeedCount: 0,
      contactCount: 0,
    }),
    insertRows: async (_userId, missingKinds) => { calls.push(missingKinds) },
  })

  assert.equal(result.status, 'seeded-missing')
  assert.deepEqual(calls, [['core_need', 'user_contacts']])
  assert.equal(savedVersion, DEFAULT_USER_DATA_SEED_VERSION)
})

test('ensureDefaultUserData 对 legacy user 只写 marker 不补默认值', async () => {
  const calls = []
  let savedVersion = 0

  const result = await ensureDefaultUserData('u1', {
    getVersion: () => 0,
    saveVersion: (_scopeId, version) => { savedVersion = version },
    fetchState: async () => ({
      entryCount: 2,
      categoryCount: 0,
      coreNeedCount: 0,
      contactCount: 0,
    }),
    insertRows: async () => { calls.push('insert') },
  })

  assert.equal(result.status, 'marked-legacy')
  assert.deepEqual(calls, [])
  assert.equal(savedVersion, DEFAULT_USER_DATA_SEED_VERSION)
})
```

- [ ] **Step 2: Run the test and confirm the module does not exist yet**

Run:

```bash
node --test src/lib/defaultUserBootstrap.test.js
```

Expected:

```text
ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: Create `src/lib/defaultUserBootstrap.js`**

```js
import { db } from './db'
import {
  createDefaultCategoryRows,
  createDefaultCoreNeedRows,
  createDefaultContactRows,
} from './defaultUserData'
import {
  getDefaultUserDataSeedVersion,
  saveDefaultUserDataSeedVersion,
} from './storage'

export const DEFAULT_USER_DATA_SEED_VERSION = 1

export function shouldSeedDefaultUserData({
  entryCount,
  categoryCount,
  coreNeedCount,
  contactCount,
}) {
  return entryCount === 0
    && categoryCount === 0
    && coreNeedCount === 0
    && contactCount === 0
}

export function getMissingDefaultUserDataKinds({
  categoryCount,
  coreNeedCount,
  contactCount,
}) {
  const missing = []
  if (categoryCount === 0) missing.push('content_category')
  if (coreNeedCount === 0) missing.push('core_need')
  if (contactCount === 0) missing.push('user_contacts')
  return missing
}

async function fetchDefaultDataState(userId) {
  const [
    { count: entryCount },
    { count: categoryCount },
    { count: coreNeedCount },
    { count: contactCount },
  ] = await Promise.all([
    db.from('journal_entries').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    db.from('user_options').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('field_name', 'content_category'),
    db.from('user_options').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('field_name', 'core_need'),
    db.from('user_contacts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])

  return {
    entryCount: entryCount ?? 0,
    categoryCount: categoryCount ?? 0,
    coreNeedCount: coreNeedCount ?? 0,
    contactCount: contactCount ?? 0,
  }
}

async function insertDefaultRows(userId, missingKinds) {
  const jobs = []

  if (missingKinds.includes('content_category')) {
    jobs.push(db.from('user_options').upsert(
      createDefaultCategoryRows(userId),
      { onConflict: 'user_id,field_name,option_value', ignoreDuplicates: true },
    ))
  }
  if (missingKinds.includes('core_need')) {
    jobs.push(db.from('user_options').upsert(
      createDefaultCoreNeedRows(userId),
      { onConflict: 'user_id,field_name,option_value', ignoreDuplicates: true },
    ))
  }
  if (missingKinds.includes('user_contacts')) {
    jobs.push(db.from('user_contacts').upsert(
      createDefaultContactRows(userId),
      { onConflict: 'user_id,canonical', ignoreDuplicates: true },
    ))
  }

  const results = await Promise.all(jobs)
  const firstError = results.find((result) => result.error)?.error
  if (firstError) throw firstError
}

export async function ensureDefaultUserData(userId, deps = {}) {
  if (!userId) return { status: 'no-user' }

  const getVersion = deps.getVersion ?? getDefaultUserDataSeedVersion
  const saveVersion = deps.saveVersion ?? saveDefaultUserDataSeedVersion
  const fetchState = deps.fetchState ?? fetchDefaultDataState
  const insertRows = deps.insertRows ?? insertDefaultRows

  if (getVersion(userId) >= DEFAULT_USER_DATA_SEED_VERSION) {
    return { status: 'already-seeded' }
  }

  const state = await fetchState(userId)

  if (state.entryCount > 0) {
    saveVersion(userId, DEFAULT_USER_DATA_SEED_VERSION)
    return { status: 'marked-legacy' }
  }

  const missingKinds = getMissingDefaultUserDataKinds(state)

  if (missingKinds.length === 0) {
    saveVersion(userId, DEFAULT_USER_DATA_SEED_VERSION)
    return { status: 'already-present' }
  }

  if (shouldSeedDefaultUserData(state)) {
    await insertRows(userId, missingKinds)
    saveVersion(userId, DEFAULT_USER_DATA_SEED_VERSION)
    return { status: 'seeded' }
  }

  await insertRows(userId, missingKinds)
  saveVersion(userId, DEFAULT_USER_DATA_SEED_VERSION)
  return { status: 'seeded-missing' }
}
```

- [ ] **Step 4: Run the bootstrap tests**

Run:

```bash
node --test src/lib/defaultUserBootstrap.test.js
```

Expected:

```text
# pass 5
```

- [ ] **Step 5: Run storage + bootstrap + defaults tests together**

Run:

```bash
node --test src/lib/defaultUserData.test.js src/lib/storage.test.js src/lib/defaultUserBootstrap.test.js
```

Expected:

```text
# pass 12
```

- [ ] **Step 6: Do not commit yet**

Reason: integration wiring has not been verified in the running app.

---

### Task 4: Wire Bootstrap Into Startup and Remove Opportunistic Reseeding

**Files:**
- Modify: `src/components/MainLayout.jsx`
- Modify: `src/pages/HomePage.jsx`
- Modify: `src/components/RecordDetail.jsx`
- Modify: `src/lib/entryExtractionService.js`
- Modify: `src/lib/contactsService.js`
- Modify: `src/lib/coreNeedsService.js`
- Modify: `src/pages/SettingsPage.jsx`

- [ ] **Step 1: Call bootstrap once from app startup**

In `src/components/MainLayout.jsx`, add:

```js
import { ensureDefaultUserData } from '../lib/defaultUserBootstrap'
```

Then inside `MainLayout()`, make bootstrap both StrictMode-safe and share one status downward:

```js
  const [defaultUserDataStatus, setDefaultUserDataStatus] = useState('idle')
  const bootstrappedUserRef = useRef(null)

  useEffect(() => {
    if (!user?.id) return
    if (bootstrappedUserRef.current === user.id) return

    bootstrappedUserRef.current = user.id
    setDefaultUserDataStatus('loading')

    ensureDefaultUserData(user.id)
      .then(() => setDefaultUserDataStatus('ready'))
      .catch((error) => {
        console.error('[defaultUserData] bootstrap failed:', error)
        setDefaultUserDataStatus('error')
      })
  }, [user?.id])
```

Pass `defaultUserDataStatus` into `HomePage` and `SettingsPage` so they do not race bootstrap with their own reads.

- [ ] **Step 2: Remove HomePage mount-time seeding**

In `src/pages/HomePage.jsx`, replace:

```js
import { loadContacts, seedDefaultContacts, addContact, detectPeopleFromText } from '../lib/contactsService'
import { seedDefaultCoreNeeds } from '../lib/coreNeedsService'
```

With:

```js
import { loadContacts, addContact, detectPeopleFromText } from '../lib/contactsService'
```

Change `HomePage` props so it can wait for shared bootstrap status:

```js
export default function HomePage({ defaultUserDataStatus = 'idle', ...props }) {
```

And replace the effect body with:

```js
  useEffect(() => {
    if (!user) return
    if (defaultUserDataStatus !== 'ready') return
    async function init() {
      const list = await loadContacts()
      setContacts(list)
    }
    init().catch(console.error)
  }, [user, defaultUserDataStatus])
```

Reason: this prevents the “first read saw empty contacts because bootstrap had not finished yet” race on the write page too, not only in Settings.

- [ ] **Step 3: Remove RecordDetail category auto-insert**

In `src/components/RecordDetail.jsx`, replace the `if ((data ?? []).length === 0) { ...insert defaults... }` block with:

```js
      const userOptionLabels = (data ?? []).map(r => r.option_value)
      const orphans = (entry.category_tags ?? []).filter(t => !userOptionLabels.includes(t))
      setCategoryOptions([...userOptionLabels, ...orphans])
```

Important: **no insert** in this effect anymore.

- [ ] **Step 4: Remove extraction-path category auto-insert**

In `src/lib/entryExtractionService.js`, replace `getUserCategoryTags()` with:

```js
async function getUserCategoryTags(userId) {
  const { data } = await db.from('user_options')
    .select('option_value, sort_order')
    .eq('user_id', userId)
    .eq('field_name', 'content_category')
    .order('sort_order', { ascending: true })

  return (data ?? []).map((row) => row.option_value)
}
```

Delete the `DEFAULT_CATEGORY_TAGS` constant from this file; defaults now live only in `defaultUserData.js`.

- [ ] **Step 5: Remove obsolete page-level seed exports if they are no longer used**

If `seedDefaultContacts()` and `seedDefaultCoreNeeds()` have no call sites after Step 2, remove them from:

`src/lib/contactsService.js`

```js
// delete this export entirely once no imports remain
export async function seedDefaultContacts() { ... }
```

`src/lib/coreNeedsService.js`

```js
// delete this export entirely once no imports remain
export async function seedDefaultCoreNeeds() { ... }
```

The services should become pure CRUD/read helpers; app startup bootstrap owns initialization.

- [ ] **Step 6: Add a small inline loading hint in Settings people management using shared bootstrap status**

Change `SettingsPage` props first:

```js
export default function SettingsPage({ defaultUserDataStatus = 'idle' }) {
```

Keep `loadContactsData()` focused only on reading contacts; do not let it guess bootstrap completion:

```js
  async function loadContactsData() {
    const data = await loadContacts()
    setContacts(data)
  }
```

Replace the current people-entry click handler:

```jsx
onClick={() => { loadContactsData(); setShowPeoplePage(true) }}
```

With:

```jsx
onClick={() => { setShowPeoplePage(true) }}
```

Then add a `useEffect` dedicated to the people subpage:

```js
  useEffect(() => {
    if (!showPeoplePage) return
    if (defaultUserDataStatus !== 'ready') return
    loadContactsData().catch(console.error)
  }, [showPeoplePage, defaultUserDataStatus])
```

Keep UX intentionally minimal:

- Do **not** block the whole Settings page with a spinner.
- Do **not** add a retry button in this batch.
- Do **not** show an “estimated X minutes” message.
- Only show this inline hint near the People entry and in the People subpage empty/loading area:

```jsx
<p className="text-xs text-gray-400 mt-0.5">正在准备联系人词库...</p>
```

Recommended rendering rule:

- People entry description:
  - `defaultUserDataStatus === 'loading'` → show `正在准备联系人词库...`
  - otherwise → show the normal helper text
- People subpage body:
  - `defaultUserDataStatus === 'loading' && contacts.length === 0` → show only the small hint block
  - `defaultUserDataStatus === 'ready'` → render the normal contacts list

This is more accurate than a local `contactsReady` flag because bootstrap is owned by `MainLayout`, not by `SettingsPage`.

- [ ] **Step 7: Document accepted secondary-page boundary**

Add one short comment in the implementation notes / nearby code comments for this batch:

```js
// 本批只对 HomePage / SettingsPage 加 bootstrap gate。
// RecordsPage / ThreadDetailPage / RecordDetail 保持现状，接受极早导航时的短暂空选项读取。
```

Do not add new loading gates to those secondary pages in this batch unless real verification shows a user-visible bug.

- [ ] **Step 8: Run full automated verification**

Run:

```bash
node --test src/lib/defaultUserData.test.js src/lib/storage.test.js src/lib/defaultUserBootstrap.test.js
npm run build
```

Expected:

```text
all tests pass
vite build exits 0
```

- [ ] **Step 9: Run the app for manual verification**

Run:

```bash
npm run dev
```

Manual checklist:

1. Brand-new user signup/login:
   - Signup no longer 500s.
   - First login shows default contacts / default core needs / default category tags.
   - If contacts are not ready yet, Settings only shows the small inline hint `正在准备联系人词库...`; the whole page does not become blank.
   - In the transition window where old DB signup logic still writes only categories, app bootstrap still backfills missing contacts + core_needs on first login.
   - Re-login on the same account from another browser/device does not create duplicated default contacts.
2. Existing user with edited defaults:
   - Add or rename a category.
   - Refresh page.
   - Edited data remains exactly as user changed it.
3. Existing user deletes all categories:
   - Delete all `content_category` rows from UI.
   - Refresh page.
   - Category list stays empty; app does **not** add defaults back.
4. Record detail:
   - Open a record with old orphan category tags.
   - Sheet shows current user options plus orphan tags for cleanup.
5. AI extraction:
   - Run manual extraction once.
   - Extraction works even when user category list is empty; no silent default insert happens.
6. Secondary-page accepted boundary:
   - `RecordsPage` / `ThreadDetailPage` / `RecordDetail` do not get new bootstrap loading gates in this batch.
   - If no concrete user-visible bug appears in verification, keep that scope boundary unchanged.

- [ ] **Step 10: Update architecture docs**

Append to `docs/arch-context.md`:

```md
### 2.x 默认用户数据初始化（代码真源）

默认 content_category / core_need / user_contacts 只在代码里维护一份真源：
- `src/lib/defaultUserData.js`

初始化规则：
- brand-new user：首次启动 bootstrap 写入默认数据一次
- legacy user：只写 seed marker，不补默认值
- 用户后续删除或改名后，版本更新不得自动补回

禁止：
- 不再用“count === 0”判断新用户并自动 reseed
- 不再在页面或提取链路里偷偷插默认数据
```

And append to `docs/arch-context.md` §6 log:

```md
- 2026-04-30 · 代码session · 默认用户数据收口方案：新增 `defaultUserData.js` 作为 code source；启动期 `ensureDefaultUserData()` 只对真正 brand-new user seed，一次写入后由 seed marker 锁定；legacy user 仅标记不补默认；删除 HomePage / RecordDetail / entryExtractionService 的 opportunistic reseed。
```

- [ ] **Step 11: Final commit only after user says manual verification is OK**

Run:

```bash
git add src/lib/defaultUserData.js src/lib/defaultUserData.test.js src/lib/defaultUserBootstrap.js src/lib/defaultUserBootstrap.test.js src/lib/storage.js src/lib/storage.test.js src/components/MainLayout.jsx src/pages/HomePage.jsx src/components/RecordDetail.jsx src/lib/entryExtractionService.js src/lib/contactsService.js src/lib/coreNeedsService.js docs/supabase-manual-sql.md docs/arch-context.md
git commit -m "refactor: centralize default user data bootstrap"
```

Only do this after:
- `npm run build` passed
- `npm run dev` manual checklist completed
- user explicitly replied “没问题”

---

### Task 5: Retire the Old DB-Side Category Seeder After Bootstrap Is Verified

**Files:**
- Modify: `docs/supabase-manual-sql.md`
- Verify in Supabase SQL Editor

- [ ] **Step 1: Confirm app-level bootstrap is already merged and manually verified**

Do not touch the DB function until all of the following are true:

- Startup bootstrap seeds brand-new users correctly
- Existing users are not reseeded
- Deleting all categories no longer causes silent refill
- `npm run build` passed
- manual verification passed

- [ ] **Step 2: Replace `insert_default_options` with a no-op in Supabase SQL Editor**

Paste into Supabase SQL Editor:

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

Expected: SQL runs successfully with no error.

- [ ] **Step 3: Re-test brand-new user signup after retiring the old DB seeder**

Run:

```bash
node - <<'NODE'
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1)]
    })
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const email = `plan-post-bootstrap-${Date.now()}@example.com`

;(async () => {
  const { error } = await supabase.auth.signUp({ email, password: 'test1234' })
  console.log(error?.message ?? 'OK')
})()
NODE
```

Expected:

```text
OK
```

And the first login of that new user still shows default categories / core needs / contacts via app bootstrap.

- [ ] **Step 4: Record the retirement step in `docs/supabase-manual-sql.md`**

Add:

```md
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
```

---

### Task 6: Record Follow-Up Direction For APK Local-First / Offline Phase

**Files:**
- Modify: `docs/sync-cards/2026-04-27-apk-packaging-todo.md`
- Optional reference: `docs/architecture-forward-notes.md`

- [ ] **Step 1: Append a new section to the APK/local-storage TODO sync card**

Append to `docs/sync-cards/2026-04-27-apk-packaging-todo.md`:

```md
## 追加提示：默认用户数据初始化在 APK / 本地优先阶段的收口方向

如果后续开始做 Capacitor APK + 本地存储 / 离线写日记，这次默认数据 bootstrap 不直接推翻，但要按下面方向升级：

1. **初始化落点前移到本地数据库**
   - 现在：默认分类 / core_need / 联系人主要围绕 Supabase + Web localStorage
   - 以后：brand-new user 的默认数据应先写入本地数据库（如 SQLite），保证离线首开也能完整可用

2. **App 启动先读本地，再考虑云端**
   - 页面层继续只读统一 service / repository
   - 不让页面直接判断“现在该从 Supabase 还是本地拿默认数据”

3. **“是否已初始化”状态不能只放 Web localStorage**
   - Web 阶段用 localStorage marker 是过渡方案
   - 本地优先阶段应改成本地数据库中的持久字段，必要时再与云端用户状态对齐
   - 目标不是继续加强 localStorage，而是后续直接移出 localStorage，迁到正式持久层

4. **同步语义要和默认数据一起定义**
   - 新设备首次同步时，不能因为云端 / 本地都为空就重复塞两份默认值
   - 要提前定义：默认数据是“设备级初始化”，还是“账号级初始化”

5. **Settings 页局部 loading 文案可以保留**
   - `正在准备联系人词库...` 这种局部提示在 APK 阶段仍可复用
   - 但来源会从“等待 Web bootstrap 读完”变成“等待本地词库初始化 / 恢复完成”
```

- [ ] **Step 2: Add one sentence linking this batch to the future APK work**

Also append one short closing line to that same sync card:

```md
补充结论：默认用户数据这次先完成“Web 阶段单一真源 + 非偷偷回填”；等进入 APK / 本地优先批次，再把初始化真相源从 localStorage 过渡到本地数据库 / 同步层。
```

- [ ] **Step 3: Final self-check for scope discipline**

Before executing, confirm the plan still obeys these boundaries:

- No “恢复推荐默认项” button is added
- No retry button is added for contacts loading
- No full-page blank loading state is introduced for Settings
- APK/local-first notes stay in docs only; this batch does not implement local DB yet

---

## Self-Review Checklist

- Spec coverage:
  - Current signup 500 compatibility: Task 0
  - Parallel first-login uniqueness hardening: Task 0.5
  - Single code source: Task 1
  - One-time seed marker: Task 2
  - New user only / legacy no-reseed: Task 3
  - Remove count-based fallback from UI/extraction paths: Task 4
  - Retire old DB-side seeder after bootstrap lands: Task 5
  - Record future APK/local-first adjustment direction: Task 6
- No placeholders:
  - All new file paths, commands, and code snippets are explicit.
- Type consistency:
  - Seed helper names consistently use `DefaultUserData`.
  - Version helper names consistently use `getDefaultUserDataSeedVersion` / `saveDefaultUserDataSeedVersion`.

## Notes for the Implementer

- This plan deliberately chooses **“new users get defaults once; old users never get future defaults automatically.”**
- Do not sneak in a `v2` migration that backfills missing categories for existing users.
- This batch deliberately does **not** add a “恢复推荐默认项” button.
- If future product requirements need “recommended defaults” again, build that as a separate explicit user action, not an automatic seed.
- Remaining accepted edge case: if a zero-entry user manually empties all three default collections and then loses browser storage before a new marker is written, Web-phase bootstrap may treat them as brand-new again. This is documented for future APK/local-first cleanup, not expanded in this batch.

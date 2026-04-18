# people_involved + core_needs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立用户人物联系人库（user_contacts）和 core_needs 固定词库，支持 @ 输入识别人物、AI 提取匹配词库、未匹配项持久提醒，并在 RecordDetail 和设置页提供完整编辑能力。

**Architecture:** contactsService.js 和 coreNeedsService.js 分别封装两个子系统的数据访问；HomePage 加载联系人到内存、监听 @ 字符触发浮层；pending_core_needs 持久化未匹配项，RecordsPage 查询 count 决定是否显示 banner。

**Tech Stack:** React hooks, Supabase JS (db.from, db.rpc), 复用现有 keywordDetection.detectPeople 逻辑

---

## 文件清单

| 文件 | 操作 | 职责 |
|---|---|---|
| `src/lib/contactsService.js` | 新建 | user_contacts CRUD + 新用户 seed + detectPeople（内存版） |
| `src/lib/coreNeedsService.js` | 新建 | core_needs vocab CRUD + 新用户 seed + pending_core_needs 管理 |
| `src/pages/PeopleManagementPage.jsx` | 新建 | 「我的」人物管理子页（列表/编辑/删除） |
| `src/pages/CoreNeedsVocabPage.jsx` | 新建 | 「我的」core_needs 词库子页（chip 展示/编辑/删除） |
| `src/pages/HomePage.jsx` | 修改 | 加载联系人到内存，@ 触发浮层，底部 chip 区 |
| `src/components/RecordDetail.jsx` | 修改 | 新增 people_involved + core_needs 字段行（展示+编辑） |
| `src/pages/RecordsPage.jsx` | 修改 | A3 橙色 banner（查询 pending_core_needs count） |
| `src/pages/SettingsPage.jsx` | 修改 | 新增「人物管理」「内心需求词库」入口 |
| `src/lib/conversationService.js` | 修改 | core_needs 提取时传入词库，返回 unmatched 写 pending |
| `src/lib/extractSummaryService.js` | 修改 | 批量补提取扩展 + maxTokens 800→1200 |

---

### Task 0：Supabase DB 建表 + RPC 函数

**Files:**
- Document: `docs/supabase-manual-sql.md`（追加函数记录）

- [ ] **Step 1：在 Supabase SQL Editor 执行建表 SQL**

在 Supabase 控制台 → SQL Editor，粘贴并执行：

```sql
-- user_contacts：人物联系人库
CREATE TABLE user_contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical  text NOT NULL,
  aliases    text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_contacts_own" ON user_contacts
  FOR ALL USING (user_id = auth.uid());

-- pending_core_needs：未匹配 core_need 待处理队列
CREATE TABLE pending_core_needs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_id   uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  proposed   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pending_core_needs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pending_core_needs_own" ON pending_core_needs
  FOR ALL USING (user_id = auth.uid());
```

预期：执行成功，无报错。

- [ ] **Step 2：在 Supabase SQL Editor 执行三个 RPC 函数**

```sql
-- replace_person_name：批量替换历史 people_involved
CREATE OR REPLACE FUNCTION replace_person_name(p_old TEXT, p_new TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE journal_entries
  SET people_involved = array_replace(people_involved, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(people_involved);
$$;

-- replace_core_need：批量替换历史 core_needs
CREATE OR REPLACE FUNCTION replace_core_need(p_old TEXT, p_new TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE journal_entries
  SET core_needs = array_replace(core_needs, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(core_needs);
$$;
```

预期：执行成功，无报错。

- [ ] **Step 3：追加到 `docs/supabase-manual-sql.md`**

在「函数列表」末尾追加：

```markdown
### 2. replace_person_name
**创建时间：** 2026-04-18
**用途：** 人物规范名称改名时，批量替换所有历史 journal_entries 里的旧名称为新名称
**调用方：** `src/pages/PeopleManagementPage.jsx` → 编辑保存时

```sql
CREATE OR REPLACE FUNCTION replace_person_name(p_old TEXT, p_new TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE journal_entries
  SET people_involved = array_replace(people_involved, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(people_involved);
$$;
```

**安全说明：** 函数内用 auth.uid() 限定用户，不接受 user_id 参数。

---

### 3. replace_core_need
**创建时间：** 2026-04-18
**用途：** core_needs 词条改措辞时，批量替换所有历史 journal_entries 里的旧词为新词
**调用方：** `src/pages/CoreNeedsVocabPage.jsx` → 编辑保存时

```sql
CREATE OR REPLACE FUNCTION replace_core_need(p_old TEXT, p_new TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE journal_entries
  SET core_needs = array_replace(core_needs, p_old, p_new)
  WHERE user_id = auth.uid() AND p_old = ANY(core_needs);
$$;
```

**安全说明：** 函数内用 auth.uid() 限定用户，不接受 user_id 参数。
```

- [ ] **Step 4：构建检查（确认无代码报错）**

```bash
npm run build
```

预期：无报错（此 Task 只改文档和数据库，不改代码）。

---

### Task 1：新建 contactsService.js + coreNeedsService.js

**Files:**
- Create: `src/lib/contactsService.js`
- Create: `src/lib/coreNeedsService.js`

#### contactsService.js

- [ ] **Step 1：新建 `src/lib/contactsService.js`**

```js
import { db } from './db'

// 默认联系人数据（来自原 keywordDetection.js PEOPLE_KEYWORD_MAP）
const DEFAULT_CONTACTS = [
  { canonical: '妈妈', aliases: ['妈妈', '母亲', '老妈', '阿妈'] },
  { canonical: '爸爸', aliases: ['爸爸', '父亲', '老爸', '阿爸'] },
  { canonical: '奶奶', aliases: ['奶奶', '祖母'] },
  { canonical: '爷爷', aliases: ['爷爷', '祖父'] },
  { canonical: '外婆', aliases: ['外婆', '姥姥', '外祖母'] },
  { canonical: '外公', aliases: ['外公', '姥爷', '外祖父'] },
  { canonical: '哥哥', aliases: ['哥哥', '大哥', '兄长'] },
  { canonical: '弟弟', aliases: ['弟弟', '小弟'] },
  { canonical: '姐姐', aliases: ['姐姐', '大姐'] },
  { canonical: '妹妹', aliases: ['妹妹', '小妹'] },
  { canonical: '男友', aliases: ['男友', '男朋友', '男盆友'] },
  { canonical: '女友', aliases: ['女友', '女朋友', '女盆友'] },
  { canonical: '老公', aliases: ['老公', '丈夫', '先生'] },
  { canonical: '老婆', aliases: ['老婆', '妻子', '太太'] },
  { canonical: '婆婆', aliases: ['婆婆'] },
  { canonical: '老板', aliases: ['老板', '上司', '领导'] },
  { canonical: '同事', aliases: ['同事'] },
  { canonical: '客户', aliases: ['客户', '甲方'] },
  { canonical: '朋友', aliases: ['朋友', '好友', '好朋友'] },
  { canonical: '闺蜜', aliases: ['闺蜜', '死党'] },
  { canonical: '同学', aliases: ['同学'] },
  { canonical: '室友', aliases: ['室友'] },
]

// 读取当前用户全部联系人（进页面时一次性加载到内存）
export async function loadContacts() {
  const { data, error } = await db
    .from('user_contacts')
    .select('id, canonical, aliases, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data
}

// 新用户首次登录时 seed 默认联系人（若 user_contacts 为空）
export async function seedDefaultContacts() {
  const { count, error: countErr } = await db
    .from('user_contacts')
    .select('id', { count: 'exact', head: true })
  if (countErr) throw countErr
  if (count > 0) return  // 已有数据，跳过

  const rows = DEFAULT_CONTACTS.map((c, i) => ({
    canonical: c.canonical,
    aliases: c.aliases,
    sort_order: i,
  }))
  const { error } = await db.from('user_contacts').insert(rows)
  if (error) throw error
}

// 新增联系人
export async function addContact(canonical, aliases = []) {
  const { data, error } = await db
    .from('user_contacts')
    .insert({ canonical, aliases })
    .select()
    .single()
  if (error) throw error
  return data
}

// 更新联系人（canonical 改名时级联替换历史）
export async function updateContact(id, canonical, aliases) {
  // 先取旧 canonical 用于 RPC 级联替换
  const { data: old, error: fetchErr } = await db
    .from('user_contacts')
    .select('canonical')
    .eq('id', id)
    .single()
  if (fetchErr) throw fetchErr

  if (old.canonical !== canonical) {
    const { error: rpcErr } = await db.rpc('replace_person_name', {
      p_old: old.canonical,
      p_new: canonical,
    })
    if (rpcErr) throw rpcErr
  }

  const { error } = await db
    .from('user_contacts')
    .update({ canonical, aliases })
    .eq('id', id)
  if (error) throw error
}

// 删除联系人（历史 journal_entries.people_involved 保留旧值不改）
export async function deleteContact(id) {
  const { error } = await db.from('user_contacts').delete().eq('id', id)
  if (error) throw error
}

// 用内存中的联系人列表检测文本里的人物（不查 DB）
// contacts: loadContacts() 返回的数组
export function detectPeopleFromText(text, contacts) {
  if (!text || !contacts?.length) return []
  const matched = []
  for (const contact of contacts) {
    const allKeywords = [contact.canonical, ...(contact.aliases || [])]
    if (allKeywords.some(kw => text.includes(kw))) {
      matched.push(contact.canonical)
    }
  }
  return [...new Set(matched)]
}
```

- [ ] **Step 2：构建检查**

```bash
npm run build
```

预期：无报错。

---

#### coreNeedsService.js

- [ ] **Step 3：新建 `src/lib/coreNeedsService.js`**

```js
import { db } from './db'

const DEFAULT_CORE_NEEDS = [
  '被理解', '被看见', '被接纳', '被爱', '被需要',
  '被认可', '被信任', '安全感', '掌控感', '归属感',
  '独立自主', '公平', '边界被尊重', '被支持', '休息',
  '成就感', '意义感', '自我表达', '连接感', '被倾听',
]

// 读取用户 core_needs 词库
export async function loadCoreNeeds() {
  const { data, error } = await db
    .from('user_options')
    .select('id, option_value, sort_order')
    .eq('field_name', 'core_need')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data
}

// 新用户 seed 默认词库（若 field_name='core_need' 记录为空）
export async function seedDefaultCoreNeeds() {
  const { count, error: countErr } = await db
    .from('user_options')
    .select('id', { count: 'exact', head: true })
    .eq('field_name', 'core_need')
  if (countErr) throw countErr
  if (count > 0) return

  const rows = DEFAULT_CORE_NEEDS.map((v, i) => ({
    field_name: 'core_need',
    option_value: v,
    sort_order: i,
  }))
  const { error } = await db.from('user_options').insert(rows)
  if (error) throw error
}

// 新增词条
export async function addCoreNeed(option_value) {
  const { data, error } = await db
    .from('user_options')
    .insert({ field_name: 'core_need', option_value })
    .select()
    .single()
  if (error) throw error
  return data
}

// 编辑词条（级联替换历史）
export async function updateCoreNeed(id, newValue) {
  const { data: old, error: fetchErr } = await db
    .from('user_options')
    .select('option_value')
    .eq('id', id)
    .single()
  if (fetchErr) throw fetchErr

  if (old.option_value !== newValue) {
    const { error: rpcErr } = await db.rpc('replace_core_need', {
      p_old: old.option_value,
      p_new: newValue,
    })
    if (rpcErr) throw rpcErr
  }

  const { error } = await db
    .from('user_options')
    .update({ option_value: newValue })
    .eq('id', id)
  if (error) throw error
}

// 删除词条（历史 journal_entries.core_needs 保留旧值不改）
export async function deleteCoreNeed(id) {
  const { error } = await db.from('user_options').delete().eq('id', id)
  if (error) throw error
}

// ─── pending_core_needs 管理 ────────────────────────────────────

// 查询未处理 pending 数量（用于 RecordsPage banner）
export async function getPendingCoreNeedsCount() {
  const { count, error } = await db
    .from('pending_core_needs')
    .select('id', { count: 'exact', head: true })
  if (error) throw error
  return count
}

// 查询全部 pending 项（用于处理弹卡片）
export async function getPendingCoreNeeds() {
  const { data, error } = await db
    .from('pending_core_needs')
    .select(`
      id, proposed, created_at,
      entry_id,
      journal_entries (id, content, created_at)
    `)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

// 写入一条 pending（conversationService 和 extractSummaryService 调用）
export async function createPendingCoreNeed(entry_id, proposed) {
  const { error } = await db
    .from('pending_core_needs')
    .insert({ entry_id, proposed })
  if (error) throw error
}

// 删除一条 pending（用户处理完后调用）
export async function deletePendingCoreNeed(id) {
  const { error } = await db.from('pending_core_needs').delete().eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 4：构建检查**

```bash
npm run build
```

预期：无报错。

- [ ] **Step 5：提交**

```bash
git add src/lib/contactsService.js src/lib/coreNeedsService.js
git commit -m "feat: add contactsService and coreNeedsService"
```

---

### Task 2：HomePage —— 加载联系人、@ 浮层、底部 chip 区

**Files:**
- Modify: `src/pages/HomePage.jsx`

- [ ] **Step 1：添加 import 和联系人状态**

在 [HomePage.jsx:18-24](src/pages/HomePage.jsx#L18-L24) 的 import 区域末尾追加：

```js
import { loadContacts, seedDefaultContacts, addContact, detectPeopleFromText } from '../lib/contactsService'
import { seedDefaultCoreNeeds } from '../lib/coreNeedsService'
```

在 `export default function HomePage` 函数体内、现有 state 声明区域（`saving` state 之后），追加：

```js
// ── 联系人（进页面时一次性加载到内存）─────────────────────────
const [contacts, setContacts] = useState([])
// @ 浮层
const [mentionQuery, setMentionQuery] = useState(null)  // null = 关闭，字符串 = 搜索词
const [mentionAnchor, setMentionAnchor] = useState(0)   // @ 字符在文本中的位置
// 底部 chip：已选人物的 canonical 数组
const [selectedPeople, setSelectedPeople] = useState(
  editEntry?.people_involved ?? []
)
```

- [ ] **Step 2：加载联系人 + seed（useEffect）**

在 `// ── 草稿检查` useEffect 之前插入：

```js
// ── 加载联系人（seed 一次，然后读取）──────────────────────────
useEffect(() => {
  if (!user) return
  async function init() {
    await seedDefaultContacts()
    await seedDefaultCoreNeeds()
    const list = await loadContacts()
    setContacts(list)
  }
  init().catch(console.error)
}, [user])
```

- [ ] **Step 3：监听 @ 字符，处理 onChange**

找到当前 textarea 的 `onChange` 处理（现在直接 `setContent(e.target.value)`）。
将其替换为：

```js
const handleContentChange = (e) => {
  const val = e.target.value
  setContent(val)

  // 检测 @ 触发：找光标前最近一个 @，且 @ 后无空格
  const cursor = e.target.selectionStart
  const before = val.slice(0, cursor)
  const atIdx = before.lastIndexOf('@')
  if (atIdx !== -1) {
    const afterAt = before.slice(atIdx + 1)
    if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
      setMentionQuery(afterAt)
      setMentionAnchor(atIdx)
      return
    }
  }
  setMentionQuery(null)
}
```

将 textarea 的 `onChange={e => setContent(e.target.value)}` 改为 `onChange={handleContentChange}`。

同时，在 textarea 上添加 `onKeyDown`：

```js
onKeyDown={(e) => {
  if (e.key === 'Escape') setMentionQuery(null)
}}
```

- [ ] **Step 4：@ 选人逻辑**

在 `handleDone` 函数之前，插入：

```js
// ── @ 选人 ────────────────────────────────────────────────────
const handleMentionSelect = async (contact) => {
  // 把 @<query> 替换为 alias 原文（去掉 @，文字保留）
  const before = content.slice(0, mentionAnchor)   // @ 之前
  const after = content.slice(mentionAnchor)         // @ 开始往后
  // 去掉 @ 及其后的搜索词（保留用户打的字作为普通文字）
  const query = mentionQuery
  const afterCleaned = after.replace('@' + query, query)
  setContent(before + afterCleaned)
  setMentionQuery(null)

  // 底部 chip 追加（去重）
  const canonical = contact.canonical
  setSelectedPeople(prev =>
    prev.includes(canonical) ? prev : [...prev, canonical]
  )
}

const handleMentionAddNew = async (name) => {
  if (!name.trim()) return
  const newContact = await addContact(name.trim())
  setContacts(prev => [...prev, newContact])
  setMentionQuery(null)
  setSelectedPeople(prev =>
    prev.includes(name.trim()) ? prev : [...prev, name.trim()]
  )
}
```

- [ ] **Step 5：保存时合并 detectPeople 结果**

找到 `handleDone` 里的 `insertEntry` 调用（编辑模式之后的 else 分支），在 `insertEntry` 的 fields 参数里追加 `people_involved`：

```js
// 在 handleDone 的新建分支，计算 people_involved
const detectedPeople = detectPeopleFromText(trimmed, contacts)
const allPeople = [...new Set([...selectedPeople, ...detectedPeople])]
```

然后在 `insertEntry` 的 fields 参数内加上：

```js
people_involved: allPeople,
```

编辑模式的 `updateEntry` fields 同样追加：

```js
people_involved: allPeople,
```

（在编辑模式 fields 对象里用同一个 `allPeople` 变量，需把上面两行移到 `isEditMode` 判断之前）

- [ ] **Step 6：渲染 @ 浮层**

在 return JSX 的 textarea 元素外层包裹一个相对定位容器，并在 textarea 后（容器内）插入浮层：

```jsx
{/* @ 浮层 */}
{mentionQuery !== null && (() => {
  const filtered = contacts.filter(c => {
    const q = mentionQuery.toLowerCase()
    return (
      c.canonical.toLowerCase().includes(q) ||
      (c.aliases || []).some(a => a.toLowerCase().includes(q))
    )
  })
  return (
    <div style={{
      position: 'absolute',
      left: 0, right: 0,
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      zIndex: 50,
      maxHeight: 200,
      overflowY: 'auto',
    }}>
      {filtered.map(c => (
        <div
          key={c.id}
          onClick={() => handleMentionSelect(c)}
          style={{
            padding: '10px 16px',
            cursor: 'pointer',
            fontSize: 15,
            borderBottom: '1px solid #f3f4f6',
          }}
        >
          <span style={{ fontWeight: 600 }}>{c.canonical}</span>
          {c.aliases?.length > 0 && (
            <span style={{ color: '#9ca3af', fontSize: 13, marginLeft: 8 }}>
              别名：{c.aliases.join(' · ')}
            </span>
          )}
        </div>
      ))}
      {mentionQuery.trim() && (
        <div
          onClick={() => handleMentionAddNew(mentionQuery)}
          style={{
            padding: '10px 16px',
            cursor: 'pointer',
            fontSize: 15,
            color: '#6366f1',
          }}
        >
          ＋ 新增「{mentionQuery}」为新人物
        </div>
      )}
    </div>
  )
})()}
```

- [ ] **Step 7：渲染底部 chip 区**

在底部浮动栏（「✦ 深入觉察」+ ✓ 按钮）的**上方**插入 chip 区：

```jsx
{/* 涉及的人 chip 区 */}
<div style={{
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  padding: '8px 16px',
  minHeight: 40,
  background: '#fafafa',
  borderTop: '1px solid #f0f0f0',
}}>
  <span style={{ fontSize: 13, color: '#9ca3af', flexShrink: 0 }}>涉及的人</span>
  {selectedPeople.map(name => (
    <span key={name} style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 10px',
      background: '#e8f0f5',
      color: '#5a7a8a',
      borderRadius: 99,
      fontSize: 13,
    }}>
      {name}
      <button
        onClick={() => setSelectedPeople(prev => prev.filter(p => p !== name))}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: '#5a7a8a' }}
      >✕</button>
    </span>
  ))}
  <button
    onClick={() => setMentionQuery('')}
    style={{
      background: 'none',
      border: '1px dashed #cbd5e1',
      borderRadius: 99,
      padding: '2px 10px',
      fontSize: 13,
      color: '#94a3b8',
      cursor: 'pointer',
    }}
  >＋</button>
</div>
```

- [ ] **Step 8：构建检查**

```bash
npm run build
```

预期：无报错。

- [ ] **Step 9：本地验证（需手动操作）**

1. 进入首页，查看底部有「涉及的人」chip 区（空时只有「＋」按钮）
2. 输入 `@宝` → 浮层出现「男友（别名：宝宝...）」
3. 点击男友 → 文本变为「宝」（无 @），底部 chip 出现「男友 ✕」
4. 点「＋」→ 浮层弹出（mentionQuery = ''，显示全部联系人）
5. 点 chip 上的 ✕ → chip 消失
6. 点「✓」完成 → 保存后在记录详情能看到 people_involved 有值

- [ ] **Step 10：提交（用户确认验证通过后）**

```bash
git add src/pages/HomePage.jsx
git commit -m "feat: HomePage @mention overlay + people chip bar"
```

---

### Task 3：RecordDetail —— people_involved + core_needs 字段行

**Files:**
- Modify: `src/components/RecordDetail.jsx`

- [ ] **Step 1：添加 import + 新增 state**

在 [RecordDetail.jsx:4-10](src/components/RecordDetail.jsx#L4-L10) 的 import 区域末尾追加：

```js
import { loadContacts, addContact } from '../lib/contactsService'
import { loadCoreNeeds, addCoreNeed } from '../lib/coreNeedsService'
```

在 `export default function RecordDetail` 函数体内、现有 state 声明区域（`showCategorySheet` 之后）追加：

```js
// people_involved 浮层
const [contacts, setContacts] = useState([])
const [showPeopleSheet, setShowPeopleSheet] = useState(false)
const [peopleSearch, setPeopleSearch] = useState('')
const [newPersonName, setNewPersonName] = useState('')

// core_needs 浮层
const [coreNeeds, setCoreNeeds] = useState([])
const [showNeedsSheet, setShowNeedsSheet] = useState(false)
const [needsSearch, setNeedsSearch] = useState('')
```

- [ ] **Step 2：加载联系人和词库（useEffect）**

在现有的 `loadCategoryOptions` useEffect 之后，插入：

```js
// 加载联系人列表（RecordDetail 编辑时用）
useEffect(() => {
  loadContacts().then(setContacts).catch(console.error)
}, [])

// 加载 core_needs 词库
useEffect(() => {
  loadCoreNeeds().then(setCoreNeeds).catch(console.error)
}, [])
```

- [ ] **Step 3：people_involved 操作函数**

在 `handleCoreNeedsSave` 函数之前插入：

```js
// ── people_involved 增删 ──────────────────────────────────────
async function handlePersonRemove(name) {
  const updated = (entry.people_involved ?? []).filter(p => p !== name)
  setEntry(e => ({ ...e, people_involved: updated }))
  await handleFieldSave('people_involved', updated)
}

async function handlePersonAdd(canonical) {
  if ((entry.people_involved ?? []).includes(canonical)) {
    setShowPeopleSheet(false)
    return
  }
  const updated = [...(entry.people_involved ?? []), canonical]
  setEntry(e => ({ ...e, people_involved: updated }))
  await handleFieldSave('people_involved', updated)
  setShowPeopleSheet(false)
  setPeopleSearch('')
}

async function handlePersonAddNew(name) {
  if (!name.trim()) return
  const newContact = await addContact(name.trim())
  setContacts(prev => [...prev, newContact])
  await handlePersonAdd(name.trim())
  setNewPersonName('')
}

// ── core_needs 增删 ───────────────────────────────────────────
async function handleNeedRemove(word) {
  const updated = (entry.core_needs ?? []).filter(n => n !== word)
  setEntry(e => ({ ...e, core_needs: updated }))
  await handleFieldSave('core_needs', updated)
}

async function handleNeedAdd(word) {
  if ((entry.core_needs ?? []).includes(word)) {
    setShowNeedsSheet(false)
    return
  }
  const updated = [...(entry.core_needs ?? []), word]
  setEntry(e => ({ ...e, core_needs: updated }))
  await handleFieldSave('core_needs', updated)
  setShowNeedsSheet(false)
  setNeedsSearch('')
}
```

- [ ] **Step 4：在 JSX 中插入「涉及的人」行**

找到 RecordDetail 的 JSX 渲染区域里情绪字段行（`editingEmotions` 相关的那一块）结束后，插入「涉及的人」字段行（位置：情绪之后、原有 core_needs 行之前）：

```jsx
{/* 涉及的人 */}
<div style={{ display: 'flex', gap: 12, paddingBottom: 6, alignItems: 'flex-start' }}>
  <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0, minWidth: 44, paddingTop: 6 }}>
    涉及的人
  </span>
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 }}>
    {(entry.people_involved ?? []).map(name => (
      <span key={name} style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', background: '#e8f0f5', color: '#5a7a8a',
        borderRadius: 99, fontSize: 13,
      }}>
        {name}
        <button onClick={() => handlePersonRemove(name)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#5a7a8a', lineHeight: 1 }}>
          ✕
        </button>
      </span>
    ))}
    <button onClick={() => { setShowPeopleSheet(true); setPeopleSearch('') }}
      style={{
        background: 'none', border: '1px dashed #cbd5e1', borderRadius: 99,
        padding: '2px 10px', fontSize: 13, color: '#94a3b8', cursor: 'pointer',
      }}>
      ＋
    </button>
  </div>
</div>

{/* 人物选择浮层 */}
{showPeopleSheet && (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
    zIndex: 100, display: 'flex', alignItems: 'flex-end',
  }} onClick={() => setShowPeopleSheet(false)}>
    <div style={{
      width: '100%', background: '#fff', borderRadius: '16px 16px 0 0',
      padding: 16, maxHeight: '60vh', overflowY: 'auto',
    }} onClick={e => e.stopPropagation()}>
      <input
        placeholder="搜索或输入新人物"
        value={peopleSearch}
        onChange={e => { setPeopleSearch(e.target.value); setNewPersonName(e.target.value) }}
        style={{
          width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb',
          borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: 'border-box',
        }}
        autoFocus
      />
      {contacts
        .filter(c => {
          const q = peopleSearch.toLowerCase()
          return !q || c.canonical.toLowerCase().includes(q) ||
            (c.aliases || []).some(a => a.toLowerCase().includes(q))
        })
        .filter(c => !(entry.people_involved ?? []).includes(c.canonical))
        .map(c => (
          <div key={c.id} onClick={() => handlePersonAdd(c.canonical)}
            style={{ padding: '10px 4px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>{c.canonical}</span>
            {c.aliases?.length > 0 && (
              <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 8 }}>
                {c.aliases.join(' · ')}
              </span>
            )}
          </div>
        ))
      }
      {newPersonName.trim() && (
        <div onClick={() => handlePersonAddNew(newPersonName)}
          style={{ padding: '10px 4px', cursor: 'pointer', fontSize: 14, color: '#6366f1' }}>
          ＋ 新增「{newPersonName}」为新人物
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 5：替换「内心需求」现有显示为 chip 行**

找到现有的 `core_needs` 展示区域（当前用 `EditableFieldRow` 或 `FieldRow` 展示），将其替换为：

```jsx
{/* 内心需求 */}
<div style={{ display: 'flex', gap: 12, paddingBottom: 6, alignItems: 'flex-start' }}>
  <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0, minWidth: 44, paddingTop: 6 }}>
    内心需求
  </span>
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 }}>
    {(entry.core_needs ?? []).map(word => (
      <span key={word} style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', background: '#ede8f5', color: '#7a6a9a',
        borderRadius: 99, fontSize: 13,
      }}>
        {word}
        <button onClick={() => handleNeedRemove(word)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#7a6a9a', lineHeight: 1 }}>
          ✕
        </button>
      </span>
    ))}
    <button onClick={() => { setShowNeedsSheet(true); setNeedsSearch('') }}
      style={{
        background: 'none', border: '1px dashed #c4b5e0', borderRadius: 99,
        padding: '2px 10px', fontSize: 13, color: '#b4a0d0', cursor: 'pointer',
      }}>
      ＋
    </button>
  </div>
</div>

{/* 词库选择浮层 */}
{showNeedsSheet && (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
    zIndex: 100, display: 'flex', alignItems: 'flex-end',
  }} onClick={() => setShowNeedsSheet(false)}>
    <div style={{
      width: '100%', background: '#fff', borderRadius: '16px 16px 0 0',
      padding: 16, maxHeight: '60vh', overflowY: 'auto',
    }} onClick={e => e.stopPropagation()}>
      <input
        placeholder="搜索词条"
        value={needsSearch}
        onChange={e => setNeedsSearch(e.target.value)}
        style={{
          width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb',
          borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: 'border-box',
        }}
        autoFocus
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
        {coreNeeds
          .filter(c => !needsSearch || c.option_value.includes(needsSearch))
          .filter(c => !(entry.core_needs ?? []).includes(c.option_value))
          .map(c => (
            <span key={c.id} onClick={() => handleNeedAdd(c.option_value)}
              style={{
                padding: '5px 14px', background: '#ede8f5', color: '#7a6a9a',
                borderRadius: 99, fontSize: 14, cursor: 'pointer',
              }}>
              {c.option_value}
            </span>
          ))
        }
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6：构建检查**

```bash
npm run build
```

预期：无报错。

- [ ] **Step 7：本地验证（需手动操作）**

1. 进入任意记录详情，情绪行下方有「涉及的人」行（有数据则显示蓝灰 chip，无数据则只有 ＋）
2. 点 ＋ → 底部浮层弹出，显示联系人列表
3. 搜索框输入 → 列表过滤
4. 点一个联系人 → chip 出现，浮层关闭，立即写入 DB
5. 点 chip 上的 ✕ → chip 消失，立即写入 DB
6. 「内心需求」行显示紫色 chip，同样可增删
7. 内心需求 ＋ 浮层显示词库列表（不含已添加的词）

- [ ] **Step 8：提交（用户确认验证通过后）**

```bash
git add src/components/RecordDetail.jsx
git commit -m "feat: RecordDetail people_involved + core_needs chip rows"
```

---

### Task 4：RecordsPage —— 橙色 banner + 处理弹卡片

**Files:**
- Modify: `src/pages/RecordsPage.jsx`

- [ ] **Step 1：添加 import + pending state**

在 [RecordsPage.jsx:3-9](src/pages/RecordsPage.jsx#L3-L9) 的 import 末尾追加：

```js
import {
  getPendingCoreNeedsCount,
  getPendingCoreNeeds,
  deletePendingCoreNeed,
  addCoreNeed,
} from '../lib/coreNeedsService'
import { updateEntry } from '../lib/journalService'
```

在 `export default function RecordsPage` 的 state 声明区（`confirmDelete` 之后）追加：

```js
// pending_core_needs banner + 处理卡片
const [pendingCount, setPendingCount]   = useState(0)
const [showPendingCard, setShowPendingCard] = useState(false)
const [pendingItems, setPendingItems]   = useState([])
const [currentPendingIdx, setCurrentPendingIdx] = useState(0)
const [pendingEditValue, setPendingEditValue]   = useState('')
const [showPendingEdit, setShowPendingEdit]     = useState(false)
const [showMergeList, setShowMergeList]         = useState(false)
const [coreNeedsVocab, setCoreNeedsVocab]       = useState([])
```

- [ ] **Step 2：加载 pending count（在 load 函数里追加）**

找到 `const load = useCallback(async () => {` 函数，在函数体内的 `Promise.all` 调用之后、`setLoading(false)` 之前，追加：

```js
// 查询 pending_core_needs 数量
const count = await getPendingCoreNeedsCount()
setPendingCount(count ?? 0)
```

- [ ] **Step 3：加载词库（供「合并到已有词条」用）**

在 `load` useEffect 之后，插入新的 useEffect：

```js
useEffect(() => {
  if (!user) return
  import('../lib/coreNeedsService').then(m => m.loadCoreNeeds()).then(setCoreNeedsVocab).catch(console.error)
}, [user])
```

- [ ] **Step 4：处理弹卡片 —— 打开函数**

在 `load` 函数之后，插入：

```js
async function handleOpenPendingCard() {
  const items = await getPendingCoreNeeds()
  setPendingItems(items)
  setCurrentPendingIdx(0)
  setPendingEditValue('')
  setShowPendingEdit(false)
  setShowMergeList(false)
  setShowPendingCard(true)
}

// 处理完一条后推进到下一条，或关闭
function advancePending(newItems) {
  if (newItems.length === 0) {
    setShowPendingCard(false)
    setPendingCount(0)
  } else {
    setPendingItems(newItems)
    setCurrentPendingIdx(0)
    setPendingEditValue('')
    setShowPendingEdit(false)
    setShowMergeList(false)
    setPendingCount(newItems.length)
  }
}

// 操作1：直接加入词库
async function handlePendingAddToVocab(item) {
  await addCoreNeed(item.proposed)
  // 追加到该 entry 的 core_needs
  const entry = item.journal_entries
  const current = entry?.core_needs ?? []
  if (!current.includes(item.proposed)) {
    await updateEntry({
      id: item.entry_id,
      userId: entry?.user_id,
      fields: { core_needs: [...current, item.proposed] },
    })
  }
  await deletePendingCoreNeed(item.id)
  advancePending(pendingItems.filter(p => p.id !== item.id))
}

// 操作2：改措辞后加入
async function handlePendingEditSave(item) {
  const newWord = pendingEditValue.trim()
  if (!newWord) return
  await addCoreNeed(newWord)
  const entry = item.journal_entries
  const current = entry?.core_needs ?? []
  if (!current.includes(newWord)) {
    await updateEntry({
      id: item.entry_id,
      userId: entry?.user_id,
      fields: { core_needs: [...current, newWord] },
    })
  }
  await deletePendingCoreNeed(item.id)
  advancePending(pendingItems.filter(p => p.id !== item.id))
}

// 操作3：合并到已有词条
async function handlePendingMerge(item, existingWord) {
  const entry = item.journal_entries
  const current = entry?.core_needs ?? []
  if (!current.includes(existingWord)) {
    await updateEntry({
      id: item.entry_id,
      userId: entry?.user_id,
      fields: { core_needs: [...current, existingWord] },
    })
  }
  await deletePendingCoreNeed(item.id)
  advancePending(pendingItems.filter(p => p.id !== item.id))
}
```

- [ ] **Step 5：在 JSX header 下方插入橙色 banner**

找到 RecordsPage return 里 sticky header 区域（FilterBar 之前），在 FilterBar 渲染的 `{showSearch && <FilterBar .../>}` 之后插入：

```jsx
{/* pending_core_needs 橙色 banner */}
{pendingCount > 0 && (
  <div
    onClick={handleOpenPendingCard}
    style={{
      background: '#fff7ed',
      borderLeft: '3px solid #f97316',
      padding: '10px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      cursor: 'pointer',
      fontSize: 13,
      color: '#92400e',
    }}
  >
    <span>● 有 {pendingCount} 个新的内心需求待确认</span>
    <span style={{ fontSize: 12 }}>查看 →</span>
  </div>
)}
```

- [ ] **Step 6：在 JSX 末尾插入处理弹卡片**

在 RecordsPage return 的最外层 div 内，所有内容之后，插入：

```jsx
{/* pending_core_needs 处理卡片 */}
{showPendingCard && pendingItems.length > 0 && (() => {
  const item = pendingItems[currentPendingIdx] ?? pendingItems[0]
  const srcEntry = item?.journal_entries
  const srcDate = srcEntry?.created_at
    ? new Date(srcEntry.created_at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      zIndex: 200, display: 'flex', alignItems: 'flex-end',
    }}>
      <div style={{
        width: '100%', background: '#fff',
        borderRadius: '16px 16px 0 0', padding: 20,
        maxHeight: '80vh', overflowY: 'auto',
      }}>
        {/* 剩余数量 */}
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 12 }}>
          待处理 {pendingItems.length} 条
        </div>

        {/* 来源记录 */}
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>来源记录</div>
        <div
          onClick={() => onOpenDetail?.(srcEntry)}
          style={{
            background: '#f9f9f9', borderRadius: 10, padding: '10px 14px',
            marginBottom: 16, cursor: srcEntry ? 'pointer' : 'default',
          }}
        >
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
            <span>{srcDate}</span>
            {srcEntry && <span style={{ color: '#6366f1' }}>查看 →</span>}
          </div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {srcEntry?.content ?? ''}
          </div>
        </div>

        {/* AI 提议 */}
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>AI 提议</div>
        <div style={{
          fontSize: 18, fontWeight: 600, color: '#333',
          marginBottom: 20, paddingLeft: 4,
        }}>
          {item.proposed}
        </div>

        {/* 操作按钮 */}
        <button
          onClick={() => handlePendingAddToVocab(item)}
          style={{
            width: '100%', padding: '13px 0', marginBottom: 10,
            background: '#6366f1', color: '#fff', border: 'none',
            borderRadius: 10, fontSize: 15, cursor: 'pointer',
          }}
        >
          ✓ 加入词库
        </button>

        {/* 改措辞 */}
        <button
          onClick={() => { setShowPendingEdit(v => !v); setShowMergeList(false) }}
          style={{
            width: '100%', padding: '13px 0', marginBottom: showPendingEdit ? 0 : 10,
            background: '#f3f4f6', color: '#374151', border: 'none',
            borderRadius: showPendingEdit ? '10px 10px 0 0' : 10,
            fontSize: 15, cursor: 'pointer',
          }}
        >
          ✎ 改措辞后加入
        </button>
        {showPendingEdit && (
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 12, marginBottom: 10 }}>
            <input
              value={pendingEditValue}
              onChange={e => setPendingEditValue(e.target.value)}
              placeholder={item.proposed}
              autoFocus
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
                borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: 'border-box',
              }}
            />
            <button
              onClick={() => handlePendingEditSave(item)}
              disabled={!pendingEditValue.trim()}
              style={{
                padding: '8px 20px', background: '#6366f1', color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer',
                opacity: pendingEditValue.trim() ? 1 : 0.4,
              }}
            >
              保存
            </button>
          </div>
        )}

        {/* 合并到已有词条 */}
        <button
          onClick={() => { setShowMergeList(v => !v); setShowPendingEdit(false) }}
          style={{
            width: '100%', padding: '13px 0',
            background: '#f3f4f6', color: '#374151', border: 'none',
            borderRadius: showMergeList ? '10px 10px 0 0' : 10,
            fontSize: 15, cursor: 'pointer',
          }}
        >
          合并到已有词条 ›
        </button>
        {showMergeList && (
          <div style={{
            background: '#f9fafb', border: '1px solid #e5e7eb', borderTop: 'none',
            borderRadius: '0 0 10px 10px', padding: 12,
            display: 'flex', flexWrap: 'wrap', gap: 8,
          }}>
            {coreNeedsVocab.map(c => (
              <span
                key={c.id}
                onClick={() => handlePendingMerge(item, c.option_value)}
                style={{
                  padding: '5px 14px', background: '#ede8f5', color: '#7a6a9a',
                  borderRadius: 99, fontSize: 14, cursor: 'pointer',
                }}
              >
                {c.option_value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})()}
```

- [ ] **Step 7：构建检查**

```bash
npm run build
```

预期：无报错。

- [ ] **Step 8：本地验证（需手动操作）**

（须先在 Supabase 手动往 `pending_core_needs` 里插入一条测试数据，`entry_id` 填任意已有记录的 id，`proposed` = 「想被看见」）

1. 进入「记录」页 → header 下方出现橙色 banner「● 有 1 个新的内心需求待确认 · 查看 →」
2. 点 banner → 底部弹出处理卡片，显示来源记录预览 + AI 提议「想被看见」
3. 点「✓ 加入词库」→ 卡片关闭，banner 消失，user_options 里多出「想被看见」
4. 再插入一条测试数据，点「✎ 改措辞后加入」→ 展开输入框 → 输入「渴望被看见」→ 保存 → 词库里出现新词
5. 再插入一条，点「合并到已有词条 ›」→ 展开词库 chip → 点任意词 → 合并，该词追加到 entry.core_needs

- [ ] **Step 9：提交（用户确认验证通过后）**

```bash
git add src/pages/RecordsPage.jsx
git commit -m "feat: RecordsPage pending_core_needs banner + processing card"
```

---

### Task 5：SettingsPage 入口 + 人物管理子页 + 词库管理子页

**Files:**
- Modify: `src/pages/SettingsPage.jsx`

子页采用和现有「内容大类标签」子页（`showTagManager`）完全相同的模式：`position: absolute, inset: 0` 覆盖，`zIndex: 50`，顶部 ‹ 返回按钮。

- [ ] **Step 1：添加 import + 新增 state**

在 [SettingsPage.jsx:1-9](src/pages/SettingsPage.jsx#L1-L9) 的 import 区域末尾追加：

```js
import {
  loadContacts, addContact, updateContact, deleteContact,
} from '../lib/contactsService'
import {
  loadCoreNeeds, addCoreNeed, updateCoreNeed, deleteCoreNeed,
} from '../lib/coreNeedsService'
```

在 `showTagManager` state（第 47 行）之后追加：

```js
// 人物管理子页
const [showPeoplePage, setShowPeoplePage]   = useState(false)
const [contacts, setContacts]               = useState([])
const [editingContactId, setEditingContactId] = useState(null)
const [contactCanonicalDraft, setContactCanonicalDraft] = useState('')
const [contactAliasesDraft, setContactAliasesDraft]   = useState('')
const [newContactCanonical, setNewContactCanonical]   = useState('')

// core_needs 词库子页
const [showNeedsPage, setShowNeedsPage]     = useState(false)
const [coreNeeds, setCoreNeeds]             = useState([])
const [editingNeedId, setEditingNeedId]     = useState(null)
const [needDraft, setNeedDraft]             = useState('')
const [newNeedInput, setNewNeedInput]       = useState('')
```

- [ ] **Step 2：加载数据函数**

在现有 `loadTagOptions` 函数之后插入：

```js
async function loadContactsData() {
  const data = await loadContacts()
  setContacts(data)
}

async function loadCoreNeedsData() {
  const data = await loadCoreNeeds()
  setCoreNeeds(data)
}
```

- [ ] **Step 3：在现有设置列表里添加两个入口**

找到「账号」区域（`账号` 文字所在的 div，约 530 行），在其上方的分割线 `<div className="border-t...">` 之前插入：

```jsx
{/* 人物管理入口 */}
<div className="border-t border-gray-100 pt-4">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm font-medium text-gray-600">人物管理</p>
      <p className="text-xs text-gray-400 mt-0.5">管理联系人和识别关键词</p>
    </div>
    <button
      onClick={() => { loadContactsData(); setShowPeoplePage(true) }}
      className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
    >
      进入 ›
    </button>
  </div>
</div>

{/* 内心需求词库入口 */}
<div className="border-t border-gray-100 pt-4">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm font-medium text-gray-600">内心需求词库</p>
      <p className="text-xs text-gray-400 mt-0.5">管理 AI 提取时使用的词条</p>
    </div>
    <button
      onClick={() => { loadCoreNeedsData(); setShowNeedsPage(true) }}
      className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
    >
      进入 ›
    </button>
  </div>
</div>
```

- [ ] **Step 4：新建人物管理子页 JSX**

在现有 `{showTagManager && (...)}` 块之后插入：

```jsx
{/* ─── 人物管理子页 ─── */}
{showPeoplePage && (
  <div style={{
    position: 'absolute', inset: 0, background: '#f5f3ef',
    display: 'flex', flexDirection: 'column', zIndex: 50,
  }}>
    {/* 顶部 */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px 12px', background: '#f5f3ef', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
      <button onClick={() => { setShowPeoplePage(false); setEditingContactId(null) }}
        style={{ background: 'none', border: 'none', fontSize: 22, color: '#c9a96e', cursor: 'pointer', lineHeight: 1 }}>
        ‹
      </button>
      <span style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>人物管理</span>
    </div>

    {/* 列表 */}
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
      {contacts.map(c => (
        <div key={c.id} style={{ background: '#fff', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
          {editingContactId === c.id ? (
            <div style={{ padding: '12px 14px' }}>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>规范名称</div>
                <input
                  value={contactCanonicalDraft}
                  onChange={e => setContactCanonicalDraft(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>识别关键词（空格分隔）</div>
                <input
                  value={contactAliasesDraft}
                  onChange={e => setContactAliasesDraft(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={async () => {
                    const aliases = contactAliasesDraft.split(/\s+/).map(s => s.trim()).filter(Boolean)
                    await updateContact(c.id, contactCanonicalDraft.trim(), aliases)
                    await loadContactsData()
                    setEditingContactId(null)
                  }}
                  style={{ padding: '7px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}
                >
                  保存（级联替换历史）
                </button>
                <button
                  onClick={() => setEditingContactId(null)}
                  style={{ padding: '7px 14px', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>{c.canonical}</span>
                {c.aliases?.length > 0 && (
                  <span style={{ fontSize: 12, color: '#aaa', marginLeft: 8 }}>
                    别名：{c.aliases.join(' · ')}
                  </span>
                )}
              </div>
              <button
                onClick={() => { setEditingContactId(c.id); setContactCanonicalDraft(c.canonical); setContactAliasesDraft((c.aliases || []).join(' ')) }}
                style={{ fontSize: 12, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                编辑
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm(`删除「${c.canonical}」？已有记录里的标记保留不变。`)) return
                  await deleteContact(c.id)
                  await loadContactsData()
                }}
                style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                删除
              </button>
            </div>
          )}
        </div>
      ))}

      {/* 新增 */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '12px 14px', marginTop: 4 }}>
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>＋ 新增人物</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newContactCanonical}
            onChange={e => setNewContactCanonical(e.target.value)}
            placeholder="规范名称"
            style={{ flex: 1, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14 }}
          />
          <button
            onClick={async () => {
              if (!newContactCanonical.trim()) return
              await addContact(newContactCanonical.trim())
              setNewContactCanonical('')
              await loadContactsData()
            }}
            style={{ padding: '6px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
          >
            添加
          </button>
        </div>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5：新建 core_needs 词库子页 JSX**

**词条输入校验辅助函数**（插入到 `loadCoreNeedsData` 之后）：

```js
function validateCoreNeedInput(val) {
  if (val.length > 20) return '词条不能超过 20 字'
  if (/["'\\n]/.test(val)) return '不能包含引号、反斜杠或换行符'
  return null
}
```

在人物管理子页 JSX 之后接着插入：

```jsx
{/* ─── core_needs 词库子页 ─── */}
{showNeedsPage && (
  <div style={{
    position: 'absolute', inset: 0, background: '#f5f3ef',
    display: 'flex', flexDirection: 'column', zIndex: 50,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px 12px', background: '#f5f3ef', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
      <button onClick={() => { setShowNeedsPage(false); setEditingNeedId(null) }}
        style={{ background: 'none', border: 'none', fontSize: 22, color: '#c9a96e', cursor: 'pointer', lineHeight: 1 }}>
        ‹
      </button>
      <span style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>内心需求词库</span>
    </div>

    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
      {/* chip 网格 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {coreNeeds.map(c => (
          <span
            key={c.id}
            onClick={() => {
              setEditingNeedId(editingNeedId === c.id ? null : c.id)
              setNeedDraft(c.option_value)
            }}
            style={{
              padding: '6px 14px',
              background: editingNeedId === c.id ? '#d8d0f0' : '#ede8f5',
              color: '#7a6a9a', borderRadius: 99, fontSize: 14, cursor: 'pointer',
            }}
          >
            {c.option_value}
          </span>
        ))}
      </div>

      {/* 内联编辑面板 */}
      {editingNeedId && (() => {
        const validErr = needDraft ? validateCoreNeedInput(needDraft) : null
        return (
          <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
            <input
              value={needDraft}
              onChange={e => setNeedDraft(e.target.value)}
              autoFocus
              style={{ width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 14, marginBottom: 4, boxSizing: 'border-box' }}
            />
            {validErr && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>词条过长或含无效字符</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                disabled={!!validErr || !needDraft.trim()}
                onClick={async () => {
                  await updateCoreNeed(editingNeedId, needDraft.trim())
                  setEditingNeedId(null)
                  await loadCoreNeedsData()
                }}
                style={{
                  padding: '7px 16px', background: '#6366f1', color: '#fff',
                  border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer',
                  opacity: (!validErr && needDraft.trim()) ? 1 : 0.4,
                }}
              >
                保存（级联替换历史）
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm('删除该词条？已有记录里的标记保留不变。')) return
                  await deleteCoreNeed(editingNeedId)
                  setEditingNeedId(null)
                  await loadCoreNeedsData()
                }}
                style={{ padding: '7px 14px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}
              >
                删除词条
              </button>
            </div>
          </div>
        )
      })()}

      {/* 新增词条 */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>＋ 新增词条</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newNeedInput}
            onChange={e => setNewNeedInput(e.target.value)}
            placeholder="最多 20 字"
            style={{ flex: 1, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14 }}
          />
          <button
            onClick={async () => {
              const err = validateCoreNeedInput(newNeedInput.trim())
              if (err || !newNeedInput.trim()) return
              await addCoreNeed(newNeedInput.trim())
              setNewNeedInput('')
              await loadCoreNeedsData()
            }}
            style={{ padding: '6px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
          >
            添加
          </button>
        </div>
        {newNeedInput && validateCoreNeedInput(newNeedInput) && (
          <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>词条过长或含无效字符</div>
        )}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6：构建检查**

```bash
npm run build
```

预期：无报错。

- [ ] **Step 7：本地验证（需手动操作）**

1. 进入「我的」→ 找到「人物管理」「内心需求词库」两个入口
2. 点「人物管理」→ 子页全屏展示联系人列表（默认 22 条）
3. 点「编辑」→ 内联展开编辑框，修改名称后「保存（级联替换历史）」→ 返回列表名称更新
4. 点「删除」→ confirm 弹窗 → 确认后联系人消失
5. 新增一个人物 → 出现在列表末尾
6. 点「内心需求词库」→ 子页展示 20 个紫色 chip
7. 点任意 chip → 内联展开编辑面板
8. 输入超 20 字 → 提示「词条过长或含无效字符」，保存按钮禁用
9. 改措辞后保存 → chip 名称更新

- [ ] **Step 8：提交（用户确认验证通过后）**

```bash
git add src/pages/SettingsPage.jsx
git commit -m "feat: SettingsPage people management + core_needs vocab subpages"
```

---

### Task 6：conversationService —— core_needs 提取传词库 + 写 pending

**Files:**
- Modify: `src/lib/conversationService.js`

**改动要点：**
1. `_backgroundProcess` 里提取前先读用户词库
2. `getExtractionPrompt` 调用时传入词库（prompt 会把词库拼进 system prompt 要求 AI 从中选词）
3. 提取结果里的 `unmatched_core_needs` 逐条写入 `pending_core_needs`

- [ ] **Step 1：添加 import**

在 [conversationService.js:3-7](src/lib/conversationService.js#L3-L7) 的 import 区域末尾追加：

```js
import { createPendingCoreNeed } from './coreNeedsService'
```

- [ ] **Step 2：新增 getUserCoreNeeds 辅助函数**

在现有 `getUserCategoryTags` 函数（第 16 行）之后插入：

```js
// 获取用户 core_needs 词库（供 extraction prompt 使用）
async function getUserCoreNeeds(userId) {
  const { data } = await db.from('user_options')
    .select('option_value')
    .eq('user_id', userId)
    .eq('field_name', 'core_need')
    .order('sort_order', { ascending: true })
  return (data ?? []).map(r => r.option_value)
}
```

- [ ] **Step 3：修改 `_backgroundProcess` —— 传词库 + 处理 unmatched**

找到 `_backgroundProcess` 函数（第 93 行）里提取字段的 try 块：

```js
// 提取字段（先拉用户标签）
let extraction = {}
try {
  const userCategoryTags = await getUserCategoryTags(entry.user_id)
  const extractPrompt = `以下是我们的对话记录：\n\n${convoText}\n\n${getExtractionPrompt(userCategoryTags)}`
```

将其替换为：

```js
// 提取字段（先拉用户标签 + core_needs 词库）
let extraction = {}
try {
  const [userCategoryTags, userCoreNeeds] = await Promise.all([
    getUserCategoryTags(entry.user_id),
    getUserCoreNeeds(entry.user_id),
  ])
  const extractPrompt = `以下是我们的对话记录：\n\n${convoText}\n\n${getExtractionPrompt(userCategoryTags, userCoreNeeds)}`
```

然后，在 `if (Object.keys(extraction).length > 0)` 的写回块**之后**（`updateEntry(...).then(...)` 完成后），插入 unmatched 写入逻辑：

```js
  // 写入 pending_core_needs（未匹配词）
  const unmatched = extraction.unmatched_core_needs
  if (Array.isArray(unmatched) && unmatched.length > 0) {
    await Promise.all(
      unmatched.map(word => createPendingCoreNeed(entry.id, word).catch(() => {}))
    )
  }
```

- [ ] **Step 4：修改 `getExtractionPrompt` 接收并使用词库**

找到 [prompts.js](src/lib/prompts.js) 里的 `getExtractionPrompt` 函数，在其参数列表加上 `coreNeedsVocab = []`，并在 prompt 的 core_needs 说明部分追加词库约束。

找到 `getExtractionPrompt` 的定义（应类似 `export function getExtractionPrompt(categoryTags)`），将签名改为：

```js
export function getExtractionPrompt(categoryTags, coreNeedsVocab = [])
```

在该函数 return 的 prompt 字符串里，找到 `core_needs` 字段的说明行（应是类似「core_needs: 数组，...」的描述），替换为：

```
core_needs: 从以下词库中选择最匹配的词（可多选），返回数组。
  词库：[${coreNeedsVocab.join('、')}]
  如果日记内容涉及的内心需求在词库中找不到合适的词，额外返回 unmatched_core_needs 字段，值为你建议的新词字符串数组（每条 ≤10字）。
  若词库为空，则自由提取并全部放入 unmatched_core_needs。
```

- [ ] **Step 5：构建检查**

```bash
npm run build
```

预期：无报错。

- [ ] **Step 6：提交**

```bash
git add src/lib/conversationService.js src/lib/prompts.js
git commit -m "feat: conversationService passes core_needs vocab to extraction prompt"
```

---

### Task 7：extractSummaryService —— 扩展批量补提取字段

**Files:**
- Modify: `src/lib/extractSummaryService.js`

**改动要点：**
1. `buildSummaryPrompt` 新增参数：`coreNeedsVocab`, `categoryTags`, `contacts`
2. prompt 追加 emotions / core_needs / category_tags / people_involved 提取要求
3. `maxTokens` 800 → 1200
4. 写回时跳过已有值的字段（不覆盖）
5. unmatched_core_needs 写入 pending_core_needs

- [ ] **Step 1：添加 import**

在 [extractSummaryService.js:4-5](src/lib/extractSummaryService.js#L4-L5) 的 import 区域末尾追加：

```js
import { createPendingCoreNeed } from './coreNeedsService'
```

- [ ] **Step 2：修改 `buildSummaryPrompt` 接收词库参数**

将现有函数签名：

```js
export function buildSummaryPrompt(entries) {
```

改为：

```js
export function buildSummaryPrompt(entries, { coreNeedsVocab = [], categoryTags = [], contacts = [] } = {}) {
```

在现有 prompt 字符串的 `每条格式：` 段落里，将 JSON 示例从：

```
{
  "id": "条目的 id 字符串，原样返回",
  "entry_summary": "...",
  "theme_hints": [...]
}
```

扩展为：

```
{
  "id": "条目的 id 字符串，原样返回",
  "entry_summary": "一句完整陈述句，20~45字，记录发生了什么+用户的核心反应，不做评价，不写时间地点细节",
  "theme_hints": ["2~4个短语，每个4~10字，写可复用的心理主题"],
  "emotions": ["从情绪词库中选择，见下方词表"],
  "core_needs": ["从 core_needs 词库中选择，见下方词表"],
  "unmatched_core_needs": ["词库中无匹配时填入，每条≤10字"],
  "category_tags": ["从内容大类词库中选择，见下方词表"],
  "people_involved": ["从联系人库识别，见下方词表"]
}
```

在 prompt 末尾（返回要求之前）追加词库说明：

```js
const emotionVocab = ['开心','感激','平静','温暖','满足','喜悦','被爱','自豪','轻松','兴奋','感动','充实','焦虑','委屈','失落','难受','愤怒','孤独','崩溃','压抑','绝望','内疚','恐惧','无助','困惑','思考','平淡','麻木','矛盾','期待','好奇','疲惫','迷茫','复杂']

const vocabSection = `
【情绪词库】（emotions 从中选）：${emotionVocab.join('、')}

【内心需求词库】（core_needs 从中选；词库外的填 unmatched_core_needs）：${coreNeedsVocab.length ? coreNeedsVocab.join('、') : '（暂无词库，请全部填入 unmatched_core_needs）'}

【内容大类词库】（category_tags 从中选）：${categoryTags.length ? categoryTags.join('、') : '工作、家庭、恋爱与亲密关系、个人成长、学习、财务、运动健康、社交、玩乐休闲、灵性修行、日常生活'}

【联系人库】（people_involved 识别规范名称）：${contacts.length ? contacts.map(c => `${c.canonical}（${[c.canonical,...(c.aliases||[])].join('/')}）`).join('、') : '（无联系人库，如文本中出现明确关系词如妈妈/男友请直接提取）'}
`
```

将 return 改为将 `vocabSection` 拼入 prompt 末尾（在「只返回 JSON 数组」行之前）。

最终 return 示例结构：

```js
return `请对以下日记条目逐条提取摘要索引，以 JSON 数组格式返回，不要有任何其他文字。

每条格式：
{
  "id": "条目的 id 字符串，原样返回",
  "entry_summary": "一句完整陈述句，20~45字，记录发生了什么+用户的核心反应，不做评价，不写时间地点细节",
  "theme_hints": ["2~4个短语，每个4~10字，写可复用的心理主题"],
  "emotions": ["从情绪词库中选择"],
  "core_needs": ["从 core_needs 词库中选择"],
  "unmatched_core_needs": ["词库中无匹配时填入，每条≤10字"],
  "category_tags": ["从内容大类词库中选择"],
  "people_involved": ["从联系人库识别规范名称"]
}

entry_summary 示例：
✅ "地铁上被吵闹乘客影响，用慈悲心压下烦躁，但发现对完全平静的期待让自己更累"
❌ "4月10日早上在1号线地铁上遇到男生叫嚷"（含具体时间地点，不可用）

theme_hints 示例：
✅ ["公共场所刺激敏感", "内心平静标准", "慈悲练习"]
❌ ["地铁", "4月10日", "男生叫嚷"]（一次性事件细节，不可用）

${vocabSection}

以下是需要提取的日记条目：

${entriesText}

只返回 JSON 数组，不要解释，不要 markdown 代码块。`
```

- [ ] **Step 3：修改 `extractEntrySummaries` —— 接收并传入词库**

将现有签名：

```js
export async function extractEntrySummaries(userId, entryIds) {
```

改为：

```js
export async function extractEntrySummaries(userId, entryIds, vocabOptions = {}) {
```

将内部 `extractBatch(userId, batch)` 调用改为：

```js
await extractBatch(userId, batch, vocabOptions)
```

- [ ] **Step 4：修改 `extractBatch` —— 传词库 + 扩展写回 + 处理 unmatched**

将现有签名：

```js
async function extractBatch(userId, entryIds) {
```

改为：

```js
async function extractBatch(userId, entryIds, vocabOptions = {}) {
```

将 `buildSummaryPrompt(entries)` 改为：

```js
const prompt = buildSummaryPrompt(entries, vocabOptions)
```

将 `maxTokens: 800` 改为：

```js
{ maxTokens: 1200 }
```

将写回 DB 的 `Promise.all` 段落从：

```js
await Promise.all(results.map(async (r) => {
  if (!r.id || !r.entry_summary) return
  const { error } = await db.from('journal_entries')
    .update({
      entry_summary: r.entry_summary,
      theme_hints: Array.isArray(r.theme_hints) ? r.theme_hints : [],
    })
    .eq('id', r.id)
    .eq('user_id', userId)
  if (error) {
    console.error(`[extractSummary] 写回 ${r.id} 失败:`, error.message)
  }
}))
```

替换为：

```js
await Promise.all(results.map(async (r) => {
  if (!r.id) return

  // 先查询该 entry 当前已有值，避免覆盖
  const { data: existing } = await db.from('journal_entries')
    .select('entry_summary, theme_hints, emotions, core_needs, category_tags, people_involved')
    .eq('id', r.id)
    .eq('user_id', userId)
    .single()

  const patch = {}
  if (!existing?.entry_summary && r.entry_summary)
    patch.entry_summary = r.entry_summary
  if (!(existing?.theme_hints?.length) && r.theme_hints?.length)
    patch.theme_hints = r.theme_hints
  if (!(existing?.emotions?.length) && r.emotions?.length)
    patch.emotions = r.emotions
  if (!(existing?.core_needs?.length) && r.core_needs?.length)
    patch.core_needs = r.core_needs
  if (!(existing?.category_tags?.length) && r.category_tags?.length)
    patch.category_tags = r.category_tags
  if (!(existing?.people_involved?.length) && r.people_involved?.length)
    patch.people_involved = r.people_involved

  if (Object.keys(patch).length > 0) {
    const { error } = await db.from('journal_entries')
      .update(patch)
      .eq('id', r.id)
      .eq('user_id', userId)
    if (error) console.error(`[extractSummary] 写回 ${r.id} 失败:`, error.message)
  }

  // 处理 unmatched_core_needs → pending_core_needs
  if (Array.isArray(r.unmatched_core_needs) && r.unmatched_core_needs.length > 0) {
    await Promise.all(
      r.unmatched_core_needs.map(word =>
        createPendingCoreNeed(r.id, word).catch(() => {})
      )
    )
  }
}))
```

- [ ] **Step 5：更新 `reviewLetterService` 的调用处，传入词库**

找到 [reviewLetterService.js](src/lib/reviewLetterService.js) 里调用 `extractEntrySummaries(userId, missingIds)` 的地方，在调用前先查询词库，然后传入：

```js
// 查询词库（供批量补提取使用）
const [coreNeedsRes, categoryRes, contactsRes] = await Promise.all([
  db.from('user_options').select('option_value').eq('user_id', userId).eq('field_name', 'core_need').order('sort_order', { ascending: true }),
  db.from('user_options').select('option_value').eq('user_id', userId).eq('field_name', 'content_category').order('sort_order', { ascending: true }),
  db.from('user_contacts').select('canonical, aliases').eq('user_id', userId),
])
const vocabOptions = {
  coreNeedsVocab: (coreNeedsRes.data ?? []).map(r => r.option_value),
  categoryTags:   (categoryRes.data ?? []).map(r => r.option_value),
  contacts:       contactsRes.data ?? [],
}
await extractEntrySummaries(userId, missingIds, vocabOptions)
```

（将原来的 `await extractEntrySummaries(userId, missingIds)` 替换为上面这段）

- [ ] **Step 6：构建检查**

```bash
npm run build
```

预期：无报错。

- [ ] **Step 7：提交**

```bash
git add src/lib/extractSummaryService.js src/lib/reviewLetterService.js
git commit -m "feat: extractSummaryService extends batch extraction to emotions/core_needs/people_involved"
```

---

### Task 8：整体验证

**Files:** 无新增，全部验证已实现功能。

- [ ] **Step 1：构建最终检查**

```bash
npm run build
```

预期：零报错、零 warning（除已有的 unused variable 等原有 warning 外不新增）。

- [ ] **Step 2：启动开发服务器**

```bash
npm run dev
```

- [ ] **Step 3：逐条验证成功标准（spec §11）**

| # | 验证项 | 操作 |
|---|---|---|
| 1 | 新用户默认联系人 + 词库 | 新建测试账号，登录后进首页，检查 Supabase → user_contacts 是否有 22 条、user_options(core_need) 是否有 20 条 |
| 2 | @mention → 浮层 → chip | 首页输入「今天和@宝」→ 浮层出现「男友（别名：宝宝...）」→ 点击 → 文本变「今天和宝」，底部 chip 出现「男友 ✕」 |
| 3 | 关键词自动识别 | 输入含「妈妈」的文字 → 点 ✓ → 记录详情「涉及的人」出现「妈妈」chip |
| 4 | RecordDetail 人物增删 | 进任意记录详情 → 点「涉及的人」行的 ＋ → 选人 → chip 出现；点 ✕ → chip 消失，DB 立即更新 |
| 5 | AI core_needs 从词库选词 | 完成一次 AI 觉察对话 → 记录详情「内心需求」显示紫色 chip，词条格式统一（来自词库） |
| 6 | pending banner 持续显示 | Supabase 手动插入一条 pending_core_needs → 刷新「记录」页 → 橙色 banner 出现；处理完后消失 |
| 7 | 处理卡片三条路径 | banner 点击 → 依次测试「加入词库」「改措辞后加入」「合并到已有词条」三个按钮 |
| 8 | 人物管理级联替换 | 「我的」→ 人物管理 → 编辑「男友」→ 改为「男朋友」→ 保存 → 检查 Supabase journal_entries.people_involved 里旧值已替换 |
| 9 | core_needs 词库改措辞 | 「我的」→ 内心需求词库 → 点「被理解」→ 改为「渴望被理解」→ 保存 → 历史 journal_entries.core_needs 里旧值已替换 |
| 10 | 批量补提取扩展 | 找一条没有 AI 对话的旧记录（entry_summary 为空）→ 手动触发回顾信生成 → 该记录被批量提取，emotions / core_needs / people_involved 有值 |

- [ ] **Step 4：用户确认所有验证项通过**

验证通过后，告知用户可以推送上线：

```bash
git push
```

---

### Task 9：user_contacts 增加 group_name 分组字段

> **在 Task 1–8 全部完成、验证通过后再做这个 Task。**
>
> 背景：group_name 用于区分联系人的关系类别（家人 / 伴侣 / 朋友 / 同事 / 其他），与 aliases（识别关键词）语义分离，为后续按人物分组查看记录打基础。
>
> 架构说明：仅加可空列，不影响 RLS、外键、现有数据，无需 arch session 审查。

**Files:**
- Modify: `src/lib/contactsService.js`
- Modify: `src/pages/SettingsPage.jsx`
- Document: `docs/arch-context.md`（追加字段说明）

- [ ] **Step 1：Supabase SQL Editor 执行**

```sql
ALTER TABLE user_contacts ADD COLUMN group_name text;
```

预期：执行成功，无报错。现有行 group_name = NULL，不影响已有数据。

- [ ] **Step 2：更新 contactsService.js —— DEFAULT_CONTACTS 加分组**

找到 `DEFAULT_CONTACTS` 数组（Task 1 新建的 `src/lib/contactsService.js`），给每条记录加上 `group_name` 字段：

```js
const DEFAULT_CONTACTS = [
  { canonical: '妈妈',  aliases: ['妈妈','母亲','老妈','阿妈'], group_name: '家人' },
  { canonical: '爸爸',  aliases: ['爸爸','父亲','老爸','阿爸'], group_name: '家人' },
  { canonical: '奶奶',  aliases: ['奶奶','祖母'],               group_name: '家人' },
  { canonical: '爷爷',  aliases: ['爷爷','祖父'],               group_name: '家人' },
  { canonical: '外婆',  aliases: ['外婆','姥姥','外祖母'],       group_name: '家人' },
  { canonical: '外公',  aliases: ['外公','姥爷','外祖父'],       group_name: '家人' },
  { canonical: '哥哥',  aliases: ['哥哥','大哥','兄长'],         group_name: '家人' },
  { canonical: '弟弟',  aliases: ['弟弟','小弟'],               group_name: '家人' },
  { canonical: '姐姐',  aliases: ['姐姐','大姐'],               group_name: '家人' },
  { canonical: '妹妹',  aliases: ['妹妹','小妹'],               group_name: '家人' },
  { canonical: '男友',  aliases: ['男友','男朋友','男盆友'],     group_name: '伴侣' },
  { canonical: '女友',  aliases: ['女友','女朋友','女盆友'],     group_name: '伴侣' },
  { canonical: '老公',  aliases: ['老公','丈夫','先生'],         group_name: '伴侣' },
  { canonical: '老婆',  aliases: ['老婆','妻子','太太'],         group_name: '伴侣' },
  { canonical: '婆婆',  aliases: ['婆婆'],                      group_name: '家人' },
  { canonical: '老板',  aliases: ['老板','上司','领导'],         group_name: '同事' },
  { canonical: '同事',  aliases: ['同事'],                      group_name: '同事' },
  { canonical: '客户',  aliases: ['客户','甲方'],               group_name: '同事' },
  { canonical: '朋友',  aliases: ['朋友','好友','好朋友'],       group_name: '朋友' },
  { canonical: '闺蜜',  aliases: ['闺蜜','死党'],               group_name: '朋友' },
  { canonical: '同学',  aliases: ['同学'],                      group_name: '朋友' },
  { canonical: '室友',  aliases: ['室友'],                      group_name: '朋友' },
]
```

同时，`seedDefaultContacts` 的 rows 映射加上 `group_name`：

```js
const rows = DEFAULT_CONTACTS.map((c, i) => ({
  canonical: c.canonical,
  aliases: c.aliases,
  group_name: c.group_name ?? null,
  sort_order: i,
}))
```

`addContact` 函数签名加上 `group_name` 参数：

```js
export async function addContact(canonical, aliases = [], group_name = null) {
  const { data, error } = await db
    .from('user_contacts')
    .insert({ canonical, aliases, group_name })
    .select()
    .single()
  if (error) throw error
  return data
}
```

`updateContact` 函数签名加上 `group_name`：

```js
export async function updateContact(id, canonical, aliases, group_name = null) {
  // ...（existing replace_person_name RPC 调用保持不变）
  const { error } = await db
    .from('user_contacts')
    .update({ canonical, aliases, group_name })
    .eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 3：更新 SettingsPage.jsx —— 人物管理编辑表单加分组**

找到 Task 5 写入的人物管理子页，在编辑态（`editingContactId === c.id` 分支）的「规范名称」和「识别关键词」输入框之间，插入「分组」输入：

```jsx
<div style={{ marginBottom: 8 }}>
  <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>分组（家人 / 伴侣 / 朋友 / 同事 / 其他）</div>
  <input
    value={contactGroupDraft}
    onChange={e => setContactGroupDraft(e.target.value)}
    placeholder="选填，如：家人"
    style={{ width: '100%', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
  />
</div>
```

同时需要：
1. 新增 state：`const [contactGroupDraft, setContactGroupDraft] = useState('')`
2. 展开编辑时初始化：`setContactGroupDraft(c.group_name ?? '')`
3. 保存时传入：`await updateContact(c.id, contactCanonicalDraft.trim(), aliases, contactGroupDraft.trim() || null)`

新增人物的「新增」按钮保持简单，`group_name` 暂不在新增表单里填（用户可以之后在编辑里补），`addContact(newContactCanonical.trim())` 调用不变（group_name 默认 null）。

- [ ] **Step 4：@ 浮层按分组展示（可选增强）**

如果要在 @ 浮层里按 group_name 分组显示，找到 Task 2 写的浮层 JSX（`mentionQuery !== null` 那块），将 `filtered.map(...)` 替换为分组渲染：

```jsx
{(() => {
  // 按 group_name 分组
  const grouped = {}
  for (const c of filtered) {
    const g = c.group_name ?? '其他'
    if (!grouped[g]) grouped[g] = []
    grouped[g].push(c)
  }
  return Object.entries(grouped).map(([group, members]) => (
    <div key={group}>
      <div style={{ fontSize: 11, color: '#bbb', padding: '6px 16px 2px', background: '#fafafa' }}>
        {group}
      </div>
      {members.map(c => (
        <div key={c.id} onClick={() => handleMentionSelect(c)}
          style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 15, borderBottom: '1px solid #f3f4f6' }}>
          <span style={{ fontWeight: 600 }}>{c.canonical}</span>
          {c.aliases?.length > 0 && (
            <span style={{ color: '#9ca3af', fontSize: 13, marginLeft: 8 }}>
              {c.aliases.join(' · ')}
            </span>
          )}
        </div>
      ))}
    </div>
  ))
})()}
```

RecordDetail 的人物选择 sheet（Task 3）同理可做分组，但不强制——按列表展示也可以。

- [ ] **Step 5：追加到 arch-context.md**

在 `docs/arch-context.md` 的 §2 已确认决策区域，找到「2.8 user_contacts」段落，追加：

```
group_name（text, nullable）：联系人关系分类，如「家人」「伴侣」「朋友」「同事」「其他」。
默认联系人按关系类别预填。用户可在人物管理里编辑。
@ 浮层按 group_name 分组展示（group_name 为 null 的归入「其他」）。
```

- [ ] **Step 6：构建检查**

```bash
npm run build
```

预期：无报错。

- [ ] **Step 7：本地验证（需手动操作）**

1. 进「我的」→ 人物管理 → 点编辑任意联系人 → 有「分组」输入框，默认显示已有分组值
2. 修改分组 → 保存 → Supabase 里 group_name 更新
3. 首页输入 `@` → 浮层按分组展示（家人 / 伴侣 / 朋友 / 同事 各一组）
4. 新建账号 → user_contacts 里 22 条记录的 group_name 正确填入

- [ ] **Step 8：提交**

```bash
git add src/lib/contactsService.js src/pages/SettingsPage.jsx docs/arch-context.md
git commit -m "feat: user_contacts add group_name field for contact grouping"
```


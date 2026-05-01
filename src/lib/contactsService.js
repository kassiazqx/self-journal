import { db } from './db'

// 读取当前用户全部联系人（进页面时一次性加载到内存）
export async function loadContacts() {
  const { data, error } = await db
    .from('user_contacts')
    .select('id, canonical, aliases, group_name, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data
}

// 新增联系人
export async function addContact(canonical, aliases = [], group_name = null) {
  const { data: { user } } = await db.auth.getUser()
  if (!user) throw new Error('not logged in')
  const { data, error } = await db
    .from('user_contacts')
    .insert({ user_id: user.id, canonical, aliases, group_name })
    .select()
    .single()
  if (error) throw error
  return data
}

// 更新联系人（canonical 改名时级联替换历史）
export async function updateContact(id, canonical, aliases, group_name = null) {
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
    .update({ canonical, aliases, group_name })
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
// 长词优先匹配，防止「朋友」被「男朋友」的子串误命中
export function detectPeopleFromText(text, contacts) {
  if (!text || !contacts?.length) return []

  const pairs = []
  for (const contact of contacts) {
    const allKeywords = [contact.canonical, ...(contact.aliases || [])]
    for (const kw of allKeywords) {
      if (kw) pairs.push({ canonical: contact.canonical, kw })
    }
  }
  pairs.sort((a, b) => b.kw.length - a.kw.length)

  const matched = new Set()
  const usedRanges = []

  for (const { canonical, kw } of pairs) {
    if (matched.has(canonical)) continue

    let idx = text.indexOf(kw)
    while (idx !== -1) {
      const end = idx + kw.length
      const overlaps = usedRanges.some(([s, e]) => idx < e && end > s)
      if (!overlaps) {
        usedRanges.push([idx, end])
        matched.add(canonical)
        break
      }
      idx = text.indexOf(kw, idx + 1)
    }
  }

  return [...matched]
}

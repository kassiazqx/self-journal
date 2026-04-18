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
  const { data: { user } } = await db.auth.getUser()
  if (!user) return

  const { count, error: countErr } = await db
    .from('user_contacts')
    .select('id', { count: 'exact', head: true })
  if (countErr) throw countErr
  if (count > 0) return  // 已有数据，跳过

  const rows = DEFAULT_CONTACTS.map((c, i) => ({
    user_id: user.id,
    canonical: c.canonical,
    aliases: c.aliases,
    sort_order: i,
  }))
  const { error } = await db.from('user_contacts').insert(rows)
  if (error) throw error
}

// 新增联系人
export async function addContact(canonical, aliases = []) {
  const { data: { user } } = await db.auth.getUser()
  if (!user) throw new Error('not logged in')
  const { data, error } = await db
    .from('user_contacts')
    .insert({ user_id: user.id, canonical, aliases })
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

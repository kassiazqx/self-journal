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
  const { data: { user } } = await db.auth.getUser()
  if (!user) return

  const { count, error: countErr } = await db
    .from('user_options')
    .select('id', { count: 'exact', head: true })
    .eq('field_name', 'core_need')
  if (countErr) throw countErr
  if (count > 0) return

  const rows = DEFAULT_CORE_NEEDS.map((v, i) => ({
    user_id: user.id,
    field_name: 'core_need',
    option_value: v,
    sort_order: i,
  }))
  const { error } = await db.from('user_options').insert(rows)
  if (error) throw error
}

// 新增词条
export async function addCoreNeed(option_value) {
  const { data: { user } } = await db.auth.getUser()
  if (!user) throw new Error('not logged in')
  const { data, error } = await db
    .from('user_options')
    .insert({ user_id: user.id, field_name: 'core_need', option_value })
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

// 日记条目数据访问层
// 所有对 journal_entries 表的读写都在这里，组件不直接调 supabase
import { supabase } from './supabase'

// ─── 查询 ──────────────────────────────────────────────────────
// 分页加载，按 created_at 倒序
// 返回 { data, error }
export async function fetchEntries({ userId, from, limit }) {
  return supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1)
}

// ─── 新建 ──────────────────────────────────────────────────────
// 立即返回（fire-and-forget），调用方自行处理 error
export function insertEntry(entry) {
  return supabase
    .from('journal_entries')
    .insert(entry)
    .select()
    .single()
}

// ─── 更新（通用）──────────────────────────────────────────────
// fields: 任意字段对象；需同时传 id + userId 做 RLS 校验
export function updateEntry({ id, userId, fields }) {
  return supabase
    .from('journal_entries')
    .update(fields)
    .eq('id', id)
    .eq('user_id', userId)
}

// ─── 全量导出（用于数据导出功能）─────────────────────────────
// 不分页，一次拉取全部，按时间正序（方便阅读）
export async function fetchAllEntries({ userId }) {
  return supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
}
export function deleteEntry({ id, userId }) {
  return supabase
    .from('journal_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
}

// ─── 批量删除 ──────────────────────────────────────────────────
export function deleteEntries({ ids, userId }) {
  return supabase
    .from('journal_entries')
    .delete()
    .in('id', ids)
    .eq('user_id', userId)
}

// ─── 今日感恩条目数（最多计 3 条）──────────────────────────────
export async function fetchTodayGratitudeCount(userId) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('template_type', 'gratitude')
    .gte('created_at', todayStart.toISOString())
  return { count: Math.min(count ?? 0, 3), error }
}

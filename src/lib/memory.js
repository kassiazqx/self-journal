/**
 * AI 跨对话记忆层
 *
 * 存储位置：Supabase user_memory 表（每个用户一行）
 * 好处：换浏览器/换设备/清缓存，记忆都在
 *
 * 两个字段：
 *   rolling_summary —— 历史对话的滚动压缩摘要
 *   user_profile    —— 用户画像（跨对话积累的认知）
 */

import { supabase } from './supabase'

// ─── 读取记忆 ──────────────────────────────────────────────────
/**
 * 获取当前用户的全部记忆
 * @returns {{ rolling_summary: string|null, user_profile: string|null }}
 */
export async function getMemory() {
  try {
    const { data, error } = await supabase
      .from('user_memory')
      .select('rolling_summary, user_profile')
      .maybeSingle()

    if (error) throw error
    return {
      rolling_summary: data?.rolling_summary ?? null,
      user_profile: data?.user_profile ?? null,
    }
  } catch (err) {
    console.error('[memory] getMemory 失败:', err)
    return { rolling_summary: null, user_profile: null }
  }
}

// ─── 写入记忆 ──────────────────────────────────────────────────
/**
 * 更新记忆（upsert：没有则新建，有则覆盖）
 * @param {{ rolling_summary?: string, user_profile?: string }} fields
 */
export async function updateMemory(fields) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const { error } = await supabase
      .from('user_memory')
      .upsert(
        { user_id: user.id, ...fields, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )

    if (error) throw error
  } catch (err) {
    console.error('[memory] updateMemory 失败:', err)
  }
}

// ─── 快捷方法 ──────────────────────────────────────────────────
export async function setRollingSummary(content) {
  return updateMemory({ rolling_summary: content })
}

export async function setUserProfile(content) {
  return updateMemory({ user_profile: content })
}

// ─── 清空记忆（重置用）────────────────────────────────────────
export async function clearMemory() {
  return updateMemory({ rolling_summary: null, user_profile: null })
}

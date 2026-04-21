// src/lib/reviewLetterService.js
// 回顾信触发检查 + 生成逻辑
import { db } from './db'
import { callAI } from './aiClient'
import { getReviewLetterPrompt } from './prompts'
import { getMemory } from './memory'
import { extractEntrySummaries } from './extractSummaryService'

// ── 读取用户触发偏好 ───────────────────────────────────────────
export async function getUserLetterPrefs(userId) {
  // 主存储：user_memory（多端同步）
  try {
    const memory = await getMemory(userId)
    const prefs = memory?.user_profile?.letter_prefs
    if (prefs) {
      // 兼容旧存储中 type: 'days'（已弃用），降级为 count
      return prefs.type === 'days' ? { ...prefs, type: 'count' } : prefs
    }
  } catch { /* ignore */ }

  // 降级：localStorage
  try {
    const stored = localStorage.getItem(`letter_prefs_${userId}`)
    if (stored) {
      const prefs = JSON.parse(stored)
      return prefs.type === 'days' ? { ...prefs, type: 'count' } : prefs
    }
  } catch { /* ignore */ }

  // 默认：每写 10 条自动触发
  return { type: 'count', count_threshold: 10, require_new_entries: true }
}

// ── 保存用户触发偏好 ──────────────────────────────────────────
export async function saveUserLetterPrefs(userId, prefs, updateMemoryFn) {
  // 主存储：user_memory
  try {
    await updateMemoryFn({ user_profile: { letter_prefs: prefs } })
  } catch (e) {
    console.error('[reviewLetter] 保存偏好到 user_memory 失败:', e)
  }
  // 降级缓存：localStorage
  try {
    localStorage.setItem(`letter_prefs_${userId}`, JSON.stringify(prefs))
  } catch { /* ignore */ }
}

// ── 生成回顾信 ────────────────────────────────────────────────
async function generateReviewLetter(userId, periodStart, prefs) {
  const periodEnd = new Date().toISOString()

  // Step 1: 取最近 6~8 条 covered_by_letter_id IS NULL 的 entry（排除随手记）
  const { data: entries } = await db.from('journal_entries')
    .select('id, entry_summary, theme_hints, core_needs, created_at')
    .eq('user_id', userId)
    .is('covered_by_letter_id', null)
    .neq('template_type', 'freewrite')
    .gt('created_at', periodStart ?? '1970-01-01')
    .lte('created_at', periodEnd)
    .order('created_at', { ascending: true })
    .limit(8)

  if (!entries?.length) throw new Error('NO_ENTRIES')

  // Step 2: 批量补提取缺失的 entry_summary / theme_hints（含词库）
  // （extractEntrySummaries 已在文件顶部静态 import，见 §4.14 注意事项）
  const needExtract = entries.filter(e => !e.entry_summary)
  if (needExtract.length > 0) {
    // 并行拉三个词库
    const [coreNeedsRows, categoryRows, contactsRows] = await Promise.all([
      db.from('user_options').select('option_value').eq('user_id', userId).eq('field_name', 'core_need').order('sort_order', { ascending: true }),
      db.from('user_options').select('option_value').eq('user_id', userId).eq('field_name', 'content_category').order('sort_order', { ascending: true }),
      db.from('user_contacts').select('canonical').eq('user_id', userId),
    ])
    const vocabOptions = {
      coreNeedsVocab: (coreNeedsRows.data ?? []).map(r => r.option_value),
      categoryTags: (categoryRows.data ?? []).map(r => r.option_value),
      contacts: contactsRows.data ?? [],
    }
    await extractEntrySummaries(userId, needExtract.map(e => e.id), vocabOptions)

    // 重新读取，拿到最新摘要
    const { data: refreshed } = await db.from('journal_entries')
      .select('id, entry_summary, theme_hints, core_needs, created_at')
      .in('id', entries.map(e => e.id))
      .order('created_at', { ascending: true })
    if (refreshed) entries.splice(0, entries.length, ...refreshed)
  }

  // Step 3: 构建摘要数组传 AI（不传原始 content）
  const entriesSummary = entries.map(e => ({
    date: e.created_at.slice(0, 10),
    entry_summary: e.entry_summary,
    theme_hints: e.theme_hints,
    core_needs: e.core_needs,
  }))

  const prompt = getReviewLetterPrompt(entriesSummary)
  const rawLetter = await callAI(
    [{ role: 'user', content: prompt }],
    '你是用户的内心陪伴者，写一封温和的回顾信，不评判，不说教，帮助用户看见自己。',
    { maxTokens: 1200 }
  )

  // Step 4: 提取末尾 JSON
  const insightsMatch = rawLetter.match(/```json([\s\S]*?)```/)
  let insights = { suggested_threads: [] }
  if (insightsMatch) {
    try { insights = JSON.parse(insightsMatch[1]) }
    catch (e) {
      console.warn('[reviewLetter] insights JSON 解析失败:', e)
      console.warn('[reviewLetter] 原始返回前 500 字符:', rawLetter.slice(0, 500))
    }
  } else {
    console.warn('[reviewLetter] 未找到 JSON 块，rawLetter 前 300 字符:', rawLetter.slice(0, 300))
  }
  const letterContent = rawLetter.replace(/```json[\s\S]*?```/, '').trim()

  // Step 5: 保存 review_letter
  const { data: letter, error } = await db.from('review_letters').insert({
    user_id: userId,
    entry_ids: entries.map(e => e.id),
    content: letterContent,
    insights,
    trigger_type: prefs.type,
    period_start: periodStart ?? entries[0]?.created_at,
    period_end: periodEnd,
    is_read: false,
  }).select('id').single()

  if (error) {
    console.error('[reviewLetter] 插入失败:', error.message)
    throw error
  }

  // Step 6: 回写 covered_by_letter_id（修复 §4.7）
  const { error: updateError } = await db.from('journal_entries')
    .update({ covered_by_letter_id: letter.id })
    .in('id', entries.map(e => e.id))
    .eq('user_id', userId)
  if (updateError) {
    // 不抛出：信已生成，回写失败只影响下次计数
    console.error('[reviewLetter] covered_by_letter_id 回写失败:', updateError.message)
  }

  // Step 7: 把 suggested_threads 写入 threads 表（创建 candidate 脉络）
  const toCreate = (insights.suggested_threads ?? [])
    .filter(t => t.action === 'create' && t.thread_name?.trim())

  for (const t of toCreate) {
    // 1. 插入 thread，取回 id
    const { data: newThread, error: threadErr } = await db.from('threads')
      .insert({
        user_id: userId,
        name: t.thread_name.trim(),
        status: 'candidate',
        trigger_source: 'review',
        arc_summary: t.discovery_reason?.trim() || null,
        arc_updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (threadErr || !newThread) {
      console.error('[reviewLetter] 候选脉络创建失败:', threadErr?.message)
      continue  // 跳过这一条，不影响其他脉络
    }

    // 2. 计算关联 entry ids（过滤越界）
    const relatedEntryIds = (t.related_entry_indices ?? [])
      .filter(i => i >= 0 && i < entries.length)
      .map(i => entries[i].id)

    if (relatedEntryIds.length === 0) continue

    // 3. 批量写入 thread_entries
    const { error: teErr } = await db.from('thread_entries')
      .insert(
        relatedEntryIds.map(entryId => ({
          thread_id: newThread.id,
          entry_id: entryId,
          added_by: 'ai',
          removed_by_user: false,
        }))
      )

    if (teErr) {
      console.error('[reviewLetter] thread_entries 写入失败:', teErr.message)
      // 不抛出：thread 已创建，降级可接受
    }
  }

  return true
}

// ── 主入口：检查是否需要生成（应用启动 / 记录页加载时调用）──
export async function checkAndGenerateLetter(userId) {
  const prefs = await getUserLetterPrefs(userId)
  if (prefs.type === 'manual') return  // 手动触发，不自动生成

  const { data: lastLetter } = await db.from('review_letters')
    .select('created_at, period_end')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { count: newEntryCount } = await db.from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('covered_by_letter_id', null)
    .neq('template_type', 'freewrite')
    .gt('created_at', lastLetter?.period_end ?? '1970-01-01')

  if (prefs.require_new_entries && newEntryCount === 0) return

  const shouldGenerate = prefs.type === 'count' && newEntryCount >= prefs.count_threshold

  if (shouldGenerate) {
    await generateReviewLetter(userId, lastLetter?.period_end, prefs)
  }
}

// ── 手动立即生成（设置页按钮调用）──────────────────────────────
export async function generateLetterNow(userId) {
  const { data: lastLetter } = await db.from('review_letters')
    .select('period_end')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const prefs = await getUserLetterPrefs(userId)
  await generateReviewLetter(userId, lastLetter?.period_end ?? null, prefs)
}

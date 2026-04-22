// src/lib/reviewLetterService.js
// 回顾信触发检查 + 生成逻辑
import { db } from './db'
import { callAI } from './aiClient'
import { getReviewLetterPrompt } from './prompts'
import { getMemory } from './memory'
import { extractEntrySummaries } from './extractSummaryService'

// ── 时间问候词 ──────────────────────────────────────────────────
function getTimeGreeting() {
  const h = new Date().getHours()
  if (h >= 5  && h < 11) return ['早上好', '早啊', '早'][Math.floor(Math.random() * 3)]
  if (h >= 11 && h < 14) return ['中午好', '午安'][Math.floor(Math.random() * 2)]
  if (h >= 14 && h < 18) return '下午好'
  if (h >= 18 && h < 23) return ['晚上好', '晚啊'][Math.floor(Math.random() * 2)]
  return ['还没睡呢', '深夜了'][Math.floor(Math.random() * 2)]  // 23–05
}

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
    .select('id, content, full_conversation, entry_summary, current_thought, body_sensations, core_needs, cognitive_analysis, reflection_insight, created_at')
    .eq('user_id', userId)
    .is('covered_by_letter_id', null)
    .neq('template_type', 'freewrite')
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
      .select('id, content, full_conversation, entry_summary, current_thought, body_sensations, core_needs, cognitive_analysis, reflection_insight, created_at')
      .in('id', entries.map(e => e.id))
      .order('created_at', { ascending: true })
    if (refreshed) entries.splice(0, entries.length, ...refreshed)
  }

  // Step 3: 构建富内容数组传 AI（原文 + 觉察卡片答案 + 对话用户消息）
  const entriesSummary = entries.map(e => {
    const parts = []

    // ① 原始日记全文
    if (e.content) parts.push(`日记原文：\n${e.content}`)

    // ② 觉察卡片用户填写的答案（有值才加）
    const reflections = []
    if (e.current_thought)    reflections.push(`当下念头：${e.current_thought}`)
    if (e.body_sensations)    reflections.push(`身体感受：${e.body_sensations}`)
    if (e.core_needs?.length) reflections.push(`核心需求：${e.core_needs.join('、')}`)
    if (e.cognitive_analysis) reflections.push(`认知：${e.cognitive_analysis}`)
    if (e.reflection_insight) reflections.push(`洞见：${e.reflection_insight}`)
    if (reflections.length)   parts.push(reflections.join('\n'))

    // ③ AI 对话里用户真实说的话（跳过第 0 条——那条是系统自动发的日记原文）
    const userReplies = (e.full_conversation ?? [])
      .filter(m => m.role === 'user')
      .slice(1)
      .map(m => m.content)
      .filter(Boolean)
    if (userReplies.length) parts.push(`对话中说的：\n${userReplies.join('\n')}`)

    return {
      date: e.created_at.slice(0, 10),
      richContent: parts.join('\n\n'),
    }
  })

  const timeGreeting = getTimeGreeting()
  const prompt = getReviewLetterPrompt({ entriesSummary, timeGreeting })
  const rawLetter = await callAI(
    [{ role: 'user', content: prompt }],
    '你是用户的内心陪伴者，写一封温和的回顾信，不评判，不说教，帮助用户看见自己。',
    { maxTokens: 1200 }
  )

  // Step 4a: 先提取 annotations 预标注（必须在 suggested_threads 清洗之前）
  // 使用精确非贪婪正则，只匹配 {"annotations":[...]} 块，不触发贪婪回溯
  let letterAnnotations = null
  const annotationsMatch = rawLetter.match(/\{"annotations"\s*:\s*(\[[\s\S]*?\])\}/)
  if (annotationsMatch) {
    try {
      const parsed = JSON.parse(annotationsMatch[0])
      // 过滤非法标注（start/end 超出范围的由 buildSegments 在渲染时自动忽略）
      if (Array.isArray(parsed.annotations)) {
        letterAnnotations = parsed.annotations.filter(
          a => typeof a.start === 'number' && typeof a.end === 'number' && a.start < a.end
        )
      }
    } catch (e) {
      console.warn('[reviewLetter] annotations JSON 解析失败:', e)
    }
  }
  // 从 rawLetter 中剥离 annotations 块，防止干扰后续 suggested_threads 清洗
  const rawLetterNoAnnotations = annotationsMatch
    ? rawLetter.replace(annotationsMatch[0], '')
    : rawLetter

  // Step 4: 提取末尾 JSON（兼容 AI 输出的各种格式）
  // 策略：依次尝试四种格式，任一匹配即解析
  //   格式A: ```json ... ``` 或 ~~~json ... ~~~（含 json 标签）
  //   格式A2: ``` ... ``` 或 ~~~  ... ~~~（不含 json 标签，直接包裹数组/对象）
  //   格式B: { "suggested_threads": [...] }  裸对象（至字符串末尾）
  //   格式C: [ { "action": ... } ]            AI 直接返回裸数组（至字符串末尾，末尾可能跟 ``` 等杂质）
  const fencedMatch  = rawLetterNoAnnotations.match(/(?:```+|~~~+)\s*json\s*([\s\S]*?)(?:```+|~~~+)/)
  const fencedMatch2 = rawLetterNoAnnotations.match(/(?:```+|~~~+)\s*(\[[\s\S]*"thread_name"[\s\S]*?\])[\s\S]*?(?:```+|~~~+)/)
  const objectMatch  = rawLetterNoAnnotations.match(/(\{[\s\S]*"suggested_threads"[\s\S]*\})[\s\S]*$/)
  const arrayMatch   = rawLetterNoAnnotations.match(/(\[[\s\S]*"thread_name"[\s\S]*\])/)

  let insights = { suggested_threads: [] }
  let rawJsonStr = null

  if (fencedMatch) {
    rawJsonStr = fencedMatch[1]
  } else if (fencedMatch2) {
    rawJsonStr = fencedMatch2[1]
  } else if (objectMatch) {
    rawJsonStr = objectMatch[1]
  } else if (arrayMatch) {
    rawJsonStr = arrayMatch[1]
  }

  if (rawJsonStr) {
    try {
      const parsed = JSON.parse(rawJsonStr.trim())
      // 格式C：AI 直接返回数组，需包装成标准结构
      if (Array.isArray(parsed)) {
        insights = { suggested_threads: parsed }
      } else {
        insights = parsed
      }
    } catch (e) {
      console.warn('[reviewLetter] insights JSON 解析失败:', e)
      console.warn('[reviewLetter] rawJsonStr:', rawJsonStr?.slice(0, 300))
      console.warn('[reviewLetter] rawLetter 末尾 500 字符:', rawLetterNoAnnotations.slice(-500))
    }
  } else {
    console.warn('[reviewLetter] 未找到 JSON 块')
    console.warn('[reviewLetter] rawLetter 末尾 500 字符:', rawLetterNoAnnotations.slice(-500))
  }

  // 移除末尾所有 JSON 块，保证信的正文干净
  // ⚠️ 每条 replace 均删除到字符串末尾（[\s\S]*$），
  //    避免因 AI 在 ] 后追加 ``` 等杂质导致 \]\s*$ 无法命中
  const letterContent = rawLetterNoAnnotations
    .replace(/(?:```+|~~~+)\s*(?:json)?\s*[\s\S]*?(?:```+|~~~+)[\s\S]*$/, '')  // 格式A/A2：代码块到末尾
    .replace(/\{[\s\S]*"suggested_threads"[\s\S]*$/, '')                          // 格式B：裸对象到末尾
    .replace(/\[[\s\S]*"thread_name"[\s\S]*$/, '')                               // 格式C：裸数组到末尾
    .trim()

  // Step 5: 保存 review_letter
  const { data: letter, error } = await db.from('review_letters').insert({
    user_id: userId,
    entry_ids: entries.map(e => e.id),
    content: letterContent,
    annotations: letterAnnotations,
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
        review_letter_id: letter.id,
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

  if (prefs.require_new_entries && newEntryCount === 0) return

  const shouldGenerate = prefs.type === 'count' && newEntryCount >= prefs.count_threshold

  if (shouldGenerate) {
    await generateReviewLetter(userId, null, prefs)
  }
}

// ── 更新回顾信字段（供 ReviewLetterDetail 标注保存用）─────────
export async function updateReviewLetter(letterId, userId, fields) {
  const { error } = await db.from('review_letters')
    .update(fields)
    .eq('id', letterId)
    .eq('user_id', userId)
  if (error) throw error
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
  // 手动触发不限制时间范围：covered_by_letter_id IS NULL 已能识别未覆盖条目
  // 不传 period_end 作为 periodStart，避免旧时间戳条目被排除
  await generateReviewLetter(userId, null, prefs)
}

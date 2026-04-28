// src/lib/extractSummaryService.js
// 懒触发批量提取 entry_summary + theme_hints + 情绪/需求/标签/人物
// 仅在上层功能需要时调用（生成回顾信前、分析脉络前），不在保存时自动调
import { db } from './db'
import { callAI } from './aiClient'
import { createPendingCoreNeed } from './coreNeedsService'
import { invalidateEntry } from './entryRepository'
import { buildConversationMessageIndex, buildEntryFullText } from './entryFullText'

// 情绪词库（硬编码，保持与提取一致）
const EMOTION_VOCAB = [
  '焦虑','委屈','开心','后悔','敬佩','渴望','愤怒','悲伤','恐惧','厌恶',
  '惊讶','喜悦','平静','无聊','羞耻','内疚','嫉妒','羡慕','感激','自豪',
  '孤独','绝望','期待','满足','迷茫','矛盾','压抑','疲惫','释然','温暖',
  '兴奋','烦躁','失望','紧张',
]

// ── 构建批量摘要提取 prompt（纯函数，可单独测试）──────────────
export function buildSummaryPrompt(entries, vocabOptions = {}) {
  // entries: [{ id, content }]
  // vocabOptions: { coreNeedsVocab, categoryTags, contacts }
  const { coreNeedsVocab = [], categoryTags = [], contacts = [] } = vocabOptions

  const entriesText = entries.map((e, i) =>
    `[条目${i + 1}，id: ${e.id}]\n${e.fullText ?? e.content ?? ''}`
  ).join('\n\n---\n\n')

  const emotionVocabLine = `情绪词库（从中选）：${EMOTION_VOCAB.join('、')}`
  const coreNeedsLine = coreNeedsVocab.length > 0
    ? `核心需求词库（从中选）：${coreNeedsVocab.join('、')}；词库外的词放 unmatched_core_needs`
    : `核心需求：自由提取，全部放入 unmatched_core_needs，core_needs 返回空数组`
  const categoryLine = categoryTags.length > 0
    ? `内容大类词库（从中选 1-2 个）：${categoryTags.join(' / ')}`
    : `内容大类：选 1-2 个最贴合的生活领域关键词`
  const contactsLine = contacts.length > 0
    ? `联系人库（优先使用 canonical 称呼）：${contacts.map(c => c.canonical).join('、')}`
    : `涉及的人：用关系称呼如妈妈、同事小李`

  return `请对以下日记条目逐条提取摘要索引，以 JSON 数组格式返回，不要有任何其他文字。

【词库说明】
${emotionVocabLine}
${coreNeedsLine}
${categoryLine}
${contactsLine}

每条格式：
{
  "id": "条目的 id 字符串，原样返回",
  "entry_summary": "一句完整陈述句，20~45字，记录发生了什么+用户的核心反应，不做评价，不写时间地点细节",
  "theme_hints": ["2~4个短语，每个4~10字，写可复用的心理主题，三个月后还能帮助识别同类记录"],
  "emotions": ["情绪词数组，从词库中选，没有则空数组"],
  "core_needs": ["核心需求词数组，从词库中选，没有则空数组"],
  "unmatched_core_needs": ["词库外的核心需求建议词，每条≤10字，若无则省略或空数组"],
  "category_tags": ["内容大类，1-2个，没有则空数组"],
  "people_involved": ["涉及的人，优先用联系人库的 canonical 称呼，没有则空数组"]
}

entry_summary 示例：
✅ "地铁上被吵闹乘客影响，用慈悲心压下烦躁，但发现对完全平静的期待让自己更累"
❌ "4月10日早上在1号线地铁上遇到男生叫嚷" （含具体时间地点，不可用）

theme_hints 示例：
✅ ["公共场所刺激敏感", "内心平静标准", "慈悲练习"]
❌ ["地铁", "4月10日", "男生叫嚷"] （一次性事件细节，不可用）

以下是需要提取的日记条目：

${entriesText}

只返回 JSON 数组，不要解释，不要 markdown 代码块。`
}

// ── 批量提取（最多 10 条，超出分批）─────────────────────────
export async function extractEntrySummaries(userId, entryIds, vocabOptions = {}) {
  if (!entryIds?.length) return

  const BATCH_SIZE = 10
  for (let i = 0; i < entryIds.length; i += BATCH_SIZE) {
    const batch = entryIds.slice(i, i + BATCH_SIZE)
    await extractBatch(userId, batch, vocabOptions)
  }
}

async function extractBatch(userId, entryIds, vocabOptions = {}) {
  // 读取原始内容
  const { data: entries, error } = await db.from('journal_entries')
    .select('id, content, entry_summary, emotions, core_needs, category_tags, people_involved')
    .eq('user_id', userId)
    .in('id', entryIds)

  if (error || !entries?.length) {
    console.error('[extractSummary] 读取 entries 失败:', error?.message)
    return
  }

  const { data: rows, error: conversationsError } = await db.from('conversations')
    .select('entry_id, messages')
    .eq('user_id', userId)
    .eq('context_type', 'entry')
    .in('entry_id', entryIds)

  if (conversationsError) {
    console.error('[extractSummary] 读取 conversations 失败:', conversationsError.message)
    return
  }

  const messageIndex = buildConversationMessageIndex(rows ?? [])
  const enrichedEntries = entries.map((entry) => ({
    ...entry,
    fullText: buildEntryFullText({
      entry,
      messages: messageIndex.get(entry.id) ?? [],
    }),
  }))

  const prompt = buildSummaryPrompt(enrichedEntries, vocabOptions)

  let rawResponse
  try {
    rawResponse = await callAI(
      [{ role: 'user', content: prompt }],
      '你是一个精准的信息提取助手，只返回 JSON，不附加任何解释。',
      { maxTokens: 1200 }
    )
  } catch (e) {
    console.error('[extractSummary] AI 调用失败:', e.message)
    return
  }

  let results
  try {
    // 去除可能的 markdown 代码块包装
    const cleaned = rawResponse.replace(/```json|```/g, '').trim()
    results = JSON.parse(cleaned)
    if (!Array.isArray(results)) throw new Error('不是数组')
  } catch (e) {
    console.error('[extractSummary] JSON 解析失败:', e.message)
    console.warn('[extractSummary] 原始返回:', rawResponse.slice(0, 400))
    return
  }

  // 写回 DB（跳过已有值的字段，部分失败不影响其他条）
  await Promise.all(results.map(async (r) => {
    if (!r.id || !r.entry_summary) return

    // 找对应的原始条目（用于跳过已有值）
    const existing = entries.find(e => e.id === r.id) ?? {}

    const patch = {
      entry_summary: r.entry_summary,
      theme_hints: Array.isArray(r.theme_hints) ? r.theme_hints : [],
    }

    // 跳过已有值的字段
    if (!existing.emotions?.length && Array.isArray(r.emotions) && r.emotions.length > 0) {
      patch.emotions = r.emotions
    }
    if (!existing.core_needs?.length && Array.isArray(r.core_needs) && r.core_needs.length > 0) {
      patch.core_needs = r.core_needs
    }
    if (!existing.category_tags?.length && Array.isArray(r.category_tags) && r.category_tags.length > 0) {
      patch.category_tags = r.category_tags
    }
    if (!existing.people_involved?.length && Array.isArray(r.people_involved) && r.people_involved.length > 0) {
      patch.people_involved = r.people_involved
    }

    const { error } = await db.from('journal_entries')
      .update(patch)
      .eq('id', r.id)
      .eq('user_id', userId)
    if (error) {
      console.error(`[extractSummary] 写回 ${r.id} 失败:`, error.message)
      return
    }

    invalidateEntry(r.id)

    // 写入未匹配核心需求到 pending
    const unmatched = r.unmatched_core_needs
    if (Array.isArray(unmatched) && unmatched.length > 0) {
      await Promise.all(
        unmatched.map(word => createPendingCoreNeed(r.id, word).catch(() => {}))
      )
    }
  }))
}

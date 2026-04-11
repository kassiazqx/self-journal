// src/lib/extractSummaryService.js
// 懒触发批量提取 entry_summary + theme_hints
// 仅在上层功能需要时调用（生成回顾信前、分析脉络前），不在保存时自动调
import { db } from './db'
import { callAI } from './aiClient'

// ── 构建批量摘要提取 prompt（纯函数，可单独测试）──────────────
export function buildSummaryPrompt(entries) {
  // entries: [{ id, content }]
  const entriesText = entries.map((e, i) =>
    `[条目${i + 1}，id: ${e.id}]\n${e.content}`
  ).join('\n\n---\n\n')

  return `请对以下日记条目逐条提取摘要索引，以 JSON 数组格式返回，不要有任何其他文字。

每条格式：
{
  "id": "条目的 id 字符串，原样返回",
  "entry_summary": "一句完整陈述句，20~45字，记录发生了什么+用户的核心反应，不做评价，不写时间地点细节",
  "theme_hints": ["2~4个短语，每个4~10字，写可复用的心理主题，三个月后还能帮助识别同类记录"]
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
export async function extractEntrySummaries(userId, entryIds) {
  if (!entryIds?.length) return

  const BATCH_SIZE = 10
  for (let i = 0; i < entryIds.length; i += BATCH_SIZE) {
    const batch = entryIds.slice(i, i + BATCH_SIZE)
    await extractBatch(userId, batch)
  }
}

async function extractBatch(userId, entryIds) {
  // 读取原始内容
  const { data: entries, error } = await db.from('journal_entries')
    .select('id, content')
    .eq('user_id', userId)
    .in('id', entryIds)

  if (error || !entries?.length) {
    console.error('[extractSummary] 读取 entries 失败:', error?.message)
    return
  }

  const prompt = buildSummaryPrompt(entries)

  let rawResponse
  try {
    rawResponse = await callAI(
      [{ role: 'user', content: prompt }],
      '你是一个精准的信息提取助手，只返回 JSON，不附加任何解释。',
      { maxTokens: 800 }
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

  // 写回 DB（逐条 update，部分失败不影响其他条）
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
}

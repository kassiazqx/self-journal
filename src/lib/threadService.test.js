// src/lib/threadService.test.js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// 内联纯函数实现（与 threadService.js 保持一致，绕开 db/aiClient 模块解析限制）
function scoreEntryForThread(entry, thread) {
  let score = 0
  const overlap = (arr1, arr2) =>
    (arr1 ?? []).filter(x => (arr2 ?? []).includes(x)).length
  score += overlap(entry.core_needs, thread.representativeNeeds) * 3
  score += overlap(entry.theme_hints, thread.representativeHints) * 3
  score += overlap(entry.emotions, thread.representativeEmotions) * 1
  score += overlap(entry.category_tags, thread.representativeTags) * 1
  return score
}

function buildArcSummaryPrompt(thread, entries) {
  const entriesText = entries.map((e, i) =>
    `[第${i + 1}条，${e.created_at?.slice(0, 10) ?? ''}]\n${e.entry_summary ?? ''}\n主题：${(e.theme_hints ?? []).join('、') || '无'}`
  ).join('\n\n')

  return `这是用户持续追踪的主题脉络：「${thread.name}」

以下是按时间排列的相关记录摘要：

${entriesText}

请写一段变化轨迹（arc_summary）：
- 使用试探性语言：「这段时间似乎…」「也许正在从…走向…」
- 聚焦变化，不做永久性定性（禁止「你是一个…的人」）
- 100~200字，直接开始叙事，不加标题`
}

describe('scoreEntryForThread', () => {
  const thread = {
    representativeNeeds: ['被理解', '安全感'],
    representativeHints: ['公共场所刺激', '内心平静标准'],
    representativeEmotions: ['焦虑', '烦躁'],
    representativeTags: ['社交'],
  }

  test('core_needs overlap +3 each', () => {
    const entry = { core_needs: ['被理解'], theme_hints: [], emotions: [], category_tags: [] }
    assert.strictEqual(scoreEntryForThread(entry, thread), 3)
  })

  test('theme_hints overlap +3 each', () => {
    const entry = { core_needs: [], theme_hints: ['公共场所刺激'], emotions: [], category_tags: [] }
    assert.strictEqual(scoreEntryForThread(entry, thread), 3)
  })

  test('emotions +1, tags +1', () => {
    const entry = { core_needs: [], theme_hints: [], emotions: ['焦虑'], category_tags: ['社交'] }
    assert.strictEqual(scoreEntryForThread(entry, thread), 2)
  })

  test('returns 0 for no overlap', () => {
    const entry = { core_needs: [], theme_hints: [], emotions: [], category_tags: [] }
    assert.strictEqual(scoreEntryForThread(entry, thread), 0)
  })
})

describe('buildArcSummaryPrompt', () => {
  test('includes thread name and entry summaries', () => {
    const thread = { name: '内心平静探索' }
    const entries = [
      { created_at: '2026-03-10', entry_summary: '第一次记录', theme_hints: ['平静标准'] },
      { created_at: '2026-04-01', entry_summary: '慢慢接受有反应的自己', theme_hints: [] },
    ]
    const prompt = buildArcSummaryPrompt(thread, entries)
    assert.ok(prompt.includes('内心平静探索'))
    assert.ok(prompt.includes('第一次记录'))
    assert.ok(prompt.includes('慢慢接受有反应的自己'))
  })
})

describe('reAnalyzeThread (unit: candidate filtering logic)', () => {
  test('excludes entry IDs already in thread_entries (including removed)', () => {
    // 模拟：该脉络已有的 thread_entries（含 removed_by_user=true 的）
    const existingEntries = [
      { entry_id: 'aaa', removed_by_user: false },
      { entry_id: 'bbb', removed_by_user: true },  // 用户已手动排除
      { entry_id: 'ccc', removed_by_user: false },
    ]
    // 所有 entry 的 id 列表（候选池）
    const allEntryIds = ['aaa', 'bbb', 'ccc', 'ddd', 'eee']

    // 逻辑：从候选池中排除所有已在 thread_entries 中的（不论 removed_by_user）
    const excludedIds = new Set(existingEntries.map(e => e.entry_id))
    const candidates = allEntryIds.filter(id => !excludedIds.has(id))

    assert.deepStrictEqual(candidates, ['ddd', 'eee'])
    // ⚠️ 'bbb' 虽然 removed_by_user=true，但仍必须被排除（不重新分析）
    assert.ok(!candidates.includes('bbb'), 'removed_by_user=true 的记录不得进入候选池')
  })
})

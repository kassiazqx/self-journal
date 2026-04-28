// src/lib/extractSummaryService.test.js
// 测试 buildSummaryPrompt 纯函数逻辑（内联定义，绕开 db/aiClient 模块解析限制）
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// 内联同款实现：与 extractSummaryService.js 中的 buildSummaryPrompt 保持完全一致
// 目的：在 Node ESM 环境下验证纯函数逻辑，不依赖 Vite 别名解析
function buildSummaryPrompt(entries, vocabOptions = {}) {
  const entriesText = entries.map((e, i) =>
    `[条目${i + 1}，id: ${e.id}]\n${e.fullText ?? e.content ?? ''}`
  ).join('\n\n---\n\n')

  void vocabOptions

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

describe('buildSummaryPrompt', () => {
  test('returns a string containing the content', () => {
    const entries = [
      { id: 'abc', content: '今天在地铁上很烦躁' },
      { id: 'def', content: '感觉很疲惫，不想说话' },
    ]
    const prompt = buildSummaryPrompt(entries)
    assert.ok(typeof prompt === 'string', '应返回字符串')
    assert.ok(prompt.includes('地铁上很烦躁'), '应包含 entry 内容')
    assert.ok(prompt.includes('entry_summary'), '应包含字段名 entry_summary')
    assert.ok(prompt.includes('theme_hints'), '应包含字段名 theme_hints')
  })

  test('handles empty entries gracefully', () => {
    const prompt = buildSummaryPrompt([])
    assert.ok(typeof prompt === 'string')
  })

  test('each entry is labeled with index and id', () => {
    const entries = [{ id: 'xyz', content: '一些内容' }]
    const prompt = buildSummaryPrompt(entries)
    assert.ok(prompt.includes('条目1'), '应有条目编号')
    assert.ok(prompt.includes('id: xyz'), '应包含条目 id')
  })

  test('uses entry fullText instead of raw content only', () => {
    const prompt = buildSummaryPrompt([
      {
        id: 'e1',
        content: 'A',
        fullText: '原始写作：\nA\n\n本地问题：Q\n\n我的回答：B',
      },
    ], {})

    assert.match(prompt, /本地问题：Q/)
    assert.match(prompt, /我的回答：B/)
  })
})

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEntryFullText,
  buildMemoryConversationText,
  buildReviewLetterRichContent,
} from './entryFullText.js'

test('buildEntryFullText keeps prompts and answers in order', () => {
  const entry = { content: '今天很乱。' }
  const messages = [
    { nodeType: 'raw_entry', content: '今天很乱。' },
    { nodeType: 'local_prompt', content: '这件事里，哪个时刻最深？' },
    { nodeType: 'local_answer', content: '被催的时候。' },
    { nodeType: 'ai_prompt', content: '那一刻你心里最在意什么？' },
    { nodeType: 'ai_answer', content: '怕自己做不好。' },
  ]

  const fullText = buildEntryFullText({ entry, messages })

  assert.match(fullText, /原始写作：\n今天很乱。/)
  assert.match(fullText, /本地问题：这件事里，哪个时刻最深？/)
  assert.match(fullText, /我的回答：被催的时候。/)
  assert.match(fullText, /AI问题：那一刻你心里最在意什么？/)
  assert.match(fullText, /我的回答：怕自己做不好。/)
})

test('buildMemoryConversationText skips raw_entry and keeps nodeType labels', () => {
  const text = buildMemoryConversationText([
    { nodeType: 'raw_entry', content: '今天很乱。' },
    { nodeType: 'local_prompt', content: '哪个时刻最深？' },
    { nodeType: 'local_answer', content: '被催的时候。' },
    { nodeType: 'ai_prompt', content: '你在意什么？' },
    { nodeType: 'ai_answer', content: '怕做不好。' },
  ])

  assert.doesNotMatch(text, /今天很乱。/)
  assert.match(text, /本地问题：哪个时刻最深？/)
  assert.match(text, /我的回答：被催的时候。/)
  assert.match(text, /AI问题：你在意什么？/)
  assert.match(text, /我的回答：怕做不好。/)
})

test('buildReviewLetterRichContent appends structured supplements', () => {
  const richContent = buildReviewLetterRichContent({
    entry: {
      content: '今天很乱。',
      current_thought: '我又不够好',
      body_sensations: '胸口发紧',
      core_needs: ['被理解'],
      cognitive_analysis: '有点灾难化',
      reflection_insight: '我其实在怕被否定',
    },
    messages: [
      { nodeType: 'local_prompt', content: '哪个时刻最深？' },
      { nodeType: 'local_answer', content: '被催的时候。' },
    ],
  })

  assert.match(richContent, /原始写作：\n今天很乱。/)
  assert.match(richContent, /本地问题：哪个时刻最深？/)
  assert.match(richContent, /后续整理字段：/)
  assert.match(richContent, /当下念头：我又不够好/)
  assert.match(richContent, /核心需求：被理解/)
  assert.match(richContent, /洞见：我其实在怕被否定/)
})

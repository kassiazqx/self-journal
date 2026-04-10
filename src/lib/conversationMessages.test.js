import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConversationMessages } from './conversationMessages.js'

test('normalizeConversationMessages reorders local pairs as prompt then answer', () => {
  const messages = [
    { id: 'raw:entry', nodeType: 'raw_entry', role: 'user', content: '原始日记' },
    { id: 'local-answer:context', nodeType: 'local_answer', role: 'user', promptId: 'context', content: '回答1' },
    { id: 'local:context', nodeType: 'local_prompt', role: 'local', promptId: 'context', content: '引导1' },
    { id: 'local-answer:emotion', nodeType: 'local_answer', role: 'user', promptId: 'emotion', content: '回答2' },
    { id: 'local:emotion', nodeType: 'local_prompt', role: 'local', promptId: 'emotion', content: '引导2' },
    { id: 'ai-answer:ai-1', nodeType: 'ai_answer', role: 'user', promptId: 'ai-1', content: 'AI回答1' },
    { id: 'ai-1', nodeType: 'ai_prompt', role: 'assistant', promptId: 'ai-1', content: 'AI引导1' },
  ]

  const normalized = normalizeConversationMessages(messages)

  assert.deepEqual(
    normalized.map(msg => `${msg.nodeType}:${msg.content}`),
    [
      'local_prompt:引导1',
      'local_answer:回答1',
      'local_prompt:引导2',
      'local_answer:回答2',
      'ai_prompt:AI引导1',
      'ai_answer:AI回答1',
    ],
  )
})

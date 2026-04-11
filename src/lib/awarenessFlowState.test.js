import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createFlowState,
  continueLocalNode,
  enterAiMode,
  continueAiNode,
  pauseAiMode,
  moveToPreviousNode,
  moveToNextNode,
  serializeFlowState,
  restoreFlowState,
  buildConversationMessages,
} from './awarenessFlowState.js'

function makeEntry(content = '今天开会后我有点焦虑，也觉得胸口发紧。') {
  return {
    id: 'entry-1',
    user_id: 'user-1',
    content,
    created_at: '2026-04-10T10:00:00.000Z',
  }
}

test('blank local continue advances without creating a local answer', () => {
  const state = createFlowState({ entryContent: makeEntry().content, now: '2026-04-10T10:01:00.000Z' })

  const next = continueLocalNode(state, {
    answer: '',
    now: '2026-04-10T10:02:00.000Z',
  })

  assert.equal(next.currentIdx, 1)

  const messages = buildConversationMessages(makeEntry(), next)
  assert.equal(messages.filter(m => m.nodeType === 'local_prompt').length, 2)
  assert.equal(messages.some(m => m.nodeType === 'local_answer'), false)
  assert.equal(messages.at(-1).nodeType, 'local_prompt')
  assert.equal(messages.at(-1).promptId, next.localNodes[1].id)
})

test('AI continue saves the round and stays in AI flow', () => {
  const state = createFlowState({ entryContent: makeEntry().content, now: '2026-04-10T10:01:00.000Z' })

  const entered = enterAiMode(state, {
    draftLocalAnswer: '我怕自己表现不好。',
    aiBlock: '我感觉你一边紧张，一边也在努力撑住。\n也许你在意的不只是这次开会，而是自己会不会被否定。\n当你最怕出错的时候，你最想守住的是什么？',
    aiNodeId: 'ai-1',
    now: '2026-04-10T10:02:00.000Z',
  })

  const next = continueAiNode(entered, {
    answer: '我想守住自己是可靠的这件事。',
    nextAiBlock: '你已经看见自己很在乎可靠感。\n这份在乎里，可能也夹着对自我价值的证明。\n如果暂时不用证明，你会怎么对待此刻的自己？',
    answerNow: '2026-04-10T10:03:00.000Z',
    nextAiNodeId: 'ai-2',
    nextAiNow: '2026-04-10T10:04:00.000Z',
  })

  assert.equal(next.mode, 'ai')
  assert.equal(next.currentNode.kind, 'ai')
  assert.equal(next.currentNode.id, 'ai-2')
  assert.equal(next.activeAiNodeId, 'ai-2')

  const messages = buildConversationMessages(makeEntry(), next)
  assert.deepEqual(
    messages.filter(m => m.nodeType === 'ai_prompt').map(m => m.id),
    ['ai-1', 'ai-2'],
  )
  assert.equal(messages.filter(m => m.nodeType === 'ai_answer').length, 1)
  assert.equal(messages.find(m => m.id === 'ai-answer:ai-1').content, '我想守住自己是可靠的这件事。')
})

test('pausing AI when triggering card is answered navigates to next blank local card', () => {
  const state = createFlowState({ entryContent: makeEntry().content, now: '2026-04-10T10:01:00.000Z' })
  const entered = enterAiMode(state, {
    draftLocalAnswer: '我那时脑子很乱。',
    aiBlock: '你像是在混乱里想先稳住自己。\n这种乱也许不只是事情本身，而是你很怕失控。\n你最怕一旦失控，会发生什么？',
    aiNodeId: 'ai-1',
    now: '2026-04-10T10:02:00.000Z',
  })
  const continued = continueAiNode(entered, {
    answer: '我怕别人觉得我不专业。',
    nextAiBlock: '你已经碰到”别人怎么看你”这层了。\n也许外界评价和你对自己的要求绑得很紧。\n当你说”不专业”时，你脑海里具体在指什么？',
    answerNow: '2026-04-10T10:03:00.000Z',
    nextAiNodeId: 'ai-2',
    nextAiNow: '2026-04-10T10:04:00.000Z',
  })

  const paused = pauseAiMode(continued, {
    draftAiAnswer: '我会觉得自己不配待在这里。',
    now: '2026-04-10T10:05:00.000Z',
  })

  assert.equal(paused.mode, 'local')
  assert.equal(paused.activeAiNodeId, null)
  // triggering card (context) was answered → should land on next blank local card (emotion)
  assert.equal(paused.currentNode.kind, 'local')
  assert.notEqual(paused.currentNode.promptId, 'context')

  const messages = buildConversationMessages(makeEntry(), paused)
  assert.deepEqual(
    messages.filter(m => m.nodeType === 'ai_prompt').map(m => m.id),
    ['ai-1', 'ai-2'],
  )
  assert.equal(messages.filter(m => m.nodeType === 'ai_answer').length, 2)
  assert.equal(messages.find(m => m.id === 'ai-answer:ai-2').content, '我会觉得自己不配待在这里。')
})

test('pausing AI when triggering card is blank returns to that blank card', () => {
  const state = createFlowState({ entryContent: makeEntry().content, now: '2026-04-10T10:01:00.000Z' })
  // enter AI without answering the local card (blank trigger)
  const entered = enterAiMode(state, {
    draftLocalAnswer: '',
    aiBlock: '先接住这份慌。\n它后面像是有被评价的压力。\n你最怕别人怎么看你？',
    aiNodeId: 'ai-1',
    now: '2026-04-10T10:02:00.000Z',
  })

  const paused = pauseAiMode(entered, {
    draftAiAnswer: '',
    now: '2026-04-10T10:03:00.000Z',
  })

  assert.equal(paused.mode, 'local')
  assert.equal(paused.activeAiNodeId, null)
  // triggering card (context) was blank → should return to it
  assert.equal(paused.currentNode.promptId, 'context')
})

test('previous and next traverse the unified node stream across AI nodes', () => {
  const state = createFlowState({ entryContent: makeEntry().content, now: '2026-04-10T10:01:00.000Z' })
  const entered = enterAiMode(state, {
    draftLocalAnswer: '我有点慌。',
    aiBlock: '先接住这份慌。\n它后面像是有被评价的压力。\n你最怕别人怎么看你？',
    aiNodeId: 'ai-1',
    now: '2026-04-10T10:02:00.000Z',
  })
  const continued = continueAiNode(entered, {
    answer: '怕别人觉得我不行。',
    nextAiBlock: '你已经碰到评价焦虑了。\n这也许和你对自己的要求绑在一起。\n如果先不证明自己，你最需要什么？',
    answerNow: '2026-04-10T10:03:00.000Z',
    nextAiNodeId: 'ai-2',
    nextAiNow: '2026-04-10T10:04:00.000Z',
  })

  const previous = moveToPreviousNode(continued)
  assert.equal(previous.currentNode.id, 'ai-1')
  assert.equal(previous.currentIdx, 1)

  const forward = moveToNextNode(previous)
  assert.equal(forward.currentNode.id, 'ai-2')
  assert.equal(forward.currentIdx, 2)
})

test('moving forward at the current frontier stays put until a new node exists', () => {
  const state = createFlowState({ entryContent: makeEntry().content, now: '2026-04-10T10:01:00.000Z' })

  const forward = moveToNextNode(state)

  assert.equal(forward.currentNode.id, state.currentNode.id)
  assert.equal(forward.currentIdx, state.currentIdx)
})

test('createFlowState can build the first visible node immediately without waiting for DB messages', () => {
  const state = createFlowState({
    entryContent: makeEntry().content,
    now: '2026-04-10T10:01:00.000Z',
    messages: null,
    snapshot: null,
  })

  assert.equal(state.currentNode.kind, 'local')
  assert.equal(state.visibleNodes.length, 1)
  assert.equal(state.currentIdx, 0)
})

test('restored snapshot keeps the exact current node instead of resetting to first unanswered local card', () => {
  const state = createFlowState({ entryContent: makeEntry().content, now: '2026-04-10T10:01:00.000Z' })
  const afterFirst = continueLocalNode(state, {
    answer: '我在会议后有点乱。',
    now: '2026-04-10T10:02:00.000Z',
  })
  const afterSecond = continueLocalNode(afterFirst, {
    answer: '',
    now: '2026-04-10T10:03:00.000Z',
  })

  const snapshot = serializeFlowState(afterSecond)
  const restored = restoreFlowState({
    entryContent: makeEntry().content,
    messages: null,
    snapshot,
    now: '2026-04-10T10:04:00.000Z',
  })

  assert.equal(restored.currentNode.id, afterSecond.currentNode.id)
  assert.equal(restored.currentIdx, afterSecond.currentIdx)
})

import { getAwarenessStartTier } from './contentAnalysis.js'
import { EMOTION_NEGATIVE } from './emotionMap.js'

export const AWARENESS_QUESTIONS = [
  {
    id: 'context',
    tier: 1,
    texts: [
      '能多说一点当时的情况吗？',
      '当时是在哪里、和谁在一起？',
      '这件事是怎么开始的？',
    ],
    showWhen: 'always',
  },
  {
    id: 'emotion',
    tier: 2,
    texts: [
      '当时你是什么感觉？',
      '你注意到自己有哪些情绪？',
      '心里是什么滋味？',
    ],
    showWhen: 'always',
  },
  {
    id: 'body',
    tier: 3,
    texts: [
      '这个感觉在身体哪里？',
      '身体有什么紧绷或不舒服的地方吗？',
      '用什么词描述这个感觉——紧、沉、热，还是别的？',
    ],
    showWhen: 'negative',
  },
  {
    id: 'thought',
    tier: 3,
    texts: [
      '当时你脑子里第一个念头是什么？',
      '那个时刻最先冒出来的词或句子是什么？',
      '你当时对自己说了什么？',
    ],
    showWhen: 'always',
  },
  {
    id: 'need',
    tier: 4,
    texts: [
      '在这件事上，你真正需要的是什么？',
      '这件事触动了什么——被理解、安全感，还是别的？',
      '如果最好的结果出现，它会是什么样子？',
    ],
    showWhen: 'always',
  },
  {
    id: 'insight',
    tier: 5,
    texts: [
      '写完这些，有什么是刚才才意识到的吗？',
      '如果给今天的自己说一句话，会是什么？',
      '回头看，你觉得自己处理得怎么样？',
    ],
    showWhen: 'always',
  },
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function currentPromptText(node) {
  return node.texts[node.altIndex || 0] ?? node.texts[0] ?? ''
}

function getLocalNodeKey(promptId) {
  return `local:${promptId}`
}

function enrichState(baseState) {
  const visibleNodes = buildVisibleNodes(baseState)
  const currentIdx = Math.max(0, visibleNodes.findIndex(node => node.id === baseState.currentNodeId))
  const currentNode = visibleNodes[currentIdx] ?? null
  return {
    ...baseState,
    visibleNodes,
    currentIdx,
    currentNode,
    mode: currentNode?.kind === 'ai' ? 'ai' : 'local',
  }
}

export function getFilteredLocalNodes(entryContent) {
  const startTier = getAwarenessStartTier(entryContent)
  const hasNegativeEmotion = EMOTION_NEGATIVE.some(word => entryContent.includes(word))

  return AWARENESS_QUESTIONS
    .filter(question => {
      if (question.tier < startTier) return false
      if (question.showWhen === 'negative' && !hasNegativeEmotion) return false
      return true
    })
    .map(question => ({
      id: question.id,
      tier: question.tier,
      texts: [...question.texts],
      altIndex: 0,
    }))
}

export function buildVisibleNodes(state) {
  const visible = []
  const displayedCount = Math.min(state.displayedLocalCount, state.localNodes.length)

  for (let idx = 0; idx < displayedCount; idx += 1) {
    const localNode = state.localNodes[idx]
    visible.push({
      id: getLocalNodeKey(localNode.id),
      kind: 'local',
      promptId: localNode.id,
      text: currentPromptText(localNode),
      localIndex: idx,
      altIndex: localNode.altIndex || 0,
    })

    const aiNodes = state.aiNodes
      .filter(node => node.triggerLocalNodeId === localNode.id)
      .sort((a, b) => a.order - b.order)
      .map(node => ({
        id: node.id,
        kind: 'ai',
        triggerLocalNodeId: node.triggerLocalNodeId,
        text: node.content,
      }))

    visible.push(...aiNodes)
  }

  return visible
}

export function getCurrentNode(state) {
  return state.currentNode
}

export function getDraftAnswer(state) {
  const currentNode = getCurrentNode(state)
  if (!currentNode) return ''

  if (currentNode.kind === 'local') {
    return state.localResponses[currentNode.promptId]?.answer || ''
  }

  return state.aiResponses[currentNode.id]?.answer || ''
}

function setCurrentNodeAnswer(next, currentNode, answer, now) {
  const trimmed = answer.trim()

  if (currentNode.kind === 'local') {
    if (trimmed) {
      next.localResponses[currentNode.promptId] = { answer: trimmed, timestamp: now }
    } else {
      delete next.localResponses[currentNode.promptId]
    }
    return
  }

  if (trimmed) {
    next.aiResponses[currentNode.id] = {
      answer: trimmed,
      timestamp: now,
      triggerLocalNodeId: currentNode.triggerLocalNodeId,
    }
  } else {
    delete next.aiResponses[currentNode.id]
  }
}

export function syncDraftAnswer(state, { answer, now }) {
  const next = clone(state)
  const currentNode = getCurrentNode(state)
  if (!currentNode) return enrichState(next)

  setCurrentNodeAnswer(next, currentNode, answer, now)
  return enrichState(next)
}

export function createFlowState({ entryContent, now, snapshot = null, messages = null }) {
  if (snapshot) return enrichState(clone(snapshot))
  if (messages) return restoreFlowState({ entryContent, messages, now })

  const localNodes = getFilteredLocalNodes(entryContent)
  const firstLocal = localNodes[0]
  return enrichState({
    localNodes,
    displayedLocalCount: firstLocal ? 1 : 0,
    currentNodeId: firstLocal ? getLocalNodeKey(firstLocal.id) : null,
    localResponses: {},
    aiNodes: [],
    aiResponses: {},
    triggerLocalNodeId: null,
    activeAiNodeId: null,
    nextAiOrder: 1,
  })
}

export function restoreFlowState({ entryContent, messages, snapshot = null, now }) {
  if (snapshot) return enrichState(clone(snapshot))

  const state = createFlowState({ entryContent, now })
  const next = clone(state)
  const aiNodeById = {}

  for (const message of messages || []) {
    if (message.nodeType === 'local_prompt') {
      const localIndex = next.localNodes.findIndex(node => node.id === message.promptId)
      if (localIndex >= 0) {
        next.displayedLocalCount = Math.max(next.displayedLocalCount, localIndex + 1)
        const localNode = next.localNodes[localIndex]
        const altIndex = localNode.texts.findIndex(text => text === message.content)
        if (altIndex >= 0) next.localNodes[localIndex].altIndex = altIndex
      }
    }

    if (message.nodeType === 'local_answer') {
      next.localResponses[message.promptId] = {
        answer: message.content,
        timestamp: message.timestamp || now,
      }
    }

    if (message.nodeType === 'ai_prompt') {
      const id = message.id || `ai-restored-${next.nextAiOrder}`
      const aiNode = {
        id,
        triggerLocalNodeId: message.triggerLocalNodeId || message.promptId,
        content: message.content,
        timestamp: message.timestamp || now,
        order: next.nextAiOrder,
      }
      next.nextAiOrder += 1
      next.aiNodes.push(aiNode)
      aiNodeById[id] = aiNode
    }

    if (message.nodeType === 'ai_answer') {
      const aiNodeId = message.promptId
      if (aiNodeId) {
        next.aiResponses[aiNodeId] = {
          answer: message.content,
          timestamp: message.timestamp || now,
          triggerLocalNodeId: message.triggerLocalNodeId || aiNodeById[aiNodeId]?.triggerLocalNodeId || null,
        }
      }
    }
  }

  const nextLocalIndex = next.localNodes.findIndex(node => !next.localResponses[node.id])
  if (nextLocalIndex >= 0) {
    next.displayedLocalCount = Math.max(next.displayedLocalCount, nextLocalIndex + 1)
    next.currentNodeId = getLocalNodeKey(next.localNodes[nextLocalIndex].id)
  } else if (next.localNodes.length) {
    next.displayedLocalCount = next.localNodes.length
    next.currentNodeId = getLocalNodeKey(next.localNodes[next.localNodes.length - 1].id)
  } else {
    next.currentNodeId = null
  }

  return enrichState(next)
}

export function continueLocalNode(state, { answer, now }) {
  const next = clone(state)
  const currentNode = getCurrentNode(state)
  if (!currentNode || currentNode.kind !== 'local') return enrichState(next)

  if (answer.trim()) {
    next.localResponses[currentNode.promptId] = {
      answer: answer.trim(),
      timestamp: now,
    }
  } else {
    delete next.localResponses[currentNode.promptId]
  }

  const nextLocalIndex = currentNode.localIndex + 1
  if (nextLocalIndex < next.localNodes.length) {
    next.displayedLocalCount = Math.max(next.displayedLocalCount, nextLocalIndex + 1)
    next.currentNodeId = getLocalNodeKey(next.localNodes[nextLocalIndex].id)
    return enrichState(next)
  }

  next.currentNodeId = currentNode.id
  next.completed = true
  return enrichState(next)
}

export function rotateLocalPrompt(state) {
  const next = clone(state)
  const currentNode = getCurrentNode(state)
  if (!currentNode || currentNode.kind !== 'local') return enrichState(next)

  const localNode = next.localNodes[currentNode.localIndex]
  localNode.altIndex = ((localNode.altIndex || 0) + 1) % localNode.texts.length
  return enrichState(next)
}

export function enterAiMode(state, { draftLocalAnswer, aiBlock, aiNodeId, now }) {
  const next = clone(state)
  const currentNode = getCurrentNode(state)
  if (!currentNode || currentNode.kind !== 'local') return enrichState(next)

  if (draftLocalAnswer.trim()) {
    next.localResponses[currentNode.promptId] = {
      answer: draftLocalAnswer.trim(),
      timestamp: now,
    }
  }

  const aiNode = {
    id: aiNodeId,
    triggerLocalNodeId: currentNode.promptId,
    content: aiBlock,
    timestamp: now,
    order: next.nextAiOrder,
  }

  next.nextAiOrder += 1
  next.aiNodes.push(aiNode)
  next.triggerLocalNodeId = currentNode.promptId
  next.activeAiNodeId = aiNode.id
  next.currentNodeId = aiNode.id
  return enrichState(next)
}

export function continueAiNode(state, { answer, nextAiBlock, answerNow, nextAiNodeId, nextAiNow }) {
  const next = clone(state)
  const currentNode = getCurrentNode(state)
  if (!currentNode || currentNode.kind !== 'ai' || !next.activeAiNodeId) return enrichState(next)

  if (answer.trim()) {
    next.aiResponses[next.activeAiNodeId] = {
      answer: answer.trim(),
      timestamp: answerNow,
      triggerLocalNodeId: next.triggerLocalNodeId,
    }
  }

  const nextAiNode = {
    id: nextAiNodeId,
    triggerLocalNodeId: next.triggerLocalNodeId,
    content: nextAiBlock,
    timestamp: nextAiNow,
    order: next.nextAiOrder,
  }
  next.nextAiOrder += 1
  next.aiNodes.push(nextAiNode)
  next.activeAiNodeId = nextAiNode.id
  next.currentNodeId = nextAiNode.id
  return enrichState(next)
}

export function pauseAiMode(state, { draftAiAnswer, now }) {
  const next = clone(state)
  if (!next.activeAiNodeId || !next.triggerLocalNodeId) return enrichState(next)

  if (draftAiAnswer.trim()) {
    next.aiResponses[next.activeAiNodeId] = {
      answer: draftAiAnswer.trim(),
      timestamp: now,
      triggerLocalNodeId: next.triggerLocalNodeId,
    }
  }

  const triggerLocalNodeId = next.triggerLocalNodeId
  const triggerLocalAnswered = Boolean(next.localResponses[triggerLocalNodeId]?.answer?.trim())

  if (triggerLocalAnswered) {
    const nextBlankLocal = next.localNodes.find(node => !next.localResponses[node.id]?.answer?.trim())
    if (nextBlankLocal) {
      const nextBlankIdx = next.localNodes.findIndex(n => n.id === nextBlankLocal.id)
      next.displayedLocalCount = Math.max(next.displayedLocalCount, nextBlankIdx + 1)
      next.currentNodeId = getLocalNodeKey(nextBlankLocal.id)
    } else {
      next.currentNodeId = getLocalNodeKey(triggerLocalNodeId)
    }
  } else {
    next.currentNodeId = getLocalNodeKey(triggerLocalNodeId)
  }

  next.activeAiNodeId = null
  next.triggerLocalNodeId = null
  return enrichState(next)
}

export function moveToPreviousNode(state) {
  const next = clone(state)
  const visibleNodes = buildVisibleNodes(next)
  const currentIdx = visibleNodes.findIndex(node => node.id === next.currentNodeId)
  if (currentIdx <= 0) return enrichState(next)

  next.currentNodeId = visibleNodes[currentIdx - 1].id
  if (visibleNodes[currentIdx - 1].kind === 'ai') {
    const aiNode = next.aiNodes.find(node => node.id === visibleNodes[currentIdx - 1].id)
    next.activeAiNodeId = aiNode?.id || null
    next.triggerLocalNodeId = aiNode?.triggerLocalNodeId || null
  } else {
    next.activeAiNodeId = null
    next.triggerLocalNodeId = null
  }

  return enrichState(next)
}

export function moveToNextNode(state) {
  const next = clone(state)
  const visibleNodes = buildVisibleNodes(next)
  const currentIdx = visibleNodes.findIndex(node => node.id === next.currentNodeId)
  if (currentIdx < 0 || currentIdx >= visibleNodes.length - 1) return enrichState(next)

  next.currentNodeId = visibleNodes[currentIdx + 1].id
  if (visibleNodes[currentIdx + 1].kind === 'ai') {
    const aiNode = next.aiNodes.find(node => node.id === visibleNodes[currentIdx + 1].id)
    next.activeAiNodeId = aiNode?.id || null
    next.triggerLocalNodeId = aiNode?.triggerLocalNodeId || null
  } else {
    next.activeAiNodeId = null
    next.triggerLocalNodeId = null
  }

  return enrichState(next)
}

export function serializeFlowState(state) {
  return clone({
    localNodes: state.localNodes,
    displayedLocalCount: state.displayedLocalCount,
    currentNodeId: state.currentNodeId,
    localResponses: state.localResponses,
    aiNodes: state.aiNodes,
    aiResponses: state.aiResponses,
    triggerLocalNodeId: state.triggerLocalNodeId,
    activeAiNodeId: state.activeAiNodeId,
    nextAiOrder: state.nextAiOrder,
    completed: state.completed || false,
  })
}

export function buildConversationMessages(entry, state) {
  const messages = [
    {
      id: 'raw:entry',
      role: 'user',
      nodeType: 'raw_entry',
      content: entry.content,
      timestamp: entry.created_at || new Date().toISOString(),
    },
  ]

  for (const node of buildVisibleNodes(state)) {
    if (node.kind === 'local') {
      messages.push({
        id: node.id,
        role: 'local',
        nodeType: 'local_prompt',
        promptId: node.promptId,
        content: node.text,
        timestamp: state.localResponses[node.promptId]?.timestamp || entry.created_at || new Date().toISOString(),
      })

      const response = state.localResponses[node.promptId]
      if (response?.answer?.trim()) {
        messages.push({
          id: `local-answer:${node.promptId}`,
          role: 'user',
          nodeType: 'local_answer',
          promptId: node.promptId,
          content: response.answer.trim(),
          timestamp: response.timestamp,
        })
      }
    }

    if (node.kind === 'ai') {
      const aiNode = state.aiNodes.find(item => item.id === node.id)
      messages.push({
        id: aiNode.id,
        role: 'assistant',
        nodeType: 'ai_prompt',
        promptId: aiNode.id,
        triggerLocalNodeId: aiNode.triggerLocalNodeId,
        content: aiNode.content,
        timestamp: aiNode.timestamp,
      })

      const response = state.aiResponses[aiNode.id]
      if (response?.answer?.trim()) {
        messages.push({
          id: `ai-answer:${aiNode.id}`,
          role: 'user',
          nodeType: 'ai_answer',
          promptId: aiNode.id,
          triggerLocalNodeId: aiNode.triggerLocalNodeId,
          content: response.answer.trim(),
          timestamp: response.timestamp,
        })
      }
    }
  }

  return messages
}

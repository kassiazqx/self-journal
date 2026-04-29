import { getAwarenessStartTier } from './contentAnalysis.js'
import { EMOTION_NEGATIVE } from './emotionMap.js'

export const AWARENESS_QUESTIONS = [
  {
    id: 'focus',
    tier: 1,
    texts: [
      '这件事里，哪个时刻让你印象最深？',
      '整件事里，最触动你的一刻是什么？',
      '有没有哪个细节，现在想起来还很清晰？',
      '当时最让你在意的是哪一部分？',
      '是什么让你想把这件事写下来？',
      '你觉得这件事最重要的部分是什么？',
    ],
    showWhen: 'always',
  },
  {
    id: 'emotion',
    tier: 2,
    texts: [
      '心里什么滋味？这种感受你能准确描述吗？',
      '你注意到自己有哪些情绪？清晰还是混沌的？',
      '这种感受，你熟悉吗？',
      '除了这个，还藏有别的什么感受吗？',
      '有没有哪部分感受，连你自己也有点意外？',
    ],
    showWhen: 'always',
  },
  {
    id: 'body',
    tier: 3,
    texts: [
      '深呼吸，身体有什么明显感受？紧绷、沉重、发热、发凉，还是别的？',
      '胸口、肚子、喉咙，哪里有什么感觉？',
      '现在坐着，身体哪里是紧的？',
      '你注意到自己身体有什么变化吗？',
      '这种感觉有没有让你想做什么，或者不做什么？',
    ],
    showWhen: 'negative',
  },
  {
    id: 'acceptance',
    tier: 3,
    texts: [
      '你能允许这种感受就这样存在吗？有没有在试图让它快点消失？',
      '试着让这个感觉就在这里，不用做什么，只是让它在——可以吗？',
      '你有没有在评判自己"不应该有这种感受"？',
      '如果这个感受会说话，它想告诉你什么？',
      '你可以暂时不解决它，只是陪着它吗？',
      '如果不对抗这种感受，你觉得它会停多久？',
    ],
    showWhen: 'negative',
  },
  {
    id: 'thought',
    tier: 3,
    texts: [
      '当时脑子里第一个念头是什么？',
      '有没有什么话，脑子里说了但没说出口？',
      '那个念头，是全新的，还是之前也想过很多次了？',
      '当时最在意的是什么？',
      '这个想法，你相信它吗？',
    ],
    showWhen: 'always',
  },
  {
    id: 'behavior',
    tier: 4,
    texts: [
      '你的第一反应是什么？想做什么？',
      '你说了什么，或者选择了沉默？',
      '你当时怎么处理的？和你过往的模式有什么不一样吗？',
      '当时做了什么行动？是你满意的吗？',
    ],
    showWhen: 'always',
  },
  {
    id: 'need',
    tier: 4,
    texts: [
      '在这件事上，你最想要的是什么？',
      '这种感觉里，最重要的是什么？',
      '如果这件事能有一个最好的结果，那是什么样子？',
      '什么被触动了——是被理解、被接纳，还是安全感，或者别的？',
      '我的哪个价值观在这里被挑战了？',
      '这个反应，是你期待自己有的那种状态吗？',
    ],
    showWhen: 'always',
  },
  {
    id: 'cognitive',
    tier: 5,
    texts: [
      '你的感受是基于事实，还是你的解读？',
      '你认为这个感受的本质是什么？这个结论是怎么来的？',
      '为什么这个事实会让你有这种感受？',
      '这个想法，你完全相信它，还是有一部分在怀疑？',
      '这个想法有没有哪里是在对你特别严苛的？',
      '如果是你最在意的朋友经历了这一切，你会对ta说什么？',
      '10年后的你，回头看今天这件事，会怎么看它？',
    ],
    showWhen: 'always',
  },
  {
    id: 'insight',
    tier: 5,
    texts: [
      '聊到现在，有什么是刚才才意识到的吗？',
      '现在的感觉，和刚开始写的时候有什么不一样？',
      '这件事和你以前经历过的什么有点像？',
      '如果给今天的自己说一句话，会是什么？',
      '有没有什么，你觉得自己处理得还不错的？',
      '下次遇到类似的情况，你认为自己会有什么不同吗？',
      '如果这件事是来告诉你什么的，它想说什么？',
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

// AwarenessFlow 首次进入时的统一初始化入口：
// snapshot / 已存消息优先；只有全新进入且指定 ai 模式时，才直接种入首轮 AI 节点。
export function createInitialAwarenessState({
  entryContent,
  now,
  snapshot = null,
  messages = null,
  startMode = 'local',
  aiBlock = '',
  aiNodeId = null,
}) {
  const hasMessages = Array.isArray(messages) && messages.length > 0
  const baseState = createFlowState({
    entryContent,
    now,
    snapshot,
    messages: hasMessages ? messages : null,
  })

  if (snapshot || hasMessages || startMode !== 'ai') {
    return baseState
  }

  const trimmedBlock = typeof aiBlock === 'string' ? aiBlock.trim() : ''
  if (!trimmedBlock || !aiNodeId) {
    return baseState
  }

  return enterAiMode(baseState, {
    draftLocalAnswer: '',
    aiBlock: trimmedBlock,
    aiNodeId,
    now,
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

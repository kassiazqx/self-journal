import { useState, useEffect, useRef, useCallback } from 'react'
import { db } from '../lib/db'
import { callAI } from '../lib/aiClient'
import { AWARENESS_SYSTEM_PROMPT, buildAwarenessContext } from '../lib/prompts'
import {
  createInitialAwarenessState,
  getCurrentNode,
  getDraftAnswer,
  syncDraftAnswer,
  continueLocalNode,
  rotateLocalPrompt,
  enterAiMode,
  continueAiNode,
  pauseAiMode,
  moveToPreviousNode,
  moveToNextNode,
  serializeFlowState,
  buildConversationMessages,
} from '../lib/awarenessFlowState.js'

const ACTION_BAR_RESERVED_HEIGHT = 96

async function upsertConversation(userId, entryId, messages) {
  if (!messages.length) return
  const { error } = await db.from('conversations').upsert(
    {
      user_id: userId,
      entry_id: entryId,
      context_type: 'entry',
      messages,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'entry_id,context_type' },
  )
  if (error) {
    console.error('[AwarenessFlow] upsert 失败:', error.message, error)
  }
}

function createAiNodeId() {
  if (globalThis.crypto?.randomUUID) return `ai:${globalThis.crypto.randomUUID()}`
  return `ai:${Date.now()}:${Math.random().toString(16).slice(2)}`
}

export default function AwarenessFlow({
  entry,
  onComplete,
  onExit,
  initialFlowState,
  startMode = 'local',
}) {
  const [flowState, setFlowState] = useState(null)
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [opacity, setOpacity] = useState(1)
  const [transitioning, setTransitioning] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [bottomDockOffset, setBottomDockOffset] = useState(0)

  const textareaRef = useRef(null)
  const saveTimerRef = useRef(null)
  const latestStateRef = useRef(null)
  const initDoneRef = useRef(false)

  const currentNode = flowState ? getCurrentNode(flowState) : null
  const mode = currentNode?.kind === 'ai' ? 'ai' : 'local'

  useEffect(() => {
    latestStateRef.current = flowState
  }, [flowState])

  // ── 键盘高度只在 resize 时更新；内容区自己滚动 ──────────────────
  useEffect(() => {
    const vv = window.visualViewport

    function handleResize() {
      const navEl = document.querySelector('nav')
      const navHeight = navEl ? navEl.getBoundingClientRect().height : 0
      const keyboardInset = vv
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0
      setBottomDockOffset(keyboardInset > 60 ? keyboardInset : navHeight)
    }

    handleResize()
    if (!vv) return
    vv.addEventListener('resize', handleResize)
    window.addEventListener('resize', handleResize)
    return () => {
      vv.removeEventListener('resize', handleResize)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    initDoneRef.current = false
  }, [entry.id, initialFlowState, startMode])

  useEffect(() => {
    if (initDoneRef.current) return
    initDoneRef.current = true
    let cancelled = false

    setFlowState(null)
    setCurrentAnswer('')
    setAiLoading(false)
    setAiError('')

    async function init() {
      const now = new Date().toISOString()
      const contextEntry = {
        content: entry.content,
        created_at: entry.created_at,
      }

      if (initialFlowState) {
        const restoredSnapshotState = createInitialAwarenessState({
          entryContent: entry.content,
          now,
          snapshot: initialFlowState,
          messages: null,
        })
        if (cancelled) return
        setFlowState(restoredSnapshotState)
        setCurrentAnswer(getDraftAnswer(restoredSnapshotState))
        return
      }

      const { data } = await db.from('conversations')
        .select('messages')
        .eq('entry_id', entry.id)
        .eq('context_type', 'entry')
        .maybeSingle()

      if (cancelled) return

      if (Array.isArray(data?.messages) && data.messages.length > 0) {
        const restoredState = createInitialAwarenessState({
          entryContent: entry.content,
          now: new Date().toISOString(),
          snapshot: null,
          messages: data.messages,
        })
        setFlowState(restoredState)
        setCurrentAnswer(getDraftAnswer(restoredState))
        return
      }

      const baseState = createInitialAwarenessState({
        entryContent: entry.content,
        now: new Date().toISOString(),
        snapshot: null,
        messages: null,
      })

      if (startMode !== 'ai') {
        setFlowState(baseState)
        setCurrentAnswer(getDraftAnswer(baseState))
        return
      }

      setAiLoading(true)

      try {
        const ctxMessages = buildConversationMessages(contextEntry, baseState)
        const raw = await callAI(
          [{ role: 'user', content: buildAwarenessContext(entry.content, ctxMessages) }],
          AWARENESS_SYSTEM_PROMPT,
          { maxTokens: 220 },
        )
        if (cancelled) return

        const nextState = createInitialAwarenessState({
          entryContent: entry.content,
          now: new Date().toISOString(),
          snapshot: null,
          messages: null,
          startMode: 'ai',
          aiBlock: raw,
          aiNodeId: createAiNodeId(),
        })
        setFlowState(nextState)
        setCurrentAnswer(getDraftAnswer(nextState))
      } catch (error) {
        if (cancelled) return
        console.error('[AwarenessFlow] AI 首轮引导失败:', error)
        setFlowState(baseState)
        setCurrentAnswer(getDraftAnswer(baseState))
        setAiError(error.message || 'AI 调用失败，请稍后再试')
      } finally {
        if (!cancelled) setAiLoading(false)
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [entry.id, entry.content, entry.created_at, initialFlowState, startMode])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (!latestStateRef.current) return
      const messages = buildConversationMessages(entry, latestStateRef.current)
      upsertConversation(entry.user_id, entry.id, messages)
    }
  }, [entry])

  const scheduleSave = useCallback((stateToSave) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const messages = buildConversationMessages(entry, stateToSave)
      upsertConversation(entry.user_id, entry.id, messages)
    }, 800)
  }, [entry])

  async function saveImmediately(stateToSave) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const messages = buildConversationMessages(entry, stateToSave)
    await upsertConversation(entry.user_id, entry.id, messages)
  }

  async function fadeTo(nextState) {
    setTransitioning(true)
    setOpacity(0)
    await new Promise(resolve => setTimeout(resolve, 260))
    setFlowState(nextState)
    setCurrentAnswer(getDraftAnswer(nextState))
    setTransitioning(false)
    setOpacity(1)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  function syncAnswerDraft(answer) {
    setCurrentAnswer(answer)
    if (!flowState) return
    setFlowState(prev => prev ? syncDraftAnswer(prev, { answer, now: new Date().toISOString() }) : prev)
    if (aiError) setAiError('')
  }

  function persistLocalDraft(baseState) {
    return syncDraftAnswer(baseState, {
      answer: currentAnswer,
      now: new Date().toISOString(),
    })
  }

  async function handleRefresh() {
    if (!flowState || mode === 'ai') return
    const nextState = rotateLocalPrompt(flowState)
    setAiError('')
    setFlowState(nextState)
    setCurrentAnswer(getDraftAnswer(nextState))
    scheduleSave(nextState)
  }

  async function handleBack() {
    if (!flowState || transitioning || aiLoading) return

    const persisted = persistLocalDraft(flowState)
    const previousState = moveToPreviousNode(persisted)
    scheduleSave(previousState)

    if (previousState.currentNodeId === persisted.currentNodeId) {
      await saveImmediately(previousState)
      onExit(serializeFlowState(previousState))
      return
    }

    await fadeTo(previousState)
  }

  async function handleStepForward() {
    if (!flowState || transitioning || aiLoading) return

    const persisted = persistLocalDraft(flowState)
    const nextState = moveToNextNode(persisted)
    if (nextState.currentNodeId !== persisted.currentNodeId) {
      scheduleSave(nextState)
      await fadeTo(nextState)
      return
    }

    if (mode === 'ai') {
      await handleNext()
      return
    }

    const continuedState = continueLocalNode(persisted, {
      answer: currentAnswer,
      now: new Date().toISOString(),
    })

    if (continuedState.completed) {
      setFlowState(continuedState)
      await saveImmediately(continuedState)
      onComplete()
      return
    }

    scheduleSave(continuedState)
    await fadeTo(continuedState)
  }

  async function handleNext() {
    if (!flowState || transitioning || aiLoading) return

    if (mode === 'ai') {
      if (!currentAnswer.trim()) return

      const answerNow = new Date().toISOString()
      setAiLoading(true)
      setAiError('')

      try {
        const ctxMessages = buildConversationMessages(entry, flowState)
        const raw = await callAI(
          [{ role: 'user', content: buildAwarenessContext(entry.content, ctxMessages) }],
          AWARENESS_SYSTEM_PROMPT,
          { maxTokens: 220 },
        )
        const block = raw.trim()
        if (!block) throw new Error('AI 没有返回引导内容')

        const nextState = continueAiNode(flowState, {
          answer: currentAnswer,
          nextAiBlock: block,
          answerNow,
          nextAiNodeId: createAiNodeId(),
          nextAiNow: new Date().toISOString(),
        })

        setFlowState(nextState)
        setCurrentAnswer('')
        scheduleSave(nextState)
      } catch (error) {
        console.error('[AwarenessFlow] AI 下一轮失败:', error)
        setAiError(error.message || 'AI 下一轮失败，请稍后再试')
      } finally {
        setAiLoading(false)
      }
      return
    }

    const nextState = continueLocalNode(flowState, {
      answer: currentAnswer,
      now: new Date().toISOString(),
    })

    if (nextState.completed) {
      setFlowState(nextState)
      await saveImmediately(nextState)
      onComplete()
      return
    }

    scheduleSave(nextState)
    await fadeTo(nextState)
  }

  async function handleSaveExit() {
    if (!flowState) return
    const persisted = persistLocalDraft(flowState)
    setFlowState(persisted)
    await saveImmediately(persisted)
    onComplete()
  }

  async function handleToggleAI() {
    if (!flowState || transitioning || aiLoading) return

    if (mode === 'ai') {
      const nextState = pauseAiMode(flowState, {
        draftAiAnswer: currentAnswer,
        now: new Date().toISOString(),
      })
      setAiError('')
      setFlowState(nextState)
      setCurrentAnswer(getDraftAnswer(nextState))
      scheduleSave(nextState)
      return
    }

    const draftSynced = persistLocalDraft(flowState)
    setFlowState(draftSynced)
    setCurrentAnswer('')
    setAiError('')
    setAiLoading(true)

    try {
      const ctxMessages = buildConversationMessages(entry, draftSynced)
      const raw = await callAI(
        [{ role: 'user', content: buildAwarenessContext(entry.content, ctxMessages) }],
        AWARENESS_SYSTEM_PROMPT,
        { maxTokens: 220 },
      )
      const block = raw.trim()
      if (!block) throw new Error('AI 没有返回引导内容')

      const nextState = enterAiMode(draftSynced, {
        draftLocalAnswer: currentAnswer,
        aiBlock: block,
        aiNodeId: createAiNodeId(),
        now: new Date().toISOString(),
      })
      setFlowState(nextState)
      setCurrentAnswer(getDraftAnswer(nextState))
      scheduleSave(nextState)
    } catch (error) {
      console.error('[AwarenessFlow] AI 调用失败:', error)
      setFlowState(draftSynced)
      setCurrentAnswer(getDraftAnswer(draftSynced))
      setAiError(error.message || 'AI 调用失败，请稍后再试')
    } finally {
      setAiLoading(false)
    }
  }

  if (!flowState || !currentNode) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        background: '#faf8f4',
        color: '#bbb',
        fontSize: 14,
      }}>
        {aiLoading ? 'AI 正在生成引导…' : '正在准备觉察卡片…'}
      </div>
    )
  }

  const canRefresh = mode === 'local' && (currentNode?.text ? flowState.localNodes[currentNode.localIndex]?.texts?.length > 1 : false)
  const isAtLastVisibleNode = flowState.currentIdx === flowState.visibleNodes.length - 1
  const nextLabel = mode === 'ai' ? '继续 →' : (isAtLastVisibleNode && flowState.visibleNodes.filter(node => node.kind === 'local').length === flowState.localNodes.length ? '完成 ✓' : '继续 →')
  const scrollContentBottomPadding = bottomDockOffset + ACTION_BAR_RESERVED_HEIGHT

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#faf8f4',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px 0', gap: 10 }}>
        <button
          onClick={handleBack}
          style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 13, padding: 0 }}
        >
          ← 上一张
        </button>
        <span style={{ fontSize: 11, color: '#ddd', letterSpacing: '0.5px', flex: 1, textAlign: 'center' }}>
          {flowState.currentIdx + 1} / {flowState.visibleNodes.length}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={handleStepForward}
            disabled={aiLoading || transitioning || (mode === 'ai' && !currentAnswer.trim())}
            style={{
              background: 'none',
              border: 'none',
              color: (aiLoading || transitioning || (mode === 'ai' && !currentAnswer.trim())) ? '#e0ddd8' : '#bbb',
              cursor: (aiLoading || transitioning || (mode === 'ai' && !currentAnswer.trim())) ? 'default' : 'pointer',
              fontSize: 13,
              padding: 0,
            }}
          >
            下一张 →
          </button>
          <button
            onClick={handleSaveExit}
            style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 13, padding: 0 }}
          >
            保存
          </button>
        </div>
      </div>

      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        overscrollBehaviorY: 'contain',
        padding: '32px 24px 0',
        paddingBottom: scrollContentBottomPadding,
        scrollPaddingBottom: scrollContentBottomPadding,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        opacity,
        transition: 'opacity 0.26s ease',
      }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 500, color: '#333', lineHeight: 1.65, marginBottom: 8, whiteSpace: 'pre-wrap' }}>
            {aiLoading
              ? <span style={{ color: '#ccc', fontSize: 15 }}>AI 正在生成引导…</span>
              : currentNode.text}
          </div>

          {!aiLoading && canRefresh && (
            <button
              onClick={handleRefresh}
              style={{ background: 'none', border: 'none', fontSize: 11, color: '#ccc', cursor: 'pointer', padding: 0, letterSpacing: '0.3px' }}
            >
              换一个问题 ↻
            </button>
          )}

          {aiError && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#c96b6b', lineHeight: 1.6 }}>
              {aiError}
            </div>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={currentAnswer}
          onChange={e => syncAnswerDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleNext()
          }}
          placeholder="写下你的回答…"
          autoFocus
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            resize: 'none',
            fontSize: 15,
            lineHeight: 1.85,
            color: '#2d2d2d',
            fontFamily: 'inherit',
            caretColor: '#aaa',
            padding: 0,
          }}
        />
      </div>

      <div style={{
        position: 'fixed',
        left: '50%',
        width: '100%',
        maxWidth: 480,
        transform: 'translateX(-50%)',
        bottom: bottomDockOffset,
        padding: '8px 18px 26px',
        background: 'linear-gradient(transparent, #faf8f4 38%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 40,
      }}>
        <button
          onClick={handleToggleAI}
          disabled={aiLoading || transitioning}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'none',
            border: 'none',
            cursor: aiLoading ? 'default' : 'pointer',
            padding: 0,
            opacity: aiLoading ? 0.5 : 1,
          }}
        >
          <div style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: '#f0ece4',
            border: `1px solid ${mode === 'ai' ? '#c9a96e' : '#ddd8cf'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            color: '#b8a88a',
          }}>✦</div>
          <span style={{ fontSize: 10, color: '#ddd' }}>
            {aiLoading ? '思考中…' : mode === 'ai' ? '× 暂停引导' : '深入觉察'}
          </span>
        </button>

        <button
          onClick={handleNext}
          disabled={transitioning || aiLoading || (mode === 'ai' && !currentAnswer.trim())}
          style={{
            padding: '10px 24px',
            borderRadius: 22,
            background: (!aiLoading && (mode === 'local' || currentAnswer.trim())) ? '#2d2928' : '#e8e3dc',
            color: (!aiLoading && (mode === 'local' || currentAnswer.trim())) ? 'white' : '#bbb',
            fontSize: 14,
            border: 'none',
            cursor: (!aiLoading && (mode === 'local' || currentAnswer.trim())) ? 'pointer' : 'default',
            transition: 'background 0.2s, color 0.2s',
            boxShadow: (!aiLoading && (mode === 'local' || currentAnswer.trim())) ? '0 2px 10px rgba(0,0,0,0.15)' : 'none',
          }}
        >
          {aiLoading ? '思考中…' : nextLabel}
        </button>
      </div>
    </div>
  )
}

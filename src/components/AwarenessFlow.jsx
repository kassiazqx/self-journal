/**
 * AwarenessFlow.jsx — 单屏觉察流
 *
 * 导航逻辑：
 *   「← 上一题」：退回上一张卡片（答案保留）；第一题时变「退出」→ 去列表
 *   「继续 →」  ：保存当前答案，进入下一题
 *   「完成 ✓」  ：最后一题，保存后去列表
 *   「保存退出」：随时可用，保存已答内容后去列表
 *   「换一个问题」：循环切换备选文本
 *
 * 数据流：
 *   所有答案保存在 answers[] + currentAnswer（不丢失，卡片切换时互相恢复）
 *   每次前进/后退都触发 debounce 800ms upsert 到 conversations 表
 *   组件卸载（任意退出方式）时立即 upsert（cleanup）
 *
 * Props:
 *   entry       { id, content, template_type, user_id, created_at }
 *   onComplete  () => void   全部答完 → 去列表
 *   onExit      () => void   中途退出 → 去列表
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { db } from '../lib/db'
import { getAwarenessStartTier } from '../lib/contentAnalysis'
import { EMOTION_NEGATIVE } from '../lib/emotionMap'

// ─── 问题库（每题 3 个备选文本，「换一个」循环）──────────────────────
const QUESTION_POOL = [
  {
    id: 'context', tier: 1, showWhen: 'always',
    texts: [
      '能多说一点当时的情况吗？',
      '当时是在哪里、和谁在一起？',
      '这件事是怎么开始的？',
    ],
  },
  {
    id: 'emotion', tier: 2, showWhen: 'always',
    texts: [
      '当时你是什么感觉？',
      '你注意到自己有哪些情绪？',
      '心里是什么滋味？',
    ],
  },
  {
    id: 'body', tier: 3, showWhen: 'negative',
    texts: [
      '这个感觉在身体哪里？',
      '身体有什么紧绷或不舒服的地方吗？',
      '用什么词描述这个感觉——紧、沉、热，还是别的？',
    ],
  },
  {
    id: 'thought', tier: 3, showWhen: 'always',
    texts: [
      '当时你脑子里第一个念头是什么？',
      '那个时刻最先冒出来的词或句子是什么？',
      '你当时对自己说了什么？',
    ],
  },
  {
    id: 'need', tier: 4, showWhen: 'always',
    texts: [
      '在这件事上，你真正需要的是什么？',
      '这件事触动了什么——被理解、安全感，还是别的？',
      '如果最好的结果出现，它会是什么样子？',
    ],
  },
  {
    id: 'insight', tier: 5, showWhen: 'always',
    texts: [
      '写完这些，有什么是刚才才意识到的吗？',
      '如果给今天的自己说一句话，会是什么？',
      '回头看，你觉得自己处理得怎么样？',
    ],
  },
]

// ─── 保存到 conversations 表（UPSERT）────────────────────────────────
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
    { onConflict: 'entry_id,context_type' }
  )
  if (error) console.error('[AwarenessFlow] upsert 失败:', error.message)
}

// ─── 主组件 ─────────────────────────────────────────────────────────
export default function AwarenessFlow({ entry, onComplete, onExit,
  initialAnswers, initialAltIndices, initialTimestamps, initialIdx }) {
  const [questions, setQuestions]         = useState([])
  const [currentIdx, setCurrentIdx]       = useState(0)
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [answers, setAnswers]             = useState([])    // 每题已确认答案（前进/后退时保留）
  const [altIndices, setAltIndices]       = useState([])   // 每题当前备选文本的 index
  const [timestamps, setTimestamps]       = useState([])   // 每题首次提交时的时间戳
  const [opacity, setOpacity]             = useState(1)
  const [transitioning, setTransitioning] = useState(false)

  const textareaRef  = useRef(null)
  const saveTimerRef = useRef(null)

  // 把最新 state 存进 ref，供 cleanup 使用（避免 stale closure）
  const latestRef = useRef({})
  latestRef.current = { questions, answers, currentIdx, currentAnswer, altIndices, timestamps }

  // ── 初始化：过滤问题，分配状态数组 ──────────────────────────────
  useEffect(() => {
    const startTier = getAwarenessStartTier(entry.content)
    const hasNeg    = EMOTION_NEGATIVE.some(w => entry.content.includes(w))
    const filtered  = QUESTION_POOL.filter(q => {
      if (q.tier < startTier) return false
      if (q.showWhen === 'negative' && !hasNeg) return false
      return true
    })
    const n       = filtered.length
    const initAns = initialAnswers  || Array(n).fill('')
    const startIdx = Math.min(initialIdx ?? 0, n - 1)
    setQuestions(filtered)
    setAnswers(initAns)
    setAltIndices(initialAltIndices || Array(n).fill(0))
    setTimestamps(initialTimestamps || Array(n).fill(null))
    setCurrentIdx(startIdx)
    setCurrentAnswer(initAns[startIdx] || '')
  }, [entry.id, entry.content])

  // ── 组件卸载时立即保存（不管是哪种退出方式）───────────────────
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      const s = latestRef.current
      const msgs = buildMessages(s, entry)
      upsertConversation(entry.user_id, entry.id, msgs)
    }
  }, [entry.id, entry.user_id])

  // ── 构建 messages 数组（供 upsert 用）────────────────────────────
  function buildMessages({ questions, answers, currentIdx, currentAnswer, altIndices, timestamps }, entry) {
    const msgs = [{
      role: 'user',
      content: entry.content,
      timestamp: entry.created_at || new Date().toISOString(),
      source: 'raw',
    }]
    for (let i = 0; i < questions.length; i++) {
      const ans = i === currentIdx ? currentAnswer : answers[i]
      if (!ans?.trim()) continue
      const qText = questions[i].texts[altIndices[i] || 0]
      const ts    = timestamps[i] || new Date().toISOString()
      msgs.push({ role: 'local', content: qText,      timestamp: ts, source: 'local_question' })
      msgs.push({ role: 'user',  content: ans.trim(), timestamp: ts, source: 'local_answer'   })
    }
    return msgs
  }

  // ── debounce 保存 ─────────────────────────────────────────────────
  const scheduleSave = useCallback((msgs) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      upsertConversation(entry.user_id, entry.id, msgs)
    }, 800)
  }, [entry.user_id, entry.id])

  // ── 渐变切换 ─────────────────────────────────────────────────────
  async function fade(fn) {
    setTransitioning(true)
    setOpacity(0)
    await new Promise(r => setTimeout(r, 260))
    fn()
    setTransitioning(false)
    setOpacity(1)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  // ── 换一个问题（循环备选文本）────────────────────────────────────
  function handleRefresh() {
    setAltIndices(prev => {
      const next = [...prev]
      next[currentIdx] = (next[currentIdx] + 1) % questions[currentIdx].texts.length
      return next
    })
  }

  // ── ← 上一题（或退出）────────────────────────────────────────────
  async function handleBack() {
    // 把当前输入存回 answers（保留，即使是空的）
    const newAnswers = [...answers]
    newAnswers[currentIdx] = currentAnswer
    setAnswers(newAnswers)

    const msgs = buildMessages(
      { questions, answers: newAnswers, currentIdx, currentAnswer, altIndices, timestamps },
      entry
    )
    scheduleSave(msgs)

    if (currentIdx === 0) {
      // 已在第一题：保存后回到写作页，同时带上答题状态
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      await upsertConversation(entry.user_id, entry.id, msgs)
      // 找到最后有内容的卡片 index
      let lastIdx = 0
      for (let i = newAnswers.length - 1; i >= 0; i--) {
        if (newAnswers[i]?.trim()) { lastIdx = i; break }
      }
      onExit({ answers: newAnswers, altIndices, timestamps, lastIdx })
      return
    }

    await fade(() => {
      const prev = currentIdx - 1
      setCurrentIdx(prev)
      setCurrentAnswer(newAnswers[prev])   // 恢复上一题的已保存答案
    })
  }

  // ── 继续下一题（或完成）──────────────────────────────────────────
  async function handleNext() {
    if (!currentAnswer.trim() || transitioning) return

    const now = new Date().toISOString()
    const newAnswers    = [...answers];    newAnswers[currentIdx]    = currentAnswer
    const newTimestamps = [...timestamps]; if (!newTimestamps[currentIdx]) newTimestamps[currentIdx] = now

    setAnswers(newAnswers)
    setTimestamps(newTimestamps)

    const msgs = buildMessages(
      { questions, answers: newAnswers, currentIdx, currentAnswer, altIndices, timestamps: newTimestamps },
      entry
    )

    if (currentIdx === questions.length - 1) {
      // 最后一题：立即保存后完成
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      await upsertConversation(entry.user_id, entry.id, msgs)
      onComplete()
      return
    }

    scheduleSave(msgs)

    await fade(() => {
      const next = currentIdx + 1
      setCurrentIdx(next)
      setCurrentAnswer(newAnswers[next])   // 如果曾后退过，恢复之前填过的答案
    })
  }

  // ── 保存退出 ─────────────────────────────────────────────────────
  async function handleSaveExit() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const newAnswers = [...answers]; newAnswers[currentIdx] = currentAnswer
    const msgs = buildMessages(
      { questions, answers: newAnswers, currentIdx, currentAnswer, altIndices, timestamps },
      entry
    )
    await upsertConversation(entry.user_id, entry.id, msgs)
    onComplete()
  }

  // ── 渲染 ─────────────────────────────────────────────────────────
  if (questions.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#faf8f4', color: '#ccc', fontSize: 14 }}>
        准备中…
      </div>
    )
  }

  const currentQ = questions[currentIdx]?.texts[altIndices[currentIdx] || 0] ?? ''
  const hasAlts  = (questions[currentIdx]?.texts?.length ?? 1) > 1
  const isFirst  = currentIdx === 0
  const isLast   = currentIdx === questions.length - 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: '#faf8f4', position: 'relative' }}>

      {/* 顶部导航 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 18px 0' }}>
        <button onClick={handleBack}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 13, padding: 0 }}>
          ← 上一题
        </button>
        <span style={{ fontSize: 11, color: '#ddd', letterSpacing: '0.5px' }}>
          {currentIdx + 1} / {questions.length}
        </span>
        <button onClick={handleSaveExit}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 13, padding: 0 }}>
          保存退出
        </button>
      </div>

      {/* 问题 + 输入区（渐变切换） */}
      <div style={{ flex: 1, padding: '32px 24px 90px', display: 'flex',
        flexDirection: 'column', gap: 20,
        opacity, transition: 'opacity 0.26s ease' }}>

        {/* 问题文字 + 换一个 */}
        <div>
          <div style={{ fontSize: 17, fontWeight: 500, color: '#333',
            lineHeight: 1.65, marginBottom: 8 }}>
            {currentQ}
          </div>
          {hasAlts && (
            <button onClick={handleRefresh}
              style={{ background: 'none', border: 'none', fontSize: 11,
                color: '#ccc', cursor: 'pointer', padding: 0, letterSpacing: '0.3px' }}>
              换一个问题 ↻
            </button>
          )}
        </div>

        {/* 回答输入 */}
        <textarea
          ref={textareaRef}
          value={currentAnswer}
          onChange={e => setCurrentAnswer(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleNext() }}
          placeholder="写下你的回答…"
          autoFocus
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent',
            resize: 'none', fontSize: 15, lineHeight: 1.85, color: '#2d2d2d',
            fontFamily: 'inherit', caretColor: '#aaa', padding: 0 }}
        />
      </div>

      {/* 底部浮动栏 */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '8px 18px 26px',
        background: 'linear-gradient(transparent, #faf8f4 38%)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

        {/* 左：✦ 深入觉察（Task 7 实现 AI 接手，现在占位） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#f0ece4',
            border: '1px solid #ddd8cf', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 11, color: '#b8a88a' }}>✦</div>
          <span style={{ fontSize: 10, color: '#ddd' }}>深入觉察</span>
        </div>

        {/* 右：继续 / 完成 */}
        <button onClick={handleNext}
          disabled={!currentAnswer.trim() || transitioning}
          style={{ padding: '10px 24px', borderRadius: 22,
            background: currentAnswer.trim() ? '#2d2928' : '#e8e3dc',
            color: currentAnswer.trim() ? 'white' : '#bbb',
            fontSize: 14, border: 'none',
            cursor: currentAnswer.trim() ? 'pointer' : 'default',
            transition: 'background 0.2s, color 0.2s',
            boxShadow: currentAnswer.trim() ? '0 2px 10px rgba(0,0,0,0.15)' : 'none' }}>
          {isLast ? '完成 ✓' : '继续 →'}
        </button>
      </div>
    </div>
  )
}

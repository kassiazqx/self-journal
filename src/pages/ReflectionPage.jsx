// src/pages/ReflectionPage.jsx
import { useState, useRef } from 'react'
import { updateEntry } from '../lib/journalService'
import { getCardsForEntry } from '../lib/reflectionQuestions'

/**
 * Props:
 *   entry      — 已保存的日记条目（含 id, user_id, emotions, content 等）
 *   onClose    — 关闭页面回调（返回记录列表）
 *   onStartAI  — 唤起 AI 对话回调，传入带 _reflectionAnswers 的 entry
 */
export default function ReflectionPage({ entry, onClose, onStartAI, initialIndex = 0, onIndexChange, initialAnswers = {}, onAnswersChange }) {
  const cards = getCardsForEntry(entry)
  const total = cards.length

  // 当前卡片索引（从外部传入初始值，切换时通知父组件）
  const [currentIndex, setCurrentIndex] = useState(
    () => Math.min(initialIndex, cards.length - 1)
  )

  // 每张卡片当前使用的问题索引（默认 0）
  const [questionIndexes, setQuestionIndexes] = useState(
    () => Object.fromEntries(cards.map(c => [c.id, 0]))
  )

  // 每张卡片的输入内容
  // 优先使用父组件保管的 initialAnswers（AI 来回不丢失），再 fallback 到 entry 字段
  const [answers, setAnswers] = useState(() => {
    return Object.fromEntries(cards.map(c => {
      if (initialAnswers[c.id] !== undefined && initialAnswers[c.id] !== '') {
        return [c.id, initialAnswers[c.id]]
      }
      const raw = entry[c.field]
      const value = Array.isArray(raw) ? raw.join('、') : (raw ?? '')
      return [c.id, value]
    }))
  })

  // 触摸滑动检测
  const touchStartX = useRef(null)

  const card = cards[currentIndex]

  // ── 换一个问题（同字段随机换，不重复当前）────────────────────
  const handleRefreshQuestion = () => {
    const pool = card.questions
    if (pool.length <= 1) return
    const currentQ = questionIndexes[card.id]
    let next = currentQ
    while (next === currentQ) {
      next = Math.floor(Math.random() * pool.length)
    }
    setQuestionIndexes(prev => ({ ...prev, [card.id]: next }))
  }

  // text[] 类型字段需要包成数组再存；其余字段直接存字符串
  const ARRAY_FIELDS = new Set(['core_needs', 'emotions', 'category_tags', 'people_involved'])
  const toSaveValue = (field, value) =>
    ARRAY_FIELDS.has(field) ? [value.trim()] : value.trim()

  // ── 输入框 onBlur：fire-and-forget 保存到对应字段 ────────────
  const handleBlur = (cardId, field, value) => {
    if (!value?.toString().trim()) return
    updateEntry({ id: entry.id, userId: entry.user_id, fields: { [field]: toSaveValue(field, value) } })
      .then(({ error: e }) => { if (e) console.error('[reflection] 保存失败:', e, field) })
  }

  // ── 更新答案（同时同步给父组件，防卸载丢失）──────────────────
  const updateAnswer = (cardId, value) => {
    const next = { ...answers, [cardId]: value }
    setAnswers(next)
    onAnswersChange?.(next)
  }

  // ── 切换卡片（同时通知父组件保存 index）────────────────────
  const goTo = (index) => {
    if (index >= 0 && index < total) {
      setCurrentIndex(index)
      onIndexChange?.(index)
    }
  }

  // ── 触摸滑动 ─────────────────────────────────────────────────
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX
  }
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return
    const diff = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(diff) < 50) return // 小于 50px 不算滑动
    if (diff > 0) goTo(currentIndex + 1) // 左滑 → 下一张
    else goTo(currentIndex - 1)           // 右滑 → 上一张
    touchStartX.current = null
  }

  // ── 唤起 AI：先保存当前卡片内容，再跳转 ──────────────────────
  const handleStartAI = () => {
    // 主动保存当前卡片（防止 onBlur 未触发），同样走 toSaveValue 转换
    const currentAnswer = answers[card.id]
    if (currentAnswer?.toString().trim()) {
      updateEntry({
        id: entry.id,
        userId: entry.user_id,
        fields: { [card.field]: toSaveValue(card.field, currentAnswer) },
      }).then(({ error: e }) => { if (e) console.error('[reflection] AI前保存失败:', e) })
    }

    const filledAnswers = cards
      .filter(c => answers[c.id]?.toString().trim())
      .map(c => `${c.label}：${answers[c.id].toString().trim()}`)
      .join('\n')

    // 通知父组件保存当前 index，回来后恢复
    onIndexChange?.(currentIndex)

    onStartAI({
      ...entry,
      _reflectionAnswers: filledAnswers || null,
    })
  }

  const currentQuestion = card.questions[questionIndexes[card.id]]

  return (
    <div
      className="flex flex-col h-full bg-[#fdfaf7]"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
        <button
          onClick={() => goTo(currentIndex - 1)}
          className={`text-sm text-gray-400 w-14 text-left active:scale-95 transition-transform ${
            currentIndex === 0 ? 'invisible' : ''
          }`}
        >
          ‹ {currentIndex}/{total}
        </button>
        <h2 className="text-base font-semibold text-gray-800">深度复盘</h2>
        <button
          onClick={onClose}
          className="text-sm text-gray-400 w-14 text-right active:scale-95 transition-transform"
        >
          保存
        </button>
      </div>

      {/* 卡片区 */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm min-h-[280px] flex flex-col">
          {/* 字段标签 */}
          <p className="text-xs text-gray-400 mb-3">{card.label}</p>

          {/* 问题文字 */}
          <p className="text-base font-medium text-gray-700 leading-relaxed mb-4">
            {currentQuestion}
          </p>

          {/* 输入框 */}
          <textarea
            value={answers[card.id]}
            onChange={e => updateAnswer(card.id, e.target.value)}
            onBlur={e => handleBlur(card.id, card.field, e.target.value)}
            placeholder="写下来…"
            className="flex-1 w-full min-h-[120px] bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:border-primary-300 resize-none leading-relaxed"
          />

          {/* 换一个问题 */}
          {card.questions.length > 1 && (
            <button
              onClick={handleRefreshQuestion}
              className="mt-3 flex items-center gap-1.5 text-xs text-gray-400 active:scale-95 transition-transform self-start"
            >
              <span>↻</span>
              <span>换一个问题</span>
            </button>
          )}
        </div>
      </div>

      {/* 底部：AI 按钮 + 进度点 */}
      <div className="px-4 pb-8 flex-shrink-0">
        {/* ✦ AI 按钮（右对齐） */}
        <div className="flex justify-end mb-4">
          <button
            onClick={handleStartAI}
            className="w-10 h-10 bg-white border border-primary-200 rounded-full flex items-center justify-center text-primary-400 shadow-sm active:scale-95 transition-transform"
            title="和 AI 聊聊这个"
          >
            <span style={{ fontSize: '15px' }}>✦</span>
          </button>
        </div>

        {/* 进度点 */}
        <div className="flex justify-center gap-2">
          {cards.map((c, i) => (
            <button
              key={c.id}
              onClick={() => goTo(i)}
              className={`transition-all duration-200 rounded-full ${
                i === currentIndex
                  ? 'w-4 h-1.5 bg-primary-500'
                  : 'w-1.5 h-1.5 bg-gray-200'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

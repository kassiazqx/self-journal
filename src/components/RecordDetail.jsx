// src/components/RecordDetail.jsx
// 记录详情页：三段式布局（核心字段卡 → 关联标签 → 统一记录流）
// 情绪标签可点击内联编辑，使用本地 mapDisplayToBase，不调 AI
import { useState, useEffect } from 'react'
import { db } from '../lib/db'
import { updateEntry } from '../lib/journalService'
import { resolveTemplate } from '../lib/templates'
import { mapDisplayToBase } from '../lib/emotionMap'
import { extractFields } from '../lib/conversationService'

function formatDateTime(isoStr) {
  const d = new Date(isoStr)
  return (
    d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  )
}

// 情绪胶囊标签（只展示用）
function EmotionTag({ word }) {
  return (
    <span style={{
      fontSize: 12,
      background: '#f0ece4',
      color: '#8a7a6a',
      padding: '3px 10px',
      borderRadius: 20,
      display: 'inline-block',
    }}>
      {word}
    </span>
  )
}

// 核心字段单行（空时不渲染）
function FieldRow({ label, value }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null
  const display = Array.isArray(value) ? value.join('、') : value
  return (
    <div style={{ display: 'flex', gap: 12, paddingBottom: 6, alignItems: 'flex-start' }}>
      <span style={{
        fontSize: 10, color: '#aaa', flexShrink: 0,
        minWidth: 44, paddingTop: 2,
      }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>{display}</span>
    </div>
  )
}

// EditableFieldRow：可内联编辑的字段行（新建，spec §7.1）
function EditableFieldRow({ label, value, displayValue, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() { setDraft(value ?? ''); setEditing(true) }
  function handleSave() { setEditing(false); if (draft !== value) onSave(draft) }

  return (
    <div style={{ display: 'flex', gap: 8, paddingBottom: 6, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0, minWidth: 44, paddingTop: 2 }}>
        {label}
      </span>
      {editing ? (
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          autoFocus
          onBlur={handleSave}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSave() } }}
          style={{
            flex: 1, border: '1px solid #e0dbd4', borderRadius: 8,
            padding: '4px 8px', fontSize: 13, outline: 'none',
            background: 'white', fontFamily: 'inherit',
          }}
        />
      ) : (
        <span onClick={startEdit}
          style={{ fontSize: 13, color: '#333', lineHeight: 1.6, flex: 1, cursor: 'pointer' }}>
          {displayValue || <span style={{ color: '#ccc' }}>点击添加…</span>}
        </span>
      )}
      <span onClick={startEdit}
        style={{ fontSize: 10, color: '#d4c4b0', cursor: 'pointer', paddingTop: 2, flexShrink: 0 }}>
        ✎
      </span>
    </div>
  )
}

export default function RecordDetail({ entry: initialEntry, onBack, onOpenAwareness }) {
  const [entry, setEntry] = useState(initialEntry)
  const [messages, setMessages] = useState([])
  const [analyzing, setAnalyzing] = useState(false)
  const [toast, setToast] = useState('')
  const [showConfidenceTip, setShowConfidenceTip] = useState(false)

  // 情绪内联编辑状态
  const [editingEmotions, setEditingEmotions] = useState(false)
  const [emotionDraft, setEmotionDraft] = useState('')

  // 关联脉络
  const [entryThreads, setEntryThreads] = useState([])

  const tpl = resolveTemplate(entry.template_type)

  // 读取完整 entry 数据（列表页传来的对象可能是简化版）
  useEffect(() => {
    async function loadFull() {
      const { data } = await db.from('journal_entries')
        .select('*').eq('id', initialEntry.id).single()
      if (data) setEntry(data)
    }
    loadFull()
  }, [initialEntry.id])

  // 读取对话记录（conversations 表）
  useEffect(() => {
    async function loadMessages() {
      const { data } = await db.from('conversations')
        .select('messages')
        .eq('entry_id', initialEntry.id)
        .eq('context_type', 'entry')
        .maybeSingle()
      setMessages(data?.messages ?? [])
    }
    loadMessages()
  }, [initialEntry.id])

  // 读取关联脉络
  useEffect(() => {
    async function loadThreads() {
      const { data } = await db.from('thread_entries')
        .select('thread_id, threads(id, name)')
        .eq('entry_id', initialEntry.id)
      setEntryThreads((data ?? []).map(r => r.threads).filter(Boolean))
    }
    loadThreads()
  }, [initialEntry.id])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2000)
  }

  // ── 单字段 inline 保存 ────────────────────────────────────────
  async function handleFieldSave(field, value) {
    const { error } = await updateEntry({
      id: entry.id,
      userId: entry.user_id,
      fields: { [field]: value },
    })
    if (error) {
      showToast('保存失败，请检查网络')
      const { data } = await db.from('journal_entries')
        .select('*').eq('id', entry.id).single()
      if (data) setEntry(data)
    }
  }

  // ── 情绪标签编辑保存 ──────────────────────────────────────────
  async function handleEmotionSave() {
    const words = emotionDraft
      .split(/[、,，\s]+/)
      .map(w => w.trim())
      .filter(Boolean)
    const { baseWords, minConfidence } = mapDisplayToBase(words)
    const { error } = await updateEntry({
      id: entry.id,
      userId: entry.user_id,
      fields: {
        emotion_display: words,
        emotions: baseWords,
        emotion_confidence: minConfidence,
      },
    })
    if (!error) {
      setEntry(e => ({
        ...e,
        emotion_display: words,
        emotions: baseWords,
        emotion_confidence: minConfidence,
      }))
    } else {
      showToast('保存失败，请检查网络')
    }
    setEditingEmotions(false)
  }

  // ── 摘要索引保存 ──────────────────────────────────────────────
  async function handleSummarySave(value) {
    const trimmed = value?.trim() || null
    setEntry(e => ({ ...e, entry_summary: trimmed }))
    await handleFieldSave('entry_summary', trimmed)
  }

  async function handleThemeHintsSave(value) {
    const arr = value.split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean)
    setEntry(e => ({ ...e, theme_hints: arr }))
    await handleFieldSave('theme_hints', arr)
  }

  // ── AI 分析（无 AI 字段时显示按钮）────────────────────────────
  async function handleAIAnalyze() {
    setAnalyzing(true)
    try {
      // 取 conversations 表的觉察对话记录
      const msgText = messages
        .filter(m => m.nodeType !== 'raw_entry')
        .map(m => {
          if (m.nodeType === 'local_prompt') return `问：${m.content}`
          if (m.nodeType === 'local_answer') return `答：${m.content}`
          if (m.nodeType === 'ai_prompt') return `AI：${m.content}`
          if (m.nodeType === 'ai_answer') return `答：${m.content}`
          return ''
        })
        .filter(Boolean)
        .join('\n')

      const hasConversation = !!msgText
      const fullText = `原始写作：\n${entry.content}${msgText ? `\n\n对话记录：\n${msgText}` : ''}`
      const extraction = await extractFields(fullText, hasConversation)

      if (!extraction || Object.keys(extraction).length === 0) {
        showToast('分析失败，请稍后重试')
        return
      }

      // emotion_display 优先用 AI 返回值，降级用 emotions
      const emotionDisplay = extraction.emotion_display?.length
        ? extraction.emotion_display
        : (extraction.emotions ?? [])
      const { baseWords, minConfidence } = mapDisplayToBase(emotionDisplay)

      // 只写入已知存在的列，避免 AI 返回未知字段导致 400
      await updateEntry({
        id: entry.id,
        userId: entry.user_id,
        fields: {
          entry_summary:             extraction.entry_summary             ?? null,
          theme_hints:               extraction.theme_hints               ?? [],
          emotions:                  baseWords,
          emotion_display:           emotionDisplay,
          emotion_confidence:        minConfidence,
          overall_state_score:       extraction.overall_state_score       ?? null,
          body_sensations:           extraction.body_sensations           ?? null,
          current_thought:           extraction.current_thought           ?? null,
          core_needs:                extraction.core_needs                ?? [],
          current_behavior:          extraction.current_behavior          ?? null,
          handling_rating:           extraction.handling_rating           ?? null,
          cognitive_distortion_type: extraction.cognitive_distortion_type ?? null,
          cognitive_analysis:        extraction.cognitive_analysis        ?? null,
          reflection_insight:        extraction.reflection_insight        ?? null,
          category_tags:             extraction.category_tags             ?? [],
          people_involved:           extraction.people_involved           ?? [],
        },
      })

      const { data } = await db.from('journal_entries')
        .select('*').eq('id', entry.id).single()
      if (data) setEntry(data)
    } catch (e) {
      console.error('[RecordDetail] AI分析失败:', e)
      showToast('分析失败，请稍后重试')
    } finally {
      setAnalyzing(false)
    }
  }

  // ── 派生数据 ──────────────────────────────────────────────────
  // 三个核心字段都有值才视为"已完整分析"；任意一个缺失就保留「✦ AI 分析」按钮
  // cognitive_analysis / body_sensations / current_thought 视内容而定，不作必填
  // （keyword detection 填的 emotions 不参与此判断）
  const hasAIAnalysis = !!(
    entry.entry_summary &&
    entry.reflection_insight &&
    entry.core_needs?.length > 0
  )

  // 优先展示 emotion_display（描述层），否则 fallback 到 emotions（基础层）
  const emotions = entry.emotion_display?.length
    ? entry.emotion_display
    : (entry.emotions ?? [])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#faf8f4',
      overflowY: 'auto',
      paddingBottom: 100,
    }}>

      {/* ── 顶部导航 ── */}
      <div style={{ padding: '12px 18px 0', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: '#bbb', cursor: 'pointer', fontSize: 14,
          }}
        >
          ← 返回
        </button>
      </div>

      <div style={{ padding: '16px 18px 0' }}>

        {/* ── 模板 + 时间 ── */}
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 16 }}>
          <span style={{ color: tpl.color, marginRight: 6 }}>{tpl.label}</span>
          · {formatDateTime(entry.created_at)}
        </div>

        {/* ── 情绪标签区（点击可编辑）── */}
        {emotions.length > 0 && !editingEmotions && (
          <div
            onClick={() => {
              setEmotionDraft(emotions.join('、'))
              setEditingEmotions(true)
            }}
            style={{
              display: 'flex', gap: 6, flexWrap: 'wrap',
              marginBottom: 4, cursor: 'pointer',
            }}
          >
            {emotions.map(w => <EmotionTag key={w} word={w} />)}
          </div>
        )}

        {editingEmotions && (
          <div style={{ marginBottom: 4 }}>
            <input
              value={emotionDraft}
              onChange={e => setEmotionDraft(e.target.value)}
              autoFocus
              onBlur={handleEmotionSave}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleEmotionSave() } }}
              style={{
                width: '100%', border: '1px solid #e0dbd4',
                borderRadius: 8, padding: '6px 10px',
                fontSize: 13, outline: 'none',
                background: 'white', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
              placeholder="用逗号分隔，如：难受、委屈"
            />
            <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>
              完成后点其他地方自动保存
            </div>
          </div>
        )}

        {entry.emotion_confidence != null && entry.emotion_confidence < 0.75 && (
          <div style={{ fontSize: 10, color: '#bbb', marginBottom: 12, position: 'relative' }}>
            <span style={{ verticalAlign: 'middle' }}>基础标签待确认</span>
            <span
              onClick={() => setShowConfidenceTip(v => !v)}
              style={{
                marginLeft: 4, verticalAlign: 'middle', cursor: 'pointer',
                color: '#c9a96e', fontSize: 9, width: 13, height: 13,
                border: '1px solid #c9a96e', borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >？</span>
            {showConfidenceTip && (
              <div style={{
                position: 'absolute', top: 18, left: 0, right: 0,
                background: 'white', border: '1px solid #e8e2d9', borderRadius: 10,
                padding: '10px 12px', fontSize: 12, color: '#666', lineHeight: 1.65,
                boxShadow: '0 4px 16px rgba(0,0,0,0.10)', zIndex: 10,
              }}>
                AI 提取的情绪词与基础词库匹配度偏低，可能存在偏差。
                <br />点击上方情绪标签可手动编辑并确认。
                <div style={{ marginTop: 6, textAlign: 'right' }}>
                  <span
                    onClick={() => setShowConfidenceTip(false)}
                    style={{ fontSize: 11, color: '#c9a96e', cursor: 'pointer' }}
                  >知道了</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 摘要索引区 ── */}
        <div style={{
          marginTop: 14, background: '#fdfcf9',
          borderTop: '1px solid #ede9e2', borderBottom: '1px solid #ede9e2',
          paddingTop: 10, paddingBottom: 4,
          marginLeft: -18, marginRight: -18, paddingLeft: 18, paddingRight: 18,
        }}>
          <div style={{ fontSize: 9, color: '#c8c0b4', fontWeight: 600,
            letterSpacing: '0.04em', marginBottom: 6 }}>
            摘要索引
            <span style={{ fontSize: 8, color: '#d4c8b8', fontWeight: 400, marginLeft: 4 }}>
              · AI 提取，可手动调整
            </span>
          </div>
          <EditableFieldRow
            label="一句话"
            value={entry.entry_summary ?? ''}
            displayValue={entry.entry_summary}
            onSave={handleSummarySave}
          />
          <EditableFieldRow
            label="主题标签"
            value={(entry.theme_hints ?? []).join('、')}
            displayValue={
              entry.theme_hints?.length > 0
                ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {entry.theme_hints.map(h => (
                      <span key={h} style={{
                        fontSize: 10, padding: '1px 7px', borderRadius: 8,
                        background: '#f5f0ff', color: '#7a50c0', border: '1px solid #e0d4f8',
                      }}>{h}</span>
                    ))}
                  </div>
                : null
            }
            onSave={handleThemeHintsSave}
          />
        </div>

        {/* ── 核心字段区 ── */}
        <div style={{
          marginTop: 14, marginBottom: 14,
          borderTop: '1px solid #ede9e2', paddingTop: 12,
        }}>
          {/* 已填字段始终展示，分析不完整时在下方保留按钮 */}
          <FieldRow label="核心需求" value={entry.core_needs} />
          <FieldRow label="认知"     value={entry.cognitive_analysis} />
          <FieldRow label="身体感受" value={entry.body_sensations} />
          <FieldRow label="洞见"     value={entry.reflection_insight} />
          {!hasAIAnalysis && (
            <div style={{ marginTop: 6 }}>
              {!entry.reflection_insight && !entry.core_needs?.length && (
                <div style={{ fontSize: 12, color: '#bbb', marginBottom: 10 }}>
                  暂无分析，点击按钮让 AI 帮你整理这条记录的核心内容
                </div>
              )}
              <button
                onClick={handleAIAnalyze}
                disabled={analyzing}
                style={{
                  fontSize: 12, color: '#888',
                  border: '1px solid #e0dbd4',
                  borderRadius: 8, padding: '6px 12px',
                  background: 'none', cursor: 'pointer',
                }}
              >
                {analyzing ? '分析中…' : '✦ AI 分析'}
              </button>
            </div>
          )}
        </div>

        {/* ── 关联区（category_tags）── */}
        {entry.category_tags?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {entry.category_tags.map(tag => (
              <span key={tag} style={{
                fontSize: 10, color: '#888',
                border: '1px solid #e0dbd4',
                borderRadius: 4, padding: '2px 6px',
              }}>
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* ── 关联脉络 ── */}
        {entryThreads.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {entryThreads.map(thread => (
              <span key={thread.id} style={{
                fontSize: 11, background: '#f5f0ff', color: '#7a50c0',
                border: '1px solid #e0d4f8', borderRadius: 20, padding: '3px 10px',
              }}>
                🧵 {thread.name}
              </span>
            ))}
          </div>
        )}

        {/* ── 统一记录流 ── */}
        <div style={{ borderTop: '1px solid #ede9e2', paddingTop: 14 }}>
          <div style={{
            fontSize: 11, color: '#ccc', marginBottom: 14,
            textAlign: 'center', letterSpacing: '0.5px',
          }}>
            ── 原始记录流 ──
          </div>

          {messages.length === 0 ? (
            /* 没有觉察对话时，只展示原始日记文字 */
            <div style={{ fontSize: 14, color: '#2d2d2d', lineHeight: 1.85, whiteSpace: 'pre-wrap' }}>
              {entry.content}
            </div>
          ) : (
            messages.map((msg, i) => {
              // 原始日记
              if (msg.nodeType === 'raw_entry') {
                return (
                  <div key={i} style={{
                    fontSize: 14, color: '#2d2d2d',
                    lineHeight: 1.85, marginBottom: 20,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.content}
                  </div>
                )
              }

              // 本地引导问题（12px #aaa）
              if (msg.nodeType === 'local_prompt') {
                return (
                  <div key={i} style={{
                    fontSize: 12, color: '#aaa',
                    lineHeight: 1.65, marginBottom: 4,
                  }}>
                    {msg.content}
                  </div>
                )
              }

              // 用户对本地问题的回答（14px #2d2d2d，上方浅色分隔线）
              if (msg.nodeType === 'local_answer') {
                return (
                  <div key={i} style={{
                    fontSize: 14, color: '#2d2d2d',
                    lineHeight: 1.85, marginBottom: 20,
                    borderTop: '1px solid #f0ece4', paddingTop: 8,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.content}
                  </div>
                )
              }

              // AI 引导块（✦ 前缀，12px #aaa）
              if (msg.nodeType === 'ai_prompt') {
                return (
                  <div key={i} style={{
                    fontSize: 12, color: '#aaa',
                    lineHeight: 1.65, marginBottom: 4,
                  }}>
                    <span style={{ fontSize: 10, marginRight: 4 }}>✦</span>
                    {msg.content}
                  </div>
                )
              }

              // 用户对 AI 的回应（14px #2d2d2d，上方浅色分隔线）
              if (msg.nodeType === 'ai_answer') {
                return (
                  <div key={i} style={{
                    fontSize: 14, color: '#2d2d2d',
                    lineHeight: 1.85, marginBottom: 20,
                    borderTop: '1px solid #f0ece4', paddingTop: 8,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.content}
                  </div>
                )
              }

              // local_skip 不渲染
              return null
            })
          )}
        </div>
      </div>

      {/* ── Toast 提示 ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)', color: 'white',
          padding: '8px 16px', borderRadius: 20,
          fontSize: 13, zIndex: 100,
          whiteSpace: 'nowrap',
        }}>
          {toast}
        </div>
      )}

      {/* ── 浮动「✦ 深度觉察」按钮 ── */}
      <button
        onClick={() => onOpenAwareness(entry)}
        style={{
          position: 'fixed', bottom: 32, left: '50%',
          transform: 'translateX(-50%)',
          background: '#2d2928', color: 'white',
          borderRadius: 20, padding: '10px 20px',
          fontSize: 13, border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          whiteSpace: 'nowrap',
          zIndex: 50,
        }}
      >
        ✦ 深度觉察
      </button>
    </div>
  )
}

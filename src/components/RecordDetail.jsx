// src/components/RecordDetail.jsx
// 记录详情页：三段式布局（核心字段卡 → 关联标签 → 统一记录流）
// 情绪标签可点击内联编辑，使用本地 mapDisplayToBase，不调 AI
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { updateEntry } from '../lib/journalService'
import { resolveTemplate } from '../lib/templates'
import { mapDisplayToBase } from '../lib/emotionMap'
import { extractFields } from '../lib/conversationService'
import { loadContacts, addContact } from '../lib/contactsService'
import { loadCoreNeeds, addCoreNeed } from '../lib/coreNeedsService'
import DatetimePicker from './DatetimePicker'
import React from 'react'
import AnnotatedText from './AnnotatedText'
import AnnotationMenu from './AnnotationMenu'
import { useAnnotations } from '../hooks/useAnnotations'
import { useAnnotationInteraction } from '../hooks/useAnnotationInteraction'

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

export default function RecordDetail({ entry: initialEntry, onBack, onOpenAwareness, onEdit, refreshToken }) {
  const { user } = useAuth()
  const [entry, setEntry] = useState(initialEntry)
  const [messages, setMessages] = useState([])
  const [analyzing, setAnalyzing] = useState(false)
  const [toast, setToast] = useState('')
  const [showConfidenceTip, setShowConfidenceTip] = useState(false)

  // 情绪内联编辑状态
  const [editingEmotions, setEditingEmotions] = useState(false)
  const [emotionDraft, setEmotionDraft] = useState('')

  // template_type 下拉
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)

  // overall_state_score 下拉
  const [showScorePicker, setShowScorePicker] = useState(false)

  // category_tags 底部 sheet
  const [showCategorySheet, setShowCategorySheet] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState([])   // 从 user_options 读
  const [categoryDraft, setCategoryDraft] = useState([])       // sheet 内暂存选择

  // people_involved 浮层
  const [contacts, setContacts] = useState([])
  const [showPeopleSheet, setShowPeopleSheet] = useState(false)
  const [showAddPersonInput, setShowAddPersonInput] = useState(false)
  const [addPersonDraft, setAddPersonDraft] = useState('')

  // core_needs 浮层
  const [coreNeeds, setCoreNeeds] = useState([])
  const [showNeedsSheet, setShowNeedsSheet] = useState(false)
  const [needsSearch, setNeedsSearch] = useState('')
  const [showAddNeedInput, setShowAddNeedInput] = useState(false)
  const [addNeedDraft, setAddNeedDraft] = useState('')
  const [showDatetimePicker, setShowDatetimePicker] = useState(false)
  const [fullscreenImg, setFullscreenImg] = useState(null)

  // ── 标注系统 ──
  const { annotations, activeColor, setActiveColor, addAnnotation, clipAnnotations, markSaved, resetAnnotations, dirty } =
    useAnnotations(entry.annotations)

  const contentContainerRef = React.useRef(null)
  const { menuVisible, menuPosition, handleMouseUp, handleTouchEnd, closeMenu, handleBold, handleHighlight, handleUnderline, handleCancel, handleColorChange, openMenuForRange, hasOverlap } =
    useAnnotationInteraction({
      containerRef: contentContainerRef,
      rawText: entry.content ?? '',
      addAnnotation,
      clipAnnotations,
      activeColor,
      setActiveColor,
      annotations,
    })

  // debounce 1.5 秒自动保存
  const saveTimerRef = React.useRef(null)
  React.useEffect(() => {
    if (!dirty) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        await updateEntry({ id: entry.id, userId: entry.user_id, fields: { annotations } })
        markSaved()
      } catch (e) {
        console.error('[RecordDetail] annotations 保存失败:', e)
      }
    }, 500)
    return () => clearTimeout(saveTimerRef.current)
  }, [dirty, annotations])

  // 关联脉络
  const [entryThreads, setEntryThreads] = useState([])

  const tpl = resolveTemplate(entry.template_type)

  // 读取完整 entry 数据（列表页传来的对象可能是简化版；refreshToken 变化时重新拉取）
  useEffect(() => {
    async function loadFull() {
      const { data } = await db.from('journal_entries')
        .select('*').eq('id', initialEntry.id).single()
      if (data) {
        setEntry(data)
        resetAnnotations(data.annotations)
      }
    }
    loadFull()
  }, [initialEntry.id, refreshToken])

  // 读取对话记录（conversations 表；refreshToken 变化时重新拉取）
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
  }, [initialEntry.id, refreshToken])

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

  // 读取用户自定义内容大类标签（含 A1 自动种入 + B1 孤儿标签）
  useEffect(() => {
    if (!user?.id) return
    async function loadCategoryOptions() {
      const { data } = await db.from('user_options')
        .select('id, option_value, sort_order')
        .eq('user_id', user.id)
        .eq('field_name', 'content_category')
        .order('sort_order', { ascending: true })

      // A1：新用户首次打开，静默种入 11 个默认标签
      if ((data ?? []).length === 0) {
        const defaults = ['工作','家庭','恋爱与亲密关系','个人成长','学习','财务','运动健康','社交','玩乐休闲','灵性修行','日常生活']
        const rows = defaults.map((label, i) => ({
          user_id: user.id,
          field_name: 'content_category',
          option_value: label,
          sort_order: i,
        }))
        const { data: inserted } = await db.from('user_options').insert(rows).select('id, option_value, sort_order')
        setCategoryOptions((inserted ?? []).map(r => r.option_value))
        return
      }

      // B1：孤儿标签合并（entry 上有、但 user_options 里已删除的标签）
      const userOptionLabels = (data ?? []).map(r => r.option_value)
      const orphans = (entry.category_tags ?? []).filter(t => !userOptionLabels.includes(t))
      setCategoryOptions([...userOptionLabels, ...orphans])
    }
    loadCategoryOptions()
  }, [user?.id, entry.id])

  // 加载联系人列表（RecordDetail 编辑时用）
  useEffect(() => {
    loadContacts().then(setContacts).catch(console.error)
  }, [])

  // 加载 core_needs 词库
  useEffect(() => {
    loadCoreNeeds().then(setCoreNeeds).catch(console.error)
  }, [])

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

  async function handleTemplateSave(newType) {
    setShowTemplatePicker(false)
    setEntry(e => ({ ...e, template_type: newType }))
    await handleFieldSave('template_type', newType)
  }

  async function handleScoreSave(score) {
    setShowScorePicker(false)
    setEntry(e => ({ ...e, overall_state_score: score }))
    await handleFieldSave('overall_state_score', score)
  }

  async function handleCategoryTagsSave() {
    setShowCategorySheet(false)
    setEntry(e => ({ ...e, category_tags: categoryDraft }))
    await handleFieldSave('category_tags', categoryDraft)
  }

  async function handleThemeHintsSave(value) {
    const arr = value.split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean)
    setEntry(e => ({ ...e, theme_hints: arr }))
    await handleFieldSave('theme_hints', arr)
  }

  async function handleCoreNeedsSave(value) {
    const arr = value.split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean)
    setEntry(e => ({ ...e, core_needs: arr }))
    await handleFieldSave('core_needs', arr)
  }

  // ── people_involved 增删 ──────────────────────────────────────
  async function handlePersonRemove(name) {
    const updated = (entry.people_involved ?? []).filter(p => p !== name)
    setEntry(e => ({ ...e, people_involved: updated }))
    await handleFieldSave('people_involved', updated)
  }

  async function handlePersonAdd(canonical) {
    if ((entry.people_involved ?? []).includes(canonical)) {
      setShowPeopleSheet(false)
      return
    }
    const updated = [...(entry.people_involved ?? []), canonical]
    setEntry(e => ({ ...e, people_involved: updated }))
    await handleFieldSave('people_involved', updated)
    setShowPeopleSheet(false)
  }

  const VOCAB_VALID_RE = /["'\\n]/
  function validateVocabInput(val) {
    if (val.length > 20) return '不能超过 20 字'
    if (VOCAB_VALID_RE.test(val)) return '不能包含引号、反斜杠或换行符'
    return null
  }

  async function handlePersonAddNew(name) {
    if (!name.trim()) return
    const err = validateVocabInput(name.trim())
    if (err) return
    const newContact = await addContact(name.trim())
    setContacts(prev => [...prev, newContact])
    await handlePersonAdd(name.trim())
    setAddPersonDraft('')
    setShowAddPersonInput(false)
  }

  // ── core_needs 增删 ───────────────────────────────────────────
  async function handleNeedRemove(word) {
    const updated = (entry.core_needs ?? []).filter(n => n !== word)
    setEntry(e => ({ ...e, core_needs: updated }))
    await handleFieldSave('core_needs', updated)
  }

  async function handleNeedAdd(word) {
    if ((entry.core_needs ?? []).includes(word)) {
      setShowNeedsSheet(false)
      return
    }
    const updated = [...(entry.core_needs ?? []), word]
    setEntry(e => ({ ...e, core_needs: updated }))
    await handleFieldSave('core_needs', updated)
    setShowNeedsSheet(false)
    setNeedsSearch('')
    setShowAddNeedInput(false)
    setAddNeedDraft('')
  }

  // 通过「+」新增自定义需求：同时写入词库（user_options）和当前 entry
  async function handleNeedAddCustom(word) {
    if (!word.trim()) return
    if (validateVocabInput(word.trim())) return
    try {
      const newNeed = await addCoreNeed(word.trim())
      setCoreNeeds(prev => [...prev, newNeed])
    } catch (e) {
      console.error('[RecordDetail] addCoreNeed failed:', e)
    }
    await handleNeedAdd(word.trim())
  }

  async function handleBodySensationsSave(value) {
    const trimmed = value?.trim() || null
    setEntry(e => ({ ...e, body_sensations: trimmed }))
    await handleFieldSave('body_sensations', trimmed)
  }

  async function handleReflectionInsightSave(value) {
    const trimmed = value?.trim() || null
    setEntry(e => ({ ...e, reflection_insight: trimmed }))
    await handleFieldSave('reflection_insight', trimmed)
  }

  async function handleCognitiveAnalysisSave(value) {
    const trimmed = value?.trim() || null
    setEntry(e => ({ ...e, cognitive_analysis: trimmed }))
    await handleFieldSave('cognitive_analysis', trimmed)
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
      const extraction = await extractFields(fullText, hasConversation, user.id)

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
  const emotions = [...new Set(entry.emotion_display?.length
    ? entry.emotion_display
    : (entry.emotions ?? []))]

  const TEMPLATE_OPTIONS = [
    { id: 'awareness', label: '觉察' },
    { id: 'gratitude', label: '感恩' },
    { id: 'learning',  label: '学习' },
    { id: 'action',    label: '行动' },
    { id: 'freewrite', label: '随手记' },
  ]

  const SCORE_OPTIONS = [
    { value: 3,  label: '+3 非常好', color: '#2e7d32' },
    { value: 2,  label: '+2 比较好', color: '#388e3c' },
    { value: 1,  label: '+1 还不错', color: '#66bb6a' },
    { value: 0,  label: '0 中性',   color: '#9e9e9e' },
    { value: -1, label: '−1 有点难', color: '#ef9a9a' },
    { value: -2, label: '−2 比较难', color: '#e57373' },
    { value: -3, label: '−3 非常难', color: '#c62828' },
  ]

  // overall_state_score 历史数据兼容（±4/±5 clamp 显示，不强制回写）
  const clampedScore = entry.overall_state_score != null
    ? Math.max(-3, Math.min(3, entry.overall_state_score))
    : null
  const scoreOption = SCORE_OPTIONS.find(o => o.value === clampedScore)
  const scoreLabel = entry.overall_state_score != null
    ? (Math.abs(entry.overall_state_score) > 3
        ? `${entry.overall_state_score > 0 ? '+' : ''}${entry.overall_state_score}（超范围）`
        : `状态 ${entry.overall_state_score > 0 ? '+' : ''}${entry.overall_state_score}`)
    : null

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#faf8f4',
    }}>

      {/* 全屏图片查看 */}
      {fullscreenImg && (
        <div
          onClick={() => setFullscreenImg(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img src={fullscreenImg} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}

      {/* ── 日期时间 picker sheet ── */}
      {showDatetimePicker && (
        <DatetimePicker
          initialDatetime={new Date(entry.created_at)}
          onConfirm={async (d) => {
            const iso = d.toISOString()
            setShowDatetimePicker(false)
            setEntry(e => ({ ...e, created_at: iso }))
            await updateEntry({ id: entry.id, userId: user.id, fields: { created_at: iso } })
          }}
          onClose={() => setShowDatetimePicker(false)}
        />
      )}

      {/* ── 顶部导航 ── */}
      <div style={{
        padding: '12px 18px 0', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexShrink: 0,
        position: 'sticky', top: 0, zIndex: 10, background: '#faf8f4',
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: '#bbb', cursor: 'pointer',
            fontSize: 20, fontWeight: 300,
            padding: '6px 8px', margin: '-6px -8px',
            lineHeight: 1,
          }}
        >
          ‹
        </button>
      </div>

      {/* 内容区独立滚动 */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 100 }}>
      <div style={{ padding: '16px 18px 0' }}>

        {/* ── 顶部标签区（四字段可编辑）── */}
        <div style={{ marginBottom: 12 }}>

          {/* 第一行：时间 + template_type 下拉 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button
              onClick={() => setShowDatetimePicker(true)}
              style={{
                fontSize: 12, color: '#bbb', background: 'none',
                border: 'none', padding: 0, cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#999'}
              onMouseLeave={e => e.currentTarget.style.color = '#bbb'}
            >
              {formatDateTime(entry.created_at)}
            </button>
            {/* template_type badge */}
            <div style={{ position: 'relative' }}>
              <button onClick={() => { setShowTemplatePicker(v => !v); setShowScorePicker(false) }}
                style={{ fontSize: 12, color: tpl.color, background: tpl.color + '18', border: `1px solid ${tpl.color}40`, borderRadius: 8, padding: '3px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                {tpl.label} <span style={{ fontSize: 10 }}>▾</span>
              </button>
              {showTemplatePicker && (
                <>
                  <div onClick={() => setShowTemplatePicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                  <div style={{ position: 'absolute', right: 0, top: '130%', zIndex: 100, background: 'white', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: 140, overflow: 'hidden' }}>
                    {TEMPLATE_OPTIONS.map(opt => (
                      <button key={opt.id} onClick={() => handleTemplateSave(opt.id)}
                        style={{ display: 'block', width: '100%', padding: '11px 14px', background: entry.template_type === opt.id ? '#faf8f4' : 'none', border: 'none', textAlign: 'left', fontSize: 13, color: entry.template_type === opt.id ? '#c9a96e' : '#555', cursor: 'pointer' }}>
                        {entry.template_type === opt.id ? '✓ ' : '　'}{opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 第二行：emotion_display chips（点击可编辑） */}
          {emotions.length > 0 && !editingEmotions && (
            <div onClick={() => { setEmotionDraft(emotions.join('、')); setEditingEmotions(true) }}
              style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, cursor: 'pointer' }}>
              {emotions.map(w => <EmotionTag key={w} word={w} />)}
            </div>
          )}
          {editingEmotions && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input value={emotionDraft} onChange={e => setEmotionDraft(e.target.value)} autoFocus
                  onBlur={handleEmotionSave}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleEmotionSave() } }}
                  style={{ flex: 1, border: '1px solid #e0dbd4', borderRadius: 8, padding: '6px 10px', fontSize: 13, outline: 'none', background: 'white', fontFamily: 'inherit' }}
                  placeholder="用顿号分隔，如：烦躁、克制后的疲惫" />
                <button onClick={handleEmotionSave}
                  style={{ flexShrink: 0, padding: '6px 10px', background: '#c9a96e', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, cursor: 'pointer' }}>✓</button>
              </div>
            </div>
          )}

          {/* 第三行：overall_state_score 下拉 */}
          {scoreLabel && (
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 6 }}>
              <button onClick={() => { setShowScorePicker(v => !v); setShowTemplatePicker(false) }}
                style={{ fontSize: 12, color: scoreOption?.color ?? '#888', background: (scoreOption?.color ?? '#888') + '15', border: `1px solid ${scoreOption?.color ?? '#888'}40`, borderRadius: 8, padding: '3px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                {scoreLabel} <span style={{ fontSize: 10 }}>▾</span>
              </button>
              {showScorePicker && (
                <>
                  <div onClick={() => setShowScorePicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                  <div style={{ position: 'absolute', left: 0, top: '130%', zIndex: 100, background: 'white', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: 160, overflow: 'hidden' }}>
                    {SCORE_OPTIONS.map(opt => (
                      <button key={opt.value} onClick={() => handleScoreSave(opt.value)}
                        style={{ display: 'block', width: '100%', padding: '11px 14px', background: clampedScore === opt.value ? '#faf8f4' : 'none', border: 'none', textAlign: 'left', fontSize: 13, color: opt.color, cursor: 'pointer' }}>
                        {clampedScore === opt.value ? '✓ ' : '　'}{opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 第四行：category_tags chips + ✎ */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
            {(entry.category_tags ?? []).map(tag => (
              <span key={tag} onClick={() => { setCategoryDraft(entry.category_tags ?? []); setShowCategorySheet(true) }}
                style={{ fontSize: 11, background: '#f5f0e8', color: '#8a7a6a', padding: '2px 9px', borderRadius: 10, cursor: 'pointer' }}>
                {tag}
              </span>
            ))}
            <span onClick={() => { setCategoryDraft(entry.category_tags ?? []); setShowCategorySheet(true) }}
              style={{ fontSize: 11, color: '#d4c4b0', cursor: 'pointer' }}>✎</span>
          </div>
        </div>

        {/* ── confidence tip（保持现有逻辑位置不变）── */}
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

          {/* 涉及的人 */}
          <div style={{ display: 'flex', gap: 12, paddingBottom: 6, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0, minWidth: 44, paddingTop: 6 }}>
              涉及的人
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 }}>
              {(entry.people_involved ?? []).map(name => (
                <span key={name} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', background: '#e8f0f5', color: '#5a7a8a',
                  borderRadius: 99, fontSize: 13,
                }}>
                  {name}
                  <button onClick={() => handlePersonRemove(name)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#5a7a8a', lineHeight: 1 }}>
                    ✕
                  </button>
                </span>
              ))}
              <button onClick={() => { loadContacts().then(setContacts).catch(console.error); setShowPeopleSheet(true) }}
                style={{
                  background: 'none', border: '1px dashed #cbd5e1', borderRadius: 99,
                  padding: '2px 10px', fontSize: 13, color: '#94a3b8', cursor: 'pointer',
                }}>
                ＋
              </button>
            </div>
          </div>

          {/* 人物选择浮层 */}
          {showPeopleSheet && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
              zIndex: 100, display: 'flex', alignItems: 'flex-end',
            }} onClick={() => { setShowPeopleSheet(false); setShowAddPersonInput(false); setAddPersonDraft('') }}>
              <div style={{
                width: '100%', background: '#fff', borderRadius: '16px 16px 0 0',
                padding: '20px 16px 32px', maxHeight: '60vh', overflowY: 'auto',
              }} onClick={e => e.stopPropagation()}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 14 }}>选择涉及的人</div>

                {/* 新增输入框（点「+」后展开）*/}
                {showAddPersonInput && (
                  <>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                    <input
                      value={addPersonDraft}
                      onChange={e => setAddPersonDraft(e.target.value)}
                      placeholder="输入新人物名（最多 20 字）"
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') handlePersonAddNew(addPersonDraft) }}
                      style={{
                        flex: 1, padding: '7px 10px', border: '1px solid #e5e7eb',
                        borderRadius: 8, fontSize: 14, outline: 'none',
                      }}
                    />
                    <button onClick={() => handlePersonAddNew(addPersonDraft)}
                      disabled={!!validateVocabInput(addPersonDraft.trim())}
                      style={{ padding: '7px 14px', background: '#5a7a8a', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', opacity: validateVocabInput(addPersonDraft.trim()) ? 0.4 : 1 }}>
                      添加
                    </button>
                    <button onClick={() => { setShowAddPersonInput(false); setAddPersonDraft('') }}
                      style={{ padding: '7px 10px', background: '#f3f4f6', color: '#888', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                      取消
                    </button>
                  </div>
                  {addPersonDraft && validateVocabInput(addPersonDraft) && (
                    <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{validateVocabInput(addPersonDraft)}</div>
                  )}
                  </>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {/* 灰色「+」首 chip */}
                  {!showAddPersonInput && (
                    <button onClick={() => setShowAddPersonInput(true)}
                      style={{
                        padding: '5px 14px', borderRadius: 99,
                        border: '1.5px dashed #cbd5e1', background: 'none',
                        color: '#94a3b8', fontSize: 14, cursor: 'pointer',
                      }}>
                      ＋
                    </button>
                  )}
                  {/* 联系人按 group_name 分组展示（过滤已选）*/}
                  {(() => {
                    const available = contacts.filter(c => !(entry.people_involved ?? []).includes(c.canonical))
                    const grouped = {}
                    for (const c of available) {
                      const g = c.group_name ?? '其他'
                      if (!grouped[g]) grouped[g] = []
                      grouped[g].push(c)
                    }
                    const GROUP_ORDER = ['家人', '伴侣', '朋友', '同事', '其他']
                    const sortedGroups = Object.keys(grouped).sort(
                      (a, b) => (GROUP_ORDER.indexOf(a) === -1 ? 99 : GROUP_ORDER.indexOf(a)) - (GROUP_ORDER.indexOf(b) === -1 ? 99 : GROUP_ORDER.indexOf(b))
                    )
                    return sortedGroups.map(group => (
                      <div key={group} style={{ width: '100%' }}>
                        <div style={{ fontSize: 11, color: '#bbb', marginBottom: 6, marginTop: 4 }}>{group}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {grouped[group].map(c => (
                            <span key={c.id} onClick={() => handlePersonAdd(c.canonical)}
                              style={{
                                padding: '5px 14px', background: '#e8f0f5', color: '#5a7a8a',
                                borderRadius: 99, fontSize: 14, cursor: 'pointer',
                              }}>
                              {c.canonical}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* 内心需求 */}
          <div style={{ display: 'flex', gap: 12, paddingBottom: 6, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0, minWidth: 44, paddingTop: 6 }}>
              内心需求
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 }}>
              {(entry.core_needs ?? []).map(word => (
                <span key={word} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', background: '#ede8f5', color: '#7a6a9a',
                  borderRadius: 99, fontSize: 13,
                }}>
                  {word}
                  <button onClick={() => handleNeedRemove(word)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#7a6a9a', lineHeight: 1 }}>
                    ✕
                  </button>
                </span>
              ))}
              <button onClick={() => { loadCoreNeeds().then(setCoreNeeds).catch(console.error); setShowNeedsSheet(true); setNeedsSearch('') }}
                style={{
                  background: 'none', border: '1px dashed #c4b5e0', borderRadius: 99,
                  padding: '2px 10px', fontSize: 13, color: '#b4a0d0', cursor: 'pointer',
                }}>
                ＋
              </button>
            </div>
          </div>

          {/* 词库选择浮层 */}
          {showNeedsSheet && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
              zIndex: 100, display: 'flex', alignItems: 'flex-end',
            }} onClick={() => setShowNeedsSheet(false)}>
              <div style={{
                width: '100%', background: '#fff', borderRadius: '16px 16px 0 0',
                padding: 16, maxHeight: '60vh', overflowY: 'auto',
              }} onClick={e => e.stopPropagation()}>
                <input
                  placeholder="搜索词条"
                  value={needsSearch}
                  onChange={e => setNeedsSearch(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb',
                    borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: 'border-box',
                  }}
                  autoFocus
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                  {/* 灰色「+」首 chip */}
                  {showAddNeedInput ? (
                    <div style={{ width: '100%', marginBottom: 4 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          value={addNeedDraft}
                          onChange={e => setAddNeedDraft(e.target.value)}
                          placeholder="输入新需求词（最多 20 字）"
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') handleNeedAddCustom(addNeedDraft) }}
                          style={{
                            flex: 1, padding: '7px 10px', border: '1px solid #e5e7eb',
                            borderRadius: 8, fontSize: 14, outline: 'none',
                          }}
                        />
                        <button onClick={() => handleNeedAddCustom(addNeedDraft)}
                          disabled={!!validateVocabInput(addNeedDraft.trim())}
                          style={{ padding: '7px 14px', background: '#7a6a9a', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', opacity: validateVocabInput(addNeedDraft.trim()) ? 0.4 : 1 }}>
                          添加
                        </button>
                        <button onClick={() => { setShowAddNeedInput(false); setAddNeedDraft('') }}
                          style={{ padding: '7px 10px', background: '#f3f4f6', color: '#888', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                          取消
                        </button>
                      </div>
                      {addNeedDraft && validateVocabInput(addNeedDraft) && (
                        <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{validateVocabInput(addNeedDraft)}</div>
                      )}
                    </div>
                  ) : (
                    <button onClick={() => setShowAddNeedInput(true)}
                      style={{
                        padding: '5px 14px', borderRadius: 99,
                        border: '1.5px dashed #c4b5e0', background: 'none',
                        color: '#b4a0d0', fontSize: 14, cursor: 'pointer',
                      }}>
                      ＋
                    </button>
                  )}
                  {coreNeeds
                    .filter(c => !needsSearch || c.option_value.includes(needsSearch))
                    .filter(c => !(entry.core_needs ?? []).includes(c.option_value))
                    .map(c => (
                      <span key={c.id} onClick={() => handleNeedAdd(c.option_value)}
                        style={{
                          padding: '5px 14px', background: '#ede8f5', color: '#7a6a9a',
                          borderRadius: 99, fontSize: 14, cursor: 'pointer',
                        }}>
                        {c.option_value}
                      </span>
                    ))
                  }
                </div>
              </div>
            </div>
          )}
          <EditableFieldRow
            label="认知"
            value={entry.cognitive_analysis ?? ''}
            displayValue={entry.cognitive_analysis}
            onSave={handleCognitiveAnalysisSave}
          />
          <EditableFieldRow
            label="身体感受"
            value={entry.body_sensations ?? ''}
            displayValue={entry.body_sensations}
            onSave={handleBodySensationsSave}
          />
          <EditableFieldRow
            label="洞见"
            value={entry.reflection_insight ?? ''}
            displayValue={entry.reflection_insight}
            onSave={handleReflectionInsightSave}
          />
          {!hasAIAnalysis && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 12, color: '#bbb', marginBottom: 10 }}>
                暂无分析，点击按钮让 AI 帮你整理这条记录的核心内容
              </div>
            </div>
          )}
          {/* 始终显示：无字段时叫「AI 分析」，有字段时叫「重新生成」 */}
          <div style={{ marginTop: hasAIAnalysis ? 10 : 0 }}>
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
              {analyzing ? '分析中…' : hasAIAnalysis ? '✦ 重新生成' : '✦ AI 分析'}
            </button>
          </div>
        </div>

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
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 8, letterSpacing: '0.5px',
          }}>
            ── 原始记录流 ──
            {onEdit && (
              <span
                onClick={() => onEdit(entry)}
                style={{ cursor: 'pointer', fontSize: 14, color: '#c9a96e', lineHeight: 1, padding: '6px 8px', margin: '-6px -8px' }}
              >
                ✎
              </span>
            )}
          </div>

          {messages.length === 0 ? (
            <React.Fragment>
              <div
                ref={contentContainerRef}
                style={{ position: 'relative', fontSize: 14, color: '#2d2d2d', lineHeight: 1.85,
                  marginBottom: (entry.image_urls ?? []).length > 0 ? 8 : 0,
                  WebkitTouchCallout: 'none' }}
                onMouseUp={handleMouseUp}
                onTouchEnd={handleTouchEnd}
                onContextMenu={e => e.preventDefault()}
              >
                <AnnotatedText text={entry.content ?? ''} annotations={annotations} onAnnotatedClick={openMenuForRange} />
                <AnnotationMenu
                  visible={menuVisible}
                  position={menuPosition}
                  activeColor={activeColor}
                  onBold={handleBold}
                  onHighlight={handleHighlight}
                  onUnderline={handleUnderline}
                  onColorChange={handleColorChange}
                  onClose={closeMenu}
                  showCancel={hasOverlap}
                  onCancel={handleCancel}
                />
              </div>
              {(entry.image_urls ?? []).length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
                    {(entry.image_urls ?? []).map((path, idx) => (
                      <div
                        key={idx}
                        style={{ aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', cursor: 'pointer' }}
                        onClick={() => setFullscreenImg(getImageUrl(path))}
                      >
                        <img src={getImageUrl(path)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: '#bbb', marginTop: 3 }}>点击图片全屏查看</div>
                </div>
              )}
            </React.Fragment>
          ) : (
            messages.map((msg, i) => {
              // 原始日记
              if (msg.nodeType === 'raw_entry') {
                const imgs = entry.image_urls ?? []
                return (
                  <React.Fragment key={i}>
                    <div
                      ref={contentContainerRef}
                      style={{
                        position: 'relative',
                        fontSize: 14, color: '#2d2d2d',
                        lineHeight: 1.85, marginBottom: imgs.length > 0 ? 8 : 20,
                        WebkitTouchCallout: 'none',
                      }}
                      onMouseUp={handleMouseUp}
                      onTouchEnd={handleTouchEnd}
                      onContextMenu={e => e.preventDefault()}
                    >
                      <AnnotatedText text={msg.content ?? ''} annotations={annotations} onAnnotatedClick={openMenuForRange} />
                      <AnnotationMenu
                        visible={menuVisible}
                        position={menuPosition}
                        activeColor={activeColor}
                        onBold={handleBold}
                        onHighlight={handleHighlight}
                        onUnderline={handleUnderline}
                        onColorChange={handleColorChange}
                        onClose={closeMenu}
                        showCancel={hasOverlap}
                        onCancel={handleCancel}
                      />
                    </div>
                    {imgs.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
                          {imgs.map((path, idx) => (
                            <div
                              key={idx}
                              style={{ aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', cursor: 'pointer' }}
                              onClick={() => setFullscreenImg(getImageUrl(path))}
                            >
                              <img src={getImageUrl(path)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: 10, color: '#bbb', marginTop: 3 }}>点击图片全屏查看</div>
                      </div>
                    )}
                  </React.Fragment>
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

      {/* category_tags 底部 sheet */}
      {showCategorySheet && (
        <div onClick={() => setShowCategorySheet(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', background: 'white', borderRadius: '16px 16px 0 0', padding: '20px 18px 32px' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 14 }}>选择内容大类标签</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {categoryOptions.length === 0 ? (
                <div style={{ fontSize: 13, color: '#ccc' }}>暂无标签，请在「我的」页面添加</div>
              ) : categoryOptions.map(tag => {
                const selected = categoryDraft.includes(tag)
                return (
                  <button key={tag}
                    onClick={() => setCategoryDraft(prev => selected ? prev.filter(t => t !== tag) : [...prev, tag])}
                    style={{ padding: '6px 14px', borderRadius: 20, border: selected ? '1.5px solid #c9a96e' : '1.5px solid #e0dbd4', background: selected ? '#fff8f0' : 'white', color: selected ? '#c9a96e' : '#888', fontSize: 13, cursor: 'pointer' }}>
                    {tag}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 11, color: '#bbb', marginBottom: 16 }}>在「我的」页面可以自定义这些标签</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowCategorySheet(false)}
                style={{ flex: 1, padding: '12px', border: '1px solid #e0dbd4', borderRadius: 10, background: 'white', color: '#888', fontSize: 14, cursor: 'pointer' }}>取消</button>
              <button onClick={handleCategoryTagsSave}
                style={{ flex: 2, padding: '12px', border: 'none', borderRadius: 10, background: '#c9a96e', color: 'white', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>保存</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

/**
 * 写作页（v2）
 *
 * 核心变化：
 *   - 顶部模板横排小灰字标签，激活态用模板色
 *   - 引导词竖线行（颜色跟模板走，opacity 0.5）
 *   - 全屏输入区，光标灰色
 *   - 底部浮动栏：✦ 深入觉察（左）+ ✓ 按钮（右）
 *   - 切换模板不清空内容、不弹框
 *   - 随记模板点 ✓ 直接保存跳列表，其他模板进觉察流
 *   - 草稿 3 秒自动存 localStorage，重开有恢复提示
 *
 * Props：
 *   onDone(entry, gotoAwareness)  新建完成回调，gotoAwareness=false 时直接跳列表
 *   editEntry                      编辑模式传入已有记录
 *   onCancel                       编辑模式取消按钮
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { TEMPLATES, DEFAULT_TEMPLATE, resolveTemplate } from '../lib/templates'
import { insertEntry, updateEntry } from '../lib/journalService'
import { Mic, MicOff } from 'lucide-react'

// ─── 草稿 localStorage ──────────────────────────────────────────
const DRAFT_KEY = 'journal_draft'

function saveDraft(content, templateId) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      content,
      template: templateId,
      savedAt: new Date().toISOString(),
    }))
  } catch (_) {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw)
    // 超过 24 小时丢弃
    if (Date.now() - new Date(draft.savedAt).getTime() > 86400000) {
      localStorage.removeItem(DRAFT_KEY)
      return null
    }
    return draft
  } catch (_) {
    return null
  }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch (_) {}
}

// ─── 主组件 ──────────────────────────────────────────────────────
export default function HomePage({ onDone, editEntry, onCancel }) {
  const { user } = useAuth()
  const isEditMode = Boolean(editEntry)

  // 当前激活模板
  const [template, setTemplate] = useState(() =>
    isEditMode ? resolveTemplate(editEntry.template_type) : DEFAULT_TEMPLATE
  )

  // 写作内容
  const [content, setContent] = useState(editEntry?.content ?? '')

  // 草稿恢复提示
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const draftRef = useRef(null)

  // 保存中状态（防重复点击）
  const [saving, setSaving] = useState(false)

  // 语音
  const { isRecording, isSupported, startRecording, stopRecording } = useSpeechRecognition()
  const voiceBaseRef = useRef('')
  const committedRef = useRef('')

  const textareaRef = useRef(null)
  const draftTimerRef = useRef(null)

  // ── 草稿检查（仅新建模式）──────────────────────────────────────
  useEffect(() => {
    if (isEditMode) return
    const draft = loadDraft()
    if (draft?.content) {
      draftRef.current = draft
      setShowDraftBanner(true)
    }
  }, [isEditMode])

  // ── 自动保存草稿（新建模式，每 3 秒）──────────────────────────
  useEffect(() => {
    if (isEditMode) return
    clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(() => {
      if (content.trim()) saveDraft(content, template.id)
    }, 3000)
    return () => clearTimeout(draftTimerRef.current)
  }, [content, template.id, isEditMode])

  // ── textarea 自动聚焦 ──────────────────────────────────────────
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // ── 恢复草稿 ──────────────────────────────────────────────────
  const handleResumeDraft = () => {
    if (draftRef.current) {
      setContent(draftRef.current.content)
      const t = resolveTemplate(draftRef.current.template)
      setTemplate(t)
    }
    setShowDraftBanner(false)
  }

  const handleDiscardDraft = () => {
    clearDraft()
    setShowDraftBanner(false)
  }

  // ── 模板切换（不清空内容）─────────────────────────────────────
  const handleTemplateClick = (tpl) => {
    setTemplate(tpl)
    textareaRef.current?.focus()
  }

  // ── 语音 ──────────────────────────────────────────────────────
  const handleVoiceToggle = () => {
    if (isRecording) {
      stopRecording()
      return
    }
    voiceBaseRef.current = content.trimEnd()
    committedRef.current = ''
    startRecording(
      (newFinal, interim) => {
        if (newFinal) committedRef.current += newFinal
        const parts = [voiceBaseRef.current, committedRef.current + interim].filter(Boolean)
        setContent(parts.join('\n'))
      },
      () => {},
      () => {}
    )
  }

  // ── 点 ✓（完成写作）──────────────────────────────────────────
  const handleDone = useCallback(async () => {
    if (!content.trim() || saving) return
    setSaving(true)

    const trimmed = content.trim()

    if (isEditMode) {
      // 编辑模式：后台 UPDATE，立即回调
      const fields = {
        content: trimmed,
        template_type: template.id,
      }
      const updatedEntry = { ...editEntry, ...fields }
      onDone?.(updatedEntry, false)  // 编辑不进觉察流
      updateEntry({ id: editEntry.id, userId: user.id, fields })
        .then(({ error }) => { if (error) console.error('[edit]', error) })
      return
    }

    // 新建模式：乐观插入——先生成 ID 立即跳转，后台异步 INSERT
    const optimisticEntry = {
      id: crypto.randomUUID(),
      user_id: user.id,
      content: trimmed,
      template_type: template.id,
      created_at: new Date().toISOString(),
    }

    clearDraft()
    const gotoAwareness = template.awarenessStart !== null
    onDone?.(optimisticEntry, gotoAwareness)  // 立即跳转，不等 DB

    // 重置写作区（不阻塞跳转）
    setContent('')
    setTemplate(DEFAULT_TEMPLATE)
    setSaving(false)

    // 后台写入 DB（fire-and-forget，用 optimisticEntry 里的 id）
    insertEntry(optimisticEntry)
      .then(({ error }) => { if (error) console.error('[insert]', error) })
  }, [content, saving, isEditMode, template, editEntry, user, onDone])

  // ── 点 ✦ 深入觉察（写作页直接进 AI 模式）─────────────────────
  const handleDeepAwareness = useCallback(async () => {
    if (!content.trim() || saving) return
    setSaving(true)

    const { data: entry, error } = await insertEntry({
      user_id: user.id,
      content: content.trim(),
      template_type: template.id,
      created_at: new Date().toISOString(),
    })

    setSaving(false)
    if (error || !entry) { console.error('[insert]', error); return }

    clearDraft()
    onDone?.(entry, true)   // 强制进觉察流（直接 AI 模式）
    setContent('')
    setTemplate(DEFAULT_TEMPLATE)
  }, [content, saving, template, user, onDone])

  // ── 渲染 ──────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col h-full relative"
      style={{ backgroundColor: '#faf8f4' }}
    >
      {/* ── 草稿恢复横幅 ── */}
      {showDraftBanner && (
        <div className="px-4 pt-3 fade-in">
          <div
            className="flex items-center justify-between px-4 py-2.5 rounded-2xl"
            style={{ backgroundColor: '#f0ece4', border: '1px solid #ddd8cf' }}
          >
            <span className="text-xs text-gray-500">你有一条未完成的记录，要继续写吗？</span>
            <div className="flex gap-3 ml-3">
              <button
                onClick={handleResumeDraft}
                className="text-xs font-medium"
                style={{ color: template.color }}
              >
                继续
              </button>
              <button onClick={handleDiscardDraft} className="text-xs text-gray-400">
                新建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 模板标签栏 ── */}
      <div className="flex items-center gap-0.5 px-[18px] pt-3">
        {TEMPLATES.map(t => (
          <button
            key={t.id}
            onClick={() => handleTemplateClick(t)}
            className="px-[7px] py-[3px] rounded-[5px] transition-colors"
            style={{
              fontSize: '11px',
              fontWeight: template.id === t.id ? 500 : 400,
              color: template.id === t.id ? t.color : '#ccc',
              letterSpacing: '0.1px',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}

        {/* 编辑模式取消按钮 */}
        {isEditMode && onCancel && (
          <button
            onClick={onCancel}
            className="ml-auto text-xs text-gray-400 px-2 py-1"
          >
            取消
          </button>
        )}
      </div>

      {/* ── 引导词行（细竖线 + 文字）── */}
      <div className="flex items-flex-start gap-2 px-[18px] pt-[10px]">
        <div
          style={{
            width: '1.5px',
            borderRadius: '1px',
            flexShrink: 0,
            alignSelf: 'stretch',
            minHeight: '16px',
            marginTop: '2px',
            backgroundColor: template.color,
            opacity: 0.5,
          }}
        />
        <p
          style={{
            fontSize: '12px',
            lineHeight: 1.65,
            fontWeight: 400,
            letterSpacing: '0.1px',
            color: template.color,
            opacity: 0.8,
          }}
        >
          {template.guide}
        </p>
      </div>

      {/* ── 输入区 ── */}
      <div className="flex-1 px-[18px] pt-[14px] pb-[80px]">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="把脑子里的写下来…"
          className="w-full h-full border-none outline-none bg-transparent resize-none"
          style={{
            fontSize: '15px',
            lineHeight: 1.85,
            color: '#2d2d2d',
            caretColor: '#aaa',
            fontFamily: 'inherit',
          }}
        />
      </div>

      {/* ── 底部浮动栏 ── */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center justify-between"
        style={{
          padding: '8px 18px 22px',
          background: 'linear-gradient(transparent, #faf8f4 38%)',
        }}
      >
        {/* 左：✦ 深入觉察 + 语音 */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleDeepAwareness}
            disabled={!content.trim() || saving}
            className="flex items-center gap-[5px] disabled:opacity-30 active:scale-95 transition-transform"
          >
            <span
              className="flex items-center justify-center rounded-full"
              style={{
                width: '30px',
                height: '30px',
                background: '#f0ece4',
                border: '1px solid #ddd8cf',
                fontSize: '11px',
                color: '#b8a88a',
              }}
            >
              ✦
            </span>
            <span style={{ fontSize: '10px', color: '#ccc' }}>深入觉察</span>
          </button>

          {isSupported && (
            <button
              onClick={handleVoiceToggle}
              className={`flex items-center justify-center rounded-full active:scale-95 transition-all ${
                isRecording ? 'recording-pulse' : ''
              }`}
              style={{
                width: '30px',
                height: '30px',
                background: isRecording ? '#ef4444' : '#f0ece4',
                border: `1px solid ${isRecording ? '#ef4444' : '#ddd8cf'}`,
                color: isRecording ? '#fff' : '#b8a88a',
              }}
            >
              {isRecording ? <MicOff size={13} /> : <Mic size={13} />}
            </button>
          )}
        </div>

        {/* 右：✓ 完成按钮 */}
        <button
          onClick={handleDone}
          disabled={!content.trim() || saving}
          className="flex items-center justify-center rounded-full active:scale-95 transition-all disabled:opacity-30"
          style={{
            width: '36px',
            height: '36px',
            background: saving ? '#999' : '#2d2928',
            boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
            fontSize: '13px',
            color: '#fff',
          }}
        >
          {saving ? '…' : '✓'}
        </button>
      </div>
    </div>
  )
}

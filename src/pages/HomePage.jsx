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
import { db } from '../lib/db'
import { loadContacts, seedDefaultContacts, addContact, detectPeopleFromText } from '../lib/contactsService'
import { seedDefaultCoreNeeds } from '../lib/coreNeedsService'

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
export default function HomePage({ onDone, editEntry, onCancel, onOpenLetter }) {
  const { user } = useAuth()
  const isEditMode = Boolean(editEntry)

  // 未读回顾信
  const [unreadLetter, setUnreadLetter] = useState(null)
  const [letterReadTimer, setLetterReadTimer] = useState(null)

  useEffect(() => {
    if (!user) return
    async function checkUnread() {
      const { data } = await db.from('review_letters')
        .select('id, content')
        .eq('user_id', user.id)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setUnreadLetter(data ?? null)
    }
    checkUnread()
  }, [user])

  // 停留 5 秒自动标记已读
  function handleLetterCardView(letter) {
    const timer = setTimeout(async () => {
      await db.from('review_letters').update({ is_read: true }).eq('id', letter.id)
      setUnreadLetter(null)
    }, 5000)
    setLetterReadTimer(timer)
  }

  useEffect(() => () => { if (letterReadTimer) clearTimeout(letterReadTimer) }, [letterReadTimer])

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
  // 手动 ✕ 过的人物（session 内永久 dismiss，文字里再出现也不重现）
  const [dismissedPeople, setDismissedPeople] = useState(new Set())

  // ── 联系人（进页面时一次性加载到内存）─────────────────────────
  const [contacts, setContacts] = useState([])
  // @ 浮层
  const [mentionQuery, setMentionQuery] = useState(null)  // null = 关闭，字符串 = 搜索词
  const [mentionAnchor, setMentionAnchor] = useState(0)   // @ 字符在文本中的位置
  const [mentionTop, setMentionTop] = useState(0)          // 浮窗距容器顶部的像素偏移
  // 底部 chip：已选人物的 canonical 数组
  const [selectedPeople, setSelectedPeople] = useState(
    editEntry?.people_involved ?? []
  )

  // ── 加载联系人（seed 一次，然后读取）──────────────────────────
  useEffect(() => {
    if (!user) return
    async function init() {
      await seedDefaultContacts()
      await seedDefaultCoreNeeds()
      const list = await loadContacts()
      setContacts(list)
    }
    init().catch(console.error)
  }, [user])

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

  // ── 监听 @ 字符（实时识别由 render 时计算，不在此累积）──────
  const handleContentChange = (e) => {
    const val = e.target.value
    setContent(val)

    // 检测 @ 触发：找光标前最近一个 @，且 @ 后无空格
    const cursor = e.target.selectionStart
    const before = val.slice(0, cursor)
    const atIdx = before.lastIndexOf('@')
    if (atIdx !== -1) {
      const afterAt = before.slice(atIdx + 1)
      if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
        // 计算浮窗 top：@ 所在行数 × 行高 + 上方 padding + 一行偏移（显示在光标下方）
        const LINE_H = 28  // 15px × 1.85 ≈ 28px
        const TOP_PAD = 14 // pt-[14px]
        const linesBefore = (val.slice(0, atIdx).match(/\n/g) || []).length
        setMentionTop(linesBefore * LINE_H + LINE_H + TOP_PAD)
        setMentionQuery(afterAt)
        setMentionAnchor(atIdx)
        return
      }
    }
    setMentionQuery(null)
  }

  // ── @ 选人 ────────────────────────────────────────────────────
  const handleMentionSelect = async (contact) => {
    // 把 @<query> 替换为 alias 原文（去掉 @，文字保留）
    const before = content.slice(0, mentionAnchor)   // @ 之前
    const after = content.slice(mentionAnchor)         // @ 开始往后
    const query = mentionQuery
    const afterCleaned = after.replace('@' + query, query)
    setContent(before + afterCleaned)
    setMentionQuery(null)

    // 底部 chip 追加（去重）
    const canonical = contact.canonical
    setSelectedPeople(prev =>
      prev.includes(canonical) ? prev : [...prev, canonical]
    )
  }

  const handleMentionAddNew = async (name) => {
    if (!name.trim()) return
    const newContact = await addContact(name.trim())
    setContacts(prev => [...prev, newContact])
    setMentionQuery(null)
    setSelectedPeople(prev =>
      prev.includes(name.trim()) ? prev : [...prev, name.trim()]
    )
  }

  // ── 点 ✓（完成写作）──────────────────────────────────────────
  const handleDone = useCallback(async () => {
    if (!content.trim() || saving) return
    setSaving(true)

    const trimmed = content.trim()

    // 实时计算 people_involved（文本识别 + 手动选 - 已 dismiss）
    const autoDetected = detectPeopleFromText(trimmed, contacts)
    const allPeople = [...new Set([...selectedPeople, ...autoDetected])]
      .filter(p => !dismissedPeople.has(p))

    if (isEditMode) {
      // 编辑模式：后台 UPDATE，立即回调
      const fields = {
        content: trimmed,
        template_type: template.id,
        people_involved: allPeople,
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
      people_involved: allPeople,
    }

    clearDraft()
    const gotoAwareness = template.awarenessStart !== null
    setSaving(false)
    onDone?.(optimisticEntry, gotoAwareness)  // 立即跳转，不等 DB

    // 后台写入 DB（fire-and-forget，用 optimisticEntry 里的 id）
    insertEntry(optimisticEntry)
      .then(({ error }) => { if (error) console.error('[insert]', error) })
  }, [content, saving, isEditMode, template, editEntry, user, onDone, contacts, selectedPeople])

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

      {/* ── 未读回顾信气泡 ── */}
      {unreadLetter && (
        <div
          className="px-4 pt-3 fade-in"
          ref={el => { if (el && !letterReadTimer) handleLetterCardView(unreadLetter) }}
        >
          <div
            style={{
              background: '#fffdf8', border: '1px solid #f0e8d4',
              borderRadius: 12, padding: '10px 14px', cursor: 'pointer',
            }}
            onClick={() => onOpenLetter?.(unreadLetter)}
          >
            <div style={{ fontSize: 11, color: '#c9a96e', marginBottom: 4 }}>
              📬 你有一封新的回顾信
            </div>
            <div style={{
              fontSize: 12, color: '#555', lineHeight: 1.65,
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {unreadLetter.content}
            </div>
            <div style={{ fontSize: 11, color: '#c9a96e', marginTop: 6, textAlign: 'right' }}>
              查看 →
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

      {/* ── 输入区（相对定位容器，供 @ 浮层定位）── */}
      <div className="flex-1 px-[18px] pt-[14px] pb-[80px]" style={{ position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleContentChange}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMentionQuery(null)
          }}
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

        {/* @ 浮层 */}
        {mentionQuery !== null && (() => {
          const uniqueContacts = [...new Map(contacts.map(c => [c.canonical, c])).values()]
          const filtered = uniqueContacts.filter(c => {
            const q = mentionQuery.toLowerCase()
            return (
              c.canonical.toLowerCase().includes(q) ||
              (c.aliases || []).some(a => a.toLowerCase().includes(q))
            )
          })
          return (
            <div style={{
              position: 'absolute',
              left: 18,
              top: mentionTop,
              width: 200,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
              zIndex: 50,
              maxHeight: 200,
              overflowY: 'auto',
            }}>
              {filtered.map(c => (
                <div
                  key={c.id}
                  onClick={() => handleMentionSelect(c)}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: '#333',
                    borderBottom: '1px solid #f3f4f6',
                  }}
                >
                  {c.canonical}
                </div>
              ))}
              {mentionQuery.trim() && (
                <div
                  onClick={() => handleMentionAddNew(mentionQuery)}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: '#c9a96e',
                  }}
                >
                  ＋ 新增「{mentionQuery}」
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* ── 涉及的人 chip 区（浮动栏上方）── */}
      {/* ── 底部浮动栏（含人物 chip）── */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          padding: '8px 18px 22px',
          background: 'linear-gradient(transparent, #faf8f4 38%)',
        }}
      >
        <div className="flex items-center gap-2">
          {/* 左：✦ 深入觉察 + 语音 */}
          <div className="flex items-center gap-3" style={{ flexShrink: 0 }}>
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

          {/* 中：人物 chip（横向可滚动，实时计算）*/}
          {(() => {
            const autoDetected = detectPeopleFromText(content, contacts)
            const displayedPeople = [...new Set([...selectedPeople, ...autoDetected])]
              .filter(p => !dismissedPeople.has(p))
            return (
              <div style={{
                flex: 1,
                overflowX: 'auto',
                display: 'flex',
                gap: 5,
                alignItems: 'center',
                scrollbarWidth: 'none',
              }}>
                {displayedPeople.map(name => (
                  <span key={name} style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '2px 8px',
                    background: '#e8f0f5',
                    color: '#5a7a8a',
                    borderRadius: 99,
                    fontSize: 12,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}>
                    {name}
                    <button
                      onClick={() => {
                        setDismissedPeople(prev => new Set([...prev, name]))
                        setSelectedPeople(prev => prev.filter(p => p !== name))
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: '#5a7a8a', fontSize: 11 }}
                    >✕</button>
                  </span>
                ))}
              </div>
            )
          })()}

          {/* 右：✓ 完成按钮 */}
          <button
            onClick={handleDone}
            disabled={!content.trim() || saving}
            className="flex items-center justify-center rounded-full active:scale-95 transition-all disabled:opacity-30"
            style={{
              width: '36px',
              height: '36px',
              flexShrink: 0,
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
    </div>
  )
}

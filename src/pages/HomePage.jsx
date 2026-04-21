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
import DatetimePicker from '../components/DatetimePicker'
import { inferDatetime, formatPill } from '../lib/dateUtils'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { uploadImage, deleteImage, getImageUrl } from '../lib/imageStorage'

// ─── 草稿 localStorage ──────────────────────────────────────────
const DRAFT_KEY = 'journal_draft'

function saveDraft(content, templateId, selectedDatetime, manualOverride) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      content,
      template: templateId,
      savedAt: new Date().toISOString(),
      selectedDatetime: selectedDatetime instanceof Date ? selectedDatetime.toISOString() : null,
      manualOverride: Boolean(manualOverride),
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
    // 把 ISO 字符串还原为 Date
    if (draft.selectedDatetime) {
      draft.selectedDatetime = new Date(draft.selectedDatetime)
    }
    return draft
  } catch (_) {
    return null
  }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch (_) {}
}

// ─── 图片宫格单项（支持拖拽） ─────────────────────────────────────
// 必须定义在模块顶层，不能放 HomePage 函数体内（re-render 会重建组件类型）
function SortableImageItem({ id, previewSrc, editingImages, onDelete, onFullscreen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    aspectRatio: '1/1',
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    cursor: editingImages ? 'grab' : 'pointer',
    touchAction: editingImages ? 'none' : 'auto',
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(editingImages ? { ...attributes, ...listeners } : {})}
      onClick={() => { if (!editingImages) onFullscreen() }}
    >
      <img src={previewSrc} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onDelete() }}
        style={{
          position: 'absolute', top: 4, right: 4,
          width: 18, height: 18, borderRadius: '50%',
          background: 'rgba(0,0,0,0.6)', color: 'white',
          border: 'none', fontSize: 11, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1, zIndex: 1,
        }}
      >✕</button>
    </div>
  )
}

// ─── 主组件 ──────────────────────────────────────────────────────
export default function HomePage({ onDone, editEntry, onCancel, onOpenLetter, onNotify }) {
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

  // 键盘弹起时底部栏贴键盘
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const vvRef = useRef(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    vvRef.current = vv
    function update() {
      const navEl = document.querySelector('nav')
      const navH = navEl ? navEl.getBoundingClientRect().height : 0
      const keyboardHeight = window.innerHeight - vv.height - navH
      setKeyboardOffset(Math.max(0, keyboardHeight))
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  // 组件卸载时释放 ObjectURL，防止内存泄漏
  useEffect(() => {
    return () => { selectedPreviews.forEach(url => URL.revokeObjectURL(url)) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── 图片上传 ────────────────────────────────────────────────────
  const MAX_IMAGES = 5
  const [selectedFiles, setSelectedFiles] = useState([])
  const [selectedPreviews, setSelectedPreviews] = useState([])
  const [imagePaths, setImagePaths] = useState(editEntry?.image_urls ?? [])
  const pathsToDeleteRef = useRef([])
  const [uploading, setUploading] = useState(false)
  const [editingImages, setEditingImages] = useState(false)
  const [fullscreenSrc, setFullscreenSrc] = useState(null)
  const touchTimerRef = useRef(null)

  const totalImages = imagePaths.length + selectedFiles.length
  const imageItems = [
    ...imagePaths.map(p => ({ id: p, previewSrc: getImageUrl(p), type: 'path' })),
    ...selectedPreviews.map((src, i) => ({ id: `new-${i}`, previewSrc: src, type: 'file', fileIndex: i })),
  ]

  // 日期时间选择（仅新建模式）
  const [selectedDatetime, setSelectedDatetime] = useState(() => new Date())
  const [manualOverride, setManualOverride] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const inferTimerRef = useRef(null)

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
      if (content.trim()) saveDraft(content, template.id, selectedDatetime, manualOverride)
    }, 3000)
    return () => clearTimeout(draftTimerRef.current)
  }, [content, template.id, isEditMode, selectedDatetime, manualOverride])

  // ── inferDatetime debounce（仅新建模式）──────────────────────
  useEffect(() => {
    if (isEditMode) return
    clearTimeout(inferTimerRef.current)
    inferTimerRef.current = setTimeout(() => {
      if (manualOverride) return
      const result = inferDatetime(content)
      if (result) setSelectedDatetime(result)
    }, 800)
    return () => clearTimeout(inferTimerRef.current)
  }, [content, isEditMode, manualOverride])

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
      if (draftRef.current.selectedDatetime) {
        setSelectedDatetime(draftRef.current.selectedDatetime)
        setManualOverride(draftRef.current.manualOverride ?? false)
      }
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
    const autoDetected = detectPeopleFromText(trimmed, contacts)
    const allPeople = [...new Set([...selectedPeople, ...autoDetected])]
      .filter(p => !dismissedPeople.has(p))

    if (isEditMode) {
      const fields = {
        content: trimmed,
        template_type: template.id,
        people_involved: allPeople,
        image_urls: imagePaths,
      }
      const updatedEntry = { ...editEntry, ...fields }
      onDone?.(updatedEntry, false)

      const entryId = editEntry.id
      const userId = user.id
      const filesToUpload = [...selectedFiles]
      const existingPaths = [...imagePaths]
      const notifyFn = onNotify

      updateEntry({ id: entryId, userId, fields })
        .then(async ({ error }) => {
          if (error) { console.error('[edit]', error); return }
          // DB 写成功后，才删 Storage（防止取消时产生孤儿文件）
          const toDelete = [...pathsToDeleteRef.current]
          pathsToDeleteRef.current = []
          if (toDelete.length > 0) {
            await Promise.all(toDelete.map(p => deleteImage(p)))
          }
          if (!filesToUpload.length) return
          const newPaths = await Promise.all(
            filesToUpload.map(f => uploadImage(f, userId, entryId))
          )
          const successPaths = newPaths.filter(Boolean)
          const failedCount = newPaths.length - successPaths.length
          if (successPaths.length > 0) {
            await updateEntry({
              id: entryId, userId,
              fields: { image_urls: [...existingPaths, ...successPaths] },
            })
          }
          if (failedCount > 0) notifyFn?.('图片上传失败，进入记录可重新添加')
        })
        .catch(console.error)
      return
    }

    // 新建模式：乐观插入——先生成 ID 立即跳转，后台异步上传图片
    const optimisticEntry = {
      id: crypto.randomUUID(),
      user_id: user.id,
      content: trimmed,
      template_type: template.id,
      created_at: selectedDatetime.toISOString(),
      people_involved: allPeople,
    }

    clearDraft()
    const gotoAwareness = template.awarenessStart !== null
    setSaving(false)
    onDone?.(optimisticEntry, gotoAwareness)

    const entryId = optimisticEntry.id
    const userId = user.id
    const filesToUpload = [...selectedFiles]
    const notifyFn = onNotify

    insertEntry(optimisticEntry)
      .then(({ error }) => { if (error) console.error('[insert]', error) })

    if (filesToUpload.length > 0) {
      ;(async () => {
        const paths = await Promise.all(
          filesToUpload.map(f => uploadImage(f, userId, entryId))
        )
        const successPaths = paths.filter(Boolean)
        const failedCount = paths.length - successPaths.length
        if (successPaths.length > 0) {
          await updateEntry({ id: entryId, userId, fields: { image_urls: successPaths } })
        }
        if (failedCount > 0) {
          notifyFn?.('图片上传失败，进入记录可重新添加')
          try {
            const failed = JSON.parse(localStorage.getItem('image_upload_failed') ?? '[]')
            failed.push({ entryId, createdAt: Date.now() })
            localStorage.setItem('image_upload_failed', JSON.stringify(failed))
          } catch (_) {}
        }
      })()
    }
  }, [content, saving, isEditMode, template, editEntry, user, onDone, contacts,
      selectedPeople, dismissedPeople, selectedDatetime, imagePaths, selectedFiles, onNotify])

  // ── 点 ✦ 深入觉察（写作页直接进 AI 模式）─────────────────────
  const handleDeepAwareness = useCallback(async () => {
    if (!content.trim() || saving) return
    setSaving(true)

    const { data: entry, error } = await insertEntry({
      user_id: user.id,
      content: content.trim(),
      template_type: template.id,
      created_at: selectedDatetime.toISOString(),
    })

    setSaving(false)
    if (error || !entry) { console.error('[insert]', error); return }

    clearDraft()
    onDone?.(entry, true)   // 强制进觉察流（直接 AI 模式）
  }, [content, saving, template, user, onDone])

  // ── 图片选择 ──────────────────────────────────────────────────
  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    // 去重：用 name+size+lastModified 作指纹，过滤已选的同一张图
    const existingKeys = new Set(selectedFiles.map(f => `${f.name}_${f.size}_${f.lastModified}`))
    const deduped = files.filter(f => !existingKeys.has(`${f.name}_${f.size}_${f.lastModified}`))
    const remaining = MAX_IMAGES - totalImages
    const toAdd = deduped.slice(0, remaining)
    const newPreviews = toAdd.map(f => URL.createObjectURL(f))
    setSelectedFiles(prev => [...prev, ...toAdd])
    setSelectedPreviews(prev => [...prev, ...newPreviews])
    e.target.value = ''
  }

  // ── 删除图片 ──────────────────────────────────────────────────
  const handleDeleteImage = (item) => {
    if (item.type === 'path') {
      // 延迟删除：先从 UI 移除，保存成功后才真正删 Storage（与 EditEntryPage 模式一致）
      pathsToDeleteRef.current = [...pathsToDeleteRef.current, item.id]
      setImagePaths(prev => prev.filter(p => p !== item.id))
    } else {
      const idx = item.fileIndex
      URL.revokeObjectURL(selectedPreviews[idx])
      setSelectedFiles(prev => prev.filter((_, i) => i !== idx))
      setSelectedPreviews(prev => prev.filter((_, i) => i !== idx))
    }
  }

  // ── 拖拽调序 ─────────────────────────────────────────────────
  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = imageItems.findIndex(item => item.id === active.id)
    const newIndex = imageItems.findIndex(item => item.id === over.id)
    const reordered = arrayMove(imageItems, oldIndex, newIndex)
    const newPaths = reordered.filter(it => it.type === 'path').map(it => it.id)
    const newFileOrder = reordered.filter(it => it.type === 'file').map(it => it.fileIndex)
    setImagePaths(newPaths)
    setSelectedFiles(prev => newFileOrder.map(i => prev[i]))
    setSelectedPreviews(prev => newFileOrder.map(i => prev[i]))
  }

  // ── 长按进入编辑态 ────────────────────────────────────────────
  const handleImageTouchStart = () => {
    touchTimerRef.current = setTimeout(() => setEditingImages(true), 500)
  }
  const handleImageTouchEnd = () => { clearTimeout(touchTimerRef.current) }

  // ── @dnd-kit sensors ──────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  // ── 渲染 ──────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col h-full relative"
      style={{ backgroundColor: '#faf8f4' }}
    >
      {/* ── 日期时间 picker sheet ── */}
      {showPicker && (
        <DatetimePicker
          initialDatetime={selectedDatetime}
          onConfirm={(d) => {
            setSelectedDatetime(d)
            setManualOverride(true)
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}

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

        {/* 日期时间 pill（仅新建模式） */}
        {!isEditMode && (() => {
          const now = new Date()
          const isModified = manualOverride || Math.abs(selectedDatetime.getTime() - now.getTime()) >= 60000
          return (
            <button
              onClick={() => setShowPicker(true)}
              style={{
                marginLeft: isEditMode ? 0 : 'auto',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 99,
                border: `1px solid ${isModified ? '#f0e4cc' : 'transparent'}`,
                background: isModified ? '#fdf6ec' : 'none',
                color: isModified ? '#c9a96e' : '#bbb',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {formatPill(selectedDatetime)}
            </button>
          )
        })()}
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

      {/* ── 图片宫格（有图时渲染，位于输入区与底部浮动栏之间） ── */}
      {imageItems.length > 0 && (
        <div
          style={{ padding: '4px 18px 2px' }}
          onTouchStart={handleImageTouchStart}
          onTouchEnd={handleImageTouchEnd}
          onMouseLeave={() => clearTimeout(touchTimerRef.current)}
          onClick={e => { if (e.target === e.currentTarget) setEditingImages(false) }}
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={imageItems.map(it => it.id)} strategy={rectSortingStrategy}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
                {imageItems.map(item => (
                  <SortableImageItem
                    key={item.id}
                    id={item.id}
                    previewSrc={item.previewSrc}
                    editingImages={editingImages}
                    onDelete={() => handleDeleteImage(item)}
                    onFullscreen={() => setFullscreenSrc(item.previewSrc)}
                  />
                ))}
                {totalImages < MAX_IMAGES && !editingImages && (
                  <label style={{
                    aspectRatio: '1/1', borderRadius: 6,
                    border: '1.5px dashed #c9a96e', background: 'none',
                    color: '#c9a96e', fontSize: 20, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                      disabled={uploading} onChange={handleImageSelect} />
                    ＋
                  </label>
                )}
              </div>
            </SortableContext>
          </DndContext>
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 3 }}>
            长按拖动调序 · 最多{MAX_IMAGES}张
          </div>
        </div>
      )}

      {/* ── 全屏图片查看 ── */}
      {fullscreenSrc && (
        <div
          onClick={() => setFullscreenSrc(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img src={fullscreenSrc} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}

      {/* ── 涉及的人 chip 区（浮动栏上方）── */}
      {/* ── 底部浮动栏（含人物 chip）── */}
      <div
        className="absolute left-0 right-0"
        style={{
          bottom: keyboardOffset,
          padding: '8px 18px 22px',
          background: 'linear-gradient(transparent, #faf8f4 38%)',
          transition: 'bottom 0.1s',
        }}
      >
        <div className="flex items-center gap-2">
          {/* 最左：相机图标 */}
          <label
            style={{
              cursor: totalImages >= MAX_IMAGES ? 'not-allowed' : 'pointer',
              opacity: uploading || totalImages >= MAX_IMAGES ? 0.4 : 1,
              flexShrink: 0,
            }}
          >
            <input
              type="file" accept="image/*" multiple
              style={{ display: 'none' }}
              disabled={uploading || totalImages >= MAX_IMAGES}
              onChange={handleImageSelect}
            />
            <svg width="22" height="18" viewBox="0 0 22 18" fill="none"
              stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="20" height="13" rx="2.5"/>
              <circle cx="11" cy="10.5" r="3.5"/>
              <path d="M7.5 4L8.8 1.5h4.4L14.5 4"/>
            </svg>
          </label>

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

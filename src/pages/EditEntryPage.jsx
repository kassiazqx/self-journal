// src/pages/EditEntryPage.jsx
// 统一编辑器：原始正文 + 觉察流引导&回答，连续展示，可全量编辑
// 保存：updateEntry(content) + upsert conversations.messages

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { updateEntry } from '../lib/entryRepository'
import { uploadImage, deleteImage, getImageUrl } from '../lib/imageStorage'
import DatetimePicker from '../components/DatetimePicker'
import { formatPill } from '../lib/dateUtils'
import RichTextEditor from '../components/RichTextEditor'
import { useAnnotations } from '../hooks/useAnnotations'
import { useAnnotationInteraction } from '../hooks/useAnnotationInteraction'
import AnnotationMenu from '../components/AnnotationMenu'
import { useEntry } from '../hooks/useEntry'

// ⚠️ 必须定义在模块顶层，不能放在 EditEntryPage 函数体内。
// 原因：放在函数体内会导致每次 re-render 都产生新的组件类型，
// React 会完全卸载再挂载，光标位置因此丢失。
function AutoTextarea({ value, onChange, autoFocus, style }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.style.height = 'auto'
    ref.current.style.height = ref.current.scrollHeight + 'px'
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      autoFocus={autoFocus}
      rows={1}
      style={{
        width: '100%', boxSizing: 'border-box',
        border: 'none', outline: 'none',
        background: 'transparent', resize: 'none', overflow: 'hidden',
        fontFamily: 'inherit', caretColor: '#aaa',
        ...style,
      }}
    />
  )
}

export default function EditEntryPage({ entryId, onBack, onDone }) {
  const [suspendRefetch, setSuspendRefetch] = useState(false)
  const entry = useEntry(entryId, { suspendRefetch })

  if (!entry) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#999',
        fontSize: 14,
        background: '#faf8f4',
      }}>
        加载中…
      </div>
    )
  }

  return (
    <EditEntryPageContent
      key={entry.id}
      entry={entry}
      onBack={onBack}
      onDone={onDone}
      setSuspendRefetch={setSuspendRefetch}
    />
  )
}

function EditEntryPageContent({ entry, onBack, onDone, setSuspendRefetch }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [editDatetime, setEditDatetime] = useState(() => new Date(entry.created_at))
  const [showPicker, setShowPicker] = useState(false)

  // 图片：已有路径（从 entry.image_urls 初始化） + 新选文件
  const [imagePaths, setImagePaths] = useState(entry.image_urls ?? [])
  const [newFiles, setNewFiles] = useState([])
  const [newPreviews, setNewPreviews] = useState([])
  const [fullscreenImg, setFullscreenImg] = useState(null)
  const MAX_IMAGES = 5
  const totalImages = imagePaths.length + newFiles.length
  // 延迟删除：保存时才真正删 Storage，Cancel 时不删（避免孤儿文件）
  const pathsToDeleteRef = useRef([])

  // contentMap 用 entry.content 立即初始化，不等 conversations 查询
  const [contentMap, setContentMap] = useState({ '__raw__': entry.content ?? '' })
  // 用户开始编辑后，conversations 查询结果不再覆盖 contentMap
  const hasStartedEditingRef = useRef(false)

  // ── 标注 ──────────────────────────────────────────────────────────
  const {
    annotations, activeColor, setActiveColor,
    addAnnotation, clipAnnotations, applyShift, markSaved,
  } = useAnnotations(entry.annotations ?? [])

  const rawEditorRef = useRef(null)
  const editorContainerRef = useRef(null)
  const prevTextRef = useRef(entry.content ?? '')
  const getLatestRawText = useCallback(() => (
    rawEditorRef.current?.getValue?.() ?? contentMap['__raw__'] ?? ''
  ), [contentMap])

  // 后台加载 conversations 表（不阻塞编辑器渲染）
  useEffect(() => {
    async function load() {
      const { data } = await db.from('conversations')
        .select('messages')
        .eq('entry_id', entry.id)
        .eq('context_type', 'entry')
        .maybeSingle()

      const msgs = data?.messages ?? []
      if (msgs.length === 0) return  // 无觉察流，contentMap 已用 entry.content 初始化好了

      setMessages(msgs)

      // 用户已开始编辑则不覆盖（防止输入丢失）
      if (hasStartedEditingRef.current) return

      const map = { '__raw__': entry.content ?? '' }
      msgs.forEach(msg => {
        if (
          msg.nodeType === 'raw_entry' ||
          msg.nodeType === 'local_answer' ||
          msg.nodeType === 'ai_answer'
        ) {
          map[msg.id] = msg.content ?? ''
        }
      })
      // raw_entry 内容同时写入 '__raw__' 键，供 handleRawChange 和 handleSave 统一读取
      const rawMsg = msgs.find(m => m.nodeType === 'raw_entry')
      if (rawMsg) map['__raw__'] = rawMsg.content ?? ''
      setContentMap(map)
    }
    load()
  }, [entry.id, entry.content])

  // 卸载时释放 ObjectURL，防止内存泄漏
  useEffect(() => {
    return () => { newPreviews.forEach(url => URL.revokeObjectURL(url)) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 删除已有图片（记录路径，保存时才真正删 Storage）
  function handleDeleteExisting(path) {
    setSuspendRefetch(true)
    pathsToDeleteRef.current = [...pathsToDeleteRef.current, path]
    setImagePaths(prev => prev.filter(p => p !== path))
  }

  // 删除新选图片（释放 ObjectURL）
  function handleDeleteNew(idx) {
    setSuspendRefetch(true)
    URL.revokeObjectURL(newPreviews[idx])
    setNewFiles(prev => prev.filter((_, i) => i !== idx))
    setNewPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  // 选择新图片
  function handleImageSelect(e) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setSuspendRefetch(true)
    const existingKeys = new Set(newFiles.map(f => `${f.name}_${f.size}_${f.lastModified}`))
    const deduped = files.filter(f => !existingKeys.has(`${f.name}_${f.size}_${f.lastModified}`))
    const remaining = MAX_IMAGES - totalImages
    const toAdd = deduped.slice(0, remaining)
    const previews = toAdd.map(f => URL.createObjectURL(f))
    setNewFiles(prev => [...prev, ...toAdd])
    setNewPreviews(prev => [...prev, ...previews])
    e.target.value = ''
  }

  // ── 标注交互 ───────────────────────────────────────────────────────
  const {
    menuVisible, menuPosition,
    closeMenu,
    handleBold, handleHighlight, handleUnderline,
    handleCancel, handleColorChange, openMenuFromSelectionSnapshot, openMenuFromAnnotationSnapshot, hasOverlap,
  } = useAnnotationInteraction({
    containerRef: editorContainerRef,
    rawText: contentMap['__raw__'] ?? '',
    getRawText: getLatestRawText,
    addAnnotation,
    clipAnnotations,
    activeColor,
    setActiveColor,
    annotations,
    disableSelectionChange: true,
  })

  const handleSelectionSnapshot = useCallback((snapshot) => {
    if (snapshot.start >= snapshot.end) return
    openMenuFromSelectionSnapshot(snapshot)
  }, [openMenuFromSelectionSnapshot])

  const handleAnnotationSnapshot = useCallback((snapshot) => {
    openMenuFromAnnotationSnapshot(snapshot)
  }, [openMenuFromAnnotationSnapshot])

  function handleRawChange(newText) {
    hasStartedEditingRef.current = true
    setSuspendRefetch(true)
    const oldText = prevTextRef.current
    prevTextRef.current = newText
    let changeStart = 0
    const minLen = Math.min(oldText.length, newText.length)
    while (changeStart < minLen && oldText[changeStart] === newText[changeStart]) changeStart++
    const delta = newText.length - oldText.length
    if (delta !== 0) applyShift(changeStart, delta)
    setContentMap(m => ({ ...m, '__raw__': newText }))
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setSaveError(false)

    try {
      const hasFlow = messages && messages.length > 0
      const nextCreatedAt = editDatetime.toISOString()
      const newContent = (contentMap['__raw__'] ?? entry.content ?? '').trim()

      if (!hasFlow) {
        await updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent, created_at: nextCreatedAt, annotations } })
      } else {
        const updatedMessages = messages.map(msg => {
          // raw_entry 的编辑结果写在 contentMap['__raw__']
          if (msg.nodeType === 'raw_entry') return { ...msg, content: contentMap['__raw__'] ?? msg.content }
          if (msg.id in contentMap) return { ...msg, content: contentMap[msg.id] }
          return msg
        })
        await Promise.all([
          updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent, created_at: nextCreatedAt, annotations } }),
          db.from('conversations').upsert(
            { user_id: user.id, entry_id: entry.id, context_type: 'entry',
              messages: updatedMessages, updated_at: new Date().toISOString() },
            { onConflict: 'entry_id,context_type' }
          ),
        ])
      }

      // 上传新图片，写回 image_urls（含删除的路径不再写入，保证删除生效）
      const uploadedPaths = newFiles.length > 0
        ? (await Promise.all(newFiles.map(f => uploadImage(f, user.id, entry.id)))).filter(Boolean)
        : []
      const finalPaths = [...imagePaths, ...uploadedPaths]
      await updateEntry({ id: entry.id, userId: user.id, fields: { image_urls: finalPaths } })

      // image_urls 写回成功后，才真正删 Storage（防止孤儿文件）
      if (pathsToDeleteRef.current.length > 0) {
        await Promise.all(pathsToDeleteRef.current.map(p => deleteImage(p)))
        pathsToDeleteRef.current = []
      }
      setSuspendRefetch(false)
      markSaved()
      onDone?.()
    } catch (err) {
      console.error('[EditEntryPage handleSave]', err)
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: '#faf8f4' }}>

      {/* 时间编辑 picker */}
      {showPicker && (
        <DatetimePicker
          initialDatetime={editDatetime}
          onConfirm={d => {
            setSuspendRefetch(true)
            setEditDatetime(d)
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {fullscreenImg && (
        <div
          onClick={() => setFullscreenImg(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img src={fullscreenImg} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}

      {/* 顶部导航 */}
      <div style={{
        padding: '12px 18px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', background: '#faf8f4',
        borderBottom: '1px solid #ede9e2', flexShrink: 0,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, color: '#bbb', padding: '6px 8px', margin: '-6px -8px',
          }}
        >
          取消
        </button>
        <button
          onClick={() => setShowPicker(true)}
          style={{
            background: 'none', border: '1px solid #f0e4cc',
            borderRadius: 99, fontSize: 11,
            padding: '3px 10px', color: '#c9a96e', cursor: 'pointer',
          }}
        >
          {formatPill(editDatetime)}
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 500,
            color: saving ? '#ccc' : saveError ? '#e05252' : '#c9a96e',
          }}>
          {saving ? '保存中…' : saveError ? '保存失败，重试' : '保存'}
        </button>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 40px' }}>

          {/* ── 无觉察流：单个大文本框 ── */}
          {messages.length === 0 && (
            <div ref={editorContainerRef} style={{ position: 'relative' }}>
              <RichTextEditor
                ref={rawEditorRef}
                initialValue={contentMap['__raw__'] ?? ''}
                annotations={annotations}
                onChange={handleRawChange}
                onSelectionSnapshot={handleSelectionSnapshot}
                onAnnotationSnapshot={handleAnnotationSnapshot}
                style={{ minHeight: '60vh', fontSize: 15, lineHeight: 1.85, color: '#2d2d2d' }}
              />
              <AnnotationMenu
                position={menuPosition}
                visible={menuVisible}
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
          )}

          {/* ── 有觉察流：逐条渲染 ── */}
          {messages.map((msg) => {

            // 原始日记（可编辑大文本框）
            if (msg.nodeType === 'raw_entry') {
              return (
                <div key={msg.id} ref={editorContainerRef} style={{ position: 'relative', marginBottom: 20 }}>
                  <RichTextEditor
                    ref={rawEditorRef}
                    initialValue={contentMap[msg.id] ?? ''}
                    annotations={annotations}
                    onChange={handleRawChange}
                    onSelectionSnapshot={handleSelectionSnapshot}
                    onAnnotationSnapshot={handleAnnotationSnapshot}
                    style={{ minHeight: 60, fontSize: 15, lineHeight: 1.85, color: '#2d2d2d' }}
                  />
                  <AnnotationMenu
                    position={menuPosition}
                    visible={menuVisible}
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
              )
            }

            // 本地引导问题（只读标签）
            if (msg.nodeType === 'local_prompt') {
              return (
                <div key={msg.id} style={{
                  fontSize: 12, color: '#aaa', lineHeight: 1.65, marginBottom: 4,
                }}>
                  {msg.content}
                </div>
              )
            }

            // 本地回答（可编辑）
            if (msg.nodeType === 'local_answer') {
              return (
                <AutoTextarea
                  key={msg.id}
                  value={contentMap[msg.id] ?? ''}
                  onChange={(e) => {
                    setSuspendRefetch(true)
                    setContentMap(m => ({ ...m, [msg.id]: e.target.value }))
                  }}
                  style={{
                    fontSize: 14, lineHeight: 1.85, color: '#2d2d2d',
                    borderTop: '1px solid #f0ece4', paddingTop: 8, marginBottom: 20,
                    minHeight: 40,
                  }}
                />
              )
            }

            // AI 引导（只读标签）
            if (msg.nodeType === 'ai_prompt') {
              return (
                <div key={msg.id} style={{
                  fontSize: 12, color: '#aaa', lineHeight: 1.65, marginBottom: 4,
                }}>
                  <span style={{ fontSize: 10, marginRight: 4 }}>✦</span>
                  {msg.content}
                </div>
              )
            }

            // AI 回答（可编辑）
            if (msg.nodeType === 'ai_answer') {
              return (
                <AutoTextarea
                  key={msg.id}
                  value={contentMap[msg.id] ?? ''}
                  onChange={(e) => {
                    setSuspendRefetch(true)
                    setContentMap(m => ({ ...m, [msg.id]: e.target.value }))
                  }}
                  style={{
                    fontSize: 14, lineHeight: 1.85, color: '#2d2d2d',
                    borderTop: '1px solid #f0ece4', paddingTop: 8, marginBottom: 20,
                    minHeight: 40,
                  }}
                />
              )
            }

            return null
          })}

          {/* ── 图片管理区 ── */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #f0ece4' }}>
            <div style={{ fontSize: 11, color: '#bbb', marginBottom: 8 }}>图片</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
              {/* 已有图片 */}
              {imagePaths.map((path) => (
                <div key={path} style={{ aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', position: 'relative' }}
                  onClick={() => setFullscreenImg(getImageUrl(path))}>
                  <img src={getImageUrl(path)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteExisting(path) }}
                    style={{
                      position: 'absolute', top: 4, right: 4,
                      width: 18, height: 18, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)', color: 'white',
                      border: 'none', fontSize: 11, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >✕</button>
                </div>
              ))}

              {/* 新选图片（未上传） */}
              {newPreviews.map((src, idx) => (
                <div key={`new-${idx}`} style={{ aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', position: 'relative' }}
                  onClick={() => setFullscreenImg(src)}>
                  <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteNew(idx) }}
                    style={{
                      position: 'absolute', top: 4, right: 4,
                      width: 18, height: 18, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)', color: 'white',
                      border: 'none', fontSize: 11, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >✕</button>
                  <div style={{
                    position: 'absolute', bottom: 2, left: 2,
                    fontSize: 8, color: 'rgba(255,255,255,0.7)',
                    background: 'rgba(0,0,0,0.4)', borderRadius: 3, padding: '1px 3px',
                  }}>待上传</div>
                </div>
              ))}

              {/* ＋ 格 */}
              {totalImages < MAX_IMAGES && (
                <label style={{
                  aspectRatio: '1/1', borderRadius: 6,
                  border: '1.5px dashed #c9a96e', background: 'none',
                  color: '#c9a96e', fontSize: 20, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                    onChange={handleImageSelect} />
                  ＋
                </label>
              )}
            </div>
          </div>
        </div>
    </div>
  )
}

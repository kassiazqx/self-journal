// src/pages/EditEntryPage.jsx
// 统一编辑器：原始正文 + 觉察流引导&回答，连续展示，可全量编辑
// 保存：updateEntry(content) + upsert conversations.messages

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { updateEntry } from '../lib/journalService'
import { uploadImage, deleteImage, getImageUrl } from '../lib/imageStorage'
import DatetimePicker from '../components/DatetimePicker'
import { formatPill } from '../lib/dateUtils'

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

export default function EditEntryPage({ entry, onBack, onDone }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState(null) // null = 加载中
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [editDatetime, setEditDatetime] = useState(new Date(entry.created_at ?? Date.now()))
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

  // contentMap: { [msg.id]: string } 保存所有可编辑字段的当前值
  const [contentMap, setContentMap] = useState({})

  // 加载 conversations 表
  useEffect(() => {
    async function load() {
      const { data } = await db.from('conversations')
        .select('messages')
        .eq('entry_id', entry.id)
        .eq('context_type', 'entry')
        .maybeSingle()

      const msgs = data?.messages ?? []
      setMessages(msgs)

      // 初始化 contentMap
      if (msgs.length === 0) {
        setContentMap({ __raw__: entry.content ?? '' })
      } else {
        const map = {}
        msgs.forEach(msg => {
          if (
            msg.nodeType === 'raw_entry' ||
            msg.nodeType === 'local_answer' ||
            msg.nodeType === 'ai_answer'
          ) {
            map[msg.id] = msg.content ?? ''
          }
        })
        setContentMap(map)
      }
    }
    load()
  }, [entry.id])

  // 卸载时释放 ObjectURL，防止内存泄漏
  useEffect(() => {
    return () => { newPreviews.forEach(url => URL.revokeObjectURL(url)) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 删除已有图片（记录路径，保存时才真正删 Storage）
  function handleDeleteExisting(path) {
    pathsToDeleteRef.current = [...pathsToDeleteRef.current, path]
    setImagePaths(prev => prev.filter(p => p !== path))
  }

  // 删除新选图片（释放 ObjectURL）
  function handleDeleteNew(idx) {
    URL.revokeObjectURL(newPreviews[idx])
    setNewFiles(prev => prev.filter((_, i) => i !== idx))
    setNewPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  // 选择新图片
  function handleImageSelect(e) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    const existingKeys = new Set(newFiles.map(f => `${f.name}_${f.size}_${f.lastModified}`))
    const deduped = files.filter(f => !existingKeys.has(`${f.name}_${f.size}_${f.lastModified}`))
    const remaining = MAX_IMAGES - totalImages
    const toAdd = deduped.slice(0, remaining)
    const previews = toAdd.map(f => URL.createObjectURL(f))
    setNewFiles(prev => [...prev, ...toAdd])
    setNewPreviews(prev => [...prev, ...previews])
    e.target.value = ''
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setSaveError(false)

    try {
      const hasFlow = messages && messages.length > 0

      if (!hasFlow) {
        const newContent = (contentMap['__raw__'] ?? '').trim()
        await updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent, created_at: editDatetime.toISOString() } })
      } else {
        const updatedMessages = messages.map(msg => {
          if (msg.id in contentMap) return { ...msg, content: contentMap[msg.id] }
          return msg
        })
        const rawMsg = updatedMessages.find(m => m.nodeType === 'raw_entry')
        const newContent = (rawMsg?.content ?? entry.content ?? '').trim()
        await Promise.all([
          updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent, created_at: editDatetime.toISOString() } }),
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

      onDone?.()
    } catch (err) {
      console.error('[EditEntryPage handleSave]', err)
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  const isLoading = messages === null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: '#faf8f4' }}>

      {/* 时间编辑 picker */}
      {showPicker && (
        <DatetimePicker
          initialDatetime={editDatetime}
          onConfirm={d => { setEditDatetime(d); setShowPicker(false) }}
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
      }}>
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
        <button onClick={handleSave} disabled={saving || isLoading}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 500,
            color: saving || isLoading ? '#ccc' : saveError ? '#e05252' : '#c9a96e',
          }}>
          {saving ? '保存中…' : saveError ? '保存失败，重试' : '保存'}
        </button>
      </div>

      {/* 内容区 */}
      {isLoading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#ccc', fontSize: 14 }}>
          加载中…
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 40px' }}>

          {/* ── 无觉察流：单个大文本框 ── */}
          {messages.length === 0 && (
            <AutoTextarea
              value={contentMap['__raw__'] ?? ''}
              onChange={e => setContentMap(m => ({ ...m, '__raw__': e.target.value }))}
              autoFocus
              style={{
                fontSize: 15, lineHeight: 1.85, color: '#2d2d2d',
                minHeight: '60vh',
              }}
            />
          )}

          {/* ── 有觉察流：逐条渲染 ── */}
          {messages.map((msg, i) => {

            // 原始日记（可编辑大文本框）
            if (msg.nodeType === 'raw_entry') {
              return (
                <AutoTextarea
                  key={msg.id}
                  value={contentMap[msg.id] ?? ''}
                  onChange={e => setContentMap(m => ({ ...m, [msg.id]: e.target.value }))}
                  autoFocus={i === 0}
                  style={{
                    fontSize: 15, lineHeight: 1.85, color: '#2d2d2d',
                    marginBottom: 20, minHeight: 60,
                  }}
                />
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
                  onChange={e => setContentMap(m => ({ ...m, [msg.id]: e.target.value }))}
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
                  onChange={e => setContentMap(m => ({ ...m, [msg.id]: e.target.value }))}
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
      )}
    </div>
  )
}

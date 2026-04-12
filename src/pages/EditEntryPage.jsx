// src/pages/EditEntryPage.jsx
// 统一编辑器：原始正文 + 觉察流引导&回答，连续展示，可全量编辑
// 保存：updateEntry(content) + upsert conversations.messages

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { updateEntry } from '../lib/journalService'

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

  async function handleSave() {
    if (saving) return
    setSaving(true)

    const hasFlow = messages && messages.length > 0

    if (!hasFlow) {
      // 无觉察流：只更新 journal_entries.content，不碰 AI 字段
      const newContent = (contentMap['__raw__'] ?? '').trim()
      await updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent } })
    } else {
      // 有觉察流：更新两个地方，不碰 AI 字段
      const updatedMessages = messages.map(msg => {
        if (msg.id in contentMap) {
          return { ...msg, content: contentMap[msg.id] }
        }
        return msg
      })

      const rawMsg = updatedMessages.find(m => m.nodeType === 'raw_entry')
      const newContent = (rawMsg?.content ?? entry.content ?? '').trim()

      await Promise.all([
        updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent } }),
        db.from('conversations').upsert(
          {
            user_id: user.id,
            entry_id: entry.id,
            context_type: 'entry',
            messages: updatedMessages,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'entry_id,context_type' }
        ),
      ])
    }

    setSaving(false)
    onDone?.()
  }

  const isLoading = messages === null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: '#faf8f4' }}>

      {/* 顶部导航 */}
      <div style={{
        padding: '12px 18px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', background: '#faf8f4',
        borderBottom: '1px solid #ede9e2', flexShrink: 0,
      }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 14 }}>
          取消
        </button>
        <span style={{ fontSize: 13, color: '#aaa' }}>编辑记录</span>
        <button onClick={handleSave} disabled={saving || isLoading}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 500,
            color: saving || isLoading ? '#ccc' : '#c9a96e',
          }}>
          {saving ? '保存中…' : '保存'}
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
        </div>
      )}
    </div>
  )
}

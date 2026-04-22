// src/components/ReviewLetterDetail.jsx
// 回顾信详情页：只读展示信正文、关联记录跳转、相关脉络卡片
import { useState, useEffect } from 'react'
import React from 'react'
import { db } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { fetchThreadsByLetterId, updateThread } from '../lib/threadService'
import { updateReviewLetter } from '../lib/reviewLetterService'
import AnnotatedText from './AnnotatedText'
import AnnotationMenu from './AnnotationMenu'
import { useAnnotations } from '../hooks/useAnnotations'
import { useAnnotationInteraction } from '../hooks/useAnnotationInteraction'

function formatPeriod(start, end) {
  const s = new Date(start).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  const e = new Date(end).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  return `${s} - ${e}`
}

export default function ReviewLetterDetail({ letter: initialLetter, onBack, onOpenEntry, onOpenCandidateDetail, onOpenThreadDetail }) {
  const { user } = useAuth()
  const [letter, setLetter] = useState(initialLetter)
  const [threads, setThreads] = useState([])

  // ── 标注系统 ──
  const { annotations, activeColor, setActiveColor, addAnnotation, markSaved, resetAnnotations, dirty } =
    useAnnotations(letter.annotations)

  const letterContainerRef = React.useRef(null)
  const { menuVisible, menuPosition, handleMouseUp, handleTouchEnd, closeMenu, handleBold, handleHighlight, handleUnderline } =
    useAnnotationInteraction({
      containerRef: letterContainerRef,
      rawText: letter.content ?? '',
      addAnnotation,
      activeColor,
    })

  const saveTimerRef = React.useRef(null)
  React.useEffect(() => {
    if (!dirty) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        await updateReviewLetter(letter.id, user.id, { annotations })
        markSaved()
      } catch (e) {
        console.error('[ReviewLetterDetail] annotations 保存失败:', e)
      }
    }, 500)
    return () => clearTimeout(saveTimerRef.current)
  }, [dirty, annotations])

  // 进入后标记已读，同时补拉 annotations（列表查询不含此字段）
  useEffect(() => {
    if (!letter?.id) return
    db.from('review_letters')
      .select('is_read, annotations')
      .eq('id', letter.id)
      .single()
      .then(({ data }) => {
        if (!data) return
        if (!letter.is_read && data.is_read === false) {
          db.from('review_letters').update({ is_read: true }).eq('id', letter.id)
        }
        setLetter(l => ({ ...l, is_read: true }))
        resetAnnotations(data.annotations)
      })
  }, [letter?.id])

  // 加载本封信关联的候选脉络
  useEffect(() => {
    if (!letter?.id) return
    fetchThreadsByLetterId(letter.id).then(setThreads)
  }, [letter?.id])

  async function handleAccept(thread) {
    if (!user) return
    await updateThread(thread.id, user.id, { status: 'confirmed' })
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, status: 'confirmed' } : t))
  }

  async function handleIgnore(thread) {
    if (!user) return
    await updateThread(thread.id, user.id, { status: 'rejected' })
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, status: 'rejected' } : t))
  }

  function handleCardClick(thread) {
    if (thread.status === 'candidate') {
      onOpenCandidateDetail?.(thread)
    } else if (thread.status === 'confirmed') {
      onOpenThreadDetail?.(thread)
    }
    // rejected：不可点击
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#faf8f4',
    }}>

      {/* 顶部 — sticky 固定 */}
      <div style={{
        padding: '12px 18px 0',
        position: 'sticky', top: 0, zIndex: 10, background: '#faf8f4',
        flexShrink: 0,
      }}>
        <button onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: '#bbb', cursor: 'pointer',
            fontSize: 20, fontWeight: 300,
            padding: '6px 8px', margin: '-6px -8px',
            lineHeight: 1,
          }}>
          ‹
        </button>
      </div>

      {/* 内容区 — 独立滚动 */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 40 }}>
      <div style={{ padding: '16px 18px 0' }}>

        {/* 标题区 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#333', marginBottom: 4 }}>
            ✉ 回顾信
          </div>
          <div style={{ fontSize: 12, color: '#aaa' }}>
            {formatPeriod(letter.period_start, letter.period_end)}
            {' · '}{letter.entry_ids?.length ?? 0} 条记录
          </div>
        </div>

        {/* 信的正文 */}
        <div
          ref={letterContainerRef}
          style={{ position: 'relative', fontSize: 15, color: '#2d2d2d', lineHeight: 1.85, marginBottom: 24,
            WebkitTouchCallout: 'none' }}
          onMouseUp={handleMouseUp}
          onTouchEnd={handleTouchEnd}
          onContextMenu={e => e.preventDefault()}
        >
          <AnnotatedText text={letter.content ?? ''} annotations={annotations} />
          <AnnotationMenu
            visible={menuVisible}
            position={menuPosition}
            activeColor={activeColor}
            onBold={handleBold}
            onHighlight={handleHighlight}
            onUnderline={handleUnderline}
            onColorChange={setActiveColor}
            onClose={closeMenu}
          />
        </div>

        {/* 关联记录跳转 */}
        {letter.entry_ids?.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>关联记录</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {letter.entry_ids.map((entryId, idx) => (
                <button
                  key={entryId}
                  onClick={() => onOpenEntry(entryId)}
                  style={{
                    fontSize: 11, color: '#888',
                    border: '1px solid #e0dbd4', borderRadius: 4,
                    padding: '2px 8px', background: 'none', cursor: 'pointer',
                  }}
                >
                  #{idx + 1} ↗
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 相关脉络 */}
        {threads.length > 0 && (
          <div style={{ borderTop: '1px solid #ede9e2', paddingTop: 16 }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>AI 发现的规律 · 相关脉络</div>

            {threads.map(thread => {
              const isPending = thread.status === 'candidate'
              const isAccepted = thread.status === 'confirmed'
              const isIgnored = thread.status === 'rejected'

              return (
                <div
                  key={thread.id}
                  onClick={() => handleCardClick(thread)}
                  style={{
                    marginBottom: 10,
                    background: isAccepted ? '#f8fdf8' : isIgnored ? '#fafafa' : 'white',
                    border: `1px solid ${isAccepted ? '#d4edda' : isIgnored ? '#e8e8e8' : '#ede9e2'}`,
                    borderRadius: 14,
                    overflow: 'hidden',
                    opacity: isIgnored ? 0.7 : 1,
                    cursor: isIgnored ? 'default' : 'pointer',
                  }}
                >
                  {/* 卡片主体 */}
                  <div style={{ padding: '14px 14px 12px' }}>
                    {/* 名称 + 状态 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{
                        fontSize: 14, fontWeight: 600,
                        color: isIgnored ? '#aaa' : '#333',
                      }}>
                        {thread.name}
                      </span>
                      <span style={{
                        fontSize: 10, borderRadius: 4, padding: '1px 6px', fontWeight: 500,
                        color: isAccepted ? '#6aaa6a' : isIgnored ? '#bbb' : '#c9a96e',
                        background: isAccepted ? '#f0faf0' : isIgnored ? '#f5f5f5' : '#fdf5e6',
                        border: `1px solid ${isAccepted ? '#c8e6c8' : isIgnored ? '#e0e0e0' : '#f0e4cc'}`,
                      }}>
                        {isAccepted ? '已接受' : isIgnored ? '已忽略' : '待确认'}
                      </span>
                    </div>
                    {/* 发现理由 */}
                    {thread.arc_summary && (
                      <div style={{
                        fontSize: 12, color: isIgnored ? '#bbb' : '#888',
                        lineHeight: 1.65,
                        display: '-webkit-box', WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {thread.arc_summary}
                      </div>
                    )}
                  </div>

                  {/* 操作行 */}
                  {isPending && (
                    <div style={{ display: 'flex', borderTop: '1px solid #f0ece6' }}>
                      <button
                        onClick={e => { e.stopPropagation(); handleIgnore(thread) }}
                        style={{
                          flex: 1, height: 42, background: 'none', border: 'none',
                          borderRight: '1px solid #f0ece6',
                          fontSize: 13, color: '#bbb', cursor: 'pointer',
                        }}
                      >
                        忽略
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleAccept(thread) }}
                        style={{
                          flex: 1, height: 42, background: 'none', border: 'none',
                          fontSize: 13, color: '#c9a96e', fontWeight: 500, cursor: 'pointer',
                        }}
                      >
                        接受脉络
                      </button>
                    </div>
                  )}
                  {isAccepted && (
                    <div style={{
                      height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderTop: '1px solid #f0ece6', fontSize: 12, color: '#6aaa6a',
                    }}>
                      ✓ 已加入脉络追踪
                    </div>
                  )}
                  {isIgnored && (
                    <div style={{
                      height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderTop: '1px solid #f0ece6', fontSize: 12, color: '#ccc',
                    }}>
                      已忽略，不再追踪
                    </div>
                  )}
                </div>
              )
            })}

            {/* 全部处理完提示 */}
            {threads.every(t => t.status !== 'candidate') && (
              <div style={{ fontSize: 12, color: '#bbb', textAlign: 'center', padding: '4px 0 8px' }}>
                全部脉络已处理 · 可在「洞察」Tab 查看
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

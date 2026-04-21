// src/components/ReviewLetterDetail.jsx
// 回顾信详情页：只读展示信正文、关联记录跳转、预留 threads 入口
import { useState, useEffect } from 'react'
import { db } from '../lib/db'

function formatPeriod(start, end) {
  const s = new Date(start).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  const e = new Date(end).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  return `${s} - ${e}`
}

export default function ReviewLetterDetail({ letter: initialLetter, onBack, onOpenEntry }) {
  const [letter, setLetter] = useState(initialLetter)

  // 进入后标记已读
  useEffect(() => {
    if (letter && !letter.is_read) {
      db.from('review_letters')
        .update({ is_read: true })
        .eq('id', letter.id)
        .then(() => setLetter(l => ({ ...l, is_read: true })))
    }
  }, [letter?.id])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#faf8f4', overflowY: 'auto', paddingBottom: 40,
    }}>

      {/* 顶部 */}
      <div style={{ padding: '12px 18px 0' }}>
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
        <div style={{
          fontSize: 15, color: '#2d2d2d', lineHeight: 1.85,
          marginBottom: 24, whiteSpace: 'pre-wrap',
        }}>
          {letter.content}
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

        {/* 相关 threads（占位，后续 threads 系统上线承接） */}
        <div style={{ borderTop: '1px solid #ede9e2', paddingTop: 16 }}>
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>相关 threads</div>
          <div style={{ fontSize: 12, color: '#bbb', lineHeight: 1.6 }}>
            后续 threads 系统上线后，从这里承接延展入口。
          </div>
        </div>
      </div>
    </div>
  )
}

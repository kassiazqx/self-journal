// src/pages/InsightsPage.jsx
// 洞察页：心情曲线 + 情绪频率 + 核心需求 + 标签统计（手写 SVG，不引入图表库）
// 数据层：insightsService.js（不直接写 db.from）
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { loadInsightsData } from '../lib/insightsService'
// 扩展点：第二批功能加入回顾信列表页/脉络入口时，在此处引入路由跳转 handler

// 简单条形图（手写 SVG）
function BarChart({ data }) {
  // data: [{ label, count }]，按 count 降序，最多显示8条
  const top = [...data].sort((a, b) => b.count - a.count).slice(0, 8)
  const max = top[0]?.count || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {top.map(({ label, count }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#555', width: 52, textAlign: 'right',
            flexShrink: 0 }}>{label}</span>
          <div style={{ flex: 1, height: 10, background: '#f0ece4', borderRadius: 5 }}>
            <div style={{
              width: `${(count / max) * 100}%`, height: '100%',
              background: '#c9a96e', borderRadius: 5, transition: 'width 0.4s',
            }} />
          </div>
          <span style={{ fontSize: 11, color: '#bbb', width: 28 }}>{count}次</span>
        </div>
      ))}
    </div>
  )
}

// 心情折线图（手写 SVG）
function MoodLine({ moodData }) {
  if (!moodData.length) {
    return (
      <div style={{ textAlign: 'center', color: '#ccc', fontSize: 13, padding: '20px 0' }}>
        暂无数据
      </div>
    )
  }
  const W = 300, H = 80
  const scores = moodData.map(d => d.overall_state_score)
  const minS = Math.min(...scores), maxS = Math.max(...scores)
  const range = maxS - minS || 1
  const pts = moodData.map((d, i) => {
    const x = (i / (moodData.length - 1 || 1)) * W
    const y = H - ((d.overall_state_score - minS) / range) * H * 0.8 - H * 0.1
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke="#c9a96e" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
      {moodData.map((d, i) => {
        const x = (i / (moodData.length - 1 || 1)) * W
        const y = H - ((d.overall_state_score - minS) / range) * H * 0.8 - H * 0.1
        return <circle key={i} cx={x} cy={y} r="3" fill="#c9a96e" />
      })}
    </svg>
  )
}

export default function InsightsPage({ onOpenLetterList, onOpenThreads, onOpenThread }) {
  const { user } = useAuth()
  const [moodData, setMoodData] = useState([])
  const [emotionCounts, setEmotionCounts] = useState([])
  const [needsCounts, setNeedsCounts] = useState([])
  const [tagCounts, setTagCounts] = useState([])
  const [latestLetter, setLatestLetter] = useState(null)
  const [confirmedThreads, setConfirmedThreads] = useState([])
  const [allLetters, setAllLetters] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    async function load() {
      const result = await loadInsightsData(user.id, { days: 30 })
      setMoodData(result.moodData)
      setEmotionCounts(result.emotionCounts)
      setNeedsCounts(result.needsCounts)
      setTagCounts(result.tagCounts)
      setLatestLetter(result.latestLetter)
      setConfirmedThreads(result.confirmedThreads)
      setAllLetters(result.allLetters)
      setLoading(false)
    }
    load()
  }, [user])

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#ccc', fontSize: 14 }}>
        加载中…
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px',
      background: '#f5f3ef' }}>

      {/* 页面标题 */}
      <div style={{ fontSize: 16, fontWeight: 600, color: '#333', marginBottom: 20 }}>
        洞察
      </div>

      {/* ── 回顾信入口区块 ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>回顾信</span>
          {allLetters.length > 0 && (
            <button
              onClick={() => onOpenLetterList?.(allLetters)}
              style={{ fontSize: 11, color: '#c9a96e', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              查看全部 →
            </button>
          )}
        </div>
        {latestLetter ? (
          <div style={{ background: '#fffdf8', border: '1px solid #f0e8d4',
            borderRadius: 12, padding: '12px 14px', cursor: 'pointer' }}
            onClick={() => onOpenLetterList?.(allLetters)}>
            <div style={{ fontSize: 11, color: '#c9a96e', marginBottom: 6 }}>
              ✉ 最新回顾信
              {!latestLetter.is_read && (
                <span style={{ marginLeft: 6, width: 6, height: 6, borderRadius: '50%',
                  background: '#c9a96e', display: 'inline-block', verticalAlign: 'middle' }} />
              )}
            </div>
            <div style={{ fontSize: 13, color: '#555', lineHeight: 1.65,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {latestLetter.content}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#ccc', textAlign: 'center', padding: '10px 0' }}>
            暂无回顾信（累积 6 条记录后生成）
          </div>
        )}
      </div>

      {/* ── 脉络入口区块 ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>脉络</span>
          <button
            onClick={onOpenThreads}
            style={{ fontSize: 11, color: '#c9a96e', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {confirmedThreads.length > 0 ? '查看全部 →' : '+ 新建脉络'}
          </button>
        </div>
        {confirmedThreads.length > 0 ? confirmedThreads.map(thread => (
          <div key={thread.id}
            onClick={() => onOpenThread?.(thread)}
            style={{ background: 'white', borderRadius: 10, padding: '10px 14px',
              marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', cursor: 'pointer' }}>
            <div style={{ fontSize: 13, color: '#333', fontWeight: 500, marginBottom: 4 }}>{thread.name}</div>
            {thread.arc_summary && (
              <div style={{ fontSize: 12, color: '#888', lineHeight: 1.6,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {thread.arc_summary}
              </div>
            )}
          </div>
        )) : (
          <div style={{ fontSize: 13, color: '#ccc', textAlign: 'center', padding: '10px 0' }}>
            暂无脉络，生成回顾信后 AI 会提议
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 16,
        letterSpacing: '0.5px', textAlign: 'center' }}>
        ── 最近 30 天 ──
      </div>

      {/* 心情曲线 */}
      <div style={{ background: 'white', borderRadius: 12, padding: '14px',
        marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 12, color: '#555', fontWeight: 500, marginBottom: 12 }}>
          心情曲线
        </div>
        <MoodLine moodData={moodData} />
      </div>

      {/* 情绪频率 */}
      <div style={{ background: 'white', borderRadius: 12, padding: '14px',
        marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 12, color: '#555', fontWeight: 500, marginBottom: 12 }}>
          情绪频率
        </div>
        {emotionCounts.length ? (
          <BarChart data={emotionCounts} />
        ) : (
          <div style={{ fontSize: 13, color: '#ccc', textAlign: 'center', padding: '10px 0' }}>
            暂无数据（完成 AI 分析后可见）
          </div>
        )}
      </div>

      {/* 核心需求 */}
      {needsCounts.length > 0 && (
        <div style={{ background: 'white', borderRadius: 12, padding: '14px',
          marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, color: '#555', fontWeight: 500, marginBottom: 12 }}>
            核心需求分布
          </div>
          <BarChart data={needsCounts} />
        </div>
      )}

      {/* 标签统计 */}
      {tagCounts.length > 0 && (
        <div style={{ background: 'white', borderRadius: 12, padding: '14px',
          marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, color: '#555', fontWeight: 500, marginBottom: 12 }}>
            标签统计
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[...tagCounts].sort((a, b) => b.count - a.count).slice(0, 10).map(({ label, count }) => (
              <span key={label} style={{
                fontSize: 11, background: '#f0ece4', color: '#8a7a6a',
                padding: '3px 10px', borderRadius: 10,
              }}>
                #{label} {count}次
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

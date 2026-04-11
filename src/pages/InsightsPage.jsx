// src/pages/InsightsPage.jsx
// 洞察页：心情曲线 + 情绪频率 + 核心需求 + 标签统计（手写 SVG，不引入图表库）
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'

// 过去 30 天的 ISO 起始时间
function thirtyDaysAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString()
}

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

export default function InsightsPage() {
  const { user } = useAuth()
  const [moodData, setMoodData] = useState([])
  const [emotionCounts, setEmotionCounts] = useState([])
  const [needsCounts, setNeedsCounts] = useState([])
  const [tagCounts, setTagCounts] = useState([])
  const [latestLetter, setLatestLetter] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    async function load() {
      const since = thirtyDaysAgo()

      const [moodRes, emotionRes, needsRes, letterRes, tagsRes] = await Promise.all([
        db.from('journal_entries')
          .select('created_at, overall_state_score')
          .eq('user_id', user.id)
          .not('overall_state_score', 'is', null)
          .gte('created_at', since)
          .order('created_at', { ascending: true }),
        db.from('journal_entries')
          .select('emotions')
          .eq('user_id', user.id)
          .gte('created_at', since),
        db.from('journal_entries')
          .select('core_needs')
          .eq('user_id', user.id)
          .gte('created_at', since),
        db.from('review_letters')
          .select('id, content, period_start, period_end, is_read')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        db.from('journal_entries')
          .select('category_tags')
          .eq('user_id', user.id)
          .gte('created_at', since),
      ])

      setMoodData(moodRes.data ?? [])
      setLatestLetter(letterRes.data ?? null)

      // 情绪频率：展开数组统计
      const eCounts = {}
      ;(emotionRes.data ?? []).forEach(row => {
        ;(row.emotions ?? []).forEach(w => {
          eCounts[w] = (eCounts[w] ?? 0) + 1
        })
      })
      setEmotionCounts(Object.entries(eCounts).map(([label, count]) => ({ label, count })))

      // 核心需求频率
      const nCounts = {}
      ;(needsRes.data ?? []).forEach(row => {
        ;(row.core_needs ?? []).forEach(w => {
          nCounts[w] = (nCounts[w] ?? 0) + 1
        })
      })
      setNeedsCounts(Object.entries(nCounts).map(([label, count]) => ({ label, count })))

      // 标签频率
      const tCounts = {}
      ;(tagsRes.data ?? []).forEach(row => {
        ;(row.category_tags ?? []).forEach(t => {
          tCounts[t] = (tCounts[t] ?? 0) + 1
        })
      })
      setTagCounts(Object.entries(tCounts).map(([label, count]) => ({ label, count })))

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

      {/* 最新回顾信预览 */}
      {latestLetter && (
        <div style={{ background: '#fffdf8', border: '1px solid #f0e8d4',
          borderRadius: 12, padding: '12px 14px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#c9a96e', marginBottom: 6 }}>
            ✉ 最新回顾信
            {!latestLetter.is_read && (
              <span style={{ marginLeft: 6, width: 6, height: 6, borderRadius: '50%',
                background: '#c9a96e', display: 'inline-block', verticalAlign: 'middle' }} />
            )}
          </div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 1.65,
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
            overflow: 'hidden' }}>
            {latestLetter.content}
          </div>
        </div>
      )}

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

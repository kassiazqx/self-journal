import { useState, useRef, useEffect } from 'react'

const QUICK = [
  { label: '今天', offset: 0 },
  { label: '昨天', offset: -1 },
  { label: '前天', offset: -2 },
  { label: '大前天', offset: -3 },
]
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

const ITEM_H = 38
const VISIBLE = 5
const COL_H = ITEM_H * VISIBLE
const PAD = ITEM_H * Math.floor(VISIBLE / 2)

function dateOffset(base, offset) {
  const d = new Date(base)
  d.setDate(d.getDate() + offset)
  return d
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

// 滑动鼓轮列
function ScrollColumn({ items, selected, onSelect }) {
  const ref = useRef(null)
  const ticking = useRef(false)

  // 初始化滚动位置
  useEffect(() => {
    if (!ref.current) return
    const idx = items.indexOf(selected)
    if (idx >= 0) ref.current.scrollTop = idx * ITEM_H
  }, [items, selected])

  function handleScroll() {
    if (ticking.current) return
    ticking.current = true
    requestAnimationFrame(() => {
      ticking.current = false
      if (!ref.current) return
      const idx = Math.round(ref.current.scrollTop / ITEM_H)
      const clamped = Math.max(0, Math.min(idx, items.length - 1))
      if (items[clamped] !== undefined) onSelect(items[clamped])
    })
  }

  function handleClick(item, idx) {
    onSelect(item)
    ref.current?.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' })
  }

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      style={{
        height: COL_H,
        overflowY: 'scroll',
        scrollSnapType: 'y mandatory',
        paddingTop: PAD,
        paddingBottom: PAD,
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {items.map((item, idx) => (
        <div
          key={item}
          onClick={() => handleClick(item, idx)}
          style={{
            height: ITEM_H,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            scrollSnapAlign: 'center',
            fontSize: item === selected ? 16 : 13,
            color: item === selected ? '#c9a96e' : '#ccc',
            fontWeight: item === selected ? 600 : 400,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          {String(item).padStart(2, '0')}
        </div>
      ))}
    </div>
  )
}

export default function DatetimePicker({ initialDatetime, onConfirm, onClose }) {
  const now = new Date()
  const init = initialDatetime instanceof Date ? initialDatetime : new Date()

  const [selectedDate, setSelectedDate] = useState(init)
  const [selectedHour, setSelectedHour] = useState(init.getHours())
  const [selectedMinute, setSelectedMinute] = useState(init.getMinutes())
  const [calMonth, setCalMonth] = useState({ year: init.getFullYear(), month: init.getMonth() })

  function handleQuick(offset) {
    const d = dateOffset(now, offset)
    setSelectedDate(d)
    setCalMonth({ year: d.getFullYear(), month: d.getMonth() })
  }

  function prevMonth() {
    setCalMonth(c => c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 })
  }
  function nextMonth() {
    setCalMonth(c => c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 })
  }

  function buildCalDays() {
    const { year, month } = calMonth
    const firstDay = new Date(year, month, 1).getDay()
    const startOffset = firstDay === 0 ? 6 : firstDay - 1
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < startOffset; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
    return cells
  }

  function isQuickSelected(offset) {
    return isSameDay(selectedDate, dateOffset(now, offset))
  }

  function handleConfirm() {
    const result = new Date(selectedDate)
    result.setHours(selectedHour, selectedMinute, 0, 0)
    onConfirm(result)
  }

  const calDays = buildCalDays()

  return (
    <>
      {/* 背景遮罩 */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.18)' }}
      />

      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101,
        background: 'white', borderRadius: '16px 16px 0 0',
        padding: '14px 16px 32px',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.1)',
      }}>
        {/* drag handle */}
        <div style={{ width: 36, height: 3, background: '#e5e7eb', borderRadius: 99, margin: '0 auto 14px' }} />

        {/* 标题 */}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 12 }}>记录时间</div>

        {/* 快捷按钮 */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {QUICK.map(q => (
            <button
              key={q.label}
              onClick={() => handleQuick(q.offset)}
              style={{
                padding: '4px 10px', borderRadius: 99, fontSize: 12,
                border: `1px solid ${isQuickSelected(q.offset) ? '#c9a96e' : '#e5e7eb'}`,
                background: isQuickSelected(q.offset) ? '#c9a96e' : 'none',
                color: isQuickSelected(q.offset) ? 'white' : '#555',
                cursor: 'pointer',
              }}
            >{q.label}</button>
          ))}
        </div>

        {/* 主区域：左日历 + 右时间鼓轮 */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>

          {/* 左：迷你日历 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* 月份导航 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <button onClick={prevMonth} style={{ background: 'none', border: 'none', fontSize: 14, color: '#aaa', cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>‹</button>
              <span style={{ fontSize: 11, color: '#555' }}>{calMonth.year}年{calMonth.month + 1}月</span>
              <button onClick={nextMonth} style={{ background: 'none', border: 'none', fontSize: 14, color: '#aaa', cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>›</button>
            </div>
            {/* 日历格 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
              {WEEK_LABELS.map(l => (
                <div key={l} style={{ fontSize: 9, color: '#ccc', textAlign: 'center', paddingBottom: 4 }}>{l}</div>
              ))}
              {calDays.map((d, i) => {
                if (!d) return <div key={`e${i}`} />
                const isSelected = isSameDay(d, selectedDate)
                const isToday = isSameDay(d, now)
                return (
                  <div
                    key={d.toISOString()}
                    onClick={() => { setSelectedDate(d); setCalMonth({ year: d.getFullYear(), month: d.getMonth() }) }}
                    style={{
                      fontSize: 11, textAlign: 'center',
                      padding: '5px 0',
                      borderRadius: isSelected ? '50%' : 4,
                      background: isSelected ? '#c9a96e' : 'none',
                      color: isSelected ? 'white' : isToday ? '#c9a96e' : '#555',
                      fontWeight: isToday && !isSelected ? 600 : 400,
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >{d.getDate()}</div>
                )
              })}
            </div>
          </div>

          {/* 分隔线 */}
          <div style={{ width: 1, background: '#f0f0f0', alignSelf: 'stretch', flexShrink: 0 }} />

          {/* 右：时分鼓轮 */}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', position: 'relative' }}>
            {/* 中间高亮条 */}
            <div style={{
              position: 'absolute',
              top: '50%', transform: 'translateY(-50%)',
              left: 0, right: 0,
              height: ITEM_H,
              background: '#fdf6ec',
              borderRadius: 8,
              pointerEvents: 'none',
              zIndex: 0,
            }} />
            {/* 时 */}
            <div style={{ position: 'relative', zIndex: 1, width: 46 }}>
              <ScrollColumn items={HOURS} selected={selectedHour} onSelect={setSelectedHour} />
            </div>
            {/* 冒号 */}
            <div style={{ fontSize: 15, color: '#c9a96e', fontWeight: 700, padding: '0 2px', zIndex: 1, flexShrink: 0 }}>:</div>
            {/* 分 */}
            <div style={{ position: 'relative', zIndex: 1, width: 46 }}>
              <ScrollColumn items={MINUTES} selected={selectedMinute} onSelect={setSelectedMinute} />
            </div>
          </div>
        </div>

        {/* 确认按钮 */}
        <button
          onClick={handleConfirm}
          style={{
            width: '100%', padding: 10, borderRadius: 10, border: 'none',
            background: '#c9a96e', color: 'white', fontSize: 14,
            cursor: 'pointer', marginTop: 14,
          }}
        >确认</button>
      </div>
    </>
  )
}

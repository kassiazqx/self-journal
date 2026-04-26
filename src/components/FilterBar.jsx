// src/components/FilterBar.jsx
// 搜索框 + 情绪/类型/日期筛选器，通过 onFilter 回调通知父页面
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'

// 情绪分组（顺序：正面 → 混合/中性 → 负面）
const EMOTION_POSITIVE = ['轻松','满足','感激','开心','平静','期待','温暖','喜悦','自豪','踏实','安心','充实','兴奋','爱','敬畏','信任','被信任','悲悯','敬佩','欣赏']
const EMOTION_MIXED    = ['迷茫','矛盾','好奇','纠结','释然','依恋','敏感','复杂','惊讶','无聊','尴尬','怀念','同情','渴望']
const EMOTION_NEGATIVE = ['难过','愤怒','委屈','焦虑','羞愧','无力','害怕','孤独','绝望','沮丧','厌烦','烦躁','压抑','紧张','失落','嫉妒','内疚','抗拒','疲惫','麻木','不甘','崩溃','厌恶','悲痛','羞耻','轻视','后悔']

export default function FilterBar({
  onFilter,
  categoryOptions = [],
  peopleOptions = [],
  coreNeedOptions = [],
  placeholder = '搜索内容…',
  showDate = true,
}) {
  const { user } = useAuth()

  const [searchText, setSearchText]               = useState('')
  const [selectedEmotions, setSelectedEmotions]   = useState([])
  const [selectedCategories, setSelectedCategories] = useState([])
  const [selectedPeople, setSelectedPeople]       = useState([])
  const [selectedCoreNeeds, setSelectedCoreNeeds] = useState([])
  const [selectedDate, setSelectedDate]           = useState(null)
  const [showEmotionMenu, setShowEmotionMenu]     = useState(false)
  const [showCategoryMenu, setShowCategoryMenu]   = useState(false)
  const [showPeopleMenu, setShowPeopleMenu]       = useState(false)
  const [showCoreNeedsMenu, setShowCoreNeedsMenu] = useState(false)
  const [showCalendar, setShowCalendar]           = useState(false)

  const now = new Date()
  const [calendarYear, setCalendarYear]   = useState(now.getFullYear())
  const [calendarMonth, setCalendarMonth] = useState(now.getMonth())
  const [datesWithRecords, setDatesWithRecords] = useState(new Set())

  const searchTimer = useRef(null)
  const filterBarRef = useRef(null)
  const emotionMenuRef = useRef(null)
  const categoryMenuRef = useRef(null)
  const peopleMenuRef = useRef(null)
  const coreNeedsMenuRef = useRef(null)

  // 点击 FilterBar 外部时关闭浮层（不用 fixed 遮罩，避免拦截父容器滚动）
  useEffect(() => {
    if (!showEmotionMenu && !showCategoryMenu && !showPeopleMenu && !showCoreNeedsMenu) return
    function handleOutside(e) {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target)) {
        setShowEmotionMenu(false)
        setShowCategoryMenu(false)
        setShowPeopleMenu(false)
        setShowCoreNeedsMenu(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [showEmotionMenu, showCategoryMenu, showPeopleMenu, showCoreNeedsMenu])

  // 浮层展开时自动滚动：让浮层底部 + 200px（约3条笔记）进入视野
  function scrollToShowMenu(menuEl) {
    if (!menuEl) return
    // 找最近的 overflowY: auto/scroll 祖先容器
    let container = menuEl.parentElement
    while (container) {
      const ov = getComputedStyle(container).overflowY
      if (ov === 'auto' || ov === 'scroll') break
      container = container.parentElement
    }
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const elRect = menuEl.getBoundingClientRect()
    const targetBottom = elRect.bottom + 200  // 多留 200px 给笔记
    if (targetBottom > containerRect.bottom) {
      container.scrollBy({ top: targetBottom - containerRect.bottom, behavior: 'smooth' })
    }
  }

  useEffect(() => {
    if (!showEmotionMenu) return
    const id = setTimeout(() => scrollToShowMenu(emotionMenuRef.current), 50)
    return () => clearTimeout(id)
  }, [showEmotionMenu])

  useEffect(() => {
    if (!showCategoryMenu) return
    const id = setTimeout(() => scrollToShowMenu(categoryMenuRef.current), 50)
    return () => clearTimeout(id)
  }, [showCategoryMenu])

  useEffect(() => {
    if (!showPeopleMenu) return
    const id = setTimeout(() => scrollToShowMenu(peopleMenuRef.current), 50)
    return () => clearTimeout(id)
  }, [showPeopleMenu])

  useEffect(() => {
    if (!showCoreNeedsMenu) return
    const id = setTimeout(() => scrollToShowMenu(coreNeedsMenuRef.current), 50)
    return () => clearTimeout(id)
  }, [showCoreNeedsMenu])

  // 任何筛选条件变化时通知父页面（搜索框 300ms 防抖）
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      onFilter({ searchText, selectedEmotions, selectedCategories, selectedPeople, selectedCoreNeeds, selectedDate })
    }, 300)
    return () => clearTimeout(searchTimer.current)
  }, [searchText, selectedEmotions, selectedCategories, selectedPeople, selectedCoreNeeds, selectedDate, onFilter])

  const fetchDatesWithRecords = useCallback(async () => {
    const start = new Date(calendarYear, calendarMonth, 1).toISOString()
    const end   = new Date(calendarYear, calendarMonth + 1, 0, 23, 59, 59).toISOString()
    const { data } = await db.from('journal_entries')
      .select('created_at')
      .eq('user_id', user.id)
      .gte('created_at', start)
      .lte('created_at', end)
    setDatesWithRecords(new Set(
      (data ?? []).map(r => {
        const d = new Date(r.created_at)  // 转设备本地时间
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      })
    ))
  }, [calendarMonth, calendarYear, user])

  // 月历展开或切换月份时，查询当月哪些天有记录
  useEffect(() => {
    if (!showCalendar || !user) return
    const timer = setTimeout(() => { fetchDatesWithRecords() }, 0)
    return () => clearTimeout(timer)
  }, [showCalendar, user, fetchDatesWithRecords])

  function toggleEmotion(e) {
    setSelectedEmotions(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e])
  }
  function toggleCategory(c) {
    setSelectedCategories(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  }
  function togglePerson(p) {
    setSelectedPeople(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  }
  function toggleCoreNeed(n) {
    setSelectedCoreNeeds(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])
  }
  function handleDateClick(date) {
    setSelectedDate(prev => prev && prev.toDateString() === date.toDateString() ? null : date)
  }
  function prevMonth() {
    if (calendarMonth === 0) { setCalendarYear(y => y - 1); setCalendarMonth(11) }
    else setCalendarMonth(m => m - 1)
  }
  function nextMonth() {
    if (calendarMonth === 11) { setCalendarYear(y => y + 1); setCalendarMonth(0) }
    else setCalendarMonth(m => m + 1)
  }

  const today = new Date()
  const firstDayOfWeek = (new Date(calendarYear, calendarMonth, 1).getDay() + 6) % 7 // 周一为0
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate()

  const chipStyle = (active) => ({
    flexShrink: 0, padding: '4px 10px', borderRadius: 20,
    border: '1px solid #e0dbd4', cursor: 'pointer', whiteSpace: 'nowrap',
    background: active ? '#c9a96e' : 'white',
    color: active ? 'white' : '#666', fontSize: 12,
  })
  const selectedChipStyle = {
    flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 8px', borderRadius: 20,
    background: '#f0e8d4', fontSize: 12, color: '#8a7a5a',
  }
  const emotionBtnStyle = (selected) => ({
    padding: '4px 10px', borderRadius: 20, border: '1px solid #e0dbd4',
    cursor: 'pointer', fontSize: 12,
    background: selected ? '#c9a96e' : '#f5f3ef',
    color: selected ? 'white' : '#555',
  })

  return (
    <div ref={filterBarRef} style={{ background: '#faf8f4', borderBottom: '1px solid #ede9e2' }}>

      {/* 搜索框 */}
      <div style={{ padding: '10px 16px 0' }}>
        <div style={{ position: 'relative' }}>
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder={placeholder}
            style={{
              width: '100%', boxSizing: 'border-box',
              border: '1px solid #e0dbd4', borderRadius: 8,
              padding: '8px 32px 8px 12px', fontSize: 13,
              outline: 'none', background: 'white', fontFamily: 'inherit',
            }}
          />
          {searchText && (
            <button onClick={() => setSearchText('')}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 筛选 chip 行（横向可滚动） */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 16px', overflowX: 'auto' }}>
        {/* 情绪 */}
        <button style={chipStyle(showEmotionMenu)}
          onClick={() => { setShowEmotionMenu(v => !v); setShowCategoryMenu(false); setShowCalendar(false); setShowPeopleMenu(false); setShowCoreNeedsMenu(false) }}>
          情绪 ▾
        </button>
        {selectedEmotions.map(e => (
          <span key={e} style={selectedChipStyle}>
            {e}
            <button onClick={() => toggleEmotion(e)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#8a7a5a', fontSize: 12 }}>✕</button>
          </span>
        ))}

        {/* 类型 */}
        <button style={chipStyle(showCategoryMenu)}
          onClick={() => { setShowCategoryMenu(v => !v); setShowEmotionMenu(false); setShowCalendar(false); setShowPeopleMenu(false); setShowCoreNeedsMenu(false) }}>
          类型 ▾
        </button>
        {selectedCategories.map(c => (
          <span key={c} style={selectedChipStyle}>
            {c}
            <button onClick={() => toggleCategory(c)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#8a7a5a', fontSize: 12 }}>✕</button>
          </span>
        ))}

        {/* 人物（词库为空时不渲染） */}
        {peopleOptions.length > 0 && <>
          <button style={chipStyle(showPeopleMenu)}
            onClick={() => { setShowPeopleMenu(v => !v); setShowEmotionMenu(false); setShowCategoryMenu(false); setShowCalendar(false); setShowCoreNeedsMenu(false) }}>
            人物 ▾
          </button>
          {selectedPeople.map(p => (
            <span key={p} style={selectedChipStyle}>
              {p}
              <button onClick={() => togglePerson(p)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#8a7a5a', fontSize: 12 }}>✕</button>
            </span>
          ))}
        </>}

        {/* 需求（词库为空时不渲染） */}
        {coreNeedOptions.length > 0 && <>
          <button style={chipStyle(showCoreNeedsMenu)}
            onClick={() => { setShowCoreNeedsMenu(v => !v); setShowEmotionMenu(false); setShowCategoryMenu(false); setShowCalendar(false); setShowPeopleMenu(false) }}>
            需求 ▾
          </button>
          {selectedCoreNeeds.map(n => (
            <span key={n} style={selectedChipStyle}>
              {n}
              <button onClick={() => toggleCoreNeed(n)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#8a7a5a', fontSize: 12 }}>✕</button>
            </span>
          ))}
        </>}

        {/* 日期（仅 showDate=true） */}
        {showDate && <>
          <button style={chipStyle(showCalendar)}
            onClick={() => { setShowCalendar(v => !v); setShowEmotionMenu(false); setShowCategoryMenu(false); setShowPeopleMenu(false); setShowCoreNeedsMenu(false) }}>
            日期 ▾
          </button>
          {selectedDate && (
            <span style={selectedChipStyle}>
              {selectedDate.getMonth()+1}月{selectedDate.getDate()}日
              <button onClick={() => setSelectedDate(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#8a7a5a', fontSize: 12 }}>✕</button>
            </span>
          )}
        </>}
      </div>

      {/* 情绪浮层 */}
      {showEmotionMenu && (
        <div ref={emotionMenuRef} style={{ margin: '0 16px 8px',
          background: 'white', borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          padding: 12, maxHeight: 280, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button onClick={() => setShowEmotionMenu(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✅</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EMOTION_POSITIVE.map(e => <button key={e} style={emotionBtnStyle(selectedEmotions.includes(e))} onClick={() => toggleEmotion(e)}>{e}</button>)}
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid #ede9e2', margin: '8px 0' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EMOTION_MIXED.map(e => <button key={e} style={emotionBtnStyle(selectedEmotions.includes(e))} onClick={() => toggleEmotion(e)}>{e}</button>)}
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid #ede9e2', margin: '8px 0' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EMOTION_NEGATIVE.map(e => <button key={e} style={emotionBtnStyle(selectedEmotions.includes(e))} onClick={() => toggleEmotion(e)}>{e}</button>)}
          </div>
        </div>
      )}

      {/* 类型浮层 */}
      {showCategoryMenu && (
        <div ref={categoryMenuRef} style={{ margin: '0 16px 8px',
          background: 'white', borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button onClick={() => setShowCategoryMenu(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✅</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {categoryOptions.length === 0
              ? <span style={{ fontSize: 12, color: '#bbb' }}>暂无标签，请先在「我的」中添加</span>
              : categoryOptions.map(c => <button key={c} style={emotionBtnStyle(selectedCategories.includes(c))} onClick={() => toggleCategory(c)}>{c}</button>)
            }
          </div>
        </div>
      )}

      {/* 人物浮层 */}
      {showPeopleMenu && (
        <div ref={peopleMenuRef} style={{ margin: '0 16px 8px',
          background: 'white', borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          padding: 12, maxHeight: 240, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button onClick={() => setShowPeopleMenu(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✅</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {peopleOptions.map(p => <button key={p} style={emotionBtnStyle(selectedPeople.includes(p))} onClick={() => togglePerson(p)}>{p}</button>)}
          </div>
        </div>
      )}

      {/* 需求浮层 */}
      {showCoreNeedsMenu && (
        <div ref={coreNeedsMenuRef} style={{ margin: '0 16px 8px',
          background: 'white', borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          padding: 12, maxHeight: 240, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button onClick={() => setShowCoreNeedsMenu(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✅</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {coreNeedOptions.map(n => <button key={n} style={emotionBtnStyle(selectedCoreNeeds.includes(n))} onClick={() => toggleCoreNeed(n)}>{n}</button>)}
          </div>
        </div>
      )}

      {/* 内联月历 */}
      {showDate && showCalendar && (
        <div style={{ padding: '0 16px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <button onClick={prevMonth}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#888', padding: '0 4px' }}>‹</button>
            <span style={{ fontSize: 12, color: '#555', fontWeight: 500 }}>
              {calendarYear}年{calendarMonth + 1}月
            </span>
            <button onClick={nextMonth}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#888', padding: '0 4px' }}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: 2 }}>
            {['一','二','三','四','五','六','日'].map(d => (
              <span key={d} style={{ fontSize: 10, color: '#bbb' }}>{d}</span>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`pad-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1
              const date = new Date(calendarYear, calendarMonth, day)
              const dateStr = `${calendarYear}-${String(calendarMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const hasRecord = datesWithRecords.has(dateStr)
              const isToday    = date.toDateString() === today.toDateString()
              const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString()
              return (
                <button key={day} onClick={() => handleDateClick(date)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    border: 'none', cursor: 'pointer', fontSize: 11,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto',
                    background: isSelected ? '#c9a96e' : 'transparent',
                    color: isSelected ? 'white' : isToday ? '#c9a96e' : hasRecord ? '#333' : '#ccc',
                    boxShadow: isToday && !isSelected ? 'inset 0 0 0 1.5px #c9a96e' : 'none',
                    fontWeight: isSelected || isToday ? 600 : 400,
                  }}>
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

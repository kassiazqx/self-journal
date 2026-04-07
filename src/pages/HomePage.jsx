import { useState, useRef, useEffect } from 'react'
import { Mic, MicOff, ArrowRight, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { detectCategories, PREDEFINED_CATEGORIES } from '../lib/keywordDetection'

// 模板配置
const TEMPLATES = [
  {
    id: 'gratitude',
    emoji: '🩷',
    label: '感恩',
    hint: '今天有什么值得感谢的？是谁、是什么事让你感到温暖或幸运？',
  },
  {
    id: 'emotion',
    emoji: '🌷',
    label: '觉察',
    hint: '现在是什么感受？发生了什么？你注意到自己身体上有什么感觉吗？',
  },
  {
    id: 'free',
    emoji: '✨',
    label: '灵感',
    hint: '一闪而过的念头、想法、观察——不用整理，直接写下来就好。',
  },
  {
    id: 'learning',
    emoji: '📝',
    label: '学习',
    hint: '今天学了什么？用自己的话说一遍，有什么让你印象深刻或有疑惑的地方？',
  },
  {
    id: 'action',
    emoji: '💪🏻',
    label: '行动',
    hint: '今天做了什么？运动、完成了一件事——时长、状态、身体感受如何？',
  },
]

// 把 Date 转成 datetime-local input 需要的格式：YYYY-MM-DDTHH:mm
function toDatetimeLocal(date) {
  const d = new Date(date)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 从文本中推断时间，返回 datetime-local 字符串
// 只在用户没有手动改过时间时调用
function inferDatetime(text) {
  const now = new Date()
  const d = new Date(now)

  const chineseHourMap = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    十一: 11,
    十二: 12,
  }

  const toClosestHour = (hour, minute) => {
    if (hour < 1 || hour > 11) return hour

    const candidateA = new Date(d)
    candidateA.setHours(hour, minute, 0, 0)

    const candidateB = new Date(d)
    candidateB.setHours(hour + 12, minute, 0, 0)

    return Math.abs(candidateA.getTime() - now.getTime()) <= Math.abs(candidateB.getTime() - now.getTime())
      ? hour
      : hour + 12
  }

  // 展开口语缩写，方便后续统一判断
  const t = text
    .replace(/昨晚|昨夜/g, '昨天晚上')
    .replace(/今晚/g, '今天晚上')
    .replace(/今早|今晨/g, '今天早上')

  const periodPrefix = t.match(/凌晨|早上|上午|中午|下午|傍晚|晚上|夜里/)?.[0] ?? null

  let dayOffset = 0
  // 日期偏移（今天优先级最高，大前天必须在前天之前检查）
  if (t.includes('今天')) {
    dayOffset = 0
  }
  else if (t.includes('大前天')) {
    dayOffset = -3
    d.setDate(d.getDate() - 3)
  }
  else if (t.includes('前天')) {
    dayOffset = -2
    d.setDate(d.getDate() - 2)
  }
  else if (t.includes('昨天')) {
    dayOffset = -1
    d.setDate(d.getDate() - 1)
  }

  // 先识别明确时间点：9点10 / 9:10 / 9：10 / 晚上9点 / 九点半 / 九点二十 / 九点一刻
  const colonMatch = t.match(/(?:^|[^\d])(\d{1,2})[:：](\d{1,2})(?:[^\d]|$)/)
  const pointMatch = t.match(/(?:^|[^\d])(\d{1,2})点(?:(\d{1,2})分?)?(?:[^\d]|$)/)
  const chinesePointMatch = t.match(/(十二|十一|十|[一二三四五六七八九])点(半|一刻|两刻|三刻|四刻|[二三四五][十]?[一二三四五六七八九]?分?|[十][一二三四五六七八九]?分?|[一二三四五六七八九]分)?/)

  // 中文分钟解析
  const parseChineseMinute = (str) => {
    if (!str) return 0
    if (str === '半') return 30
    if (str === '一刻') return 15
    if (str === '两刻') return 30
    if (str === '三刻') return 45
    if (str === '四刻') return 60
    // 处理"二十"、"三十五分"等
    const minMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
    const clean = str.replace(/分$/, '')
    if (clean.startsWith('十')) {
      const rest = clean.slice(1)
      return 10 + (minMap[rest] ?? 0)
    }
    if (clean.length >= 2 && clean[1] === '十') {
      const tens = minMap[clean[0]] ?? 0
      const rest = clean.slice(2)
      return tens * 10 + (minMap[rest] ?? 0)
    }
    return minMap[clean] ?? 0
  }

  let explicitHour = null
  let explicitMinute = 0

  if (colonMatch) {
    explicitHour = Number(colonMatch[1])
    explicitMinute = Number(colonMatch[2])
  } else if (pointMatch) {
    explicitHour = Number(pointMatch[1])
    explicitMinute = pointMatch[2] ? Number(pointMatch[2]) : 0
  } else if (chinesePointMatch) {
    explicitHour = chineseHourMap[chinesePointMatch[1]] ?? null
    explicitMinute = parseChineseMinute(chinesePointMatch[2])
  }

  if (explicitHour !== null && explicitHour >= 0 && explicitHour <= 23 && explicitMinute >= 0 && explicitMinute <= 59) {
    let hour = explicitHour

    if (periodPrefix) {
      if ((periodPrefix === '下午' || periodPrefix === '晚上' || periodPrefix === '夜里') && hour < 12) hour += 12
      if (periodPrefix === '中午' && hour < 11) hour += 12
    } else if (dayOffset === 0) {
      hour = toClosestHour(hour, explicitMinute)
    }

    d.setHours(hour, explicitMinute, 0, 0)
    return toDatetimeLocal(d)
  }

  // 时段 → 设定代表小时
  if (t.includes('凌晨'))                            d.setHours(1, 0, 0, 0)
  else if (t.includes('早上') || t.includes('上午')) d.setHours(9, 0, 0, 0)
  else if (t.includes('中午'))                       d.setHours(12, 0, 0, 0)
  else if (t.includes('下午'))                       d.setHours(16, 0, 0, 0)
  else if (t.includes('傍晚'))                       d.setHours(18, 0, 0, 0)
  else if (t.includes('晚上') || t.includes('夜里')) d.setHours(21, 0, 0, 0)

  return toDatetimeLocal(d)
}

// Props:
//   onNextStep(entry)  — 立即跳转，后台保存
//   editEntry          — 编辑模式：传入已有记录，预填内容
export default function HomePage({ onNextStep, editEntry }) {
  const { user } = useAuth()
  const isEditMode = Boolean(editEntry)

  const [content, setContent] = useState(editEntry?.content ?? '')
  const [selectedTemplate, setSelectedTemplate] = useState(editEntry?.template_type ?? null)
  const [entryDatetime, setEntryDatetime] = useState(
    editEntry ? toDatetimeLocal(editEntry.created_at) : toDatetimeLocal(new Date())
  )
  const [error, setError] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const textareaRef = useRef(null)
  const dateInputRef = useRef(null)
  const timeInputRef = useRef(null)

  // 大类标签
  const initCategories = () => {
    if (editEntry?.category_tags?.length > 0) return editEntry.category_tags
    return []
  }
  const [selectedCategories, setSelectedCategories] = useState(initCategories())
  const [extraCategories, setExtraCategories] = useState(() => {
    // 编辑模式：已有标签中不在预设列表里的，作为自定义标签
    return (editEntry?.category_tags ?? []).filter(t => !PREDEFINED_CATEGORIES.includes(t))
  })
  const [showCategoryInput, setShowCategoryInput] = useState(false)
  const [categoryInput, setCategoryInput] = useState('')
  const userEditedCategories = useRef(isEditMode)

  // 关联事件
  const [eventName, setEventName] = useState(editEntry?.event_name ?? '')

  // 用户是否手动改过时间（手动改过后不再自动覆盖）
  const userEditedDate = useRef(isEditMode)

  const { isRecording, isSupported, startRecording, stopRecording } = useSpeechRecognition()
  const voiceBaseRef = useRef('')
  const committedRef = useRef('')

  // 自动调整文本框高度
  useEffect(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 280) + 'px'
    }
  }, [content])

  // 随输入自动推断时间（仅新建模式、用户未手动改过时间）
  useEffect(() => {
    if (isEditMode || userEditedDate.current) return
    if (!content) return
    setEntryDatetime(inferDatetime(content))
  }, [content, isEditMode])

  // 随输入自动匹配大类标签（仅用户未手动调整过时）
  useEffect(() => {
    if (userEditedCategories.current) return
    setSelectedCategories(detectCategories(content))
  }, [content])

  const activeTemplate = TEMPLATES.find(t => t.id === selectedTemplate)

  const handleTemplateClick = (templateId) => {
    setSelectedTemplate(prev => prev === templateId ? null : templateId)
  }

  const toggleCategory = (cat) => {
    userEditedCategories.current = true
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  const handleAddCategory = () => {
    const tag = categoryInput.trim()
    if (!tag) return
    if (!extraCategories.includes(tag)) setExtraCategories(prev => [...prev, tag])
    setSelectedCategories(prev => prev.includes(tag) ? prev : [...prev, tag])
    userEditedCategories.current = true
    setCategoryInput('')
    setShowCategoryInput(false)
  }

  // 用户手动改日期
  const handleDatePartChange = (dateVal) => {
    userEditedDate.current = true
    const timePart = entryDatetime.slice(11, 16) || '00:00'
    setEntryDatetime(`${dateVal}T${timePart}`)
  }

  // 用户手动改时间
  const handleTimePartChange = (timeVal) => {
    userEditedDate.current = true
    const datePart = entryDatetime.slice(0, 10)
    setEntryDatetime(`${datePart}T${timeVal}`)
  }

  // 日期显示文字
  const formatDateLabel = () => {
    const d = new Date(entryDatetime)
    return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  }

  // 时间显示文字
  const formatTimeLabel = () => {
    const d = new Date(entryDatetime)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  // 语音
  const handleVoiceStart = () => {
    setVoiceError('')
    voiceBaseRef.current = content.trimEnd()
    committedRef.current = ''
    startRecording(
      (newFinal, interim) => {
        if (newFinal) committedRef.current += newFinal
        const parts = [voiceBaseRef.current, committedRef.current + interim].filter(Boolean)
        setContent(parts.join('\n'))
      },
      (err) => {
        setVoiceError(err)
        setTimeout(() => setVoiceError(''), 3000)
      },
      () => {}
    )
  }

  const handleVoiceToggle = () => {
    if (isRecording) stopRecording()
    else handleVoiceStart()
  }

  // 点"下一步"：立即跳转，后台静默保存
  const handleNext = () => {
    if (!content.trim()) {
      setError('请先写点什么～')
      setTimeout(() => setError(''), 2000)
      return
    }

    const templateType = selectedTemplate || (isEditMode ? editEntry.template_type : 'free')
    const createdAt = new Date(entryDatetime).toISOString()

    if (isEditMode) {
      // 编辑：立即回调（entry.id 已知），后台 UPDATE 原文
      const updatedEntry = { ...editEntry, content: content.trim(), template_type: templateType, created_at: createdAt, category_tags: selectedCategories, event_name: eventName.trim() || null }
      onNextStep?.(updatedEntry)
      supabase.from('journal_entries')
        .update({ content: content.trim(), template_type: templateType, created_at: createdAt, category_tags: selectedCategories, event_name: eventName.trim() || null })
        .eq('id', editEntry.id)
        .eq('user_id', user.id)
        .then(({ error: e }) => { if (e) console.error('[edit] 后台保存失败:', e) })
    } else {
      // 新建：用 crypto.randomUUID() 生成 ID，立即跳转，后台 INSERT
      const newId = crypto.randomUUID()
      const newEntry = {
        id: newId,
        user_id: user.id,
        content: content.trim(),
        template_type: templateType,
        created_at: createdAt,
        category_tags: selectedCategories,
        event_name: eventName.trim() || null,
      }
      onNextStep?.(newEntry)
      supabase.from('journal_entries')
        .insert(newEntry)
        .then(({ error: e }) => { if (e) console.error('[insert] 后台保存失败:', e) })
    }

    // 重置表单
    setContent('')
    setSelectedTemplate(null)
    setEntryDatetime(toDatetimeLocal(new Date()))
    setSelectedCategories([])
    setExtraCategories([])
    setEventName('')
    userEditedDate.current = false
    userEditedCategories.current = false
  }


  return (
    <div className="flex flex-col h-full">
      {/* 顶部标题 */}
      <div className="px-5 pt-5 pb-3">
        <h1 className="text-xl font-bold text-gray-800">
          {isEditMode ? '编辑记录' : '今天，想记点什么？'}
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {new Date().toLocaleDateString('zh-CN', {
            month: 'long', day: 'numeric', weekday: 'long',
          })}
        </p>
      </div>

      {/* 模板快捷按钮 */}
      <div className="px-4 mb-4">
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => handleTemplateClick(t.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                selectedTemplate === t.id
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              <span>{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 引导提示 */}
      {activeTemplate?.hint && (
        <div className="mx-4 mb-3 px-4 py-3 bg-amber-50 border border-amber-100 rounded-2xl fade-in">
          <p className="text-sm text-amber-700 leading-relaxed">
            💡 {activeTemplate.hint}
          </p>
        </div>
      )}

      {/* 大类标签 */}
      <div className="px-4 mb-3">
        <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">相关主题（选填）</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {[...PREDEFINED_CATEGORIES, ...extraCategories].map(tag => {
            const isSelected = selectedCategories.includes(tag)
            const isCustom = extraCategories.includes(tag)
            return (
              <button
                key={tag}
                onClick={() => toggleCategory(tag)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-all active:scale-95 flex items-center gap-1 ${
                  isSelected
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-gray-500 border-gray-200'
                }`}
              >
                <span>{tag}</span>
                {isCustom && isSelected && <X size={12} />}
              </button>
            )
          })}

          <button
            onClick={() => setShowCategoryInput(p => !p)}
            className="px-3 py-1.5 rounded-full text-sm border border-dashed border-gray-300 text-gray-400 bg-white flex items-center gap-1 active:scale-95"
          >
            <Plus size={14} />
            <span>新增</span>
          </button>
        </div>

        {showCategoryInput && (
          <div className="flex gap-2 mt-2 fade-in">
            <input
              value={categoryInput}
              onChange={e => setCategoryInput(e.target.value)}
              placeholder="输入自定义标签，如：婆媳、备婚"
              className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-2xl text-sm text-gray-600 focus:outline-none focus:border-amber-400"
            />
            <button
              onClick={handleAddCategory}
              className="px-4 py-2 bg-amber-500 text-white text-sm rounded-2xl active:scale-95"
            >
              添加
            </button>
          </div>
        )}

        <div className="mt-3">
          <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">关联事件（选填）</p>
          <input
            value={eventName}
            onChange={e => setEventName(e.target.value)}
            placeholder="例如：觉察日记app、reader网站搭建"
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-2xl text-sm text-gray-600 focus:outline-none focus:border-amber-400"
          />
        </div>
      </div>

      {/* 语音错误提示 */}
      {voiceError && (
        <div className="mx-4 mb-3 px-4 py-2.5 bg-red-50 border border-red-100 rounded-2xl fade-in">
          <p className="text-sm text-red-500">{voiceError}</p>
        </div>
      )}

      {/* 主输入区域 */}
      <div className="flex-1 px-4 pb-4 flex flex-col gap-3">
        <div className="card flex-1 flex flex-col">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={
              activeTemplate?.hint
                ? '按照上方提示，把想到的都写下来…'
                : '随便写点什么，今天发生了什么，现在感受怎么样…'
            }
            className="flex-1 w-full min-h-[180px] text-gray-700 placeholder-gray-300 text-base leading-relaxed focus:outline-none bg-transparent"
            style={{ resize: 'none' }}
          />
          {content.length > 0 && (
            <p className="text-xs text-gray-300 text-right mt-2">{content.length} 字</p>
          )}
        </div>

        {/* 日期 + 时间选择器（点击直接弹出原生面板） */}
        <div className="flex gap-2 flex-wrap">
          {/* 日期按钮 */}
          <div className="relative">
            <button
              onClick={() => dateInputRef.current?.showPicker()}
              className="flex items-center gap-1.5 text-xs text-gray-400 px-3 py-1.5 bg-white border border-gray-100 rounded-full"
            >
              <span>📅</span>
              <span>{formatDateLabel()}</span>
            </button>
            <input
              ref={dateInputRef}
              type="date"
              value={entryDatetime.slice(0, 10)}
              onChange={e => handleDatePartChange(e.target.value)}
              className="absolute inset-0 opacity-0 pointer-events-none"
            />
          </div>

          {/* 时间按钮 */}
          <div className="relative">
            <button
              onClick={() => timeInputRef.current?.showPicker()}
              className="flex items-center gap-1.5 text-xs text-gray-400 px-3 py-1.5 bg-white border border-gray-100 rounded-full"
            >
              <span>🕐</span>
              <span>{formatTimeLabel()}</span>
            </button>
            <input
              ref={timeInputRef}
              type="time"
              value={entryDatetime.slice(11, 16)}
              onChange={e => handleTimePartChange(e.target.value)}
              className="absolute inset-0 opacity-0 pointer-events-none"
            />
          </div>
        </div>

        {/* 操作栏：语音 + 下一步 */}
        <div className="flex items-center gap-3">
          {isSupported && (
            <button
              onClick={handleVoiceToggle}
              className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all duration-200 select-none ${
                isRecording
                  ? 'bg-red-500 text-white recording-pulse'
                  : 'bg-white border border-gray-200 text-gray-400 active:scale-95'
              }`}
              title={isRecording ? '点击停止' : '点击说话'}
            >
              {isRecording ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
          )}

          <button
            onClick={handleNext}
            disabled={!content.trim()}
            className={`flex-1 h-14 rounded-2xl font-medium text-base flex items-center justify-center transition-all duration-200 active:scale-95 ${
              content.trim()
                ? 'bg-amber-500 text-white shadow-sm hover:bg-amber-600'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed'
            }`}
          >
            <ArrowRight size={22} />
          </button>
        </div>

        {error && <p className="text-center text-sm text-red-400 fade-in">{error}</p>}

        {isRecording && (
          <p className="text-center text-sm text-red-400 animate-pulse fade-in">
            🎙️ 正在录音，再次点击停止…
          </p>
        )}
      </div>
    </div>
  )
}

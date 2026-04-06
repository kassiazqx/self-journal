import { useState, useRef, useEffect } from 'react'
import { Mic, MicOff, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'

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

// Props:
//   onNextStep(entry)  — 内容保存后，把完整记录传给父组件进入 TaggingPage
//   editEntry          — 编辑模式：传入已有记录，预填内容（第六段使用）
export default function HomePage({ onNextStep, editEntry }) {
  const { user } = useAuth()
  const isEditMode = Boolean(editEntry)

  const [content, setContent] = useState(editEntry?.content ?? '')
  const [selectedTemplate, setSelectedTemplate] = useState(editEntry?.template_type ?? null)
  const [entryDatetime, setEntryDatetime] = useState(
    editEntry ? toDatetimeLocal(editEntry.created_at) : toDatetimeLocal(new Date())
  )
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const textareaRef = useRef(null)

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

  const activeTemplate = TEMPLATES.find(t => t.id === selectedTemplate)

  const handleTemplateClick = (templateId) => {
    setSelectedTemplate(prev => prev === templateId ? null : templateId)
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

  // 点"下一步"：保存（INSERT 或 UPDATE）→ 传给父组件
  const handleNext = async () => {
    if (!content.trim()) {
      setError('请先写点什么～')
      setTimeout(() => setError(''), 2000)
      return
    }

    setSaving(true)
    setError('')

    try {
      let saved

      if (isEditMode) {
        // 编辑模式：UPDATE 原文和模板
        const { data, error: dbError } = await supabase
          .from('journal_entries')
          .update({
            content: content.trim(),
            template_type: selectedTemplate || editEntry.template_type || 'free',
            created_at: new Date(entryDatetime).toISOString(),
          })
          .eq('id', editEntry.id)
          .eq('user_id', user.id)
          .select()
          .single()
        if (dbError) throw dbError
        saved = data
      } else {
        // 新建模式：INSERT
        const { data, error: dbError } = await supabase
          .from('journal_entries')
          .insert({
            user_id: user.id,
            content: content.trim(),
            template_type: selectedTemplate || 'free',
            created_at: new Date(entryDatetime).toISOString(),
          })
          .select()
          .single()
        if (dbError) throw dbError
        saved = data
      }

      // 重置表单，把记录传给父组件
      setContent('')
      setSelectedTemplate(null)
      setEntryDatetime(toDatetimeLocal(new Date()))
      onNextStep?.(saved)
    } catch (err) {
      console.error('保存失败:', err)
      setError('保存失败，请检查网络后重试')
    } finally {
      setSaving(false)
    }
  }

  // 日期时间显示文字
  const formatPickerLabel = () => {
    const d = new Date(entryDatetime)
    return d.toLocaleString('zh-CN', {
      month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
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

        {/* 日期时间选择器 */}
        <div>
          <button
            onClick={() => setShowDatePicker(p => !p)}
            className="flex items-center gap-1.5 text-xs text-gray-400 px-3 py-1.5 bg-white border border-gray-100 rounded-full"
          >
            <span>📅</span>
            <span>{formatPickerLabel()}</span>
            <span>{showDatePicker ? '▲' : '▼'}</span>
          </button>
          {showDatePicker && (
            <input
              type="datetime-local"
              value={entryDatetime}
              onChange={e => setEntryDatetime(e.target.value)}
              className="mt-2 w-full px-3 py-2 bg-white border border-gray-200 rounded-2xl text-sm text-gray-600 focus:outline-none focus:border-amber-400"
            />
          )}
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
            disabled={saving || !content.trim()}
            className={`flex-1 h-14 rounded-2xl font-medium text-base flex items-center justify-center gap-2 transition-all duration-200 active:scale-95 ${
              content.trim()
                ? 'bg-amber-500 text-white shadow-sm hover:bg-amber-600'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed'
            }`}
          >
            {saving ? (
              <><ArrowRight size={20} /><span>下一步</span></>
            ) : (
              <><span>下一步</span><ArrowRight size={20} /></>
            )}
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

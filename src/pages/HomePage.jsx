import { useState, useRef, useEffect } from 'react'
import { Mic, MicOff, Save, Loader2, CheckCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'

// 模板配置
const TEMPLATES = [
  {
    id: 'gratitude',
    emoji: '💛',
    label: '感恩日记',
    hint: '今天有什么值得感谢的？是谁、是什么事让你感到温暖或幸运？',
  },
  {
    id: 'learning',
    emoji: '🧠',
    label: '学习输出',
    hint: '今天学了什么？用自己的话说一遍，有什么让你印象深刻或有疑惑的地方？',
  },
  {
    id: 'emotion',
    emoji: '😤',
    label: '情绪觉察',
    hint: '现在是什么感受？发生了什么？你注意到自己身体上有什么感觉吗？',
  },
  {
    id: 'action',
    emoji: '🏃',
    label: '运动',
    hint: '今天运动了吗？做了什么运动？时长、强度怎么样？身体感受如何？',
  },
]

export default function HomePage({ onSaved }) {
  const { user } = useAuth()
  const [content, setContent] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const textareaRef = useRef(null)

  const { isRecording, isSupported, startRecording, stopRecording } = useSpeechRecognition()
  // 录音开始前的内容快照
  const voiceBaseRef = useRef('')
  // 本次录音过程中已确认的文字（带标点）
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
    if (selectedTemplate === templateId) {
      setSelectedTemplate(null)
    } else {
      setSelectedTemplate(templateId)
    }
  }

  // 语音按钮按下
  const handleVoiceStart = () => {
    setVoiceError('')
    voiceBaseRef.current = content.trimEnd()  // 录音前的内容
    committedRef.current = ''                 // 清空本次累积

    startRecording(
      (newFinal, interim) => {
        // 每次拿到新的最终结果，追加进 committed
        if (newFinal) {
          committedRef.current += newFinal
        }
        // 显示：原内容 + 本次累积 + 当前中间预览
        const base = voiceBaseRef.current
        const body = committedRef.current + interim
        const parts = [base, body].filter(Boolean)
        setContent(parts.join('\n'))
      },
      (err) => {
        setVoiceError(err)
        setTimeout(() => setVoiceError(''), 3000)
      },
      // 5秒静默自动停止回调（无需额外处理，状态由 hook 管理）
      () => {}
    )
  }

  // 语音按钮点击：未录音则开始，录音中则停止
  const handleVoiceToggle = () => {
    if (isRecording) {
      stopRecording()
    } else {
      handleVoiceStart()
    }
  }

  // 保存记录
  const handleSave = async () => {
    if (!content.trim()) {
      setError('请先写点什么～')
      setTimeout(() => setError(''), 2000)
      return
    }

    setSaving(true)
    setError('')

    try {
      const { error: dbError } = await supabase
        .from('journal_entries')
        .insert({
          user_id: user.id,
          content: content.trim(),
          template_type: selectedTemplate || 'free',
        })

      if (dbError) throw dbError

      // 保存成功动画
      setSaveSuccess(true)
      setTimeout(() => {
        setSaveSuccess(false)
        setContent('')
        setSelectedTemplate(null)
        onSaved?.() // 通知父组件刷新列表
      }, 1200)
    } catch (err) {
      console.error('保存失败:', err)
      setError('保存失败，请检查网络后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部标题 */}
      <div className="px-5 pt-5 pb-3">
        <h1 className="text-xl font-bold text-gray-800">今天，想记点什么？</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {new Date().toLocaleDateString('zh-CN', {
            month: 'long',
            day: 'numeric',
            weekday: 'long',
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
      <div className="flex-1 px-4 pb-4 flex flex-col gap-4">
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

          {/* 字数统计 */}
          {content.length > 0 && (
            <p className="text-xs text-gray-300 text-right mt-2">
              {content.length} 字
            </p>
          )}
        </div>

        {/* 操作栏：语音 + 保存 */}
        <div className="flex items-center gap-3">
          {/* 语音按钮 */}
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

          {/* 保存按钮 */}
          <button
            onClick={handleSave}
            disabled={saving || saveSuccess || !content.trim()}
            className={`flex-1 h-14 rounded-2xl font-medium text-base flex items-center justify-center gap-2 transition-all duration-200 active:scale-95 ${
              saveSuccess
                ? 'bg-green-500 text-white'
                : content.trim()
                ? 'bg-amber-500 text-white shadow-sm hover:bg-amber-600'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed'
            }`}
          >
            {saving ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                <span>保存中…</span>
              </>
            ) : saveSuccess ? (
              <>
                <CheckCircle size={20} />
                <span>已保存！</span>
              </>
            ) : (
              <>
                <Save size={20} />
                <span>保存记录</span>
              </>
            )}
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <p className="text-center text-sm text-red-400 fade-in">{error}</p>
        )}

        {/* 语音提示文字 */}
        {isRecording && (
          <p className="text-center text-sm text-red-400 animate-pulse fade-in">
            🎙️ 正在录音，再次点击停止…
          </p>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Send, Loader2, Sparkles, Check, RotateCcw } from 'lucide-react'
import { callAI } from '../lib/aiClient'
import { getSystemPrompt, getInitialUserMessage } from '../lib/prompts'
import { getMemory } from '../lib/memory'
import { saveConversation } from '../lib/conversationService'
import { useAuth } from '../contexts/AuthContext'
import { TEMPLATE_BY_ID, DEFAULT_TEMPLATE } from '../lib/templates'
import { getChatSession, saveChatSession } from '../lib/storage'

// 单条气泡
function Bubble({ msg }) {
  const isAI = msg.role === 'assistant'
  return (
    <div className={`flex ${isAI ? 'justify-start' : 'justify-end'} mb-4 fade-in`}>
      {isAI && (
        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
          <Sparkles size={13} className="text-primary-500" />
        </div>
      )}
      <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
        isAI
          ? 'bg-white border border-gray-100 text-gray-700 rounded-tl-sm'
          : 'bg-primary-500 text-white rounded-tr-sm'
      }`}>
        {msg.content}
      </div>
    </div>
  )
}

export default function AIConversation({ entry, onClose, onSaved }) {
  const { user } = useAuth()

  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [isRateLimit, setIsRateLimit] = useState(false)
  const systemPromptRef = useRef('')
  const lastUserMsgRef = useRef('')   // for retry
  const bottomRef = useRef(null)
  const initDoneRef = useRef(false)   // StrictMode double-run guard
  const template = TEMPLATE_BY_ID[entry.template_type] || DEFAULT_TEMPLATE

  const visibleMsgs = msgs.filter(m => !m.hidden)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, loading])

  useEffect(() => {
    if (msgs.length > 0) {
      saveChatSession(entry.id, {
        msgs,
        systemPrompt: systemPromptRef.current,
      })
    }
  }, [msgs])

  // 进入页面：localStorage → DB full_conversation → 新对话
  useEffect(() => {
    if (initDoneRef.current) return   // React StrictMode 会跑两次，只跑一次
    initDoneRef.current = true

    const saved = getChatSession(entry.id)
    if (saved) {
      const { msgs: savedMsgs, systemPrompt: savedPrompt } = saved
      if (savedMsgs?.length > 0) {
        setMsgs(savedMsgs)
        systemPromptRef.current = savedPrompt || ''
        return
      }
    }

    // 尝试从 DB 恢复历史对话（"继续聊"入口）
    const dbConvo = entry.full_conversation
    if (Array.isArray(dbConvo) && dbConvo.length > 0) {
      // 重建 system prompt（不需要等 memory，用空记忆即可）
      const sysPrompt = getSystemPrompt(entry.template_type, {})
      systemPromptRef.current = sysPrompt
      // 第一条 user 消息标记 hidden（原始日记内容）
      const restored = dbConvo.map((m, i) => ({ ...m, hidden: i === 0 && m.role === 'user' }))
      setMsgs(restored)
      return
    }

    startChat()
  }, [])

  async function startChat() {
    setLoading(true)
    setError('')
    try {
      let currentMemory = { rolling_summary: null, user_profile: null }
      try { currentMemory = await getMemory() } catch (e) { console.error('[memory]', e) }

      const sysPrompt = getSystemPrompt(entry.template_type, currentMemory)
      systemPromptRef.current = sysPrompt

      const initMsg = getInitialUserMessage(entry, entry._reflectionAnswers)
      lastUserMsgRef.current = initMsg
      const firstReply = await callAI(
        [{ role: 'user', content: initMsg }],
        sysPrompt
      )
      setMsgs([
        { role: 'user', content: initMsg, hidden: true },
        { role: 'assistant', content: firstReply },
      ])
    } catch (e) {
      handleError(e)
    } finally {
      setLoading(false)
    }
  }

  async function sendMsg() {
    if (!input.trim() || loading) return
    const userMsg = { role: 'user', content: input.trim() }
    lastUserMsgRef.current = userMsg.content
    const next = [...msgs, userMsg]
    setMsgs(next)
    setInput('')
    setLoading(true)
    setError('')
    try {
      const apiMsgs = next.map(m => ({ role: m.role, content: m.content }))
      const reply = await callAI(apiMsgs, systemPromptRef.current)
      setMsgs(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      handleError(e)
    } finally {
      setLoading(false)
    }
  }

  // 重试：重发最后一条用户消息
  async function retryLastMsg() {
    if (loading || !lastUserMsgRef.current) return
    const lastMsg = msgs[msgs.length - 1]
    // Bug A 修复：msgs 为空时必须走 else（重新 startChat），不能发空数组给 Gemini
    if (lastMsg && lastMsg.role === 'user' && !lastMsg.hidden) {
      // 最后一条是用户消息（发送失败）→ 重发
      setLoading(true)
      setError('')
      setIsRateLimit(false)
      try {
        const apiMsgs = msgs.map(m => ({ role: m.role, content: m.content }))
        const reply = await callAI(apiMsgs, systemPromptRef.current)
        setMsgs(prev => [...prev, { role: 'assistant', content: reply }])
      } catch (e) {
        handleError(e)
      } finally {
        setLoading(false)
      }
    } else {
      // msgs 为空或最后一条是 AI 消息（初始化失败）→ 重新开始
      setMsgs([])
      startChat()
    }
  }

  // Bug B 修复：不用 msg.includes('rate')，"GenerateContentRequest" 含 "rate" 会误判
  function handleError(e) {
    const msg = e.message || ''
    const limited = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')
    setIsRateLimit(limited)
    setError(limited
      ? '已达到 Gemini 免费额度上限，请稍等后重试，或前往设置更换 API Key'
      : msg)
  }
  async function finishAndSave() {
    if (saving || loading) return
    setSaving(true)
    setError('')

    const { error } = await saveConversation({ visibleMsgs, entry })
    if (error) {
      setError('保存失败：' + error.message)
      setSaving(false)
      return
    }
    // 保存成功，立即跳回列表；后台提取和记忆更新在 conversationService 里静默执行
    onSaved?.()
  }

  function handleClose() {
    if (saving) return
    onClose?.()
  }

  return (
    <div className="flex flex-col h-full bg-[#fdfaf7]">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={handleClose} className="text-gray-400 p-2 -ml-2 active:scale-95 transition-transform">
            <ArrowLeft size={22} />
          </button>
          <div>
            <div className="flex items-center gap-1.5">
              <span>{template.emoji}</span>
              <span className="text-base font-semibold text-gray-800">{template.label}</span>
            </div>
            <p className="text-xs text-gray-400">AI 陪你聊聊</p>
          </div>
        </div>

        {visibleMsgs.length >= 2 && (
          <button
            onClick={finishAndSave}
            disabled={loading || saving}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-primary-50 border border-primary-200 text-primary-600 rounded-full disabled:opacity-40 active:scale-95 transition-transform"
          >
            {saving
              ? <Loader2 size={12} className="animate-spin" />
              : <Check size={12} />}
            {saving ? '保存中…' : '完成'}
          </button>
        )}
      </div>

      {/* 原始日记预览 */}
      <div className="mx-4 mb-3 px-3 py-2.5 bg-white border border-gray-100 rounded-2xl">
        <p className="text-xs text-gray-400 mb-0.5">你写的</p>
        <p className="text-sm text-gray-600 line-clamp-2">{entry.content}</p>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 pb-2">
        {visibleMsgs.map((m, i) => <Bubble key={i} msg={m} />)}

        {loading && (
          <div className="flex justify-start mb-4 fade-in">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center mr-2 flex-shrink-0">
              <Sparkles size={13} className="text-primary-500" />
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center">
              {[0, 150, 300].map(d => (
                <span key={d} className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce"
                  style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-2 mb-3">
            <p className="text-center text-sm text-red-400">{error}</p>
            <button
              onClick={() => { setError(''); setIsRateLimit(false); retryLastMsg() }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-50 border border-red-200 text-red-500 rounded-full active:scale-95 transition-transform"
            >
              <RotateCcw size={12} />
              {isRateLimit ? '等待后重试' : '重试'}
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入栏 */}
      <div className="px-4 pb-6 pt-2 flex gap-2 items-end">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg() } }}
          placeholder="说说你的想法…"
          rows={1}
          className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:border-primary-400 resize-none"
          style={{ maxHeight: '120px' }}
        />
        <button
          onClick={sendMsg}
          disabled={!input.trim() || loading}
          className="w-12 h-12 bg-primary-500 text-white rounded-2xl flex items-center justify-center flex-shrink-0 disabled:opacity-40 active:scale-95 transition-all"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Send, Loader2, Sparkles, Check } from 'lucide-react'
import { callAI } from '../lib/aiClient'
import { getSystemPrompt, getInitialUserMessage, getExtractionPrompt, getMemoryUpdatePrompt } from '../lib/prompts'
import { getMemory, updateMemory } from '../lib/memory'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const TEMPLATE_MAP = {
  gratitude: { emoji: '💛', label: '感恩日记' },
  learning:  { emoji: '🧠', label: '学习输出' },
  emotion:   { emoji: '😤', label: '情绪觉察' },
  action:    { emoji: '🏃', label: '运动记录' },
  free:      { emoji: '✨', label: '随手记' },
}

// 单条气泡
function Bubble({ msg }) {
  const isAI = msg.role === 'assistant'
  return (
    <div className={`flex ${isAI ? 'justify-start' : 'justify-end'} mb-4 fade-in`}>
      {isAI && (
        <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
          <Sparkles size={13} className="text-amber-500" />
        </div>
      )}
      <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
        isAI
          ? 'bg-white border border-gray-100 text-gray-700 rounded-tl-sm'
          : 'bg-amber-500 text-white rounded-tr-sm'
      }`}>
        {msg.content}
      </div>
    </div>
  )
}

export default function AIConversation({ entry, onClose, onSaved }) {
  const { user } = useAuth()
  // localStorage key：以 entry.id 区分，刷新后可恢复
  const STORAGE_KEY = `chat_session_${entry.id}`

  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)   // 完成保存中
  const [error, setError] = useState('')
  const systemPromptRef = useRef('')
  const bottomRef = useRef(null)
  const template = TEMPLATE_MAP[entry.template_type] || TEMPLATE_MAP.free

  // 可见消息（过滤掉 hidden 的第一条）
  const visibleMsgs = msgs.filter(m => !m.hidden)

  // 自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, loading])

  // 每次 msgs 变化就同步到 localStorage，防止刷新丢失
  useEffect(() => {
    if (msgs.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        msgs,
        systemPrompt: systemPromptRef.current,
      }))
    }
  }, [msgs])

  // 进入页面：优先从 localStorage 恢复对话，否则重新发第一条
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const { msgs: savedMsgs, systemPrompt: savedPrompt } = JSON.parse(saved)
        if (savedMsgs?.length > 0) {
          setMsgs(savedMsgs)
          systemPromptRef.current = savedPrompt || ''
          return // 恢复成功，不调用 startChat
        }
      } catch {
        // 解析失败，走正常启动
      }
    }
    startChat()
  }, [])

  // 第一次进入：读记忆 → 生成 system prompt → 发第一条
  async function startChat() {
    setLoading(true)
    setError('')
    try {
      let currentMemory = { rolling_summary: null, user_profile: null }
      try {
        currentMemory = await getMemory()
      } catch (e) {
        console.error('[memory] 读取记忆失败:', e)
      }

      const sysPrompt = getSystemPrompt(entry.template_type, currentMemory)
      systemPromptRef.current = sysPrompt

      const initMsg = getInitialUserMessage(entry)
      const firstReply = await callAI(
        [{ role: 'user', content: initMsg }],
        sysPrompt
      )
      setMsgs([
        { role: 'user', content: initMsg, hidden: true },
        { role: 'assistant', content: firstReply },
      ])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // 发送消息
  async function sendMsg() {
    if (!input.trim() || loading) return
    const userMsg = { role: 'user', content: input.trim() }
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
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // 点「完成」：静默提取字段 → 保存到 Supabase → 更新记忆 → 退出
  // 全程用户只看到顶部「保存中…」，没有中间审阅步骤
  async function finishAndSave() {
    if (saving || loading) return
    setSaving(true)
    setError('')
    try {
      const convoText = visibleMsgs
        .map(m => `${m.role === 'user' ? '我' : 'AI'}：${m.content}`)
        .join('\n\n')

      // 1. 静默提取字段（失败不阻断保存）
      let extraction = {}
      try {
        const extractPrompt = `以下是我们的对话记录：\n\n${convoText}\n\n${getExtractionPrompt()}`
        const raw = await callAI(
          [{ role: 'user', content: extractPrompt }],
          '你是数据提取助手，只返回纯 JSON，不加任何说明或 markdown。',
          { maxTokens: 1200 }
        )
        const match = raw.match(/\{[\s\S]*\}/)
        if (match) extraction = JSON.parse(match[0])
      } catch (e) {
        console.error('[extract] 提取失败（静默处理）:', e)
      }

      // 2. 保存对话记录 + 提取结果到 Supabase
      const convoRecord = visibleMsgs.map(m => ({ role: m.role, content: m.content }))
      const { error: dbErr } = await supabase
        .from('journal_entries')
        .update({
          primary_emotion:           extraction.primary_emotion          ?? null,
          mixed_emotions:            extraction.mixed_emotions           ?? [],
          overall_state_score:       extraction.overall_state_score      ?? null,
          body_sensations:           extraction.body_sensations          ?? null,
          current_thought:           extraction.current_thought          ?? null,
          core_needs:                extraction.core_needs               ?? [],
          current_behavior:          extraction.current_behavior         ?? null,
          handling_rating:           extraction.handling_rating          ?? null,
          cognitive_distortion_type: extraction.cognitive_distortion_type ?? null,
          cognitive_analysis:        extraction.cognitive_analysis       ?? null,
          reflection_insight:        extraction.reflection_insight       ?? null,
          category_tags:             extraction.category_tags            ?? [],
          people_involved:           extraction.people_involved          ?? [],
          full_conversation:         convoRecord,
        })
        .eq('id', entry.id)
        .eq('user_id', user.id)
      if (dbErr) throw dbErr

      // 3. 清除本条对话的 localStorage 缓存
      localStorage.removeItem(STORAGE_KEY)

      // 4. 静默更新 AI 跨对话记忆
      try {
        const memPrompt = getMemoryUpdatePrompt(convoText)
        const raw = await callAI(
          [{ role: 'user', content: memPrompt }],
          '你是用户记忆整理助手，只返回纯 JSON，不加任何说明或 markdown。',
          { maxTokens: 600 }
        )
        const match = raw.match(/\{[\s\S]*\}/)
        if (match) {
          const { rolling_summary, user_profile } = JSON.parse(match[0])
          await updateMemory({ rolling_summary, user_profile })
        }
      } catch (e) {
        console.error('[memory] 记忆更新失败:', e)
      }

      onSaved?.()
    } catch (e) {
      setError('保存失败：' + e.message)
      setSaving(false)
    }
  }

  // 返回键：直接退出，对话已存 localStorage，下次进来可继续
  function handleClose() {
    if (saving) return
    onClose?.()
  }

  return (
    <div className="flex flex-col h-full bg-[#fdfaf7]">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={handleClose} className="text-gray-400">
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

        {/* 完成按钮：有至少一轮真实对话后出现 */}
        {visibleMsgs.length >= 2 && (
          <button
            onClick={finishAndSave}
            disabled={loading || saving}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-600 rounded-full disabled:opacity-40 active:scale-95 transition-transform"
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

        {/* 加载动画 */}
        {loading && (
          <div className="flex justify-start mb-4 fade-in">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center mr-2 flex-shrink-0">
              <Sparkles size={13} className="text-amber-500" />
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center">
              {[0, 150, 300].map(d => (
                <span key={d} className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce"
                  style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-center text-sm text-red-400 mb-3">{error}</p>}
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
          className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:border-amber-400 resize-none"
          style={{ maxHeight: '120px' }}
        />
        <button
          onClick={sendMsg}
          disabled={!input.trim() || loading}
          className="w-12 h-12 bg-amber-500 text-white rounded-2xl flex items-center justify-center flex-shrink-0 disabled:opacity-40 active:scale-95 transition-all"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  )
}

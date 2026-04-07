import { useState } from 'react'
import { ArrowLeft, MessageCircle, Sparkles, MoreHorizontal, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../lib/supabase'

const TEMPLATE_MAP = {
  gratitude: { emoji: '🩷', label: '感恩',  color: 'bg-pink-50 text-pink-600 border-pink-100' },
  learning:  { emoji: '📝', label: '学习',  color: 'bg-blue-50 text-blue-600 border-blue-100' },
  emotion:   { emoji: '🌷', label: '觉察',  color: 'bg-purple-50 text-purple-600 border-purple-100' },
  action:    { emoji: '💪🏻', label: '行动', color: 'bg-green-50 text-green-600 border-green-100' },
  free:      { emoji: '✨', label: '灵感',  color: 'bg-gray-50 text-gray-500 border-gray-100' },
}

function formatDate(str) {
  return new Date(str).toLocaleString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
    weekday: 'long', hour: '2-digit', minute: '2-digit',
  })
}

// 状态分数可视化
function ScoreBar({ score }) {
  if (score === null || score === undefined) return null
  const pct = ((score + 5) / 10) * 100
  const color = score >= 2 ? 'bg-green-400' : score <= -2 ? 'bg-red-400' : 'bg-amber-400'
  return (
    <div className="flex gap-3 py-2 items-center">
      <span className="text-xs text-gray-400 w-16 flex-shrink-0">状态</span>
      <div className="flex-1 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-medium text-gray-600 w-6 text-right">
          {score > 0 ? `+${score}` : score}
        </span>
      </div>
    </div>
  )
}

// 可折叠区域
function Collapsible({ title, icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card">
      <button
        onClick={() => setOpen(p => !p)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-1.5">
          {icon}
          <p className="text-xs font-medium text-gray-500">{title}</p>
        </div>
        {open ? <ChevronUp size={14} className="text-gray-300" /> : <ChevronDown size={14} className="text-gray-300" />}
      </button>
      {open && <div className="mt-3 space-y-1">{children}</div>}
    </div>
  )
}

// 可编辑字段行
function EditableFieldRow({ label, value, onSave }) {
  const [editing, setEditing] = useState(false)
  const display = Array.isArray(value) ? value.join('、') : (value ?? '')
  const [draft, setDraft] = useState(display)

  if (!display && !editing) return null

  const handleSave = () => {
    setEditing(false)
    onSave(draft)
  }

  return (
    <div className="flex gap-3 py-2 border-b border-gray-50 last:border-0 group items-start">
      <span className="text-xs text-gray-400 w-16 flex-shrink-0 pt-0.5">{label}</span>
      {editing ? (
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={handleSave}
          autoFocus
          rows={2}
          className="flex-1 text-sm text-gray-700 border border-amber-300 rounded-lg px-2 py-1 focus:outline-none resize-none"
        />
      ) : (
        <>
          <span className="text-sm text-gray-700 flex-1 leading-relaxed">{display}</span>
          <button
            onClick={() => { setDraft(display); setEditing(true) }}
            className="text-gray-300 opacity-0 group-hover:opacity-100 active:opacity-100 flex-shrink-0 mt-0.5"
          >
            <Pencil size={13} />
          </button>
        </>
      )}
    </div>
  )
}

export default function RecordDetail({ entry, onBack, onStartAI, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [localEntry, setLocalEntry] = useState(entry)

  const template = TEMPLATE_MAP[localEntry.template_type] || TEMPLATE_MAP.free

  const hasConversation = Array.isArray(localEntry.full_conversation) && localEntry.full_conversation.length > 0

  const hasExtraction = localEntry.reflection_insight || localEntry.cognitive_distortion_type ||
    localEntry.cognitive_analysis || localEntry.core_needs?.length > 0 ||
    localEntry.body_sensations?.length > 0 || localEntry.current_thought ||
    localEntry.current_behavior || localEntry.handling_rating ||
    localEntry.emotions?.length > 0 ||
    (localEntry.overall_state_score !== null && localEntry.overall_state_score !== undefined) ||
    hasConversation
  const hasAI = hasExtraction || hasConversation

  const emotionList = Array.isArray(localEntry.emotions) ? localEntry.emotions : []

  // 火-and-forget 单字段保存
  const handleFieldSave = (field, value) => {
    setLocalEntry(prev => ({ ...prev, [field]: value }))
    supabase.from('journal_entries')
      .update({ [field]: value })
      .eq('id', localEntry.id)
      .eq('user_id', localEntry.user_id)
      .then(({ error: e }) => { if (e) console.error(`[field:${field}] 保存失败:`, e) })
  }

  return (
    <div className="flex flex-col h-full bg-[#fdfaf7]">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 flex-shrink-0">
        <button onClick={onBack} className="text-gray-400 active:scale-95 transition-transform">
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1" />
        {(onEdit || onDelete) && (
          <button
            onClick={() => setMenuOpen(true)}
            className="text-gray-400 active:scale-95 transition-transform p-1"
          >
            <MoreHorizontal size={20} />
          </button>
        )}
      </div>

      {/* "…" 底部菜单 */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm bg-white rounded-t-3xl pb-8 fade-in safe-bottom"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mt-4 mb-4" />
            {onEdit && (
              <button
                onClick={() => { setMenuOpen(false); onEdit(entry) }}
                className="w-full flex items-center gap-3 px-6 py-4 text-gray-700 active:bg-gray-50"
              >
                <Pencil size={18} className="text-gray-400" />
                <span className="text-base">编辑</span>
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => { setMenuOpen(false); onDelete(entry) }}
                className="w-full flex items-center gap-3 px-6 py-4 text-red-500 active:bg-red-50"
              >
                <Trash2 size={18} />
                <span className="text-base">删除</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-3">

        {/* ── 基本信息卡 ── */}
        <div className="card">
          <p className="text-xs text-gray-400 mb-2">{formatDate(localEntry.created_at)}</p>
          <div className="flex flex-wrap gap-1.5">
            {/* 模板 */}
            <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${template.color}`}>
              {template.emoji} {template.label}
            </span>
            {/* 大类标签 */}
            {localEntry.category_tags?.map(tag => (
              <span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 border border-amber-100">{tag}</span>
            ))}
            {/* 关联事件 */}
            {localEntry.event_name && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-100">📌 {localEntry.event_name}</span>
            )}
            {/* 涉及人员 */}
            {localEntry.people_involved?.map(p => (
              <span key={p} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 border border-gray-200">👤 {p}</span>
            ))}
          </div>

          {/* 情绪 + 状态分 */}
          {(emotionList.length > 0 || localEntry.overall_state_score !== null) && (
            <div className="mt-3 pt-3 border-t border-gray-50">
              <ScoreBar score={localEntry.overall_state_score} />
              {emotionList.length > 0 && (
                <div className="flex gap-3 py-2 items-center">
                  <span className="text-xs text-gray-400 w-16 flex-shrink-0">情绪</span>
                  <div className="flex flex-wrap gap-1">
                    {emotionList.map((e, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 bg-purple-50 text-purple-600 rounded-full border border-purple-100">{e}</span>
                    ))}
                  </div>
                </div>
              )}
              {localEntry.handling_rating && (
                <div className="flex gap-3 py-2 items-center">
                  <span className="text-xs text-gray-400 w-16 flex-shrink-0">处理方式</span>
                  <span className="text-sm text-gray-600">{localEntry.handling_rating}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 原始记录 ── */}
        <div className="card">
          <p className="text-xs text-gray-400 mb-2">原始记录</p>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{localEntry.content}</p>
        </div>

        {/* ── 对话洞见（折叠）── */}
        {hasExtraction && (
          <Collapsible
            title="对话洞见"
            icon={<Sparkles size={13} className="text-amber-500" />}
            defaultOpen={false}
          >
            <EditableFieldRow label="反思洞见" value={localEntry.reflection_insight} onSave={v => handleFieldSave('reflection_insight', v)} />
            <EditableFieldRow label="核心需求" value={localEntry.core_needs} onSave={v => handleFieldSave('core_needs', v.split('、').map(s => s.trim()).filter(Boolean))} />
            <EditableFieldRow label="认知扭曲" value={localEntry.cognitive_distortion_type} onSave={v => handleFieldSave('cognitive_distortion_type', v)} />
            <EditableFieldRow label="认知分析" value={localEntry.cognitive_analysis} onSave={v => handleFieldSave('cognitive_analysis', v)} />
            <EditableFieldRow label="身体感受" value={localEntry.body_sensations} onSave={v => handleFieldSave('body_sensations', v.split('、').map(s => s.trim()).filter(Boolean))} />
            <EditableFieldRow label="当下念头" value={localEntry.current_thought} onSave={v => handleFieldSave('current_thought', v)} />
            <EditableFieldRow label="当下行为" value={localEntry.current_behavior} onSave={v => handleFieldSave('current_behavior', v)} />
          </Collapsible>
        )}

        {/* ── 完整对话记录（折叠）── */}
        {hasConversation && (
          <Collapsible
            title="完整对话记录"
            icon={<MessageCircle size={13} className="text-gray-400" />}
            defaultOpen={false}
          >
            <div className="space-y-3 pt-1">
              {localEntry.full_conversation.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-amber-500 text-white rounded-tr-sm'
                      : 'bg-gray-50 text-gray-700 rounded-tl-sm border border-gray-100'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          </Collapsible>
        )}

        {/* 没有 AI 内容时 */}
        {!hasAI && (
          <div className="text-center py-8">
            <Sparkles size={32} className="text-gray-200 mx-auto mb-3" strokeWidth={1} />
            <p className="text-sm text-gray-400 mb-1">还没有 AI 分析记录</p>
            <p className="text-xs text-gray-300 mb-5">保存后可以随时和 AI 深入聊聊</p>
          </div>
        )}

        {/* AI 入口按钮：始终显示 */}
        {onStartAI && (
          <div className="text-center pb-2">
            <button
              onClick={() => onStartAI(entry)}
              className="px-5 py-2.5 bg-amber-500 text-white text-sm font-medium rounded-2xl active:scale-95 transition-transform"
            >
              {hasConversation ? '✦ 继续聊' : '✦ 和 AI 聊聊这篇'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

import { ArrowLeft, MessageCircle, Sparkles } from 'lucide-react'

const TEMPLATE_MAP = {
  gratitude: { emoji: '💛', label: '感恩日记', color: 'bg-yellow-50 text-yellow-700 border-yellow-100' },
  learning:  { emoji: '🧠', label: '学习输出', color: 'bg-blue-50 text-blue-600 border-blue-100' },
  emotion:   { emoji: '😤', label: '情绪觉察', color: 'bg-purple-50 text-purple-600 border-purple-100' },
  action:    { emoji: '🏃', label: '运动记录', color: 'bg-green-50 text-green-600 border-green-100' },
  free:      { emoji: '✨', label: '随手记',   color: 'bg-gray-50 text-gray-500 border-gray-100' },
}

function formatDate(str) {
  return new Date(str).toLocaleString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
    weekday: 'long', hour: '2-digit', minute: '2-digit',
  })
}

// 单个字段展示
function FieldRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value) && value.length === 0) return null
  const display = Array.isArray(value) ? value.join('、') : String(value)
  return (
    <div className="flex gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 w-20 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-700 flex-1 leading-relaxed">{display}</span>
    </div>
  )
}

// 状态分数可视化
function ScoreBar({ score }) {
  if (score === null || score === undefined) return null
  const pct = ((score + 5) / 10) * 100
  const color = score >= 2 ? 'bg-green-400' : score <= -2 ? 'bg-red-400' : 'bg-amber-400'
  return (
    <div className="flex gap-3 py-2.5 border-b border-gray-50 items-center">
      <span className="text-xs text-gray-400 w-20 flex-shrink-0">整体状态</span>
      <div className="flex-1 flex items-center gap-2">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-sm font-medium text-gray-700 w-8 text-right">
          {score > 0 ? `+${score}` : score}
        </span>
      </div>
    </div>
  )
}

export default function RecordDetail({ entry, onBack, onStartAI }) {
  const template = TEMPLATE_MAP[entry.template_type] || TEMPLATE_MAP.free
  const hasExtraction = entry.primary_emotion || entry.reflection_insight ||
    entry.overall_state_score !== null || entry.core_needs?.length > 0
  const hasConversation = Array.isArray(entry.full_conversation) && entry.full_conversation.length > 0
  // 有提取字段或对话记录，视为已做过 AI 分析
  const hasAI = hasExtraction || hasConversation

  return (
    <div className="flex flex-col h-full bg-[#fdfaf7]">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 flex-shrink-0">
        <button onClick={onBack} className="text-gray-400 active:scale-95 transition-transform">
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1">
          <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${template.color}`}>
            {template.emoji} {template.label}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
        {/* 时间 */}
        <p className="text-xs text-gray-400">{formatDate(entry.created_at)}</p>

        {/* 原始内容 */}
        <div className="card">
          <p className="text-xs text-gray-400 mb-2">原始记录</p>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{entry.content}</p>
        </div>

        {/* AI 提取字段 */}
        {hasExtraction && (
          <div className="card">
            <div className="flex items-center gap-1.5 mb-3">
              <Sparkles size={13} className="text-amber-500" />
              <p className="text-xs font-medium text-gray-500">AI 分析</p>
            </div>
            <ScoreBar score={entry.overall_state_score} />
            <FieldRow label="主情绪"    value={entry.primary_emotion} />
            <FieldRow label="夹杂情绪"  value={entry.mixed_emotions} />
            <FieldRow label="身体感受"  value={entry.body_sensations} />
            <FieldRow label="当下念头"  value={entry.current_thought} />
            <FieldRow label="核心需求"  value={entry.core_needs} />
            <FieldRow label="当下行为"  value={entry.current_behavior} />
            <FieldRow label="处理方式"  value={entry.handling_rating} />
            <FieldRow label="认知扭曲"  value={entry.cognitive_distortion_type} />
            <FieldRow label="认知分析"  value={entry.cognitive_analysis} />
            <FieldRow label="复盘洞见"  value={entry.reflection_insight} />
            <FieldRow label="大类标签"  value={entry.category_tags} />
            <FieldRow label="涉及人员"  value={entry.people_involved} />
          </div>
        )}

        {/* 完整对话记录 */}
        {hasConversation && (
          <div className="card">
            <div className="flex items-center gap-1.5 mb-4">
              <MessageCircle size={13} className="text-gray-400" />
              <p className="text-xs font-medium text-gray-500">完整对话记录</p>
            </div>
            <div className="space-y-3">
              {entry.full_conversation.map((msg, i) => (
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
          </div>
        )}

        {/* 没有 AI 内容时：显示占位图标 + 按钮（onStartAI 存在时才显示按钮） */}
        {!hasAI && (
          <div className="text-center py-8">
            <Sparkles size={32} className="text-gray-200 mx-auto mb-3" strokeWidth={1} />
            <p className="text-sm text-gray-400 mb-1">还没有 AI 分析记录</p>
            <p className="text-xs text-gray-300 mb-5">保存后可以随时和 AI 深入聊聊</p>
            {onStartAI && (
              <button
                onClick={() => onStartAI(entry)}
                className="px-5 py-2.5 bg-amber-500 text-white text-sm font-medium rounded-2xl active:scale-95 transition-transform"
              >
                ✦ 和 AI 聊聊这篇
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

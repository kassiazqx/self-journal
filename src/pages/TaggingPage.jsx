import { useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp, Check, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { detectEmotions } from '../lib/keywordDetection'

// ─── 情绪标签分组 ──────────────────────────────────────────────
const EMOTION_GROUPS = [
  {
    label: '正面',
    color: 'bg-pink-50 text-pink-600 border-pink-200',
    activeColor: 'bg-pink-500 text-white border-pink-500',
    tags: ['开心', '感激', '平静', '温暖', '满足', '喜悦', '被爱', '自豪', '轻松', '兴奋', '感动', '充实'],
  },
  {
    label: '负面',
    color: 'bg-purple-50 text-purple-600 border-purple-200',
    activeColor: 'bg-purple-500 text-white border-purple-500',
    tags: ['焦虑', '委屈', '失落', '难受', '愤怒', '孤独', '崩溃', '压抑', '绝望', '内疚', '恐惧', '无助'],
  },
  {
    label: '中性',
    color: 'bg-gray-50 text-gray-500 border-gray-200',
    activeColor: 'bg-gray-500 text-white border-gray-500',
    tags: ['困惑', '思考', '平淡', '麻木', '矛盾', '期待', '好奇', '疲惫', '迷茫', '复杂'],
  },
]

// 感恩模板只显示正面情绪
const GRATITUDE_GROUPS = [EMOTION_GROUPS[0]]

// ─── 状态评分 -3 ~ +3 ─────────────────────────────────────────
const STATE_OPTIONS = [
  { value: -3, label: '很差', emoji: '😞' },
  { value: -2, label: '差',   emoji: '😔' },
  { value: -1, label: '偏低', emoji: '😕' },
  { value:  0, label: '平静', emoji: '😐' },
  { value:  1, label: '偏好', emoji: '🙂' },
  { value:  2, label: '好',   emoji: '😊' },
  { value:  3, label: '很好', emoji: '😄' },
]

// ─── 处理评分选项 ──────────────────────────────────────────────
const HANDLING_OPTIONS = ['处理得很好', '还不错', '勉强应对', '处理失当', '失控了']

// ─── 哪些模板必须选情绪 / 必须填状态 ─────────────────────────
function getRequirements(templateType) {
  const required = templateType === 'emotion' || templateType === 'gratitude'
  return { requireEmotion: required, requireState: required }
}

// Props:
//   entry        — 已保存的记录（含 id, template_type, 及已有情绪字段用于编辑预填）
//   isEdit       — 是否编辑模式（按钮文案"保存"而非"完成"）
//   onComplete   — 完成后回调，传 { shouldSuggestChat: boolean }
//   onBack       — 返回上一页
export default function TaggingPage({ entry, isEdit = false, onComplete, onBack }) {
  const { requireEmotion, requireState } = getRequirements(entry.template_type)

  // 预填已有情绪（编辑模式）或从内容自动检测（新建模式）
  const initEmotions = () => {
    if (Array.isArray(entry.emotions) && entry.emotions.length > 0) {
      return entry.emotions                  // 编辑模式：用已存数据
    }
    return detectEmotions(entry.content || '') // 新建模式：关键词预选
  }

  const [selectedEmotions, setSelectedEmotions] = useState(initEmotions())
  const [customEmotions, setCustomEmotions] = useState([])
  const [showEmotionInput, setShowEmotionInput] = useState(false)
  const [emotionInput, setEmotionInput] = useState('')
  const [stateScore, setStateScore] = useState(
    entry.overall_state_score !== null && entry.overall_state_score !== undefined
      ? entry.overall_state_score
      : null
  )
  const [handlingOpen, setHandlingOpen] = useState(false)
  const [handlingRating, setHandlingRating] = useState(entry.handling_rating ?? null)
  const [error, setError] = useState('')

  const emotionGroups = entry.template_type === 'gratitude' ? GRATITUDE_GROUPS : EMOTION_GROUPS

  const toggleEmotion = (tag) => {
    setSelectedEmotions(prev =>
      prev.includes(tag) ? prev.filter(e => e !== tag) : [...prev, tag]
    )
  }

  const handleAddEmotion = () => {
    const tag = emotionInput.trim()
    if (!tag) return
    if (!customEmotions.includes(tag)) setCustomEmotions(prev => [...prev, tag])
    setSelectedEmotions(prev => prev.includes(tag) ? prev : [...prev, tag])
    setEmotionInput('')
    setShowEmotionInput(false)
  }

  const handleComplete = async () => {
    // 验证必填项
    if (requireEmotion && selectedEmotions.length === 0) {
      setError('请至少选择一个情绪标签')
      setTimeout(() => setError(''), 2000)
      return
    }
    if (requireState && stateScore === null) {
      setError('请选择整体状态评分')
      setTimeout(() => setError(''), 2000)
      return
    }

    // 立即回调（跳转），后台静默 UPDATE
    onComplete?.({ stateScore, goToReflection: false })

    supabase
      .from('journal_entries')
      .update({
        emotions:            selectedEmotions.length > 0 ? selectedEmotions : [],
        overall_state_score: stateScore,
        handling_rating:     handlingRating,
      })
      .eq('id', entry.id)
      .eq('user_id', entry.user_id)
      .then(({ error: e }) => { if (e) console.error('[tagging] 后台保存失败:', e) })
  }

  const handleReflection = async () => {
    // 同样做验证
    if (requireEmotion && selectedEmotions.length === 0) {
      setError('请至少选择一个情绪标签')
      setTimeout(() => setError(''), 2000)
      return
    }
    if (requireState && stateScore === null) {
      setError('请选择整体状态评分')
      setTimeout(() => setError(''), 2000)
      return
    }

    // 立即跳转，后台保存
    onComplete?.({ stateScore, goToReflection: true })

    supabase
      .from('journal_entries')
      .update({
        emotions:            selectedEmotions.length > 0 ? selectedEmotions : [],
        overall_state_score: stateScore,
        handling_rating:     handlingRating,
      })
      .eq('id', entry.id)
      .eq('user_id', entry.user_id)
      .then(({ error: e }) => { if (e) console.error('[tagging] 后台保存失败:', e) })
  }

  return (
    <div className="flex flex-col h-full bg-[#fdfaf7]">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <button onClick={onBack} className="text-gray-400 active:scale-95 transition-transform">
          <ArrowLeft size={22} />
        </button>
        <h2 className="text-base font-semibold text-gray-800">情绪标注</h2>
        <div className="w-8" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-2 flex flex-col gap-5">

        {/* ── 情绪标签 ── */}
        <div>
          <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">
            情绪标签{requireEmotion ? ' *' : '（选填）'}
          </p>
          {emotionGroups.map(group => (
            <div key={group.label} className="mb-3">
              <p className="text-xs text-gray-400 mb-1.5">{group.label}</p>
              <div className="flex flex-wrap gap-2">
                {group.tags.map(tag => {
                  const isSelected = selectedEmotions.includes(tag)
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleEmotion(tag)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-all active:scale-95 ${
                        isSelected ? group.activeColor : group.color
                      }`}
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* 自定义情绪标签 */}
          {customEmotions.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-400 mb-1.5">自定义</p>
              <div className="flex flex-wrap gap-2">
                {customEmotions.map(tag => {
                  const isSelected = selectedEmotions.includes(tag)
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleEmotion(tag)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-all active:scale-95 ${
                        isSelected
                          ? 'bg-primary-500 text-white border-primary-500'
                          : 'bg-gray-50 text-gray-500 border-gray-200'
                      }`}
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 新增按钮 + 输入框 */}
          <div>
            <button
              onClick={() => setShowEmotionInput(p => !p)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border border-dashed border-gray-300 text-gray-400 bg-white active:scale-95"
            >
              <Plus size={14} />
              <span>新增情绪</span>
            </button>
            {showEmotionInput && (
              <div className="flex gap-2 mt-2 fade-in">
                <input
                  value={emotionInput}
                  onChange={e => setEmotionInput(e.target.value)}
                  placeholder="输入情绪词，如：羞耻、嫉妒"
                  className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-2xl text-sm text-gray-600 focus:outline-none focus:border-primary-400"
                />
                <button
                  onClick={handleAddEmotion}
                  className="px-4 py-2 bg-primary-500 text-white text-sm rounded-2xl active:scale-95"
                >
                  添加
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── 状态评分 ── */}
        <div>
          <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">
            整体状态{requireState ? ' *' : '（选填）'}
          </p>
          <div className="flex justify-between gap-1">
            {STATE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setStateScore(prev => prev === opt.value ? null : opt.value)}
                className={`flex-1 flex flex-col items-center py-2 rounded-xl border text-xs transition-all active:scale-95 ${
                  stateScore === opt.value
                    ? 'bg-primary-500 text-white border-primary-500'
                    : 'bg-white text-gray-400 border-gray-100'
                }`}
              >
                <span className="text-base mb-0.5">{opt.emoji}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── 处理方式复盘（可展开）── */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <button
            onClick={() => setHandlingOpen(p => !p)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-600"
          >
            <span>处理方式复盘 <span className="text-gray-300 text-xs">（选填）</span></span>
            {handlingOpen
              ? <ChevronUp size={16} className="text-gray-400" />
              : <ChevronDown size={16} className="text-gray-400" />}
          </button>

          {handlingOpen && (
            <div className="px-4 pb-4 flex flex-col gap-2">
              {HANDLING_OPTIONS.map(opt => (
                <button
                  key={opt}
                  onClick={() => setHandlingRating(prev => prev === opt ? null : opt)}
                  className={`py-2.5 rounded-xl text-sm border transition-all active:scale-95 ${
                    handlingRating === opt
                      ? 'bg-primary-500 text-white border-primary-500'
                      : 'bg-gray-50 text-gray-600 border-gray-100'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <p className="text-center text-sm text-red-400 fade-in">{error}</p>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="px-4 pb-6 pt-2 flex gap-3 flex-shrink-0">
        <button
          onClick={handleReflection}
          className="px-4 py-3 bg-white border border-gray-200 text-gray-400 text-sm rounded-2xl active:scale-95 transition-transform whitespace-nowrap"
        >
          深度复盘
        </button>
        <button
          onClick={handleComplete}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-primary-500 text-white text-sm font-medium rounded-2xl active:scale-95 transition-transform"
        >
          <Check size={16} />
          {isEdit ? '保存' : '完成'}
        </button>
      </div>
    </div>
  )
}

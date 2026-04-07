// src/lib/reflectionQuestions.js
// 深度复盘问题库：字段 → 问题数组的映射，以及动态卡片过滤逻辑

// 负面情绪词集合——命中任一则显示仅限负面情绪的卡片
export const NEGATIVE_EMOTIONS = new Set([
  '焦虑', '崩溃', '难受', '委屈', '绝望', '压抑',
  '愤怒', '恐惧', '失落', '孤独', '内疚', '无助',
])

// 卡片定义（顺序即展示顺序）
// field: 写入 Supabase 的字段名
// showWhen: 'always' | 'negative'
// questions: 问题数组，第 0 个为默认，其余为「换一个」的候选池
export const QUESTION_CARDS = [
  {
    id: 'current_thought',
    label: '当下念头',
    field: 'current_thought',
    showWhen: 'always',
    questions: [
      '当时你脑子里第一个念头是什么？',
      '当下你心里第一个念头是什么？',
      '那个时刻最先冒出来的词是什么？',
    ],
  },
  {
    id: 'body_sensations',
    label: '身体感受',
    field: 'body_sensations',
    showWhen: 'negative',
    questions: [
      '这个感觉在身体的哪个部位？胸口、肚子、喉咙还是别的地方？',
      '是什么质地？紧绷、沉重、发热，还是别的？',
      '现在坐着，身体哪里是紧的？',
    ],
  },
  {
    id: 'current_behavior',
    label: '当下行为',
    field: 'current_behavior',
    showWhen: 'always',
    questions: [
      '当时你的第一反应是什么？做了什么，或者选择了沉默？',
      '你当时怎么处理的？',
      '你说了什么，还是选择回避？',
    ],
  },
  {
    id: 'core_needs',
    label: '核心需求',
    field: 'core_needs',
    showWhen: 'always',
    questions: [
      '在这件事上，你真正需要的是什么？',
      '什么对你来说最重要？',
      '这件事触动了你的什么——被理解、安全感，还是别的？',
    ],
  },
  {
    id: 'cognitive_analysis',
    label: '认知梳理',
    field: 'cognitive_analysis',
    showWhen: 'always',
    questions: [
      '这个想法，是事实，还是你对这件事的解读？',
      '这个结论是怎么来的？',
      '如果是你最在意的朋友经历了这一切，你会对 ta 说什么？',
    ],
  },
  {
    id: 'reflection_acceptance',
    label: '接纳',
    field: 'reflection_insight',
    showWhen: 'negative',
    // 接纳卡片写入 reflection_insight，onBlur 时 append（见 ReflectionPage）
    questions: [
      '你能允许这种感受就在这里，不用做什么，只是让它在吗？',
      '你有没有在对抗它、想让它快点消失？',
      '如果这个感受会说话，它想告诉你什么？',
    ],
  },
  {
    id: 'reflection_insight_card',
    label: '复盘洞见',
    field: 'reflection_insight',
    showWhen: 'always',
    // 洞见卡片同样写入 reflection_insight，onBlur 时 append
    questions: [
      '写完这些，有什么是刚才才意识到的吗？',
      '有没有哪句话，说出来之后觉得"对，就是这个"？',
      '如果给今天的自己说一句话，会是什么？',
    ],
  },
]

/**
 * 根据 entry 的情绪，返回应显示的卡片列表。
 * 负面情绪时：7 张（含 body_sensations + 接纳）
 * 其他情绪时：5 张（跳过 showWhen === 'negative' 的卡片）
 */
export function getCardsForEntry(entry) {
  const emotions = Array.isArray(entry.emotions) ? entry.emotions : []
  const isNegative = emotions.some(e => NEGATIVE_EMOTIONS.has(e))
  return QUESTION_CARDS.filter(
    card => card.showWhen === 'always' || isNegative
  )
}

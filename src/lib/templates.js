// ─── 模板配置（唯一真相源）─────────────────────────────────────
// 所有模板的 id、emoji、label、hint、color 统一在此维护。
// 新增模板只需在此加一条，其他文件自动获取。
//
// 扩展点：
// - color 目前硬编码 Tailwind 类，未来可改为 design token 或主题配置
// - hint 目前硬编码中文，未来可接入 i18n

export const TEMPLATES = [
  {
    id: 'gratitude',
    emoji: '🩷',
    label: '感恩',
    hint: '今天有什么值得感谢的？是谁、是什么事让你感到温暖或幸运？',
    color: 'bg-pink-50 text-pink-600 border-pink-100',
  },
  {
    id: 'emotion',
    emoji: '🌷',
    label: '觉察',
    hint: '现在是什么感受？发生了什么？你注意到自己身体上有什么感觉吗？',
    color: 'bg-purple-50 text-purple-600 border-purple-100',
  },
  {
    id: 'free',
    emoji: '✨',
    label: '灵感',
    hint: '一闪而过的念头、想法、观察——不用整理，直接写下来就好。',
    color: 'bg-gray-50 text-gray-500 border-gray-100',
  },
  {
    id: 'learning',
    emoji: '📝',
    label: '学习',
    hint: '今天学了什么？用自己的话说一遍，有什么让你印象深刻或有疑惑的地方？',
    color: 'bg-blue-50 text-blue-600 border-blue-100',
  },
  {
    id: 'action',
    emoji: '💪🏻',
    label: '行动',
    hint: '今天做了什么？运动、完成了一件事——时长、状态、身体感受如何？',
    color: 'bg-green-50 text-green-600 border-green-100',
  },
]

// 快速查表（by id），替代各文件里的 TEMPLATE_MAP 对象
// 用法：TEMPLATE_BY_ID['gratitude'] → { id, emoji, label, hint, color }
export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map(t => [t.id, t]))

// 默认模板（id 未知时的兜底）
export const DEFAULT_TEMPLATE = TEMPLATE_BY_ID.free

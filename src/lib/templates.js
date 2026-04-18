/**
 * 模板系统配置（唯一真相源）
 *
 * 阶段二改动：
 *   - ID 变更：emotion → awareness，free → freewrite
 *   - color 从 Tailwind 类改为十六进制色值（用于标签、引导竖线、引导文字）
 *   - 新增 guide（引导词）、awarenessStart（觉察流入口层级）
 *   - 移除 emoji、hint（由 guide 替代）
 *
 * 历史数据兼容：
 *   旧 template_type 字段可能含 'emotion'/'free'，
 *   读取时用 resolveTemplate(id) 代替直接查 TEMPLATE_BY_ID[id]
 */

export const TEMPLATES = [
  {
    id: 'awareness',
    label: '觉察',
    color: '#c9a96e',           // 低饱和暖金
    guide: '发生了什么 → 感受到什么 → 身体感觉',
    awarenessStart: 'emotion',  // 点 ✓ 后觉察流从情绪层（tier 2）开始
  },
  {
    id: 'gratitude',
    label: '感恩',
    color: '#7cb9a8',           // 绿
    guide: '今天 3 件值得感恩的事 → 为什么 → 谁让我感到温暖',
    awarenessStart: 'gratitude',
  },
  {
    id: 'learning',
    label: '学习',
    color: '#8aabcc',           // 蓝
    guide: '学到了什么 → 为什么重要 → 想如何实践',
    awarenessStart: 'learning',
  },
  {
    id: 'freewrite',
    label: '随记',
    color: '#aaa',              // 灰
    guide: '随手记下来',
    awarenessStart: null,       // 随记不进觉察流，直接保存
  },
  {
    id: 'action',
    label: '行动',
    color: '#b8a88a',           // 暖棕
    guide: '做了什么 → 感受如何 → 下次想怎么做',
    awarenessStart: 'action',
  },
]

// 快速查表（by id）
const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map(t => [t.id, t]))

// 默认模板（id 未知时的兜底）
export const DEFAULT_TEMPLATE = TEMPLATE_BY_ID['awareness']

// ─── 历史数据兼容 ─────────────────────────────────────────────────
// 阶段一/二写入的旧 template_type 值映射到新 ID
const LEGACY_ID_MAP = {
  'emotion':   'awareness',
  'free':      'freewrite',
  // 以下旧 ID 与新 ID 一致，显式列出避免歧义
  'gratitude': 'gratitude',
  'learning':  'learning',
  'action':    'action',
}

/**
 * 根据 template_type 字段值（可能是旧 ID）返回模板对象
 * 所有读取模板的地方都应使用此函数，不直接查 TEMPLATE_BY_ID
 *
 * @param {string} id - entry.template_type 的值
 * @returns {object} 模板对象，未知 ID 返回 DEFAULT_TEMPLATE
 */
export function resolveTemplate(id) {
  const resolved = LEGACY_ID_MAP[id] ?? id
  return TEMPLATE_BY_ID[resolved] ?? DEFAULT_TEMPLATE
}

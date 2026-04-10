/**
 * 内容复杂度分析模块
 *
 * 纯本地关键词评分，零 token 消耗。
 * 调用方只需关心 analyzeContent(text) 的返回值，不感知内部实现。
 *
 * 升级路径（不影响调用方）：
 *   第一版：关键词词库（当前）
 *   升级版：浏览器内 ML 小模型（Transformers.js，本地运行）
 *   终极版：结合 AI 提升准确率
 */

// 强负面情绪词，各 +2 分
const STRONG_NEGATIVE = [
  '焦虑', '难受', '崩溃', '委屈', '绝望', '痛苦', '恐惧', '害怕', '恐慌',
  '愤怒', '压抑', '窒息', '失控', '孤独', '无助', '抑郁', '崩了', '撑不住',
  '很累', '好累', '好难', '受不了', '好烦', '好烦', '想哭', '哭了', '泪',
]

// 复杂/矛盾信号词，各 +1 分
const COMPLEX_SIGNALS = [
  '但是', '纠结', '说不清', '不知道为什么', '矛盾', '乱', '搞不懂',
  '迷茫', '困惑', '说不出来', '不明白', '莫名', '奇怪', '为什么我',
  '又开始', '还是', '到底', '该怎么', '不确定', '不知道该',
]

// 正面词，各 -1 分（抵消复杂度）
const POSITIVE = [
  '开心', '幸福', '舒服', '感恩', '快乐', '满足', '喜悦', '高兴', '愉快',
  '美好', '感激', '温暖', '平静', '充实', '自豪', '轻松', '兴奋', '感动',
  '很好', '挺好', '还好', '不错', '棒', '顺利', '成功', '做到',
]

/**
 * 分析文本复杂度
 * @param {string} text - 日记内容
 * @returns {{ score: number, shouldSuggestChat: boolean }}
 */
export function analyzeContent(text) {
  if (!text || text.trim().length === 0) {
    return { score: 0, shouldSuggestChat: false }
  }

  let score = 0

  // 强负面词：每个词出现一次 +2（可重复计分）
  for (const word of STRONG_NEGATIVE) {
    const count = (text.match(new RegExp(word, 'g')) || []).length
    score += count * 2
  }

  // 复杂/矛盾信号词：每个词出现就 +1（不重复计分）
  for (const word of COMPLEX_SIGNALS) {
    if (text.includes(word)) score += 1
  }

  // 内容超过 150 字 +1
  if (text.trim().length > 150) score += 1

  // 正面词：每个词出现就 -1
  for (const word of POSITIVE) {
    if (text.includes(word)) score -= 1
  }

  return {
    score,
    shouldSuggestChat: score >= 2,
  }
}

// ─── 觉察流起点计算 ───────────────────────────────────────────────
// 引入情绪词库负面组，避免在这里硬编码第二套词表
import { EMOTION_NEGATIVE } from './emotionMap.js'

/**
 * 根据写作内容的深度，决定觉察流从哪一层问题开始
 *
 * @param {string} text - 用户原始写作内容
 * @returns {number} tier - 1/2/3/4/5，数字越大跳过的表层问题越多
 *
 * tier 1：从头开始（内容太短 / 没有情绪线索）
 * tier 2：跳过情境描述，从情绪层开始（已有情绪词）
 * tier 3：跳到身体/念头层（已写到身体感受或核心需求）
 */
export function getAwarenessStartTier(text) {
  if (!text || text.trim().length < 30) return 1  // 太短，从头开始

  const { score } = analyzeContent(text)

  // 深层关键词：身体感受 / 核心需求类词语
  const hasBodyWords = ['身体', '胸口', '肚子', '喉咙', '头疼', '心跳', '紧', '沉'].some(w => text.includes(w))
  const hasNeedWords = ['需要', '想要', '希望', '重要', '被理解', '安全'].some(w => text.includes(w))

  // 负面情绪词：直接复用 EMOTION_NEGATIVE，不重复维护
  const hasNegativeEmotionWords = EMOTION_NEGATIVE.some(w => text.includes(w))

  if (hasBodyWords || hasNeedWords) return 3      // 已写到深层，跳到 tier 3
  if (hasNegativeEmotionWords || score >= 2) return 2  // 有负面情绪词，从 tier 2 开始
  return 1                                         // 其他情况从头开始
}

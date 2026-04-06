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

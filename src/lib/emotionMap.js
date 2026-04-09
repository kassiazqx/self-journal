/**
 * 情绪词库与映射模块
 *
 * 职责：
 *   1. 维护基础层 49 词（统计口径，固定不扩展）
 *   2. 把 AI 生成的描述层词（emotion_display）本地映射到基础层（emotions）
 *   3. 输出映射置信度（emotion_confidence），供详情页决定是否显示"待确认"提示
 *
 * 词库依据：Ekman 基础情绪理论 + Plutchik 情绪轮盘 + Cowen & Keltner（2017）27种情绪研究
 *
 * 扩展规则：
 *   - EMOTION_BASE 不随用户输入自动扩展
 *   - 新增词需人工评审后写入此文件
 *   - SYNONYM_MAP 可随时补充新的近义词映射
 */

// ─── 基础层词库（49词，完整列表）──────────────────────────────────
export const EMOTION_BASE = [
  // 负面（25词）
  '难过', '愤怒', '委屈', '焦虑', '羞愧', '无力', '害怕', '孤独', '绝望', '沮丧',
  '厌烦', '烦躁', '压抑', '紧张', '失落', '嫉妒', '内疚', '抗拒', '疲惫', '麻木',
  '不甘', '崩溃', '厌恶', '悲痛', '羞耻',
  // 正面（15词）
  '轻松', '满足', '感激', '开心', '平静', '期待', '温暖', '喜悦', '自豪', '踏实',
  '安心', '充实', '兴奋', '爱', '敬畏',
  // 混合/中性（9词）
  '迷茫', '矛盾', '好奇', '纠结', '释然', '依恋', '敏感', '复杂', '惊讶', '无聊',
]

// 负面情绪子集（供 contentAnalysis.js 判断负面情绪，保持词库单一来源）
export const EMOTION_NEGATIVE = EMOTION_BASE.slice(0, 25)

// ─── 近义词映射表（描述层词 → 基础层词）──────────────────────────
const SYNONYM_MAP = {
  // 负面
  '难受':     '难过',  '伤心':     '难过',  '悲伤':     '难过',  '心疼':     '难过',
  '生气':     '愤怒',  '气愤':     '愤怒',  '愤恨':     '愤怒',  '恼火':     '愤怒',
  '心酸':     '委屈',  '不公':     '委屈',
  '担心':     '焦虑',  '不安':     '焦虑',  '忧虑':     '焦虑',  '惶恐':     '焦虑',
  '害羞':     '羞愧',  '难堪':     '羞愧',  '自责':     '羞愧',  '惭愧':     '羞愧',
  '无奈':     '无力',  '力不从心': '无力',  '无法改变': '无力',
  '恐惧':     '害怕',  '慌':       '害怕',  '惊慌':     '害怕',
  '寂寞':     '孤独',  '孤立':     '孤独',  '被忽视':   '孤独',
  '消沉':     '沮丧',  '意志消沉': '沮丧',
  '烦':       '烦躁',  '心烦':     '烦躁',  '焦躁':     '烦躁',
  '郁闷':     '压抑',  '憋屈':     '压抑',  '憋':       '压抑',
  '紧绷':     '紧张',  '绷':       '紧张',
  '失意':     '失落',
  '羡慕':     '嫉妒',
  '愧疚':     '内疚',  '后悔':     '内疚',
  '排斥':     '抗拒',  '不想':     '抗拒',
  '累':       '疲惫',  '精疲力竭': '疲惫',  '筋疲力尽': '疲惫',
  '木木的':   '麻木',  '没感觉':   '麻木',
  '不服气':   '不甘',  '心有不甘': '不甘',
  '崩了':     '崩溃',  '撑不住':   '崩溃',
  '恶心':     '厌恶',  '反感':     '厌恶',  '厌恶感':   '厌恶',
  '哀痛':     '悲痛',  '极度悲伤': '悲痛',  '痛失':     '悲痛',
  '羞耻感':   '羞耻',  '丢脸':     '羞耻',  '无地自容': '羞耻',
  // 正面
  '快乐':     '开心',  '高兴':     '开心',
  '放松':     '轻松',
  '知足':     '满足',
  '感恩':     '感激',  '谢谢':     '感激',
  '安静':     '平静',  '内心平静': '平静',  '淡然':     '平静',
  '期盼':     '期待',
  '被关心':   '温暖',  '暖':       '温暖',  '被爱':     '温暖',
  '欣喜':     '喜悦',
  '骄傲':     '自豪',
  '稳':       '踏实',  '安稳':     '踏实',
  '有意义':   '充实',
  '亢奋':     '兴奋',  '激动':     '兴奋',  '振奋':     '兴奋',  '好嗨':     '兴奋',
  '爱意':     '爱',    '心动':     '爱',    '珍惜':     '爱',
  '感动':     '敬畏',  '震撼':     '敬畏',  '被震到':   '敬畏',  '崇敬':     '敬畏',
  // 混合
  '迷失':     '迷茫',  '找不到方向':'迷茫',
  '左右为难': '纠结',
  '想通了':   '释然',  '放下了':   '释然',
  '感兴趣':   '好奇',
  '吃惊':     '惊讶',  '没想到':   '惊讶',  '意外':     '惊讶',  '惊喜':     '惊讶',
  '无聊透了': '无聊',  '百无聊赖': '无聊',  '提不起劲': '无聊',
}

// ─── 映射函数 ─────────────────────────────────────────────────────

/**
 * 把描述层的单个情绪词映射到基础层
 * @param {string} displayWord - AI 生成的描述层词（可能是词组，如"克制后的难受"）
 * @returns {{ baseWord: string|null, confidence: number }}
 *   confidence: 1.0 = 精确匹配基础词
 *              0.85 = 近义词映射
 *              0.75 = 包含关系（如"克制后的难受"包含"难受"）
 *              0    = 未找到
 */
export function mapToBase(displayWord) {
  if (!displayWord) return { baseWord: null, confidence: 0 }

  const word = displayWord.trim()

  // 1. 直接在基础层词库里（精确匹配）
  if (EMOTION_BASE.includes(word)) {
    return { baseWord: word, confidence: 1.0 }
  }

  // 2. 近义词映射
  const mapped = SYNONYM_MAP[word]
  if (mapped) {
    return { baseWord: mapped, confidence: 0.85 }
  }

  // 3. 包含关系（如"克制后的难受"包含基础词"难受"）
  for (const base of EMOTION_BASE) {
    if (word.includes(base)) {
      return { baseWord: base, confidence: 0.75 }
    }
  }

  // 4. 未找到
  return { baseWord: null, confidence: 0 }
}

/**
 * 把描述层数组整体映射到基础层
 * @param {string[]} displayWords - AI 提取的 emotion_display 数组
 * @returns {{ baseWords: string[], minConfidence: number }}
 *   baseWords：去重后的基础层词列表（用于 emotions 字段 + 统计）
 *   minConfidence：所有词里最低的置信度（用于 emotion_confidence 字段）
 *                  < 0.75 时详情页显示"基础标签待确认"
 *                  === 0 时基础层留空，显示"未分类"
 */
export function mapDisplayToBase(displayWords = []) {
  if (!displayWords.length) return { baseWords: [], minConfidence: 1.0 }

  const results = displayWords.map(w => mapToBase(w))
  const baseWords = [...new Set(results.map(r => r.baseWord).filter(Boolean))]
  const minConfidence = Math.min(...results.map(r => r.confidence))

  return { baseWords, minConfidence }
}

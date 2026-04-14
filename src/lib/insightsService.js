/**
 * insightsService.js — 洞察页数据读取层
 *
 * InsightsPage 所需的所有数据查询统一在这里，组件只调此模块，不直接写 db.from()。
 *
 * 扩展路径：
 *   - 新增 threads 查询（第二批功能）：在 loadInsightsData 里加 threadsRes
 *   - 新增时间维度筛选（30天/全部）：把 since 参数暴露为参数即可
 *   - 切换存储层：只改 db.js，此文件零修改
 */
import { db } from './db'

// 过去 N 天的 ISO 起始时间
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

/**
 * 加载洞察页所需的全量数据
 * @param {string} userId
 * @param {object} options
 * @param {number} options.days  统计天数，默认 30
 * @returns {{ moodData, emotionCounts, needsCounts, tagCounts, latestLetter, error }}
 */
export async function loadInsightsData(userId, { days = 30 } = {}) {
  const since = daysAgo(days)

  const [moodRes, emotionRes, needsRes, letterRes, tagsRes, threadsRes, lettersRes, candidateRes] = await Promise.all([
    // 心情曲线：按时间排，只取有 overall_state_score 的条目
    db.from('journal_entries')
      .select('created_at, overall_state_score')
      .eq('user_id', userId)
      .not('overall_state_score', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: true }),

    // 情绪频率
    db.from('journal_entries')
      .select('emotions')
      .eq('user_id', userId)
      .gte('created_at', since),

    // 核心需求频率
    db.from('journal_entries')
      .select('core_needs')
      .eq('user_id', userId)
      .gte('created_at', since),

    // 最新一封回顾信（含已读状态）
    db.from('review_letters')
      .select('id, content, period_start, period_end, is_read')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // 标签统计
    db.from('journal_entries')
      .select('category_tags')
      .eq('user_id', userId)
      .gte('created_at', since),

    // 已确认脉络（洞察页展示最多 3 条）
    db.from('threads')
      .select('id, name, status, arc_summary, updated_at')
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .order('updated_at', { ascending: false })
      .limit(3),

    // 全部回顾信（回顾信列表页用）
    db.from('review_letters')
      .select('id, content, period_start, period_end, is_read, created_at, entry_ids')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),

    // 候选脉络数（洞察页角标，只计 status='candidate'，不计 rejected）
    db.from('threads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'candidate'),
  ])

  // 检查是否有致命错误（心情数据或情绪数据缺失则上报）
  if (moodRes.error) {
    console.error('[insightsService] 心情数据读取失败:', moodRes.error)
  }

  // 情绪频率统计
  const eCounts = {}
  ;(emotionRes.data ?? []).forEach(row => {
    ;(row.emotions ?? []).forEach(w => {
      eCounts[w] = (eCounts[w] ?? 0) + 1
    })
  })

  // 核心需求频率统计
  const nCounts = {}
  ;(needsRes.data ?? []).forEach(row => {
    ;(row.core_needs ?? []).forEach(w => {
      nCounts[w] = (nCounts[w] ?? 0) + 1
    })
  })

  // 标签频率统计
  const tCounts = {}
  ;(tagsRes.data ?? []).forEach(row => {
    ;(row.category_tags ?? []).forEach(t => {
      tCounts[t] = (tCounts[t] ?? 0) + 1
    })
  })

  return {
    moodData:         moodRes.data ?? [],
    emotionCounts:    Object.entries(eCounts).map(([label, count]) => ({ label, count })),
    needsCounts:      Object.entries(nCounts).map(([label, count]) => ({ label, count })),
    tagCounts:        Object.entries(tCounts).map(([label, count]) => ({ label, count })),
    latestLetter:     letterRes.data ?? null,
    confirmedThreads: threadsRes.data ?? [],
    allLetters:       lettersRes.data ?? [],
    candidateCount:   candidateRes.count ?? 0,
    error: moodRes.error ?? null,
  }
}

/**
 * inferDatetime(text, now)
 * 从文本关键词推算绝对时间。
 * 多关键词：过滤未来时间点，取最近（最大时间戳）的结果。
 * 无匹配返回 null。
 */
export function inferDatetime(text, now = new Date()) {
  if (!text) return null
  const candidates = []

  function makeDate(dayOffset, hour, minute) {
    const d = new Date(now)
    d.setDate(d.getDate() + dayOffset)
    if (hour !== null) {
      d.setHours(hour, minute ?? 0, 0, 0)
    }
    return d
  }

  // 当前时刻
  if (/现在|刚刚/.test(text)) candidates.push(new Date(now))

  // 今天时段
  if (/今早|今晨|早上|上午/.test(text)) candidates.push(makeDate(0, 9, 0))
  if (/中午/.test(text))                candidates.push(makeDate(0, 12, 0))
  if (/下午/.test(text))                candidates.push(makeDate(0, 16, 0))
  if (/傍晚/.test(text))                candidates.push(makeDate(0, 18, 0))
  if (/晚上|夜里|今晚/.test(text))       candidates.push(makeDate(0, 21, 0))

  // 昨天（含时段）—— 昨晚/昨夜 优先，不重复匹配昨天
  if (/昨晚|昨夜/.test(text))           candidates.push(makeDate(-1, 21, 0))
  else if (/昨天/.test(text))           candidates.push(makeDate(-1, null, null))

  // 前天 / 大前天
  if (/大前天/.test(text))              candidates.push(makeDate(-3, null, null))
  else if (/前天/.test(text))           candidates.push(makeDate(-2, null, null))

  if (candidates.length === 0) return null

  // 过滤未来时间点，取最近（最大时间戳）
  const valid = candidates.filter(d => d <= now)
  if (valid.length === 0) return null
  return new Date(Math.max(...valid.map(d => d.getTime())))
}

/**
 * formatPill(date, now)
 * 将 Date 格式化为 pill 显示文字。
 * 今天：「今天 HH:MM」
 * 其他：「M月D日 HH:MM」
 */
export function formatPill(date, now = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (isToday) return `今天 ${hh}:${mm}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`
}

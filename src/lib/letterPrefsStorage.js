const DEFAULT_LETTER_PREFS = {
  type: 'count',
  count_threshold: 10,
  require_new_entries: true,
}

function getLetterPrefsKey(userId) {
  return `letter_prefs_${userId}`
}

export function normalizeLetterPrefs(raw) {
  if (!raw) return { ...DEFAULT_LETTER_PREFS }

  return {
    type: raw.type === 'manual' ? 'manual' : 'count',
    count_threshold: Number.isFinite(raw.count_threshold)
      ? raw.count_threshold
      : DEFAULT_LETTER_PREFS.count_threshold,
    require_new_entries: raw.require_new_entries ?? DEFAULT_LETTER_PREFS.require_new_entries,
  }
}

export function saveLetterPrefs(userId, prefs) {
  const normalized = normalizeLetterPrefs(prefs)

  try {
    localStorage.setItem(getLetterPrefsKey(userId), JSON.stringify(normalized))
  } catch {
    // Ignore storage failures for now; local prefs are best-effort on Web.
  }

  return normalized
}

export function getLetterPrefs(userId) {
  try {
    const raw = localStorage.getItem(getLetterPrefsKey(userId))
    if (!raw) return normalizeLetterPrefs(null)

    return normalizeLetterPrefs(JSON.parse(raw))
  } catch {
    try {
      localStorage.removeItem(getLetterPrefsKey(userId))
    } catch {
      // Ignore cleanup failure.
    }
    return normalizeLetterPrefs(null)
  }
}

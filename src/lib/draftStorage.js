const DRAFT_KEY = 'journal_draft_v2'
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

function toIsoString(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return value
}

export function serializeDraftSnapshot(snapshot) {
  return {
    content: snapshot.content ?? '',
    template: snapshot.template ?? 'awareness',
    savedAt: snapshot.savedAt ?? new Date().toISOString(),
    selectedDatetime: toIsoString(snapshot.selectedDatetime),
    manualOverride: Boolean(snapshot.manualOverride),
    dismissedPeople: [...(snapshot.dismissedPeople ?? [])],
  }
}

export function saveDraftSnapshot(snapshot) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(serializeDraftSnapshot(snapshot)))
  } catch {
    // localStorage 容错
  }
}

export function loadDraftSnapshot() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const savedAtMs = parsed.savedAt ? new Date(parsed.savedAt).getTime() : null
    if (savedAtMs && Date.now() - savedAtMs > DRAFT_TTL_MS) {
      localStorage.removeItem(DRAFT_KEY)
      return null
    }

    return {
      ...parsed,
      selectedDatetime: parsed.selectedDatetime ? new Date(parsed.selectedDatetime) : null,
      dismissedPeople: new Set(parsed.dismissedPeople ?? []),
    }
  } catch {
    localStorage.removeItem(DRAFT_KEY)
    return null
  }
}

export function clearDraftSnapshot() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // localStorage 容错
  }
}

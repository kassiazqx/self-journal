const DRAFT_KEY = 'journal_draft_v2'

function safeRemoveDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // localStorage 容错
  }
}

function toIsoString(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return value
}

function parseValidDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
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
    const content = typeof parsed.content === 'string' ? parsed.content : ''
    if (!content.trim()) {
      safeRemoveDraft()
      return null
    }

    const template =
      typeof parsed.template === 'string' && parsed.template
        ? parsed.template
        : 'awareness'

    const savedAt = parseValidDate(parsed.savedAt) ?? new Date()

    const selectedDatetime = parsed.selectedDatetime
      ? parseValidDate(parsed.selectedDatetime)
      : null

    return {
      ...parsed,
      content,
      template,
      savedAt: savedAt.toISOString(),
      selectedDatetime,
      manualOverride: selectedDatetime ? Boolean(parsed.manualOverride) : false,
      dismissedPeople: new Set(Array.isArray(parsed.dismissedPeople) ? parsed.dismissedPeople : []),
    }
  } catch {
    safeRemoveDraft()
    return null
  }
}

export function clearDraftSnapshot() {
  safeRemoveDraft()
}

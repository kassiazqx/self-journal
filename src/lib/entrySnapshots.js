const FULL_ENTRY_FIELDS = [
  'id',
  'user_id',
  'content',
  'template_type',
  'created_at',
  'emotion_display',
  'emotions',
  'emotion_confidence',
  'image_urls',
  'annotations',
  'people_involved',
  'category_tags',
  'core_needs',
  'current_thought',
  'current_behavior',
  'handling_rating',
  'cognitive_distortion_type',
  'body_sensations',
  'cognitive_analysis',
  'reflection_insight',
  'entry_summary',
  'overall_state_score',
  'theme_hints',
]

export const JOURNAL_ENTRY_FULL_SELECT = FULL_ENTRY_FIELDS.join(', ')

export function hasCompleteEntry(entry) {
  if (!entry?.id) return false
  return FULL_ENTRY_FIELDS.every(field => Object.prototype.hasOwnProperty.call(entry, field))
}

export function sortEntriesByCreatedAtDesc(entries) {
  return [...entries].sort((a, b) => {
    const aTime = new Date(a?.created_at ?? 0).getTime()
    const bTime = new Date(b?.created_at ?? 0).getTime()
    return bTime - aTime
  })
}

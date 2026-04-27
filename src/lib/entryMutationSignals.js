const AGGREGATE_REFRESH_FIELDS = new Set([
  'template_type',
  'created_at',
])

export function shouldRefreshEntryAggregates(field) {
  return AGGREGATE_REFRESH_FIELDS.has(field)
}

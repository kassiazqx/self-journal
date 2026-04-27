import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldRefreshEntryAggregates } from './entryMutationSignals.js'

test('refresh entry aggregates only for template and datetime changes', () => {
  assert.equal(shouldRefreshEntryAggregates('template_type'), true)
  assert.equal(shouldRefreshEntryAggregates('created_at'), true)

  assert.equal(shouldRefreshEntryAggregates('entry_summary'), false)
  assert.equal(shouldRefreshEntryAggregates('core_needs'), false)
  assert.equal(shouldRefreshEntryAggregates('annotations'), false)
})

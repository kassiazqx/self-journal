import test from 'node:test'
import assert from 'node:assert/strict'

import { JOURNAL_ENTRY_FULL_SELECT } from './entrySnapshots.js'

test('JOURNAL_ENTRY_FULL_SELECT includes updated_at for stale checks', () => {
  assert.match(JOURNAL_ENTRY_FULL_SELECT, /\bupdated_at\b/)
})

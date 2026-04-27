import test from 'node:test'
import assert from 'node:assert/strict'

import { createInitialEntryFetchState, resolveEntryResourceState } from './useEntryState.js'

test('createInitialEntryFetchState starts in loading when id exists', () => {
  const state = createInitialEntryFetchState('entry-1')

  assert.equal(state.id, 'entry-1')
  assert.equal(state.status, 'loading')
  assert.equal(state.error, null)
})

test('resolveEntryResourceState returns missing only for a settled empty lookup', () => {
  const state = resolveEntryResourceState({
    id: 'entry-1',
    entry: null,
    fetchState: {
      id: 'entry-1',
      status: 'missing',
      error: null,
    },
  })

  assert.equal(state.status, 'missing')
  assert.equal(state.entry, null)
  assert.equal(state.error, null)
})

test('resolveEntryResourceState returns error when lookup failed', () => {
  const error = new Error('network down')
  const state = resolveEntryResourceState({
    id: 'entry-1',
    entry: null,
    fetchState: {
      id: 'entry-1',
      status: 'error',
      error,
    },
  })

  assert.equal(state.status, 'error')
  assert.equal(state.entry, null)
  assert.equal(state.error, error)
})

test('resolveEntryResourceState prefers ready when store already has entry', () => {
  const entry = { id: 'entry-1', content: 'hello' }
  const error = new Error('transient failure')
  const state = resolveEntryResourceState({
    id: 'entry-1',
    entry,
    fetchState: {
      id: 'entry-1',
      status: 'error',
      error,
    },
  })

  assert.equal(state.status, 'ready')
  assert.equal(state.entry, entry)
  assert.equal(state.error, null)
})

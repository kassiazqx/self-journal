import test from 'node:test'
import assert from 'node:assert/strict'

import reducer, { entryActions, entrySelectors } from './entrySlice.js'

function buildEntry(id, updatedAt, extra = {}) {
  return {
    id,
    updated_at: updatedAt,
    created_at: updatedAt,
    content: `entry-${id}`,
    ...extra,
  }
}

test('upsertIfNewer keeps newer entity and clears stale flag', () => {
  let state = reducer(undefined, { type: '@@INIT' })

  state = reducer(state, entryActions.upsertIfNewer(buildEntry('a', '2026-04-27T10:00:00.000Z')))
  state = reducer(state, entryActions.markStale('a'))
  state = reducer(state, entryActions.upsertIfNewer(buildEntry('a', '2026-04-27T09:59:59.000Z', { content: 'older' })))

  assert.equal(state.entities.a.content, 'entry-a')
  assert.equal(state.entities.a._stale, true)

  state = reducer(state, entryActions.upsertIfNewer(buildEntry('a', '2026-04-27T10:00:01.000Z', { content: 'newer' })))

  assert.equal(state.entities.a.content, 'newer')
  assert.equal(state.entities.a._stale, false)
})

test('removeMany deletes all requested ids', () => {
  let state = reducer(undefined, { type: '@@INIT' })
  state = reducer(state, entryActions.upsertManyIfNewer([
    buildEntry('a', '2026-04-27T10:00:00.000Z'),
    buildEntry('b', '2026-04-27T10:00:00.000Z'),
  ]))

  state = reducer(state, entryActions.removeMany(['a', 'b']))

  assert.equal(entrySelectors.selectIds({ entries: state }).length, 0)
})

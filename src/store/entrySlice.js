import { createEntityAdapter, createSlice } from '@reduxjs/toolkit'

const adapter = createEntityAdapter({
  sortComparer: (a, b) => {
    const aTime = new Date(a?.created_at ?? 0).getTime()
    const bTime = new Date(b?.created_at ?? 0).getTime()
    return bTime - aTime
  },
})

function withFreshFlag(entry) {
  return { ...entry, _stale: false }
}

function getEntryTime(entry) {
  return new Date(entry?.updated_at ?? entry?.created_at ?? 0).getTime()
}

function shouldUpsert(current, incoming) {
  if (!current) return true
  return getEntryTime(incoming) >= getEntryTime(current)
}

const entrySlice = createSlice({
  name: 'entries',
  initialState: adapter.getInitialState(),
  reducers: {
    upsertIfNewer(state, action) {
      const incoming = action.payload
      const current = state.entities[incoming.id]

      if (!shouldUpsert(current, incoming)) return
      adapter.upsertOne(state, withFreshFlag(incoming))
    },
    upsertManyIfNewer(state, action) {
      action.payload.forEach((incoming) => {
        const current = state.entities[incoming.id]
        if (!shouldUpsert(current, incoming)) return
        adapter.upsertOne(state, withFreshFlag(incoming))
      })
    },
    markStale(state, action) {
      const id = action.payload
      if (state.entities[id]) {
        state.entities[id]._stale = true
      }
    },
    removeOne: adapter.removeOne,
    removeMany: adapter.removeMany,
    clearAll: adapter.removeAll,
  },
})

export const entryActions = entrySlice.actions
export const entrySelectors = adapter.getSelectors(state => state.entries)
export default entrySlice.reducer

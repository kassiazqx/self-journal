import { useEffect } from 'react'
import { useSelector } from 'react-redux'

import { getEntryById } from '../lib/entryRepository'
import { entrySelectors } from '../store/entrySlice'

export function useEntry(id, { suspendRefetch = false } = {}) {
  const entry = useSelector(state => entrySelectors.selectById(state, id))

  useEffect(() => {
    if (!id) return

    if (!entry) {
      getEntryById(id).catch(() => {})
      return
    }

    if (entry._stale && !suspendRefetch) {
      getEntryById(id, { force: true }).catch(() => {})
    }
  }, [entry, id, suspendRefetch])

  return entry ?? null
}

export function useEntryList(ids = null) {
  return useSelector((state) => {
    if (!Array.isArray(ids)) {
      return entrySelectors.selectAll(state)
    }

    return ids
      .map(id => entrySelectors.selectById(state, id))
      .filter(Boolean)
  })
}

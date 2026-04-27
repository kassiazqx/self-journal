import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'

import { getEntryById } from '../lib/entryRepository.js'
import { entrySelectors } from '../store/entrySlice.js'
import { createInitialEntryFetchState, resolveEntryResourceState } from './useEntryState.js'

export function useEntry(id, { suspendRefetch = false } = {}) {
  const entry = useSelector(state => entrySelectors.selectById(state, id))
  const [fetchState, setFetchState] = useState(() => createInitialEntryFetchState(id))
  const [retryNonce, setRetryNonce] = useState(0)

  const retry = useCallback(() => {
    if (!id) return
    setFetchState({ id, status: 'loading', error: null })
    setRetryNonce(value => value + 1)
  }, [id])

  useEffect(() => {
    if (!id) return

    const shouldFetchMissing = !entry && (fetchState.id !== id || fetchState.status === 'loading')
    const shouldRefreshStale = Boolean(entry?._stale) && !suspendRefetch

    if (!shouldFetchMissing && !shouldRefreshStale) {
      return
    }

    let cancelled = false

    ;(async () => {
      const result = await getEntryById(id, { force: shouldRefreshStale || retryNonce > 0 })
      if (cancelled) return

      if (result.error) {
        if (!entry) {
          setFetchState({ id, status: 'error', error: result.error })
        }
        return
      }

      if (result.data) {
        setFetchState({ id, status: 'ready', error: null })
        return
      }

      setFetchState({ id, status: 'missing', error: null })
    })()

    return () => {
      cancelled = true
    }
  }, [entry, fetchState.id, fetchState.status, id, retryNonce, suspendRefetch])

  return useMemo(
    () => ({
      ...resolveEntryResourceState({ id, entry, fetchState }),
      retry,
    }),
    [entry, fetchState, id, retry],
  )
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

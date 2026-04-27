/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { hasCompleteEntry } from '../lib/entrySnapshots'

const LOCAL_WRITE_PROTECTION_MS = 4000

const EntryCacheContext = createContext(null)

function shouldIgnoreIncomingEntry(currentRecord, nextEntry, source, now) {
  if (!nextEntry?.id || !hasCompleteEntry(nextEntry)) return true
  if (!currentRecord) return false
  if (source === 'remote' && currentRecord.protectedUntil > now) return true
  return false
}

export function EntryCacheProvider({ children }) {
  const [entryCache, setEntryCache] = useState(new Map())
  const entryCacheRef = useRef(entryCache)

  useEffect(() => {
    entryCacheRef.current = entryCache
  }, [entryCache])

  const storeEntry = useCallback((entry, { source = 'remote' } = {}) => {
    if (!entry?.id || !hasCompleteEntry(entry)) {
      return entryCacheRef.current.get(entry?.id)?.entry ?? entry ?? null
    }

    const now = Date.now()
    const currentRecord = entryCacheRef.current.get(entry.id)
    if (shouldIgnoreIncomingEntry(currentRecord, entry, source, now)) {
      return currentRecord?.entry ?? entry
    }

    const nextRecord = {
      entry,
      protectedUntil: source === 'local' ? now + LOCAL_WRITE_PROTECTION_MS : 0,
    }

    setEntryCache(prev => {
      const next = new Map(prev)
      next.set(entry.id, nextRecord)
      return next
    })

    return entry
  }, [])

  const storeEntries = useCallback((entries, { source = 'remote' } = {}) => {
    if (!Array.isArray(entries) || entries.length === 0) return

    setEntryCache(prev => {
      let next = prev
      const now = Date.now()

      entries.forEach(entry => {
        if (!entry?.id || !hasCompleteEntry(entry)) return
        const currentRecord = next.get(entry.id)
        if (shouldIgnoreIncomingEntry(currentRecord, entry, source, now)) return
        if (next === prev) next = new Map(prev)
        next.set(entry.id, {
          entry,
          protectedUntil: source === 'local' ? now + LOCAL_WRITE_PROTECTION_MS : 0,
        })
      })

      return next
    })
  }, [])

  const resolveEntry = useCallback((entry) => {
    if (!entry?.id) return entry ?? null
    return entryCache.get(entry.id)?.entry ?? entry
  }, [entryCache])

  const getCachedEntry = useCallback((id) => {
    if (!id) return null
    return entryCache.get(id)?.entry ?? null
  }, [entryCache])

  const isLocalEntryProtected = useCallback((id) => {
    if (!id) return false
    return (entryCache.get(id)?.protectedUntil ?? 0) > Date.now()
  }, [entryCache])

  const removeEntry = useCallback((id) => {
    if (!id) return
    setEntryCache(prev => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  const clearEntryCache = useCallback(() => {
    setEntryCache(new Map())
  }, [])

  const value = useMemo(() => ({
    clearEntryCache,
    getCachedEntry,
    isLocalEntryProtected,
    removeEntry,
    resolveEntry,
    storeEntries,
    storeEntry,
  }), [
    clearEntryCache,
    getCachedEntry,
    isLocalEntryProtected,
    removeEntry,
    resolveEntry,
    storeEntries,
    storeEntry,
  ])

  return (
    <EntryCacheContext.Provider value={value}>
      {children}
    </EntryCacheContext.Provider>
  )
}

export function useEntryCache() {
  const context = useContext(EntryCacheContext)
  if (!context) {
    throw new Error('useEntryCache must be used within EntryCacheProvider')
  }
  return context
}

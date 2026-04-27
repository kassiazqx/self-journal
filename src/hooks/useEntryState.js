export function createInitialEntryFetchState(id) {
  return {
    id: id ?? null,
    status: id ? 'loading' : 'idle',
    error: null,
  }
}

export function resolveEntryResourceState({ id, entry, fetchState }) {
  if (!id) {
    return { entry: null, status: 'idle', error: null }
  }

  if (entry) {
    return { entry, status: 'ready', error: null }
  }

  if (fetchState?.id !== id) {
    return { entry: null, status: 'loading', error: null }
  }

  if (fetchState.status === 'missing') {
    return { entry: null, status: 'missing', error: null }
  }

  if (fetchState.status === 'error') {
    return { entry: null, status: 'error', error: fetchState.error ?? null }
  }

  return { entry: null, status: 'loading', error: null }
}

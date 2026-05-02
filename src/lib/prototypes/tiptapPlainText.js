export const TIPTAP_JSON_PROTOTYPE_STORAGE_KEY = 'text-prototype-tiptap-json-v1'

export const TIPTAP_JSON_PROTOTYPE_DEFAULT_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

export function normalizeTiptapPrototypePlainText(raw) {
  return String(raw ?? '').replace(/\r\n?/g, '\n')
}

export function extractTiptapPrototypePlainText(editor) {
  return normalizeTiptapPrototypePlainText(
    editor.getText({ blockSeparator: '\n\n' })
  )
}

export function readStoredTiptapPrototypeDoc() {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(TIPTAP_JSON_PROTOTYPE_STORAGE_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeStoredTiptapPrototypeDoc(doc) {
  if (typeof window === 'undefined' || !doc) return
  window.localStorage.setItem(TIPTAP_JSON_PROTOTYPE_STORAGE_KEY, JSON.stringify(doc))
}

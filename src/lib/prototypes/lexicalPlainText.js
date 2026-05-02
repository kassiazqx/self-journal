export const LEXICAL_JSON_PROTOTYPE_STORAGE_KEY = 'text-prototype-lexical-json-v1'

export function normalizeLexicalPrototypePlainText(raw) {
  return String(raw ?? '').replace(/\r\n?/g, '\n')
}

export function extractLexicalPrototypePlainText(root) {
  return normalizeLexicalPrototypePlainText(
    root.getChildren().map(node => node.getTextContent()).join('\n\n')
  )
}

export function readStoredLexicalPrototypeDoc() {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(LEXICAL_JSON_PROTOTYPE_STORAGE_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeStoredLexicalPrototypeDoc(doc) {
  if (typeof window === 'undefined' || !doc) return
  window.localStorage.setItem(LEXICAL_JSON_PROTOTYPE_STORAGE_KEY, JSON.stringify(doc))
}

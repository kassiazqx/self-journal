function trimTrailingSlash(url) {
  return typeof url === 'string' ? url.replace(/\/+$/, '') : ''
}

export function getEmailRedirectTo({
  configuredUrl,
  currentOrigin = typeof window !== 'undefined' ? window.location.origin : undefined,
} = {}) {
  const envUrl = configuredUrl ?? import.meta.env?.VITE_APP_URL
  const explicitUrl = trimTrailingSlash(envUrl)
  if (explicitUrl) return explicitUrl

  const fallbackOrigin = trimTrailingSlash(currentOrigin)
  return fallbackOrigin || undefined
}

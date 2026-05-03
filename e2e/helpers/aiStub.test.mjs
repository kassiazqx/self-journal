import test from 'node:test'
import assert from 'node:assert/strict'

import { installAIStub } from './aiStub.ts'

function createFakePage() {
  const routes = []
  return {
    async route(pattern, handler) {
      routes.push({ pattern, handler })
    },
    getRoutes() {
      return routes
    },
  }
}

function createFakeRoute(url, bodyText = '') {
  const calls = []
  return {
    request() {
      return {
        url: () => url,
        postData: () => bodyText,
      }
    },
    async fulfill(payload) {
      calls.push({ type: 'fulfill', payload })
    },
    async continue() {
      calls.push({ type: 'continue' })
    },
    getCalls() {
      return calls
    },
  }
}

test('installAIStub 捕获 Gemini 请求并校验上下文', async () => {
  const page = createFakePage()
  const handle = await installAIStub(page, {
    provider: 'gemini',
    expectedContextSubstring: '老板开会',
  })

  const [{ handler }] = page.getRoutes()
  const route = createFakeRoute(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=test',
    '{"contents":[{"parts":[{"text":"老板开会"}]}]}',
  )

  await handler(route)
  await handle.assertRequestObserved()

  assert.equal(handle.getCapturedRequests().length, 1)
  assert.equal(route.getCalls()[0].type, 'fulfill')
})

test('installAIStub 放行非 AI 请求', async () => {
  const page = createFakePage()
  await installAIStub(page, {
    provider: 'gemini',
    expectedContextSubstring: '老板开会',
  })

  const [{ handler }] = page.getRoutes()
  const route = createFakeRoute('https://example.com/not-ai', '')

  await handler(route)

  assert.deepEqual(route.getCalls(), [{ type: 'continue' }])
})

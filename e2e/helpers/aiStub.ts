import { expect } from '@playwright/test'

function buildGeminiResponse(text) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
        },
      },
    ],
  }
}

function buildDeepseekResponse(text) {
  return {
    choices: [
      {
        message: {
          content: text,
        },
      },
    ],
  }
}

export async function installAIStub(page, options) {
  const provider = options.provider ?? 'gemini'
  const responseText = options.responseText ?? '这是自动化测试专用 AI 固定回复。'
  const capturedRequests = []

  const matchers = {
    gemini: /generativelanguage\.googleapis\.com\/v1beta\/models\/.*:generateContent/,
    deepseek: /api\.deepseek\.com\/chat\/completions/,
  }

  await page.route('https://**/*', async (route) => {
    const request = route.request()
    const url = request.url()
    const bodyText = request.postData() ?? ''

    if (matchers.gemini.test(url)) {
      capturedRequests.push({ provider: 'gemini', url, bodyText })
      expect(provider).toBe('gemini')
      expect(bodyText).toContain(options.expectedContextSubstring)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildGeminiResponse(responseText)),
      })
      return
    }

    if (matchers.deepseek.test(url)) {
      capturedRequests.push({ provider: 'deepseek', url, bodyText })
      expect(provider).toBe('deepseek')
      expect(bodyText).toContain(options.expectedContextSubstring)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildDeepseekResponse(responseText)),
      })
      return
    }

    await route.continue()
  })

  return {
    async assertRequestObserved() {
      expect(capturedRequests.length).toBeGreaterThan(0)
    },
    getCapturedRequests() {
      return capturedRequests
    },
  }
}

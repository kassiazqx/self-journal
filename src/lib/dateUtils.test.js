import test from 'node:test'
import assert from 'node:assert/strict'

import { getDayRange } from './dateUtils.js'

test('getDayRange returns [todayStart, tomorrowStart) for a given date', () => {
  const now = new Date(2026, 3, 27, 15, 26, 40)

  const { start, end } = getDayRange(now)

  assert.equal(start.getFullYear(), 2026)
  assert.equal(start.getMonth(), 3)
  assert.equal(start.getDate(), 27)
  assert.equal(start.getHours(), 0)
  assert.equal(start.getMinutes(), 0)
  assert.equal(start.getSeconds(), 0)
  assert.equal(start.getMilliseconds(), 0)

  assert.equal(end.getFullYear(), 2026)
  assert.equal(end.getMonth(), 3)
  assert.equal(end.getDate(), 28)
  assert.equal(end.getHours(), 0)
  assert.equal(end.getMinutes(), 0)
  assert.equal(end.getSeconds(), 0)
  assert.equal(end.getMilliseconds(), 0)
})

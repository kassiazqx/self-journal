import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getDesiredVisibleImageHeight,
  getHomePageEditorMinHeight,
  getHomePageVisibleImageRows,
  getImageRevealScrollTop,
  shouldRevealImageSection,
} from './homePageImageLayout.js'

test('no images keeps larger editor height', () => {
  assert.equal(getHomePageEditorMinHeight(0), '60vh')
})

test('1 to 3 images shrink editor to reveal about 1.5 rows sooner', () => {
  assert.equal(getHomePageEditorMinHeight(1), '18vh')
  assert.equal(getHomePageEditorMinHeight(3), '18vh')
})

test('4 to 5 images shrink editor a bit more for second row visibility', () => {
  assert.equal(getHomePageEditorMinHeight(4), '10vh')
  assert.equal(getHomePageEditorMinHeight(5), '10vh')
})

test('only increasing image count should auto reveal image section', () => {
  assert.equal(shouldRevealImageSection(0, 1), true)
  assert.equal(shouldRevealImageSection(1, 2), true)
  assert.equal(shouldRevealImageSection(2, 2), false)
  assert.equal(shouldRevealImageSection(2, 1), false)
})

test('one row images reveal exactly one row', () => {
  assert.equal(getHomePageVisibleImageRows(1), 1)
  assert.equal(getHomePageVisibleImageRows(3), 1)
  assert.equal(getDesiredVisibleImageHeight({
    imageCount: 3,
    gridHeight: 120,
  }), 120)
})

test('two row images reveal about one and a half rows', () => {
  assert.equal(getHomePageVisibleImageRows(4), 1.5)
  assert.equal(getHomePageVisibleImageRows(5), 1.5)
  assert.equal(getDesiredVisibleImageHeight({
    imageCount: 5,
    gridHeight: 243,
    rowGap: 3,
  }), 183)
})

test('image reveal scroll targets end-of-text plus controlled image amount', () => {
  const nextTop = getImageRevealScrollTop({
    currentScrollTop: 120,
    imageTop: 560,
    containerTop: 100,
    containerHeight: 620,
    desiredVisibleImageHeight: 183,
    bottomPadding: 24,
  })

  assert.equal(nextTop, 167)
})

test('image reveal scroll never goes below top of container', () => {
  const nextTop = getImageRevealScrollTop({
    currentScrollTop: 0,
    imageTop: 120,
    containerTop: 100,
    containerHeight: 620,
    desiredVisibleImageHeight: 183,
    bottomPadding: 24,
  })

  assert.equal(nextTop, 0)
})

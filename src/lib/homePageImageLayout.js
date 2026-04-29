export function getHomePageEditorMinHeight(imageCount) {
  if (imageCount >= 4) return '10vh'
  if (imageCount >= 1) return '18vh'
  return '60vh'
}

export function shouldRevealImageSection(previousCount, nextCount) {
  return nextCount > previousCount
}

export function getHomePageVisibleImageRows(imageCount) {
  if (imageCount <= 0) return 0
  if (imageCount <= 3) return 1
  return 1.5
}

export function getDesiredVisibleImageHeight({
  imageCount,
  gridHeight,
  rowGap = 3,
}) {
  if (imageCount <= 0) return 0

  const rowCount = Math.ceil(imageCount / 3)
  if (rowCount <= 1) return gridHeight

  const rowHeight = (gridHeight - (rowGap * (rowCount - 1))) / rowCount
  const visibleRows = getHomePageVisibleImageRows(imageCount)
  const visibleGapCount = Math.max(0, Math.ceil(visibleRows) - 1)

  return (rowHeight * visibleRows) + (rowGap * visibleGapCount)
}

export function getImageRevealScrollTop({
  currentScrollTop,
  imageTop,
  containerTop,
  containerHeight,
  desiredVisibleImageHeight,
  bottomPadding = 24,
  minTopOffset = 24,
}) {
  const targetImageTop = Math.max(
    minTopOffset,
    containerHeight - desiredVisibleImageHeight - bottomPadding
  )
  const rawTop = currentScrollTop + imageTop - (containerTop + targetImageTop)
  return Math.max(0, rawTop)
}

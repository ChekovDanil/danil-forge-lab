export function horizontalOverflowState(documentWidth, viewportWidth, tolerance = 1) {
  const width = Number(documentWidth);
  const viewport = Number(viewportWidth);
  if (!Number.isFinite(width) || !Number.isFinite(viewport) || viewport <= 0) throw new Error('Invalid layout measurement');
  return {
    pass: width <= viewport + tolerance,
    documentWidth: width,
    viewportWidth: viewport,
    overflow: Math.max(0, width - viewport)
  };
}

export function markHorizontalOverflow(documentElement, viewportWidth) {
  const result = horizontalOverflowState(documentElement.scrollWidth, viewportWidth);
  documentElement.dataset.horizontalOverflow = result.pass ? 'pass' : 'fail';
  return result;
}

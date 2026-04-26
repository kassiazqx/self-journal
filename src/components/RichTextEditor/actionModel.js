/**
 * 选区动作模型。
 * 当前菜单只消费 annotate 相关动作，但先把 clipboard/selectAll 能力放进模型，
 * 方便后续 Web / APK / iOS 共用同一套 action 判定。
 */
export function buildSelectionActionModel({ hasText, isEditable }) {
  return {
    annotate: hasText,
    copy: hasText,
    cut: hasText && isEditable,
    paste: isEditable,
    selectAll: isEditable,
  }
}

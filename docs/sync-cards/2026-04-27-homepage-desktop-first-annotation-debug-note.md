# 调试备忘：HomePage 桌面首次点击标注不生效

**状态：** 暂缓，不在本轮修  
**日期：** 2026-04-27  
**优先级：** 低到中  
**范围：** `HomePage` 桌面浏览器；移动端 / APK 主路径不受阻塞

---

## 现象

- 在电脑浏览器进入 `HomePage` 写作页
- 第一次选中文字后，点击高亮/标注，通常**第一次不生效**
- 第二次再选或再点，通常生效
- 当前判断：这是**桌面端体验问题**，不阻塞后续手机 APK 使用与发布

---

## 已有证据

用户提供的 DEV 日志：

- 进入页面时会出现：
  - `[RichTextEditor][desktop-selection] read-miss { stage: 'sync', anchorKey: 'root', focusKey: 'root' }`
  - `[RichTextEditor][desktop-selection] read-miss { stage: 'timeout-0', anchorKey: 'root', focusKey: 'root' }`
  - `[RichTextEditor][desktop-selection] read-miss { stage: 'raf', anchorKey: 'root', focusKey: 'root' }`
  - `[RichTextEditor][desktop-selection] read-giveup { stage: 'raf' }`
- 第一次**真实选中文字并松开鼠标**后，会出现：
  - `[RichTextEditor][desktop-selection] read-hit`

---

## 当前结论

这批日志说明：

1. 页面初次进入时那 4 条 `read-miss` 更像是**编辑器获得焦点时的折叠选区噪音**
2. 第一次真实选字后已经出现 `read-hit`，说明：
   - `MouseUpPlugin`
   - `selectionToOffsets()`
   - `SelectionSnapshot`
   这一段**已经拿到了有效选区**
3. 所以问题大概率**不在“第一次选不中”**，而在后半段：
   - 菜单点击后是否真正进入 `applyAnnotation`
   - `pendingRangeRef` 是否还在
   - `addAnnotation` 后 `annotations` state 是否已更新
   - `AnnotationTransformPlugin` 第一次是否没有真正把新标注渲染出来

一句话：更像是**第一次点击标注动作没真正落到 state / render**，不是第一次选区没建立。

---

## 暂不修的原因

- 当前产品主目标是手机 APK，不是桌面端发布
- 移动端主交互链仍是优先验证对象
- 这个问题若继续深挖，会碰共享编辑器标注链：
  - `RichTextEditor`
  - `useAnnotationInteraction`
  - `AnnotationMenu`
  - `useAnnotations`
  - `annotationTransform`
- 复杂度不算大修，但也**不是零风险顺手补丁**

当前判断：

- **复杂度：中等**
- **回归风险：中低**
- **不建议在主线收尾阶段顺手插入修**

---

## 下次如果要 debug，优先查哪里

不要再先折腾 `MouseUpPlugin`。优先查**标注动作后半段**：

1. `useAnnotationInteraction.js`
   - `openMenuFromSelectionSnapshot`
   - `showMenuForOffsets`
   - `applyAnnotation`
   - `handleHighlight` / `handleUnderline` / `handleBold`
2. `useAnnotations.js`
   - `addAnnotation`
   - 去重 guard 是否把第一次点击吃掉
3. `RichTextEditor/annotationTransform.js`
   - 第一次 state 更新后是否真的触发 transform
   - guard 是否把首轮渲染误判成“不需要 replace”
4. `HomePage.jsx` vs `EditEntryPage.jsx`
   - 对比两页第一次标注动作时，是否只有 `HomePage` 有额外 render / state 干扰

---

## 推荐的最小排查顺序

1. 只在 DEV 下补一轮一次性日志：
   - 菜单点击是否进入 `applyAnnotation`
   - `pendingRangeRef.current` 是否存在
   - `addAnnotation()` 是否收到正确 `start/end`
   - `annotations` 是否在第一次点击后变长
2. 对比：
   - `HomePage` 第一次点击
   - `EditEntryPage` 第一次点击
3. 如果 `annotations` 已变但 UI 没变：
   - 查 `AnnotationTransformPlugin`
4. 如果 `applyAnnotation` 根本没进：
   - 查菜单点击事件链和关闭时机

---

## 明确不要怎么修

- 不要把 DOM Range / offsets 计算重新塞回页面层
- 不要重新开启 Lexical 页面的全局 `selectionchange`
- 不要为桌面端问题影响移动端主链
- 不要在没证据前继续加更多 `setTimeout` / 重试层

---

## 给下个 session 的一句话

这不是“第一次选字失败”，更像“第一次点标注后状态/渲染没落下去”。下次从 `applyAnnotation -> addAnnotation -> annotationTransform` 这条链查，不要先回头改 `MouseUpPlugin`。

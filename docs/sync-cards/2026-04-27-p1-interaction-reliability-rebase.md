# 同步卡：P1 交互可靠性 rebase

**状态：** 手工矩阵基本完成，除 `HomePage` 桌面首次拖选菜单外均已通过  
**日期：** 2026-04-27  
**commit：** `a453c64`  
**分支：** `dev`

---

## 目标

按：

- `docs/superpowers/plans/2026-04-27-architecture-consolidation-plan.md`
- `docs/superpowers/plans/2026-04-27-p1-interaction-reliability-rebase.md`

只修 P1 交互链，不改 P0 数据层方向，不重开旧 cache，不把 DOM Range 计算放回页面层。

本轮目标是把 Lexical 编辑态的三条正式入口重新收口并稳住：

- desktop：`MouseUpPlugin(mouseup) -> readSelection -> handleSelectionSnapshot`
- touch：`AnnotationInteractionPlugin(SELECTION_CHANGE_COMMAND) -> createSelectionSnapshot`
- annotated click：`AnnotationInteractionPlugin(CLICK_COMMAND) -> createAnnotatedNodeSnapshot`

---

## 最终决策

### 1. 页面层继续只消费 snapshot

- `HomePage.jsx`
- `EditEntryPage.jsx`

两页继续只调用：

- `openMenuFromSelectionSnapshot(snapshot)`
- `openMenuFromAnnotationSnapshot(snapshot)`

没有把 `getSelection()` / `getBoundingClientRect()` / offsets 推导重新塞回页面层。

### 2. 桌面 mouseup 保留，但兜底改成有界重试

`RichTextEditor.jsx` 的 `MouseUpPlugin` 现在是：

- 先同步读取 Lexical selection
- 同步失败才过一次 `setTimeout(0)`
- 还失败再给一帧 `requestAnimationFrame`
- 到这里仍失败就停止，并只在 DEV 记日志

这样保留桌面既有 mouseup 路径，不回退到“无条件延迟后再读”，也不引入无限重试。

### 3. 诊断日志下沉到 editor / snapshot 层

- `RichTextEditor.jsx`
  - DEV 下输出 `[RichTextEditor][desktop-selection]`
  - 可区分 `sync / timeout-0 / raf` 哪一段命中或丢失
- `selectionSnapshot.js`
  - DEV 下输出 `[selectionSnapshot]`
  - 可区分 `offsets-missing / text-empty / annotation-offsets-missing`

后续若还有首次选字失败，优先看这两组日志，不回到页面层打补丁。

### 4. 只读页接口保持不动

`useAnnotationInteraction` 旧接口未删：

- `handleMouseUp`
- `handleTouchEnd`
- `openMenuForRange`

`RecordDetail` / `ReviewLetterDetail` / `ThreadDetailPage` 仍走原只读 DOM 路径，避免为修编辑态把只读页拖进同一时序问题。

---

## 实际改动文件

| 文件 | 本轮改动 |
|---|---|
| `src/components/RichTextEditor.jsx` | `MouseUpPlugin` 新增 DEV 日志 + `sync -> timeout-0 -> rAF` 有界重试 |
| `src/components/RichTextEditor/selectionSnapshot.js` | `SelectionSnapshot` / `AnnotationSnapshot` 构造失败时输出 DEV 诊断日志 |
| `docs/arch-context.md` | 更新 §3 真实结构、§4.54 规律、§6 日志 |

---

## 自动验证

已执行：

- `npm run lint`
- `npm run build`

结果：

- `lint` 通过
- `build` 通过
- 构建仍有 Vite 既有 chunk size warning（`index` 包体 > 500kB），不是本轮新增问题

---

## 手工验证结果

- 2026-04-28 已手测通过：桌面 Chrome `HomePage` 首次点高亮 / 下划线 / 加粗立刻生效
- 2026-04-28 已手测通过：桌面 Chrome `HomePage` 再次选同段文字时菜单稳定，不跳位
- 2026-04-28 已手测通过：桌面 Chrome `EditEntryPage` 首次拖选正常
- 2026-04-28 已手测通过：桌面 Chrome 点击已标注文字后菜单可重开
- 2026-04-28 已手测通过：移动端长按拖拽选字，停手后第一次操作即生效
- 2026-04-28 已手测通过：移动端拖动 handle 过程中不提前弹菜单
- 2026-04-28 已手测通过：保存链中写作保存不丢最新文本，编辑保存不丢标注
- 2026-04-28 已手测通过：`RecordDetail` / `ReviewLetterDetail` / `ThreadDetailPage` 只读页选字菜单无回归
- 仍保留一项低优先级残余问题：桌面 Chrome `HomePage` 首次拖选文字 -> 菜单弹出；当前不阻塞主线，先不继续调整

---

## 残余风险

- 当前只剩桌面 Chrome `HomePage` 首次拖选菜单这一项未纳入通过结论；优先级低，不阻塞当前主线
- DEV 诊断日志只在开发环境可见；如果后续要继续收口该问题，仍应先在本地 `npm run dev` 看日志，再决定下一步

---

## 给下个 session 的一句话

如果还出现“第一次选字或第一次高亮失败”，先看 DEV console：

- `[RichTextEditor][desktop-selection]`
- `[selectionSnapshot]`

判断丢在 selection、offset 还是 snapshot text，再改 editor/plugin 层；不要把 DOM Range 偏移计算重新放回页面层。

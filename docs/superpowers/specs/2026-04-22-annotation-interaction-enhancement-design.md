# 标注交互增强设计（Part 2.5）

**日期：** 2026-04-22
**状态：** ✅ 设计确认，待实现（在 Part 1 & 2 完成后执行）
**前置：** 依赖 Part 1（基础层）和 Part 2（集成层）已实现

---

## 一、背景

Part 2 的标注菜单只支持「新增标注」。本 spec 补充三条交互规则，使标注系统支持取消、切换、和通过单击已有标注唤起菜单。

---

## 二、三条交互规则

### Rule 1：选区与已有标注重叠 → 菜单加「取消」按钮

**触发条件：** 用户选中的文字范围与任意已有标注存在重叠（哪怕只有一个字符）

**菜单变化：** 在 B / U / ▌ / 四色点之后，追加一个「✕」或「取消」按钮

**点击取消的行为（剪切语义）：**
- 对所有与选区重叠的标注，在选区边界处剪切
- 选区内的部分：移除
- 选区外的部分：保留（自动生成新的标注条目）

**示例：**
```
原始：{ bold, start: 0, end: 5 }  →  "12345" 全部加粗
选区：start: 2, end: 4            →  选中 "34"
点取消后：
  { bold, start: 0, end: 2 }     →  "12" 加粗保留
  { bold, start: 4, end: 5 }     →  "5" 加粗保留
  "34" 的加粗消失
```

**多条标注重叠时：** 对所有重叠的标注条目分别执行剪切，类型不同的也一起处理。

**与 Rule 2 的区别：**
- Rule 2：精细——只取消特定类型（点 B 只取消粗体）
- Rule 1 取消：核弹——取消选区内所有类型的所有标注

---

### Rule 2：选区全部被同类型覆盖 → 点击该类型 = 取消（toggle）

**触发条件：** 用户选区内的每一个字符，都被至少一条该类型的标注覆盖

**行为：** 点击对应类型按钮，对该类型执行剪切语义（同 Rule 1，但只处理该类型）

**示例：**
```
"12345" 全部加粗
用户选中 "34"
→ "34" 完全被 bold 覆盖
→ 点击 B → 取消 "34" 的 bold
→ 结果：{ bold, 0, 2 } + { bold, 4, 5 }
```

**选区只有部分被覆盖时：** 正常新增标注（不 toggle）

**多条标注覆盖同一选区时（同类型）：** 同样视为"全部覆盖"，执行 toggle 取消

---

### Rule 3：单击已有标注区域 → 唤起菜单

**触发条件：** 用户单击（不拖动选文字）在某个已有标注的渲染区域内

**「整条」的定义：** 取点击位置所有覆盖标注的 start/end 并集（最大范围）

**示例：**
```
标注 A：{ bold, start: 0, end: 3 }     →  "123"
标注 B：{ highlight, start: 2, end: 5 } →  "345"
用户单击 "3"（两者重叠处）
→ 并集 = { start: 0, end: 5 }          →  "12345"
→ 菜单弹出，视为选中了 "12345"
→ Rule 1 和 Rule 2 在此虚拟选区上正常生效
```

**Rule 2 在 Rule 3 下的行为：**
- 虚拟选区 "12345" 内，bold 完全覆盖 "123"，不完全覆盖 "12345"
- 点 B → bold 不是 toggle 状态，是新增（因为 "45" 没有 bold）
- 点「取消」→ Rule 1 剪切所有类型，"12345" 内所有标注清空

**实现注意：**
- 单击（无选区）和拖动选区是两条独立事件路径
- 单击路径：在已标注的 Segment 组件上挂 `onClick`，不经过 `getSelection()`
- 拖动选区路径：现有 `touchend` + `setTimeout(0)` + `getSelection()` 逻辑不变
- 两者不混用

---

## 三、剪切操作的数据逻辑

所有「剪切」操作（Rule 1 取消、Rule 2 toggle、Rule 3 + 取消）共用同一个函数：

```js
// 将 annotations 数组中与 [clipStart, clipEnd) 重叠的条目剪切掉该区间
// typesToClip: 'all' | Set<string>（指定类型）
function clipAnnotations(annotations, clipStart, clipEnd, typesToClip = 'all') {
  const result = []
  for (const a of annotations) {
    const shouldClip = typesToClip === 'all' || typesToClip.has(a.type)
    if (!shouldClip || a.end <= clipStart || a.start >= clipEnd) {
      result.push(a)   // 不重叠或不是目标类型，原样保留
      continue
    }
    // 重叠且是目标类型：剪切
    if (a.start < clipStart) result.push({ ...a, end: clipStart })   // 左侧残留
    if (a.end > clipEnd)   result.push({ ...a, start: clipEnd })     // 右侧残留
    // 中间被剪掉的部分不加入 result
  }
  return result
}
```

`useAnnotations` 新增导出 `clipAnnotations(clipStart, clipEnd, typesToClip)` 方法，内部调用上述逻辑并更新 state + dirty。

---

## 四、检测「选区是否被某类型完全覆盖」的逻辑

```js
// 判断 [selStart, selEnd) 区间内每个字符是否都被 type 类型的标注覆盖
function isFullyCovered(annotations, selStart, selEnd, type) {
  const ofType = annotations.filter(a => a.type === type && a.end > selStart && a.start < selEnd)
  if (!ofType.length) return false

  // 构建覆盖区间合并，检查是否连续覆盖 [selStart, selEnd)
  const sorted = [...ofType].sort((a, b) => a.start - b.start)
  let covered = selStart
  for (const a of sorted) {
    if (a.start > covered) return false   // 有间隙
    covered = Math.max(covered, a.end)
    if (covered >= selEnd) return true
  }
  return covered >= selEnd
}
```

---

## 五、AnnotationMenu 变化

新增 `showCancel` prop（boolean），为 true 时在菜单末尾渲染「✕」按钮，触发 `onCancel` 回调。

```
┌─────────────────────────────────────────────┐
│  B  │  U  │  ▌  │  🟤  │  🌸  │  🌿  │  🔵  │  ✕  │
└─────────────────────────────────────────────┘
```

`showCancel` 由父组件传入，当 `pendingRange` 与任意 annotation 重叠时为 true。

---

## 六、成功标准

1. 选中已有标注的一部分 → 菜单出现「✕」→ 点击 → 选区内标注消失，两侧保留
2. 选中完全加粗的文字 → 点 B → 该段加粗消失（toggle）
3. 单击已高亮文字 → 菜单弹出 → 可取消或追加其他类型标注
4. AI 预标注和用户标注行为一致（都是同一 annotations 数组，无区别处理）
5. 取消操作触发 dirty → debounce 1.5 秒保存到 DB

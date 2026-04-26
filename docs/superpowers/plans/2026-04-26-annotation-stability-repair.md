# 标注稳定性修复计划（修订版）

> 目的：修复标注系统两个核心问题，用最轻量的方案。

**Goal:** 修复当前标注系统两类问题：  
1. `HomePage` 桌面编辑页首次选字不稳定  
2. `RecordDetail` 保存后返回再进仍闪旧数据

**Architecture Decision:**  
- 不引入 RTK，用轻量 cache + 统一清理函数
- 选区处理：桌面保持 mouseup 路径，手机用 selectionchange + 300ms 防抖，只撤 HomePage 实验桥接
- 保留桌面代码（开发和回归测试入口）

**Non-Goals（本轮不做）:**  
- 不做原生系统栏完美压制  
- 不做 `copy/cut/paste/selectAll` 菜单 UI  
- 不引入 Redux/RTK

---

## 当前问题拆解

### A. `HomePage` 桌面编辑页不稳定

**现象：**
- `EditEntryPage` 桌面首次选字已恢复
- `HomePage` 桌面仍不弹菜单，或极不稳定

**根因：**
- `HomePage` 当前仍在吃"新 snapshot 桥接层 + 旧逻辑混用"副作用
- 继续叠兜底只会让时序更脆

**解决方案：**
- 撤掉 HomePage 的实验性桥接层
- 桌面恢复 mouseup 路径（EditEntryPage 已证明稳定）
- 手机保持 selectionchange + 300ms 防抖

### B. `RecordDetail` 返回再进先旧后新

**现象：**
- 保存后返回列表，再点进详情
- 先显示旧状态，约 1 秒后才变成新状态

**根因：**
- RecordsPage 的 `allEntries` state 没有同步更新
- 详情页收到的 `initialEntry` 是旧的 state
- 详情页只能补拉最新数据

**解决方案：**
- MainLayout 维护轻量 cache（Map）
- RecordDetail 保存后立即更新 cache
- RecordsPage 渲染时 merge cache

---

## 目标结构

### 1. 选区层：桌面 mouseup，手机 selectionchange

```javascript
// 桌面路径：mouseup 直通（EditEntryPage 已证明稳定）
editor.registerCommand(MOUSE_UP, () => {
  const selection = $getSelection()
  onRangeSelect(selection)  // 立即弹菜单
})

// 手机路径：selectionchange + 300ms 防抖
editor.registerCommand(SELECTION_CHANGE, () => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    const selection = $getSelection()
    onRangeSelect(selection)
  }, 300)
})
```

**优点：**
- 桌面保持已验证的稳定路径
- 避免 keyboard/programmatic/composition 干扰
- 手机支持长按拖拽

### 2. 数据层：轻量 cache + 统一清理函数

```javascript
// MainLayout.jsx
const [entryCache, setEntryCache] = useState(new Map())

// 统一的更新函数
const updateEntryCache = useCallback((id, fields) => {
  setEntryCache(prev => new Map(prev).set(id, { ...prev.get(id), ...fields }))
}, [])

// 统一的删除函数
const deleteFromCache = useCallback((id) => {
  setEntryCache(prev => {
    const next = new Map(prev)
    next.delete(id)
    return next
  })
}, [])

// 统一的清空函数
const clearCache = useCallback(() => {
  setEntryCache(new Map())
}, [])

// 通过 Context 传递
<CacheContext.Provider value={{ entryCache, updateEntryCache, deleteFromCache, clearCache }}>
  {children}
</CacheContext.Provider>
```

**使用时：**
```javascript
// RecordDetail.jsx
const { updateEntryCache } = useContext(CacheContext)

async function handleSave() {
  await updateEntry({ id, fields: { annotations: newAnnotations } })
  updateEntryCache(id, { annotations: newAnnotations })  // 1 行代码
}

// RecordsPage.jsx
const { entryCache, deleteFromCache } = useContext(CacheContext)

// 渲染时 merge
const displayEntry = { ...entry, ...entryCache.get(entry.id) }

// 删除时清理
async function handleDelete(id) {
  await deleteEntry(id)
  deleteFromCache(id)  // 1 行代码
}
```

**优点：**
- 零依赖
- 使用时只需要 1 行代码
- 不需要理解 Redux 概念
- 如果忘了调用，影响范围小

---

## 文件改动地图

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/contexts/CacheContext.jsx` | 新建 | entryCache + 三个统一函数 |
| `src/components/MainLayout.jsx` | 修改 | 包 CacheContext.Provider |
| `src/components/RichTextEditor/AnnotationInteractionPlugin.js` | 修改 | 统一用 selectionchange + 自适应防抖 |
| `src/pages/HomePage.jsx` | 修改 | 统一选区处理，删除实验性桥接层 |
| `src/components/RecordDetail.jsx` | 修改 | 保存后调 updateEntryCache |
| `src/pages/RecordsPage.jsx` | 修改 | 渲染时 merge cache，删除时调 deleteFromCache |
| `src/pages/ReviewLetterDetail.jsx` | 修改 | 保存后调 updateEntryCache（如果有标注） |
| `src/pages/ThreadDetailPage.jsx` | 修改 | 保存后调 updateEntryCache（如果有标注） |

---

## 实施顺序

### Task 1：建立轻量 cache 基础设施

- [ ] 新建 `src/contexts/CacheContext.jsx`
- [ ] MainLayout 包 `CacheContext.Provider`
- [ ] 导出 `useCacheContext` hook

**验收：**
- 其他组件可以 `import { useCacheContext } from '../contexts/CacheContext'`

### Task 2：RecordDetail 接入 cache

- [ ] RecordDetail 保存成功后调 `updateEntryCache`
- [ ] 包括：annotations / emotions / content / category_tags 等所有可编辑字段

**验收：**
- 保存后返回列表，cache 里有最新数据

### Task 3：RecordsPage 接入 cache

- [ ] 渲染 EntryCard 时 merge cache
- [ ] 删除时调 `deleteFromCache`
- [ ] 刷新时调 `clearCache`

**验收：**
- 保存后返回列表，再点进详情，不再"先旧后新"

### Task 4：修复 HomePage 桌面选区不稳定

**步骤 1：验证根因**
- [ ] 在 `useAnnotationInteraction.showMenuForOffsets`（第 93 行）加日志
- [ ] 记录 `start`, `end`, `rawText.length`
- [ ] 在 HomePage 桌面测试，看是否触发 `end > rawText.length`

**步骤 2：根据验证结果修复**

如果是 `end > rawText.length`（content state 同步慢）：
- [ ] 方案 A：加快 HomePage 的 content 同步
- [ ] 方案 B：让 showMenuForOffsets 容忍短暂失步（用 setTimeout 重试一次）

如果不是：
- [ ] HomePage 桌面恢复直连 `onRangeSelect → openMenuAt`
- [ ] 跳过 SelectionSnapshot 桥接层

**验收：**
- HomePage 桌面首次选字稳定弹菜单
- EditEntryPage 桌面不回归
- 移动端长按拖拽仍正常

### Task 5：其他详情页接入 cache（可选）

- [ ] ReviewLetterDetail 保存后调 updateEntryCache
- [ ] ThreadDetailPage 保存后调 updateEntryCache

**验收：**
- 所有详情页保存后返回列表，不再"先旧后新"

---

## 需要架构确认的问题

1. **cache 的清理策略？**
   - 方案 A：用户刷新列表时清空整个 cache
   - 方案 B：用户删除 entry 时只删除对应的 cache
   - 方案 C：cache 永不清空（依赖补拉覆盖）

2. **cache 的范围？**
   - 只缓存 annotations？
   - 还是缓存所有可编辑字段（emotions / content / category_tags 等）？

3. **桌面代码的保留策略？**
   - 现在保留（开发提效）
   - 打包 APK 后删除（可选）

---

## 验收清单

- [ ] `HomePage` 桌面首次选字稳定弹菜单
- [ ] `EditEntryPage` 桌面首次选字不回归
- [ ] 手机长按拖拽仍正常
- [ ] `RecordDetail` 标记后返回列表再进，不再闪旧状态
- [ ] `RecordDetail` 修改情绪后返回列表再进，不再闪旧状态
- [ ] `ReviewLetterDetail` 不回归
- [ ] `ThreadDetailPage` 不回归
- [ ] `lint` 过
- [ ] `build` 过

---

## 与原 plan 的主要变更

1. **不引入 RTK** → 用轻量 cache + 统一清理函数
2. **不做双轨** → 统一用 selectionchange + 自适应防抖
3. **明确桌面代码保留策略** → 现在保留，打包 APK 后可选删除
4. **简化实施步骤** → 从 4 个 Task 减少到 5 个 Task，但更清晰

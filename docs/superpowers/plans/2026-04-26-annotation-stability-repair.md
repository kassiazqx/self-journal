# 标注稳定性修复计划（修订版）

> 目的：修复标注系统两个核心问题，用最轻量的方案。

**Goal:** 修复当前标注系统两类问题：  
1. `HomePage` 桌面编辑页首次选字不稳定  
2. `RecordDetail` 保存后返回再进仍闪旧数据

**Architecture Decision:**  
- 不引入 RTK，用轻量 entry store / cache，但只存 `journal_entries` 的完整快照
- cache 不做 `Partial<Entry>` overlay，不在刷新时清空
- 本地刚保存的 entry 进入短暂保护窗口，避免补拉旧值立刻盖回
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
- MainLayout 上方维护轻量 entry store（Map）
- `RecordDetail / EditEntryPage` 保存成功后立即写入完整快照
- `RecordsPage` 渲染、排序、打开详情/编辑时都优先吃 store

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

### 2. 数据层：轻量 entry store + 完整快照

```javascript
// EntryCacheContext.jsx
const [entryCache, setEntryCache] = useState(new Map())

// 只接收完整 entry
const storeEntry = useCallback((entry, { source = 'remote' } = {}) => {
  if (!hasCompleteEntry(entry)) return
  setEntryCache(prev => new Map(prev).set(entry.id, {
    entry,
    protectedUntil: source === 'local' ? Date.now() + 4000 : 0,
  }))
}, [])

const resolveEntry = (entry) => entryCache.get(entry.id)?.entry ?? entry
```

**使用时：**
```javascript
// RecordDetail.jsx
const { storeEntry } = useEntryCache()

async function handleSave() {
  await updateEntry({ id, fields: { annotations: newAnnotations } })
  storeEntry({ ...entry, annotations: newAnnotations }, { source: 'local' })
}

// RecordsPage.jsx
const { resolveEntry, removeEntry } = useEntryCache()

const displayEntry = resolveEntry(entry)

// 删除时清理
async function handleDelete(id) {
  await deleteEntry(id)
  removeEntry(id)
}
```

**优点：**
- 零依赖
- 只收口 `journal_entries`
- 既能立即同步，又能避免远端旧值瞬时回盖
- 比 `Partial<Entry>` overlay 更不容易误判“完整 entry”

---

## 文件改动地图

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/contexts/EntryCacheContext.jsx` | 新建 | 完整 entry store + 本地写入保护窗口 |
| `src/lib/entrySnapshots.js` | 新建 | 完整 entry 字段定义 + 完整性判断 |
| `src/components/MainLayout.jsx` | 修改 | 包 `EntryCacheProvider`，统一 resolve entry |
| `src/components/RichTextEditor/AnnotationInteractionPlugin.js` | 修改 | 统一用 selectionchange + 自适应防抖 |
| `src/pages/HomePage.jsx` | 修改 | 统一选区处理，删除实验性桥接层 |
| `src/components/RecordDetail.jsx` | 修改 | 本地保存后写完整快照，补拉时遵守保护窗口 |
| `src/pages/RecordsPage.jsx` | 修改 | 所有查询统一完整字段，排序/分组按 resolve 后结果走 |
| `src/pages/EditEntryPage.jsx` | 修改 | 保存完成后写完整快照 |

---

## 实施顺序

### Task 1：建立 entry store 基础设施

- [ ] 新建 `src/contexts/EntryCacheContext.jsx`
- [ ] 新建 `src/lib/entrySnapshots.js`
- [ ] MainLayout 包 `EntryCacheProvider`
- [ ] 导出 `useEntryCache` hook

**验收：**
- 其他组件可以统一判断“是不是完整 entry”
- 所有入口都能用同一套 `resolveEntry / storeEntry / removeEntry`

### Task 2：RecordDetail 接入 cache

- [ ] RecordDetail 所有本地保存都写回完整快照
- [ ] 刚保存后的短时间内，不让补拉旧值盖回本地
- [ ] 保存失败时回拉远端完整 entry 纠偏

**验收：**
- 保存后返回列表，再进详情不闪旧
- 详情页自己不会把旧补拉值盖回新状态

### Task 3：RecordsPage 接入 cache

- [ ] `load / refresh / loadMore / filter` 统一查完整字段
- [ ] 渲染、排序、分组都基于 `resolveEntry(entry)` 之后的数据
- [ ] 删除时调 `removeEntry`
- [ ] 刷新时不清空 cache，由完整补拉接管旧值

**验收：**
- 保存后返回列表，再点进详情，不再"先旧后新"
- 修改 `created_at` 后，列表日期分组和顺序也立即正确

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

## 需要架构确认的问题

1. **cache 的清理策略？**
   - 用户删除 entry 时只删对应 id
   - 用户退出登录时清空整个 cache
   - 用户刷新列表时不清空，交给完整补拉接管旧值

2. **cache 的范围？**
   - 只管 `journal_entries`
   - 只存完整快照，不存字段碎片
   - `ReviewLetterDetail / ThreadDetailPage` 本轮明确不进

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
- [ ] `EditEntryPage` 保存后返回列表，再进详情不闪旧状态
- [ ] 修改记录时间后，列表分组和顺序立即正确
- [ ] `lint` 过
- [ ] `build` 过

---

## 与原 plan 的主要变更

1. **不引入 RTK** → 用轻量 entry store，但只存完整快照
2. **不做双轨** → 统一用 selectionchange + 自适应防抖
3. **修正 cache 生命周期** → 刷新不清空，本地写入进入短暂保护窗口
4. **明确排除范围** → `ReviewLetterDetail / ThreadDetailPage` 本轮不接入
5. **补上两个实现级风险** → 完整 entry 判断统一化；列表排序/分组按 merge 后 `created_at` 走

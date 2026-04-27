# cache vs RTK 决策交接文档

> 用途：给新 session / 新同事快速接手 `cache vs Redux Toolkit (RTK)` 这条决策线。  
> 重点不是立刻写代码，而是先判断当前产品范围下，是否值得把列表/详情/编辑页共享数据正式收口到 RTK。

---

## 1. 可直接复制到新 session 的 prompt

```md
请你只讨论 self-journal 项目里 `cache vs RTK` 这条架构决策，不要先改代码。

背景：
- 当前主要痛点是 `journal_entries` 在 `RecordsPage -> RecordDetail -> EditEntryPage -> 返回列表/再进详情` 这条链路里，保存后会“先看到旧数据，过 1 秒再变新”。
- 之前已经确认过一个直接 bug：`RecordDetail` 曾经用 `entry.user_id` 保存，导致 `user_id=undefined`，这个点已修。
- 现在剩余核心问题是：列表页、详情页、编辑页没有共享同一份最新 entry 数据，导致旧快照被继续传递。
- 用户默认偏好状态管理是 RTK，但这次也担心 RTK 代码和维护成本大于轻量 cache。
- 产品范围目前主要围绕 `journal_entries`，关注字段大致是：
  - `content`
  - `annotations`
  - `emotions` / `emotion_display`
  - `category_tags`
- `ReviewLetterDetail` 和 `ThreadDetailPage` 也有各自的标注保存逻辑，但暂时不一定要并入同一套共享状态。
- 产品最终目标是手机 APK / iOS app，但当前 web 版仍是主要开发和回归环境。

请你回答这些问题：
1. 在当前产品范围下，`journal_entries` 这一条链路更适合轻量 cache 还是 RTK？
2. 如果先不上 RTK，轻量 cache 的最小边界应该卡在哪里，哪些页面/字段可以进，哪些先不要进？
3. 如果上 RTK，最小落地范围应该是什么，如何避免“一上来全站 Redux 化”？
4. 哪个方案当前实现成本更低？哪个方案 1-2 个月后的维护风险更低？
5. 哪些信号一出现，就说明应该从 cache 升级到 RTK？

请先读这些文件和文档，再给判断：
- docs/superpowers/plans/2026-04-26-annotation-stability-repair.md
- docs/superpowers/plans/2026-04-26-cache-vs-rtk-handoff.md
- src/components/MainLayout.jsx
- src/pages/RecordsPage.jsx
- src/components/RecordDetail.jsx
- src/pages/EditEntryPage.jsx
- src/components/ReviewLetterDetail.jsx
- src/pages/ThreadDetailPage.jsx

输出要求：
- 先给结论，再给原因
- 必须按“当前适合什么 + 为什么 + 边界 + 风险 + 未来升级条件”来回答
- 不要泛泛而谈 Redux 优缺点，要紧扣这个项目现在的数据流
```

---

## 2. 当前问题到底是什么

这条讨论只针对“共享业务数据一致性”，不是在讨论：

- 标注选区交互
- copy / cut / paste / selectAll
- APK / iOS 原生菜单压制
- editor plugin 交互层

`cache vs RTK` 要解决的问题只有一个：

**同一条 `journal_entries` 数据，在列表页、详情页、编辑页之间，保存后能不能立即看到一致的新值，而不是继续传旧快照。**

当前最明显现象：

1. 在 `RecordDetail` 标记或修改后返回列表，再点进详情。
2. 先看到旧内容 / 旧标注。
3. 约 1 秒后才补拉成新状态。

这说明当前系统更像：

- 页面各自持有 state
- 页面之间传快照
- 进入详情后再补拉最新数据

而不是：

- 多个页面共享同一个最新 source of truth

---

## 3. 当前项目的状态管理现状

**已有的状态层：**
- `AuthContext`：用户登录状态
- `MainLayout` 的 local state：导航、布局状态
- 各页面的 local state：表单、列表数据

**数据流：**
- UI 读取 → 页面 state
- UI 更新 → 页面 setState → db.js → Supabase
- 跨页面传递 → props / URL params

**问题：**
- 没有跨页面的数据缓存层
- 保存后返回列表，列表 state 不会自动更新
- 详情页只能补拉最新数据，导致"先旧后新"闪烁

---

## 3.5 当前代码流长什么样

### 3.1 MainLayout 负责“传屏幕参数”，不是共享数据真源

看这里：

- [src/components/MainLayout.jsx:121](../../../src/components/MainLayout.jsx#L121)
- [src/components/MainLayout.jsx:151](../../../src/components/MainLayout.jsx#L151)
- [src/components/MainLayout.jsx:187](../../../src/components/MainLayout.jsx#L187)

关键点：

- `handleOpenDetail(entry)` 直接把当时的 `entry` 推进 `screens`
- `handleEditEntry(entry)` 也是直接传 entry
- `RecordDetail` 收到的是 `screen.entry`
- `EditEntryPage` 收到的也是旧快照 entry

这意味着：

- 如果 `RecordsPage` 内存里的 `allEntries` 没更新
- 后面 push 出去的 detail / edit screen 也继续吃旧值

### 3.2 RecordsPage 自己维护 `allEntries`

看这里：

- [src/pages/RecordsPage.jsx:156](../../../src/pages/RecordsPage.jsx#L156)
- [src/pages/RecordsPage.jsx:204](../../../src/pages/RecordsPage.jsx#L204)
- [src/pages/RecordsPage.jsx:209](../../../src/pages/RecordsPage.jsx#L209)
- [src/pages/RecordsPage.jsx:245](../../../src/pages/RecordsPage.jsx#L245)

关键点：

- `allEntries` 只在 `load/refresh` 里整体重拉
- `items` 直接基于 `allEntries`
- 没有“保存成功后立即覆盖某一条 entry”的共享层

所以现在的列表刷新机制更像：

- 先靠旧内存渲染
- 再靠下一轮 DB refresh 修正

### 3.3 RecordDetail 现在是“本地 state + 进页补拉”

看这里：

- [src/components/RecordDetail.jsx:103](../../../src/components/RecordDetail.jsx#L103)
- [src/components/RecordDetail.jsx:166](../../../src/components/RecordDetail.jsx#L166)
- [src/components/RecordDetail.jsx:201](../../../src/components/RecordDetail.jsx#L201)
- [src/components/RecordDetail.jsx:217](../../../src/components/RecordDetail.jsx#L217)

关键点：

- `const [entry, setEntry] = useState(initialEntry)`
- 标注保存走 `updateEntry(...)`
- 进入详情后又会补拉完整 entry / 补拉最新 annotations

这能保证“最终一致”，但不能保证“进入就一致”。

### 3.4 EditEntryPage 保存成功后，主要靠 refreshToken 和 refreshKey 触发页面重拉

看这里：

- [src/pages/EditEntryPage.jsx:182](../../../src/pages/EditEntryPage.jsx#L182)
- [src/components/MainLayout.jsx:156](../../../src/components/MainLayout.jsx#L156)

关键点：

- `EditEntryPage` 保存后直接写 DB
- `MainLayout.handleEditSaved()` 通过 `detailRefreshToken + refreshKey` 让 detail / list 重新拉
- 仍然偏向“靠刷新纠正”，不是“本地共享状态立即同步”

### 3.5 ReviewLetterDetail / ThreadDetailPage 是另一类实体

看这里：

- [src/components/ReviewLetterDetail.jsx:20](../../../src/components/ReviewLetterDetail.jsx#L20)
- [src/pages/ThreadDetailPage.jsx:31](../../../src/pages/ThreadDetailPage.jsx#L31)

关键点：

- `ReviewLetterDetail` 保存的是 `review_letters.annotations`
- `ThreadDetailPage` 保存的是 `threads.current_state_annotations`
- 它们不是 `journal_entries`
- 如果把这两类实体也并进同一套轻量 cache，复杂度会明显上涨

---

## 4. 当前讨论里的两个方案

### 4.1 方案 A：轻量 cache 的具体实现

**数据结构：**
```javascript
// Map<entryId, CompleteEntry>
entryCache = new Map([
  ['123', { id: '123', content: '...', annotations: [...], people_involved: [], ... }],
  ['456', { id: '456', content: '...', annotations: [...], people_involved: [], ... }]
])
```

**读取规则：**
```javascript
// 优先使用 cache 中的完整快照，不做字段级 overlay
const displayEntry = entryCache.get(entry.id) ?? entry
```

**清理时机：**
- 用户删除 entry → `removeEntry(id)`
- 用户退出登录 → `clearCache()`
- 用户刷新列表 → 不清空
- 完整补拉返回后 → 允许用补拉值接管旧 cache

**失效策略：**
- 不做全局 TTL
- 对“刚本地保存”的 entry 加一个短暂保护窗口，避免补拉旧值立刻盖回
- 保护窗口结束后，完整补拉可以接管 cache

---

### 4.2 方案 B：RTK 的具体集成成本

**新增文件：**
- `src/store/index.js`（store 配置，~30 行）
- `src/store/entriesSlice.js`（entries 的 slice，~80 行）

**修改文件：**
- `src/main.jsx` 或 `src/App.jsx`（包 Provider，+3 行）
- `src/pages/RecordsPage.jsx`（改用 useSelector，~10 行改动）
- `src/components/RecordDetail.jsx`（改用 dispatch，~5 行改动）
- `src/pages/EditEntryPage.jsx`（改用 dispatch，~5 行改动）

**新增依赖：**
- `@reduxjs/toolkit`（~450KB gzipped）
- `react-redux`（~50KB gzipped）

**学习成本：**
- 理解 Redux 概念（store / slice / reducer / action / selector）
- 理解 RTK 的 createSlice / createAsyncThunk
- 理解 Immer（RTK 内置的不可变更新）

**预估工作量：**
- 初次集成：4-6 小时
- 后续加新 entity：1-2 小时/个

---

### 4.3 两个方案的详细对比

### 方案 A：轻量 cache / shared entry store

思路：

- 不引入 Redux/RTK
- 在 `MainLayout` 或 Context 里维护一个 `Map<entryId, completeEntry>`
- `RecordDetail` / `EditEntryPage` 保存成功后立即写入完整快照
- `RecordsPage` 渲染、排序、`onOpenDetail`、`onEdit` 时都先 resolve cache

更像：

- `remoteEntries from DB`
- `sharedEntrySnapshots in cache`
- 页面优先读取当前 session 里最新完整 entry

适合前提：

- 只先解决 `journal_entries`
- 只覆盖少数几个页面
- 可以接受“局部共享 entry store”，但不想现在就引入 Redux

### 方案 B：RTK

思路：

- 引入 `@reduxjs/toolkit` + `react-redux`
- 建 `entriesSlice`
- 把列表页、详情页、编辑页都改成读共享 store
- 保存成功后 dispatch 更新对应 entry

更像：

- `journal_entries` 正式有统一 client-side source of truth
- 页面不再互相传半旧快照作为主数据源

适合前提：

- 很快会扩到多实体或更多页面即时联动
- 需要明确的 reducer / action / selector 规则
- 团队愿意接受初始接线成本

---

## 5. 当前倾向判断

### 当前更倾向：先做轻量 cache

原因：

1. 现在最痛的只有 `journal_entries` 这条链。
2. 主要是 `RecordsPage / RecordDetail / EditEntryPage / MainLayout` 之间旧快照传递。
3. 如果只收这一个实体族，`Context + Map` 的 entry store 成本明显小于 RTK。
4. 产品范围目前没有强到必须把 `review_letters`、`threads` 也纳入统一共享状态。

### 但必须卡死边界

否则“轻量 cache”会慢慢长成“手写 Redux”。

建议边界：

- **只管实体：** `journal_entries`
- **只管页面：** `MainLayout / RecordsPage / RecordDetail / EditEntryPage`
- **只管快照：** 完整 entry，不做字段碎片 cache
- **先不管：**
  - `ReviewLetterDetail`
  - `ThreadDetailPage`
  - 其它非 `journal_entries` 表

---

## 6. 为什么不是现在就直接 RTK

不是因为 RTK 不好。  
而是因为当前 scope 下，它可能比问题本身更重。

当前项目还没有：

- `@reduxjs/toolkit`
- `react-redux`
- `Provider`
- `store`
- `slice`

如果当前只收口 `journal_entries` 一条链：

- RTK 会带来额外接线成本
- 但不一定立刻带来同等收益

所以如果这轮目标只是：

**去掉 `RecordDetail -> RecordsPage -> 再进详情` 的闪旧问题**

那轻量 cache 更像够用且更快的止血方案。

---

## 7. 什么时候应该升级到 RTK

只要出现下面任意 2-3 条，就该认真考虑从 cache 升级到 RTK：

1. cache 不再只管 `journal_entries`，开始同时管：
   - `review_letters`
   - `threads`
   - 其它实体

2. 需要跨更多页面即时联动，而不是只在 list/detail/edit 三点同步。

3. merge 规则变复杂，例如：
   - 本地 cache 值 vs 补拉值谁优先
   - 删除后如何失效
   - refresh 后如何保留本地保护窗口
   - 补拉后何时允许远端值接管

4. 页面里开始到处写：
   - `getFromCache`
   - `resolveEntry`
   - `removeEntry`
   - `storeEntry`
   - `ignoreRemoteWhileProtected`

5. 某些入口很容易漏 merge，导致：
   - 列表新、详情旧
   - 详情新、编辑旧
   - 长按菜单吃旧 entry

6. 新同事已经很难一眼看懂“DB 真值、页面 state、entry store”谁才是当前真源。

---

## 8. 轻量 cache 方案如果做，最小设计建议

### 8.1 cache 放哪里

建议：

- 新建 `src/contexts/EntryCacheContext.jsx`
- 或直接在 `MainLayout` 挂 Context Provider

核心结构：

```js
Map<entryId, CompleteEntry>
```

### 8.2 哪些地方必须接

至少这几处要一起改，不然还是会漏：

1. `RecordDetail` 保存成功后写 cache
2. `EditEntryPage` 保存成功后写 cache
3. `RecordsPage` 的 `load / refresh / loadMore / filter` 都查完整字段
4. `RecordsPage` 渲染列表时 resolve cache，并按 resolve 后的 `created_at` 重新排序/分组
5. `RecordsPage` 打开详情时传 resolve 后 entry
6. `RecordsPage` 打开编辑时传 resolve 后 entry
7. `MainLayout` 如果持有当前 detail screen entry，也要优先吃 resolve 后值

### 8.3 哪些操作别忘

- 删除 entry 时同步删 cache
- 刷新列表时不要清空 cache
- 补拉回完整 entry 后，允许远端值接管旧 cache
- 分页列表 / 筛选列表不能再给详情页传“伪完整 entry”

---

## 9. 轻量 cache 方案的主要风险

1. **入口漏 resolve**
   列表看着是新值，但点进详情又把旧 entry 传进去了。

2. **store 生命周期不清**
   什么时候删、什么时候保、什么时候被服务端新值覆盖，规则不清楚就会乱。

3. **“完整 entry”判断不统一**
   一处按完整快照处理，另一处却用瘦身字段误判成“可直接进详情/编辑”。

4. **列表排序基于旧 `created_at`**
   用户改了时间，但列表还停在旧日期分组和旧顺序。

5. **调试成本上升**
   出问题时很难快速判断：
   - 是 DB 没存
   - 是 page state 旧
   - 是 cache 没写
   - 还是 cache 写了但入口没 resolve

---

## 10. RTK 方案的主要风险

1. **这轮会多出基础设施成本**
   - 安装依赖
   - Provider
   - store/slice
   - selectors/actions

2. **如果只修一个局部闪旧问题**
   有可能显得比问题本身更重。

3. **容易被做过头**
   一旦团队上 RTK，很容易顺手把很多并不需要共享的临时 UI 状态也塞进去。

---

## 11. 建议新 session 最终给出的回答格式

希望新 session 最终按这个结构回答：

1. **结论**
   当前先选 cache 还是 RTK。

2. **为什么**
   必须紧扣本项目现在的数据流，不要泛讲 Redux 教科书优缺点。

3. **最小边界**
   哪些实体、页面、字段进入方案；哪些明确不进。

4. **风险**
   这个选择 1-2 个月后最容易出什么问题。

5. **升级条件**
   出现哪些信号后，应该从 cache 升级到 RTK。

---

## 12. 相关文档

先看这个现有计划，再做判断：

- [docs/superpowers/plans/2026-04-26-annotation-stability-repair.md](./2026-04-26-annotation-stability-repair.md)

这份计划里已经记录了：

- 当前“详情闪旧”的问题背景
- 为什么有人提出过 RTK
- 为什么后来又想回到轻量 cache

---

## 13. 决策树

```
当前只有 journal_entries 需要同步？
├─ 是 → 未来 6 个月内不会加新 entity？
│   ├─ 是 → 用 cache（最省）
│   └─ 否 → 用 RTK（避免后期重构）
└─ 否 → 已经有 review_letters / threads 需要同步？
    ├─ 是 → 用 RTK（多实体必选）
    └─ 否 → 评估未来 3 个月的 roadmap
        ├─ 会加新 entity → 用 RTK
        └─ 不会 → 用 cache，但设警戒线
```

**警戒线：**
- cache 已经不再只是完整 entry store，而开始做字段级 merge → 考虑 RTK
- cache 需要保护/失效/优先级规则的条件越来越多 → 考虑 RTK
- cache 需要处理超过 2 个 entity → 必须 RTK
- 出现"A 页面刚存，B 页面补拉旧值又盖回去"的 bug → 必须 RTK
- 出现“列表刷新后补拉旧值又把 cache 盖回去”的 bug → 必须 RTK

---

## 13.5 决策树（原版）

```
当前只有 journal_entries 需要同步？
├─ 是 → 未来 6 个月内不会加新 entity？
│   ├─ 是 → 用 cache（最省）
│   └─ 否 → 用 RTK（避免后期重构）
└─ 否 → 已经有 review_letters / threads 需要同步？
    ├─ 是 → 用 RTK（多实体必选）
    └─ 否 → 评估未来 3 个月的 roadmap
        ├─ 会加新 entity → 用 RTK
        └─ 不会 → 用 cache，但设警戒线
```

**警戒线：**
- cache 管理超过 3 个字段 → 考虑 RTK
- cache 跨越超过 3 个页面 → 考虑 RTK
- cache 需要处理超过 2 个 entity → 必须 RTK
- 出现"A 页面刚存，B 页面补拉旧值又盖回去"的 bug → 必须 RTK

---

## 14. 当前作者立场摘要

截至 2026-04-26，本轮更倾向：

- **短期：** 先用轻量 cache
- **前提：** scope 严格限制在 `journal_entries`
- **原因：** 当前问题集中，RTK 初始成本偏重
- **警戒线：** 只要 cache 想继续吞 `review_letters / threads / 更多页面联动`，就该重新评估 RTK

一句话总结：

**如果只修 `journal_entries` 一致性，cache 更省。  
如果要做成多实体共享状态层，RTK 更稳。**

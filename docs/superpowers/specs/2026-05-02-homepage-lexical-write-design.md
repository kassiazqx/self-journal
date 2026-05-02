# HomePage Lexical Write Path Design

**日期：** 2026-05-02  
**状态：** Draft for review  
**优先级：** 第一阶段正式落地 spec

---

## 1. 目标

把 `HomePage` 写入主路径从“纯文本输入 + offset 标注”升级为“Lexical WYSIWYG 写作 + 纯文字语义提取 + 结构化真源保存”，同时不破坏当前这些正式能力：

- 人物识别
- 时间推断
- AI 进入点
- 草稿恢复
- 图片上传
- 当前详情页样式展示

这份 spec 只覆盖：

- `journal_entries` 新建写作主路径
- 正式 Lexical 写作编辑器
- 第一阶段最小工具栏和保存策略

不覆盖：

- 编辑已有日记统一改造
- 回顾信 / threads
- 全站渲染统一
- APK 专项优化

---

## 2. 为什么这份 spec 必须单独存在

当前 `HomePage.jsx` 已经承担很多责任：

- 模板切换
- 草稿恢复
- 图片上传
- 时间 pill
- 人物识别
- @ mention
- 保存并跳转觉察流

而当前正式 `RichTextEditor.jsx` 仍然是：

- Lexical `PlainTextPlugin`
- 外加旧 `annotations` 渲染与选区菜单

因此，这次不是简单“把 PlainTextPlugin 换成 RichTextPlugin”就结束。

真正要设计的是：

1. 写作主状态改成什么
2. 自动识别读什么
3. 保存时落什么
4. 旧详情页怎么继续工作
5. 新旧编辑链路如何并存

---

## 3. 当前代码约束

### 3.1 HomePage 当前关键事实

当前 `HomePage.jsx`：

- 用 `content` state 维护纯文本正文
- 用 `useAnnotations()` 维护 offset 样式层
- 用 `inferDatetime(content)` 做 800ms debounce 时间推断
- 用 `detectPeopleFromText(content, contacts)` 做人物识别
- 草稿只存纯文本 `content`
- 保存时写入：
  - `content`
  - `people_involved`
  - `annotations`
  - `created_at`

### 3.2 现有正式 RichTextEditor 当前关键事实

当前 `RichTextEditor.jsx`：

- 使用 Lexical `PlainTextPlugin`
- `getValue()` / `onChange()` 都输出纯文本
- 编辑器内部渲染的是旧 `annotations`
- 标注菜单是选区浮动式

### 3.3 当前详情页 / 编辑页约束

当前 `RecordDetail.jsx` 仍依赖：

- `content`
- `annotations`
- `AnnotatedText`

当前 `EditEntryPage.jsx` 仍依赖：

- `content`
- `annotations`
- 旧 `RichTextEditor`

因此 Phase 1 不能只保存 Lexical JSON 而不产出兼容层，否则：

- 详情页看不到样式
- 旧编辑页会失真或写乱

---

## 4. 第一阶段推荐总体方案

### 4.1 核心思路

`HomePage` 第一阶段正式落地采用三层模型：

1. **编辑状态**
   - Lexical editor state
   - 用户真实正在编辑的主状态

2. **纯文字语义**
   - 从 editor state 提取
   - 继续供人物识别、时间推断、AI、搜索、预览使用

3. **保存真源**
   - 从 editor state 导出 Lexical JSON
   - 用于未来重新加载和后续统一读写

同时，为了兼容当前正式读链路，第一阶段额外保留一个派生层：

4. **兼容 annotations**
   - 从 Lexical doc model 派生
   - 只用于喂现有 `AnnotatedText` / legacy read path
   - 不再是写作真相源

### 4.2 第一阶段保存契约

推荐的 `journal_entries` 第一阶段保存契约：

- `content`
  - 继续存纯文字语义
- `content_source`
  - 新增 JSONB 字段
  - 作为结构化真源
  - 本 spec 使用 `content_source` 作为推荐命名
- `annotations`
  - 保存结构化真源导出的兼容样式层

推荐 JSON 包装格式：

```json
{
  "kind": "lexical",
  "version": 1,
  "doc": {
    "root": {
      "type": "root",
      "children": []
    }
  }
}
```

说明：

- `content` 继续服务当前所有纯文本消费者
- `content_source` 为后续统一渲染和回填做准备
- `annotations` 作为阶段性桥接，不再是第一真相

---

## 5. 编辑器与交互设计

### 5.1 工具栏位置

第一阶段工具栏采用：

**固定底部工具栏**

不采用：

- 选区浮动工具栏
- 鼠标悬浮工具栏

原因：

- 代码实现更简单
- 移动端更稳
- 不依赖选区坐标跟踪
- 键盘顶起时更容易控制
- 更少焦点丢失 / 选区错位问题

### 5.2 第一阶段按钮集合

第一阶段底部工具栏只包含：

- 粗体
- 下划线
- 单一高亮
- 固定几种文字颜色
- 清除样式
- 撤销
- 重做

不进入第一阶段：

- 对齐
- 引用
- 列表
- todo checklist
- 多色高亮
- 多色下划线

### 5.3 按钮行为规则

第一阶段规则：

- 用户先选中文本，再点击样式按钮
- 如果当前没有有效选区，样式按钮不生效
- 撤销 / 重做始终可见
- 颜色按钮显示为固定色点，不做颜色面板
- `清除样式` 清除当前选区上的粗体 / 下划线 / 高亮 / 颜色

### 5.4 段落规则

编辑器必须支持：

- Enter 新段落
- 空行保留
- 从保存真源恢复后段落结构不变

纯文字语义提取时：

- 段落之间用 `\n\n`
- 单段内部换行按实际文本保留

---

## 6. HomePage 内部状态设计

### 6.1 新状态拆分

当前 `content` 不能再承担唯一正文状态。

第一阶段 `HomePage` 推荐拆成：

- `editorDoc`
  - 当前 Lexical JSON 真源快照
- `plainText`
  - 当前纯文字语义
- `compatAnnotations`
  - 当前从 Lexical 导出的兼容 annotations

原先的 `content` state 角色，替换为：

- `plainText`

### 6.2 语义变化 vs 样式变化

第一阶段必须显式区分：

1. **语义变化**
   - 打字
   - 删字
   - 粘贴文本
   - 替换文本

2. **纯样式变化**
   - 粗体
   - 下划线
   - 高亮
   - 文字颜色

规则：

- 只有 `plainText` 真正变化时，才允许重跑：
  - `inferDatetime()`
  - `detectPeopleFromText()`
  - `@ mention` query 检测
- 纯样式变化时，不应触发识别闪断

### 6.3 对现有逻辑的影响

以下逻辑都改为消费 `plainText`，不直接消费 editor 原始 JSON：

- 时间推断
- 人物识别
- @ mention 检测
- draft banner 是否展示
- 保存前判空

---

## 7. Draft 设计

### 7.1 旧草稿问题

当前草稿只存纯文本 `content`，对富文本写作不够。

如果第一阶段仍只存纯文本草稿，会丢：

- 段落结构的真源信息
- 样式

### 7.2 第一阶段草稿契约

草稿快照推荐改为：

```json
{
  "plainText": "今天我想记录一下……",
  "contentSource": {
    "kind": "lexical",
    "version": 1,
    "doc": {}
  },
  "template": "gratitude",
  "selectedDatetime": "2026-05-02T10:30:00.000Z",
  "manualOverride": false,
  "dismissedPeople": []
}
```

恢复策略：

1. 有 `contentSource` 时，优先从 `contentSource` 恢复编辑器
2. 无 `contentSource` 但有旧 `content` / `plainText` 时，走纯文本 fallback

这保证：

- 旧草稿不失效
- 新草稿可 round-trip 恢复样式

---

## 8. 保存设计

### 8.1 新建保存时写入内容

`createEntry()` 第一阶段保存 payload 推荐包含：

- `content`
- `content_source`
- `annotations`
- `template_type`
- `created_at`
- `people_involved`

其中：

- `content` 来自 `plainText.trim()`
- `content_source` 来自当前 Lexical JSON doc wrapper
- `annotations` 来自导出的兼容 bridge

### 8.2 compat annotations 的角色

第一阶段 `annotations` 不再来自独立编辑菜单，而是来自：

**Lexical doc model 导出**

职责：

- 让 `RecordDetail` 继续工作
- 让现有只读预览暂时继续显示样式
- 为第二阶段过渡提供可读兼容层

限制：

- 它不是主真源
- 未来可以被逐步弱化或移除

### 8.3 AI / 搜索 / 预览兼容

第一阶段保存后，现有链路继续读：

- `content`

因此：

- AwarenessFlow 不需要先改
- `entryFullText` 不需要先改
- 搜索和摘要不需要先改
- 预览和导出也不需要先改

这是第一阶段最重要的兼容收益

---

## 9. @ mention、人物识别、时间推断

### 9.1 人物识别

继续使用现有：

- `detectPeopleFromText(plainText, contacts)`

规则：

- 仅在 `plainText` 语义变化时更新
- 手动 dismiss 的人物仍沿用当前逻辑

### 9.2 时间推断

继续使用现有：

- `inferDatetime(plainText)`

规则：

- 保持当前 800ms debounce
- `manualOverride = true` 后不再自动覆盖
- 样式变化不重跑

### 9.3 @ mention

第一阶段继续沿用当前“纯文本尾部检测”思路：

- 从 `plainText` 检测最后一个 `@query`
- 继续走现有联系人内存过滤

说明：

- 这不是最强 mention 实现
- 但足够兼容当前主路径
- 不把 mention 系统和富文本升级绑成同一轮大改

---

## 10. 与现有详情页 / 编辑页的兼容策略

### 10.1 RecordDetail

第一阶段不重写 `RecordDetail` 渲染模型。

兼容方式：

- 继续用 `content + annotations`
- `annotations` 由新写入路径导出

这意味着：

- 新 entry 写完后，详情页立即可读
- 不需要在第一阶段同步做 JSON 富文本渲染器

### 10.2 EditEntryPage 的风险

`EditEntryPage` 目前仍是旧链路：

- 读 `content`
- 读 `annotations`
- 用 legacy editor 保存

风险在于：

- rich-source entry 进入旧编辑页后，如果直接保存，`content_source` 可能变 stale

因此第一阶段正式上线前，必须加一个 rollout guard：

**rich-source entry 不能无防护地继续走旧编辑页保存。**

可选防护方式：

1. `entry.content_source` 存在时，暂时不开放旧编辑页
2. 或旧编辑页保存时显式清除 / 降级 `content_source`

本 spec 推荐：

**先做保护，不做隐式双向同步。**

原因：

- 保护比假同步更稳
- 避免第一阶段把编辑页也卷进来

---

## 11. 组件设计建议

### 11.1 不直接改旧 `RichTextEditor`

第一阶段不建议在旧 `RichTextEditor.jsx` 上硬改到同时兼容：

- plain text mode
- legacy annotation mode
- new rich write mode

更稳的做法是：

- 保留旧 `RichTextEditor` 给 legacy 链路
- 新建面向写入主路径的正式组件，例如：
  - `LexicalWriteEditor.jsx`
  - 或 `RichWriteEditor.jsx`

职责分离：

- 旧组件：服务旧 `annotations` 编辑链路
- 新组件：服务 Phase 1 写入主路径

### 11.2 新编辑器职责

新编辑器应负责：

- 渲染 Lexical RichText
- 固定底部工具栏
- 输出 editor JSON
- 输出 plain text
- 输出 compat annotations
- 暴露：
  - `focus()`
  - `getSnapshot()`
  - `setSnapshot()`

不负责：

- 业务保存
- 联系人加载
- 时间推断
- 图片上传

---

## 12. 验收标准

第一阶段通过标准：

1. 用户可以在 HomePage 正常写多段内容并看到实时样式效果
2. 工具栏固定在底部，不依赖选区浮层
3. 样式变化不会让人物识别 / 时间识别闪断
4. 草稿刷新后能恢复段落和样式
5. 保存后：
   - `content` 是干净纯文字
   - `content_source` 是结构化真源
   - `annotations` 可供旧详情页继续展示
6. 新写入记录进入详情页时样式不丢
7. 中文输入和手机浏览器下基础写作稳定

---

## 13. 明确不做

第一阶段明确不做：

- 多色高亮
- 多色下划线
- 浮动工具栏
- 复杂 mention node
- 对齐 / 引用 / 列表 / todo
- 详情页 JSON 渲染器
- EditEntryPage 正式富文本改造
- review_letters / threads 同步升级

---

## 14. 后续紧接着要写的 implementation plan 应回答什么

下一份 implementation plan 需要把下面这些点写成任务顺序：

1. `journal_entries` 新字段方案
2. 新写入编辑器组件的文件边界
3. Lexical JSON -> compat annotations 的导出规则
4. draft storage 兼容升级
5. HomePage 状态改造顺序
6. rollout guard 如何拦住旧编辑页
7. build / 手测验证清单

这份 spec 的结论很明确：

**第一阶段不是“全站统一真源”，而是“先把 HomePage 写入主路径正式切到 Lexical，并用 compatibility bridge 保住现有系统”。**

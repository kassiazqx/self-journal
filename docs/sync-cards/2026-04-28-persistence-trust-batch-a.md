# 同步卡：Persistence Trust Batch A / Task1-3

**状态：** `Task1 Follow-up Replacement` + `Task2` + `Task3` 已完成；`Task4 Step1` 已复核通过，`Step2-3` 未闭环；`Task5+` 未开始
**日期：** 2026-04-29
**commit：** 待本次提交生成  
**分支：** `dev`

---

## 本次范围

按：

- `docs/superpowers/plans/2026-04-28-persistence-trust-batch-a.md`

本次完成：

- `Task1 Follow-up Replacement`
- `Task2: 草稿正文恢复与外部内容同步收口`
- `Task3: 深入觉察真正支持“直接进 AI”`

本次明确不做：

- 未保存图片跨“刷新 / 关闭后重开”恢复
- `Task4` 手测矩阵之外的新功能扩展
- 语音能力重设计（讯飞 / 上传录音 / 上传视频）

---

## 最终决策

### 1. AI 设置继续走 provider-aware 本地结构

- `storage.js` 保留 `ai_settings_v2`
- 结构继续是：

```js
{
  provider: 'gemini' | 'deepseek',
  providers: {
    gemini: { apiKey: '' },
    deepseek: { apiKey: '' },
  },
}
```

- 旧 `ai_settings` 只做读取兼容，不再回写旧结构

### 2. 回顾信偏好维持本地单一真源

- `letter_prefs` 继续只走 `letterPrefsStorage.js`
- 不再写入 `user_profile`
- 不再依赖 `updateMemory`

### 3. 草稿改为独立存储层 `draftStorage.js`

- 新 key：`journal_draft_v2`
- 草稿内容包括：
  - 正文
  - 模板
  - 保存时间
  - 手动时间覆盖状态
  - `dismissedPeople`
- `selectedDatetime` 读回时转回 `Date`
- `dismissedPeople` 读回时转回 `Set`

### 4. 旧草稿不迁移

- 用户已确认：旧 `journal_draft` 不做迁移
- 之前旧草稿丢失可接受

### 5. 草稿不再按 24 小时自动过期

- 只要正文还在，就继续允许恢复
- 草稿何时消失，交给：
  - 用户主动丢弃
  - 内容删空
  - 正式保存成功
  - 深入觉察创建成功

### 6. 内容删空时同步清草稿

- 不再保留“空白假草稿”
- 刷新后不应该继续弹恢复横幅

### 7. 外部写入统一收口到编辑器命令式入口

- `RichTextEditor` 新增 ref 方法：`setValue(text)`
- `HomePage` 新增 `applyExternalContent(text)`
- 草稿恢复 / `@` 替换 统一走这个入口

目的：

- 页面 state 里的字
- Lexical 编辑器里的字

尽量保持同一份，不再各改各的

### 8. 未保存图片跨重开恢复本次明确不做

- plan 里的旧矛盾句已改掉
- 本次只承诺正文 / 模板 / 时间 / `dismissedPeople` 恢复

### 9. Task3 导航契约统一改为 object

- `HomePage` 不再维持“`✓` 一条保存链、`✦` 另一条保存链”
- 新建模式统一先走 `saveNewEntryAndNavigate()`
- 两个入口差别只剩：
  - `✓` → `{ gotoAwareness, startMode: 'local' }`
  - `✦` → `{ gotoAwareness: true, startMode: 'ai' }`
- `MainLayout` 改为接 `navigation object`
- 不再靠旧 `boolean` 表达“去不去觉察”

### 10. AwarenessFlow 首次启动顺序已固定

- 优先级：
  - `initialFlowState`
  - `conversations` 已存消息
  - `startMode: 'ai'` 的首轮 AI bootstrap
  - 普通本地卡片起步
- 这样保证：
  - 全新点 `✦` 不会先闪本地题
  - 恢复旧觉察进度时，不会被 `startMode: 'ai'` 覆盖
  - 若首轮 AI 失败，会回退到本地卡片并展示错误，而不是卡空白页

---

## 实际改动文件

| 文件 | 本轮改动 |
|---|---|
| `src/lib/storage.js` | AI settings v2、provider 分槽位持久化 |
| `src/lib/storage.test.js` | provider settings 规范化 / merge 测试 |
| `src/lib/letterPrefsStorage.js` | `letter_prefs` 本地单一真源 |
| `src/lib/letterPrefsStorage.test.js` | 默认值 / 兼容 / 清脏数据测试 |
| `src/lib/reviewLetterService.js` | 回顾信偏好改为只读本地真源 |
| `src/lib/reviewLetterService.test.js` | Task1 follow-up 兼容回归 |
| `src/pages/SettingsPage.jsx` | AI 设置 / 回顾信偏好切到新契约 |
| `src/lib/draftStorage.js` | 新增草稿序列化 / 保存 / 读取 / 清理 |
| `src/lib/draftStorage.test.js` | 草稿序列化 / 存储异常 / 坏日期兜底 / 清理测试 |
| `src/pages/HomePage.jsx` | 新建保存统一收口；`✓` / `✦` 共用同一保存语义；顺手修掉 `@` 浮层旧 lint 挡点 |
| `src/components/RichTextEditor.jsx` | 新增 ref `setValue(text)` |
| `src/components/MainLayout.jsx` | `onDone` 导航改为 object 契约，向 AwarenessFlow 透传 `startMode` |
| `src/components/AwarenessFlow.jsx` | 首次进入支持 `startMode='ai'` 真直入 AI；失败 fallback 本地卡片 |
| `src/lib/awarenessFlowState.js` | 新增 `createInitialAwarenessState()`，统一首启优先级 |
| `src/lib/awarenessFlowState.test.js` | 补 `startMode='ai'` / snapshot 优先级测试 |
| `docs/arch-context.md` | 更新 §3 / §6 |
| `docs/superpowers/plans/2026-04-28-persistence-trust-batch-a.md` | 删掉“未保存图片也能恢复”的旧矛盾句 |

---

## 自动验证

已执行：

- `node --test src/lib/storage.test.js`
- `node --test src/lib/letterPrefsStorage.test.js`
- `node --test src/lib/reviewLetterService.test.js`
- `node --test src/lib/draftStorage.test.js`
- `node --test src/lib/awarenessFlowState.test.js`
- `npm run lint`
- `npm run build`

2026-04-29 本 session 复核再次执行：

- `node --test src/lib/draftStorage.test.js src/lib/awarenessFlowState.test.js`
- `npm run lint`
- `npm run build`

结果：

- `draftStorage.test.js` 5/5 通过
- `awarenessFlowState.test.js` 10/10 通过
- `lint` 通过
- `build` 通过
- 本 session 复核：19 tests 全通过，`lint` 通过，`build` 通过
- 构建仍有既有 warning：
  - 大 chunk 提示
  - ineffective dynamic import 提示

---

## 手工验证结果

已手测通过：

- 草稿恢复：正文 / 模板 / 时间 / `dismissedPeople`
- 内容删空后不再弹假草稿
- `@` 选人后正文与 chip 状态正常

Task4 / Task3 仍待用户手测重点：

- 点 `✓`：保存后进入本地觉察
- 点 `✦`：保存后直接进入 AI，不先闪本地题
- 先选图、`@` 人，再点 `✦`：详情页最终能看到人物和图片，草稿不再重复恢复
- API Key：切 provider 再切回，当前 provider key 仍在；关闭网页后重开仍在
- 回顾信偏好：改成“手动生成”后，刷新页面/重开网页不回跳

## Task4 当前阻塞

- `Step1` 已完成并由本 session 重跑复核
- `Step2` 需起 `npm run dev` 给用户手测；当前 CLI 沙箱监听 `0.0.0.0:5173` 被拒
- `Step3` 依赖用户在本地完成上面手测矩阵
- `Step4` 文档已更新到“部分完成”真实状态，待 `Step2-3` 结束后再收最终结论

---

## 残余风险

- `template.awarenessStart` 当前仍主要承担“是否进入觉察”的入口判断；真实起点语义现在由 `startMode` + 觉察状态机共同决定，后续若做更细模板起点，需再统一
- Task3 的代码承诺已落地，但“选图 + `@` 人 + 点 `✦`”仍需用户手测最终闭环
- 若后续确定走“上传录音 / 上传视频 / 再转文字”，媒体入口会另起链路，不应再回头把旧 Web 语音模式塞回本批

---

## 给下个 session 的一句话

如果继续做 `Persistence Trust Batch A`：

- 代码层下一步从 `Task4` 验证矩阵与文档扫尾开始
- 优先补用户手测 `✓ / ✦ / 图片 / @人物` 闭环
- 不要回头把未保存图片跨重开恢复塞回 Task2

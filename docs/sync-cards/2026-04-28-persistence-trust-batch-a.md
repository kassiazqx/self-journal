# 同步卡：Persistence Trust Batch A / Task1

**状态：** 仅 Task1 Follow-up Replacement 已完成；Batch A 其余 Task 尚未开始  
**日期：** 2026-04-28  
**commit：** 待本次提交生成  
**分支：** `dev`

---

## 目标

按：

- `docs/superpowers/plans/2026-04-28-persistence-trust-batch-a.md`

只完成 `Task1: 收口 AI 设置与回顾信偏好持久化`，不提前进入草稿恢复、图片缓存、`RichTextEditor` 外部 value 同步，也不改既有架构方向。

---

## 最终决策

### 1. AI 设置改为 provider-aware 主结构

- `storage.js` 新增：
  - `normalizeProviderSettings(raw)`
  - `mergeProviderSettings(prev, provider, apiKey)`
- 新主 key 为 `ai_settings_v2`
- 结构统一为：

```js
{
  provider: 'gemini' | 'deepseek',
  providers: {
    gemini: { apiKey: '' },
    deepseek: { apiKey: '' },
  },
}
```

- 读取时兼容旧结构 `{ provider, apiKey }`
- 写入后删除旧 `ai_settings`，避免新旧双写漂移

### 2. `SettingsPage` 切 provider 不再互相清空 key

- 点 provider tab 时：
  - 更新当前 `provider`
  - 同时把输入框值切到 `providers[p.id].apiKey`
- 编辑 API Key 时：
  - 同步更新 `settings.apiKey`
  - 也同步更新 `settings.providers[settings.provider].apiKey`

结果：

- Gemini / Deepseek 各自保留自己的 key
- 来回切 provider、刷新页面后，不再出现“刚填好的 key 被切没了”

### 3. 回顾信偏好 follow-up：改为本地单一真源

- `letter_prefs` 从 `user_profile` / `updateMemory` / `reviewLetterService` 主链拆出
- 新建 `src/lib/letterPrefsStorage.js`
- 规则：
  - `type === 'manual'` 保留
  - 其余一律归一到 `count`
  - 旧 `days` 自动降级为 `count`
  - `count_threshold` 默认 `10`
  - `require_new_entries` 默认 `true`

保存链：

- `SettingsPage` 直接 `saveLetterPrefs(user.id, prefs)`
- 底层只写 `localStorage.setItem(letter_prefs_<userId>)`

读取链：

- `SettingsPage` 直接 `getLetterPrefs(user.id)`
- `reviewLetterService` 生成/检查回顾信时也只读同一个本地模块
- 坏 JSON 会清理脏数据并回默认值

### 4. 这次 follow-up 的边界

- 不恢复 `user_memory.user_profile.letter_prefs`
- 不再依赖 `updateMemory` 保存回顾信偏好
- 保留已做好的 provider 分槽位持久化，不回退到单 `apiKey`
- `reviewLetterService` 只保留生成逻辑和本地 prefs 读取；不再负责把偏好写进 `user_profile`

---

## 实际改动文件

| 文件 | 本轮改动 |
|---|---|
| `src/lib/storage.js` | AI settings v2、旧结构兼容、provider 分槽位持久化 |
| `src/lib/storage.test.js` | 新增 provider settings 规范化 / merge 回归测试 |
| `src/lib/letterPrefsStorage.js` | `letter_prefs` 本地单一真源：normalize / save / get |
| `src/lib/letterPrefsStorage.test.js` | 默认值 / days 兼容 / 写后再读 / 坏 JSON 清理测试 |
| `src/lib/reviewLetterService.js` | 回顾信逻辑改为只从 `letterPrefsStorage` 读偏好；不再写 `user_profile` |
| `src/lib/reviewLetterService.test.js` | 保留旧导出兼容回归，确保本地 prefs wrapper 仍可跑纯 `node --test` |
| `src/pages/SettingsPage.jsx` | provider 切换恢复各自 key；回顾信偏好改走 `letterPrefsStorage` 本地模块 |
| `docs/arch-context.md` | 更新 §3 真实结构与 §6 日志 |

---

## 自动验证

已执行：

- `node --test src/lib/storage.test.js`
- `node --test src/lib/letterPrefsStorage.test.js`
- `node --test src/lib/reviewLetterService.test.js`
- `node --test src/lib/storage.test.js src/lib/letterPrefsStorage.test.js src/lib/reviewLetterService.test.js`
- `npm run build`

结果：

- 9/9 tests 通过
- `build` 通过
- 构建有非阻塞 Vite warning：
  - 大 chunk 提示（既有）
  - `reviewLetterService.js` 的 ineffective dynamic import 提示

---

## 手工验证结果

- 本次代码 session 未新增手工点击验证记录
- 自动验证已覆盖：
  - provider 分槽位纯函数回归
  - `letter_prefs` 默认值 / 旧值兼容 / 写后再读 / 坏数据清理
- 建议手测清单：
  - Gemini / Deepseek 来回切换，确认各自 key 仍在
  - 修改回顾信条数或切到手动生成后刷新，确认偏好保持

---

## 残余风险

- Batch A 只完成了 Task1 follow-up replacement；草稿正文/图片恢复、`RichTextEditor` 外部 value 同步、`startInAi` 语义收口都还没开始
- `reviewLetterService.js` 仍保留旧偏好导出壳用于兼容测试；主链已切走，但后续若继续清理这层，可以直接删掉兼容壳并重写对应测试

---

## 给下个 session 的一句话

如果继续做 `Persistence Trust Batch A`，下一步直接从 plan 的 `Task2` 开始，不要回头重做 Task1，也不要把 provider key 持久化重新改回单一 `apiKey` 结构。

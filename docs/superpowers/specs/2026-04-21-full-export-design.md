# 完整数据备份导出 设计文档

> 版本：2026-04-21

---

## §0 背景

现有导出功能只导出 `journal_entries` 表的 JSON / TXT，缺少：觉察卡记录、回顾信、脉络、AI 记忆、词库、人物库、图片文件。用户希望能做完整本地备份（防 Supabase 服务中断），并为将来导入恢复预留数据格式。

**本次只做导出，不做导入。**

---

## §1 导出范围

### 1.1 包含的表（8 张）

| 表 | 内容 |
|---|---|
| `journal_entries` | 日记正文 + 35 个 AI 提取字段 + full_conversation |
| `conversations` | 觉察卡问答流记录 |
| `review_letters` | 回顾信内容 |
| `threads` | 脉络（已确认 / 候选 / 归档） |
| `thread_entries` | 脉络与日记的关联关系 |
| `user_memory` | AI 跨对话记忆（rolling_summary + user_profile） |
| `user_options` | 内容类别标签 + 内心需求词库（`field_name` 区分） |
| `user_contacts` | 人物库（canonical + aliases） |

### 1.2 不包含

- `pending_core_needs`：用户「待确认内心需求」临时队列，恢复后无意义，不纳入备份

### 1.3 图片

- Storage bucket：`journal-images`
- 路径来源：`journal_entries.image_urls`（数组，每项为 Storage 路径字符串）
- 图片是可选项，由用户在导出时勾选

---

## §2 导出 UI

### 2.1 设置页「数据导出」区域

**移除**原有「导出 JSON」「导出 TXT」两个按钮。

**替换为：**

```
数据导出
导出你的全部数据，仅在本机浏览器下载，不会上传到任何服务器

☐ 包含图片（导出为 zip 格式，文件较大）

[导出备份]
```

- 未勾选 → 下载 `self-journal-backup-{date}.json`
- 勾选 → 下载 `self-journal-backup-{date}.zip`

### 2.2 状态反馈

- 不含图片时：按钮变灰 + 「导出中…」，完成后恢复（秒完成）
- 含图片时：进度文字「正在下载图片 {n} / {total}…」
- 导出完成：「✓ 已导出」提示，3 秒后消失
- 失败：见 §4 错误处理

---

## §3 数据格式

### 3.1 不含图片：data.json 独立文件

文件名：`self-journal-backup-2026-04-21.json`

```json
{
  "version": "1",
  "exportedAt": "2026-04-21T12:00:00.000Z",
  "userId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "tables": {
    "journal_entries": [ /* 全量行数组 */ ],
    "conversations":   [ /* 全量行数组 */ ],
    "review_letters":  [ /* 全量行数组 */ ],
    "threads":         [ /* 全量行数组 */ ],
    "thread_entries":  [ /* 全量行数组 */ ],
    "user_memory":     [ /* 全量行数组，通常只有 1 行 */ ],
    "user_options":    [ /* 全量行数组 */ ],
    "user_contacts":   [ /* 全量行数组 */ ]
  }
}
```

### 3.2 含图片：zip 文件

文件名：`self-journal-backup-2026-04-21.zip`

```
self-journal-backup-2026-04-21.zip
├── data.json         ← 与 §3.1 格式完全相同
└── images/
    └── {userId}/
        └── {filename}  ← 路径与 image_urls 中存的字符串完全一致
```

**路径对应关系：**
- `journal_entries[n].image_urls[m]` = `"abc123/photo.jpg"`
- zip 内路径 = `images/abc123/photo.jpg`
- 导入时可按原路径直接上传回 Storage，无需路径映射

---

## §4 图片下载策略

### 4.1 下载流程

1. 收集所有 `journal_entries.image_urls` 中的路径，去重
2. 逐批下载（每批 3 张并发）
3. 每张完成后更新进度：「正在下载图片 {n} / {total}」
4. 全部完成 → 进入打包步骤

### 4.2 失败处理

任意图片下载失败时（网络超时、文件不存在等），暂停并弹出提示：

```
⚠️ {X} 张图片下载失败

• {路径1} — {原因}
• {路径2} — {原因}

[继续导出（跳过这 {X} 张）]  [取消并放弃本次导出]
```

- 选「继续」：跳过失败图片，其他数据和图片正常打包
- 选「取消」：中止导出，释放已下载内容（不生成文件）

### 4.3 图片下载方式

使用 `fetch(getImageUrl(path))` 获取 blob，Storage 为公开读，无需 auth token。

---

## §5 技术方案

### 5.1 新增依赖

`JSZip`（npm: `jszip`）：浏览器端 zip 打包，成熟稳定，无 wasm 依赖。

### 5.2 新增文件

`src/lib/exportService.js`：封装所有导出逻辑，SettingsPage 只调用两个函数：

```js
// 不含图片：返回 JSON 字符串
exportDataJson(userId)  → Promise<string>

// 含图片：返回 Blob（zip），支持进度回调和取消
exportDataZip(userId, { onProgress, onImageError })  → Promise<Blob | null>
// 返回 null = 用户取消
```

### 5.3 修改文件

`src/pages/SettingsPage.jsx`：移除旧导出按钮，替换为新 UI + 调用 exportService

---

## §6 成功验收标准

1. 不勾选「包含图片」→ 点导出备份 → 下载 JSON，打开能看到 8 张表的数据
2. 勾选「包含图片」→ 进度条从 0 增长到图片总数 → 下载 zip
3. zip 解压后，images/ 内的文件路径与 data.json 里的 image_urls 路径对应
4. 模拟图片下载失败 → 弹出失败提示，列出路径和原因
5. 点「取消放弃」→ 不生成文件，恢复初始状态
6. 点「继续导出」→ zip 正常下载，跳过失败图片
7. 原「导出 JSON」「导出 TXT」按钮已移除

---

## §7 不涉及范围

- 导入功能：本次不做，zip 格式已为将来导入预留（paths 对齐、data.json 含 userId）
- `pending_core_needs` 不纳入备份
- 导出进度不做百分比精确计算，只显示「图片 n/total」即可
- 不支持断点续传

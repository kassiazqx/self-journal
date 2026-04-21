# 同步卡：完整数据备份导出

> **状态：✅ 已完成** 2026-04-21
> Plan：`docs/superpowers/plans/2026-04-21-full-export.md`
> Spec：`docs/superpowers/specs/2026-04-21-full-export-design.md`

---

## 一、改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/lib/exportService.js`（新建） | 8 表查询 `exportDataJson`、图片下载 `fetchImages`、打包 `buildZip` |
| 2 | `src/pages/SettingsPage.jsx` | 移除旧 `handleExport` + 旧两个导出按钮，替换为新 UI + 调用 exportService |
| 3 | `package.json` | 新增 `jszip` 依赖 |

---

## 二、架构审查要点

### §A 图片两阶段设计（已在 plan 中落地）

**设计决策：** exportService 不持有「等待用户决定」的状态。

```
fetchImages() → { ok, failed }
                        ↓ failed.size > 0
              SettingsPage 展示确认弹层
                        ↓ 用户选择
handleContinueExport → buildZip(jsonString, okBlobs)
handleCancelExport   → 清空状态，中止
```

**好处：** service 是纯数据函数，UI 拥有所有决策状态，符合分层原则。

---

### §B getImageUrl 是唯一合法的 URL 拼接入口

**强制：** `fetchImages` 内使用 `import('./imageStorage').getImageUrl(path)`，不允许自行拼接 Supabase URL。`imageStorage.js` 是唯一知道 Storage URL 格式的地方，未来迁移只改那一个文件。

---

### §C thread_entries 无 user_id，需二段查询

**已在 plan 中写明：** `exportDataJson` 先查 `threads` 取当前用户所有 `thread_id`，再 `.in('thread_id', threadIds)` 查 `thread_entries`。`threadIds` 为空时直接返回空数组，不发请求。

---

### §D downloadFile 统一支持 Blob

**改动：** 原 `downloadFile(content, filename, mimeType)` 只接受 string，修改后支持 `content instanceof Blob`（zip 直接传 Blob，JSON 传 string）。纯工具函数，留在 SettingsPage 内，不下沉到 exportService（职责：exportService 构造数据，SettingsPage 触发下载）。

---

### §E 大文件内存风险（已知限制，不在本期处理）

所有图片 blob 先下载到内存再打包。日记 App 图片量通常可控，当前可接受。记录为已知限制，不影响本期实现。

---

## 三、不涉及范围

- 导入功能：不做，zip 格式已为将来导入预留（paths 对齐、data.json 含 userId）
- `pending_core_needs` 不纳入备份
- 断点续传：不支持
- 图片下载进度精确百分比：只显示「n / total」

---

## 四、实施前确认清单

- [x] 两阶段设计：service 不持有用户决策状态
- [x] getImageUrl 为唯一 URL 拼接入口，plan 中已标注
- [x] thread_entries 二段查询已写入 plan Task 1
- [x] downloadFile 改为支持 Blob，已写入 plan Task 4
- [x] 所有改动均在已有文件或新建 exportService.js，无新表、无 schema 变更

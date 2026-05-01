# 同步卡：默认用户数据收口

**状态：** 已完成  
**日期：** 2026-05-01  
**commit：** 待本次提交生成  
**分支：** `dev`

---

## 本次范围

按：

- `docs/superpowers/plans/2026-04-30-default-user-data-code-source.md`

本次完成：

- 默认 `content_category / core_need / user_contacts` 收口为单一代码真源
- 启动期 bootstrap 统一接管 brand-new user 初始化
- 删除页面层/提取链路 opportunistic reseed
- `SettingsPage` 人物管理改为共享 bootstrap 状态局部提示
- 补充 Supabase SQL 文档：注册触发器兼容修复、默认数据唯一约束、旧 DB seeder 退役步骤

本次明确不做：

- 不给 legacy user 自动补回缺失默认项
- 不给 `RecordsPage / ThreadDetailPage / RecordDetail` 额外加 bootstrap loading gate
- 不把 `localStorage marker` 升级为正式持久层状态表
- 不在本批实现 APK / 本地数据库版初始化

---

## 最终决策

### 1. 默认用户数据只保留一份代码真源

- 新增 `src/lib/defaultUserData.js`
- 统一导出：
  - `DEFAULT_CONTENT_CATEGORIES`
  - `DEFAULT_CORE_NEEDS`
  - `DEFAULT_CONTACTS`
  - 三个 row builder

后续再改默认项，只改这一处。

### 2. 启动期 bootstrap 接管默认数据初始化

- 新增 `src/lib/defaultUserBootstrap.js`
- `MainLayout` 登录后只跑一次 `ensureDefaultUserData(user.id)`
- `HomePage / SettingsPage` 读共享 `defaultUserDataStatus`

语义固定为：

- brand-new user：seed 一次
- marker 丢失但默认数据已在：只补 marker，不重复插
- 过渡期只写了 category 的 zero-entry user：补齐缺失 `core_need / user_contacts`
- legacy user：只写 marker，不自动补默认

### 3. 页面层/提取链路不再偷偷回填默认数据

本次删除三处旧行为：

- `HomePage` mount 时 `seedDefaultContacts()/seedDefaultCoreNeeds()`
- `RecordDetail` 分类 sheet 在空列表时自动插 11 个默认 category
- `entryExtractionService` 在空 category 时自动插默认 category

现在改为：

- `HomePage` 只在 bootstrap `ready` 后读取联系人
- `RecordDetail` 只展示“当前用户选项 + orphan tags”
- AI 提取只读用户现有词库；空列表也允许继续跑

### 4. 并发首登必须靠 DB 唯一约束兜底

短期正确性要求确认落文档：

- `user_options(user_id, field_name, option_value)` 唯一
- `user_contacts(user_id, canonical)` 唯一

`defaultUserBootstrap` 写入侧做 duplicate-safe 容错，避免双端/双窗口 brand-new 首登把默认行插两份。

### 5. `localStorage marker` 只作为 Web 过渡方案

- `storage.js` 新增 `getDefaultUserDataSeedVersion()` / `saveDefaultUserDataSeedVersion()`
- key：`default_user_data_seed_<userId>`

这不是长期真相源，只是 Web 阶段临时方案。APK / local-first 阶段再迁到正式持久层。

---

## 实际改动文件

| 文件 | 本轮改动 |
|---|---|
| `src/lib/defaultUserData.js` | 默认 categories/core_needs/contacts 单一真源 |
| `src/lib/defaultUserData.test.js` | 默认行 builder 测试 |
| `src/lib/defaultUserBootstrap.js` | brand-new/legacy/过渡补齐 bootstrap |
| `src/lib/defaultUserBootstrap.test.js` | bootstrap 规则测试 |
| `src/lib/storage.js` | 默认用户数据 seed marker helpers |
| `src/lib/storage.test.js` | seed marker 测试 |
| `src/components/MainLayout.jsx` | 统一 bootstrap 状态、向子页透传 |
| `src/pages/HomePage.jsx` | 去页面级 seed，只在 bootstrap ready 后读联系人 |
| `src/pages/SettingsPage.jsx` | 人物管理入口/子页局部 loading hint |
| `src/components/RecordDetail.jsx` | 去分类默认项自动插入，仅保留 orphan merge |
| `src/lib/entryExtractionService.js` | 去提取链路默认 category 自动插入 |
| `src/lib/contactsService.js` | 移除内嵌默认联系人与 seed 逻辑 |
| `src/lib/coreNeedsService.js` | 移除内嵌默认 core_needs 与 seed 逻辑 |
| `src/lib/db.js` | ESM import 补 `.js` |
| `src/lib/supabase.js` | `import.meta.env` 改 Node-safe 读取，方便纯单测 |
| `docs/supabase-manual-sql.md` | trigger 修复 / 唯一约束 / 退役旧 seeder 文档 |
| `docs/arch-context.md` | §2 / §3 / §6 更新为新真实架构 |
| `docs/sync-cards/2026-04-27-entry-delete-asset-consistency-todo.md` | 已追加 APK / local-first 收口方向 |

---

## 自动验证

已执行：

- `node --test src/lib/defaultUserData.test.js`
- `node --test src/lib/storage.test.js`
- `node --test src/lib/defaultUserBootstrap.test.js`
- `node --test src/lib/defaultUserData.test.js src/lib/storage.test.js src/lib/defaultUserBootstrap.test.js`
- `npm run build`

结果：

- `defaultUserData.test.js` 3/3 通过
- `storage.test.js` 4/4 通过
- `defaultUserBootstrap.test.js` 6/6 通过
- 联合测试 13/13 通过
- `build` 通过

另外执行：

- `npm run dev`

结果：

- dev server 可正常启动
- 本地地址：`http://localhost:5173/`

---

## 手动验证清单

1. 新用户注册不再报 `Database error saving new user`
2. 新用户首登能拿到默认 categories / core_needs / contacts
3. `我的 → 人物管理` 在 bootstrap 未完成时只显示小字 `正在准备联系人词库...`
4. 旧用户改过/删过默认项后刷新，不会被偷偷补回
5. `RecordDetail` 旧 orphan category 仍可显示
6. 手动 `AI 分析` 在空 category list 下仍可执行，不会静默插默认 category

---

## 后续提醒

- Supabase SQL Editor 里的三组 SQL 还需按文档真实执行并验证：
  - `trigger_insert_default_options` compatibility fix
  - 默认数据唯一约束 + 去重 SQL
  - `insert_default_options` 退役 no-op（必须等 App bootstrap 验证通过后）
- 若后面切 APK / local-first，默认数据初始化状态应从 `localStorage marker` 迁到本地数据库 / 正式持久层

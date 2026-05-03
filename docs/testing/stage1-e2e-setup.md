# Stage 1 E2E Setup

> 对应 plan：`docs/superpowers/plans/2026-05-02-stage1-minimum-test-guardrails.md` Task 2  
> 本文档只定义 Stage 1 最小测试护栏的环境契约，不代表 Task 3 的 reset/auth/helper 已经实现。

## 1. Purpose

Stage 1 的页面流程测试采用：

- 真实 Supabase 测试项目
- 专用测试账号
- 后续 Task 3 落地的 reset / fixture 基线
- AI 请求 stub（后续 Task 3 落地）

本文件的目的，是先把“测试项目、变量名、账号职责、数据边界”固定下来，避免后续脚本各自起名、各自假设。

## 2. What Must Be Prepared

开始 Task 3 之前，本地至少要准备：

1. 一个独立 Supabase 测试项目
2. 两个专用测试账号
3. 一份本地私有环境文件：`.env.e2e.local`
4. 明确哪些数据允许 reset，哪些绝不动

## 3. Supabase Project Rules

Stage 1 E2E **必须** 使用独立测试项目，不直接连生产项目，也不和日常开发数据混用。

这个测试项目的职责：

- 承接真实登录、保存、编辑、列表查询、默认数据 bootstrap
- 承接后续 reset / fixture 脚本
- 允许反复清空指定测试账号名下业务数据

不要求：

- 不要求现在就接 CI
- 不要求现在就有单独 migration pipeline
- 不要求现在就完整复制生产全部内容

## 4. Environment Variable Contract

Task 2 固定以下变量名。真实值只放本地私有文件，不写进仓库。

### 4.1 App runtime values

这些值给 Vite dev server 用，Playwright 跑页面时前端代码实际读取的还是现有运行时变量：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

也就是说，E2E 跑页面时，前端会真的连到测试 Supabase 项目。

### 4.2 Playwright local server overrides

当前 Playwright 基线配置支持：

- `PLAYWRIGHT_BASE_PORT`
- `PLAYWRIGHT_BASE_URL`

默认值当前是：

- `4173`
- `http://127.0.0.1:4173`

通常不需要改，除非本机端口冲突。

### 4.3 Script-only Supabase values

后续 Task 3 的 reset / fixture / auth-state 工具只使用这些 e2e 专用变量：

- `E2E_SUPABASE_URL`
- `E2E_SUPABASE_ANON_KEY`
- `E2E_SUPABASE_SERVICE_ROLE_KEY`

约束：

- `E2E_SUPABASE_SERVICE_ROLE_KEY` 只允许本地脚本使用
- 不允许前端运行时代码读取 `service role key`
- 不允许把 `service role key` 放进 `.env`, `.env.local`, `.env.example` 这类常规前端环境文件

## 5. Account Responsibilities

Stage 1 固定两类账号，职责不能混用。

### 5.1 Existing-user E2E account

用途：

- 新建日记 -> 保存 -> RecordsPage 出现新记录
- 编辑已有记录 -> 保存 -> 返回后显示新内容
- 设置项持久化
- 觉察流前进 / 后退 / 恢复

要求：

- 允许被反复 reset 到固定基线
- 允许预置 1-2 条编辑用记录
- 后续 reset 脚本只清这个账号名下的数据，不清其他用户

变量：

- `E2E_EXISTING_USER_EMAIL`
- `E2E_EXISTING_USER_PASSWORD`
- `E2E_EXISTING_USER_ID`（可选但推荐，供白名单 reset 使用）

### 5.2 Brand-new bootstrap account

用途：

- 只用于“新用户首次登录 -> 默认数据 bootstrap 成功”

要求：

- 不复用于保存/编辑/设置等普通 fixture 测试
- 每次跑 bootstrap 场景前，必须保证：
  - 数据库侧没有默认数据残留
  - 本地 seed marker 不残留

变量：

- `E2E_BOOTSTRAP_USER_EMAIL`
- `E2E_BOOTSTRAP_USER_PASSWORD`
- `E2E_BOOTSTRAP_USER_ID`（可选但推荐，供白名单 reset 使用）

## 6. Reset Boundary

后续 reset 脚本只允许清理：

- `existing-user` 账号名下可重建业务数据
- `bootstrap` 账号名下为首次登录验证准备的数据

不允许：

- 对整张业务表做无条件清空
- 用宽条件误删其他用户数据
- 在正式生产项目上运行 reset

后续 Task 3 的脚本必须至少满足：

- 用户白名单保护
- 未知账号默认拒绝
- 连续跑两次结果一致

## 7. Minimum Fixture Expectation

Task 2 只定义契约，不实现 fixture。后续 Task 3 至少要准备：

- existing-user 账号
- bootstrap 账号
- 默认 `user_options`
- 默认 `user_contacts`
- 1-2 条编辑场景固定记录
- 需要时的固定 `letter_prefs`

## 8. Real Supabase Coverage Boundary

Stage 1 里，以下流程默认必须连真实 Supabase 测试项目：

1. 新建日记 -> 保存 -> RecordsPage 出现新记录
2. 编辑已有记录 -> 保存 -> 返回后显示新内容
3. 新用户首次登录 -> 默认数据 bootstrap 成功
4. 觉察流前进 / 后退 / 模式切换后的状态恢复

原因：

- 这些链路都依赖真实 Auth / RLS / insert / update / query / bootstrap 行为
- 全 mock 无法证明主链真的没炸

## 9. AI Boundary

Stage 1 的 AI 相关自动化不打真实模型。

后续 Task 3 默认策略：

- 页面仍走真实 Supabase
- AI 请求统一 stub
- 测“请求有没有发出、入口有没有切对、状态有没有保存”
- 不测真实模型文案质量

## 10. Suggested Local File Handling

推荐本地这样放：

```bash
cp .env.e2e.example .env.e2e.local
```

然后把真实值填进 `.env.e2e.local`。  
这个文件不应提交到仓库。

如果你习惯密码管理器或 shell profile，也可以把这些值放到本地 secret manager，只要最终脚本读取到的是同名变量即可。

## 11. Schema Sync Baseline (Task 3.5)

从 Task 3.5 开始，Stage 1 测试库 schema 同步不再依赖手工 dump/import。

仓库内基线位置：

- `supabase/config.toml`
- `supabase/migrations/20260503130000_stage1_schema_baseline.sql`

当前约定：

- 这份 baseline migration 代表“从现在开始”的正式 schema 基线
- 不追溯补齐过去每一次历史迁移
- 后续 schema 变更应在 `supabase/migrations/` 里继续追加新 migration

推荐同步方式：

1. 新测试库或空白测试库：

```bash
supabase db push --db-url "<test-db-session-pooler-uri>"
```

2. 像本轮这样，测试库已通过手工 SQL 导入过同一套 schema：

先登记 baseline 已存在：

```bash
supabase migration repair --status applied 20260503130000 --db-url "<test-db-session-pooler-uri>"
```

再用 `supabase migration list` 确认本地与远端版本一致。

目标不是一步到位建完整 CI/CD pipeline，而是把“测试库 schema 怎么同步”从手工网页操作，收口到仓库内可追踪 migration。

## 12. Current Status After Task 3.5

完成 Task 3.5 后，表示：

- 变量命名已固定
- 测试项目职责已固定
- 两类测试账号职责已固定
- reset 边界已固定
- 测试库 schema baseline 已进入仓库
- 测试库 schema 可通过 Supabase CLI migration 机制同步

但**还不表示**：

- Minimum gate 与 target batch 页面流程测试已全部落地

这些属于后续 Task 4 及之后。

## 13. Future Schema Change Workflow

后续如果主项目要改数据库表结构，统一按这套顺序走：

1. 在仓库内新建 migration 文件，不先去 Dashboard 手工改
2. 先把 migration 应用到测试 Supabase 项目
3. 跑相关验证：
   - `supabase migration list`
   - `node scripts/e2e/reset-fixtures.mjs`
   - `node scripts/e2e/create-auth-state.mjs`
   - 必要时再跑对应 Playwright 用例
4. 验证通过后，再把**同一份 migration** 应用到主项目

最简判断规则：

- 不改表结构：不用碰 migration
- 改表结构：必须先写 migration，先推测试项目，后推主项目

这样做的目的，是避免“主项目和测试项目 schema 漂移”，也避免重新回到手工 dump/import 的流程。

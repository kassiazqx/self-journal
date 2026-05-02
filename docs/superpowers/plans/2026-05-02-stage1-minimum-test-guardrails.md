# Stage 1 Minimum Test Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `self-journal` 建立 Stage 1 最小测试护栏：保留现有 `build` / `lint` / `node --test`，新增基于 Playwright 的页面流程级集成测试，并让 5 条最低门槛主链 + 2 条 Stage 1 默认追加主链具备可重复自动验证能力。

**Architecture:** 测试体系分三层：第一层保留现有 `lint` / `build` / `node --test`；第二层新增 Playwright 页面流程测试；第三层从页面流程测试中抽出最关键 smoke 集。数据策略采用“真实 Supabase 测试项目 + 专用测试账号 + reset/fixture 基线 + AI 请求 stub”的混合方案，保证数据库链路验证真实、AI 链路验证稳定。

**Tech Stack:** React, Vite, existing `node --test`, Playwright, Supabase test project, local storage abstraction, npm scripts

---

## File Structure

**Create**

- `playwright.config.ts` — Playwright 主配置，定义 `baseURL`、`webServer`、`projects`、`globalSetup`、`use` 默认项。
- `.env.e2e.example` — Stage 1 测试所需环境变量样例，避免把真实测试项目密钥写进文档正文。
- `e2e/global.setup.ts` — 统一准备测试环境，例如校验环境变量、生成登录态、确保测试前置就绪。
- `e2e/helpers/aiStub.ts` — 统一拦截并返回固定 AI 响应，避免在每条测试里重复写请求 stub。
- `e2e/helpers/auth.ts` — Playwright 登录辅助，负责复用或生成专用测试账号的登录态。
- `e2e/helpers/reset.ts` — 触发 reset/fixture 的 Node 侧入口，供 `globalSetup` 或测试前置调用。
- `e2e/minimum-gate/create-entry.spec.ts` — 新建日记保存并在记录页出现。
- `e2e/minimum-gate/start-modes.spec.ts` — 本地觉察入口与 AI 觉察入口两条起始模式主链。
- `e2e/minimum-gate/edit-entry.spec.ts` — 编辑已有记录保存后不闪旧。
- `e2e/minimum-gate/bootstrap.spec.ts` — 新用户首次登录默认数据 bootstrap 成功。
- `e2e/target-batch/awareness-state.spec.ts` — 觉察流前进 / 后退 / 模式切换后状态不丢。
- `e2e/target-batch/settings-persistence.spec.ts` — 代表性设置项刷新后仍保留。
- `scripts/e2e/reset-fixtures.mjs` — 清理测试账号数据并写回最小 fixture。
- `scripts/e2e/create-auth-state.mjs` — 为 Playwright 生成或刷新专用测试账号登录态。
- `docs/testing/stage1-e2e-setup.md` — 记录测试 Supabase 项目、测试账号、环境变量和 reset 约束。

**Modify**

- `package.json` — 安装依赖并注册 `test:unit` / `test:e2e` / `test:smoke` / `test:guardrails` 命令。
- `.gitignore` — 忽略 Playwright 认证态、报告目录、临时产物。
- `src/pages/HomePage.jsx` — 如有必要，仅添加稳定选择器，不改业务行为。
- `src/components/AwarenessFlow.jsx` — 如有必要，仅添加稳定选择器，不改核心流程行为。
- `src/pages/RecordsPage.jsx` — 如有必要，仅添加稳定选择器或更稳定的可断言文本锚点。
- `src/pages/SettingsPage.jsx` — 如有必要，仅添加稳定选择器。
- `src/components/MainLayout.jsx` — 仅在确有需要时补稳定选择器或路由锚点。
- `docs/arch-context.md` — 记录新引入的测试设施、命令入口和真实 Supabase 测试边界。

**Do Not Create**

- 不新增第二套组件测试框架（如 `Vitest` / `Jest` / `Testing Library`）。
- 不新增真实 AI 自动化测试。
- 不新增正式环境数据写入脚本。
- 不把 reset 逻辑写进业务运行时代码路径。

---

## Task List

### Task 0：读同步卡 + 确认 spec（代码 session 起始门槛）

**做什么**

- 读 `docs/session-protocol.md` §2.1 的代码 session 规则。
- 读 `docs/superpowers/plans/2026-05-02-stabilization-program.md` §Stage 1。
- 读 `docs/superpowers/specs/2026-05-02-stage1-minimum-test-guardrails.md` 全文。
- 读取本轮同步卡；如果尚无 `docs/sync-cards/2026-05-02-stage1-minimum-test-guardrails.md`，先向用户报告“当前以上游 spec 作为临时真源”，获得确认后再继续 Task 1。
- 输出代码 session 的标准确认句，列明当前主数据路径、本次任务涉及模块、与 spec 是否一致。

**产出物**

- 一条可复制到工作日志或评论中的上下文确认记录。
- 若同步卡缺失，一条明确的缺口说明与继续执行确认。

**验证方式**

- 人工核对确认句是否覆盖：主数据路径、涉及文件、与 spec 一致性三项。
- 如发现 spec 与代码现状不一致，必须停下来报告偏差，不进入后续 Task。

**如何手工验证这个 Task 对了**

- 让执行者把确认句贴出来，人工检查是否真的提到 `HomePage` / `AwarenessFlow` / `RecordsPage` / `SettingsPage` / `ensureDefaultUserData()` 这些 Stage 1 核心区域。

**依赖哪个前置 Task**

- 无

**Commit 边界**

- 不单独 commit；这是进入实现前的门槛任务。

---

### Task 1：建立 Playwright 测试底座

**做什么**

- 安装 `@playwright/test` 和运行所需浏览器。
- 建立 `playwright.config.ts`、`e2e/` 目录、基础 helper 目录、认证态与报告目录约定。
- 配置 `baseURL`、`webServer`、`Chromium` project、超时、截图/trace 策略。
- 补 `.gitignore`，避免把认证态、测试报告、临时文件提交进仓库。
- 确定 Stage 1 的稳定选择器策略：只在必要位置加稳定 selector，不把断言绑死在脆弱文案和样式上。

**产出物**

- 可运行的 Playwright 基础设施。
- 清晰的目录结构和忽略规则。
- 稳定选择器使用约定。

**验证方式**

- 运行 `npx playwright test --list` 能列出测试目录中的用例入口。
- 运行 `npx playwright test` 时，即使暂时无完整测试，也能正确启动 Vite dev server 并进入 Playwright 执行流程。

**如何手工验证这个 Task 对了**

- 手动执行一次 `npx playwright test --list`，确认 Playwright 配置生效、没有路径或配置报错。
- 检查 git 状态，确认认证态和测试报告目录不会被纳入版本控制。

**依赖哪个前置 Task**

- Task 0

**Commit 边界**

- 可独立 commit：`test(e2e): scaffold playwright baseline`

---

### Task 2：建立真实 Supabase 测试环境契约

**做什么**

- 定义 Stage 1 所需环境变量和命名约定，包括测试项目 URL、anon key、service role key、专用测试账号、专用 bootstrap 测试账号等。
- 新增 `.env.e2e.example`，并在 `docs/testing/stage1-e2e-setup.md` 中记录：
  - 如何创建独立 Supabase 测试项目
  - 如何创建专用测试账号
  - 哪些表/数据必须允许 reset
  - 哪些测试账号专门用于“已有数据”场景，哪些专门用于“brand-new user”场景
- 明确真实 Supabase 覆盖边界：保存、编辑、bootstrap、觉察流状态恢复这四类流程必须连真实测试项目。
- 写死两类账号职责：
  - `existing-user e2e account` 只用于保存、编辑、设置、觉察流恢复等常规流程
  - `brand-new bootstrap account` 只用于 Task 6，禁止复用于其他 fixture 测试

**产出物**

- 一份可执行的测试环境设置文档。
- 一份环境变量样例文件。
- 对测试账号职责的明确约定。

**验证方式**

- 人工按照文档检查，确认任何新执行者都知道要准备哪些值。
- 运行一次环境检查命令，确认关键变量齐全后才能继续后续 Task。

**如何手工验证这个 Task 对了**

- 让一个不了解当前细节的人只看 `docs/testing/stage1-e2e-setup.md` 和 `.env.e2e.example`，判断是否能说清楚“去哪建测试项目、填哪些变量、哪些账号拿来做什么”。

**依赖哪个前置 Task**

- Task 1

**Commit 边界**

- 可独立 commit：`docs(test): define stage1 supabase e2e env contract`

---

### Task 3：实现 reset / fixture / 登录态准备工具

**做什么**

- 编写 `scripts/e2e/reset-fixtures.mjs`，负责：
  - 清空专用测试账号的可重建业务数据
  - 为编辑场景写回最小基线记录
  - 为设置场景准备最小本地/数据库前置
  - 为 bootstrap 场景保留空白测试用户
- 编写 `scripts/e2e/create-auth-state.mjs` 与 `e2e/helpers/auth.ts`，统一生成 Playwright 可复用登录态。
- 编写 `e2e/helpers/reset.ts`，把 reset 流程接入 Playwright `globalSetup` 或每组测试前置。
- 编写 `e2e/helpers/aiStub.ts`，统一 stub AI 请求，固定返回可断言文本，并校验请求是否真的发出、是否命中正确 provider endpoint、以及 body 中是否包含当前 entry 上下文。
- 为 reset 工具增加硬保护：
  - 只能按白名单测试账号 `user_id` 清理
  - 禁止按整表或宽条件清理
  - 遇到未知账号默认拒绝执行

**产出物**

- 可重复调用的 reset/fixture 工具链。
- 可复用的 Playwright 登录态。
- 统一 AI stub 能力。

**验证方式**

- 连续运行两次 reset，第二次结果仍应成功，且基线状态一致。
- 在不手工登录的前提下，通过登录态直接打开已登录页面。
- 触发 AI 入口时，确认命中 stub 而不是打真实模型，并且请求形状校验通过。

**如何手工验证这个 Task 对了**

- 手动跑两次 reset 脚本，然后进测试项目后台或页面看：编辑用示例记录始终是同一套，bootstrap 专用账号始终保持空白。
- 手动执行一次“点 `✦` 进入 AI 觉察”，确认页面能进入 AI 模式但不会消耗真实 token。

**依赖哪个前置 Task**

- Task 2

**Commit 边界**

- 可独立 commit：`test(e2e): add reset fixtures auth and ai stubs`

---

### Task 4：实现 Minimum gate 前三条主链

**做什么**

- 在 `e2e/minimum-gate/create-entry.spec.ts` 与 `e2e/minimum-gate/start-modes.spec.ts` 中落地以下三条：
  - 新建日记 -> 保存 -> `RecordsPage` 出现新记录
  - 新建日记 -> 默认进入本地觉察卡起始模式
  - 新建日记 -> 点 `✦` -> 正确进入 AI 觉察起始模式
- 只在确有需要时为 `HomePage`、`MainLayout`、`AwarenessFlow` 补稳定选择器。
- 给需要进入 smoke 的用例打统一标记，便于后续 `test:smoke` 复用。
- 在 AI 入口相关断言中，同时验证 stub 记录到了真实发出的请求，而不是只验证 UI 切换结果。

**产出物**

- 3 条可重复执行的页面流程测试。
- 必要的稳定选择器补充。

**验证方式**

- 单独运行这两个 spec 文件，三条用例全部通过。
- 在测试失败时，能从截图/trace 看出是保存链、入口链还是模式判断链出了问题。

**如何手工验证这个 Task 对了**

- 本地手动再走一遍这三条流程，确认自动化覆盖的路径和真人操作路径一致，不是靠“隐藏捷径”通过。

**依赖哪个前置 Task**

- Task 3

**Commit 边界**

- 可独立 commit：`test(e2e): cover create and start mode minimum gates`

---

### Task 5：实现 Minimum gate 第四条主链

**做什么**

- 在 `e2e/minimum-gate/edit-entry.spec.ts` 中落地“编辑已有记录 -> 保存 -> 返回后显示新内容，不闪旧”。
- 使用 reset 产出的固定 fixture 记录进入编辑页，验证：
  - 编辑后保存成功
  - 返回列表或详情页后看到的是新内容
  - 刷新后仍是新内容，而不是缓存中的旧值
- 必要时为 `RecordsPage`、`EditEntryPage`、`RecordDetail` 增补稳定选择器。

**产出物**

- 1 条覆盖编辑保存与新旧值一致性的页面流程测试。

**验证方式**

- 单独运行 `e2e/minimum-gate/edit-entry.spec.ts` 通过。
- 故意把断言内容改回旧文本时，应能稳定失败，证明测试确实在守“新旧值切换”而不是只守“按钮能点”。

**如何手工验证这个 Task 对了**

- 手工编辑同一条固定记录，保存后立刻返回，再刷新页面，确认 UI 没有闪回旧内容。

**依赖哪个前置 Task**

- Task 3

**Commit 边界**

- 可独立 commit：`test(e2e): cover edit save no stale minimum gate`

---

### Task 6：实现 Minimum gate 第五条主链

**做什么**

- 在 `e2e/minimum-gate/bootstrap.spec.ts` 中落地“新用户首次登录 -> 默认数据 bootstrap 成功”。
- 使用专门的 brand-new 测试账号，确保其数据库和本地 marker 都处于空白基线。
- 断言首次登录后，默认数据初始化完成，且符合当前 `ensureDefaultUserData()` 的分流规则。
- 额外断言同一账号再次进入时不会重复 reseed。

**产出物**

- 1 条真实 Supabase 的新用户初始化主链测试。

**验证方式**

- 单独运行 `e2e/minimum-gate/bootstrap.spec.ts` 通过。
- 连续跑两次：第一次验证“会 seed”，第二次验证“不会重复 seed”。

**如何手工验证这个 Task 对了**

- 用 bootstrap 专用测试账号真实登录一次，进入相关页面查看默认分类/联系人/需求是否已出现；退出再登录，确认不会重复插入或异常增加。

**依赖哪个前置 Task**

- Task 3

**Commit 边界**

- 可独立 commit：`test(e2e): cover new user bootstrap minimum gate`

---

### Task 7：实现 Stage 1 target batch 第六条主链

**做什么**

- 在 `e2e/target-batch/awareness-state.spec.ts` 中落地“觉察流前进 / 后退 / 模式切换后，当前进度和输入不丢”。
- 覆盖至少一个本地觉察前进/后退场景，以及一个本地 -> AI 或 AI -> 本地切换场景。
- 该任务必须走真实 Supabase 测试项目，验证 `conversations` 等持久化链真实生效；AI 文本继续使用 stub。
- 在涉及 AI 切换的场景中，同时断言 stub 捕获到了正确请求，不允许仅靠模式切换 UI 通过。

**产出物**

- 1 组覆盖觉察流状态保存/恢复的页面流程测试。

**验证方式**

- 单独运行 `e2e/target-batch/awareness-state.spec.ts` 通过。
- 在测试中加入刷新或重开步骤后，先前输入仍可恢复。

**如何手工验证这个 Task 对了**

- 手工在觉察流中输入内容，前进、后退、切到 AI，再回来，确认内容和当前步骤不会莫名重置。

**依赖哪个前置 Task**

- Task 4
- Task 3

**Commit 边界**

- 可独立 commit：`test(e2e): cover awareness state target batch`

---

### Task 8：实现 Stage 1 target batch 第七条主链

**做什么**

- 在 `e2e/target-batch/settings-persistence.spec.ts` 中落地代表性设置项持久化：
  - 必选：AI provider / API Key
  - 可选：回顾信偏好
- 验证设置修改后刷新页面仍保留，且重新进入设置页能读到同样值。
- 只在需要时为 `SettingsPage` 补稳定选择器。

**产出物**

- 1 组代表性设置持久化页面流程测试。

**验证方式**

- 单独运行 `e2e/target-batch/settings-persistence.spec.ts` 通过。
- 删除或清空浏览器上下文后重新生成登录态，再进入设置页，断言值仍符合持久化预期。

**如何手工验证这个 Task 对了**

- 手工修改一项设置并刷新浏览器，看值是否仍在；关闭页面再打开一次，看是否还能读回来。

**依赖哪个前置 Task**

- Task 3

**Commit 边界**

- 可独立 commit：`test(e2e): cover settings persistence target batch`

---

### Task 9：注册测试命令并定义 smoke 集

**做什么**

- 在 `package.json` 中注册：
  - `test:unit`
  - `test:e2e`
  - `test:smoke`
  - `test:guardrails`
- 明确 `test:smoke` 只跑 `Minimum gate` 5 条，不把第 6、7 条强行塞进最小回归集。
- 补充文档，说明：
  - 何时跑 `test:guardrails`
  - 何时跑全量 `test:e2e`
  - AI 改动、状态流改动、持久化改动前后至少跑哪一层

**产出物**

- 统一的测试命令入口。
- smoke 集与全量 e2e 集的边界约定。

**验证方式**

- 分别运行四个命令，确认：
  - `test:unit` 走现有 `node --test`
  - `test:e2e` 跑全量 7 条
  - `test:smoke` 跑 5 条 minimum gate
  - `test:guardrails` 串起 lint/build/unit/smoke

**如何手工验证这个 Task 对了**

- 执行 `npm run test:smoke`，人工数一遍实际跑了哪些用例，确认确实是最关键的 5 条，不多不少。

**依赖哪个前置 Task**

- Task 4
- Task 5
- Task 6
- Task 7
- Task 8

**Commit 边界**

- 可独立 commit：`chore(test): add stage1 guardrail commands`

---

### Task 10：跑通 guardrails、收尾文档、确认 Stage 1 达标

**做什么**

- 运行一次完整 `npm run test:guardrails`。
- 运行一次完整 `npm run test:e2e`，确认 7 条默认目标全部通过。
- 更新 `docs/arch-context.md`，补最终记录：
  - Playwright 已进入项目
  - 哪些流程走真实 Supabase
  - 哪些流程 stub AI
  - 新的测试命令入口
- 汇总 Stage 1 最终结果，确认已满足总纲 `§Stage 1` exit condition。

**产出物**

- 一次完整通过的 guardrails 运行结果。
- 一次完整通过的 7 条 e2e 运行结果。
- 架构文档中的测试设施更新。

**验证方式**

- `npm run test:guardrails` 通过。
- `npm run test:e2e` 通过。
- 人工核对 `docs/arch-context.md` 是否已记录新的测试设施边界。

**如何手工验证这个 Task 对了**

- 让执行者展示最终命令输出摘要，并人工核对：最低 5 条 minimum gate 和默认 7 条目标都已真实落地，而不是只写了空目录或跳过测试。

**依赖哪个前置 Task**

- Task 9

**Commit 边界**

- 可独立 commit：`docs(test): finalize stage1 minimum guardrails`

---

### Task 10.5：补记测试设施架构上下文

**做什么**

- 在 Task 1 或 Task 3 完成后，尽早更新一次 `docs/arch-context.md`，记录：
  - 项目已引入 Playwright 页面流程测试
  - 真实 Supabase 测试项目的使用边界
  - AI 请求在自动化中统一 stub 的原则
  - reset/fixture 工具与运行时代码隔离的原则

**产出物**

- 一次中途架构文档更新，避免测试设施落地后文档长期空白。

**验证方式**

- 人工核对 `docs/arch-context.md` 是否已经能反映 Stage 1 测试设施边界，而不是要等全部任务结束才第一次记录。

**如何手工验证这个 Task 对了**

- 打开 `docs/arch-context.md`，确认即使项目停在 Task 4-8，中途读文档的人也能知道 Playwright、真实 Supabase、AI stub 的基本边界。

**依赖哪个前置 Task**

- Task 1 或 Task 3

**Commit 边界**

- 可并入 `Task 1` 或 `Task 3` 的 commit，不单独拆新 commit。

---

## Spec Coverage Check

- `目标`：Task 1, Task 3, Task 9, Task 10 负责把基础护栏、命令入口、最终验证串起来。
- `Non-goals`：全计划没有引入第二套组件测试框架，没有要求真实 AI 测试，没有覆盖 Threads / Review Letter / 导出 / 图片上传。
- `核心主链清单`：
  - Minimum gate 1-3 → Task 4
  - Minimum gate 4 → Task 5
  - Minimum gate 5 → Task 6
  - Stage 1 target batch 6 → Task 7
  - Stage 1 target batch 7 → Task 8
- `工具选型`：Task 1 只引入 Playwright；Task 9 把命令边界固定为 `unit/e2e/smoke/guardrails`。
- `测试数据策略`：Task 2 和 Task 3 负责真实 Supabase 测试项目、测试账号、reset/fixture、AI stub。
- `测试命令`：Task 9 落地所有命令；Task 10 跑通最终验证。
- `通过标准`：Task 10 负责核对“minimum gate 至少 5 条自动验证”和“本轮 7 条默认目标全部落地”。

## Placeholder Scan

- 无 `TODO` / `TBD` / “以后再说” 占位项。
- 对外部条件（同步卡暂缺、测试 Supabase 项目需先创建）都在对应 Task 中写明了进入条件和验证方式。

## Execution Notes

- 每个 Task 设计为可独立 commit。
- Task 4 到 Task 8 尽量一条主链或一组同类主链一个 commit，避免把所有 e2e 一次性压成一个大改动。
- 如果执行中发现现有 UI 缺少稳定选择器，优先做“最小选择器补充”，不要顺手重构业务页面。
- 如果执行中发现 spec 与代码现状不一致，返回 Task 0 的偏差处理流程，不自行拍板修正。

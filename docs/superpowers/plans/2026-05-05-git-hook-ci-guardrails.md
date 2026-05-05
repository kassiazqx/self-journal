# Git Hook And CI Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Stage 1 测试护栏补上本地 git hook 和远端 CI 兜底，让提交前能自动拦截明显回归，推送后还能在 GitHub Actions 里复跑同一套关键验证。

**Architecture:** 本地用仓库内的 git hooks 目录 + `core.hooksPath` 激活，不引入额外 hook 框架；CI 用 GitHub Actions 跑同一套 npm 命令，并通过 secrets 生成测试环境文件。这样 hook 负责方便，CI 负责兜底，且两者都复用现有 Playwright / Supabase 测试设施。Workflow 支持 `push` / `pull_request` / 手动 `workflow_dispatch`。

**Tech Stack:** npm scripts, git hooks, GitHub Actions, existing Playwright E2E, Supabase test project, Node.js

---

## File Structure

**Create**

- `.githooks/pre-commit` - 提交前自动跑最小 smoke。
- `.githooks/pre-push` - 推送前自动跑 guardrails，给更重的本地兜底。
- `scripts/setup-git-hooks.mjs` - 把仓库的 `core.hooksPath` 指向 `.githooks`，让 hooks 自动生效。
- `.github/workflows/ci.yml` - GitHub Actions CI，跑 lint/build/unit/smoke 和全量 e2e。

**Modify**

- `package.json` - 增加 `postinstall` 或等价安装入口，自动执行 hook 激活脚本。
- `docs/testing/stage1-e2e-setup.md` - 记录本地 hook 触发方式、CI 需要的 secrets、以及哪些命令会自动跑。
- `docs/arch-context.md` - 记录 hook / CI 作为 Stage 1 测试设施的一部分。

**Do Not Create**

- 不引入 Husky / lint-staged 之类新框架。
- 不把测试逻辑塞进业务运行时代码。
- 不新增第二套测试框架。

---

## Task List

### Task 1: Local Git Hooks

**做什么**

- 新建仓库内 `.githooks/` 目录。
- `pre-commit` 只跑 `npm run test:smoke`。
- `pre-push` 跑 `npm run test:guardrails`。
- 新建 `scripts/setup-git-hooks.mjs`，自动把 `core.hooksPath` 设为 `.githooks`。
- 在 `package.json` 增加安装时自动激活入口，避免用户手动配置。

**验证方式**

- `git config --local core.hooksPath` 输出仓库内 `.githooks`。
- 直接执行 `.githooks/pre-commit` 能启动 `npm run test:smoke`。
- 直接执行 `.githooks/pre-push` 能启动 `npm run test:guardrails`。

**如何手工验证这个 Task 对了**

- 本地做一次无关小修改并 `git commit`，确认 pre-commit 会先跑 smoke。
- 本地跑一次 `git push` 前的 hook，确认 guardrails 会先跑。

**依赖哪个前置 Task**

- 无

**Commit 边界**

- 可独立 commit：`chore(git): add local hook guardrails`

### Task 2: GitHub Actions CI

**做什么**

- 新建 `.github/workflows/ci.yml`。
- Workflow 在 `push` 和 `pull_request` 时触发。
- 先跑 `npm ci`、`npm run lint`、`npm run build`、`npm run test:unit`、`npm run test:smoke`。
- 再用 secrets 生成 `.env.e2e.local`，跑 `npm run test:e2e`。
- 对缺少必要 secrets 的情况给出明确失败信息。

**验证方式**

- YAML 语法正确。
- 本地能看懂 workflow 每一步会跑什么命令。
- 如果 CI secrets 配齐，workflow 能完成同一套 Stage 1 验证。

**如何手工验证这个 Task 对了**

- 在 GitHub Actions 页面通过 `workflow_dispatch` 手动触发一次 workflow，确认日志里能看到 guardrails 和 e2e 两段。

**依赖哪个前置 Task**

- Task 1

**Commit 边界**

- 可独立 commit：`ci(test): add stage1 guardrail workflow`

### Task 3: Docs And Final Verification

**做什么**

- 更新 `docs/testing/stage1-e2e-setup.md`，说明 hook / CI 的触发方式和 secrets 需求。
- 更新 `docs/arch-context.md`，记录本地 hook、CI 以及它们和 Stage 1 测试命令的关系。
- 运行 `npm run lint`。
- 运行至少一次 `npm run test:smoke` 或 `npm run test:guardrails`，确认本地 hook 相关代码没有破坏现有流程。

**验证方式**

- 文档与实现对齐。
- 现有 Stage 1 命令继续可跑。

**如何手工验证这个 Task 对了**

- 打开 `docs/testing/stage1-e2e-setup.md`，确认能说清楚什么时候本地自动跑、什么时候 CI 兜底。

**依赖哪个前置 Task**

- Task 1
- Task 2

**Commit 边界**

- 可独立 commit：`docs(test): record hook and ci guardrails`

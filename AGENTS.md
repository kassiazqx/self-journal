# Codex 启动桥接

本文件给 Codex / 兼容 AGENTS.md 的代码代理使用。
如与用户当轮明确指令冲突，以用户指令为准。

## 启动读取顺序

- 开始任何任务前，优先读取 `.codex-links/project/CLAUDE.md`
- 再读取 `.codex-links/global/CLAUDE.md`
- 将 `.codex-links/rules/01-general.md`、`.codex-links/rules/02-code-standards.md`、`.codex-links/rules/03-dev-ops.md`、`.codex-links/rules/04-token-efficiency.md` 视为当前项目有效规则
- 涉及代码实现、重构、调试、审查时，再读取 `.codex-links/docs/coding-lessons.md` 和 `.codex-links/docs/arch-context.md`
- 需要跨会话偏好或删除安全约束时，读取 `.codex-links/memory/MEMORY.md`、`.codex-links/memory/feedback_chinese_thinking_preference.md`、`.codex-links/memory/feedback_arch_verification_rule.md`

## Skills 默认流程

- 每次新会话或接到新任务时，优先使用 `using-superpowers`
- `~/.agents/skills` 中的技能都视为已安装；其中指向 `~/.claude/skills` 的软链接技能也视为真实可用技能
- 若技能适用，先按技能规则决定工作流，再开始搜索、提问、改文件或执行命令

## 默认技能偏好

- `caveman` 默认开启，除非用户明确要求恢复正常表达
- 遇到高风险、不可逆操作、复杂确认步骤时，可以暂时切回更清晰的完整表达，确认后恢复 `caveman`
- `rtk` 作为条件默认技能：当任务涉及 Redux、Redux Toolkit、slice、store、thunk、RTK Query 时自动启用
- 非 Redux 任务不要强行套用 `rtk`
- 优先关注这些 Claude 技能是否适用：`arch-review`、`verification-before-completion`、`systematic-debugging`、`test-driven-development`

## 当前项目额外约束

- 当前项目以既有 React Context / 现有架构为准，不默认引入 Redux
- 讨论状态管理方案时，先尊重现有实现，再判断 `rtk` 是否真的适用

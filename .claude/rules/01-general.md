# General Working Rules

## 1. Task Tracking
For tasks with **3+ steps** ALWAYS:
- Use task tracking to manage work items
- Create each step as a task BEFORE starting
- Mark each task as completed immediately when done

## 2. Keep Documentation Modular
- Don't create sprawling status files
- Updates belong in the matching doc (feature docs, architecture docs)
- Keep a clean separation of concerns

## 3. Before Coding
- When unclear: Ask first, then implement
- When multiple approaches exist: Present options and wait for decision

## 4. When Things Go Wrong: STOP & Re-plan
- If an approach isn't working: **Stop immediately**, don't keep pushing
- Re-plan instead of repeating the same mistake
- Find root causes — no temporary workarounds or hacks
- Ask yourself: "Is this the elegant solution or a quick-fix?"

## 5. Verification: Diff Against Main Before "Done"
- Before claiming "done": run `git diff main` to check all changes are intentional
- Ask yourself: "Would a staff engineer approve this?"
- Build must be green
- No unintended changes in unrelated files

## 6. Design Documentation
When making design decisions, document the process:
- Summary of final decisions
- Questions asked with options and chosen answers
- Reasoning for each choice
- Technical details
- Open points

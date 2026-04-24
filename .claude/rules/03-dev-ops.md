# DevOps & Deployment Rules

## Git Discipline
- Separate concerns in commits (app code vs. infrastructure vs. docs)
- Write descriptive commit messages explaining WHY, not just WHAT
- Never force-push to main/master without team agreement

## Environment Variables
- New env vars must be documented
- Never commit .env files with real values
- Provide .env.example with placeholder values

## Port Management
- Stick to one dev server port — don't spawn multiple
- Kill orphan processes before starting new dev servers

## Build Verification
- Always run build/lint before committing
- Fix warnings, don't suppress them
- Keep CI/CD pipeline green

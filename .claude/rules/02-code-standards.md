# Code Standards

## Security First
- Never commit secrets, API keys, or credentials
- Validate all external input
- Use parameterized queries for databases
- Follow OWASP Top 10 guidelines

## Code Quality
- Write self-documenting code with clear naming
- Keep functions focused (single responsibility)
- Prefer composition over inheritance
- Handle errors explicitly — no silent catches

## Testing
- Write tests for new features and bug fixes
- Test edge cases and error paths
- Don't mock what you don't own — use integration tests where possible

## Internationalization (if applicable)
- No hardcoded user-facing strings
- Use your project's i18n solution consistently
- Keep translation files in sync across locales

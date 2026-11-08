# Repository guidance

- `docs/requirements.md` and `docs/data-model.md` are authoritative. Do not infer or silently change financial behavior.
- Work only within the scope of the assigned GitHub issue. Use a dedicated feature branch and a scoped pull request; do not merge without owner approval.
- Ask the product owner before changing any financial semantics or making a deferred product decision.
- Never commit credentials, secrets, or real personal financial data. Keep environment files local; `.env.example` may contain placeholders only.
- Clearly label unavailable or placeholder product states. Do not present sample financial values as real user data.
- Keep the architecture modular and lean. Add dependencies only when the issue requires them.
- Run the documented lint, typecheck, and build checks before opening a pull request.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

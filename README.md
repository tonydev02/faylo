# Faylo

Faylo is a mobile-first personal finance workspace. Product behavior is defined by [Requirements v0.2](docs/requirements.md) and [Data model v0.2](docs/data-model.md).

## Local setup

Requirements: Node.js 24 and npm 11 or later. The repository includes an `.nvmrc` for Node 24.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The current app is a foundation preview; authentication, account storage, and financial actions are not connected.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```

GitHub Actions runs the same checks for pull requests and pushes to `main`.

## Configuration

No environment variables are needed for the foundation preview. `.env.example` contains placeholders for future integration only; never commit local environment files, credentials, or real financial data.

## Contribution workflow

Work only within the assigned GitHub issue. Create a dedicated feature branch, submit a scoped pull request that references the issue, and do not merge without owner approval. Treat the product requirements and data model as authoritative; ask the product owner before changing financial semantics or making deferred product decisions.

The approved visual identity is dark forest `#0B211B`, forest `#174A39`, mint `#80C7A2`, and off-white `#EFF8F0`. The Taste design skill was not available in the implementation environment; disclose this when reporting frontend work rather than claiming it was used.

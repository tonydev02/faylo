# Faylo

Faylo is a mobile-first personal finance workspace. Product behavior is defined by [Requirements v0.2](docs/requirements.md) and [Data model v0.2](docs/data-model.md).

## Local setup

Requirements: Node.js 24 and npm 11 or later. The repository includes an `.nvmrc` for Node 24.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app connects to Supabase for approved-owner authentication, accounts, and transaction history. Configure local credentials in `.env.local` and follow the [authentication guide](docs/authentication.md); apply migrations and run database checks as described in [database documentation](docs/database.md). Do not point local commands at the hosted Faylo project.

## Checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:db
npm run test:browser
```

GitHub Actions runs the application, database, and browser smoke checks for pull requests and pushes to `main`.

## Configuration

Copy `.env.example` to `.env.local`, then follow the [Google OAuth and Supabase setup guide](docs/authentication.md). The template contains placeholders only; never commit `.env.local`, credentials, service-role keys, or real financial data.

The Supabase URL and publishable key are public project identifiers. `APP_URL` and `SUPABASE_OWNER_USER_ID` are read only by server code. No service-role key is required.

## Contribution workflow

Work only within the assigned GitHub issue. Create a dedicated feature branch, submit a scoped pull request that references the issue, and do not merge without owner approval. Treat the product requirements and data model as authoritative; ask the product owner before changing financial semantics or making deferred product decisions.

The approved visual identity is black-first: near-black canvas and chrome, neutral charcoal surfaces, off-white text, and restrained Forest/Accent highlights. See the [design system](docs/design-system.md); it is authoritative for visual direction.

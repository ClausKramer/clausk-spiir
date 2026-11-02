# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Spiir is a self-hosted replacement for Spiir.dk (a defunct Danish personal finance service). It pulls bank
transactions via the Enable Banking API (PSD2 open banking), stores them locally, and categorizes them with
a rule-based engine that falls back to the Claude API for unmatched transactions.

There was an earlier Python prototype (`schema.sql`, `categorize.py`, `gocardless.py`, `db.py`) whose domain
decisions (categorization rules, dedup strategy) were ported into this C#/React rewrite — it is not part of
this repo, treat it only as historical context if referenced in conversation.

## Stack

- Backend: .NET 10, ASP.NET Core Minimal APIs (no controllers), Dapper + Azure SQL / SQL Server
- Frontend: React 19 + TypeScript, Vite, TanStack Query, React Router, Tailwind CSS v4
- Auth: passwordless magic-link → short-lived JWT access token + httpOnly refresh cookie
- Infra: Bicep + azd (Container Apps, Static Web Apps, Azure SQL, Key Vault) — see `infra/` and `azure.yaml`

## Commands

### Backend (`backend/Spiir.Api`)

```bash
cd backend/Spiir.Api
dotnet build
dotnet run --launch-profile http      # → http://localhost:5218, OpenAPI at /openapi/v1.json
```

There are no automated tests in this repo yet. The schema auto-applies on every startup via
`Data/DatabaseMigrator.MigrateAsync` (awaited in `Program.cs`, scripts in `Schema/*.sql`) — no
separate migrate step. To add a schema change, add a new numbered `Schema/000N_*.sql` file; the
migrator tracks applied scripts in a `SchemaVersions` table and only runs new ones. This is a
small hand-rolled runner over `IDbConnectionFactory`/Dapper, not DbUp — DbUp's own connection
handling crashed the process on Azure Container Apps (native SIGSEGV against Entra-authenticated
Azure SQL); see CHANGELOG.md for the full story before reintroducing it.

Local dev needs a real SQL Server instance (SQLite was dropped — see CHANGELOG.md). The default
connection string in `appsettings.json` points at SQL Server LocalDB
(`(localdb)\MSSQLLocalDB`); create the database once with:

```bash
sqlcmd -S "(localdb)\MSSQLLocalDB" -Q "CREATE DATABASE spiir;"
```

One-time secret setup (JWT signing key must exist before the API will start):

```bash
dotnet user-secrets set "Jwt:Key" "$(openssl rand -base64 32)"
```

Enable Banking is optional for local dev — without it, `/institutions` and bank connection just 502.
To wire it up: register an application at the Enable Banking control panel (free "Restricted Production"
tier is enough for linking your own accounts), which downloads a private key `.pem` file, then:

```bash
dotnet user-secrets set "EnableBanking:ApplicationId" "<application id>"
dotnet user-secrets set "EnableBanking:PrivateKey" "$(cat path/to/your-app-id.pem)"
```

Magic-link email is also optional locally — without `Resend:ApiKey` set, `Program.cs` falls back to
`DevConsoleSender` (the normal dev flow described above). To send real email via Resend:

```bash
dotnet user-secrets set "Resend:ApiKey" "<resend api key>"
dotnet user-secrets set "Resend:FromAddress" "Spiir <you@yourdomain.com>"  # domain must be verified in Resend
```

### Frontend (`frontend`)

```bash
cd frontend
npm run dev        # → http://localhost:5173, proxies /api/* to localhost:5218
npm run build       # tsc -b && vite build
npm run lint
```

### Magic-link login in dev

No real email is sent. Submit any email on `/login`; the magic-link URL is printed to the **backend console**
(also readable via `GET /dev/last-magic-link`, a dev-only endpoint). Opening that URL completes login and
lands on `/dashboard`.

## Architecture

### Feature-folder backend layout

Endpoints, not controllers: each `Features/<Area>/` folder has an `*Endpoints.cs` with a `Map<Area>Endpoints`
extension method registered in `Program.cs`, using `TypedResults` and `MapGroup`. Follow this pattern —
`Auth`, `Users`, `Transactions`, `Categories`, `Accounts`, `Sync` — when adding new endpoint groups.

### Multi-tenant isolation is enforced per-repository-method, not automatically

Every domain entity (`BankAccount`, `Transaction`, `Category`, `CategorizationRule`, `Requisition`) carries a
non-nullable `UserId`. There is **no global query filter** (that was an EF Core mechanism, removed with EF —
see CHANGELOG.md). Instead, each repository in `Data/Repositories/*` takes `Guid userId` explicitly on every
method that touches tenant-scoped data and bakes `WHERE UserId = @userId` into the SQL itself. Endpoints must
never read the `sub` claim directly — always go through the scoped `ICurrentUser`
(`Services/ICurrentUser.cs` / `CurrentUserService.cs`), then pass the resolved `userId` into the repository call.

When adding a new entity that belongs to a user, add the `UserId` column **and** thread `userId` through every
repository method for it — there is no safety net catching a missed filter, unlike the old EF Core setup. When
adding a new repository method, default to scoping it by `userId` unless you have a specific reason not to
(e.g. looking up a token by its hash, where the caller doesn't have a userId yet).

### Auth flow

Magic link → JWT + refresh cookie, detailed end-to-end in `docs/architecture.md`. Key points:
- Raw tokens are never persisted — only SHA-256 hashes (`MagicLinkToken`, `RefreshToken`).
- Magic-link tokens: 15 min TTL, single-use. JWT access tokens: 15 min TTL, HS256, claims `sub` + `email`.
  Refresh tokens: 180-day sliding TTL (renewed on every use, so an active user never hits the
  cap), rotated every use, httpOnly cookie scoped to `/auth`, `SameSite=None` in production
  (frontend and API are on different domains — `Strict`/`Lax` would silently drop the cookie on
  every cross-site refresh call) and `SameSite=Strict` in dev (same-origin via Vite's proxy).
- The auth abstraction is `IPasswordlessAuthenticator` (`Features/Auth/`), implemented by
  `PasswordlessAuthenticator` — deliberately generic so passkeys/WebAuthn can be added later as an alternate
  implementation without touching endpoints.
- `IEmailSender` → `ResendEmailSender` when `Resend:ApiKey` is configured (production), falling back to
  `DevConsoleSender` (writes to console + a temp file read by `/dev/last-magic-link`) otherwise — the
  swap happens once, in `Program.cs`, based on config; don't add real email logic inline in auth endpoints.

### Categorization engine

`ICategorizationEngine` (`Features/Categorization/`) → `RuleBasedCategorizationEngine` matches a transaction
description against a user's `CategorizationRule` rows, ordered by `Priority` desc then `Id`. Rules are either
plain case-insensitive substring matches (`IsRegex = false`) or regex (`IsRegex = true`, needed for anchors/
alternation). Unmatched transactions fall back to `ClaudeCategorizationFallback` (Anthropic API, named
`HttpClient` "Anthropic" configured in `Program.cs`).

`Transaction.IsCategoryManual = true` marks a user-assigned category as authoritative — re-categorization on
resync must skip these transactions.

Default categories (15) and merchant rules (22+, Danish patterns — grocery chains, transport, streaming, etc.)
are seeded per-user at registration by `DefaultDataSeeder.SeedForUserAsync` (`Data/DefaultDataSeeder.cs`).

### Enable Banking sync

`IEnableBankingClient` (`Infrastructure/EnableBanking/`) implements the PSD2 authorization → session →
account/transaction flow; `Features/Sync/SyncEndpoints.cs` is the only caller of `GetTransactionsAsync`.
PSD2's RTS on strong customer authentication caps AISP polling at ~4 calls/day per account without customer
interaction, so sync must stay **on-demand only, never on page load**, with all UI reads hitting the local
database. Incoming transactions dedup on `(UserId, ExternalTransactionId)` (unique index, renamed from
`GoCardlessTransactionId` by `Schema/0002_RenameGoCardlessToEnableBanking.sql`).

GoCardless's Bank Account Data API (the original open-banking provider this app was built around) stopped
accepting new signups in July 2025 and is being wound down — see CHANGELOG.md for the swap to Enable
Banking. Enable Banking is itself the regulated AISP/TPP (like GoCardless was), so this app never needs its
own eIDAS certificate or TPP license — only an application ID + RSA private key from Enable Banking's
control panel. Its **free "Restricted Production"** tier covers this project's actual use case (a self-hosted
app linking only the operator's own bank accounts, pre-authorized in the Enable Banking control panel) with
no paid plan required. A bank is identified by `(name, country)` — there's no single institution id like
GoCardless's — and the connect flow has one fewer round trip: `POST /auth` returns a redirect `url` directly
(no separate "requisition" polling step), the user completes consent at their bank, and the callback's
`code` query param is exchanged via `POST /sessions` for the account list.

### CSV import (history older than Enable Banking can provide)

`POST /accounts/{id}/import-csv` (`AccountEndpoints.ImportCsv`, `.DisableAntiforgery()` — Bearer-token
auth has no ambient credential for CSRF to ride on, so the default antiforgery requirement Minimal APIs
attach to any form-binding endpoint doesn't apply and isn't otherwise configured in this app) backfills
transactions a bank consent can't reach. `Infrastructure/CsvImport/TransactionCsvParser.cs` is pure parsing
(no I/O, easy to test in isolation) — forgiving about delimiter (`,`/`;`), decimal separator, and date
format, but expects a header row naming Date/Description/Amount columns (common Danish/English aliases
recognized). Rows dedup on a synthetic `csv:<hash>` `ExternalTransactionId` (deterministic per
date+amount+description, so re-uploading the same file is a no-op) since CSV rows have no bank-assigned id
the way synced ones do. An optional Category column matches against the user's existing categories by name
(sets `IsCategoryManual = true`); otherwise rows run through the same `ICategorizationEngine` sync uses.

### Frontend structure

`src/api/*.ts` — one file per backend feature area, using an Axios client (`api/client.ts`) that carries the
refresh cookie. `src/hooks/useAuth.ts` + `components/ProtectedRoute.tsx` gate authenticated routes; auth state
is driven through TanStack Query rather than local component state. Pages live flat under `src/pages/`
(`LoginPage`, `VerifyPage`, `DashboardPage`, `AccountsPage`, `ConnectBankPage`, `ConnectedPage`) matching the
backend's magic-link + Enable Banking connect flows.

### Money and config conventions

- Store monetary amounts as `decimal`/integer minor units, never floating point. Currency is DKK but keep a
  currency field on money-bearing entities.
- Secrets (Enable Banking application ID/private key, JWT key, Anthropic API key) are configured via
  `IOptions<T>` bound from `Jwt`/`EnableBanking`/`Anthropic` config sections — `dotnet user-secrets` locally,
  Key Vault (via Container App secret references) in Azure. Never hardcoded either way.

### Azure deployment

`azd up` provisions everything in `infra/*.bicep` (Container Apps for the API, Static Web Apps for the
frontend, Azure SQL Database with Entra-only auth, Key Vault, ACR, Log Analytics/App Insights) and deploys
both services per `azure.yaml`. SQL auth is Entra-only end to end — never add `administratorLogin`/
`administratorLoginPassword` to `infra/modules/sql.bicep`. Post-provision hooks
(`scripts/postprovision.{sh,ps1}`) grant the API's system-assigned managed identity SQL data-plane access and
persist the deployed API URL for the frontend build; see CHANGELOG.md for the full rationale.

## What's stubbed / incomplete

See `docs/architecture.md` for the up-to-date list, but as of the last session: `IEnableBankingClient` is
implemented but untested against a real bank connection (no Enable Banking application has been registered
yet), `ResendEmailSender` is implemented but untested live (no Resend API key configured yet — falls back
to `DevConsoleSender` until it is), and the `CategorizationRule.Priority` field is reserved for tiebreaking
that isn't fully wired up.

### Drill-down reconciliation

Every calculated figure in the UI links to the rows behind it, via `GET /transactions/query`
(`TransactionEndpoints.GetQuery`) and the `drillTo` helper in `frontend/src/lib/drill.ts`.
The figure and its drill-down are computed by **different code paths**, so a change to an
aggregation silently leaves the page behind it answering a different question — this has broken
twice (rolling category bars up to groups; the cash-flow bars). Adding or changing any aggregate
means re-running:

```bash
node scripts/verify-drilldowns.mjs --year <year>   # needs the API running locally
```

It asserts every dashboard figure equals the total of its own drill-down, and fails the process
on any mismatch. Add a check there for any new calculated value. The month view
(`/month/outlook`) has its own script, `scripts/verify-month.mjs`, which also recomputes the
typical-month baseline independently; run both after touching either.

### URL state

Every filter and view choice lives in the query string — there is no filter state in `useState`.
Pages are bookmarkable and shareable, and returning from a drill-down lands on the view you left.
The shared period convention (`frontend/src/lib/period.ts`) is:

```
(no year)            page applies its own default (dashboard: this month; account list: all history)
?year=2026           the whole of 2026
?year=2026&month=3   March 2026
```

`year` alone therefore means "all year" explicitly, which is what lets an absent year mean
"unspecified" without colliding with it. Account filters ride as repeated `accountIds`, with
`accounts=none` for a deliberately empty selection. Filter writes use `replace: true` so
adjusting filters doesn't fill the back button.

```bash
node --experimental-strip-types scripts/verify-url-state.mjs
```

### Charts

Colours live only in `frontend/src/lib/chartColors.ts` — never inline hexes in a component.
Colour means direction, kind or identity, never rank: a category's colour comes from
`buildCategoryColors`, keyed on its place in the user's full category list, so the bar you click
on the dashboard is the colour of the page it opens and changing the period repaints nothing.
Callers must pass the complete list from `/categories`, not the chart's own rows. Validation is per *co-occurring set* (the marks a
reader can compare in one chart), not over the union of every colour in the app:

```bash
node scripts/validate_palette.js "<hex,…>" --mode dark --surface "#1a1f2e" --pairs all
```

Horizontal bars go through `components/BarRow.tsx`, whose one job is that **length is the
value**. It has no minimum-width floor — when a bar is too short to hold its label, the label
moves outside it. Never reintroduce a percentage floor: an 8% floor drew a 0.5% bar 17x too long.

```bash
node scripts/verify-bar-scales.mjs --year <year>   # needs the API running locally
```

```bash
node --experimental-strip-types scripts/verify-category-colors.mjs
```

## Net worth (second dashboard)

`/networth` is a separate dashboard from the spending one, backed by its own tables
(`Schema/0007_NetWorth.sql`): `NetWorthAccounts` (what's tracked, and its `Kind`) and
`NetWorthSnapshots` (one value per account per month).

It is **recorded by hand, not derived**. Most of what makes up net worth never appears in a PSD2
feed — pension, property, mortgage, an investment account elsewhere — and even for a connected
account the running sum of synced transactions is not the balance, since history only reaches as
far back as the bank will serve. A linked account only ever *suggests* a figure.

- Values are asked for from the **5th of the following month**, so what's recorded is a month
  that has finished and settled. `GET /networth/due` drives the prompt, shown on both dashboards.
- Snapshot values are stored **exactly as entered, signed**, for every kind of account: positive
  for money held, negative for money owed. Never normalised — an account is not permanently one
  side of the balance (a current account goes overdrawn, a loan can be overpaid, a Nordea
  prioritetskonto reads like a mortgage but can sit in credit), and a forced sign can only
  express the case the classification anticipated. Net worth is the plain sum.
- `Kind` is a label for grouping, and `IsLiability` is presentation only — neither decides a sign.
  The own/owe split is **by sign**, so an overdrawn account counts against you however it is
  classified.
- Re-entering a month **upserts** — a correction must replace, not append, or the month doubles
  permanently. A blank box **deletes** that month's figure rather than leaving a stale one.
- Accounts are **archived, not deleted**, by default: removing one rewrites every past month.

```bash
node scripts/verify-networth.mjs --year <year>   # needs the API running locally
```

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **The bank's own account balance.** Until now the app could not say what was actually in an
  account. Every "balance" on screen was `GetNetBalanceAsync` — a running sum of the transactions
  we hold — which is only ever as complete as the history the bank agreed to serve, hence the
  dashboard's "net balance (tracked)" and the net worth form calling its prefill a suggestion.
  `0007_NetWorth.sql` had already named the right authority ("the bank's own balance is the
  authority, not our running total"); there was no column to put it in. Now there is:
  `IEnableBankingClient.GetBalanceAsync` reads `GET /accounts/{uid}/balances` and the figure is
  stored on `BankAccounts` (`Schema/0013_AccountBalances.sql`), shown on the accounts page, and
  used to prefill the monthly net worth entry.
  - **Booked, not available, where the bank offers both.** An account reports several balances at
    once and they answer different questions: a booked balance (`CLBD`/`ITBD`/`PRCD`) counts
    settled money, while an available one can fold in an overdraft facility and entries still in
    flight. Booked is preferred because transactions are imported from `BOOK` entries only, so the
    balance and the stored history then describe the same money. Among booked figures the choice
    follows our own preference order rather than the bank's listing order, so a bank putting an
    interim balance first can't decide for us. An available balance is used only when nothing else
    is reported, and is labelled as such rather than quietly standing in.
  - **Two dates, because they disagree.** `BalanceReferenceDate` is the date the bank says the
    figure describes; `BalanceFetchedAt` is when we read it. A single "as of" would let a figure
    fetched this morning that describes yesterday be presented as current, which is the whole
    failure this feature exists to avoid. Every place a balance is shown shows its date.
  - **Kept inside the PSD2 budget.** A balance read is a second AISP access charged against the
    same ~4/day unattended cap as the transaction fetch beside it, so sync reads balances on a
    12-hour gap rather than doubling the cost of every 5-hour sync. `POST
    /accounts/{id}/refresh-balance` deliberately has no gap: the cap governs polling with nobody
    present, and that request is the account holder asking. A balance failure is caught separately
    from the sync so it cannot cost the transactions just imported, and a failed read leaves the
    previous figure and its timestamp alone — turning a stale balance into no balance is worse.
  - **Net worth suggestions only use the balance when it describes the month being recorded.** The
    entry form is normally opened on the 5th to record the month just finished, and a balance read
    on 5 November is not October's closing balance — a salary and a rent payment have landed since.
    So the bank figure is offered only when its own date falls inside the month (true when the
    account was synced at month end) and the transaction sum, computed as at month end, is used
    otherwise. The form says which source it used; the recorded snapshot still always wins.

### Fixed
- **Spending inflated by planned payments and uncounted transfers.**
  - Banks list a scheduled payment days before it happens and later re-issue it as a booked entry
    under a different id. Skipping pending entries at import (earlier fix) only stopped new ones;
    the copies already stored still double-counted. `ExcludeSupersededPlannedCopiesAsync` flags a
    copy that was imported *before its own booking date* when a later sync brought a settled copy
    of the same account/date/amount. That signature can't match two genuine identical charges
    (nothing real is imported before it happens), so unlike the review-only duplicates dialog it is
    applied automatically — after every sync, and once at startup for existing data. The
    comparison is made in Danish time because `CreatedAt` is UTC and `BookingDate` is local.
  - A transaction filed under a Transfer-kind category ("Intern overførsel", by the default rule or
    by hand) now counts as a transfer. Previously only a hand mark or an opposite-leg pairing
    removed a row from spending, so a transfer to an account that isn't connected — which can
    never pair — stayed in. Routed through `TransactionEndpoints.IsTransfer`, so the dashboard,
    budgets, recurring and every drill-down agree.
  - The net-balance drill-down listed rows flagged as duplicates while the figure excluded them, so
    the two disagreed by the sum of whatever was marked.
  - Transfer pairing is not stored; it is recomputed on every request, so a leg that arrives days
    late pairs as soon as it syncs. The window is `InternalTransferDetector.MaxSettlementDays`.
- **Signed out on every visit.** Several things treated a server hiccup as "you are signed out":
  `ProtectedRoute` redirected to login on any `/me` failure, and the axios interceptor deleted the
  stored token whenever `/auth/refresh` failed for any reason. Now only a 401 means signed out;
  other failures keep the session and show a retry. On the server, `GetValidWithUserByHashAsync`
  (refresh *and* magic-link) used `rows.FirstOrDefault()` on non-nullable tuples, which yields
  `(null, null)` — a *non-null* nullable tuple — so the `?? throw` never fired and every invalid
  or revoked token returned a 500 instead of a 401/400. Refresh now issues the new token before
  revoking the old one (a failure between the two used to leave no valid token), and a rejected
  refresh no longer clears the cookie (two tabs refreshing at once would delete the winner's
  fresh cookie). `/auth/refresh` also logs whether the request carried a cookie, with the
  User-Agent, since the frontend and API are on different sites and a browser that blocks
  third-party cookies never sends it.
- **First request after idle failed, and startup crash-looped, while the serverless database woke
  up.** Azure SQL refuses logins straight away ("Database ... is not currently available", error
  40613) while it resumes from a pause, so raising the connect timeout (`Connect Timeout=60` in
  `infra/modules/sql.bicep`) did not help — the login is rejected, not slow. `SqlConnectionFactory`
  now retries opening with exponential backoff (6 tries, up to 15s apart) on Azure SQL's transient
  errors, which covers both requests and the startup migration. Note the connection-string
  timeout lives in the Key Vault secret `sql-connection-string`, not just the Bicep output.
- **Login on the deployed app was completely broken.** `IEmailSender` was always `DevConsoleSender`
  regardless of environment, and the one way to retrieve a magic link outside of container logs
  (`GET /dev/last-magic-link`) is gated behind `IsDevelopment()` — so in Production, a magic link
  was logged to Log Analytics and nowhere else, with no way for the user to actually receive it.
  Added `ResendEmailSender` (`Features/Auth/`), swapped in by `Program.cs` whenever `Resend:ApiKey`
  is configured; falls back to `DevConsoleSender` otherwise so local dev is unaffected.
- **Infinite login spinner on a fresh/logged-out visit to a protected route.** The axios response
  interceptor's 401-refresh logic (`frontend/src/api/client.ts`) applied to its own `POST
  /auth/refresh` call — when that call itself 401s (no valid refresh cookie), it re-entered the
  same interceptor with `isRefreshing` already `true`, which queued it on a promise that only
  resolves when the outer refresh call (the one currently awaiting it) completes. Neither side
  could ever finish, so `ProtectedRoute`'s `isLoading` state never cleared. Fixed by rejecting
  immediately when the failing request is the refresh call itself.

### Added
- **Net worth figures can be edited where they are shown.** Previously the only way to change a
  figure was "Record values", which only opened the month currently due — so a past month could
  never be corrected, and the per-account numbers in the table were read-only. Now the table's
  latest-month figures are click-to-edit (Enter or leaving the box saves, Escape abandons; an empty
  or unreadable entry leaves the figure alone, since clearing a month is deliberate and lives in
  the monthly form), clicking a month in the chart opens that month, and the monthly form has
  month arrows so any month can be corrected. Moving months with typed-but-unsaved values asks
  first and never carries them to another month. Inline edits send only the one value; the entry
  endpoint touches only the accounts it is given, and `verify-networth.mjs` now checks that.
- **A month view that says how the month is going.** The dashboard now lays out differently for a
  month and for a year (same page and URL — a `month` in the period selects it). A year keeps the
  averages and cash-flow shape; a month, where those are meaningless, gets `/month/outlook`:
  spend so far against the same point in each of the previous twelve months, bills still to come
  (from the recurring detector), everyday spending against its usual pace, income so far against a
  typical month, and an estimated month end = spent + bills due + usual everyday spending for the
  days left. The old "at this rate" projection is gone from the daily chart — it extrapolated one
  large bill on the 1st into a forecast of ten times a month's spending (247.320 kr. for a month
  that was 24.000 kr. three days in). Bills and everyday spending each open their rows through a
  new `recurring=only|excluded` filter on `/transactions/query`; all three callers detect bills
  through `RecurringEndpoints.LoadRecurringAsync`. Verified by `scripts/verify-month.mjs`, which
  recomputes the typical-month baseline from twelve single-month dashboards rather than trusting
  it. The recurring detector's next-expected date now follows calendar months, not "+30 days".
  "Typical" is the **median** month, not the mean: a mean is dragged by a single one-off (a
  property purchase or large transfer in one of the twelve months moved it by ~100k and spoiled
  the month-end estimate built on it), and a one-off is not typical by definition. The mean is
  still returned (`averageMonthSpend`), and a "What a typical month is made of" panel lists the
  twelve months (each opens its transactions) and splits the average by kind, so a figure that
  looks wrong can be checked rather than argued with.
- Azure deployment infrastructure (`infra/*.bicep`, `azure.yaml`) for `azd up`: Container Apps
  (API), Static Web Apps (frontend), Azure SQL Database (serverless, Entra-only auth), Key Vault,
  Container Registry, Log Analytics + Application Insights. Resource group `rg-<env>` in
  `swedencentral` (Static Web Apps deploys to `westeurope`, the nearest supported region).
- `backend/Spiir.Api/Dockerfile` — multi-stage .NET 10 build for the API container.
- `scripts/postprovision.{sh,ps1}` and `scripts/grant-sql-access.{sh,ps1}` — post-provision hooks
  that allow-list the deployer's IP on the SQL server, grant the Container App's managed identity
  `db_datareader`/`db_datawriter`/`db_ddladmin` on the database, and persist the deployed API URL
  into the azd environment for the frontend build.
- `backend/Spiir.Api/Schema/0001_InitialCreate.sql` — versioned SQL Server schema, applied at
  startup by `Data/DatabaseMigrator.cs`, replacing the EF Core migration history.
- `frontend/public/staticwebapp.config.json` — `navigationFallback` rewrite to `index.html` so
  React Router's client-side routes (`/login`, `/dashboard`, etc.) don't 404 on direct load.

### Changed
- **Bank data provider swapped: GoCardless → Enable Banking.** GoCardless's Bank Account Data API (the
  open-banking transaction-fetching product this app was originally built around) stopped accepting new
  signups in July 2025 and its developer docs shut down 24 August 2026 — not viable for a new integration.
  Replaced `Infrastructure/GoCardless/*` with `Infrastructure/EnableBanking/*`. Enable Banking is, like
  GoCardless was, itself the regulated AISP/TPP — no eIDAS certificate or TPP license needed on this app's
  side, only an application ID + RSA private key from Enable Banking's control panel, used to self-sign a
  short-lived RS256 JWT per request (`EnableBankingTokenService`) instead of GoCardless's client-credentials
  token-exchange call. Enable Banking's free "Restricted Production" tier — access limited to accounts the
  operator pre-authorizes in its control panel — covers this app's self-hosted, single-operator model at no
  cost.
  - The connect flow lost a round trip: Enable Banking's `POST /auth` returns a redirect URL directly (no
    separate pending-requisition object to create then poll, unlike GoCardless's `POST /requisitions`); the
    callback's `code` query param is exchanged for a session via `POST /sessions`, which already returns the
    account list (iban/name/currency) inline — no extra per-account details call needed.
  - A bank is now identified by `(name, country)`, not a single opaque institution id — `Requisition.
    InstitutionId` became `AspspName` plus a new `AspspCountry` column, and `GoCardlessRequisitionId` was
    dropped (Enable Banking never issues one prior to the session).
  - `BankAccount.GoCardlessAccountId` → `ExternalAccountId`, `Transaction.GoCardlessTransactionId` →
    `ExternalTransactionId`, applied via `Schema/0002_RenameGoCardlessToEnableBanking.sql`.
  - `GoCardlessOptions` (`SecretId`/`SecretKey`) → `EnableBankingOptions` (`ApplicationId`/`PrivateKey`).
    `PrivateKey` accepts either raw PEM (local dev, via `dotnet user-secrets`, where embedded newlines are
    fine) or base64-encoded PEM (Azure Key Vault → Container App env var, where newlines are fragile to
    round-trip through `.env`-style config) — see `EnableBankingTokenService.NormalizePem`.
  - Key Vault secrets `gocardless-secret-id`/`gocardless-secret-key` → `enablebanking-application-id`/
    `enablebanking-private-key`; Bicep params and `main.parameters.json` env vars renamed to match
    (`GOCARDLESS_SECRET_ID`/`_KEY` → `ENABLE_BANKING_APPLICATION_ID`/`ENABLE_BANKING_PRIVATE_KEY`).
  - Frontend: `Institution.id` → `{ name, country }`, `connectBank(institutionId)` →
    `connectBank(aspspName, aspspCountry)`, `finalizeConnection(ref)` → `finalizeConnection(ref, code)`
    (Enable Banking's redirect callback carries both `code` and `state`, where `state` is the reference we
    generated when starting the authorization — GoCardless only ever sent back its own `ref`).
- **Backend data access layer replaced: EF Core + SQLite → Dapper + Azure SQL.** `AppDbContext`
  is gone; each entity now has a small repository (`Data/Repositories/*`) built on
  `IDbConnectionFactory` / `Microsoft.Data.SqlClient`. Connections authenticate via Microsoft Entra
  managed identity in Azure (`Authentication=Active Directory Managed Identity` — no SQL passwords
  anywhere).
- **Multi-tenant isolation is now explicit per query.** EF Core's global `HasQueryFilter` on
  `UserId` has no Dapper equivalent — every repository method that reads or writes tenant-scoped
  data now takes `Guid userId` and bakes `WHERE UserId = @userId` into the SQL, centralized per
  entity to keep the isolation logic in one place. `AccountEndpoints.ListAccounts` and
  `DeleteAccount` previously relied entirely on the ambient EF filter (no `ICurrentUser` parameter
  at all) — both now take `ICurrentUser` explicitly and pass `userId` through to the repository.
- Container/database FK cascade paths were re-checked for SQL Server (which, unlike SQLite,
  rejects multiple cascade paths to the same table): `Transactions.UserId` and
  `CategorizationRules.UserId` are now `NO ACTION` — deletion still cascades via
  `BankAccounts`/`Categories`, just not by two paths at once. See the comment in
  `Schema/0001_InitialCreate.sql`.
- Frontend (`frontend/src/api/client.ts`) now resolves its API base URL from
  `VITE_API_BASE_URL` at build time in production (set automatically by
  `scripts/postprovision.sh`/`.ps1`), falling back to the existing `/api` dev-proxy path locally.
- CORS origin is now driven by the deployed Static Web App's URL in Azure (wired through the
  Container App's environment variables), rather than being hardcoded to `localhost:5173`.

- **Schema migration runner replaced: DbUp → Dapper-based `DatabaseMigrator`.** DbUp's own internal
  `SqlConnection` handling reliably crashed the container process with a native SIGSEGV
  (exit code 139) when run against Azure SQL with Entra managed-identity auth on Azure Container
  Apps — reproducible regardless of sync/async calling context, and not fixed by any of the usual
  container/.NET runtime workarounds (see Fixed, below). Replaced with a minimal migrator that
  runs the same embedded `Schema/*.sql` scripts through the same `IDbConnectionFactory` + Dapper
  path every repository already uses successfully, tracked via a hand-rolled `SchemaVersions`
  table. `dbup-sqlserver` package reference removed.

### Fixed

Found and fixed during the first real `azd up` against this infrastructure — kept here since none
of these were visible from `azd provision --preview` or local testing, and most cost real debugging
time:

- **azd 1.31.1 crashes (`nil pointer dereference` in `ImportManager.ServiceStable`) if a
  Docker-based service has no `language` field in `azure.yaml`.** Valid per azd's own docs, but
  not in this version. Fixed by adding `language: dotnet` to the `api` service.
- **`azd auth login` silently authenticated against the wrong Entra tenant** (the account's
  default/home tenant, where it's a disabled guest) instead of the tenant hosting the target
  subscription, failing with `AADSTS500571`. Fixed with `azd auth login --tenant-id <correct-tenant>`
  and by pinning `AZURE_TENANT_ID` in the azd environment.
- **`azd deploy`'s PATCH for Container Apps doesn't preserve the existing `secrets` array** —
  Azure Container Apps' `properties.configuration` isn't deep-merged on PATCH, so any partial
  update (image swap, `az containerapp registry set`, even `az containerapp update --image`) that
  doesn't explicitly resubmit `secrets` clears them, and the app then fails to start
  (`ContainerAppSecretRefNotFound`) even though the secrets are still referenced by the container's
  env vars. Worked around by submitting a single full-spec `az containerapp update --yaml`
  covering image, registry, and secrets together.
- **`main.bicep` originally emitted a `SERVICE_WEB_NAME` output** (matching the convention the
  mandated `grant-sql-access` script expects), but in this app's topology "web" is the Static Web
  App frontend (no DB access, no identity) while "api" (the Container App) is what actually needs
  the SQL grant — and the script prefers `SERVICE_WEB_NAME` over `SERVICE_API_NAME` when both are
  set. That silently pointed the grant at the wrong (nonexistent) principal. Fixed by not emitting
  `SERVICE_WEB_NAME` at all (see the comment in `main.bicep`) and exposing the SWA name as
  `STATIC_WEB_APP_NAME` instead.
- **IP self-detection in `postprovision.ps1` used `Invoke-RestMethod -Uri https://ifconfig.me`**,
  which returns an HTML page (not plain text) to non-browser clients in some cases — the whole page
  then got passed as `--start-ip-address`, blowing past the Windows command-line length limit.
  Switched both `postprovision.sh`/`.ps1` to `https://api.ipify.org`, which always returns a bare
  IP, plus an explicit regex validation before use.
- **`az extension add --name rdbms-connect` failed on this machine** (`Cannot import
  'setuptools.build_meta'` inside Azure CLI's bundled Python) — an environment issue with this
  machine's Azure CLI Python install, unrelated to this repo. Worked around for this deployment by
  granting SQL data-plane access directly via `Microsoft.Data.SqlClient` (`Authentication=Active
  Directory Default`, using the already-authenticated `az` CLI credential) instead of `az sql db
  query`. `scripts/grant-sql-access.{sh,ps1}` are unchanged (still the mandated az-CLI-based
  approach) since the failure is local-machine-specific, not a bug in the scripts.
- **Key Vault secrets with an empty-string value make the whole Container App revision fail to
  start.** `GOCARDLESS_SECRET_ID`/`_KEY`/`ANTHROPIC_API_KEY` were left as `''` (deliberately, as
  unconfigured stubs), and Azure Container Apps refuses to sync a Key-Vault-sourced secret whose
  value resolves to an empty string (`"no secret value was returned"`) — blocking *all* declared
  secrets, not just the empty one, so the container never started. Fixed by defaulting these three
  parameters to the placeholder `'not-configured'` instead of `''` in `main.bicep` and
  `main.parameters.json`. Safe to leave as-is: the app already wraps both integrations in broad
  try/catch that treats any failure (including a 401 from a placeholder key) as "not configured."
- **No registry/identity link existed on the Container App at all** (`properties.configuration.
  registries` was `null`) after the first failed `azd deploy` — the two-phase Bicep pattern's
  "azd deploy configures this automatically" assumption didn't hold once `azd deploy` itself
  started failing partway through. Fixed as part of the full-spec `az containerapp update --yaml`
  above, which now explicitly sets `registries: [{ server: ..., identity: system }]`.

### Removed
- EF Core (`Microsoft.EntityFrameworkCore.Sqlite`/`.Design`), `AppDbContext`,
  `AppDbContextFactory`, and the `Migrations/` folder.

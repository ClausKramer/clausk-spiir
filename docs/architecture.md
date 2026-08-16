# Architecture

## Stack

- **Backend**: .NET 10, ASP.NET Core Minimal APIs, Dapper + Azure SQL / SQL Server
- **Frontend**: React 19 + TypeScript, Vite, TanStack Query, React Router, Tailwind CSS v4
- **Infra**: Bicep + Azure Developer CLI — Container Apps, Static Web Apps, Azure SQL, Key Vault (see [Azure deployment](#azure-deployment) below)

## Auth flow (magic link)

```
Browser                  Backend                         DB
  |                         |                             |
  |-- POST /auth/request-link { email } -->               |
  |                         |-- upsert User ------------->|
  |                         |-- store hash(token) ------->|
  |                         |-- DevConsoleSender logs URL  |
  |<-- 200 "check email" ---|                             |
  |                         |                             |
  | (user clicks link)      |                             |
  |-- GET /auth/verify?token=... -->                      |
  |                         |-- lookup hash(token) ------>|
  |                         |-- mark token consumed ------>|
  |                         |-- issue JWT (15 min)         |
  |                         |-- store hash(refresh) ------>|
  |<-- { accessToken } + Set-Cookie: refresh_token -------|
  |                         |                             |
  | (access token expires)  |                             |
  |-- POST /auth/refresh (cookie sent automatically) -->  |
  |                         |-- validate + rotate ------->|
  |<-- { accessToken } + new refresh cookie --------------|
```

**Token rules:**
- Magic link tokens: 15-minute TTL, single-use, stored as SHA-256 hex.
- JWT access tokens: 15-minute TTL, HS256, claims `sub` (userId) + `email`.
- Refresh tokens: 30-day TTL, rotated on every use (old revoked, new issued), httpOnly Strict cookie scoped to `/auth` path.
- Raw tokens are never stored — only SHA-256 hashes.

The auth abstraction (`IPasswordlessAuthenticator`) is designed so passkeys/WebAuthn can be added later by implementing the same interface without touching endpoints.

## Multi-tenant isolation

Every domain entity (`BankAccount`, `Transaction`, `Category`, `CategorizationRule`) carries a non-nullable `UserId`. Data access moved from EF Core to Dapper (see CHANGELOG.md), which has no global query filter mechanism — isolation is now enforced per repository method in `Data/Repositories/*`, each of which takes `userId` explicitly and bakes `WHERE UserId = @userId` into its SQL:

```csharp
public async Task<IReadOnlyList<BankAccount>> GetAllForUserAsync(Guid userId, CancellationToken ct = default)
{
    using var conn = await connectionFactory.CreateOpenConnectionAsync(ct);
    var rows = await conn.QueryAsync<BankAccount>(
        "SELECT Id, UserId, GoCardlessAccountId, Iban, Name, Currency, LastSyncedAt, CreatedAt FROM BankAccounts WHERE UserId = @userId",
        new { userId });
    return rows.AsList();
}
```

`ICurrentUser` is a scoped service that reads the `sub` claim from the JWT on first access and caches it for the request lifetime. Endpoints don't read claims directly — all user identity goes through `ICurrentUser`, then the resolved `userId` is passed into every repository call.

**User-set categories are authoritative:** `Transaction.IsCategoryManual = true` means the categorization engine must skip re-categorizing that transaction on re-sync.

## Default categories & rules (seeded at registration)

When a new user registers, `DefaultDataSeeder.SeedForUserAsync` creates 15 categories and 22+ merchant pattern rules in their namespace. Patterns cover:
- Dagligvarer (Netto, Rema, Aldi, Lidl, Bilka, Føtex, Irma, Brugsen, Meny, Spar)
- Transport (DSB, Rejsekort, Flixbus, Uber, Taxa)
- Restaurant & Café, Brændstof, Apotek & Sundhed, Tøj & Mode, Elektronik
- Streaming & Abonnementer (Netflix, Spotify, HBO, Viaplay, Disney+)
- Forsikring, Sport & Fitness, Nethandel, Bank & Gebyrer, Rejser, Bolig

Rules have `IsRegex = true` for patterns requiring anchors or alternation, and `IsRegex = false` for plain case-insensitive contains. Priority field reserved for tiebreaking in next session.

## GoCardless sync strategy

GoCardless Bank Account Data API is rate-limited to ~4 calls/day per account. Sync is therefore:

1. **On-demand only** — triggered by a future `POST /sync` endpoint, never on page load.
2. **Dedup by `GoCardlessTransactionId`** — unique index on `(UserId, GoCardlessTransactionId)` prevents duplicates.
3. **Cached locally** — all UI queries hit the local SQLite DB; no live GoCardless calls in the read path.
4. **Interface stub** (`IGoCardlessClient`) is defined but not implemented. Wire it up next session.

## Azure deployment

`azd up` provisions and deploys everything (see `infra/*.bicep` and `azure.yaml`):

- **API** → Container Apps (Consumption, scale-to-zero), system-assigned managed identity
- **Web** → Static Web Apps (Free tier), calls the API's public URL directly (CORS, not a proxy)
- **Database** → Azure SQL Database, serverless, **Entra-only authentication** — no SQL passwords
  anywhere; the API connects via `Authentication=Active Directory Managed Identity`
- **Secrets** → Key Vault, referenced by the Container App via its managed identity
- Post-provision hooks (`scripts/postprovision.{sh,ps1}`) grant the API's identity SQL data-plane
  access (`CREATE USER ... FROM EXTERNAL PROVIDER`) and set `VITE_API_BASE_URL` for the frontend build

Static Web Apps isn't available in every region — it deploys to `westeurope` even though everything
else lives in `swedencentral`. See CHANGELOG.md for the full EF Core → Dapper migration this required.

## Running locally

### Backend

```bash
cd backend/Spiir.Api
sqlcmd -S "(localdb)\MSSQLLocalDB" -Q "CREATE DATABASE spiir;"  # one-time
dotnet run --launch-profile http
# → http://localhost:5218
# OpenAPI: http://localhost:5218/openapi/v1.json
```

### Frontend

```bash
cd frontend
npm run dev
# → http://localhost:5173
```

Vite proxies all `/api/…` requests to `http://localhost:5218`.

### Magic-link login in dev

1. Go to `http://localhost:5173/login`, enter your email, submit.
2. Watch the backend console — the magic link URL is printed there (no real email sent).
3. Paste the URL into your browser (or just navigate to `/auth/verify?token=…`).
4. You're redirected to `/dashboard`.

## What's stubbed / next session

| Item | Status |
|------|--------|
| `IGoCardlessClient` implementation | Stub only — needs SecretId/SecretKey in user-secrets locally, Key Vault in Azure |
| Real email delivery | `DevConsoleSender` — swap for SMTP/Resend/etc. |
| Passkeys / WebAuthn | `IPasswordlessAuthenticator` is the extension point |
| Bank account connection UI | `/accounts/connect` flow (GoCardless requisition) |
| Charts / budgets / multi-page transactions | Next sessions |

Deployed and live as of this session — `rg-spiir-prod` in `swedencentral` (Static Web App in
`westeurope`). See `.azure/deployment-plan.md` for the deployed endpoint URLs and CHANGELOG.md for
the real deployment issues found and fixed (a genuine DbUp/Azure Container Apps incompatibility,
an azd PATCH bug that drops Container App secrets, empty-Key-Vault-secret startup failures, and
more) — worth reading before touching the Bicep or the migration runner again.

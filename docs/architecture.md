# Architecture

## Stack

- **Backend**: .NET 10, ASP.NET Core Minimal APIs, EF Core 10 + SQLite
- **Frontend**: React 19 + TypeScript, Vite, TanStack Query, React Router, Tailwind CSS v4

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

Every domain entity (`BankAccount`, `Transaction`, `Category`, `CategorizationRule`) carries a non-nullable `UserId`. A global EF Core query filter on each of these tables enforces isolation:

```csharp
modelBuilder.Entity<BankAccount>()
    .HasQueryFilter(e => currentUser.UserId != null && e.UserId == currentUser.UserId);
```

`ICurrentUser` is a scoped service that reads the `sub` claim from the JWT on first access and caches it for the request lifetime. Endpoints don't read claims directly — all user identity goes through `ICurrentUser`.

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

## Running locally

### Backend

```bash
cd backend/Spiir.Api
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
| `IGoCardlessClient` implementation | Stub only — needs SecretId/SecretKey in user-secrets |
| Claude API categorization fallback | TODO comment in `DefaultDataSeeder` |
| Real email delivery | `DevConsoleSender` — swap for SMTP/Resend/etc. |
| Passkeys / WebAuthn | `IPasswordlessAuthenticator` is the extension point |
| Bank account connection UI | `/accounts/connect` flow (GoCardless requisition) |
| Charts / budgets / multi-page transactions | Next sessions |

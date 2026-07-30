# Claude Code Prompt — Personal Finance App (React + C# Minimal API)

> Paste everything below into Claude Code. Adjust the bracketed `[CHOICE]` notes if you
> want different defaults.

---

## Context

I'm building a personal finance tracking app to replace **Spiir.dk** (a Danish service that
shut down). It pulls bank transactions via the **GoCardless Bank Account Data API**
(PSD2 / open banking), stores them locally, and categorizes them with a hybrid
rule-based + Claude API engine.

I have an earlier **Python prototype** that I'm now replacing with a proper React + C#
stack. Treat the prototype as a **reference spec, not code to extend**. The relevant files:

- `schema.sql` — SQLite schema (transactions, accounts, categories, rules). Port this design.
- `categorize.py` — hybrid categorization engine: ~22 Danish merchant patterns across ~15
  categories, matched by rules first; Claude API only for unmatched transactions. Port the
  rules and the matching logic.
- `gocardless.py` — GoCardless API client (auth, requisitions, fetching transactions).
  Port the integration patterns.
- `db.py` — sync/dedup/normalization logic. Dedup is on GoCardless `transactionId`.

If those files exist in this repo, read them first and reuse their domain decisions.

## Goal for this session

Stand up the **project skeleton end to end**: a C# minimal API backend, a React frontend,
passwordless auth, and a multi-user-ready data model. I want a running app where I can log in
via magic link, see an (initially empty) dashboard, and have the backend ready to wire up
GoCardless sync. Don't try to do everything — see **Scope** below.

## Stack

**Backend**
- .NET 10 (current LTS), C# 14, ASP.NET Core **Minimal APIs** (not controllers)
- **EF Core 10** with the **SQLite** provider — but keep the provider abstracted (no raw
  SQLite-isms leaking into domain code) so switching to Postgres later is a config change.
  `[CHOICE: swap to Npgsql/Postgres now if you'd rather start multi-user-heavy]`
- Built-in OpenAPI document generation (ships in ASP.NET Core 10) for the API surface
- Use the typed-results pattern (`TypedResults`) and minimal API endpoint groups
  (`MapGroup`) to keep route files organized by feature

**Frontend**
- React + **TypeScript**, built with **Vite**
- **TanStack Query** for server state / data fetching, **React Router** for routing
- Keep styling simple and consistent — `[CHOICE: Tailwind, or plain CSS modules]`. Pick one
  and stay with it.

**Repo layout**
```
/backend      # .NET solution
/frontend     # Vite React app
/docs         # short architecture notes + this prompt
```

## Passwordless auth (magic link)

Implement **email magic-link** auth. Flow:

1. `POST /auth/request-link { email }` → create-or-find the user, generate a single-use,
   short-lived (e.g. 15 min) token, store its **hash** (never the raw token), and email a link
   like `https://app/auth/verify?token=...`. For local dev, write the link to the console / a
   log file instead of sending real email (make the email sender an interface with a dev
   no-op implementation).
2. `GET/POST /auth/verify { token }` → validate, mark token consumed, issue a short-lived
   **JWT access token** plus a **refresh token** stored in an httpOnly, secure, SameSite
   cookie.
3. `POST /auth/refresh` and `POST /auth/logout` to round it out.

Structure the auth layer behind a small abstraction (e.g. an `IPasswordlessAuthenticator`)
so **passkeys / WebAuthn** can be added later without reworking endpoints. Don't build
passkeys now. Don't ever store passwords or raw tokens.

## Multi-user readiness

- A `User` entity is the root. **Every** domain entity (account, transaction, category, rule)
  carries a `UserId` foreign key from day one.
- Enforce tenant isolation centrally — a global EF Core query filter on `UserId` keyed off
  the authenticated user, so no endpoint can accidentally read another user's data.
- The authenticated user id comes from the JWT; resolve it once into a scoped
  `ICurrentUser` service rather than reading claims ad hoc in each endpoint.
- User-set categories are **authoritative**: the categorization engine must never overwrite a
  manually assigned category on re-run. Carry this rule into the schema (a flag on the
  transaction's category assignment).

## Constraints & gotchas

- **GoCardless rate limits are brutal** — as low as ~4 API calls/day per account. So:
  transactions must be cached locally and synced **sparingly**. Design sync as an explicit,
  on-demand operation (not on every page load), and store enough locally that the UI never
  needs to hit GoCardless directly.
- Dedup incoming transactions on GoCardless `transactionId`.
- Money: store amounts as integer minor units (øre) or `decimal`, never floating point.
  Currency is DKK but keep a currency field.
- Don't hardcode secrets. GoCardless creds, JWT signing key, and the Claude API key go in
  user-secrets / env vars, surfaced through `IOptions`.

## Scope for THIS session (build these)

1. Repo + solution scaffolding for `/backend` and `/frontend`, plus a root README.
2. EF Core model: `User`, `BankAccount`, `Transaction`, `Category`, `CategorizationRule` —
   with `UserId` everywhere and the global query filter. Generate the initial migration.
3. Magic-link auth endpoints end to end, with a dev console email sender and JWT + refresh
   cookie issuance.
4. A protected `GET /me` and a protected, paginated `GET /transactions` (returns empty for
   now) to prove auth + tenant isolation work.
5. Frontend: a login screen (enter email → "check your email"), a verify route that
   completes login, and a protected dashboard shell that calls `/me` and shows the empty
   transactions list. Auth state via TanStack Query + the refresh cookie.
6. Seed the categorization **rules** table from the ported Danish patterns (data only —
   wiring the engine into sync is the next session).

## Out of scope for this session (stub or skip)

- Actual GoCardless calls (define the client interface + config, but no live sync yet).
- Calling the Claude API for categorization (leave the fallback as a clearly marked TODO).
- Real email delivery (dev console sender is fine).
- Passkeys, charts/visualizations, budgets.

## How I'd like you to work

- Start by reading the prototype files (if present) and confirming the schema/rules you'll
  port, then propose the model + folder structure before generating lots of code.
- Make the initial migration and get `dotnet build` + `dotnet run` working, and the Vite dev
  server running, before declaring done.
- Write a short `/docs/architecture.md` capturing the auth flow, the multi-tenant approach,
  and the GoCardless sync strategy, so the next session has context.
- Keep commits/logical steps small and tell me how to run each part locally.

End the session with: how to run backend + frontend, how to trigger a magic-link login in
dev, and a checklist of what's stubbed for next time.

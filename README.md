# Spiir — Personal Finance Tracker

A self-hosted replacement for Spiir.dk. Pulls bank transactions via the GoCardless Bank Account Data API (PSD2), stores them locally, and categorizes them with a rule-based + Claude AI engine.

## Stack

| Layer | Tech |
|-------|------|
| Backend | .NET 10, ASP.NET Core Minimal APIs, EF Core 10 + SQLite |
| Frontend | React 19 + TypeScript, Vite, TanStack Query, React Router, Tailwind CSS v4 |
| Auth | Passwordless magic-link → JWT access token + httpOnly refresh cookie |

## Quick start

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- Node.js 18+

### 1. Backend

```bash
cd backend/Spiir.Api

# Set JWT signing key (one-time)
dotnet user-secrets set "Jwt:Key" "$(openssl rand -base64 32)"

# Run (auto-migrates on first start)
dotnet run --launch-profile http
# → http://localhost:5218
# OpenAPI: http://localhost:5218/openapi/v1.json
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### Magic-link login in dev (no real email sent)

1. Open `http://localhost:5173/login`
2. Enter any email address and click **Send magic link**
3. Watch the **backend console** — the magic link URL is printed there
4. Click (or paste) the URL → you land on the dashboard

## Repo layout

```
/backend      .NET solution (Spiir.sln)
/frontend     Vite React app
/docs         Architecture notes
```

See [docs/architecture.md](docs/architecture.md) for a full description of the auth flow, multi-tenant isolation, GoCardless sync strategy, and what's stubbed for next session.

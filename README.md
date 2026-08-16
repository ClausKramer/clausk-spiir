# Spiir — Personal Finance Tracker

A self-hosted replacement for Spiir.dk. Pulls bank transactions via the GoCardless Bank Account Data API (PSD2), stores them locally, and categorizes them with a rule-based + Claude AI engine.

## Stack

| Layer | Tech |
|-------|------|
| Backend | .NET 10, ASP.NET Core Minimal APIs, Dapper + Azure SQL / SQL Server |
| Frontend | React 19 + TypeScript, Vite, TanStack Query, React Router, Tailwind CSS v4 |
| Auth | Passwordless magic-link → JWT access token + httpOnly refresh cookie |
| Infra | Bicep + Azure Developer CLI (Container Apps, Static Web Apps, Azure SQL, Key Vault) |

## Quick start

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- Node.js 18+
- SQL Server LocalDB (ships with Visual Studio, or install the [SQL Server Express LocalDB](https://learn.microsoft.com/sql/database-engine/configure-windows/sql-server-express-localdb) package)

### 1. Backend

```bash
cd backend/Spiir.Api

# Create the local database (one-time)
sqlcmd -S "(localdb)\MSSQLLocalDB" -Q "CREATE DATABASE spiir;"

# Set JWT signing key (one-time)
dotnet user-secrets set "Jwt:Key" "$(openssl rand -base64 32)"

# Run (schema auto-applies on every start — see Data/DatabaseMigrator.cs and Schema/*.sql)
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

## Deploying to Azure

```bash
azd auth login
azd env new spiir-prod
azd env set JWT_SIGNING_KEY "$(openssl rand -base64 32)"
azd up
```

Provisions Container Apps (API), Static Web Apps (frontend), Azure SQL Database, Key Vault, and
monitoring via `infra/*.bicep`. See [CHANGELOG.md](CHANGELOG.md) for what changed to make this
deployable, and `.azure/deployment-plan.md` for the full deployment plan.

## Repo layout

```
/backend      .NET solution (Spiir.sln)
/frontend     Vite React app
/infra        Bicep infrastructure (azd)
/scripts      azd post-provision hooks
/docs         Architecture notes
```

See [docs/architecture.md](docs/architecture.md) for a full description of the auth flow, multi-tenant isolation, GoCardless sync strategy, and what's stubbed for next session.

using System.Text;
using Dapper;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Spiir.Api.Data;
using Spiir.Api.Data.Repositories;
using Spiir.Api.Features.Accounts;
using Spiir.Api.Features.Auth;
using Spiir.Api.Features.Categories;
using Spiir.Api.Features.Categorization;
using Spiir.Api.Features.Sync;
using Spiir.Api.Features.Transactions;
using Spiir.Api.Features.Users;
using Spiir.Api.Infrastructure.EnableBanking;
using Spiir.Api.Options;
using Spiir.Api.Services;

SqlMapper.AddTypeHandler(new DateOnlyTypeHandler());

var builder = WebApplication.CreateBuilder(args);

// Options
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
builder.Services.Configure<EnableBankingOptions>(builder.Configuration.GetSection("EnableBanking"));
builder.Services.Configure<AnthropicOptions>(builder.Configuration.GetSection("Anthropic"));

// Database — Dapper over Microsoft.Data.SqlClient. Connection string uses Entra ID
// authentication in Azure (Authentication=Active Directory Managed Identity); locally it points
// at a SQL Server / Azure SQL instance you have Entra access to (see appsettings.Development.json).
builder.Services.AddSingleton<IDbConnectionFactory, SqlConnectionFactory>();
builder.Services.AddScoped<UserRepository>();
builder.Services.AddScoped<BankAccountRepository>();
builder.Services.AddScoped<TransactionRepository>();
builder.Services.AddScoped<CategoryRepository>();
builder.Services.AddScoped<CategorizationRuleRepository>();
builder.Services.AddScoped<MagicLinkTokenRepository>();
builder.Services.AddScoped<RefreshTokenRepository>();
builder.Services.AddScoped<RequisitionRepository>();

// Scoped services
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUserService>();
builder.Services.AddScoped<IPasswordlessAuthenticator, PasswordlessAuthenticator>();
builder.Services.AddScoped<IEmailSender, DevConsoleSender>();
builder.Services.AddScoped<DefaultDataSeeder>();

// Categorization
builder.Services.AddScoped<ClaudeCategorizationFallback>();
builder.Services.AddScoped<ICategorizationEngine, RuleBasedCategorizationEngine>();

// Anthropic — named client with API key header
builder.Services.AddHttpClient("Anthropic", (sp, http) =>
{
    var opts = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<AnthropicOptions>>().Value;
    http.BaseAddress = new Uri("https://api.anthropic.com");
    http.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
    http.DefaultRequestHeaders.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));
    if (!string.IsNullOrEmpty(opts.ApiKey))
        http.DefaultRequestHeaders.Add("x-api-key", opts.ApiKey);
});

// Enable Banking — singleton JWT signer (self-issued from the app's private key, no network call
// or token-refresh endpoint involved, unlike GoCardless's client-credentials flow) + scoped client
builder.Services.AddHttpClient("EnableBanking", (sp, http) =>
{
    var opts = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<EnableBankingOptions>>().Value;
    http.BaseAddress = new Uri(opts.BaseUrl);
    http.DefaultRequestHeaders.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));
});
builder.Services.AddSingleton<IEnableBankingTokenService, EnableBankingTokenService>();
builder.Services.AddScoped<IEnableBankingClient, EnableBankingClient>();

// JWT authentication
var jwtSection = builder.Configuration.GetSection("Jwt");
var jwtKey = jwtSection["Key"] ?? throw new InvalidOperationException("Jwt:Key is not configured.");

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtSection["Issuer"] ?? "spiir",
            ValidateAudience = true,
            ValidAudience = jwtSection["Audience"] ?? "spiir",
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });
builder.Services.AddAuthorization();

// OpenAPI
builder.Services.AddOpenApi();

// CORS — frontend dev server
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy =>
        policy
            .WithOrigins(builder.Configuration["CorsOrigin"] ?? "http://localhost:5173")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials()));

var app = builder.Build();

// Auto-migrate on every startup (idempotent — see Data/DatabaseMigrator.cs and Schema/*.sql).
await DatabaseMigrator.MigrateAsync(app.Services.GetRequiredService<IDbConnectionFactory>());

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// Endpoints
app.MapAuthEndpoints();
app.MapUserEndpoints();
app.MapTransactionEndpoints();
app.MapCategoryEndpoints();
app.MapAccountEndpoints();
app.MapSyncEndpoints();

// Dev-only: retrieve last pending magic link URL (avoids needing real email in dev)
if (app.Environment.IsDevelopment())
{
    app.MapGet("/dev/last-magic-link", () =>
    {
        if (!File.Exists(DevConsoleSender.LastLinkFile))
            return Results.NotFound("No magic link has been sent yet in this dev session.");
        var url = File.ReadAllText(DevConsoleSender.LastLinkFile);
        return Results.Ok(new { url });
    }).WithTags("Dev");
}

app.Run();

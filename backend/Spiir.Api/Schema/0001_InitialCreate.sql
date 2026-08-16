-- Initial schema, ported from the EF Core / SQLite migrations (Migrations/20260613182936_InitialCreate.cs,
-- 20260614220823_AddRequisition.cs). Run by DbUp at startup (see Data/DatabaseMigrator.cs).
--
-- NOTE on cascade deletes: SQLite (and EF Core's SQLite provider) does not enforce SQL Server's
-- "multiple cascade paths" restriction, but this schema now runs on SQL Server, which does.
-- Users -> BankAccounts -> Transactions and Users -> Categories -> CategorizationRules are each
-- two-hop cascade chains; a direct cascading FK from Transactions/CategorizationRules straight to
-- Users would create a second path to the same table, which SQL Server rejects at creation time.
-- Those two FKs are declared NO ACTION below — deleting a user still removes their transactions
-- and rules via the BankAccounts/Categories cascade, just not directly.

CREATE TABLE Users
(
    Id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    Email     NVARCHAR(320)    NOT NULL,
    CreatedAt DATETIME2        NOT NULL
);
CREATE UNIQUE INDEX IX_Users_Email ON Users (Email);

CREATE TABLE BankAccounts
(
    Id                  UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    UserId              UNIQUEIDENTIFIER NOT NULL,
    GoCardlessAccountId NVARCHAR(200)    NOT NULL,
    Iban                NVARCHAR(34)     NULL,
    Name                NVARCHAR(200)    NOT NULL,
    Currency            NVARCHAR(3)      NOT NULL,
    LastSyncedAt        DATETIME2        NULL,
    CreatedAt           DATETIME2        NOT NULL,
    CONSTRAINT FK_BankAccounts_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE CASCADE
);
CREATE INDEX IX_BankAccounts_UserId ON BankAccounts (UserId);

CREATE TABLE Categories
(
    Id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    UserId    UNIQUEIDENTIFIER NOT NULL,
    Name      NVARCHAR(200)    NOT NULL,
    Emoji     NVARCHAR(16)     NULL,
    CreatedAt DATETIME2        NOT NULL,
    CONSTRAINT FK_Categories_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE CASCADE
);
CREATE INDEX IX_Categories_UserId ON Categories (UserId);

CREATE TABLE CategorizationRules
(
    Id         UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    UserId     UNIQUEIDENTIFIER NOT NULL,
    Pattern    NVARCHAR(500)    NOT NULL,
    IsRegex    BIT              NOT NULL,
    CategoryId UNIQUEIDENTIFIER NOT NULL,
    Priority   INT              NOT NULL,
    CreatedAt  DATETIME2        NOT NULL,
    CONSTRAINT FK_CategorizationRules_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id), -- NO ACTION, see note above
    CONSTRAINT FK_CategorizationRules_Categories_CategoryId FOREIGN KEY (CategoryId) REFERENCES Categories (Id) ON DELETE CASCADE
);
CREATE INDEX IX_CategorizationRules_UserId ON CategorizationRules (UserId);
CREATE INDEX IX_CategorizationRules_CategoryId ON CategorizationRules (CategoryId);

CREATE TABLE MagicLinkTokens
(
    Id         UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    UserId     UNIQUEIDENTIFIER NOT NULL,
    TokenHash  NVARCHAR(64)     NOT NULL,
    CreatedAt  DATETIME2        NOT NULL,
    ExpiresAt  DATETIME2        NOT NULL,
    ConsumedAt DATETIME2        NULL,
    CONSTRAINT FK_MagicLinkTokens_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IX_MagicLinkTokens_TokenHash ON MagicLinkTokens (TokenHash);
CREATE INDEX IX_MagicLinkTokens_UserId ON MagicLinkTokens (UserId);

CREATE TABLE RefreshTokens
(
    Id         UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    UserId     UNIQUEIDENTIFIER NOT NULL,
    TokenHash  NVARCHAR(64)     NOT NULL,
    CreatedAt  DATETIME2        NOT NULL,
    ExpiresAt  DATETIME2        NOT NULL,
    RevokedAt  DATETIME2        NULL,
    CONSTRAINT FK_RefreshTokens_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE CASCADE
);
CREATE INDEX IX_RefreshTokens_UserId ON RefreshTokens (UserId);

CREATE TABLE Requisitions
(
    Id                      UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    UserId                  UNIQUEIDENTIFIER NOT NULL,
    GoCardlessRequisitionId NVARCHAR(200)     NOT NULL,
    Reference               NVARCHAR(100)     NOT NULL,
    InstitutionId           NVARCHAR(200)     NOT NULL,
    Status                  INT               NOT NULL,
    CreatedAt               DATETIME2         NOT NULL,
    UpdatedAt               DATETIME2         NOT NULL,
    CONSTRAINT FK_Requisitions_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE CASCADE
);
CREATE INDEX IX_Requisitions_UserId ON Requisitions (UserId);

CREATE TABLE Transactions
(
    Id                      UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    UserId                  UNIQUEIDENTIFIER NOT NULL,
    BankAccountId           UNIQUEIDENTIFIER NOT NULL,
    GoCardlessTransactionId NVARCHAR(200)     NOT NULL,
    BookingDate             DATE              NOT NULL,
    Amount                  DECIMAL(18, 2)    NOT NULL,
    Currency                NVARCHAR(3)       NOT NULL,
    Description             NVARCHAR(500)     NOT NULL,
    CategoryId              UNIQUEIDENTIFIER  NULL,
    IsCategoryManual        BIT               NOT NULL,
    CreatedAt               DATETIME2         NOT NULL,
    CONSTRAINT FK_Transactions_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id), -- NO ACTION, see note above
    CONSTRAINT FK_Transactions_BankAccounts_BankAccountId FOREIGN KEY (BankAccountId) REFERENCES BankAccounts (Id) ON DELETE CASCADE,
    CONSTRAINT FK_Transactions_Categories_CategoryId FOREIGN KEY (CategoryId) REFERENCES Categories (Id)
);
CREATE INDEX IX_Transactions_BankAccountId ON Transactions (BankAccountId);
CREATE INDEX IX_Transactions_CategoryId ON Transactions (CategoryId);
CREATE UNIQUE INDEX IX_Transactions_UserId_GoCardlessTransactionId ON Transactions (UserId, GoCardlessTransactionId);

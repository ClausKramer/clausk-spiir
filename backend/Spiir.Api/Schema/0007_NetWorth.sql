-- Net worth is a different measurement from cash flow, so it gets its own tables rather than
-- being derived from transactions.
--
-- Two reasons it can't be derived. Most of what makes up net worth never appears in a PSD2 feed
-- at all — a pension, a property, a mortgage, an investment account at another provider — and
-- even for a connected account the running sum of synced transactions is not the balance, since
-- history only reaches back as far as the bank will serve it. So net worth is recorded, once a
-- month, by hand.

CREATE TABLE NetWorthAccounts
(
    Id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    UserId    UNIQUEIDENTIFIER NOT NULL,
    Name      NVARCHAR(120)    NOT NULL,
    -- Cash, Savings, Investment, Pension, Property, Other for what you own;
    -- Mortgage, Loan, Credit for what you owe. See NetWorthKind in the domain layer.
    Kind      NVARCHAR(40)     NOT NULL,
    -- Denormalised from Kind so the SQL can sum assets and liabilities without knowing the kind
    -- vocabulary, and so a kind can be reclassified later without rewriting every query.
    IsLiability BIT            NOT NULL,
    Currency  NVARCHAR(3)      NOT NULL CONSTRAINT DF_NetWorthAccounts_Currency DEFAULT 'DKK',
    -- Optional link to a synced account, used only to prefill the monthly entry form with a
    -- suggested figure. The recorded snapshot always wins — the bank's own balance is the
    -- authority, not our running total.
    BankAccountId UNIQUEIDENTIFIER NULL,
    -- Archived rather than deleted: removing an account would silently rewrite every past
    -- month's net worth, which is the one thing a history like this must never do.
    IsArchived BIT             NOT NULL CONSTRAINT DF_NetWorthAccounts_IsArchived DEFAULT 0,
    SortOrder  INT             NOT NULL CONSTRAINT DF_NetWorthAccounts_SortOrder DEFAULT 0,
    CreatedAt  DATETIME2       NOT NULL,
    CONSTRAINT FK_NetWorthAccounts_Users FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE CASCADE,
    -- NO ACTION: Users already cascades to BankAccounts, and a second cascade path into this
    -- table is rejected by SQL Server. Disconnecting a bank account clears the link explicitly.
    CONSTRAINT FK_NetWorthAccounts_BankAccounts FOREIGN KEY (BankAccountId) REFERENCES BankAccounts (Id)
);

CREATE INDEX IX_NetWorthAccounts_UserId ON NetWorthAccounts (UserId, IsArchived, SortOrder);
CREATE INDEX IX_NetWorthAccounts_BankAccountId ON NetWorthAccounts (BankAccountId);

CREATE TABLE NetWorthSnapshots
(
    Id                 UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    UserId             UNIQUEIDENTIFIER NOT NULL,
    NetWorthAccountId  UNIQUEIDENTIFIER NOT NULL,
    -- Year and month rather than a date: a snapshot describes a month, not a moment, and
    -- storing it as a date invites two entries for the same month that differ only by day.
    PeriodYear         INT              NOT NULL,
    PeriodMonth        INT              NOT NULL,
    -- For a liability, the amount owed, always positive: a mortgage of 1.2m is 1200000, and
    -- IsLiability is what makes it pull downward.
    -- For an asset, the balance *signed*, because a current account genuinely swings between
    -- in credit and overdrawn, and forcing it positive would record an overdraft as money held.
    Value              DECIMAL(18, 2)   NOT NULL,
    Note               NVARCHAR(200)    NULL,
    RecordedAt         DATETIME2        NOT NULL,
    CONSTRAINT FK_NetWorthSnapshots_Users FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE CASCADE,
    -- NO ACTION for the same two-cascade-paths reason; the repository deletes an account's
    -- snapshots explicitly, and archiving is the normal path anyway.
    CONSTRAINT FK_NetWorthSnapshots_Accounts FOREIGN KEY (NetWorthAccountId) REFERENCES NetWorthAccounts (Id)
);

-- One value per account per month. Re-entering a month updates rather than appends, so a
-- correction replaces the figure instead of doubling it.
CREATE UNIQUE INDEX IX_NetWorthSnapshots_Account_Period
    ON NetWorthSnapshots (UserId, NetWorthAccountId, PeriodYear, PeriodMonth);

CREATE INDEX IX_NetWorthSnapshots_Period ON NetWorthSnapshots (UserId, PeriodYear, PeriodMonth);

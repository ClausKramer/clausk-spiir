-- One editable monthly limit per top-level category group. Not a time series like net worth:
-- a limit doesn't need per-month history, since changing it changes it going forward and a past
-- month is judged against today's limit, not whatever it was at the time.

CREATE TABLE Budgets
(
    Id           UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    UserId       UNIQUEIDENTIFIER NOT NULL,
    CategoryId   UNIQUEIDENTIFIER NOT NULL,
    MonthlyLimit DECIMAL(18, 2)   NOT NULL,
    CreatedAt    DATETIME2        NOT NULL,
    UpdatedAt    DATETIME2        NOT NULL,
    -- NO ACTION: Users already cascades to Categories, and a second cascade path into this table
    -- is rejected by SQL Server. Deleting a category explicitly takes its budget with it below.
    CONSTRAINT FK_Budgets_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id),
    CONSTRAINT FK_Budgets_Categories_CategoryId FOREIGN KEY (CategoryId) REFERENCES Categories (Id) ON DELETE CASCADE,
    CONSTRAINT UQ_Budgets_UserId_CategoryId UNIQUE (UserId, CategoryId)
);

CREATE INDEX IX_Budgets_UserId ON Budgets (UserId);

-- Recurring charges are detected live from Transactions on every request, never stored — the
-- only state worth persisting is which detected series the user has said aren't actually
-- recurring, so a false positive doesn't come back every time the page loads.

CREATE TABLE DismissedRecurringSeries
(
    UserId       UNIQUEIDENTIFIER NOT NULL,
    MerchantKey  NVARCHAR(200)    NOT NULL,
    DismissedAt  DATETIME2        NOT NULL,
    CONSTRAINT PK_DismissedRecurringSeries PRIMARY KEY (UserId, MerchantKey),
    CONSTRAINT FK_DismissedRecurringSeries_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE CASCADE
);

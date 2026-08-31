-- Tags cut across categories. A transaction has exactly one category — where it belongs in the
-- budget — but any number of tags, which answer questions the budget structure can't: what did
-- this child cost, what does this hobby cost, what did that holiday cost in total. Those spans
-- cross categories by nature (Clara appears under dagligvarer, tøj, aktiviteter and gaver), so
-- they can't be modelled as categories without duplicating the tree.
CREATE TABLE Tags
(
    Id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    UserId    UNIQUEIDENTIFIER NOT NULL,
    Name      NVARCHAR(60)     NOT NULL,
    CreatedAt DATETIME2        NOT NULL,
    CONSTRAINT FK_Tags_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE CASCADE
);

-- Case-insensitive by collation, so "Padel" and "padel" are the same tag rather than two that
-- silently split a total in half.
CREATE UNIQUE INDEX IX_Tags_UserId_Name ON Tags (UserId, Name);

CREATE TABLE TransactionTags
(
    TransactionId UNIQUEIDENTIFIER NOT NULL,
    TagId         UNIQUEIDENTIFIER NOT NULL,
    CONSTRAINT PK_TransactionTags PRIMARY KEY (TransactionId, TagId),
    CONSTRAINT FK_TransactionTags_Transactions FOREIGN KEY (TransactionId) REFERENCES Transactions (Id) ON DELETE CASCADE,
    -- NO ACTION, not CASCADE: Users cascades to Tags and, via BankAccounts and Transactions, to
    -- this table too — two paths into one table, which SQL Server rejects. Deleting a tag
    -- therefore removes its links explicitly first (see TagRepository.DeleteAsync).
    CONSTRAINT FK_TransactionTags_Tags FOREIGN KEY (TagId) REFERENCES Tags (Id)
);

CREATE INDEX IX_TransactionTags_TagId ON TransactionTags (TagId);

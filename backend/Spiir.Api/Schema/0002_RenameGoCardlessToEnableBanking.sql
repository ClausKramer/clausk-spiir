-- GoCardless's Bank Account Data API (the open-banking transaction-fetching product this schema
-- was originally built around) stopped accepting new signups in July 2025 and is being wound
-- down. Replaced with Enable Banking, which has a different consent shape: no separate
-- "requisition id" is issued before the user completes bank consent (only a redirect `url`), and
-- a bank is identified by (name, country) rather than a single institution id. See CHANGELOG.md.

EXEC sp_rename 'BankAccounts.GoCardlessAccountId', 'ExternalAccountId', 'COLUMN';
EXEC sp_rename 'Transactions.GoCardlessTransactionId', 'ExternalTransactionId', 'COLUMN';
EXEC sp_rename 'IX_Transactions_UserId_GoCardlessTransactionId', 'IX_Transactions_UserId_ExternalTransactionId', 'INDEX';

EXEC sp_rename 'Requisitions.InstitutionId', 'AspspName', 'COLUMN';
ALTER TABLE Requisitions DROP COLUMN GoCardlessRequisitionId;
ALTER TABLE Requisitions ADD AspspCountry NVARCHAR(2) NOT NULL DEFAULT '';

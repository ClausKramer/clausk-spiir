-- A bill isn't always monthly — insurance and subscriptions are routinely charged quarterly or
-- yearly. Comparing one such charge against a single month's limit made the month it lands look
-- like a huge overspend and every other month look falsely empty. Cadence lets the limit and the
-- window it's measured over match how the category is actually billed.
ALTER TABLE Budgets ADD Cadence NVARCHAR(20) NOT NULL CONSTRAINT DF_Budgets_Cadence DEFAULT 'Monthly';

-- Renamed now that a limit isn't always a monthly figure — it's whatever's due once per Cadence.
EXEC sp_rename 'Budgets.MonthlyLimit', 'LimitAmount', 'COLUMN';

-- The same real transaction can enter twice through different doors: a CSV import dedups on a
-- hash of its own row (csv:...), a bank sync dedups on the bank's transaction id, and neither
-- can see the other's key. Import a statement covering a period you later sync — or sync history
-- covering a period you already imported — and every overlapping transaction exists twice.
--
-- Flagged rather than deleted: identical same-day charges at the same merchant are a real
-- pattern (two coffees, two scooter passes), so this must be reversible and reviewable.
ALTER TABLE Transactions ADD IsDuplicate BIT NOT NULL DEFAULT 0;

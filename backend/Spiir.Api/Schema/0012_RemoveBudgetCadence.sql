-- Cadence (0011) required naming one schedule for an entire budget group, but a group routinely
-- mixes a monthly cost with a quarterly or yearly one — rent and a mortgage both file under
-- "Housing" — so no single tag was ever actually correct for the group. Replaced with an
-- automatic trailing-12-month average (computed in BudgetEndpoints, not stored), which smooths
-- any lumpy charge without being told its schedule or needing every group to share one.
ALTER TABLE Budgets DROP CONSTRAINT DF_Budgets_Cadence;
ALTER TABLE Budgets DROP COLUMN Cadence;

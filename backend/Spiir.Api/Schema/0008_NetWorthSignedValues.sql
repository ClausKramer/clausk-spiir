-- Net worth values are stored exactly as entered, signed, for every kind of account.
--
-- 0007 stored liabilities as a magnitude and let IsLiability supply the direction. That was
-- wrong, and importing a real spreadsheet showed why: an account is not permanently one side of
-- the balance. A current account swings between in credit and overdrawn. A Nordea
-- prioritetskonto reads like a mortgage but can sit in credit. A loan can be overpaid. Forcing a
-- sign means the data can only express the case the classification anticipated.
--
-- So the sign is the data and the kind is only a label. Net worth is now the plain sum of every
-- recorded value, which is also what the spreadsheet this was imported from does.
--
-- Idempotent by construction: -ABS(x) lands on the same value however many times it runs.
UPDATE s
SET Value = -ABS(s.Value)
FROM NetWorthSnapshots s
JOIN NetWorthAccounts a ON a.Id = s.NetWorthAccountId AND a.UserId = s.UserId
WHERE a.IsLiability = 1;

-- Automatic transfer detection can only ever match pairs where both legs are present: a transfer
-- to an account the user hasn't connected (a spouse, a pension, another bank) has no counterpart
-- to find, and no heuristic will ever catch it. This lets the user say so explicitly, and that
-- answer outranks the heuristic in both directions.
ALTER TABLE Transactions ADD IsManualTransfer BIT NOT NULL DEFAULT 0;

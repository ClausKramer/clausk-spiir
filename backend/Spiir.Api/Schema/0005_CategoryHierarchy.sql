-- Categories become a two-level tree: top-level groups for reading a budget at a glance, leaves
-- for actually filing a transaction. Parents are containers — rules and transactions attach to
-- leaves — but nothing forbids a transaction sitting on a parent, so pre-existing data stays
-- valid while it's being reorganised.
ALTER TABLE Categories ADD ParentCategoryId UNIQUEIDENTIFIER NULL;

-- Kind is what makes a budget answerable rather than just itemised: which spending is committed
-- and which is discretionary, and which movements (saving, debt, transfers) aren't spending at
-- all. Held on the category rather than inferred, unlike the recurring/one-off heuristic.
ALTER TABLE Categories ADD Kind NVARCHAR(20) NOT NULL DEFAULT 'Variable';

-- Wrapped in EXEC because the migrator runs each script as a single batch, and a constraint
-- can't reference a column added earlier in that same batch — the statement is parsed before
-- the column exists. EXEC defers compilation to its own scope, which is the standard idiom here
-- (there is no GO: that's a client-side batch separator, not T-SQL, and Dapper would reject it).
--
-- The self-reference is NO ACTION: Categories already cascades from Users, and a second cascade
-- path into the same table is rejected by SQL Server — the same restriction documented for
-- Transactions in 0001.
EXEC('ALTER TABLE Categories ADD CONSTRAINT FK_Categories_Parent
      FOREIGN KEY (ParentCategoryId) REFERENCES Categories (Id)');
EXEC('CREATE INDEX IX_Categories_ParentCategoryId ON Categories (ParentCategoryId)');

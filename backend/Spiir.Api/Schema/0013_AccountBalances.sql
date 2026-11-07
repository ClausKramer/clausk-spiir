-- The bank's own balance, stored next to the account it describes.
--
-- Until now the app could not say what is actually in an account. Every "balance" on screen was a
-- running sum of the transactions we happen to hold (TransactionRepository.GetNetBalanceAsync),
-- and that sum is only ever as complete as the history the bank served — which is why the
-- dashboard figure is labelled "net balance (tracked)" and the net worth form calls its prefill a
-- suggestion. 0007 already named the right authority ("the bank's own balance is the authority,
-- not our running total"); there was simply no column to put it in.
--
-- Two dates, not one, because they answer different questions and routinely disagree: a balance
-- fetched this morning can carry yesterday's reference date. Collapsing them into a single "as of"
-- would let a stale figure render as a current one, which is the failure this feature exists to
-- prevent.
ALTER TABLE BankAccounts ADD
    -- Signed exactly as the bank reports it, so an overdrawn account is negative. Nothing
    -- normalises the sign, for the same reason net worth stopped doing so in 0008: an account is
    -- not permanently one side of the balance, and a forced sign can only express the case the
    -- classification anticipated.
    Balance              DECIMAL(18, 2) NULL,
    -- The balance's own currency, which is not necessarily the account's. A DKK account can report
    -- a balance in EUR, and rendering one as the other is a wrong number, not a formatting detail.
    BalanceCurrency      NVARCHAR(3)    NULL,
    -- The ISO 20022 balance type the bank sent (CLBD, ITBD, ITAV, XPCD, ...), kept verbatim so the
    -- UI can say which balance this is instead of implying every bank means the same thing by the
    -- word. Booked and available are different figures: available can include an overdraft
    -- facility and money not yet settled.
    BalanceType          NVARCHAR(10)   NULL,
    -- The date the bank says the figure describes.
    BalanceReferenceDate DATE           NULL,
    -- When we read it. Distinct from the reference date: this one ages, that one does not.
    BalanceFetchedAt     DATETIME2      NULL;

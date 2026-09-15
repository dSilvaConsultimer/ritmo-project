-- DEC-131: repair pre-existing duplicate PaymentSources for the same
-- canonical provider-account identity (financial_profile_id, provider,
-- external_account_id) BEFORE the unique constraint below is added — see
-- docs/DECISIONS.md DEC-131. These duplicates were created by the
-- pre-DEC-131 sync path's find-then-insert pattern, which had no
-- database-level protection against two concurrent/overlapping syncs of
-- the same provider account both observing "no existing row" and both
-- inserting. Manually-entered payment sources (provider AND
-- external_account_id both null) are never touched or affected — this
-- repair, and the constraint it prepares for, only ever apply to rows
-- where both are known.
--
-- For each duplicate group, the row with the fewest NULL balance fields
-- (most complete) is preferred; ties broken by the most recently synced
-- row, then by id for full determinism. This is a one-time, idempotent
-- repair: a database with no duplicates leaves every temp table empty and
-- every UPDATE/DELETE below a no-op.
CREATE TEMP TABLE payment_source_duplicates AS
WITH ranked AS (
  SELECT
    id,
    financial_profile_id,
    provider,
    external_account_id,
    ROW_NUMBER() OVER (
      PARTITION BY financial_profile_id, provider, external_account_id
      ORDER BY
        (
          (available_balance_cents IS NOT NULL)::int +
          (reserved_balance_cents IS NOT NULL)::int +
          (automatically_invested_balance_cents IS NOT NULL)::int +
          (balance_cents IS NOT NULL)::int
        ) DESC,
        last_synced_at DESC NULLS LAST,
        id ASC
    ) AS rank
  FROM payment_sources
  WHERE provider IS NOT NULL AND external_account_id IS NOT NULL
)
SELECT
  r.id AS duplicate_id,
  c.id AS canonical_id
FROM ranked r
JOIN ranked c
  ON c.financial_profile_id = r.financial_profile_id
 AND c.provider = r.provider
 AND c.external_account_id = r.external_account_id
 AND c.rank = 1
WHERE r.rank > 1;
--> statement-breakpoint
-- Repoint every real transaction from a duplicate PaymentSource onto its
-- canonical counterpart — never deletes or duplicates a transaction, only
-- corrects which account it is attributed to.
UPDATE financial_transactions t
SET payment_source_id = d.canonical_id
FROM payment_source_duplicates d
WHERE t.payment_source_id = d.duplicate_id;
--> statement-breakpoint
-- Same repointing for installment plans (nullable payment_source_id, but
-- update is a no-op where it doesn't match).
UPDATE installment_plans ip
SET payment_source_id = d.canonical_id
FROM payment_source_duplicates d
WHERE ip.payment_source_id = d.duplicate_id;
--> statement-breakpoint
-- Same repointing for bills.
UPDATE bills b
SET payment_source_id = d.canonical_id
FROM payment_source_duplicates d
WHERE b.payment_source_id = d.duplicate_id;
--> statement-breakpoint
-- Every reference has been repointed to the canonical row — the duplicate
-- rows are now safe to remove.
DELETE FROM payment_sources ps
USING payment_source_duplicates d
WHERE ps.id = d.duplicate_id;
--> statement-breakpoint
DROP TABLE payment_source_duplicates;
--> statement-breakpoint
-- Verification + enforcement in one step: if any duplicate somehow
-- survived the repair above, this constraint fails to create and the
-- whole migration (a single transaction) rolls back rather than silently
-- leaving the invariant unprotected.
ALTER TABLE "payment_sources" ADD CONSTRAINT "payment_sources_financial_profile_id_provider_external_account_id_unique" UNIQUE("financial_profile_id","provider","external_account_id");

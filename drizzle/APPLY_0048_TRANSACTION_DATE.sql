-- One paste, one transaction: apply migration 0048 (the transaction date
-- on a quality audit) and record it in drizzle's tracker, the way this
-- project applies migrations to production (the Supabase SQL editor as
-- postgres). Safe to run twice: the column is added only if missing, the
-- tracker insert is guarded. Nothing to re-grant: the app role already
-- reads and writes qa_audits.

begin;

-- The date of the call, case or fax being audited. The audit date is the
-- day the audit is filed, which the page now locks to today. Null on the
-- audits filed before this was asked for.
ALTER TABLE "qa_audits" ADD COLUMN IF NOT EXISTS "transaction_date" date;

--> statement-breakpoint
insert into drizzle.__drizzle_migrations (hash, created_at)
select '35457a61d801ff7063469ace2054532a3faab777c3caea3a3d46080bdb0de19d', 1789279597629 -- 0048_transaction_date
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = '35457a61d801ff7063469ace2054532a3faab777c3caea3a3d46080bdb0de19d');

commit;

-- Verify: expect 1.
select count(*) as column_present from information_schema.columns
 where table_name = 'qa_audits' and column_name = 'transaction_date';

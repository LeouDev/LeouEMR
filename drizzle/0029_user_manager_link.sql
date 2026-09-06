-- Explicit link from a manager login to the manager name used in the source
-- data. The workbook has no manager EID, so a manager's span was previously
-- keyed on the account's display name — which returns nobody whenever the
-- two spellings differ, and would collide for two managers sharing a name.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "manager_name" text;

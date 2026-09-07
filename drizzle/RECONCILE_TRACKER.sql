-- One-off: tell drizzle about five migrations that were applied by hand.
--
-- NOT a migration. Do not add it to the journal. Run it once, then never again.
--
-- Background. drizzle records what it has applied in drizzle.__drizzle_migrations,
-- keyed by the sha256 of each migration file's contents. Thirty-three migrations
-- were applied through `drizzle-kit migrate` and are recorded there. Five more —
-- 0034 through 0038 — were applied straight into the database instead, so their
-- DDL is live but drizzle has no record of it. Left alone, the next
-- `npm run db:migrate` would try to create tables that already exist and fail.
--
-- Each hash below was computed from the file it names and verified against the
-- same algorithm that produced the thirty-three rows already present, so a wrong
-- hash here cannot silently mark the wrong migration as done. The timestamps are
-- the journal's own `when` values, keeping the recorded order faithful.
--
-- Verify before:  select count(*) from drizzle.__drizzle_migrations;  -- expect 33
-- Verify after:   select count(*) from drizzle.__drizzle_migrations;  -- expect 38
--
-- Then run `npm run db:migrate`, which will apply exactly one migration:
-- 0039_require_source_import.sql.
insert into drizzle.__drizzle_migrations (hash, created_at) values
  ('5063fbe720dcc857734e116dfcd7d31bfd74bbed0761a9bb22deb3a5742edd69', 1788708114857), -- 0034_employee_assignments
  ('f8360d82ac1e110843790c3a86db3161e935771c68ac843501a20d39e301e5bf', 1788708115857), -- 0035_pto_code_sequence
  ('6b8fe974e1a756233651c950a758e7ffd2ac523085f8cc20b356fd688dd52626', 1788708116857), -- 0036_scoping_indexes
  ('faf7d2cc29072e7e9cb8d8ba77b771251d76428aa498bf13af6dbc9a02fe8bc6', 1788711077262), -- 0037_time_motion_studies
  ('35d6b9debf46e9639c5e296c3ba4a349003085d6aab039dd1a7a20a3e761893e', 1788720995488)  -- 0038_ramp_schedules
on conflict do nothing;

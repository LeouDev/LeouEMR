-- Custom SQL migration file, put your code below! --

-- MBO is assessed monthly: it is the composite the MBO page and the
-- dashboards report on, not a weekly measure to open development items
-- against. Its weekly failures no longer open action items, and the items
-- already opened for it drop off every list at once, since every list reads
-- this flag (OPENS_ACTION_ITEMS in src/lib/queries/performance.ts). The
-- historical rows stay; nothing is deleted. Same mechanism 0013 used for the
-- PAR rating, DPU and DPO.
update public.kpi_definitions set generates_action_items = false where code = 'MBO';

-- Case rate becomes a KPI in its own right, so a case-rate agent's only
-- output measure can open a development item like any other KPI. It is
-- derived from the per-skill facts (production weight per case, against the
-- weight the agent's own skill mix expected of the cases worked), so its
-- target is per employee-week and travels on each weekly row; the definition
-- itself carries none. See src/lib/kpi-engine/case-rate.ts.
insert into public.kpi_definitions
  (code, name, type, direction, target, generates_action_items, aggregation)
values
  ('CASE_RATE', 'Case Rate', 'number', 'higher_is_better', null, true, 'derived')
on conflict (code) do nothing;

-- Every update of a checklist item moves updated_at to its transaction's start
-- time, like the other stamped Realtime tables (TRANSACTION_STAMPED_TABLES in
-- lib/realtime/tables.ts). Its Realtime event then names the save it came
-- from, and the saving tab skips the echo its own response already rendered
-- (lib/realtime/own-writes.ts). `bun run realtime:check` verifies the trigger.
create trigger job_instruction_items_updated_at
  before update on public.job_instruction_items
  for each row execute function public.set_updated_at();

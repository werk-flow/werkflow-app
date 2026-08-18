-- Add pending_delete status to time_entry_status enum
-- This allows entries to be "soft deleted" while awaiting approval
ALTER TYPE time_entry_status ADD VALUE 'pending_delete';

COMMENT ON TYPE time_entry_status IS 
  'Status of a time entry: pending (awaiting approval), approved, rejected, or pending_delete (marked for deletion awaiting approval)';
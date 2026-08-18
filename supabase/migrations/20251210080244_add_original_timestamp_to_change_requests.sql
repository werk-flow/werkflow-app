-- Add original_timestamp column to entry_change_requests
-- This stores the original timestamp before an edit is applied
-- Used to revert the edit if the request is rejected
ALTER TABLE entry_change_requests
ADD COLUMN original_timestamp TIMESTAMPTZ;

COMMENT ON COLUMN entry_change_requests.original_timestamp IS 
  'Stores the original timestamp before an edit is applied. Used to revert the change if rejected.';
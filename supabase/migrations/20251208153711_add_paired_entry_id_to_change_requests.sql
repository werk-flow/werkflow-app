-- Add paired_entry_id column to entry_change_requests table
-- This allows delete requests to reference both entries in a clock_in/clock_out pair
ALTER TABLE entry_change_requests
ADD COLUMN paired_entry_id uuid REFERENCES time_entries(id) ON DELETE SET NULL;

-- Add comment explaining the column
COMMENT ON COLUMN entry_change_requests.paired_entry_id IS 'For paired delete requests: references the second entry (typically clock_out) when deleting a clock_in/clock_out pair together';
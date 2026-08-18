-- Create enum for change request types
CREATE TYPE entry_change_type AS ENUM ('edit', 'delete');

-- Create enum for change request status
CREATE TYPE change_request_status AS ENUM ('pending', 'approved', 'rejected');

-- Create entry_change_requests table
CREATE TABLE entry_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL,
  change_type entry_change_type NOT NULL,
  -- For edit requests, store the proposed new timestamp
  proposed_timestamp TIMESTAMPTZ,
  -- Status of the request
  status change_request_status NOT NULL DEFAULT 'pending',
  -- Review info
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX idx_entry_change_requests_org ON entry_change_requests(organization_id);
CREATE INDEX idx_entry_change_requests_status ON entry_change_requests(status);
CREATE INDEX idx_entry_change_requests_entry ON entry_change_requests(entry_id);

-- Enable RLS
ALTER TABLE entry_change_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Admins can see all change requests in their org
CREATE POLICY "Admins can view all change requests"
  ON entry_change_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = entry_change_requests.organization_id
      AND organization_members.user_id = auth.uid()
      AND organization_members.role = 'admin'
    )
  );
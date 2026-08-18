
-- =====================================================
-- ORGANIZATIONS TABLE
-- =====================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can only see organizations they are members of
CREATE POLICY "Members can view their organizations"
ON public.organizations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_members.organization_id = organizations.id
    AND organization_members.user_id = auth.uid()
  )
);

-- =====================================================
-- ORGANIZATION_MEMBERS TABLE
-- =====================================================
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can see members of organizations they belong to
CREATE POLICY "Members can view org members"
ON public.organization_members FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members AS my_membership
    WHERE my_membership.organization_id = organization_members.organization_id
    AND my_membership.user_id = auth.uid()
  )
);

-- =====================================================
-- ORGANIZATION_INVITES TABLE
-- =====================================================
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

-- SELECT: Only admins can view invites for their organizations
CREATE POLICY "Admins can view org invites"
ON public.organization_invites FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.organizations
    WHERE organizations.id = organization_invites.organization_id
    AND organizations.admin_id = auth.uid()
  )
);

-- =====================================================
-- SUBSCRIPTIONS TABLE
-- =====================================================
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can only view their own subscription
CREATE POLICY "Users can view own subscription"
ON public.subscriptions FOR SELECT
USING (user_id = auth.uid());

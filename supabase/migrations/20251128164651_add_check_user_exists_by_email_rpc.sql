
-- Create a function to check if a user exists by email
-- This is a SECURITY DEFINER function that can access auth.users
CREATE OR REPLACE FUNCTION public.check_user_exists_by_email(p_email text)
RETURNS TABLE(user_id uuid, user_exists boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id as user_id,
    true as user_exists
  FROM auth.users u
  WHERE u.email = lower(p_email)
  LIMIT 1;
  
  -- If no rows returned, return null user_id and false
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid as user_id, false as user_exists;
  END IF;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.check_user_exists_by_email(text) TO authenticated;

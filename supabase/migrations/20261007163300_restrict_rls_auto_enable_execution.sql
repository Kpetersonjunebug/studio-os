-- Supabase's automatic-RLS event trigger still runs internally as its owner.
-- It does not need to be callable through the public Data API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

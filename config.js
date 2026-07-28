// Replace both values with your Supabase project values.
// Supabase Dashboard > Project Settings > API
const SUPABASE_URL = "https://cyumynzbwqayuopguove.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hDo0_X08IS6Xt5PG4VOv3Q_wbz9ru2u";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

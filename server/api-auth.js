import { createClient } from '@supabase/supabase-js';

export function extractBearerToken(headers) {
  const headerValue = headers?.authorization;
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

export function createAuthVerifier(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const supabaseServerKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !supabaseServerKey) {
    return async () => {
      throw new Error('Supabase auth is not configured.');
    };
  }

  const supabase = createClient(supabaseUrl, supabaseServerKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return async function verifyAccessToken(accessToken) {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user?.email) throw new Error('Unable to verify the Supabase session.');
    return { email: data.user.email.toLowerCase() };
  };
}

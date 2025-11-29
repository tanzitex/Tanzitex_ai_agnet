// utils/supabase.js
// Robust supabase client — checks multiple common env names and throws a clear message.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON;

if (!url || !key) {
  // Throw a clear error message that will appear in Vercel runtime logs.
  throw new Error(
    'SUPABASE_URL and SUPABASE_KEY are required. ' +
    'Set SUPABASE_URL and SUPABASE_KEY (or SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY) in Vercel Environment Variables.'
  );
}

export const supabase = createClient(url, key);

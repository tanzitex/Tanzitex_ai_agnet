// pages/api/env-check.js
export default function handler(req, res) {
  const needed = [
    'SUPABASE_URL',
    'SUPABASE_KEY',
    'OPENAI_API_KEY',
    'WHATSAPP_API_KEY',
    'VECTOR_TABLE_NAME'
  ];
  const missing = needed.filter(k => !process.env[k]);
  if (missing.length) {
    return res.status(500).json({ ok: false, missing });
  }
  return res.json({
    ok: true,
    SUPABASE_URL: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/^(https?:\/\/)(.*)$/, '$1…') : null
  });
}

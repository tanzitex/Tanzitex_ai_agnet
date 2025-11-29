// api/env-check.js
module.exports = (req, res) => {
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
  return res.json({ ok: true });
};

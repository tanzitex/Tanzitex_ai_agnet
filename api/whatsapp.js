// api/whatsapp.js
// Debug wrapper for runtime error tracing.
// Replace your existing file contents with this, commit, and push.

import { supabase } from '../utils/supabase.js'; // keep path you already have
// If utils/supabase.js uses `createClient` and throws, this will catch it below.

export default async function handler(req, res) {
  try {
    // Basic method guard
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    // Log incoming body (very helpful)
    const body = req.body ?? {};
    console.log('[whatsapp] incoming body:', JSON.stringify(body));

    // Quick validation
    if (!body.message) {
      console.log('[whatsapp] missing message');
      return res.status(400).json({ ok: false, error: 'missing_message' });
    }

    // Example: simple DB insert to confirm supabase works
    // Ensure the table `inbox` exists. This insert is small and safe.
    try {
      const { error: dbError } = await supabase.from('inbox').insert([{ payload: body }]);
      if (dbError) {
        console.error('[whatsapp] supabase insert error:', dbError);
        // do not crash — return a clear error
        return res.status(500).json({ ok: false, error: 'supabase_insert_failed', details: dbError.message || dbError });
      }
      console.log('[whatsapp] supabase insert ok');
    } catch (e) {
      console.error('[whatsapp] supabase threw:', e.stack || e);
      return res.status(500).json({ ok: false, error: 'supabase_exception', details: (e && e.message) || String(e) });
    }

    // Temporary echo reply (we won't call external WhatsApp provider here)
    return res.json({ ok: true, echo: { message: body.message, from: body.from ?? null } });
  } catch (err) {
    console.error('[whatsapp] UNCAUGHT ERROR:', err.stack || err);
    // Return generic 500 but include minimal message
    return res.status(500).json({ ok: false, error: 'internal_server_error', message: (err && err.message) || String(err) });
  }
}

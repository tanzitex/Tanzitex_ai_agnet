import { supabase } from '../utils/supabase.js';

const VERIFY_TOKEN = 'tanzitex12345'; // EXACT same as Meta console

export default async function handler(req, res) {
  // 1) WEBHOOK VERIFICATION (Meta sends GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[whatsapp] verify request:', { mode, token, challenge });

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[whatsapp] WEBHOOK VERIFIED');
      return res.status(200).send(challenge);
    } else {
      console.log('[whatsapp] WEBHOOK VERIFY FAILED');
      return res.status(403).send('Verification failed');
    }
  }

  // 2) NORMAL WEBHOOK EVENTS (Meta sends POST when messages come)
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const body = req.body ?? {};
    console.log('[whatsapp] incoming body:', JSON.stringify(body));

    if (!body.message) {
      console.log('[whatsapp] missing message');
      return res.status(400).json({ ok: false, error: 'missing_message' });
    }

    // Example insert into Supabase (same as before)
    try {
      const { error: dbError } = await supabase
        .from('inbox')
        .insert([{ payload: body }]);

      if (dbError) {
        console.error('[whatsapp] supabase insert error:', dbError);
        return res.status(500).json({
          ok: false,
          error: 'supabase_insert_failed',
          details: dbError.message || dbError,
        });
      }

      console.log('[whatsapp] supabase insert ok');
    } catch (e) {
      console.error('[whatsapp] supabase threw:', e.stack || e);
      return res.status(500).json({
        ok: false,
        error: 'supabase_exception',
        details: (e && e.message) || String(e),
      });
    }

    // temporary echo
    return res.json({
      ok: true,
      echo: { message: body.message, from: body.from ?? null },
    });
  } catch (err) {
    console.error('[whatsapp] UNCAUGHT ERROR:', err.stack || err);
    return res.status(500).json({
      ok: false,
      error: 'internal_server_error',
      message: (err && err.message) || String(err),
    });
  }
}

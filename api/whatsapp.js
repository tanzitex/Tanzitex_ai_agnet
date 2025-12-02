// --- secure GET verification (place at top of handler, before any signature checks) ---
if (req.method === 'GET') {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('[whatsapp] verify request:', { mode, token, challenge });

  // Use environment variable so you can change token without editing code
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'tanzitex12345';

  if (mode === 'subscribe' && token === VERIFY_TOKEN && typeof challenge !== 'undefined') {
    console.log('[whatsapp] WEBHOOK VERIFIED (GET) - returning challenge');
    return res.status(200).send(challenge.toString());
  }

  console.warn('[whatsapp] WEBHOOK VERIFY FAILED - token mismatch or missing challenge');
  return res.status(403).send('Forbidden - verify token mismatch');
}

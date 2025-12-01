// /api/aisensy-webhook.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const AISENSY_CAMPAIGN_ID = process.env.AISENSY_CAMPAIGN_ID; // auto_reply_fallback_api
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// helper: now()
const nowISOString = () => new Date().toISOString();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ----------------------------
    // 1) Verify webhook secret
    // ----------------------------
    // AiSensy may send token header or include token in body. Check both.
    const incomingToken = (req.headers['x-aisensy-token'] || req.headers['x-webhook-token'] || req.query.token || req.body?.token || '').toString();
    if (WEBHOOK_SECRET && incomingToken !== WEBHOOK_SECRET) {
      console.warn('Webhook token mismatch', incomingToken);
      return res.status(403).json({ ok: false, message: 'forbidden' });
    }

    // ----------------------------
    // 2) Parse inbound payload (adapt to AiSensy shape)
    // ----------------------------
    // AiSensy payloads vary. These lines try common paths.
    const payload = req.body || {};
    const data = payload.data || payload || {};

    const phone = data?.phone || data?.from || data?.sender || payload?.from || null;
    const messageText = data?.message || data?.text || data?.body || payload?.message || '';
    const messageId = data?.message_id || data?.id || payload?.messageId || `${phone}-${Date.now()}`;
    const timestamp = data?.timestamp || payload?.timestamp || nowISOString();

    if (!phone) {
      console.error('No phone found in payload', payload);
      return res.status(400).json({ ok: false, message: 'invalid payload: no phone' });
    }

    // ----------------------------
    // 3) Idempotency: check message_id
    // ----------------------------
    const { data: existing } = await supabase
      .from('inbox')
      .select('id')
      .eq('message_id', messageId)
      .limit(1)
      .maybeSingle();

    if (existing) {
      // duplicate webhook call — ack and return
      return res.status(200).json({ ok: true, message: 'duplicate ignored' });
    }

    // ----------------------------
    // 4) Save inbound message
    // ----------------------------
    await supabase.from('inbox').insert([{
      phone,
      message: messageText,
      message_id: messageId,
      direction: 'inbound',
      raw_payload: payload,
      received_at: timestamp
    }]);

    // ----------------------------
    // 5) Determine 24-hour window
    // ----------------------------
    // Find last inbound from this phone
    const { data: lastMessage } = await supabase
      .from('inbox')
      .select('received_at, direction')
      .eq('phone', phone)
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let within24h = false;
    if (lastMessage && lastMessage.received_at) {
      const lastTime = new Date(lastMessage.received_at).getTime();
      const diffMs = Date.now() - lastTime;
      within24h = diffMs <= 24 * 60 * 60 * 1000;
    } else {
      // no prior message -> treat as outside 24h
      within24h = false;
    }

    // ----------------------------
    // 6) Generate reply
    // ----------------------------
    let replyText = 'Thanks — we received your message. We will reply soon.';

    if (within24h) {
      // Call OpenAI for a contextual reply
      try {
        const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini', // change if you prefer another model
            messages: [
              { role: 'system', content: 'You are a concise WhatsApp assistant. Reply in short Hinglish if user message is in Hinglish, otherwise short and helpful.' },
              { role: 'user', content: `Incoming message: ${messageText}` }
            ],
            max_tokens: 200,
            temperature: 0.2
          })
        });
        const openaiJson = await openaiResp.json();
        replyText = openaiJson?.choices?.[0]?.message?.content?.trim() || replyText;
      } catch (err) {
        console.error('OpenAI error', err);
        replyText = 'Sorry, temporary error generating reply. We will get back soon.';
      }
    } else {
      // outside 24h — we will use the approved template below; replyText used as template param
      replyText = `Hi, thanks for messaging. We will reply soon.`; // fallback param value
    }

    // ----------------------------
    // 7) Save outbound row (pending)
    // ----------------------------
    const outboundInsert = {
      phone,
      message: replyText,
      direction: 'outbound',
      message_id: null,
      raw_payload: null,
      sent_at: null,
      status: 'pending',
      created_at: nowISOString()
    };
    const { data: outRow } = await supabase.from('inbox').insert([outboundInsert]).select().single();

    // ----------------------------
    // 8) Send via AiSensy
    // If within 24h -> freeform text
    // If outside 24h -> send template params (use AISENSY_CAMPAIGN_ID that points to fallback template)
    // ----------------------------
    try {
      const aisensyEndpoint = 'https://backend.aisensy.com/campaign/t1/api/v2';
      let aisBody = {
        apiKey: AISENSY_API_KEY,
        campaignName: AISENSY_CAMPAIGN_ID,
        destination: phone
      };

      if (within24h) {
        aisBody.message = replyText; // freeform (check AiSensy docs if field name differs)
      } else {
        // send template - use templateParams array with appropriate param count
        // We'll pass replyText as first param (if your template accepts 1 param)
        aisBody.templateName = 'auto_reply_fallback'; // ensure this matches your template name in AiSensy
        aisBody.templateParams = [ replyText ];
      }

      const aisResp = await fetch(aisensyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aisBody)
      });

      const aisJson = await aisResp.json();

      // update outbound row status
      await supabase.from('inbox').update({
        status: aisJson?.status || 'sent',
        sent_at: nowISOString(),
        raw_payload: aisJson,
        message_id: aisJson?.messageId || aisJson?.data?.message_id || outRow?.id
      }).eq('id', outRow.id);

    } catch (err) {
      console.error('AiSensy send error', err);
      // mark outbound failed
      await supabase.from('inbox').update({
        status: 'failed',
        sent_at: nowISOString(),
        raw_payload: { error: String(err) }
      }).eq('id', outRow.id);
    }

    // ----------------------------
    // 9) Acknowledge webhook to AiSensy immediately
    // ----------------------------
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook handler error', err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}

// /api/aisensy-webhook.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const AISENSY_CAMPAIGN_ID = process.env.AISENSY_CAMPAIGN_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const nowISOString = () => new Date().toISOString();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const incomingToken = (req.headers['x-aisensy-token'] || req.headers['x-webhook-token'] || req.query.token || req.body?.token || '').toString();
    if (WEBHOOK_SECRET && incomingToken !== WEBHOOK_SECRET) {
      console.warn('Webhook token mismatch', { incomingToken });
      return res.status(403).json({ ok: false, message: 'forbidden' });
    }

    const payload = req.body || {};
    const data = payload.data || payload || {};

    const phone = data?.phone || data?.from || data?.sender || payload?.from || null;
    const messageText = data?.message || data?.text || data?.body || payload?.message || '';
    const messageId = data?.message_id || data?.id || payload?.messageId || `${phone}-${Date.now()}`;
    const timestamp = data?.timestamp || payload?.timestamp || nowISOString();

    if (!phone) {
      console.error('No phone in payload', { payload });
      return res.status(400).json({ ok: false, message: 'invalid payload: no phone' });
    }

    // idempotency: check existing message_id
    const { data: existing, error: existingErr } = await supabase
      .from('inbox')
      .select('id')
      .eq('message_id', messageId)
      .limit(1)
      .maybeSingle();

    if (existingErr) {
      console.error('Supabase select error (idempotency)', existingErr);
      // continue — we can still try to process, but be careful
    }
    if (existing) {
      return res.status(200).json({ ok: true, message: 'duplicate ignored' });
    }

    // Save inbound message
    const inboundRow = {
      phone,
      message: messageText,
      message_id: messageId,
      direction: 'inbound',
      raw_payload: payload,
      received_at: timestamp,
      created_at: nowISOString()
    };
    const { data: insertInboundData, error: insertInboundError } = await supabase.from('inbox').insert([inboundRow]).select().maybeSingle();
    if (insertInboundError) {
      console.error('Failed to insert inbound row', insertInboundError, { inboundRow });
      // still ack webhook to avoid retries from AiSensy, but return error for logs
      return res.status(500).json({ ok: false, error: 'db_inbound_insert_failed' });
    }

    // Determine 24h window: use last inbound message (excluding the one we just inserted)
    const { data: lastMsgs, error: lastErr } = await supabase
      .from('inbox')
      .select('received_at,direction')
      .eq('phone', phone)
      .order('received_at', { ascending: false })
      .limit(2); // get last two to skip current inserted row
    if (lastErr) console.error('supabase lastMsg error', lastErr);

    let within24h = false;
    if (Array.isArray(lastMsgs) && lastMsgs.length > 1) {
      // second item is previous message
      const prev = lastMsgs[1];
      if (prev && prev.received_at) {
        const diffMs = Date.now() - new Date(prev.received_at).getTime();
        within24h = diffMs <= 24 * 60 * 60 * 1000;
      }
    } else {
      within24h = false;
    }

    // Generate reply
    let replyText = 'Thanks — we received your message. We will reply soon.';
    if (within24h) {
      try {
        const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a concise WhatsApp assistant. Reply in short Hinglish if user uses Hinglish.' },
              { role: 'user', content: `Incoming message: ${messageText}` }
            ],
            max_tokens: 200,
            temperature: 0.2
          })
        });
        const openaiJson = await openaiResp.json();
        replyText = openaiJson?.choices?.[0]?.message?.content?.trim() || replyText;
      } catch (err) {
        console.error('OpenAI call failed', err);
        replyText = 'Sorry, temporary error generating reply.';
      }
    } else {
      // fallback param
      replyText = `Hi, thanks for messaging. We'll reply soon.`;
    }

    // Insert outbound row (pending)
    const outboundInsert = {
      phone,
      message: replyText,
      direction: 'outbound',
      status: 'pending',
      raw_payload: null,
      sent_at: null,
      created_at: nowISOString()
    };
    const { data: outData, error: outErr } = await supabase.from('inbox').insert([outboundInsert]).select().maybeSingle();
    if (outErr || !outData) {
      console.error('Failed to insert outbound row', outErr, { outboundInsert, outData });
      // we attempted to create outbound row but it failed — still try to send, but record will be missing
    }

    // Send via AiSensy
    try {
      const aisensyEndpoint = 'https://backend.aisensy.com/campaign/t1/api/v2';
      let aisBody = {
        apiKey: AISENSY_API_KEY,
        campaignName: AISENSY_CAMPAIGN_ID,
        destination: phone
      };
      if (within24h) aisBody.message = replyText;
      else {
        aisBody.templateName = 'auto_reply_fallback';
        aisBody.templateParams = [replyText];
      }
      const aisResp = await fetch(aisensyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aisBody)
      });
      const aisJson = await aisResp.json();

      // update outbound row if present
      if (outData && outData.id) {
        const upd = {
          status: aisJson?.status || 'sent',
          sent_at: nowISOString(),
          raw_payload: aisJson,
          message_id: aisJson?.messageId || aisJson?.data?.message_id || null
        };
        const { error: updErr } = await supabase.from('inbox').update(upd).eq('id', outData.id);
        if (updErr) console.error('Failed to update outbound row', updErr, { upd, outId: outData.id });
      } else {
        // no outData id — create a minimal log row
        await supabase.from('inbox').insert([{
          phone,
          message: replyText,
          direction: 'outbound',
          status: aisJson?.status || 'sent',
          raw_payload: aisJson,
          sent_at: nowISOString(),
          created_at: nowISOString()
        }]).catch(e => console.error('fallback log insert failed', e));
      }
    } catch (err) {
      console.error('AiSensy send error', err);
      if (outData && outData.id) {
        await supabase.from('inbox').update({ status: 'failed', raw_payload: { error: String(err) }, sent_at: nowISOString() }).eq('id', outData.id);
      }
    }

    // ack webhook
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook handler fatal error', err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}

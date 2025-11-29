import { supabase } from "../utils/supabase.js";
import OpenAI from "openai";

export default async function handler(req, res) {
  try {
    const body = req.body;

    // WhatsApp incoming message
    const userMessage = body?.message || "";

    if (!userMessage) {
      return res.json({ reply: "Invalid message received." });
    }

    // Load env variables
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Fetch product related answers using vector search
    const { data: matches } = await supabase.rpc("match_products", {
      query_text: userMessage,
      match_threshold: 0.7,
      match_count: 5
    });

    const productContext = matches
      ?.map(
        (p) =>
          `Title: ${p.title}\nDescription: ${p.short_desc}\nPrice: ${p.price} ${p.currency}\nURL: ${p.url}`
      )
      .join("\n\n");

    const systemPrompt = `
You are TANZITEX AI SALES AGENT.
You reply in friendly Hinglish.
You SELL textile design bundles, memberships & courses.
Always send clear CTA links.
Push urgency & close sales fast.
Product Info:\n${productContext}
    `;

    const aiResponse = await openai.chat.completions.create({
      model: process.env.MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ]
    });

    const finalReply = aiResponse.choices[0].message.content;

    return res.json({ reply: finalReply });
  } catch (err) {
    console.error(err);
    return res.json({ reply: "System error. Try again later." });
  }
}

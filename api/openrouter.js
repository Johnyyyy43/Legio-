// ================================================
// LEGIO — api/openrouter.js
// Vercel Serverless Function — OpenRouter Proxy
//
// Receives: { key, model, messages, system }
// Forwards to: openrouter.ai (OpenAI-compatible)
// Returns: OpenRouter JSON response to client
//
// OpenRouter routes to hundreds of models under
// one OpenAI-compatible API. The model string
// uses format: "provider/model-name"
// e.g. "openai/gpt-4o", "meta-llama/llama-3-8b"
// ================================================

export default async function handler(req, res) {

    if (req.method !== 'POST') {
        return res.status(405).json({ error: { message: 'Method not allowed.' } });
    }

    const { key, model, messages, system } = req.body;

    if (!key || !model || !messages) {
        return res.status(400).json({ error: { message: 'Missing required fields: key, model, messages.' } });
    }

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': 'Bearer ' + key,
                // OpenRouter recommends these headers for attribution
                'HTTP-Referer':  'https://legio.app',
                'X-Title':       'Legio'
            },
            body: JSON.stringify({
                model:    model,
                messages: system
                    ? [{ role: 'system', content: system }, ...messages]
                    : messages,
                max_tokens: 2048
            })
        });

        const data = await response.json();
        return res.status(response.status).json(data);

    } catch (err) {
        return res.status(500).json({ error: { message: 'Proxy error: ' + err.message } });
    }
}

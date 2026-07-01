// ================================================
// LEGIO — api/openai.js
// Vercel Serverless Function — OpenAI Proxy
//
// Receives: { key, model, messages, system }
// Forwards to: api.openai.com
// Returns: OpenAI JSON response directly to client
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
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': 'Bearer ' + key
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

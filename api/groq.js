// ================================================
// LEGIO — api/groq.js
// Vercel Serverless Function — Groq Proxy
//
// Receives: { key, model, messages, system }
// Forwards to: api.groq.com (OpenAI-compatible)
// Returns: Groq JSON response directly to client
// ================================================

export default async function handler(req, res) {

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: { message: 'Method not allowed.' } });
    }

    const { key, model, messages, system } = req.body;

    // Validate required fields
    if (!key || !model || !messages) {
        return res.status(400).json({ error: { message: 'Missing required fields: key, model, messages.' } });
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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

        // Forward the status and body directly
        return res.status(response.status).json(data);

    } catch (err) {
        return res.status(500).json({ error: { message: 'Proxy error: ' + err.message } });
    }
}

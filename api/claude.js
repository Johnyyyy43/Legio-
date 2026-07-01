// ================================================
// LEGIO — api/claude.js
// Vercel Serverless Function — Anthropic Proxy
//
// Receives: { key, model, messages, system }
// Forwards to: api.anthropic.com
// Returns: Anthropic JSON response to client
//
// Note: Claude uses a separate top-level "system"
// field rather than a system role message.
// ================================================

export default async function handler(req, res) {

    if (req.method !== 'POST') {
        return res.status(405).json({ error: { message: 'Method not allowed.' } });
    }

    const { key, model, messages, system } = req.body;

    if (!key || !model || !messages) {
        return res.status(400).json({ error: { message: 'Missing required fields: key, model, messages.' } });
    }

    // Anthropic requires alternating user/assistant turns.
    // If context starts with an assistant message (edge case),
    // prepend an empty user turn to satisfy the API.
    const safeMessages = messages.length > 0 && messages[0].role === 'assistant'
        ? [{ role: 'user', content: '(conversation continued)' }, ...messages]
        : messages;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method:  'POST',
            headers: {
                'Content-Type':      'application/json',
                'x-api-key':         key,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model:      model,
                max_tokens: 2048,
                system:     system || '',
                messages:   safeMessages
            })
        });

        const data = await response.json();
        return res.status(response.status).json(data);

    } catch (err) {
        return res.status(500).json({ error: { message: 'Proxy error: ' + err.message } });
    }
}

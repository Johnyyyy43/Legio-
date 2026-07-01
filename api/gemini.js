// ================================================
// LEGIO — api/gemini.js
// Vercel Serverless Function — Google Gemini Proxy
//
// Receives: { key, model, messages, system }
// Forwards to: generativelanguage.googleapis.com/v1
// Returns: Gemini JSON response to client
// ================================================

export default async function handler(req, res) {

    if (req.method !== 'POST') {
        return res.status(405).json({ error: { message: 'Method not allowed.' } });
    }

    const { key, model, messages, system } = req.body;

    if (!key || !model || !messages) {
        return res.status(400).json({ error: { message: 'Missing required fields: key, model, messages.' } });
    }

    // Gemini API endpoint — v1 (current stable), key in query param
    const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

    // Build request body per Gemini's REST API spec
    const body = {
        contents: messages
    };

    // System instruction — must be camelCase per REST API spec, a Content object with parts array
    if (system) {
        body.systemInstruction = {
            parts: [{ text: system }]
        };
    }

    try {
        const response = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body)
        });

        // Read response as text first to debug parse errors
        const text = await response.text();

        // Detect HTML error pages (invalid key, endpoint down, etc)
        if (text.startsWith('<') || text.startsWith('<!')) {
            console.error('[Gemini] HTML response (likely auth error). Status:', response.status);
            return res.status(response.status || 401).json({
                error: { message: 'Gemini API authentication failed. Check your API key.' }
            });
        }

        let data;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            console.error('[Gemini] JSON parse error. Status:', response.status, 'Response:', text.substring(0, 500));
            return res.status(500).json({
                error: { message: 'Invalid response from Gemini API' }
            });
        }

        return res.status(response.status).json(data);

    } catch (err) {
        console.error('[Gemini] Fetch error:', err.message);
        return res.status(500).json({ error: { message: 'Proxy error: ' + err.message } });
    }
}

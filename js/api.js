"use strict";

// ================================================
// LEGIO — js/api.js
// API Controller v3.0
//
// Responsibilities:
//   - Route messages to the correct provider
//   - Format the shared context for each provider's
//     API shape (OpenAI-style vs Google-style)
//   - Call the Vercel serverless proxy endpoint
//   - Handle and normalise errors from all providers
//
// Depends on: StateManager (state.js)
// Called by:  UIController (ui.js) via handleSend()
//
// PROVIDER MAP:
//   groq      → OpenAI-compatible  → /api/groq
//   openai    → OpenAI-compatible  → /api/openai
//   claude    → Anthropic-style    → /api/claude
//   gemini    → Google-style       → /api/gemini
//   mistral   → OpenAI-compatible  → /api/mistral
//   openrouter→ OpenAI-compatible  → /api/openrouter
// ================================================

const APIController = (function () {

    // ------------------------------------------------
    // 1. PROVIDER CONFIGURATION
    //    Each entry defines:
    //      endpoint  — the Vercel serverless function path
    //      format    — which context formatter to use
//      model     — the default model string to send
    // ------------------------------------------------
    const PROVIDERS = {
        groq: {
            endpoint: '/api/groq',
            format:   'openai',
            model:    'llama-3.3-70b-versatile'
        },
        openai: {
            endpoint: '/api/openai',
            format:   'openai',
            model:    'gpt-4o'
        },
        claude: {
            endpoint: '/api/claude',
            format:   'claude',
            model:    'claude-3-5-sonnet-20241022'
        },
        gemini: {
            endpoint: '/api/gemini',
            format:   'gemini',
            model:    'gemini-3.5-flash'
        },
        mistral: {
            endpoint: '/api/mistral',
            format:   'openai',
            model:    'mistral-large-latest'
        },
        openrouter: {
            endpoint: '/api/openrouter',
            format:   'openai',
            model:    'openai/gpt-4o'
        }
    };

    // ------------------------------------------------
    // 2. CONTEXT FORMATTERS
    //    Each AI provider expects a different message
    //    array shape. These functions convert the
    //    StateManager's neutral context format into
    //    whatever the provider needs.
    // ------------------------------------------------

    // OpenAI-compatible format (also used by Groq, Mistral, OpenRouter)
    // Shape: [{ role: 'user'|'assistant', content: '...' }]
    function _formatOpenAI(context) {
        return context.map(function (msg) {
            return {
                role:    msg.role === 'model' ? 'assistant' : 'user',
                content: msg.content
            };
        });
    }

    // Anthropic Claude format
    // Shape: [{ role: 'user'|'assistant', content: '...' }]
    // Claude also needs a top-level system prompt (sent separately).
    function _formatClaude(context) {
        return context.map(function (msg) {
            return {
                role:    msg.role === 'model' ? 'assistant' : 'user',
                content: msg.content
            };
        });
    }

    // Google Gemini format
    // Shape: [{ role: 'user'|'model', parts: [{ text: '...' }] }]
    function _formatGemini(context) {
        return context.map(function (msg) {
            return {
                role:  msg.role === 'model' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            };
        });
    }

    // Router — picks the right formatter by provider config
    function _formatContext(format, context) {
        switch (format) {
            case 'openai':  return _formatOpenAI(context);
            case 'claude':  return _formatClaude(context);
            case 'gemini':  return _formatGemini(context);
            default:
                throw new Error('[APIController] Unknown format: ' + format);
        }
    }

    // ------------------------------------------------
    // 3. SYSTEM PROMPT
    //    Built dynamically per request (not a static
    //    constant) because it needs to include the
    //    CURRENT list of files in the workspace. This is
    //    what lets a second AI (e.g. "@gemini optimize
    //    Player.js") know Player.js already exists and
    //    what its filename is, without the user having to
    //    re-explain anything — it's reading the same
    //    shared file list every other AI already wrote to.
    //
    //    Models are asked to respond with a fenced
    //    ```json block when they create/edit/delete a
    //    file. ActionParser (action-parser.js) looks for
    //    exactly this shape. If a model ignores this and
    //    just replies with plain code fences instead (some
    //    models are less reliable at following formatting
    //    instructions), CodeBlockParser is used as a
    //    fallback — so nothing breaks either way.
    // ------------------------------------------------
    function _buildSystemPrompt() {
        let fileListText = 'The workspace currently has no files.';

        try {
            const files = FileController.list();
            const fileNames = Object.keys(files).map(function (id) {
                return files[id].name;
            });

            if (fileNames.length > 0) {
                fileListText = 'The workspace currently contains these files: ' +
                    fileNames.join(', ') + '. ' +
                    'If the user asks you to edit, optimize, fix, or explain a file by ' +
                    'name, use that exact filename in your response.';
            }
        } catch (err) {
            // FileController may not be loaded yet in older/partial
            // deployments — degrade gracefully rather than throwing,
            // since a missing file list is not fatal to sending a message.
            console.warn('[APIController] Could not read file list for system prompt:', err.message);
        }

        return (
            'You are an AI assistant inside Legio, a multi-agent project workspace. ' +
            'You share a conversation history with other AI models — you can see ' +
            'everything the user and other AIs have said and done. Be concise, precise, and collaborative.\n\n' +

            fileListText + '\n\n' +

            'When you create, edit, or delete a file, respond with a fenced ```json block ' +
            'in exactly this shape:\n\n' +
            '```json\n' +
            '{\n' +
            '  "message": "A short human-readable summary of what you did.",\n' +
            '  "actions": [\n' +
            '    { "type": "create_file", "name": "Player.js", "content": "...full file content..." },\n' +
            '    { "type": "update_file", "name": "Enemy.js", "content": "...full file content..." }\n' +
            '  ]\n' +
            '}\n' +
            '```\n\n' +
            'Valid action types are: create_file, update_file, delete_file, rename_file. ' +
            'For update_file, always send the COMPLETE new file content, not a diff or partial snippet. ' +
            'For delete_file, only "name" is required. For rename_file, include "name" (current) and "newName". ' +
            'If your reply does not involve creating, editing, deleting, or renaming a file, ' +
            'just reply normally in plain text — do not force a json block when there is nothing to save.'
        );
    }

    // ------------------------------------------------
    // 4. RESPONSE EXTRACTORS
    //    Each provider returns a different JSON shape.
    //    These functions pull the reply text out cleanly.
    // ------------------------------------------------
    function _extractOpenAI(data) {
        if (
            data &&
            data.choices &&
            data.choices[0] &&
            data.choices[0].message &&
            typeof data.choices[0].message.content === 'string'
        ) {
            return data.choices[0].message.content;
        }
        throw new Error('Unexpected OpenAI response shape.');
    }

    function _extractClaude(data) {
        if (
            data &&
            data.content &&
            data.content[0] &&
            typeof data.content[0].text === 'string'
        ) {
            return data.content[0].text;
        }
        throw new Error('Unexpected Claude response shape.');
    }

    function _extractGemini(data) {
        if (
            data &&
            data.candidates &&
            data.candidates[0] &&
            data.candidates[0].content &&
            data.candidates[0].content.parts &&
            data.candidates[0].content.parts[0] &&
            typeof data.candidates[0].content.parts[0].text === 'string'
        ) {
            return data.candidates[0].content.parts[0].text;
        }
        throw new Error('Unexpected Gemini response shape.');
    }

    function _extractReply(format, data) {
        switch (format) {
            case 'openai':  return _extractOpenAI(data);
            case 'claude':  return _extractClaude(data);
            case 'gemini':  return _extractGemini(data);
            default:
                throw new Error('[APIController] Unknown format for extraction: ' + format);
        }
    }

    // ------------------------------------------------
    // 5. CORE SEND FUNCTION
    //    This is what UIController calls.
    //    Returns the reply text as a plain string,
    //    or throws an Error the UI can catch and show.
    // ------------------------------------------------
    async function send(modelName) {
        if (!modelName || typeof modelName !== 'string') {
            throw new Error('[APIController] send: modelName is required.');
        }

        const providerKey = modelName.toLowerCase();
        const provider    = PROVIDERS[providerKey];

        // Unknown provider — tell the user clearly
        if (!provider) {
            throw new Error(
                '"@' + modelName + '" is not a recognised provider. ' +
                'Supported: ' + Object.keys(PROVIDERS).join(', ') + '.'
            );
        }

        // Get the API key for this provider from state
        const apiKey = StateManager.getKey(providerKey);
        if (!apiKey) {
            throw new Error(
                'No API key found for "' + modelName + '". ' +
                'Add one via the + button in the toolbar.'
            );
        }

        // Get the full shared context and format it for this provider
        const rawContext      = StateManager.getContext();
        const formattedMessages = _formatContext(provider.format, rawContext);

        // Build the request payload
        // The Vercel function receives: key, model, messages, system
        const payload = {
            key:      apiKey,
            model:    provider.model,
            messages: formattedMessages,
            system:   _buildSystemPrompt()
        };

        // ---- HTTP Request ----
        let response;
        try {
            response = await fetch(provider.endpoint, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(payload)
            });
        } catch (networkErr) {
            // fetch() itself threw — likely offline or CORS
            throw new Error(
                'Network error reaching ' + provider.endpoint + '. ' +
                'Check your connection. (' + networkErr.message + ')'
            );
        }

        // ---- Parse JSON ----
        let data;
        try {
            data = await response.json();
        } catch (parseErr) {
            throw new Error(
                'Could not parse response from ' + provider.endpoint +
                ' (status ' + response.status + ').'
            );
        }

        // ---- HTTP Error Handling ----
        if (!response.ok) {
            // Try to surface the provider's own error message
            const providerError =
                (data && data.error && data.error.message) ||
                (data && data.message) ||
                'Unknown error';

            throw new Error(
                modelName.charAt(0).toUpperCase() + modelName.slice(1) +
                ' returned ' + response.status + ': ' + providerError
            );
        }

        // ---- Extract Reply Text ----
        return _extractReply(provider.format, data);
    }

    // ------------------------------------------------
    // 6. PROVIDER LIST ACCESSOR
    //    Used by the Add Model modal to show which
    //    providers the app supports.
    // ------------------------------------------------
    function getSupportedProviders() {
        return Object.keys(PROVIDERS);
    }

    // ------------------------------------------------
    // 7. PUBLIC API
    // ------------------------------------------------
    return {
        send:               send,
        getSupportedProviders: getSupportedProviders
    };

})();

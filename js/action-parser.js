"use strict";

// ================================================
// LEGIO — js/action-parser.js
// Action Parser v1.0 (PRIMARY PATH)
//
// Responsibilities:
//   - Look for a structured JSON actions block in an AI's
//     reply (see format below).
//   - If found and valid, return normalised file
//     operations the caller can hand to FileController.
//   - If NOT found or invalid, return null so the caller
//     knows to fall back to CodeBlockParser instead.
//
// Depends on: nothing (pure text-in, data-out module)
// Called by:  ui.js, BEFORE CodeBlockParser — this is
//             tried first on every AI reply.
//
// EXPECTED AI RESPONSE FORMAT (when the model cooperates):
//   Models are instructed via the system prompt (see
//   api.js) to wrap structured actions in a fenced
//   ```json block shaped like:
//
//   ```json
//   {
//     "message": "I created Player.js with basic movement.",
//     "actions": [
//       { "type": "create_file", "name": "Player.js", "content": "..." },
//       { "type": "update_file", "name": "Enemy.js", "content": "..." }
//     ]
//   }
//   ```
//
//   "message" becomes the prose shown in chat.
//   Each action becomes one file operation.
//
// WHY "name" NOT "fileId":
//   The AI doesn't know Legio's internal file IDs — it only
//   knows filenames from what it's seen in the shared
//   context (e.g. "Player.js"). The caller (ui.js) is
//   responsible for resolving "name" to an actual fileId via
//   FileController.findByName(), creating a new one if it
//   doesn't exist yet. This module only extracts intent, it
//   doesn't resolve IDs.
// ================================================

const ActionParser = (function () {

    // ------------------------------------------------
    // 1. FIND A JSON BLOCK IN THE TEXT
    //    Looks specifically for ```json ... ``` fences,
    //    since that's what the system prompt instructs
    //    models to use. Ignores other fence types (those
    //    are left for CodeBlockParser to handle).
    // ------------------------------------------------
    function _extractJSONBlock(text) {
        const JSON_FENCE_REGEX = /```json\s*\n([\s\S]*?)```/;
        const match = text.match(JSON_FENCE_REGEX);
        return match ? match[1].trim() : null;
    }

    // ------------------------------------------------
    // 2. VALIDATE ACTION SHAPE
    //    Defensive — a model could return malformed JSON,
    //    or JSON that doesn't match our expected schema.
    //    Every action must have a recognised "type" and a
    //    "name". "content" is required for create/update,
    //    optional for delete/rename.
    // ------------------------------------------------
    const VALID_TYPES = ['create_file', 'update_file', 'delete_file', 'rename_file'];

    function _isValidAction(action) {
        if (!action || typeof action !== 'object') return false;
        if (VALID_TYPES.indexOf(action.type) === -1) return false;
        if (!action.name || typeof action.name !== 'string') return false;

        if ((action.type === 'create_file' || action.type === 'update_file') &&
            typeof action.content !== 'string') {
            return false;
        }

        if (action.type === 'rename_file' && typeof action.newName !== 'string') {
            return false;
        }

        return true;
    }

    // ------------------------------------------------
    // 3. MAIN PARSE FUNCTION
    //    Input:  raw AI reply text
    //    Output: { proseText, fileOps } on success,
    //            or null if no valid actions block found
    //            (signals the caller to use the fallback)
    // ------------------------------------------------
    function parse(fullText) {
        const jsonStr = _extractJSONBlock(fullText);

        if (!jsonStr) {
            // No ```json block at all — not an error, just means
            // this model replied in plain prose/fences this time.
            return null;
        }

        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        } catch (err) {
            console.warn('[ActionParser] Found a json fence but it did not parse:', err.message);
            return null;
        }

        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.actions)) {
            console.warn('[ActionParser] JSON block found but missing a valid "actions" array.');
            return null;
        }

        const validActions = parsed.actions.filter(_isValidAction);

        if (validActions.length === 0 && parsed.actions.length > 0) {
            console.warn('[ActionParser] All actions failed validation:', parsed.actions);
            return null;
        }

        const fileOps = validActions.map(function (action) {
            switch (action.type) {
                case 'create_file':
                    return { type: 'create', name: action.name, content: action.content };
                case 'update_file':
                    return { type: 'update', name: action.name, content: action.content };
                case 'delete_file':
                    return { type: 'delete', name: action.name };
                case 'rename_file':
                    return { type: 'rename', name: action.name, newName: action.newName };
                default:
                    return null;
            }
        }).filter(Boolean);

        // "message" is the human-readable prose. If the model
        // omitted it, fall back to any text OUTSIDE the json
        // fence, or a generic notice as a last resort.
        let proseText = typeof parsed.message === 'string' ? parsed.message : '';

        if (!proseText) {
            const outsideFence = fullText.replace(/```json\s*\n[\s\S]*?```/, '').trim();
            proseText = outsideFence || '(No summary provided.)';
        }

        console.log('[ActionParser] Parsed', fileOps.length, 'file operation(s) from structured JSON.');

        return {
            proseText: proseText,
            fileOps:   fileOps
        };
    }

    // ------------------------------------------------
    // 4. PUBLIC API
    // ------------------------------------------------
    return {
        parse: parse
    };

})();

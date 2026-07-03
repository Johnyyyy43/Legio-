"use strict";

// ================================================
// LEGIO — js/code-block-parser.js
// Code Block Parser v1.0 (FALLBACK PATH)
//
// Responsibilities:
//   - Scan raw AI reply text for fenced ``` code blocks.
//   - Strip them out of the displayed prose.
//   - Generate a smart filename per block from its
//     detected language and first meaningful line.
//   - Return a list of file operations for the caller
//     to hand to FileController — this module does NOT
//     touch FileController itself, it only decides what
//     SHOULD happen.
//
// Depends on: nothing (pure text-in, data-out module)
// Called by:  ui.js, as the FALLBACK when
//             ActionParser finds no valid JSON actions
//             in the AI's reply.
//
// WHY THIS IS A FALLBACK, NOT THE PRIMARY PATH:
//   Not every model reliably returns structured JSON when
//   asked to. Groq's Llama models in particular sometimes
//   ignore formatting instructions and just reply with
//   prose + code fences like a normal chat model. Rather
//   than have the app break when that happens, ActionParser
//   tries JSON first, and if that fails, hands the raw text
//   to this parser so code still gets extracted and saved —
//   just without the richer "edit this specific file" intent
//   that structured actions provide.
// ================================================

const CodeBlockParser = (function () {

    const FENCE_REGEX = /^```([a-zA-Z0-9_+-]*)\s*$/;

    const LANG_TO_EXT = {
        'javascript': 'js', 'js': 'js', 'python': 'py', 'py': 'py',
        'html': 'html', 'css': 'css', 'json': 'json', 'xml': 'xml',
        'sql': 'sql', 'bash': 'sh', 'sh': 'sh', 'java': 'java',
        'cpp': 'cpp', 'c': 'c', 'csharp': 'cs', 'cs': 'cs',
        'ruby': 'rb', 'php': 'php', 'go': 'go', 'rust': 'rs',
        'kotlin': 'kt', 'swift': 'swift', 'typescript': 'ts', 'ts': 'ts',
        'jsx': 'jsx', 'tsx': 'tsx', 'vue': 'vue', 'markdown': 'md', 'md': 'md'
    };

    const DEFAULT_NAMES = {
        'html': 'page', 'js': 'script', 'py': 'script', 'css': 'styles',
        'json': 'data', 'sql': 'query', 'jsx': 'component', 'tsx': 'component'
    };

    // ------------------------------------------------
    // 1. SMART FILENAME GENERATION
    //    Picks the first meaningful line (skipping blank
    //    lines, comments, and doctype declarations, which
    //    is what caused the "doctypehtml.html" bug before)
    //    to hint at a name, and falls back to a sensible
    //    default per language if nothing usable is found.
    // ------------------------------------------------
    function _generateSmartName(code, lang, usedNames) {
        const ext = LANG_TO_EXT[lang] || (lang || 'txt');
        const lines = code.split('\n');
        let hint = '';

        // Lines to explicitly skip when hunting for a naming hint —
        // these are structural/boilerplate, not descriptive.
        const SKIP_PATTERNS = [
            /^<!doctype/i,
            /^<html/i,
            /^<head/i,
            /^<body/i,
            /^\s*$/,
            /^\/\//,
            /^#/,
            /^\*/,
            /^<!--/
        ];

        for (let i = 0; i < Math.min(8, lines.length); i++) {
            const line = lines[i].trim();
            if (!line) continue;
            if (SKIP_PATTERNS.some(function (p) { return p.test(line); })) continue;

            // Try to pull an identifier-like token: a function/class
            // name, a <title> tag's content, etc. Falls back to a
            // sanitised slice of the line itself.
            const titleMatch = line.match(/<title>(.*?)<\/title>/i);
            const classMatch = line.match(/class\s+(\w+)/);
            const funcMatch  = line.match(/function\s+(\w+)/);
            const defMatch   = line.match(/def\s+(\w+)/);

            const candidate = (titleMatch && titleMatch[1]) ||
                               (classMatch && classMatch[1]) ||
                               (funcMatch  && funcMatch[1])  ||
                               (defMatch   && defMatch[1])   ||
                               line;

            hint = candidate.substring(0, 30)
                .replace(/[^a-z0-9_\-\s]/gi, '')
                .trim()
                .replace(/\s+/g, '_')
                .toLowerCase();

            if (hint.length > 2) break;
        }

        const baseName = hint || DEFAULT_NAMES[ext] || 'code';
        let fileName = baseName + '.' + ext;

        // Avoid collisions within the SAME response (e.g. two HTML
        // blocks in one reply would otherwise both become "page.html")
        if (usedNames && usedNames.has(fileName)) {
            let counter = 2;
            let candidate = baseName + '_' + counter + '.' + ext;
            while (usedNames.has(candidate)) {
                counter += 1;
                candidate = baseName + '_' + counter + '.' + ext;
            }
            fileName = candidate;
        }

        if (usedNames) usedNames.add(fileName);
        return fileName;
    }

    // ------------------------------------------------
    // 2. MAIN PARSE FUNCTION
    //    Input:  raw AI reply text
    //    Output: {
    //              proseText: string (code stripped out),
    //              fileOps: [ { type: 'create', name, content } ]
    //            }
    //
    //    Every block found becomes a 'create' operation —
    //    this parser has no way to know if a block is meant
    //    to EDIT an existing file (that intent only exists
    //    in structured JSON actions, handled by ActionParser).
    // ------------------------------------------------
    function parse(fullText) {
        let isCodeBlock = false;
        let codeBuffer = [];
        let detectedLang = null;
        const proseLines = [];
        const fileOps = [];
        const usedNames = new Set();

        function flushBlock() {
            const completeCode = codeBuffer.join('\n');
            codeBuffer = [];

            if (completeCode.trim() === '') {
                detectedLang = null;
                return;
            }

            const fileName = _generateSmartName(completeCode, detectedLang, usedNames);

            fileOps.push({
                type:    'create',
                name:    fileName,
                content: completeCode,
                language: detectedLang || 'text'
            });

            detectedLang = null;
        }

        const lines = fullText.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const fenceMatch = line.match(FENCE_REGEX);

            if (fenceMatch) {
                if (!isCodeBlock) {
                    isCodeBlock = true;
                    codeBuffer = [];
                    detectedLang = fenceMatch[1] || null;
                } else {
                    isCodeBlock = false;
                    flushBlock();
                }
                continue; // fence lines are never part of prose
            }

            if (isCodeBlock) {
                codeBuffer.push(line);
            } else {
                proseLines.push(line);
            }
        }

        // Handle text ending mid-block (truncated/malformed reply)
        if (isCodeBlock && codeBuffer.length > 0) {
            console.warn('[CodeBlockParser] Reply ended inside an open code block. Flushing partial content.');
            flushBlock();
        }

        return {
            proseText: proseLines.join('\n').trim(),
            fileOps:   fileOps
        };
    }

    // ------------------------------------------------
    // 3. PUBLIC API
    // ------------------------------------------------
    return {
        parse: parse
    };

})();

"use strict";

// ================================================
// LEGIO — js/stream-interceptor.js
// Code Block Interceptor v1.0
//
// Responsibilities:
//   - Process AI response text incrementally (or as one
//     full string) and separate prose from fenced code
//     blocks as it goes.
//   - Prose lines are returned for normal chat rendering.
//   - Code block lines are buffered, and on the closing
//     fence, written directly to the active VFS file via
//     StateManager.setFileContent().
//   - After a successful write, calls back into app.js to
//     refresh the Studio editor view if it's currently open.
//
// Depends on: StateManager (state.js)
// Called by:  UIController.handleSend() (ui.js), once per
//             AI reply, before the reply is rendered.
//
// USAGE:
//   const interceptor = StreamInterceptor.create({
//       activeFileId: StateManager.getActiveFile(),
//       onCodeSaved: function (fileId, code) { ... }
//   });
//
//   const { proseText, codeBlocksWritten } =
//       interceptor.processFullText(aiReplyText);
//
//   // proseText is what you pass to renderMessage()
// ================================================

const StreamInterceptor = (function () {

    // ------------------------------------------------
    // 1. FACTORY
    //    Creates a fresh state machine instance per
    //    AI response. Do NOT share one instance across
    //    multiple messages — state must reset each time.
    // ------------------------------------------------
    function create(options) {
        options = options || {};

        // Which VFS file code blocks get written to.
        // Falls back to the currently active file in state
        // if not explicitly provided.
        const activeFileId = options.activeFileId || StateManager.getActiveFile();

        // Optional callback fired after each successful write,
        // so app.js can refresh the Studio editor view if open.
        const onCodeSaved = typeof options.onCodeSaved === 'function'
            ? options.onCodeSaved
            : function () {};

        // ------------------------------------------------
        // 2. STATE MACHINE FLAGS
        // ------------------------------------------------
        let isCodeBlock   = false;   // True while inside ``` ... ```
        let codeBuffer    = [];      // Lines collected inside the current block
        let codeBlocksWritten = 0;   // Count of blocks successfully saved to VFS
        let detectedLang  = null;    // Optional language tag from the opening fence

        // The fence regex matches ``` optionally followed by a
        // language tag (e.g. ```javascript, ```html, or just ```)
        const FENCE_REGEX = /^```([a-zA-Z0-9_+-]*)\s*$/;

        // ------------------------------------------------
        // 3. LINE PROCESSOR
        //    Call once per line of incoming text. Returns
        //    the line to render in chat, or null if the
        //    line was diverted into the code buffer.
        // ------------------------------------------------
        function processLine(line) {
            const fenceMatch = line.match(FENCE_REGEX);

            // ---- Case A: We hit a fence line ----
            if (fenceMatch) {
                if (!isCodeBlock) {
                    // Opening fence — enter code-block mode.
                    isCodeBlock  = true;
                    codeBuffer   = [];
                    detectedLang = fenceMatch[1] || null;
                    // The fence line itself is NOT rendered in chat —
                    // it's consumed by the state machine.
                    return null;
                } else {
                    // Closing fence — flush the buffer to the VFS.
                    isCodeBlock = false;
                    _flushBufferToFile();
                    // The closing fence line is also consumed,
                    // not rendered in chat.
                    return null;
                }
            }

            // ---- Case B: We are inside a code block ----
            if (isCodeBlock) {
                codeBuffer.push(line);
                // Diverted — do not render this line in chat.
                return null;
            }

            // ---- Case C: Normal prose line ----
            // Passed straight through for chat rendering.
            return line;
        }

        // ------------------------------------------------
        // 4. FLUSH BUFFER → VFS WRITE
        //    Called automatically on closing fence.
        //    Auto-creates files if needed.
        // ------------------------------------------------
        function _flushBufferToFile() {
            const completeCode = codeBuffer.join('\n');
            codeBuffer = [];

            // Guard: don't write empty blocks (e.g. ``` ``` with nothing between)
            if (completeCode.trim() === '') {
                return;
            }

            // If no active file, auto-create one based on language tag
            let targetFileId = activeFileId;
            if (!targetFileId) {
                const ext = detectedLang || 'txt';
                const timestamp = Date.now();
                targetFileId = 'code_' + timestamp;
                const fileName = 'code_' + timestamp + '.' + ext;

                try {
                    StateManager.createFile(targetFileId, fileName);
                    console.log('[StreamInterceptor] Auto-created file:', fileName);
                } catch (createErr) {
                    console.error('[StreamInterceptor] Failed to auto-create file:', createErr.message);
                    return;
                }
            }

            try {
                StateManager.setFileContent(targetFileId, completeCode);
                codeBlocksWritten += 1;

                console.log(
                    '[StreamInterceptor] Code block written to file:',
                    targetFileId,
                    '(' + completeCode.split('\n').length + ' lines, lang: ' +
                    (detectedLang || 'none') + ')'
                );

                // Let the caller (app.js) refresh the Studio view
                // if it's currently showing this file.
                onCodeSaved(targetFileId, completeCode);

            } catch (err) {
                console.error(
                    '[StreamInterceptor] Failed to write code block to VFS:',
                    err.message
                );
            }

            detectedLang = null;
        }

        // ------------------------------------------------
        // 5. FULL-TEXT CONVENIENCE METHOD
        //    Use this when you have the complete AI response
        //    as one string (current non-streaming api.js flow).
        //    Splits into lines, runs each through processLine,
        //    and rejoins the surviving prose lines.
        // ------------------------------------------------
        function processFullText(fullText) {
            if (typeof fullText !== 'string') {
                throw new Error('[StreamInterceptor] processFullText: fullText must be a string.');
            }

            const lines = fullText.split('\n');
            const proseLines = [];

            for (let i = 0; i < lines.length; i++) {
                const result = processLine(lines[i]);
                if (result !== null) {
                    proseLines.push(result);
                }
            }

            // Safety: if the text ended mid-code-block (malformed
            // or truncated response), flush whatever was buffered
            // so the partial code isn't silently lost.
            if (isCodeBlock && codeBuffer.length > 0) {
                console.warn('[StreamInterceptor] Response ended inside an open code block. Flushing partial content.');
                isCodeBlock = false;
                _flushBufferToFile();
            }

            return {
                proseText:         proseLines.join('\n').trim(),
                codeBlocksWritten: codeBlocksWritten
            };
        }

        // ------------------------------------------------
        // 6. STREAMING CHUNK METHOD
        //    Use this if api.js is later upgraded to a real
        //    fetch() stream (ReadableStream / SSE). Feed it
        //    raw text chunks as they arrive; it handles
        //    partial lines across chunk boundaries internally.
        // ------------------------------------------------
        let _partialLine = ''; // Holds an incomplete line across chunk calls

        function processChunk(chunkText) {
            const combined = _partialLine + chunkText;
            const lines = combined.split('\n');

            // The last entry may be an incomplete line — hold it
            // back until the next chunk arrives.
            _partialLine = lines.pop();

            const proseLines = [];
            for (let i = 0; i < lines.length; i++) {
                const result = processLine(lines[i]);
                if (result !== null) proseLines.push(result);
            }

            return proseLines.join('\n');
        }

        // Call once the stream has fully ended to flush any
        // trailing partial line and close an unterminated block.
        function finalizeStream() {
            let finalProse = '';

            if (_partialLine !== '') {
                const result = processLine(_partialLine);
                if (result !== null) finalProse = result;
                _partialLine = '';
            }

            if (isCodeBlock && codeBuffer.length > 0) {
                console.warn('[StreamInterceptor] Stream ended inside an open code block. Flushing partial content.');
                isCodeBlock = false;
                _flushBufferToFile();
            }

            return {
                proseText:         finalProse,
                codeBlocksWritten: codeBlocksWritten
            };
        }

        // ------------------------------------------------
        // 7. INSTANCE PUBLIC API
        // ------------------------------------------------
        return {
            processFullText: processFullText,  // For current non-streaming api.js
            processChunk:    processChunk,     // For future real streaming
            finalizeStream:  finalizeStream     // Call after the last chunk
        };
    }

    // ------------------------------------------------
    // 8. MODULE PUBLIC API
    // ------------------------------------------------
    return {
        create: create
    };

})();

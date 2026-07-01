"use strict";

// ================================================
// LEGIO — js/ui.js
// UI Controller v3.0
//
// Responsibilities:
//   - Render user and AI messages to the chat
//   - Parse @model tags from user input
//   - Handle send action and input auto-resize
//   - Show / hide typing indicator
//   - Expose a clean public API for app.js
//
// Depends on: StateManager (state.js)
// Called by:  app.js
// ================================================

const UIController = (function () {

    // ------------------------------------------------
    // 1. DOM CACHE
    //    Every ID here must exist exactly once in
    //    index.html — verified against the markup.
    // ------------------------------------------------
    const DOM = {
        messageContainer: document.getElementById('message-container'),
        chatViewport:     document.getElementById('chat-viewport'),
        userInput:        document.getElementById('user-input'),
        sendBtn:          document.getElementById('send-btn'),
        tagBtn:           document.getElementById('tag-model-btn')
    };

    // Validate all elements exist before proceeding.
    // If any are null the app would crash silently later —
    // this surfaces the problem immediately with a clear message.
    (function validateDOM() {
        for (const key in DOM) {
            if (!DOM[key]) {
                throw new Error('[UIController] DOM element not found: #' + key +
                    '. Check index.html for a missing or duplicate ID.');
            }
        }
    })();

    // ------------------------------------------------
    // 2. INTERNAL STATE
    // ------------------------------------------------

    // The model that will receive the next message.
    // Defaults to 'gemini', updated by @tag parsing.
    let _activeModel = 'gemini';

    // Reference to the typing indicator wrapper so we
    // can remove it precisely without querying the DOM.
    let _typingIndicatorEl = null;

    // ------------------------------------------------
    // 3. @TAG PARSER
    //    Reads @modelname at the very start of the
    //    message, updates the active model, strips the
    //    tag from the text before it reaches the API.
    // ------------------------------------------------
    function _parseTag(rawText) {
        // Match @word at the start, followed by optional whitespace
        const TAG_REGEX = /^@(\w+)\s*/;
        const match = rawText.match(TAG_REGEX);

        if (match) {
            // Lowercase for consistent API routing
            _activeModel = match[1].toLowerCase();

            // Update the "To:" button label in the dock
            const display = _activeModel.charAt(0).toUpperCase() + _activeModel.slice(1);
            DOM.tagBtn.textContent = display;

            // Return the text with the tag stripped
            return rawText.replace(TAG_REGEX, '').trim();
        }

        // No tag found — return text unchanged
        return rawText;
    }

    // ------------------------------------------------
    // 4. MESSAGE RENDERING
    // ------------------------------------------------

    // Render a single message object to the chat.
    // msg shape: { role: 'user'|'model', content: '', model: '', codeBlocks: [] }
    function renderMessage(msg) {
        if (!msg || msg.content === undefined) {
            console.warn('[UIController] renderMessage: invalid message object', msg);
            return;
        }

        const wrapper = document.createElement('div');

        if (msg.role === 'user') {
            wrapper.className = 'message-wrapper-user';
            wrapper.innerHTML =
                '<div class="user-bubble">' +
                    _escapeHTML(msg.content) +
                '</div>';

        } else {
            // AI message — borderless, uppercase model tag + prose + code block containers
            const modelLabel = msg.model
                ? msg.model.toUpperCase()
                : 'AI';

            wrapper.className = 'message-wrapper-model';
            
            // Build HTML: model tag + prose
            let html = '<span class="model-tag">' + _escapeHTML(modelLabel) + '</span>';
            
            if (msg.content) {
                html += '<div class="model-text">'  + _formatModelText(msg.content) + '</div>';
            }
            
            // Append code block containers if any
            if (msg.codeBlocks && msg.codeBlocks.length > 0) {
                msg.codeBlocks.forEach(function(block) {
                    html += '<div class="code-block-container" data-file-id="' + _escapeHTML(block.fileId) + '">' +
                            '<div class="code-block-header">' +
                            '<span class="code-block-icon">📄</span>' +
                            '<span class="code-block-name">' + _escapeHTML(block.fileName) + '</span>' +
                            '<span class="code-block-meta">(' + block.lineCount + ' lines)</span>' +
                            '</div>' +
                            '<div class="code-block-action">View in Studio →</div>' +
                            '</div>';
                });
            }
            
            wrapper.innerHTML = html;
            
            // Attach click handlers to code block containers
            if (msg.codeBlocks && msg.codeBlocks.length > 0) {
                const containers = wrapper.querySelectorAll('.code-block-container');
                containers.forEach(function(container) {
                    container.addEventListener('click', function() {
                        const fileId = container.getAttribute('data-file-id');
                        console.log('[UIController] User clicked code block:', fileId);
                        if (typeof window._openFileInStudio === 'function') {
                            window._openFileInStudio(fileId);
                        } else {
                            console.warn('[UIController] _openFileInStudio not available');
                        }
                    });
                });
            }
        }

        DOM.messageContainer.appendChild(wrapper);
        _scrollToBottom();
    }

    // Render the full saved context on page load.
    // Clears the container first to avoid duplicates.
    function renderHistory() {
        DOM.messageContainer.innerHTML = '';
        const history = StateManager.getContext();

        if (history.length === 0) return;

        history.forEach(function (msg) {
            renderMessage(msg);
        });
    }

    // ------------------------------------------------
    // 5.5 CODE BLOCK INTERCEPTOR (inlined)
    //      Diverts fenced code blocks from chat to VFS
    //      Each code block gets its own unique file
    // ------------------------------------------------
    function _interceptCodeBlocks(fullText) {
        console.log('[UIController] _interceptCodeBlocks called with text length:', fullText.length);
        
        let isCodeBlock = false;
        let codeBuffer = [];
        let detectedLang = null;
        let codeBlocksWritten = 0;
        let codeBlocksMetadata = []; // Track each created file
        const FENCE_REGEX = /^```([a-zA-Z0-9_+-]*)\s*$/;
        
        // Map language to file extension
        const langToExt = {
            'javascript': 'js',
            'js': 'js',
            'python': 'py',
            'py': 'py',
            'html': 'html',
            'css': 'css',
            'json': 'json',
            'xml': 'xml',
            'sql': 'sql',
            'bash': 'sh',
            'sh': 'sh',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'csharp': 'cs',
            'cs': 'cs',
            'ruby': 'rb',
            'php': 'php',
            'go': 'go',
            'rust': 'rs',
            'kotlin': 'kt',
            'swift': 'swift',
            'typescript': 'ts',
            'ts': 'ts',
            'jsx': 'jsx',
            'tsx': 'tsx',
            'vue': 'vue',
            'markdown': 'md',
            'md': 'md'
        };

        function processLine(line) {
            const fenceMatch = line.match(FENCE_REGEX);

            if (fenceMatch) {
                if (!isCodeBlock) {
                    // OPENING fence
                    console.log('[UIController] OPENING code block, lang:', fenceMatch[1] || 'none');
                    isCodeBlock = true;
                    codeBuffer = [];
                    detectedLang = fenceMatch[1] || null;
                    return null;
                } else {
                    // CLOSING fence — create a unique file for THIS block
                    console.log('[UIController] CLOSING code block, lines buffered:', codeBuffer.length);
                    isCodeBlock = false;
                    const completeCode = codeBuffer.join('\n');
                    codeBuffer = [];

                    if (completeCode.trim() !== '') {
                        // Generate unique file ID and name for THIS specific code block
                        const ext = langToExt[detectedLang] || (detectedLang || 'txt');
                        const timestamp = Date.now();
                        const blockId = Math.random().toString(36).substring(7); // Short random suffix to ensure uniqueness
                        const targetFileId = 'code_' + timestamp + '_' + blockId;
                        const fileName = 'code_' + timestamp + '_' + blockId + '.' + ext;

                        try {
                            StateManager.createFile(targetFileId, fileName);
                            console.log('[UIController] Auto-created file:', fileName);
                            
                            StateManager.setFileContent(targetFileId, completeCode);
                            codeBlocksWritten += 1;
                            
                            // Track metadata for rendering in chat
                            codeBlocksMetadata.push({
                                fileId: targetFileId,
                                fileName: fileName,
                                language: detectedLang || 'text',
                                lineCount: completeCode.split('\n').length,
                                size: completeCode.length
                            });
                            
                            console.log('[UIController] Code block saved! File:', targetFileId, 'Lines:', completeCode.split('\n').length);

                            if (typeof window.refreshStudioEditor === 'function') {
                                window.refreshStudioEditor(targetFileId);
                            }
                        } catch (err) {
                            console.error('[UIController] Failed to create/save code file:', err.message);
                        }
                    }

                    detectedLang = null;
                    return null;
                }
            }

            if (isCodeBlock) {
                console.log('[UIController] Buffering code line');
                codeBuffer.push(line);
                return null;
            }

            return line;
        }

        const lines = fullText.split('\n');
        const proseLines = [];

        for (let i = 0; i < lines.length; i++) {
            const result = processLine(lines[i]);
            if (result !== null) {
                proseLines.push(result);
            }
        }

        // Handle edge case: response ended mid-code-block
        if (isCodeBlock && codeBuffer.length > 0) {
            console.warn('[UIController] Response ended inside code block, flushing partial content');
            isCodeBlock = false;
            const completeCode = codeBuffer.join('\n');
            if (completeCode.trim() !== '') {
                const ext = langToExt[detectedLang] || (detectedLang || 'txt');
                const timestamp = Date.now();
                const blockId = Math.random().toString(36).substring(7);
                const targetFileId = 'code_' + timestamp + '_' + blockId;
                const fileName = 'code_' + timestamp + '_' + blockId + '.' + ext;
                
                try {
                    StateManager.createFile(targetFileId, fileName);
                    StateManager.setFileContent(targetFileId, completeCode);
                    codeBlocksWritten += 1;
                    codeBlocksMetadata.push({
                        fileId: targetFileId,
                        fileName: fileName,
                        language: detectedLang || 'text',
                        lineCount: completeCode.split('\n').length,
                        size: completeCode.length
                    });
                } catch (err) {
                    console.error('[UIController] Failed to create/save partial code:', err.message);
                }
            }
        }

        console.log('[UIController] Interception complete. Prose lines:', proseLines.length, 'Code blocks created:', codeBlocksWritten);
        return {
            proseText: proseLines.join('\n').trim(),
            codeBlocksWritten: codeBlocksWritten,
            codeBlocks: codeBlocksMetadata // NEW: pass file metadata to renderMessage
        };
    }
    //    Shows three animated dots while waiting for
    //    an API response. Removed before rendering reply.
    // ------------------------------------------------
    function showTypingIndicator(modelName) {
        // Remove any existing indicator first
        hideTypingIndicator();

        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper-model';

        const label = modelName
            ? modelName.toUpperCase()
            : 'AI';

        wrapper.innerHTML =
            '<span class="model-tag">' + _escapeHTML(label) + '</span>' +
            '<div class="typing-indicator">' +
                '<span class="typing-dot"></span>' +
                '<span class="typing-dot"></span>' +
                '<span class="typing-dot"></span>' +
            '</div>';

        _typingIndicatorEl = wrapper;
        DOM.messageContainer.appendChild(wrapper);
        _scrollToBottom();
    }

    function hideTypingIndicator() {
        if (_typingIndicatorEl && _typingIndicatorEl.parentNode) {
            _typingIndicatorEl.parentNode.removeChild(_typingIndicatorEl);
        }
        _typingIndicatorEl = null;
    }

    // ------------------------------------------------
    // 6. SEND HANDLER
    //    Orchestrates: parse → validate → save →
    //    render → call API → render reply.
    //
    //    Depends on APIController (api.js) which is
    //    loaded after this file.
    // ------------------------------------------------
    async function handleSend() {
        const rawText = DOM.userInput.value.trim();
        if (rawText === '') return;

        // Parse @tag — may update _activeModel as side effect
        const cleanText = _parseTag(rawText);

        // If the user typed only a @tag with no body, clear and exit
        if (cleanText === '') {
            DOM.userInput.value = '';
            return;
        }

        // Lock UI while request is in flight
        _setUILocked(true);

        // Save and render user message
        const userMsg = StateManager.addUser(cleanText);
        renderMessage(userMsg);

        // Clear and reset the input
        DOM.userInput.value = '';
        DOM.userInput.style.height = 'auto';

        // Show typing indicator using current active model
        showTypingIndicator(_activeModel);

        try {
            // APIController.send() receives the target model name.
            // It reads the full context from StateManager itself.
            const replyText = await APIController.send(_activeModel);

            hideTypingIndicator();

            // Run the reply through the inlined code-block interceptor.
            // Fenced code blocks are diverted into the VFS; prose goes to chat.
            const { proseText, codeBlocksWritten, codeBlocks } = _interceptCodeBlocks(replyText);

            // Save the message with ONLY the prose (no code blocks in the text)
            const modelMsg = StateManager.addModel(proseText, _activeModel);
            
            // Attach code block metadata to the message so renderMessage can display them as containers
            modelMsg.codeBlocks = codeBlocks || [];
            
            renderMessage(modelMsg);

        } catch (err) {
            hideTypingIndicator();

            console.error('[UIController] API error:', err);

            // Render the error as a system message so the user
            // sees it in context rather than a silent failure.
            renderMessage({
                role:    'model',
                content: 'Error: ' + (err.message || 'Something went wrong. Check the console.'),
                model:   'system'
            });
        } finally {
            // Always unlock the UI, even if the API threw
            _setUILocked(false);
            DOM.userInput.focus();
        }
    }

    // ------------------------------------------------
    // 7. INPUT UTILITIES
    // ------------------------------------------------

    // Lock / unlock the input and send button during API calls.
    function _setUILocked(locked) {
        DOM.userInput.disabled = locked;
        DOM.sendBtn.disabled   = locked;
        DOM.sendBtn.style.opacity = locked ? '0.4' : '1';
    }

    // Auto-grow the textarea as the user types.
    // Caps at 120px (set via CSS max-height).
    function _autoResize() {
        DOM.userInput.style.height = 'auto';
        DOM.userInput.style.height = DOM.userInput.scrollHeight + 'px';
    }

    // Scroll the chat viewport to the latest message.
    function _scrollToBottom() {
        requestAnimationFrame(function () {
            DOM.chatViewport.scrollTop = DOM.chatViewport.scrollHeight;
        });
    }

    // ------------------------------------------------
    // 8. TEXT UTILITIES
    // ------------------------------------------------

    // Prevent XSS by escaping user-supplied content
    // before inserting into innerHTML.
    function _escapeHTML(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(String(str)));
        return div.innerHTML;
    }

    // Light formatting for AI responses.
    // Converts ```code blocks``` to <pre><code> and
    // escapes everything else.
    function _formatModelText(text) {
        // Split on fenced code blocks
        const parts = String(text).split(/(```[\s\S]*?```)/g);

        return parts.map(function (part) {
            if (part.startsWith('```') && part.endsWith('```')) {
                // Extract optional language tag and code body
                const inner = part.slice(3, -3);
                const newlineIdx = inner.indexOf('\n');
                const code = newlineIdx !== -1
                    ? inner.slice(newlineIdx + 1)
                    : inner;

                return '<pre class="model-code-block"><code>' +
                    _escapeHTML(code.trimEnd()) +
                '</code></pre>';
            }

            // Plain text — escape HTML, preserve newlines
            return _escapeHTML(part).replace(/\n/g, '<br>');
        }).join('');
    }

    // ------------------------------------------------
    // 9. ACTIVE MODEL ACCESSOR
    //    app.js reads this when building the Studio
    //    highlight-to-chat workflow.
    // ------------------------------------------------
    function getActiveModel() {
        return _activeModel;
    }

    function setActiveModel(modelName) {
        if (!modelName || typeof modelName !== 'string') return;
        _activeModel = modelName.toLowerCase();
        const display = _activeModel.charAt(0).toUpperCase() + _activeModel.slice(1);
        DOM.tagBtn.textContent = display;
    }

    // ------------------------------------------------
    // 10. EVENT LISTENERS
    // ------------------------------------------------
    function _initEvents() {
        // Send on button click
        DOM.sendBtn.addEventListener('click', handleSend);

        // Send on Enter (Shift+Enter = newline)
        DOM.userInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });

        // Auto-resize textarea on input
        DOM.userInput.addEventListener('input', _autoResize);
    }

    // ------------------------------------------------
    // 11. INITIALISATION
    // ------------------------------------------------
    function init() {
        _initEvents();
        renderHistory(); // Restore any saved chat on page load
        console.log('[UIController] Initialised.');
    }

    // ------------------------------------------------
    // 12. PUBLIC API
    //     Names here are the contract for app.js.
    //     Do NOT rename without updating all callers.
    // ------------------------------------------------
    return {
        init:               init,
        renderMessage:      renderMessage,
        renderHistory:      renderHistory,
        showTyping:         showTypingIndicator,
        hideTyping:         hideTypingIndicator,
        getActiveModel:     getActiveModel,
        setActiveModel:     setActiveModel
    };

})();

"use strict";

// ================================================
// LEGIO — js/ui.js
// UI Controller v4.0
//
// Responsibilities:
//   - Render user and AI messages to the chat
//   - Parse @model tags from user input
//   - Handle send action and input auto-resize
//   - Show / hide typing indicator
//   - Intercept code blocks and auto-save to VFS
//   - Expose a clean public API for app.js
//
// Depends on: StateManager (state.js)
// Called by:  app.js
// ================================================

const UIController = (function () {

    // ------------------------------------------------
    // 1. DOM CACHE
    // ------------------------------------------------
    const DOM = {
        messageContainer: document.getElementById('message-container'),
        chatViewport:     document.getElementById('chat-viewport'),
        userInput:        document.getElementById('user-input'),
        sendBtn:          document.getElementById('send-btn'),
        tagBtn:           document.getElementById('tag-model-btn')
    };

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
    let _activeModel = 'groq';
    let _typingIndicatorEl = null;

    // ------------------------------------------------
    // 3. @TAG PARSER
    // ------------------------------------------------
    function _parseTag(rawText) {
        const TAG_REGEX = /^@(\w+)\s*/;
        const match = rawText.match(TAG_REGEX);

        if (match) {
            _activeModel = match[1].toLowerCase();
            const display = _activeModel.charAt(0).toUpperCase() + _activeModel.slice(1);
            DOM.tagBtn.textContent = display;
            return rawText.replace(TAG_REGEX, '').trim();
        }

        return rawText;
    }

    // ------------------------------------------------
    // 4. MESSAGE RENDERING
    // ------------------------------------------------
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
            const modelLabel = msg.model
                ? msg.model.toUpperCase()
                : 'AI';

            wrapper.className = 'message-wrapper-model';
            
            let html = '<span class="model-tag">' + _escapeHTML(modelLabel) + '</span>';
            
            if (msg.content) {
                html += '<div class="model-text">'  + _formatModelText(msg.content) + '</div>';
            }
            
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
            
            if (msg.codeBlocks && msg.codeBlocks.length > 0) {
                const containers = wrapper.querySelectorAll('.code-block-container');
                containers.forEach(function(container) {
                    container.addEventListener('click', function() {
                        const fileId = container.getAttribute('data-file-id');
                        console.log('[UIController] User clicked code block:', fileId);
                        if (typeof window.openStudioWithFile === 'function') {
                            window.openStudioWithFile(fileId);
                        } else {
                            console.warn('[UIController] openStudioWithFile not available yet.');
                        }
                    });
                });
            }
        }

        DOM.messageContainer.appendChild(wrapper);
        _scrollToBottom();
    }

    function renderHistory() {
        DOM.messageContainer.innerHTML = '';
        const history = StateManager.getContext();

        if (history.length === 0) return;

        history.forEach(function (msg) {
            renderMessage(msg);
        });
    }

    // ------------------------------------------------
    // 5. TYPING INDICATOR
    // ------------------------------------------------
    function showTypingIndicator(modelName) {
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
    // 5.5 REPLY RESOLVER
    //     Tries ActionParser (structured JSON) first,
    //     falls back to CodeBlockParser (fence scraping)
    //     if the model didn't return valid JSON actions.
    //     Either way, actually WRITES the files via
    //     FileController — this is the only place in
    //     ui.js that touches the file system, and it does
    //     so exclusively through FileController, never
    //     StateManager directly.
    // ------------------------------------------------
    function _resolveReply(fullText) {
        let result = ActionParser.parse(fullText);
        let usedFallback = false;

        if (!result) {
            result = CodeBlockParser.parse(fullText);
            usedFallback = true;
        }

        console.log('[UIController] Reply resolved via', usedFallback ? 'CodeBlockParser (fallback)' : 'ActionParser (structured)');

        const codeBlocks = [];

        result.fileOps.forEach(function (op) {
            try {
                if (op.type === 'create') {
                    const created = FileController.create(op.name, op.content);
                    codeBlocks.push({
                        fileId:    created.id,
                        fileName:  created.name,
                        lineCount: op.content.split('\n').length
                    });

                } else if (op.type === 'update') {
                    // The AI referred to a file by NAME, not by internal
                    // ID — resolve it here. If it doesn't exist yet
                    // (model said "update" but meant "create"), create
                    // it instead of throwing, so the response doesn't
                    // just fail silently.
                    let target = FileController.findByName(op.name);
                    if (!target) {
                        console.warn('[UIController] update_file target not found, creating instead:', op.name);
                        target = FileController.create(op.name, op.content);
                    } else {
                        FileController.update(target.id, op.content);
                    }
                    codeBlocks.push({
                        fileId:    target.id,
                        fileName:  target.name,
                        lineCount: op.content.split('\n').length
                    });

                } else if (op.type === 'delete') {
                    const target = FileController.findByName(op.name);
                    if (target) {
                        FileController.remove(target.id);
                    } else {
                        console.warn('[UIController] delete_file target not found:', op.name);
                    }

                } else if (op.type === 'rename') {
                    const target = FileController.findByName(op.name);
                    if (target) {
                        const renamed = FileController.rename(target.id, op.newName);
                        codeBlocks.push({
                            fileId:    renamed.id,
                            fileName:  renamed.name,
                            lineCount: FileController.read(renamed.id).split('\n').length
                        });
                    } else {
                        console.warn('[UIController] rename_file target not found:', op.name);
                    }
                }
            } catch (err) {
                console.error('[UIController] Failed to apply file operation:', op, err.message);
            }
        });

        return {
            proseText:  result.proseText,
            codeBlocks: codeBlocks
        };
    }

    // ------------------------------------------------
    // 6. SEND HANDLER
    // ------------------------------------------------
    async function handleSend() {
        const rawText = DOM.userInput.value.trim();
        if (rawText === '') return;

        const cleanText = _parseTag(rawText);

        if (cleanText === '') {
            DOM.userInput.value = '';
            return;
        }

        _setUILocked(true);

        const userMsg = StateManager.addUser(cleanText);
        renderMessage(userMsg);

        DOM.userInput.value = '';
        DOM.userInput.style.height = 'auto';

        showTypingIndicator(_activeModel);

        try {
            const replyText = await APIController.send(_activeModel);

            hideTypingIndicator();

            const { proseText, codeBlocks } = _resolveReply(replyText);

            const modelMsg = StateManager.addModel(proseText, _activeModel);
            modelMsg.codeBlocks = codeBlocks || [];
            
            renderMessage(modelMsg);

        } catch (err) {
            hideTypingIndicator();

            console.error('[UIController] API error:', err);

            renderMessage({
                role:    'model',
                content: 'Error: ' + (err.message || 'Something went wrong. Check the console.'),
                model:   'system'
            });
        } finally {
            _setUILocked(false);
            DOM.userInput.focus();
        }
    }

    // ------------------------------------------------
    // 7. INPUT UTILITIES
    // ------------------------------------------------
    function _setUILocked(locked) {
        DOM.userInput.disabled = locked;
        DOM.sendBtn.disabled   = locked;
        DOM.sendBtn.style.opacity = locked ? '0.4' : '1';
    }

    function _autoResize() {
        DOM.userInput.style.height = 'auto';
        DOM.userInput.style.height = DOM.userInput.scrollHeight + 'px';
    }

    function _scrollToBottom() {
        requestAnimationFrame(function () {
            DOM.chatViewport.scrollTop = DOM.chatViewport.scrollHeight;
        });
    }

    // ------------------------------------------------
    // 8. TEXT UTILITIES
    // ------------------------------------------------
    function _escapeHTML(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(String(str)));
        return div.innerHTML;
    }

    function _formatModelText(text) {
        const parts = String(text).split(/(```[\s\S]*?```)/g);

        return parts.map(function (part) {
            if (part.startsWith('```') && part.endsWith('```')) {
                const inner = part.slice(3, -3);
                const newlineIdx = inner.indexOf('\n');
                const code = newlineIdx !== -1
                    ? inner.slice(newlineIdx + 1)
                    : inner;

                return '<pre class="model-code-block"><code>' +
                    _escapeHTML(code.trimEnd()) +
                '</code></pre>';
            }

            return _escapeHTML(part).replace(/\n/g, '<br>');
        }).join('');
    }

    // ------------------------------------------------
    // 9. ACTIVE MODEL ACCESSOR
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
        DOM.sendBtn.addEventListener('click', handleSend);

        DOM.userInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });

        DOM.userInput.addEventListener('input', _autoResize);
    }

    // ------------------------------------------------
    // 11. INITIALISATION
    // ------------------------------------------------
    function init() {
        _initEvents();
        renderHistory();
        console.log('[UIController] Initialised.');
    }

    // ------------------------------------------------
    // 12. PUBLIC API
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

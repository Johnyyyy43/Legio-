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
                        if (typeof window._openFileInStudio === 'function') {
                            window._openFileInStudio(fileId);
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
    // 5.5 CODE BLOCK INTERCEPTOR
    // ------------------------------------------------
    function _interceptCodeBlocks(fullText) {
        console.log('[UIController] _interceptCodeBlocks called');
        
        let isCodeBlock = false;
        let codeBuffer = [];
        let detectedLang = null;
        let codeBlocksWritten = 0;
        let codeBlocksMetadata = [];
        const FENCE_REGEX = /^```([a-zA-Z0-9_+-]*)\s*$/;
        
        const langToExt = {
            'javascript': 'js', 'js': 'js', 'python': 'py', 'py': 'py',
            'html': 'html', 'css': 'css', 'json': 'json', 'xml': 'xml',
            'sql': 'sql', 'bash': 'sh', 'sh': 'sh', 'java': 'java',
            'cpp': 'cpp', 'c': 'c', 'csharp': 'cs', 'cs': 'cs',
            'ruby': 'rb', 'php': 'php', 'go': 'go', 'rust': 'rs',
            'kotlin': 'kt', 'swift': 'swift', 'typescript': 'ts', 'ts': 'ts',
            'jsx': 'jsx', 'tsx': 'tsx', 'vue': 'vue', 'markdown': 'md', 'md': 'md'
        };

        function _generateSmartName(code, lang) {
            const ext = langToExt[lang] || (lang || 'txt');
            const lines = code.split('\n');
            let hint = '';
            
            for (let i = 0; i < Math.min(3, lines.length); i++) {
                const line = lines[i].trim();
                if (line && !line.startsWith('//') && !line.startsWith('#') && !line.startsWith('*')) {
                    hint = line.substring(0, 40).replace(/[^a-z0-9_]/gi, '').toLowerCase();
                    if (hint.length > 3) break;
                }
            }

            const defaultNames = {
                'html': 'page', 'js': 'script', 'py': 'script', 'css': 'styles',
                'json': 'data', 'sql': 'query', 'jsx': 'component', 'tsx': 'component'
            };

            const baseName = hint || defaultNames[ext] || 'code';
            return baseName + '.' + ext;
        }

        function processLine(line) {
            const fenceMatch = line.match(FENCE_REGEX);

            if (fenceMatch) {
                if (!isCodeBlock) {
                    isCodeBlock = true;
                    codeBuffer = [];
                    detectedLang = fenceMatch[1] || null;
                    return null;
                } else {
                    isCodeBlock = false;
                    const completeCode = codeBuffer.join('\n');
                    codeBuffer = [];

                    if (completeCode.trim() !== '') {
                        const fileName = _generateSmartName(completeCode, detectedLang);
                        const timestamp = Date.now();
                        const blockId = Math.random().toString(36).substring(7);
                        const targetFileId = 'code_' + timestamp + '_' + blockId;

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
                            
                            console.log('[UIController] Code saved:', fileName);

                            if (typeof window.refreshStudioFileTree === 'function') {
                                window.refreshStudioFileTree();
                            }
                            if (typeof window.refreshStudioEditor === 'function') {
                                window.refreshStudioEditor(targetFileId);
                            }
                        } catch (err) {
                            console.error('[UIController] Failed to save code:', err.message);
                        }
                    }

                    detectedLang = null;
                    return null;
                }
            }

            if (isCodeBlock) {
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

        if (isCodeBlock && codeBuffer.length > 0) {
            isCodeBlock = false;
            const completeCode = codeBuffer.join('\n');
            if (completeCode.trim() !== '') {
                const fileName = _generateSmartName(completeCode, detectedLang);
                const timestamp = Date.now();
                const blockId = Math.random().toString(36).substring(7);
                const targetFileId = 'code_' + timestamp + '_' + blockId;
                
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
                    if (typeof window.refreshStudioFileTree === 'function') {
                        window.refreshStudioFileTree();
                    }
                } catch (err) {
                    console.error('[UIController] Failed to save partial code:', err.message);
                }
            }
        }

        return {
            proseText: proseLines.join('\n').trim(),
            codeBlocksWritten: codeBlocksWritten,
            codeBlocks: codeBlocksMetadata
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

            const { proseText, codeBlocksWritten, codeBlocks } = _interceptCodeBlocks(replyText);

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

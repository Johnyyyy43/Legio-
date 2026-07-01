"use strict";

// ================================================
// LEGIO — js/state.js
// State Manager v3.0
//
// Responsibilities:
//   - Own the single source of truth for the app
//   - Manage the Virtual File System (VFS)
//   - Manage BYOK API keys with tier enforcement
//   - Persist state to localStorage
//   - Expose a clean public API (no internals leak out)
//
// TIER LIMITS:
//   free   → max 2 provider keys
//   pro    → max 4 provider keys
//   studio → unlimited keys + collaboration
// ================================================

const StateManager = (function () {

    // ------------------------------------------------
    // 1. CONSTANTS
    // ------------------------------------------------
    const STORAGE_KEY = 'legio_project_v3';

    const TIER_LIMITS = {
        free:   2,
        pro:    4,
        studio: Infinity
    };

    // ------------------------------------------------
    // 2. DEFAULT PROJECT FACTORY
    //    Called when no saved state exists, or when
    //    the user creates a brand-new project.
    // ------------------------------------------------
    function createDefaultProject() {
        return {
            // Project identity
            meta: {
                id:        'proj_' + Date.now(),
                name:      'Untitled Project',
                type:      'code',   // 'code' | 'doc' | 'media'
                tier:      'free',   // 'free' | 'pro' | 'studio'
                createdAt: Date.now()
            },

            // BYOK keys — keyed by provider name (lowercase)
            // e.g. { groq: 'gsk_...', openai: 'sk-...' }
            keys: {},

            // The shared context — full chat history
            // All AI models read this same array
            // Shape: [{ role: 'user'|'model', content: '', model: null|'groq' }]
            context: [],

            // Virtual File System
            // Shape: { fileId: { name: '', content: '' } }
            vfs: {
                'main': {
                    name:    'main.js',
                    content: '// Start your project here.\n'
                }
            },

            // Which file is active in the Studio
            activeFile: 'main'
        };
    }

    // ------------------------------------------------
    // 3. INTERNAL STATE
    //    Load from localStorage, or start fresh.
    // ------------------------------------------------
    let _project = _loadFromStorage() || createDefaultProject();
    console.log('[StateManager] VERSION CHECK: build-2026-06-30-fix3 loaded successfully');

    // ------------------------------------------------
    // 4. STORAGE HELPERS
    // ------------------------------------------------
    function _saveToStorage() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_project));
        } catch (err) {
            // Storage full or private mode — surface visibly
            console.error('[StateManager] Could not save to localStorage:', err);
        }
    }

    function _loadFromStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;

            const parsed = JSON.parse(raw);

            // Basic shape validation — if the saved data is
            // from an old version, discard it and start fresh.
            if (!parsed.meta || !parsed.context || !parsed.vfs) {
                console.warn('[StateManager] Stale storage detected. Starting fresh.');
                return null;
            }

            return parsed;
        } catch (err) {
            console.error('[StateManager] Failed to parse storage:', err);
            return null;
        }
    }

    // ------------------------------------------------
    // 5. PROJECT INITIALISATION
    //    Called by the "New Project" modal submission.
    //    Wipes current state and starts clean.
    // ------------------------------------------------
    function initProject(config) {
        // config shape:
        // { name: string, type: string, keys: { provider: key, ... }, tier: string }

        if (!config || typeof config !== 'object') {
            throw new Error('[StateManager] initProject: config object is required.');
        }
        if (!config.name || config.name.trim() === '') {
            throw new Error('[StateManager] initProject: project name is required.');
        }

        _project = createDefaultProject();
        _project.meta.name = config.name.trim();
        _project.meta.type = config.type || 'code';
        _project.meta.tier = config.tier || 'free';

        // Add any keys passed in from the modal
        if (config.keys && typeof config.keys === 'object') {
            for (const provider in config.keys) {
                const key = config.keys[provider];
                if (key && key.trim() !== '') {
                    // Use addKey so tier enforcement runs even at init
                    _addKeyInternal(provider.toLowerCase(), key.trim());
                }
            }
        }

        _saveToStorage();
        console.log('[StateManager] Project initialised:', _project.meta.name);
    }

    // ------------------------------------------------
    // 6. KEY MANAGEMENT
    // ------------------------------------------------

    // Internal — skips the tier check (used during initProject
    // where we trust the modal already enforced the limit).
    function _addKeyInternal(provider, key) {
        _project.keys[provider] = key;
    }

    // External — enforces tier limit, throws on violation
    // so the caller can show the upgrade modal.
    function addKey(provider, key) {
        if (!provider || !key) {
            throw new Error('[StateManager] addKey: provider and key are required.');
        }

        const limit     = TIER_LIMITS[_project.meta.tier] || TIER_LIMITS.free;
        const current   = Object.keys(_project.keys).length;
        const alreadyHas = Object.prototype.hasOwnProperty.call(_project.keys, provider);

        // Replacing an existing key for the same provider is always allowed
        if (!alreadyHas && current >= limit) {
            const err = new Error('TIER_LIMIT_REACHED');
            err.limit    = limit;
            err.tier     = _project.meta.tier;
            throw err;
        }

        _project.keys[provider.toLowerCase()] = key.trim();
        _saveToStorage();
    }

    function getKey(provider) {
        return _project.keys[provider] || null;
    }

    function getAllKeys() {
        // Return a shallow copy — callers must not mutate the original
        return Object.assign({}, _project.keys);
    }

    function getKeyCount() {
        return Object.keys(_project.keys).length;
    }

    function getTierLimit() {
        return TIER_LIMITS[_project.meta.tier] || TIER_LIMITS.free;
    }

    // ------------------------------------------------
    // 7. CONTEXT (CHAT HISTORY)
    // ------------------------------------------------
    function getContext() {
        // Return a deep copy so callers cannot accidentally
        // mutate the live context array
        return JSON.parse(JSON.stringify(_project.context));
    }

    function addUserMessage(text) {
        if (!text || text.trim() === '') {
            throw new Error('[StateManager] addUserMessage: text is required.');
        }

        const msg = {
            role:    'user',
            content: text.trim(),
            model:   null,
            ts:      Date.now()
        };

        _project.context.push(msg);
        _saveToStorage();
        return msg;
    }

    function addModelMessage(text, modelName) {
        if (!text) {
            throw new Error('[StateManager] addModelMessage: text is required.');
        }
        if (!modelName) {
            throw new Error('[StateManager] addModelMessage: modelName is required.');
        }

        const msg = {
            role:    'model',
            content: text,
            model:   modelName.toLowerCase(),
            ts:      Date.now()
        };

        _project.context.push(msg);
        _saveToStorage();
        return msg;
    }

    function clearContext() {
        _project.context = [];
        _saveToStorage();
    }

    // ------------------------------------------------
    // 8. VIRTUAL FILE SYSTEM
    // ------------------------------------------------
    function getFiles() {
        // Shallow copy of the file map — names and IDs only
        // Use getFileContent for actual content
        return Object.assign({}, _project.vfs);
    }

    function getFileContent(fileId) {
        const file = _project.vfs[fileId];
        if (!file) {
            console.warn('[StateManager] getFileContent: file not found:', fileId);
            return '// File not found.';
        }
        return file.content;
    }

    function setFileContent(fileId, newContent) {
        if (!_project.vfs[fileId]) {
            throw new Error('[StateManager] setFileContent: file not found: ' + fileId);
        }
        _project.vfs[fileId].content = newContent;
        _saveToStorage();
    }

    function createFile(fileId, fileName) {
        if (!fileId || !fileName) {
            throw new Error('[StateManager] createFile: fileId and fileName are required.');
        }
        if (_project.vfs[fileId]) {
            throw new Error('[StateManager] createFile: file already exists: ' + fileId);
        }

        _project.vfs[fileId] = {
            name:    fileName,
            content: '// ' + fileName + '\n'
        };
        _saveToStorage();
    }

    function deleteFile(fileId) {
        if (!_project.vfs[fileId]) {
            throw new Error('[StateManager] deleteFile: file not found: ' + fileId);
        }
        delete _project.vfs[fileId];

        // If the deleted file was active, fall back to first available
        if (_project.activeFile === fileId) {
            const remaining = Object.keys(_project.vfs);
            _project.activeFile = remaining.length > 0 ? remaining[0] : null;
        }

        _saveToStorage();
    }

    function getActiveFile() {
        return _project.activeFile;
    }

    function setActiveFile(fileId) {
        if (!_project.vfs[fileId]) {
            throw new Error('[StateManager] setActiveFile: file not found: ' + fileId);
        }
        _project.activeFile = fileId;
        _saveToStorage();
    }

    // ------------------------------------------------
    // 9. PROJECT META ACCESSORS
    // ------------------------------------------------
    function getProjectName() {
        return _project.meta.name;
    }

    function getProjectType() {
        return _project.meta.type;
    }

    function getTier() {
        return _project.meta.tier;
    }

    function setTier(tier) {
        if (!TIER_LIMITS[tier]) {
            throw new Error('[StateManager] setTier: unknown tier: ' + tier);
        }
        _project.meta.tier = tier;
        _saveToStorage();
    }

    // Full project snapshot — used for debugging only
    function _debugSnapshot() {
        return JSON.parse(JSON.stringify(_project));
    }

    // ------------------------------------------------
    // 10. PUBLIC API
    //     Every method name here is the contract that
    //     app.js, ui.js, and api.js depend on.
    //     Do NOT rename without updating all callers.
    // ------------------------------------------------
    return {
        // Project lifecycle
        initProject:     initProject,

        // Keys
        addKey:          addKey,
        getKey:          getKey,
        getAllKeys:       getAllKeys,
        getKeyCount:     getKeyCount,
        getTierLimit:    getTierLimit,

        // Context
        getContext:      getContext,
        addUser:         addUserMessage,
        addModel:        addModelMessage,
        clearContext:    clearContext,

        // VFS
        getFiles:        getFiles,
        getFileContent:  getFileContent,
        setFileContent:  setFileContent,
        createFile:      createFile,
        deleteFile:      deleteFile,
        getActiveFile:   getActiveFile,
        setActiveFile:   setActiveFile,

        // Meta
        getProjectName:  getProjectName,
        getProjectType:  getProjectType,
        getTier:         getTier,
        setTier:         setTier,

        // Debug
        _debug:          _debugSnapshot
    };

})();

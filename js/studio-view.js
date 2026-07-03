"use strict";

// ================================================
// LEGIO — js/studio-view.js
// Studio View v1.0
//
// Responsibilities:
//   - Own the file sidebar list, tab bar, and code viewer
//     inside the Code Studio panel.
//   - Listen for 'legio:filesChanged' (fired by
//     FileController) and rebuild itself automatically —
//     no other module needs to remember to call a refresh
//     function after creating/editing a file.
//   - Own its own small internal state: which tabs are
//     open, which one is active.
//
// Depends on: StateManager (state.js), FileController (file-controller.js)
// Called by:  app.js (init, open/close Studio panel),
//             ui.js (open a specific file when a chat
//             code-block-container is clicked)
//
// WHY THIS EXISTS:
//   Previously this logic lived inside app.js and had to be
//   manually re-triggered (buildStudioFileTree()) every time
//   a file was created anywhere else in the codebase. If a
//   caller forgot, the sidebar silently went stale — which is
//   exactly the bug that caused "I click the file and nothing
//   happens." Now there is exactly one way files enter the
//   VFS (FileController), and exactly one place that reacts to
//   that (here), so there's no code path that can miss it.
// ================================================

const StudioView = (function () {

    // ------------------------------------------------
    // 1. DOM CACHE
    // ------------------------------------------------
    const DOM = {
        fileList:     document.getElementById('studio-file-list'),
        tabs:         document.getElementById('studio-tabs'),
        codeContent:  document.getElementById('studio-code-content')
    };

    (function validateDOM() {
        for (const key in DOM) {
            if (!DOM[key]) {
                throw new Error('[StudioView] DOM element not found: #' + key +
                    '. Check index.html for a missing or duplicate ID.');
            }
        }
    })();

    // ------------------------------------------------
    // 2. INTERNAL STATE
    //    Kept local to this module — app.js no longer
    //    needs to track which tabs are open.
    // ------------------------------------------------
    let _openTabs  = [];   // Array of fileIds currently open as tabs
    let _activeTab = null; // fileId of the currently viewed file

    // ------------------------------------------------
    // 3. FILE TREE RENDERING
    //    Rebuilds the sidebar list from whatever
    //    FileController.list() currently returns.
    // ------------------------------------------------
    function _renderFileTree() {
        const files = FileController.list();
        DOM.fileList.innerHTML = '';

        const fileIds = Object.keys(files);

        if (fileIds.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'file-tree-empty';
            empty.textContent = 'No files yet.';
            DOM.fileList.appendChild(empty);
            return;
        }

        fileIds.forEach(function (fileId) {
            const file = files[fileId];

            const item = document.createElement('div');
            item.className = 'file-item';
            item.setAttribute('data-file-id', fileId);
            if (fileId === _activeTab) {
                item.classList.add('active');
            }
            item.textContent = file.name;

            item.addEventListener('click', function () {
                openFile(fileId);
            });

            DOM.fileList.appendChild(item);
        });

        console.log('[StudioView] File tree rendered:', fileIds.length, 'file(s)');
    }

    // ------------------------------------------------
    // 4. TAB BAR RENDERING
    // ------------------------------------------------
    function _renderTabs() {
        const files = FileController.list();
        DOM.tabs.innerHTML = '';

        _openTabs.forEach(function (fileId) {
            const file = files[fileId];
            if (!file) {
                // File was deleted since the tab was opened — drop it
                return;
            }

            const tab = document.createElement('div');
            tab.className = 'studio-tab' + (fileId === _activeTab ? ' active' : '');
            tab.textContent = file.name;
            tab.setAttribute('data-file-id', fileId);
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', fileId === _activeTab ? 'true' : 'false');

            tab.addEventListener('click', function () {
                openFile(fileId);
            });

            DOM.tabs.appendChild(tab);
        });
    }

    // ------------------------------------------------
    // 5. CODE VIEWER RENDERING
    // ------------------------------------------------
    function _renderCode(fileId) {
        if (!fileId) {
            DOM.codeContent.textContent = '// Open a file from the sidebar.';
            return;
        }

        const content = FileController.read(fileId);
        DOM.codeContent.textContent = content;

        console.log('[StudioView] Rendered code for', fileId, '(' + content.length + ' chars)');
    }

    // ------------------------------------------------
    // 6. OPEN A FILE
    //    Public — called by clicking the sidebar, clicking
    //    a tab, or by ui.js when a chat code-block-container
    //    is clicked.
    // ------------------------------------------------
    function openFile(fileId) {
        const files = FileController.list();

        if (!files[fileId]) {
            console.warn('[StudioView] openFile: file does not exist:', fileId);
            return;
        }

        if (_openTabs.indexOf(fileId) === -1) {
            _openTabs.push(fileId);
        }

        _activeTab = fileId;

        _renderFileTree();
        _renderTabs();
        _renderCode(fileId);

        // Keep StateManager's activeFile in sync too, since other
        // code (e.g. legacy fallbacks) may still read it.
        StateManager.setActiveFile(fileId);
    }

    // ------------------------------------------------
    // 7. CLOSE A TAB
    //    Public — for a future close (×) button on tabs.
    //    Not wired to any UI yet, but exposed so app.js
    //    can add that button without touching this module.
    // ------------------------------------------------
    function closeTab(fileId) {
        const idx = _openTabs.indexOf(fileId);
        if (idx === -1) return;

        _openTabs.splice(idx, 1);

        if (_activeTab === fileId) {
            _activeTab = _openTabs.length > 0 ? _openTabs[_openTabs.length - 1] : null;
        }

        _renderTabs();
        _renderCode(_activeTab);
    }

    // ------------------------------------------------
    // 8. RESET
    //    Called when a new project is created — clears
    //    all open tabs since they belonged to the old
    //    project's files.
    // ------------------------------------------------
    function reset() {
        _openTabs  = [];
        _activeTab = null;
        _renderFileTree();
        _renderTabs();
        _renderCode(null);
    }

    // ------------------------------------------------
    // 9. GET ACTIVE FILE
    // ------------------------------------------------
    function getActiveFile() {
        return _activeTab;
    }

    // ------------------------------------------------
    // 10. EVENT LISTENER — auto-refresh on any file change
    //     This is the core fix: no matter which module
    //     changed a file (AI response, user action, future
    //     features), this module hears about it and updates
    //     itself. Nobody has to remember to call anything.
    // ------------------------------------------------
    window.addEventListener('legio:filesChanged', function (e) {
        console.log('[StudioView] Received legio:filesChanged event:', e.detail);

        _renderFileTree();

        // If the change was a 'create' and nothing is open yet,
        // automatically open the new file so the user isn't
        // staring at an empty viewer after asking an AI for code.
        if (e.detail.reason === 'create' && e.detail.fileId) {
            openFile(e.detail.fileId);
            return;
        }

        // If the active tab's content was updated, refresh the
        // viewer so edits show immediately without re-clicking.
        if (e.detail.fileId === _activeTab) {
            _renderCode(_activeTab);
        }

        _renderTabs();
    });

    // ------------------------------------------------
    // 11. INITIALISATION
    // ------------------------------------------------
    function init() {
        _renderFileTree();
        _renderCode(null);
        console.log('[StudioView] Initialised.');
    }

    // ------------------------------------------------
    // 12. PUBLIC API
    // ------------------------------------------------
    return {
        init:          init,
        openFile:      openFile,
        closeTab:      closeTab,
        reset:         reset,
        getActiveFile: getActiveFile
    };

})();

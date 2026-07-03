"use strict";

// ================================================
// LEGIO — js/app.js
// App Controller v3.0
//
// Responsibilities:
//   - Own every DOM event listener
//   - Orchestrate all module interactions
//   - Sidebar open / close
//   - Theme toggle
//   - New Project modal (submit + validation)
//   - Add Model modal (mid-project key injection)
//   - Upgrade / paywall modal
//   - Code Studio open / close / tab / file tree
//   - Highlight-to-chat workflow
//
// Depends on: StateManager, UIController, APIController
// Load order: state.js → ui.js → api.js → app.js
//
// CROSS-FILE CONTRACT — every external call verified:
//   StateManager.initProject()    ✓ state.js
//   StateManager.addKey()         ✓ state.js
//   StateManager.getFiles()       ✓ state.js
//   StateManager.getFileContent() ✓ state.js
//   StateManager.getActiveFile()  ✓ state.js
//   StateManager.setActiveFile()  ✓ state.js
//   StateManager.getProjectName() ✓ state.js
//   UIController.init()           ✓ ui.js
//   UIController.setActiveModel() ✓ ui.js
//   APIController.getSupportedProviders() ✓ api.js
// ================================================

// ------------------------------------------------
// 1. DOM CACHE
//    Every ID must exist exactly once in index.html.
//    Validated immediately after declaration.
// ------------------------------------------------
const DOM = {
    // Sidebar
    menuBtn:           document.getElementById('menu-btn'),
    sidebar:           document.getElementById('sidebar'),
    sidebarCloseBtn:   document.getElementById('sidebar-close-btn'),
    sidebarOverlay:    document.getElementById('sidebar-overlay'),
    newProjectBtn:     document.getElementById('new-project-btn'),

    // App header
    appTitle:          document.getElementById('app-title'),
    addModelBtn:       document.getElementById('add-model-btn'),
    themeToggleBtn:    document.getElementById('theme-toggle-btn'),

    // New Project modal
    projectModal:      document.getElementById('project-modal'),
    modalCloseBtn:     document.getElementById('modal-close-btn'),
    inputProjectName:  document.getElementById('input-project-name'),
    inputProjectType:  document.getElementById('input-project-type'),
    btnCreateProject:  document.getElementById('btn-create-project'),

    // Add Model modal
    addModelModal:     document.getElementById('add-model-modal'),
    addModelCloseBtn:  document.getElementById('add-model-close-btn'),
    addModelProvider:  document.getElementById('add-model-provider'),
    addModelKey:       document.getElementById('add-model-key'),
    btnAddModel:       document.getElementById('btn-add-model'),

    // Upgrade modal — intentionally NOT cached here.
    // Owned entirely by PaywallController (js/paywall.js).

    // Code Studio
    codeStudio:        document.getElementById('code-studio'),
    openStudioBtn:     document.getElementById('open-studio-btn'),
    studioBackBtn:     document.getElementById('studio-back-btn'),
    studioSidebarToggle: document.getElementById('studio-sidebar-toggle'),
    studioSidebar:     document.getElementById('studio-sidebar'),
    studioFileList:    document.getElementById('studio-file-list'),
    studioTabs:        document.getElementById('studio-tabs'),
    studioCodeContent: document.getElementById('studio-code-content'),
    studioProjectName: document.getElementById('studio-project-name'),

    // Highlight bar
    highlightBar:      document.getElementById('studio-highlight-bar'),
    btnCopyHighlight:  document.getElementById('btn-copy-highlight'),
    btnEditHighlight:  document.getElementById('btn-edit-highlight'),

    // Input dock
    userInput:         document.getElementById('user-input'),
    inputDock:         document.getElementById('input-dock')
};

// Validate every element exists before attaching listeners.
// A null element would cause a silent crash on addEventListener.
(function validateDOM() {
    for (const key in DOM) {
        if (!DOM[key]) {
            throw new Error(
                '[App] DOM element not found for key "' + key + '". ' +
                'Check index.html for a missing or duplicate ID.'
            );
        }
    }
    console.log('[App] DOM validated — all elements found.');
})();


// ------------------------------------------------
// 2. APP STATE
// ------------------------------------------------
const appState = {
    isSidebarOpen: false,

    // Studio tab tracking
    studio: {
        openTabs:  [],   // array of fileId strings
        activeTab: null  // currently visible fileId
    }
};


// ================================================
// 3. SIDEBAR
// ================================================
function openSidebar() {
    if (appState.isSidebarOpen) return;
    appState.isSidebarOpen = true;
    DOM.sidebar.classList.add('open');
    DOM.sidebarOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    if (!appState.isSidebarOpen) return;
    appState.isSidebarOpen = false;
    DOM.sidebar.classList.remove('open');
    DOM.sidebarOverlay.classList.remove('open');
    document.body.style.overflow = '';
}

// Populate sidebar with current project
function rebuildSidebarRecents() {
    const recentsList = document.getElementById('sidebar-recents-list');
    if (!recentsList) return;

    recentsList.innerHTML = '';

    const currentProjectName = StateManager.getProjectName();
    if (currentProjectName && currentProjectName !== 'Untitled Project') {
        const li = document.createElement('li');
        li.textContent = currentProjectName;
        li.style.cursor = 'pointer';
        li.addEventListener('click', function () {
            closeSidebar();
            console.log('[App] Viewing project:', currentProjectName);
        });
        recentsList.appendChild(li);
    }
}


// ================================================
// 4. THEME TOGGLE
// ================================================
function toggleTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
    }
}


// ================================================
// 5. NEW PROJECT MODAL
// ================================================
function openProjectModal() {
    closeSidebar();
    DOM.projectModal.classList.remove('modal-hidden');
    DOM.inputProjectName.focus();
}

function closeProjectModal() {
    DOM.projectModal.classList.add('modal-hidden');
    _clearProjectModalInputs();
}

function _clearProjectModalInputs() {
    DOM.inputProjectName.value  = '';
    DOM.inputProjectType.value  = 'code';

    // Key inputs are dynamic (built by PaywallController based on
    // tier), so clear whatever is currently in the container rather
    // than referencing fixed IDs that may no longer exist.
    const keyInputs = DOM.projectModal.querySelectorAll('#modal-keys-container input');
    keyInputs.forEach(function (input) { input.value = ''; });
}

function submitNewProject() {
    console.log('[App] submitNewProject called');

    const name = DOM.inputProjectName.value.trim();
    const type = DOM.inputProjectType.value;

    // Validate — surface errors visibly, not just in console
    if (name === '') {
        console.warn('[App] Project name is empty');
        _shakeInput(DOM.inputProjectName);
        return;
    }

    try {
        // Everything that touches another module now lives inside
        // this try block. If PaywallController, StateManager, or
        // UIController is undefined / throws for any reason, the
        // catch block fires and the user sees an alert instead of
        // the button silently doing nothing.

        console.log('[App] Collecting keys via PaywallController...');
        const keys = PaywallController.collectModalKeys();
        console.log('[App] Collected keys:', Object.keys(keys));

        const validationError = PaywallController.validateKeyCount(keys);
        if (validationError) {
            console.warn('[App] Validation error:', validationError);
            alert(validationError);
            return;
        }

        console.log('[App] Proceeding with project init...');

        // 1. Initialise state
        StateManager.initProject({ name, type, keys, tier: StateManager.getTier() });

        // 2. Update header title
        DOM.appTitle.textContent = name;

        // 3. Set active model to first provided key
        const firstProvider = Object.keys(keys)[0];
        if (firstProvider) UIController.setActiveModel(firstProvider);

        // 4. Reset Studio state
        appState.studio.openTabs  = [];
        appState.studio.activeTab = null;
        DOM.studioTabs.innerHTML      = '';
        DOM.studioCodeContent.textContent = '// Open a file from the sidebar.';
        DOM.studioProjectName.textContent = name;

        // 5. Rebuild Studio file tree
        buildStudioFileTree();

        // 6. Re-render chat (clears old messages)
        UIController.renderHistory();

        // 7. Refresh paywall badge and provider dropdown
        PaywallController.refreshKeyBadge();

        // 8. Close modal and refresh sidebar
        closeProjectModal();
        rebuildSidebarRecents();

        console.log('[App] New project created:', name);

    } catch (err) {
        // Show the actual error message in the UI
        console.error('[App] submitNewProject failed:', err);
        alert('Could not create project: ' + err.message);
    }
}

// Brief shake animation to indicate a required field
function _shakeInput(inputEl) {
    inputEl.style.transition = 'transform 0.08s ease';
    inputEl.style.transform  = 'translateX(-6px)';
    setTimeout(function () { inputEl.style.transform = 'translateX(6px)';  }, 80);
    setTimeout(function () { inputEl.style.transform = 'translateX(-4px)'; }, 160);
    setTimeout(function () { inputEl.style.transform = 'translateX(0)';    }, 240);
    inputEl.focus();
}


// ================================================
// 6. ADD MODEL MODAL (Mid-project key injection)
// ================================================
function openAddModelModal() {
    DOM.addModelModal.classList.remove('modal-hidden');
    DOM.addModelKey.focus();
}

function closeAddModelModal() {
    DOM.addModelModal.classList.add('modal-hidden');
    DOM.addModelProvider.value = 'groq';
    DOM.addModelKey.value      = '';
}

function submitAddModel() {
    const provider = DOM.addModelProvider.value.trim().toLowerCase();
    const key      = DOM.addModelKey.value.trim();

    if (!key) {
        _shakeInput(DOM.addModelKey);
        return;
    }

    // Check tier limit BEFORE attempting the add. If at limit,
    // canAddKey() opens the upgrade modal itself and returns false.
    if (!PaywallController.canAddKey()) {
        closeAddModelModal();
        return;
    }

    try {
        StateManager.addKey(provider, key);

        // Switch the active model to the one just added
        UIController.setActiveModel(provider);

        // Refresh the live badge to reflect the new count
        PaywallController.refreshKeyBadge();

        closeAddModelModal();
        console.log('[App] Key added for provider:', provider);

    } catch (err) {
        console.error('[App] submitAddModel failed:', err);
        alert('Could not add model: ' + err.message);
    }
}


// ================================================
// 7. UPGRADE / PAYWALL MODAL
//    Ownership: PaywallController (js/paywall.js)
//    handles open/close, tier copy, and the dev
//    upgrade helper. app.js does not duplicate this.
// ================================================


// ================================================
// 8. CODE STUDIO
// ================================================
function openStudio() {
    DOM.codeStudio.classList.remove('studio-hidden');
    DOM.inputDock.style.display = 'none';

    // Update Studio project name from state
    DOM.studioProjectName.textContent = StateManager.getProjectName();

    // If no tab is open yet, open the first available file
    const files = StateManager.getFiles();
    const fileIds = Object.keys(files);

    if (appState.studio.openTabs.length === 0 && fileIds.length > 0) {
        _openFileInStudio(fileIds[0]);
    } else if (appState.studio.activeTab) {
        _renderStudioCode(appState.studio.activeTab);
    }
}

function closeStudio() {
    DOM.codeStudio.classList.add('studio-hidden');
    DOM.inputDock.style.display = '';
    DOM.highlightBar.classList.add('highlight-bar-hidden');
}

function toggleStudioSidebar() {
    const isOpen = DOM.studioSidebar.classList.contains('studio-sidebar-open');
    if (isOpen) {
        DOM.studioSidebar.classList.remove('studio-sidebar-open');
        DOM.studioSidebar.classList.add('studio-sidebar-closed');
    } else {
        DOM.studioSidebar.classList.remove('studio-sidebar-closed');
        DOM.studioSidebar.classList.add('studio-sidebar-open');
    }
}

// Build the file list in the Studio sidebar from VFS
function buildStudioFileTree() {
    const files = StateManager.getFiles();
    DOM.studioFileList.innerHTML = '';

    for (const fileId in files) {
        if (!Object.prototype.hasOwnProperty.call(files, fileId)) continue;

        const item = document.createElement('div');
        item.className = 'file-item';
        item.setAttribute('data-file-id', fileId);
        item.textContent = files[fileId].name;

        // Use a closure to capture fileId correctly in the loop
        (function (id) {
            item.addEventListener('click', function () {
                _openFileInStudio(id);
            });
        })(fileId);

        DOM.studioFileList.appendChild(item);
    }
}

// Open a file: add a tab if not already open, make it active
function _openFileInStudio(fileId) {
    const studio = appState.studio;

    if (studio.openTabs.indexOf(fileId) === -1) {
        studio.openTabs.push(fileId);
    }

    studio.activeTab = fileId;

    // Close the file sidebar after selection on mobile
    if (DOM.studioSidebar.classList.contains('studio-sidebar-open')) {
        toggleStudioSidebar();
    }

    _renderStudioTabs();
    _renderStudioCode(fileId);

    StateManager.setActiveFile(fileId);
}

// Render the tab bar from openTabs
function _renderStudioTabs() {
    const files  = StateManager.getFiles();
    const studio = appState.studio;
    DOM.studioTabs.innerHTML = '';

    studio.openTabs.forEach(function (fileId) {
        const file = files[fileId];
        if (!file) return; // File was deleted — skip

        const tab = document.createElement('div');
        tab.className  = 'studio-tab' + (fileId === studio.activeTab ? ' active' : '');
        tab.textContent = file.name;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', fileId === studio.activeTab ? 'true' : 'false');

        // Capture fileId in closure
        (function (id) {
            tab.addEventListener('click', function () {
                studio.activeTab = id;
                StateManager.setActiveFile(id);
                _renderStudioTabs();
                _renderStudioCode(id);
            });
        })(fileId);

        DOM.studioTabs.appendChild(tab);
    });
}

// Render file contents into the code viewer
function _renderStudioCode(fileId) {
    DOM.studioCodeContent.textContent = StateManager.getFileContent(fileId);

    // Highlight active file in the sidebar
    const items = DOM.studioFileList.querySelectorAll('.file-item');
    items.forEach(function (item) {
        if (item.getAttribute('data-file-id') === fileId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}


// ================================================
// 9. HIGHLIGHT-TO-CHAT WORKFLOW
// ================================================

// Watch for text selection inside the code viewer.
// Show the action bar only when text is selected
// within the code viewer element.
function _handleSelectionChange() {
    const selection  = window.getSelection();
    const selected   = selection ? selection.toString().trim() : '';
    const codeViewer = document.getElementById('studio-code-viewer');

    if (
        selected.length > 0 &&
        codeViewer &&
        selection.anchorNode &&
        codeViewer.contains(selection.anchorNode)
    ) {
        DOM.highlightBar.classList.remove('highlight-bar-hidden');
    } else {
        DOM.highlightBar.classList.add('highlight-bar-hidden');
    }
}

async function copyHighlightedCode() {
    const selected = window.getSelection();
    const text     = selected ? selected.toString() : '';

    try {
        await navigator.clipboard.writeText(text);
    } catch (err) {
        console.error('[App] Clipboard write failed:', err);
    }

    if (selected) selected.removeAllRanges();
    DOM.highlightBar.classList.add('highlight-bar-hidden');
}

function sendHighlightToChat() {
    const selected = window.getSelection();
    const text     = selected ? selected.toString().trim() : '';

    if (!text) return;

    if (selected) selected.removeAllRanges();
    DOM.highlightBar.classList.add('highlight-bar-hidden');

    // Close Studio and return to chat
    closeStudio();

    // Paste the snippet into the input box with an @tag prefix.
    // The user then types their instruction and sends.
    const activeModel  = UIController.getActiveModel();
    const tagPrefix    = '@' + activeModel + ' ';
    const codeBlock    = '```\n' + text + '\n```\n';

    // Small delay so the dock has time to reappear
    setTimeout(function () {
        DOM.userInput.value = tagPrefix + codeBlock;
        DOM.userInput.focus();
        // Trigger auto-resize in UIController
        DOM.userInput.dispatchEvent(new Event('input'));
        // Place cursor at the end so the user can type their instruction
        DOM.userInput.setSelectionRange(
            DOM.userInput.value.length,
            DOM.userInput.value.length
        );
    }, 120);
}


// ================================================
// 10. EVENT LISTENERS
// ================================================
function initEvents() {

    // ---- Sidebar ----
    DOM.menuBtn.addEventListener('click', openSidebar);
    DOM.sidebarCloseBtn.addEventListener('click', closeSidebar);
    DOM.sidebarOverlay.addEventListener('click', closeSidebar);
    DOM.newProjectBtn.addEventListener('click', openProjectModal);

    // ---- Theme ----
    DOM.themeToggleBtn.addEventListener('click', toggleTheme);

    // ---- New Project modal ----
    DOM.modalCloseBtn.addEventListener('click', closeProjectModal);
    DOM.btnCreateProject.addEventListener('click', submitNewProject);

    // Close modal on Enter key in project name field
    DOM.inputProjectName.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitNewProject();
    });

    // ---- Add Model modal ----
    DOM.addModelBtn.addEventListener('click', openAddModelModal);
    DOM.addModelCloseBtn.addEventListener('click', closeAddModelModal);
    DOM.btnAddModel.addEventListener('click', submitAddModel);

    DOM.addModelKey.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitAddModel();
    });

    // ---- Upgrade modal ----
    // Owned entirely by PaywallController (button listeners
    // attached in paywall.js init()). No duplicate listeners here.

    // ---- Code Studio ----
    DOM.openStudioBtn.addEventListener('click', openStudio);
    DOM.studioBackBtn.addEventListener('click', closeStudio);
    DOM.studioSidebarToggle.addEventListener('click', toggleStudioSidebar);

    // ---- Highlight workflow ----
    document.addEventListener('selectionchange', _handleSelectionChange);
    DOM.btnCopyHighlight.addEventListener('click', copyHighlightedCode);
    DOM.btnEditHighlight.addEventListener('click', sendHighlightToChat);

    // ---- Resize safety ----
    // Close sidebar automatically if viewport expands past mobile breakpoint
    window.addEventListener('resize', function () {
        if (window.innerWidth > 768 && appState.isSidebarOpen) {
            closeSidebar();
        }
    });

    // ---- Keyboard shortcuts ----
    document.addEventListener('keydown', function (e) {
        // Escape closes whichever modal or panel is open
        if (e.key === 'Escape') {
            if (!DOM.projectModal.classList.contains('modal-hidden'))  closeProjectModal();
            if (!DOM.addModelModal.classList.contains('modal-hidden')) closeAddModelModal();
            const upgradeModalEl = document.getElementById('upgrade-modal');
            if (!upgradeModalEl.classList.contains('modal-hidden'))  PaywallController.closeUpgradeModal();
            if (!DOM.codeStudio.classList.contains('studio-hidden'))   closeStudio();
            if (appState.isSidebarOpen)                                closeSidebar();
        }
    });
}


// ================================================
// 11.5 STUDIO REFRESH HOOK
//     Called by StreamInterceptor (js/stream-interceptor.js)
//     after a code block is written to the VFS, so the
//     Studio editor view updates live if it's open and
//     showing the file that was just written to.
//     This is intentionally the one deliberate global
//     beyond StateManager/UIController/APIController/
//     PaywallController, since StreamInterceptor must not
//     import app.js (would create a circular dependency).
// ================================================
window.refreshStudioEditor = function (fileId) {
    // Only refresh if Studio is currently open AND showing this file
    const studioIsOpen = !DOM.codeStudio.classList.contains('studio-hidden');
    if (!studioIsOpen) return;

    if (appState.studio.activeTab !== fileId) return;

    _renderStudioCode(fileId);
    console.log('[App] Studio editor refreshed for file:', fileId);
};

// Expose refreshStudioFileTree globally so UI can trigger updates when new files are created
window.refreshStudioFileTree = function () {
    console.log('[App] Refreshing Studio file tree');
    buildStudioFileTree();
};

// Expose _openFileInStudio globally so chat can click code block containers to open files
window._openFileInStudio = function (fileId) {
    openStudio();
    _openFileInStudio(fileId);
};


// ================================================
// 12. INITIALISATION
// ================================================
function init() {
    // 1. Init the paywall controller first — builds the dynamic
    //    key slots in the New Project modal and the live badge.
    //    Must run before any modal is opened.
    PaywallController.init();

    // 2. Attach all event listeners
    initEvents();

    // 3. Init the UI controller (attaches send/input events)
    UIController.init();

    // 4. Build the Studio file tree from saved state
    buildStudioFileTree();

    // 5. Populate sidebar with current project
    rebuildSidebarRecents();

    // 6. Restore project name in header and Studio if one exists
    const savedName = StateManager.getProjectName();
    if (savedName && savedName !== 'Untitled Project') {
        DOM.appTitle.textContent          = savedName;
        DOM.studioProjectName.textContent = savedName;
    }

    console.log('[App] Legio initialised v3.0');
}

// Boot the app
init();

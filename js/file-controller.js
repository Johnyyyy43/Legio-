"use strict";

// ================================================
// LEGIO — js/file-controller.js
// File Controller v1.0
//
// Responsibilities:
//   - The ONLY module allowed to create/update/delete
//     files in the Virtual File System.
//   - Wraps StateManager's VFS functions.
//   - Fires a 'legio:filesChanged' event on window after
//     every mutation, so any listener (Studio view, etc.)
//     can refresh itself without the caller having to
//     remember to trigger a refresh manually.
//
// Depends on: StateManager (state.js)
// Called by:  action-parser.js, code-block-parser.js,
//             app.js (for manual user actions later)
//
// WHY THIS EXISTS:
//   Previously, UIController created files directly via
//   StateManager, and the Studio sidebar only refreshed
//   when someone remembered to call buildStudioFileTree()
//   afterwards. That's how files silently failed to show
//   up or open. Centralising all writes here means we only
//   need ONE emit point, and only ONE listener (studio-view.js)
//   needs to exist for the UI to always stay in sync.
// ================================================

const FileController = (function () {

    // ------------------------------------------------
    // 1. INTERNAL: FIRE CHANGE EVENT
    // ------------------------------------------------
    function _emitChanged(reason, fileId) {
        console.log('[FileController] Emitting legio:filesChanged. Reason:', reason, 'fileId:', fileId || 'n/a');
        window.dispatchEvent(new CustomEvent('legio:filesChanged', {
            detail: { reason: reason, fileId: fileId || null }
        }));
    }

    // ------------------------------------------------
    // 2. GENERATE A UNIQUE FILE ID
    //    Internal helper — callers never invent IDs
    //    themselves, so there's one place that guarantees
    //    uniqueness.
    // ------------------------------------------------
    function _generateFileId() {
        const timestamp = Date.now();
        const rand = Math.random().toString(36).substring(2, 8);
        return 'file_' + timestamp + '_' + rand;
    }

    // ------------------------------------------------
    // 3. CREATE
    //    Creates a new file with the given name and
    //    initial content. Returns the created file's
    //    { id, name } so the caller (e.g. an AI response
    //    handler) can reference it immediately without
    //    having to guess or re-derive the ID.
    // ------------------------------------------------
    function create(fileName, initialContent) {
        if (!fileName || typeof fileName !== 'string') {
            throw new Error('[FileController] create: fileName is required and must be a string.');
        }

        const fileId = _generateFileId();
        const content = typeof initialContent === 'string' ? initialContent : '';

        // StateManager.createFile() sets a default placeholder comment as
        // content — overwrite it immediately with the real content in the
        // same call chain so there's never a moment where the file exists
        // with wrong content.
        StateManager.createFile(fileId, fileName);

        if (content !== '') {
            StateManager.setFileContent(fileId, content);
        }

        console.log('[FileController] Created file:', fileName, '(' + fileId + ')');
        _emitChanged('create', fileId);

        return { id: fileId, name: fileName };
    }

    // ------------------------------------------------
    // 4. READ
    //    Returns the raw content string of a file.
    //    Does NOT throw on missing file — StateManager
    //    already returns a friendly placeholder string,
    //    which is safe to surface directly.
    // ------------------------------------------------
    function read(fileId) {
        if (!fileId) {
            throw new Error('[FileController] read: fileId is required.');
        }
        return StateManager.getFileContent(fileId);
    }

    // ------------------------------------------------
    // 5. UPDATE
    //    Overwrites a file's content. Throws if the file
    //    doesn't exist — callers (like the action parser)
    //    should always create before updating, or read
    //    the file list first to confirm the target exists.
    // ------------------------------------------------
    function update(fileId, newContent) {
        if (!fileId) {
            throw new Error('[FileController] update: fileId is required.');
        }
        if (typeof newContent !== 'string') {
            throw new Error('[FileController] update: newContent must be a string.');
        }

        StateManager.setFileContent(fileId, newContent);

        console.log('[FileController] Updated file:', fileId, '(' + newContent.length + ' chars)');
        _emitChanged('update', fileId);
    }

    // ------------------------------------------------
    // 6. DELETE
    // ------------------------------------------------
    function remove(fileId) {
        if (!fileId) {
            throw new Error('[FileController] remove: fileId is required.');
        }

        StateManager.deleteFile(fileId);

        console.log('[FileController] Deleted file:', fileId);
        _emitChanged('delete', fileId);
    }

    // ------------------------------------------------
    // 7. RENAME
    //    StateManager doesn't have a native rename, so
    //    this reads the current content, deletes the old
    //    file, and re-creates it under the new name. This
    //    changes the fileId (StateManager has no update-key
    //    operation), so it returns the NEW id — callers
    //    must update any stored reference to the old id.
    // ------------------------------------------------
    function rename(fileId, newName) {
        if (!fileId || !newName) {
            throw new Error('[FileController] rename: fileId and newName are required.');
        }

        const content = StateManager.getFileContent(fileId);
        StateManager.deleteFile(fileId);

        const newFileId = _generateFileId();
        StateManager.createFile(newFileId, newName);
        StateManager.setFileContent(newFileId, content);

        console.log('[FileController] Renamed file:', fileId, '->', newFileId, '(' + newName + ')');
        _emitChanged('rename', newFileId);

        return { id: newFileId, name: newName };
    }

    // ------------------------------------------------
    // 8. LIST
    //    Returns the full file map: { fileId: { name, content } }
    // ------------------------------------------------
    function list() {
        return StateManager.getFiles();
    }

    // ------------------------------------------------
    // 9. FIND BY NAME
    //    Used by the action parser when an AI says
    //    "edit Player.js" — looks up the fileId by its
    //    display name so callers don't need to track IDs
    //    themselves. Returns null if not found, or if
    //    multiple files share the name, returns the most
    //    recently created match (last one found).
    // ------------------------------------------------
    function findByName(fileName) {
        if (!fileName) return null;

        const files = StateManager.getFiles();
        let match = null;

        for (const fileId in files) {
            if (!Object.prototype.hasOwnProperty.call(files, fileId)) continue;
            if (files[fileId].name === fileName) {
                match = { id: fileId, name: files[fileId].name };
            }
        }

        return match;
    }

    // ------------------------------------------------
    // 10. PUBLIC API
    // ------------------------------------------------
    return {
        create:      create,
        read:        read,
        update:      update,
        remove:      remove,
        rename:      rename,
        list:        list,
        findByName:  findByName
    };

})();

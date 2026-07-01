"use strict";

// ================================================
// LEGIO — js/paywall.js
// Paywall & BYOK Controller v3.0
//
// Responsibilities:
//   - Render the live key slot indicator in the toolbar
//   - Gate the Add Model flow by tier
//   - Drive the upgrade modal with correct copy
//   - Handle tier upgrades (client-side stub +
//     hook point for real payment backend)
//   - Guard the New Project modal against
//     submitting more keys than the tier allows
//
// Depends on: StateManager (state.js)
// Called by:  app.js — PaywallController.init()
//
// TIER TABLE:
//   free   → 2 keys  → upgrade prompt at 3rd
//   pro    → 4 keys  → upgrade prompt at 5th
//   studio → ∞ keys  → no gate
// ================================================

const PaywallController = (function () {

    console.log('[PaywallController] VERSION CHECK: build-2026-06-30-fix3 loading...');

    // ------------------------------------------------
    // 1. DOM CACHE
    //    All IDs verified against index.html
    // ------------------------------------------------
    const DOM = {
        // Toolbar key counter badge
        keyCountBadge:    document.getElementById('key-count-badge'),

        // Upgrade modal inner elements
        upgradeModal:     document.getElementById('upgrade-modal'),
        upgradeHeading:   document.getElementById('upgrade-modal-title'),
        upgradeLimitText: document.getElementById('upgrade-limit-text'),
        btnUpgrade:       document.getElementById('btn-upgrade'),
        btnUpgradeCancel: document.getElementById('btn-upgrade-cancel'),

        // Tier cards inside upgrade modal
        tierCardPro:      document.getElementById('tier-card-pro'),
        tierCardStudio:   document.getElementById('tier-card-studio'),

        // New Project modal key inputs wrapper
        // Used to show/hide extra key slots by tier
        modalKeysContainer: document.getElementById('modal-keys-container')
    };

    // Validate — fail loudly if anything is missing
    (function validateDOM() {
        for (const key in DOM) {
            if (!DOM[key]) {
                throw new Error(
                    '[PaywallController] DOM element not found: #' + key +
                    '. Check index.html.'
                );
            }
        }
    })();

    // ------------------------------------------------
    // 2. TIER COPY
    //    What each upgrade modal state says depending
    //    on which tier the user is currently on.
    // ------------------------------------------------
    const TIER_COPY = {
        free: {
            heading:  'Upgrade to Pro',
            body:     'Your Free plan supports up to 2 models. ' +
                      'Upgrade to Pro to use up to 4 models in a single project.',
            cta:      'Upgrade to Pro'
        },
        pro: {
            heading:  'Upgrade to Studio',
            body:     'Your Pro plan supports up to 4 models. ' +
                      'Upgrade to Studio for unlimited models and real-time collaboration.',
            cta:      'Upgrade to Studio'
        }
    };

    // ------------------------------------------------
    // 3. KEY COUNT BADGE
    //    Shows "2 / 2" in the toolbar so the user
    //    always knows where they stand.
    // ------------------------------------------------
    function refreshKeyBadge() {
        const count = StateManager.getKeyCount();
        const limit = StateManager.getTierLimit();
        const tier  = StateManager.getTier();

        if (tier === 'studio') {
            DOM.keyCountBadge.textContent = count + ' models';
        } else {
            DOM.keyCountBadge.textContent = count + ' / ' + limit;
        }

        // Colour the badge red when at the limit
        if (count >= limit && tier !== 'studio') {
            DOM.keyCountBadge.classList.add('badge--at-limit');
        } else {
            DOM.keyCountBadge.classList.remove('badge--at-limit');
        }
    }

    // ------------------------------------------------
    // 4. GATE CHECK
    //    Call this before opening the Add Model modal.
    //    Returns true if the user can add another key.
    //    Returns false and opens the upgrade modal if not.
    // ------------------------------------------------
    function canAddKey() {
        const count = StateManager.getKeyCount();
        const limit = StateManager.getTierLimit();

        if (count < limit) return true;

        // At or over limit — show upgrade modal
        openUpgradeModal();
        return false;
    }

    // ------------------------------------------------
    // 5. UPGRADE MODAL
    // ------------------------------------------------
    function openUpgradeModal() {
        const tier = StateManager.getTier();
        const copy = TIER_COPY[tier] || TIER_COPY.free;

        // Update modal text to match current tier
        DOM.upgradeHeading.textContent   = copy.heading;
        DOM.upgradeLimitText.textContent = copy.body;
        DOM.btnUpgrade.textContent       = copy.cta;

        // Highlight the relevant tier card
        _highlightTierCard(tier);

        DOM.upgradeModal.classList.remove('modal-hidden');
    }

    function closeUpgradeModal() {
        DOM.upgradeModal.classList.add('modal-hidden');
    }

    function _highlightTierCard(currentTier) {
        // Reset both
        DOM.tierCardPro.classList.remove('upgrade-tier--highlight');
        DOM.tierCardStudio.classList.remove('upgrade-tier--highlight');

        // Highlight the next tier up
        if (currentTier === 'free') {
            DOM.tierCardPro.classList.add('upgrade-tier--highlight');
        } else if (currentTier === 'pro') {
            DOM.tierCardStudio.classList.add('upgrade-tier--highlight');
        }
    }

    // ------------------------------------------------
    // 6. UPGRADE ACTION
    //    Stub for real payment integration.
    //    When Stripe / LemonSqueezy is added, replace
    //    the window.open with a checkout redirect.
    //    On successful webhook, call StateManager.setTier()
    //    and refreshKeyBadge().
    // ------------------------------------------------
    function handleUpgradeClick() {
        const tier = StateManager.getTier();

        // In production: redirect to Stripe checkout
        // and set tier via webhook + Vercel KV or similar.
        // For now: open pricing page.
        const pricingUrl = 'https://legio.app/pricing?from=' + tier;
        window.open(pricingUrl, '_blank');
    }

    // Dev-only helper: simulate a tier upgrade without payment.
    // Call PaywallController._devUpgrade('pro') in the console.
    function _devUpgrade(newTier) {
        try {
            StateManager.setTier(newTier);
            refreshKeyBadge();
            closeUpgradeModal();
            console.log('[PaywallController] Dev tier set to:', newTier);
        } catch (err) {
            console.error('[PaywallController] _devUpgrade failed:', err);
        }
    }

    // ------------------------------------------------
    // 7. NEW PROJECT MODAL — KEY SLOT GUARD
    //    The New Project modal shows 2 key fields by
    //    default (matching Free tier).
    //    This function rebuilds the key inputs to match
    //    however many slots the current tier allows.
    // ------------------------------------------------
    function buildModalKeySlots() {
        const limit     = StateManager.getTierLimit();
        const tier      = StateManager.getTier();
        const container = DOM.modalKeysContainer;

        // Define all possible providers in priority order
        const PROVIDERS = [
            { id: 'input-key-groq',       label: 'Groq Key',             placeholder: 'gsk_...' },
            { id: 'input-key-openai',      label: 'OpenAI Key',           placeholder: 'sk-...' },
            { id: 'input-key-claude',      label: 'Anthropic Key',        placeholder: 'sk-ant-...' },
            { id: 'input-key-gemini',      label: 'Google Gemini Key',    placeholder: 'AIza...' },
            { id: 'input-key-mistral',     label: 'Mistral Key',          placeholder: 'your key...' },
            { id: 'input-key-openrouter',  label: 'OpenRouter Key',       placeholder: 'sk-or-...' }
        ];

        // How many slots to show
        const slotsToShow = tier === 'studio' ? PROVIDERS.length : Math.min(limit, PROVIDERS.length);

        container.innerHTML = '';

        for (let i = 0; i < slotsToShow; i++) {
            const p    = PROVIDERS[i];
            const group = document.createElement('div');
            group.className = 'input-group';
            group.innerHTML =
                '<label class="input-label" for="' + p.id + '">' + p.label + '</label>' +
                '<input class="input-field" type="password" id="' + p.id + '" ' +
                'placeholder="' + p.placeholder + '" autocomplete="off">';
            container.appendChild(group);
        }
    }

    // Collect all key values from the New Project modal.
    // Returns { provider: key } for any non-empty field.
    function collectModalKeys() {
        const PROVIDER_IDS = {
            'input-key-groq':       'groq',
            'input-key-openai':     'openai',
            'input-key-claude':     'claude',
            'input-key-gemini':     'gemini',
            'input-key-mistral':    'mistral',
            'input-key-openrouter': 'openrouter'
        };

        const keys = {};

        for (const inputId in PROVIDER_IDS) {
            const el = document.getElementById(inputId);
            if (el && el.value.trim() !== '') {
                keys[PROVIDER_IDS[inputId]] = el.value.trim();
            }
        }

        return keys;
    }

    // Validate that the collected keys don't exceed
    // the tier limit. Returns an error string or null.
    function validateKeyCount(keys) {
        const limit = StateManager.getTierLimit();
        const count = Object.keys(keys).length;

        if (count === 0) {
            return 'Add at least one API key to continue.';
        }

        if (count > limit) {
            return 'Your plan supports ' + limit + ' model' +
                   (limit === 1 ? '' : 's') + '. Remove ' +
                   (count - limit) + ' key' +
                   (count - limit === 1 ? '' : 's') + ' to continue.';
        }

        return null; // Valid
    }

    // ------------------------------------------------
    // 8. EVENT LISTENERS
    // ------------------------------------------------
    function _initEvents() {
        DOM.btnUpgrade.addEventListener('click', handleUpgradeClick);
        DOM.btnUpgradeCancel.addEventListener('click', closeUpgradeModal);

        // Escape key closes the upgrade modal
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (!DOM.upgradeModal.classList.contains('modal-hidden')) {
                    closeUpgradeModal();
                }
            }
        });
    }

    // ------------------------------------------------
    // 9. INITIALISATION
    // ------------------------------------------------
    function init() {
        _initEvents();
        refreshKeyBadge();
        buildModalKeySlots();
        console.log('[PaywallController] Initialised.');
    }

    // ------------------------------------------------
    // 10. PUBLIC API
    // ------------------------------------------------
    return {
        init:              init,
        canAddKey:         canAddKey,
        openUpgradeModal:  openUpgradeModal,
        closeUpgradeModal: closeUpgradeModal,
        refreshKeyBadge:   refreshKeyBadge,
        buildModalKeySlots: buildModalKeySlots,
        collectModalKeys:  collectModalKeys,
        validateKeyCount:  validateKeyCount,

        // Dev-only
        _devUpgrade: _devUpgrade
    };

})();

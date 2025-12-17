/**
 * Mute - Content Script
 * Runs on Twitch pages to detect ad playback and communicate state changes
 * to the background script for system audio muting.
 */

(function() {
    'use strict';

    const DEBUG = false;

    /**
     * Logs messages when DEBUG mode is enabled
     * @param {string} message - Message to log
     * @param {*} data - Optional data to log
     */
    function log(message, data) {
        if (DEBUG) {
            if (data !== undefined) {
                console.log('[Mute]', message, data);
            } else {
                console.log('[Mute]', message);
            }
        }
    }

    /**
     * Logs important state changes regardless of debug mode
     * @param {string} message - Message to log
     */
    function logState(message) {
        console.log('[Mute]', message);
    }

    // =========================================================================
    // State Management
    // =========================================================================

    const state = {
        isAdPlaying: false,
        isCurrentlyMuted: false,
        debounceTimer: null,
        observer: null,
        playerObserver: null,
        navigationObserver: null,
        currentUrl: window.location.href
    };

    // =========================================================================
    // Ad Detection Selectors
    // =========================================================================

    /**
     * Selectors are loaded from selectors.js (window.AdSelectors)
     * This allows easy contribution of updated selectors when Twitch changes their DOM.
     * See CONTRIBUTING.md for instructions on updating selectors.
     */
    const adDetectors = window.AdSelectors || {
        // Fallback selectors if AdSelectors fails to load
        selectors: [],
        playerContainerSelectors: ['[data-a-target="video-player"]', '.video-player'],
        classPatterns: [],
        dataAttributePatterns: [],
        videoAttributes: [],
        containerAttributes: [],
        adStateValues: [],
        textIndicators: [],
        monitoredAttributes: ['class', 'data-a-target', 'data-test-selector', 'style']
    };

    if (!window.AdSelectors) {
        console.warn('[Mute] AdSelectors not loaded, ad detection may not work correctly');
    } else {
        log('AdSelectors loaded, version:', adDetectors.version);
    }

    /**
     * Tracks which detection strategy was used for the current ad
     * Used for logging and debugging
     */
    const detectionStats = {
        lastStrategy: null,
        strategyUsage: {
            selector: 0,
            classPattern: 0,
            dataAttribute: 0,
            playerState: 0,
            textContent: 0
        }
    };

    // =========================================================================
    // Ad Detection Logic
    // =========================================================================

    /**
     * Records which detection strategy was used
     * @param {string} strategy - Name of the strategy used
     */
    function recordDetectionStrategy(strategy) {
        if (detectionStats.lastStrategy !== strategy) {
            detectionStats.lastStrategy = strategy;
            detectionStats.strategyUsage[strategy]++;

            // Log when falling back to non-primary strategies
            if (strategy !== 'selector') {
                console.log('[Mute] Ad detected using fallback strategy:', strategy);
            }
        }
    }

    /**
     * Checks if any ad-related elements are present in the DOM
     * Uses multiple detection strategies with fallbacks
     * @returns {boolean} True if an ad is detected
     */
    function checkForAdElements() {
        // Strategy 1: Check specific selectors (primary strategy)
        for (const selector of adDetectors.selectors) {
            const element = document.querySelector(selector);
            if (element) {
                log('Ad detected via selector:', selector);
                recordDetectionStrategy('selector');
                return true;
            }
        }

        // Strategy 2: Check video player state attributes
        const playerContainer = getVideoPlayerContainer();
        if (playerContainer) {
            // Check container attributes for ad state
            for (const attrName of adDetectors.containerAttributes) {
                const attrValue = playerContainer.getAttribute(attrName);
                if (attrValue) {
                    const lowerValue = attrValue.toLowerCase();
                    for (const adValue of adDetectors.adStateValues) {
                        if (lowerValue.includes(adValue)) {
                            log('Ad detected via player state attribute:', attrName + '=' + attrValue);
                            recordDetectionStrategy('playerState');
                            return true;
                        }
                    }
                }
            }

            // Check video element for ad state
            const videoElement = playerContainer.querySelector('video');
            if (videoElement) {
                for (const attrName of adDetectors.videoAttributes) {
                    const attrValue = videoElement.getAttribute(attrName);
                    if (attrValue) {
                        const lowerValue = attrValue.toLowerCase();
                        if (lowerValue === 'true' || adDetectors.adStateValues.some(function(v) { return lowerValue.includes(v); })) {
                            log('Ad detected via video element attribute:', attrName + '=' + attrValue);
                            recordDetectionStrategy('playerState');
                            return true;
                        }
                    }
                }
            }
        }

        // Strategy 3: Check for elements with ad-related class patterns
        if (playerContainer) {
            const allElements = playerContainer.querySelectorAll('*');
            for (const element of allElements) {
                // Check class names
                if (element.className && typeof element.className === 'string') {
                    for (const pattern of adDetectors.classPatterns) {
                        if (pattern.test(element.className)) {
                            log('Ad detected via class pattern:', element.className);
                            recordDetectionStrategy('classPattern');
                            return true;
                        }
                    }
                }

                // Check data attributes
                for (const attr of element.attributes) {
                    for (const pattern of adDetectors.dataAttributePatterns) {
                        if (attr.name.includes(pattern)) {
                            log('Ad detected via data attribute:', attr.name);
                            recordDetectionStrategy('dataAttribute');
                            return true;
                        }
                    }
                }
            }
        }

        // Strategy 4: Check for text content indicating ads (last resort fallback)
        for (const text of adDetectors.textIndicators) {
            const xpath = `//*[contains(text(), '${text}')]`;
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            if (result.singleNodeValue) {
                log('Ad detected via text content:', text);
                recordDetectionStrategy('textContent');
                return true;
            }
        }

        // Reset last strategy when no ad is detected
        if (detectionStats.lastStrategy !== null) {
            detectionStats.lastStrategy = null;
        }

        return false;
    }

    /**
     * Gets the main video player container element
     * @returns {Element|null} The video player container or null if not found
     */
    function getVideoPlayerContainer() {
        for (const selector of adDetectors.playerContainerSelectors) {
            const container = document.querySelector(selector);
            if (container) {
                return container;
            }
        }

        return null;
    }

    // =========================================================================
    // Message Sending
    // =========================================================================

    /**
     * Sends a message to the background script
     * @param {string} action - The action to send ('mute' or 'unmute')
     */
    function sendMessage(action) {
        browser.runtime.sendMessage({ action: action })
            .then(function(response) {
                log('Message sent successfully:', action);
            })
            .catch(function(error) {
                // Background script may not be ready or connection lost
                log('Failed to send message:', error.message);
            });
    }

    // =========================================================================
    // State Transition Handling
    // =========================================================================

    /**
     * Handles the transition when an ad is detected
     */
    function onAdStart() {
        if (!state.isCurrentlyMuted) {
            state.isCurrentlyMuted = true;
            logState('Ad detected - sending mute command');
            sendMessage('mute');
        }
    }

    /**
     * Handles the transition when an ad ends
     */
    function onAdEnd() {
        if (state.isCurrentlyMuted) {
            state.isCurrentlyMuted = false;
            logState('Ad ended - sending unmute command');
            sendMessage('unmute');
        }
    }

    /**
     * Performs ad detection check and handles state transitions
     * Uses debouncing to prevent rapid state changes
     */
    function checkAdState() {
        // Clear any existing debounce timer
        if (state.debounceTimer) {
            clearTimeout(state.debounceTimer);
        }

        // Debounce the check by 150ms to handle rapid DOM changes
        state.debounceTimer = setTimeout(function() {
            const adDetected = checkForAdElements();

            if (adDetected !== state.isAdPlaying) {
                state.isAdPlaying = adDetected;

                if (adDetected) {
                    onAdStart();
                } else {
                    onAdEnd();
                }
            }
        }, 150);
    }

    // =========================================================================
    // MutationObserver Setup
    // =========================================================================

    /**
     * Creates and configures the MutationObserver for the video player
     */
    function setupPlayerObserver() {
        // Clean up existing observer
        if (state.observer) {
            state.observer.disconnect();
            state.observer = null;
        }

        const playerContainer = getVideoPlayerContainer();

        if (playerContainer) {
            log('Video player container found, attaching observer');

            state.observer = new MutationObserver(function(mutations) {
                // Batch mutations and perform single check
                checkAdState();
            });

            state.observer.observe(playerContainer, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: adDetectors.monitoredAttributes
            });

            // Perform initial check
            checkAdState();

            return true;
        }

        return false;
    }

    /**
     * Polls for the video player container until found
     * Uses a secondary observer on document.body as backup
     */
    function waitForVideoPlayer() {
        let attempts = 0;
        const maxAttempts = 50;
        const pollInterval = 200;

        function poll() {
            attempts++;

            if (setupPlayerObserver()) {
                log('Observer attached after', attempts, 'attempts');
                return;
            }

            if (attempts < maxAttempts) {
                setTimeout(poll, pollInterval);
            } else {
                log('Video player not found after maximum attempts, setting up body observer');
                setupBodyObserver();
            }
        }

        poll();
    }

    /**
     * Sets up an observer on document.body to detect when the video player is added
     */
    function setupBodyObserver() {
        if (state.playerObserver) {
            state.playerObserver.disconnect();
        }

        state.playerObserver = new MutationObserver(function(mutations) {
            const playerContainer = getVideoPlayerContainer();
            if (playerContainer) {
                log('Video player detected via body observer');
                state.playerObserver.disconnect();
                state.playerObserver = null;
                setupPlayerObserver();
            }
        });

        state.playerObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // =========================================================================
    // SPA Navigation Handling
    // =========================================================================

    /**
     * Handles URL changes in the single-page application
     */
    function handleNavigation() {
        const newUrl = window.location.href;

        if (newUrl !== state.currentUrl) {
            log('Navigation detected:', newUrl);
            state.currentUrl = newUrl;

            // Reset ad state on navigation
            if (state.isCurrentlyMuted) {
                onAdEnd();
            }
            state.isAdPlaying = false;

            // Clear debounce timer
            if (state.debounceTimer) {
                clearTimeout(state.debounceTimer);
                state.debounceTimer = null;
            }

            // Re-initialize observer for new page
            waitForVideoPlayer();
        }
    }

    /**
     * Sets up listeners for SPA navigation events
     */
    function setupNavigationListeners() {
        // Listen for browser back/forward navigation
        window.addEventListener('popstate', handleNavigation);

        // Wrap history.pushState to detect programmatic navigation
        const originalPushState = history.pushState;
        history.pushState = function() {
            originalPushState.apply(this, arguments);
            handleNavigation();
        };

        // Wrap history.replaceState as well
        const originalReplaceState = history.replaceState;
        history.replaceState = function() {
            originalReplaceState.apply(this, arguments);
            handleNavigation();
        };

        // Also set up a MutationObserver on the URL-sensitive elements
        // Twitch uses custom navigation that may not trigger standard events
        setupUrlChangeObserver();
    }

    /**
     * Sets up an observer to detect URL changes via DOM mutations
     * This catches Twitch's custom navigation that may not trigger standard events
     */
    function setupUrlChangeObserver() {
        if (state.navigationObserver) {
            state.navigationObserver.disconnect();
        }

        let lastCheckedUrl = window.location.href;

        state.navigationObserver = new MutationObserver(function() {
            if (window.location.href !== lastCheckedUrl) {
                lastCheckedUrl = window.location.href;
                handleNavigation();
            }
        });

        // Observe changes to elements that typically change during navigation
        const navigationTargets = document.querySelectorAll('title, [data-a-target="channel-header"]');
        navigationTargets.forEach(function(target) {
            state.navigationObserver.observe(target, {
                childList: true,
                subtree: true,
                characterData: true
            });
        });

        // Fallback: observe body for major DOM changes
        state.navigationObserver.observe(document.body, {
            childList: true,
            subtree: false
        });
    }

    // =========================================================================
    // Cleanup
    // =========================================================================

    /**
     * Cleans up all observers and timers
     */
    function cleanup() {
        if (state.observer) {
            state.observer.disconnect();
            state.observer = null;
        }

        if (state.playerObserver) {
            state.playerObserver.disconnect();
            state.playerObserver = null;
        }

        if (state.navigationObserver) {
            state.navigationObserver.disconnect();
            state.navigationObserver = null;
        }

        if (state.debounceTimer) {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = null;
        }
    }

    // =========================================================================
    // Initialization
    // =========================================================================

    /**
     * Determines the type of content on the current page
     * @returns {Object} Content type information
     */
    function getContentType() {
        const url = window.location.href;
        const hostname = window.location.hostname;

        // Embedded player on third-party sites
        const isEmbeddedPlayer = hostname === 'player.twitch.tv';

        // Stream pages: twitch.tv/username (not followed by /videos, /clips, /about, etc.)
        const streamPattern = /^https?:\/\/(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)\/?$/;

        // VOD pages: twitch.tv/videos/123456
        const vodPattern = /^https?:\/\/(?:www\.)?twitch\.tv\/videos\/\d+/;

        // Clip pages: twitch.tv/username/clip/clipname or clips.twitch.tv
        const clipPattern = /^https?:\/\/(?:www\.)?twitch\.tv\/[a-zA-Z0-9_]+\/clip\//;
        const clipsSubdomain = hostname === 'clips.twitch.tv';

        // Channel sub-paths that may have video
        const channelWithPathPattern = /^https?:\/\/(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)\/(?!videos|clips|about|schedule)/;

        return {
            isEmbedded: isEmbeddedPlayer,
            isStream: streamPattern.test(url),
            isVOD: vodPattern.test(url),
            isClip: clipPattern.test(url) || clipsSubdomain,
            isChannelWithPath: channelWithPathPattern.test(url),
            url: url,
            hostname: hostname
        };
    }

    /**
     * Determines if the current page is a stream or VOD page
     * @returns {boolean} True if this is a watchable content page
     */
    function isWatchablePage() {
        const contentType = getContentType();

        // Embedded players always need monitoring (ads can appear in embeds)
        if (contentType.isEmbedded) {
            log('Embedded player detected');
            return true;
        }

        // VODs can have pre-roll and mid-roll ads
        if (contentType.isVOD) {
            log('VOD page detected');
            return true;
        }

        // Live streams have pre-roll and mid-roll ads
        if (contentType.isStream) {
            log('Stream page detected');
            return true;
        }

        // Clips typically do not have ads, but monitor anyway for edge cases
        if (contentType.isClip) {
            log('Clip page detected - monitoring for potential ads');
            return true;
        }

        // Other channel sub-paths that may have video content
        if (contentType.isChannelWithPath) {
            log('Channel sub-path with potential video detected');
            return true;
        }

        return false;
    }

    /**
     * Initializes the content script
     */
    function init() {
        logState('Content script initializing on: ' + window.location.href);

        // Set up navigation listeners for SPA handling
        setupNavigationListeners();

        // Only set up ad detection on watchable pages
        if (isWatchablePage()) {
            log('Watchable page detected, setting up ad detection');
            waitForVideoPlayer();
        } else {
            log('Non-watchable page, ad detection not active');
        }

        // Clean up on page unload
        window.addEventListener('unload', cleanup);
    }

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

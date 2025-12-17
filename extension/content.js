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
     * Collection of selectors and detection strategies for identifying Twitch ads.
     * Multiple fallback strategies are implemented due to Twitch's frequent DOM updates.
     */
    const adDetectors = {
        /**
         * Primary selectors for ad-related elements
         * These are checked in order of reliability
         */
        selectors: [
            // Ad banner/overlay elements
            '[data-a-target="video-ad-label"]',
            '[data-a-target="video-ad-countdown"]',
            '[data-test-selector="ad-banner-default-text"]',
            '[data-test-selector="video-ad-component"]',

            // Ad countdown timer
            '.video-ad-countdown',
            '.ad-countdown',

            // Player ad overlay containers
            '[data-a-target="player-overlay-ad-banner"]',
            '.player-ad-notice',
            '.ad-banner',

            // Purple "Ad" badge in player
            '.tw-pill--ad',
            '[data-test-selector="ad-pill"]'
        ],

        /**
         * Class name patterns that indicate ad content
         * Used as fallback when specific selectors fail
         */
        classPatterns: [
            /^video-ad/i,
            /^player-ad/i,
            /ad-overlay/i,
            /ad-banner/i,
            /ad-countdown/i
        ],

        /**
         * Data attribute patterns for ad detection
         */
        dataAttributePatterns: [
            'data-ad-',
            'data-video-ad',
            'data-player-ad'
        ]
    };

    // =========================================================================
    // Ad Detection Logic
    // =========================================================================

    /**
     * Checks if any ad-related elements are present in the DOM
     * @returns {boolean} True if an ad is detected
     */
    function checkForAdElements() {
        // Strategy 1: Check specific selectors
        for (const selector of adDetectors.selectors) {
            const element = document.querySelector(selector);
            if (element) {
                log('Ad detected via selector:', selector);
                return true;
            }
        }

        // Strategy 2: Check for elements with ad-related class patterns
        const playerContainer = getVideoPlayerContainer();
        if (playerContainer) {
            const allElements = playerContainer.querySelectorAll('*');
            for (const element of allElements) {
                // Check class names
                if (element.className && typeof element.className === 'string') {
                    for (const pattern of adDetectors.classPatterns) {
                        if (pattern.test(element.className)) {
                            log('Ad detected via class pattern:', element.className);
                            return true;
                        }
                    }
                }

                // Check data attributes
                for (const attr of element.attributes) {
                    for (const pattern of adDetectors.dataAttributePatterns) {
                        if (attr.name.includes(pattern)) {
                            log('Ad detected via data attribute:', attr.name);
                            return true;
                        }
                    }
                }
            }
        }

        // Strategy 3: Check for text content indicating ads
        const adTextIndicators = [
            'Ad playing',
            'Ad will end in',
            'Your video will resume'
        ];

        for (const text of adTextIndicators) {
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
                return true;
            }
        }

        return false;
    }

    /**
     * Gets the main video player container element
     * @returns {Element|null} The video player container or null if not found
     */
    function getVideoPlayerContainer() {
        // Primary player containers
        const containerSelectors = [
            '[data-a-target="video-player"]',
            '.video-player',
            '[data-a-target="player-overlay-click-handler"]',
            '.persistent-player',
            '.video-player__container',
            '#video-player'
        ];

        for (const selector of containerSelectors) {
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
                attributeFilter: ['class', 'data-a-target', 'data-test-selector', 'style']
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
     * Determines if the current page is a stream or VOD page
     * @returns {boolean} True if this is a watchable content page
     */
    function isWatchablePage() {
        const url = window.location.href;

        // Stream pages: twitch.tv/username (not followed by /videos, /clips, /about, etc.)
        // VOD pages: twitch.tv/videos/123456
        // Clip pages: twitch.tv/username/clip/clipname

        const streamPattern = /^https?:\/\/(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)\/?$/;
        const vodPattern = /^https?:\/\/(?:www\.)?twitch\.tv\/videos\/\d+/;
        const channelWithPathPattern = /^https?:\/\/(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)\/(?!videos|clips|about|schedule)/;

        // Allow VODs as they can have ads
        if (vodPattern.test(url)) {
            return true;
        }

        // Allow direct channel pages (streams)
        if (streamPattern.test(url)) {
            return true;
        }

        // Allow certain sub-paths that may have video
        if (channelWithPathPattern.test(url)) {
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

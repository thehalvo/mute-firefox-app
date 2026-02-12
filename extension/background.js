/**
 * Mute - Background Script
 * Manages native host connection and message routing between content scripts,
 * network-based ad detection, and the native messaging host for system audio control.
 *
 * Supports two detection strategies:
 * - Twitch: DOM-based detection via content scripts (MutationObserver + CSS selectors)
 * - Peacock: Network-based detection via webRequest API (SSAI ad tracking beacons)
 */

(function() {
    'use strict';

    const NATIVE_HOST_NAME = 'com.twitchadmuter.host';
    const DEBUG = true;

    // =========================================================================
    // Logging
    // =========================================================================

    /**
     * Logs messages when DEBUG mode is enabled
     * @param {string} message - Message to log
     * @param {*} data - Optional data to log
     */
    function log(message, data) {
        if (DEBUG) {
            if (data !== undefined) {
                console.log('[Mute Background]', message, data);
            } else {
                console.log('[Mute Background]', message);
            }
        }
    }

    /**
     * Logs important state changes regardless of debug mode
     * @param {string} message - Message to log
     */
    function logState(message) {
        console.log('[Mute Background]', message);
    }

    /**
     * Logs errors regardless of debug mode
     * @param {string} message - Error message
     * @param {*} error - Optional error object
     */
    function logError(message, error) {
        if (error !== undefined) {
            console.error('[Mute Background]', message, error);
        } else {
            console.error('[Mute Background]', message);
        }
    }

    // =========================================================================
    // Connection State
    // =========================================================================

    const connectionState = {
        port: null,
        isConnected: false,
        reconnectAttempts: 0,
        reconnectTimer: null,
        pendingMessages: [],
        currentStatus: 'disconnected',
        lastError: null
    };

    // =========================================================================
    // Mute State Tracking
    // =========================================================================

    /**
     * Tracks mute state to prevent unmuting user-initiated mutes.
     * Uses reference-counted activeMuteSources to support simultaneous
     * mute requests from multiple sources (e.g. Twitch tab + Peacock tab).
     * System mutes on first source added, unmutes when all sources removed.
     */
    const muteState = {
        // Set of source identifiers that have requested mute
        // e.g. "twitch-123", "peacock-456"
        activeMuteSources: new Set(),
        // Whether we're waiting for a status response before muting
        pendingMuteCheck: false,
        // Which source initiated the pending mute check
        pendingMuteSource: null,
        // The system mute state before we muted (for restoration)
        preMuteState: null,
        // Count of failed operations to avoid repeated failures
        failedOperations: 0,
        // Max consecutive failures before entering degraded mode
        maxFailedOperations: 5,
        // Whether we're in degraded mode (native host unavailable)
        degradedMode: false,
        // Tab ID for tab mute fallback
        activeTabId: null
    };

    // Reconnection configuration
    const RECONNECT_INITIAL_DELAY_MS = 1000;
    const RECONNECT_MAX_DELAY_MS = 30000;
    const RECONNECT_MAX_ATTEMPTS = 10;

    // =========================================================================
    // Peacock Ad Detection (Network-Based)
    // =========================================================================

    /**
     * URL patterns for ad tracking beacons monitored via webRequest.
     * These domains are unambiguously ad-related -- they only fire during ad playback.
     */
    const PEACOCK_AD_URL_PATTERNS = [
        '*://*.fwmrm.net/*',
        '*://*.moatads.com/*',
        '*://*.doubleverify.com/*'
    ];

    /**
     * Configuration for Peacock ad detection timing
     */
    const PEACOCK_CONFIG = {
        // Milliseconds of silence (no ad beacons) before declaring ad break over.
        // Peacock's own config has returnFromAdBreakDelay: 4000. We use 8s to
        // bridge gaps between ads in a pod and account for beacon delivery delays.
        AD_END_TIMEOUT_MS: 8000,

        // Minimum number of beacons within BEACON_WINDOW_MS to confirm an ad break.
        // Prevents a single stray request from causing a false mute.
        BEACON_THRESHOLD: 2,

        // Time window (ms) in which BEACON_THRESHOLD beacons must arrive.
        BEACON_WINDOW_MS: 3000
    };

    /**
     * Per-tab Peacock ad detection state.
     * Key: tabId (number)
     * Value: { adActive, timeoutId, lastBeaconTime, beaconCount, firstBeaconTime }
     */
    const peacockAdState = new Map();

    // Badge colors
    const BADGE_COLOR_ERROR = '#D93025';
    const BADGE_COLOR_WARNING = '#F9AB00';
    const BADGE_COLOR_OK = '#34A853';

    // Connection status for popup queries
    const STATUS = {
        CONNECTED: 'connected',
        DISCONNECTED: 'disconnected',
        CONNECTING: 'connecting',
        ERROR: 'error'
    };

    // =========================================================================
    // Badge Management
    // =========================================================================

    /**
     * Updates the browser action badge to indicate connection status
     * @param {string} status - Current connection status
     */
    function updateBadge(status) {
        connectionState.currentStatus = status;

        switch (status) {
            case STATUS.CONNECTED:
                browser.browserAction.setBadgeText({ text: '' });
                browser.browserAction.setBadgeBackgroundColor({ color: BADGE_COLOR_OK });
                browser.browserAction.setTitle({ title: 'Mute - Connected' });
                break;

            case STATUS.CONNECTING:
                browser.browserAction.setBadgeText({ text: '' });
                browser.browserAction.setTitle({ title: 'Mute - Connecting...' });
                break;

            case STATUS.DISCONNECTED:
                browser.browserAction.setBadgeText({ text: '' });
                browser.browserAction.setTitle({ title: 'Mute - Disconnected' });
                break;

            case STATUS.ERROR:
                browser.browserAction.setBadgeText({ text: '' });
                browser.browserAction.setTitle({ title: 'Mute - Setup Required' });
                break;

            default:
                browser.browserAction.setBadgeText({ text: '' });
                browser.browserAction.setTitle({ title: 'Mute - Unknown Status' });
        }
    }

    // =========================================================================
    // Native Host Connection
    // =========================================================================

    /**
     * Calculates the reconnection delay using exponential backoff
     * @returns {number} Delay in milliseconds
     */
    function getReconnectDelay() {
        const delay = Math.min(
            RECONNECT_INITIAL_DELAY_MS * Math.pow(2, connectionState.reconnectAttempts),
            RECONNECT_MAX_DELAY_MS
        );
        return delay;
    }

    /**
     * Resets the reconnection state after successful connection
     */
    function resetReconnectState() {
        connectionState.reconnectAttempts = 0;
        if (connectionState.reconnectTimer) {
            clearTimeout(connectionState.reconnectTimer);
            connectionState.reconnectTimer = null;
        }
    }

    /**
     * Establishes connection to the native host
     * @returns {boolean} True if connection attempt was made
     */
    function connectToNativeHost() {
        // Don't attempt if already connected
        if (connectionState.isConnected && connectionState.port) {
            log('Already connected to native host');
            return true;
        }

        updateBadge(STATUS.CONNECTING);

        try {
            logState('Attempting to connect to native host: ' + NATIVE_HOST_NAME);

            connectionState.port = browser.runtime.connectNative(NATIVE_HOST_NAME);
            connectionState.isConnected = true;
            connectionState.lastError = null;

            // Set up port event listeners
            setupPortListeners();

            logState('Native host connection established');
            resetReconnectState();
            updateBadge(STATUS.CONNECTED);

            // Process any pending messages
            processPendingMessages();

            return true;
        } catch (error) {
            logError('Failed to connect to native host:', error.message);
            connectionState.isConnected = false;
            connectionState.port = null;
            connectionState.lastError = error.message;
            updateBadge(STATUS.ERROR);
            scheduleReconnect();
            return false;
        }
    }

    /**
     * Sets up event listeners on the native messaging port
     */
    function setupPortListeners() {
        if (!connectionState.port) {
            return;
        }

        // Handle messages from native host
        connectionState.port.onMessage.addListener(handleNativeMessage);

        // Handle disconnection
        connectionState.port.onDisconnect.addListener(handleDisconnect);
    }

    /**
     * Handles messages received from the native host
     * @param {Object} message - Message from native host
     */
    function handleNativeMessage(message) {
        log('Received message from native host:', message);

        // Reset failed operations counter on successful communication
        muteState.failedOperations = 0;

        if (message.success !== undefined) {
            if (message.success) {
                log('Command executed successfully');
            } else {
                logError('Command failed:', message.error);
                muteState.failedOperations++;
            }
        }

        if (message.muted !== undefined) {
            log('Current mute status:', message.muted);

            // Handle pending mute check
            if (muteState.pendingMuteCheck) {
                var pendingSource = muteState.pendingMuteSource;
                muteState.pendingMuteCheck = false;
                muteState.pendingMuteSource = null;
                muteState.preMuteState = message.muted;

                if (message.muted) {
                    // System is already muted by user, do not override
                    logState('System already muted by user, skipping extension mute');
                } else {
                    // System is not muted, proceed with muting
                    logState('System not muted, proceeding with extension mute (source: ' + pendingSource + ')');
                    if (pendingSource) {
                        muteState.activeMuteSources.add(pendingSource);
                    }
                    sendCommandToNativeHostDirect('mute');
                }
            }
        }
    }

    /**
     * Sends a command directly to native host without state tracking
     * Used internally after state checks are complete
     * @param {string} command - Command to send
     */
    function sendCommandToNativeHostDirect(command) {
        const message = { command: command };

        if (connectionState.isConnected && connectionState.port) {
            try {
                log('Sending direct command to native host:', command);
                connectionState.port.postMessage(message);
            } catch (error) {
                logError('Failed to send direct command:', error.message);
                muteState.failedOperations++;
            }
        }
    }

    /**
     * Handles disconnection from the native host
     */
    function handleDisconnect() {
        const error = connectionState.port ? connectionState.port.error : null;
        const lastError = browser.runtime.lastError;

        connectionState.isConnected = false;
        connectionState.port = null;

        if (error) {
            logError('Native host disconnected with error:', error.message);
            connectionState.lastError = error.message;
        } else if (lastError) {
            logError('Native host disconnected:', lastError.message);
            connectionState.lastError = lastError.message;
        } else {
            logState('Native host disconnected');
            connectionState.lastError = 'Connection lost';
        }

        updateBadge(STATUS.DISCONNECTED);
        scheduleReconnect();
    }

    /**
     * Schedules a reconnection attempt with exponential backoff
     */
    function scheduleReconnect() {
        // Clear any existing reconnect timer
        if (connectionState.reconnectTimer) {
            clearTimeout(connectionState.reconnectTimer);
            connectionState.reconnectTimer = null;
        }

        // Check if we've exceeded max attempts
        if (connectionState.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            logError('Max reconnection attempts reached. Native host may not be installed.');
            logError('Please run the install script to set up the native messaging host.');
            connectionState.lastError = 'Native host not installed or not responding. Please run the install script.';
            updateBadge(STATUS.ERROR);
            return;
        }

        const delay = getReconnectDelay();
        connectionState.reconnectAttempts++;

        logState('Scheduling reconnection attempt ' + connectionState.reconnectAttempts +
                 ' of ' + RECONNECT_MAX_ATTEMPTS + ' in ' + delay + 'ms');

        connectionState.reconnectTimer = setTimeout(function() {
            connectToNativeHost();
        }, delay);
    }

    /**
     * Disconnects from the native host
     */
    function disconnectFromNativeHost() {
        if (connectionState.port) {
            try {
                connectionState.port.disconnect();
            } catch (error) {
                log('Error during disconnect:', error.message);
            }
        }

        connectionState.port = null;
        connectionState.isConnected = false;
    }

    // =========================================================================
    // Message Handling
    // =========================================================================

    /**
     * Sends a command to the native host
     * @param {string} command - Command to send ('mute', 'unmute', 'getStatus')
     */
    function sendCommandToNativeHost(command) {
        const message = { command: command };

        if (connectionState.isConnected && connectionState.port) {
            try {
                log('Sending command to native host:', command);
                connectionState.port.postMessage(message);
            } catch (error) {
                logError('Failed to send command:', error.message);
                // Queue message for retry after reconnection
                connectionState.pendingMessages.push(message);
                // Trigger reconnection
                handleDisconnect();
            }
        } else {
            log('Not connected, queueing command:', command);
            connectionState.pendingMessages.push(message);
            // Attempt to connect
            connectToNativeHost();
        }
    }

    /**
     * Processes any messages that were queued while disconnected
     */
    function processPendingMessages() {
        if (connectionState.pendingMessages.length === 0) {
            return;
        }

        log('Processing ' + connectionState.pendingMessages.length + ' pending messages');

        // Only send the most recent mute/unmute command to avoid redundancy
        const pendingCommands = connectionState.pendingMessages.slice();
        connectionState.pendingMessages = [];

        // Find the last mute/unmute command (most recent state)
        let lastMuteCommand = null;
        for (let i = pendingCommands.length - 1; i >= 0; i--) {
            const cmd = pendingCommands[i].command;
            if (cmd === 'mute' || cmd === 'unmute') {
                lastMuteCommand = pendingCommands[i];
                break;
            }
        }

        if (lastMuteCommand && connectionState.isConnected && connectionState.port) {
            try {
                log('Sending pending command:', lastMuteCommand.command);
                connectionState.port.postMessage(lastMuteCommand);
            } catch (error) {
                logError('Failed to send pending command:', error.message);
            }
        }
    }

    /**
     * Handles mute request with user state preservation.
     * First queries mute status, then only mutes if system is not already muted.
     * Uses reference-counted sources to support multiple simultaneous mute requests.
     * @param {Object} sender - Sender information for tab mute fallback
     * @param {string} sourceId - Identifier for the mute source (e.g. "twitch-123", "peacock-456")
     */
    function handleMuteRequest(sender, sourceId) {
        // Track the tab for potential fallback
        if (sender && sender.tab) {
            muteState.activeTabId = sender.tab.id;
        }

        // If we already have active mute sources, system is already muted by us
        if (muteState.activeMuteSources.size > 0) {
            logState('Adding mute source: ' + sourceId + ' (already muted by extension)');
            muteState.activeMuteSources.add(sourceId);
            return;
        }

        // Check if we're in degraded mode (too many failures)
        if (muteState.degradedMode || muteState.failedOperations >= muteState.maxFailedOperations) {
            logState('In degraded mode, using tab mute fallback');
            muteState.degradedMode = true;
            muteState.activeMuteSources.add(sourceId);
            muteTabFallback(true);
            return;
        }

        // Check if native host is connected
        if (!connectionState.isConnected || !connectionState.port) {
            logState('Native host not connected, attempting connection and using tab mute fallback');
            muteState.activeMuteSources.add(sourceId);
            connectToNativeHost();
            muteTabFallback(true);
            return;
        }

        // Query current mute status before muting
        logState('Checking system mute status before muting (source: ' + sourceId + ')');
        muteState.pendingMuteCheck = true;
        muteState.pendingMuteSource = sourceId;
        sendCommandToNativeHost('getStatus');
    }

    /**
     * Handles unmute request with user state preservation.
     * Only unmutes if all mute sources have been removed.
     * @param {Object} sender - Sender information for tab mute fallback
     * @param {string} sourceId - Identifier for the mute source to remove
     */
    function handleUnmuteRequest(sender, sourceId) {
        muteState.activeMuteSources.delete(sourceId);

        // Only unmute if no more active mute sources
        if (muteState.activeMuteSources.size > 0) {
            logState('Removing mute source: ' + sourceId +
                     ', remaining sources: ' + muteState.activeMuteSources.size);
            return;
        }

        // Handle tab mute fallback if we're in degraded mode
        if (muteState.degradedMode) {
            muteTabFallback(false);
            return;
        }

        // Check if native host is connected
        if (!connectionState.isConnected || !connectionState.port) {
            logState('Native host not connected, using tab unmute fallback');
            muteTabFallback(false);
            return;
        }

        logState('All mute sources cleared, sending unmute command');
        sendCommandToNativeHost('unmute');
    }

    /**
     * Mutes or unmutes the active tab as a fallback when native host is unavailable
     * @param {boolean} mute - True to mute, false to unmute
     */
    function muteTabFallback(mute) {
        if (!muteState.activeTabId) {
            log('No active tab ID for fallback mute');
            return;
        }

        browser.tabs.update(muteState.activeTabId, { muted: mute })
            .then(function() {
                logState('Tab mute fallback ' + (mute ? 'muted' : 'unmuted') + ' tab ' + muteState.activeTabId);
            })
            .catch(function(error) {
                logError('Tab mute fallback failed:', error.message);
            });
    }

    // =========================================================================
    // Peacock Ad Detection via webRequest
    // =========================================================================

    /**
     * Handles an ad tracking beacon request detected via webRequest.
     * Called for every request matching PEACOCK_AD_URL_PATTERNS.
     * Only processes requests originating from Peacock tabs.
     * @param {Object} details - webRequest details object
     */
    function handlePeacockAdBeacon(details) {
        // Ignore requests not associated with a tab
        if (details.tabId < 0) {
            return;
        }

        var tabId = details.tabId;
        var now = Date.now();

        log('Peacock ad beacon from tab ' + tabId + ': ' + details.url.substring(0, 120));

        // Verify this is actually a Peacock tab
        browser.tabs.get(tabId).then(function(tab) {
            if (!tab.url || !tab.url.includes('peacocktv.com')) {
                return;
            }

            processPeacockBeacon(tabId, now);
        }).catch(function() {
            // Tab may have been closed
        });
    }

    /**
     * Processes a confirmed Peacock ad beacon for the given tab.
     * Manages per-tab state, beacon thresholds, and mute/unmute timing.
     * @param {number} tabId - The tab ID
     * @param {number} now - Current timestamp
     */
    function processPeacockBeacon(tabId, now) {
        // Get or create state for this tab
        var tabState = peacockAdState.get(tabId);
        if (!tabState) {
            tabState = {
                adActive: false,
                timeoutId: null,
                lastBeaconTime: 0,
                beaconCount: 0,
                firstBeaconTime: now
            };
            peacockAdState.set(tabId, tabState);
        }

        tabState.lastBeaconTime = now;
        tabState.beaconCount++;

        // If ad is already active, just reset the timeout
        if (tabState.adActive) {
            resetPeacockAdTimeout(tabId, tabState);
            return;
        }

        // Ad not yet active -- check if we've hit the beacon threshold
        if (tabState.beaconCount >= PEACOCK_CONFIG.BEACON_THRESHOLD &&
            (now - tabState.firstBeaconTime) <= PEACOCK_CONFIG.BEACON_WINDOW_MS) {

            // Confirmed ad break
            tabState.adActive = true;
            var sourceId = 'peacock-' + tabId;
            logState('Peacock ad break detected on tab ' + tabId +
                     ' (beacons: ' + tabState.beaconCount + ')');

            var syntheticSender = { tab: { id: tabId } };
            handleMuteRequest(syntheticSender, sourceId);
            resetPeacockAdTimeout(tabId, tabState);

        } else if (tabState.beaconCount === 1) {
            // First beacon -- record timestamp for threshold window
            tabState.firstBeaconTime = now;
        }
    }

    /**
     * Resets the timeout that will declare a Peacock ad break over.
     * Each new beacon pushes the timeout forward.
     * @param {number} tabId
     * @param {Object} tabState
     */
    function resetPeacockAdTimeout(tabId, tabState) {
        if (tabState.timeoutId !== null) {
            clearTimeout(tabState.timeoutId);
        }

        tabState.timeoutId = setTimeout(function() {
            onPeacockAdEnd(tabId);
        }, PEACOCK_CONFIG.AD_END_TIMEOUT_MS);
    }

    /**
     * Called when the ad-end timeout expires (no beacons for AD_END_TIMEOUT_MS).
     * Triggers unmute and resets per-tab state.
     * @param {number} tabId
     */
    function onPeacockAdEnd(tabId) {
        var tabState = peacockAdState.get(tabId);
        if (!tabState || !tabState.adActive) {
            return;
        }

        var sourceId = 'peacock-' + tabId;
        logState('Peacock ad break ended on tab ' + tabId +
                 ' (total beacons: ' + tabState.beaconCount + ')');

        tabState.adActive = false;
        tabState.timeoutId = null;
        tabState.beaconCount = 0;

        var syntheticSender = { tab: { id: tabId } };
        handleUnmuteRequest(syntheticSender, sourceId);
    }

    /**
     * Cleans up Peacock ad state when a tab is closed.
     * If an ad was active on the closed tab, triggers unmute.
     * @param {number} tabId
     */
    function cleanupPeacockTab(tabId) {
        var tabState = peacockAdState.get(tabId);
        if (!tabState) {
            return;
        }

        if (tabState.timeoutId !== null) {
            clearTimeout(tabState.timeoutId);
        }

        if (tabState.adActive) {
            var sourceId = 'peacock-' + tabId;
            logState('Peacock tab ' + tabId + ' closed during ad, triggering unmute');
            var syntheticSender = { tab: { id: tabId } };
            handleUnmuteRequest(syntheticSender, sourceId);
        }

        peacockAdState.delete(tabId);
    }

    // =========================================================================
    // Content Script Message Handling
    // =========================================================================

    /**
     * Handles messages from content scripts and popup
     * @param {Object} message - Message from content script or popup
     * @param {Object} sender - Sender information
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} True to indicate async response
     */
    function handleContentScriptMessage(message, sender, sendResponse) {
        log('Received message:', message);

        if (!message || !message.action) {
            log('Invalid message received, missing action');
            return false;
        }

        // Build source identifier from content script sender
        var contentSourceId = sender && sender.tab ? 'twitch-' + sender.tab.id : 'twitch-unknown';

        switch (message.action) {
            case 'mute':
                logState('Mute request received from content script (source: ' + contentSourceId + ')');
                handleMuteRequest(sender, contentSourceId);
                break;

            case 'unmute':
                logState('Unmute request received from content script (source: ' + contentSourceId + ')');
                handleUnmuteRequest(sender, contentSourceId);
                break;

            case 'getStatus':
                log('Requesting status from native host');
                sendCommandToNativeHost('getStatus');
                break;

            case 'getConnectionStatus':
                // Return current connection status to the popup
                sendResponse({
                    status: connectionState.currentStatus,
                    isConnected: connectionState.isConnected,
                    reconnectAttempts: connectionState.reconnectAttempts,
                    maxReconnectAttempts: RECONNECT_MAX_ATTEMPTS,
                    lastError: connectionState.lastError,
                    degradedMode: muteState.degradedMode,
                    extensionInitiatedMute: muteState.activeMuteSources.size > 0
                });
                return true;

            case 'retryConnection':
                // Reset reconnect state and attempt connection
                logState('Manual retry connection requested');
                connectionState.reconnectAttempts = 0;
                connectionState.lastError = null;
                muteState.failedOperations = 0;
                muteState.degradedMode = false;
                connectToNativeHost();
                sendResponse({ success: true });
                return true;

            case 'resetMuteState':
                // Allow manual reset of mute state tracking
                logState('Manual mute state reset requested');
                muteState.activeMuteSources.clear();
                muteState.pendingMuteCheck = false;
                muteState.pendingMuteSource = null;
                muteState.preMuteState = null;
                // Also reset all Peacock ad state
                peacockAdState.forEach(function(tabState) {
                    if (tabState.timeoutId !== null) {
                        clearTimeout(tabState.timeoutId);
                    }
                });
                peacockAdState.clear();
                sendResponse({ success: true });
                return true;

            default:
                log('Unknown action:', message.action);
        }

        return false;
    }

    // =========================================================================
    // Extension Lifecycle
    // =========================================================================

    /**
     * Handles extension installation or update
     * @param {Object} details - Installation details
     */
    function handleInstalled(details) {
        if (details.reason === 'install') {
            logState('Extension installed for the first time');
            logState('Please run the install script to set up native messaging');
        } else if (details.reason === 'update') {
            logState('Extension updated from version ' + details.previousVersion);
        }

        // Attempt to connect to native host
        connectToNativeHost();
    }

    /**
     * Handles browser startup
     */
    function handleStartup() {
        logState('Browser started, initializing native host connection');
        connectToNativeHost();
    }

    // =========================================================================
    // Initialization
    // =========================================================================

    /**
     * Sets up all event listeners and initializes the background script
     */
    function init() {
        logState('Background script initialized');

        // Register message listener for content scripts (Twitch)
        browser.runtime.onMessage.addListener(handleContentScriptMessage);

        // Register lifecycle event listeners
        browser.runtime.onInstalled.addListener(handleInstalled);
        browser.runtime.onStartup.addListener(handleStartup);

        // Register Peacock ad detection via webRequest
        browser.webRequest.onBeforeRequest.addListener(
            handlePeacockAdBeacon,
            { urls: PEACOCK_AD_URL_PATTERNS },
            []
        );

        // Clean up Peacock state when tabs close
        browser.tabs.onRemoved.addListener(cleanupPeacockTab);

        // Attempt initial connection to native host
        connectToNativeHost();
    }

    // Initialize the background script
    init();
})();

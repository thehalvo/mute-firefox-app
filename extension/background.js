/**
 * Mute - Background Script
 * Manages native host connection and message routing between content scripts
 * and the native messaging host for system audio control.
 */

(function() {
    'use strict';

    const NATIVE_HOST_NAME = 'com.twitchadmuter.host';
    const DEBUG = false;

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
     * Tracks mute state to prevent unmuting user-initiated mutes
     */
    const muteState = {
        // Whether the extension initiated the current mute
        extensionInitiatedMute: false,
        // Whether we're waiting for a status response before muting
        pendingMuteCheck: false,
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
                muteState.pendingMuteCheck = false;
                muteState.preMuteState = message.muted;

                if (message.muted) {
                    // System is already muted by user, do not override
                    logState('System already muted by user, skipping extension mute');
                    muteState.extensionInitiatedMute = false;
                } else {
                    // System is not muted, proceed with muting
                    logState('System not muted, proceeding with extension mute');
                    muteState.extensionInitiatedMute = true;
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
     * Handles mute request with user state preservation
     * First queries mute status, then only mutes if system is not already muted
     * @param {Object} sender - Sender information for tab mute fallback
     */
    function handleMuteRequest(sender) {
        // Track the tab for potential fallback
        if (sender && sender.tab) {
            muteState.activeTabId = sender.tab.id;
        }

        // Check if we're in degraded mode (too many failures)
        if (muteState.degradedMode || muteState.failedOperations >= muteState.maxFailedOperations) {
            logState('In degraded mode, using tab mute fallback');
            muteState.degradedMode = true;
            muteTabFallback(true);
            return;
        }

        // Check if native host is connected
        if (!connectionState.isConnected || !connectionState.port) {
            logState('Native host not connected, attempting connection and using tab mute fallback');
            connectToNativeHost();
            muteTabFallback(true);
            return;
        }

        // Query current mute status before muting
        logState('Checking system mute status before muting');
        muteState.pendingMuteCheck = true;
        sendCommandToNativeHost('getStatus');
    }

    /**
     * Handles unmute request with user state preservation
     * Only unmutes if the extension initiated the mute
     * @param {Object} sender - Sender information for tab mute fallback
     */
    function handleUnmuteRequest(sender) {
        // Handle tab mute fallback if we're in degraded mode
        if (muteState.degradedMode) {
            muteTabFallback(false);
            muteState.extensionInitiatedMute = false;
            return;
        }

        // Only unmute if we were the ones who muted
        if (!muteState.extensionInitiatedMute) {
            logState('Extension did not initiate mute, skipping unmute (preserving user mute state)');
            return;
        }

        // Check if native host is connected
        if (!connectionState.isConnected || !connectionState.port) {
            logState('Native host not connected, using tab unmute fallback');
            muteTabFallback(false);
            muteState.extensionInitiatedMute = false;
            return;
        }

        logState('Extension initiated mute detected, sending unmute command');
        sendCommandToNativeHost('unmute');
        muteState.extensionInitiatedMute = false;
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

        switch (message.action) {
            case 'mute':
                logState('Mute request received');
                handleMuteRequest(sender);
                break;

            case 'unmute':
                logState('Unmute request received');
                handleUnmuteRequest(sender);
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
                    extensionInitiatedMute: muteState.extensionInitiatedMute
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
                muteState.extensionInitiatedMute = false;
                muteState.pendingMuteCheck = false;
                muteState.preMuteState = null;
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

        // Register message listener for content scripts
        browser.runtime.onMessage.addListener(handleContentScriptMessage);

        // Register lifecycle event listeners
        browser.runtime.onInstalled.addListener(handleInstalled);
        browser.runtime.onStartup.addListener(handleStartup);

        // Attempt initial connection to native host
        connectToNativeHost();
    }

    // Initialize the background script
    init();
})();

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
        pendingMessages: []
    };

    // Reconnection configuration
    const RECONNECT_INITIAL_DELAY_MS = 1000;
    const RECONNECT_MAX_DELAY_MS = 30000;
    const RECONNECT_MAX_ATTEMPTS = 10;

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

        try {
            logState('Attempting to connect to native host: ' + NATIVE_HOST_NAME);

            connectionState.port = browser.runtime.connectNative(NATIVE_HOST_NAME);
            connectionState.isConnected = true;

            // Set up port event listeners
            setupPortListeners();

            logState('Native host connection established');
            resetReconnectState();

            // Process any pending messages
            processPendingMessages();

            return true;
        } catch (error) {
            logError('Failed to connect to native host:', error.message);
            connectionState.isConnected = false;
            connectionState.port = null;
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

        if (message.success !== undefined) {
            if (message.success) {
                log('Command executed successfully');
            } else {
                logError('Command failed:', message.error);
            }
        }

        if (message.muted !== undefined) {
            log('Current mute status:', message.muted);
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
        } else if (lastError) {
            logError('Native host disconnected:', lastError.message);
        } else {
            logState('Native host disconnected');
        }

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
     * Handles messages from content scripts
     * @param {Object} message - Message from content script
     * @param {Object} sender - Sender information
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} True to indicate async response
     */
    function handleContentScriptMessage(message, sender, sendResponse) {
        log('Received message from content script:', message);

        if (!message || !message.action) {
            log('Invalid message received, missing action');
            return false;
        }

        switch (message.action) {
            case 'mute':
                logState('Sending mute command to native host');
                sendCommandToNativeHost('mute');
                break;

            case 'unmute':
                logState('Sending unmute command to native host');
                sendCommandToNativeHost('unmute');
                break;

            case 'getStatus':
                log('Requesting status from native host');
                sendCommandToNativeHost('getStatus');
                break;

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

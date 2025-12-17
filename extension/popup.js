/**
 * Mute - Popup Script
 * Displays connection status and provides setup instructions
 */

(function() {
    'use strict';

    // DOM Elements
    const statusIndicator = document.getElementById('status-indicator');
    const errorSection = document.getElementById('error-section');
    const errorText = document.getElementById('error-text');
    const retryButton = document.getElementById('retry-button');
    const setupSection = document.getElementById('setup-section');
    const connectedSection = document.getElementById('connected-section');
    const degradedSection = document.getElementById('degraded-section');
    const exitDegradedButton = document.getElementById('exit-degraded-button');

    /**
     * Updates the UI based on connection status
     * @param {Object} status - Connection status from background script
     */
    function updateUI(status) {
        // Update status indicator
        statusIndicator.classList.remove('connected', 'disconnected', 'connecting', 'error');

        switch (status.status) {
            case 'connected':
                // Check if in degraded mode even when "connected"
                if (status.degradedMode) {
                    statusIndicator.textContent = 'Degraded';
                    statusIndicator.classList.add('disconnected');
                    showDegradedState(status);
                } else {
                    statusIndicator.textContent = 'Connected';
                    statusIndicator.classList.add('connected');
                    showConnectedState(status);
                }
                break;

            case 'connecting':
                statusIndicator.textContent = 'Connecting...';
                statusIndicator.classList.add('connecting');
                showConnectingState(status);
                break;

            case 'disconnected':
                statusIndicator.textContent = 'Disconnected';
                statusIndicator.classList.add('disconnected');
                showDisconnectedState(status);
                break;

            case 'error':
                statusIndicator.textContent = 'Error';
                statusIndicator.classList.add('error');
                showErrorState(status);
                break;

            default:
                statusIndicator.textContent = 'Unknown';
                statusIndicator.classList.add('error');
                showErrorState(status);
        }
    }

    /**
     * Shows the connected state UI
     * @param {Object} status - Connection status
     */
    function showConnectedState(status) {
        errorSection.classList.add('hidden');
        setupSection.classList.add('hidden');
        degradedSection.classList.add('hidden');
        connectedSection.classList.remove('hidden');
    }

    /**
     * Shows the connecting state UI
     * @param {Object} status - Connection status
     */
    function showConnectingState(status) {
        connectedSection.classList.add('hidden');
        setupSection.classList.add('hidden');
        degradedSection.classList.add('hidden');

        if (status.reconnectAttempts > 0) {
            errorSection.classList.remove('hidden');
            errorText.textContent = 'Attempting to connect... (attempt ' +
                status.reconnectAttempts + '/' + status.maxReconnectAttempts + ')';
            retryButton.disabled = true;
            retryButton.textContent = 'Connecting...';
        } else {
            errorSection.classList.add('hidden');
        }
    }

    /**
     * Shows the disconnected state UI
     * @param {Object} status - Connection status
     */
    function showDisconnectedState(status) {
        connectedSection.classList.add('hidden');
        degradedSection.classList.add('hidden');
        errorSection.classList.remove('hidden');

        if (status.lastError) {
            errorText.textContent = status.lastError;
        } else {
            errorText.textContent = 'Connection to native host lost.';
        }

        retryButton.disabled = false;
        retryButton.textContent = 'Retry Connection';

        // Show setup section if it looks like the host isn't installed
        if (status.reconnectAttempts >= status.maxReconnectAttempts) {
            setupSection.classList.remove('hidden');
        } else {
            setupSection.classList.add('hidden');
        }
    }

    /**
     * Shows the error state UI
     * @param {Object} status - Connection status
     */
    function showErrorState(status) {
        connectedSection.classList.add('hidden');
        degradedSection.classList.add('hidden');
        errorSection.classList.remove('hidden');
        setupSection.classList.remove('hidden');

        if (status.lastError) {
            errorText.textContent = status.lastError;
        } else {
            errorText.textContent = 'Native host not available. Please complete setup.';
        }

        retryButton.disabled = false;
        retryButton.textContent = 'Retry Connection';
    }

    /**
     * Shows the degraded mode UI
     * @param {Object} status - Connection status
     */
    function showDegradedState(status) {
        connectedSection.classList.add('hidden');
        errorSection.classList.add('hidden');
        setupSection.classList.add('hidden');
        degradedSection.classList.remove('hidden');
    }

    /**
     * Fetches the current connection status from the background script
     */
    function fetchStatus() {
        browser.runtime.sendMessage({ action: 'getConnectionStatus' })
            .then(function(response) {
                if (response) {
                    updateUI(response);
                }
            })
            .catch(function(error) {
                console.error('[Mute Popup] Failed to get status:', error);
                updateUI({
                    status: 'error',
                    lastError: 'Failed to communicate with extension.'
                });
            });
    }

    /**
     * Handles the retry button click
     */
    function handleRetryClick() {
        retryButton.disabled = true;
        retryButton.textContent = 'Retrying...';

        browser.runtime.sendMessage({ action: 'retryConnection' })
            .then(function() {
                // Wait a moment for the connection attempt to process
                setTimeout(fetchStatus, 500);
            })
            .catch(function(error) {
                console.error('[Mute Popup] Failed to retry:', error);
                retryButton.disabled = false;
                retryButton.textContent = 'Retry Connection';
            });
    }

    /**
     * Handles the exit degraded mode button click
     */
    function handleExitDegradedClick() {
        if (exitDegradedButton) {
            exitDegradedButton.disabled = true;
            exitDegradedButton.textContent = 'Reconnecting...';
        }

        browser.runtime.sendMessage({ action: 'retryConnection' })
            .then(function() {
                setTimeout(fetchStatus, 500);
            })
            .catch(function(error) {
                console.error('[Mute Popup] Failed to exit degraded mode:', error);
                if (exitDegradedButton) {
                    exitDegradedButton.disabled = false;
                    exitDegradedButton.textContent = 'Try Reconnecting';
                }
            });
    }

    /**
     * Initializes the popup
     */
    function init() {
        // Attach event listeners
        retryButton.addEventListener('click', handleRetryClick);

        if (exitDegradedButton) {
            exitDegradedButton.addEventListener('click', handleExitDegradedClick);
        }

        // Fetch initial status
        fetchStatus();

        // Periodically refresh status while popup is open
        setInterval(fetchStatus, 2000);
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

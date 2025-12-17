/**
 * Mute - Ad Detection Selectors
 *
 * This file contains all selectors and patterns used to detect Twitch ads.
 * Twitch frequently updates their DOM structure, so these selectors may need
 * periodic updates.
 *
 * CONTRIBUTING:
 * If you find that ad detection has stopped working, you can contribute
 * updated selectors by:
 * 1. Inspecting the Twitch player DOM when an ad is playing
 * 2. Identifying new selectors, class patterns, or text indicators
 * 3. Adding them to the appropriate array below
 * 4. Testing to verify detection works
 * 5. Submitting a pull request
 *
 * See CONTRIBUTING.md for detailed instructions.
 *
 * Last verified working: December 2024
 */

const AdSelectors = {
    /**
     * Version number for selector configuration
     * Increment when making changes to help track updates
     */
    version: '1.0.0',

    /**
     * Primary CSS selectors for ad-related elements
     * These are checked first and are the most reliable method
     * Add new selectors at the top of the array (checked in order)
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
     * CSS selectors for finding the video player container
     * Used to scope ad detection searches
     */
    playerContainerSelectors: [
        '[data-a-target="video-player"]',
        '.video-player',
        '[data-a-target="player-overlay-click-handler"]',
        '.persistent-player',
        '.video-player__container',
        '#video-player'
    ],

    /**
     * Regex patterns that match ad-related class names
     * Used as fallback when specific selectors fail
     * Patterns are case-insensitive
     */
    classPatterns: [
        /^video-ad/i,
        /^player-ad/i,
        /ad-overlay/i,
        /ad-banner/i,
        /ad-countdown/i
    ],

    /**
     * Data attribute prefixes that indicate ad content
     * Elements with attributes starting with these strings are flagged
     */
    dataAttributePatterns: [
        'data-ad-',
        'data-video-ad',
        'data-player-ad'
    ],

    /**
     * Video element attributes that may indicate ad playback
     */
    videoAttributes: [
        'data-ad-playing',
        'data-is-ad',
        'data-ad-state'
    ],

    /**
     * Player container attributes that may indicate ad state
     */
    containerAttributes: [
        'data-a-player-state',
        'data-player-type',
        'data-content-type'
    ],

    /**
     * Attribute values that indicate ad playback
     * If any attribute contains one of these values, it's flagged as an ad
     */
    adStateValues: [
        'ad',
        'advertisement',
        'commercial',
        'preroll',
        'midroll'
    ],

    /**
     * Text content that indicates an ad is playing
     * Used as last-resort fallback detection
     * These are checked via XPath text search
     */
    textIndicators: [
        'Ad playing',
        'Ad will end in',
        'Your video will resume'
    ],

    /**
     * Attributes to monitor for changes via MutationObserver
     * When these attributes change, ad detection is re-checked
     */
    monitoredAttributes: [
        'class',
        'data-a-target',
        'data-test-selector',
        'style'
    ]
};

// Make available for content script
if (typeof window !== 'undefined') {
    window.AdSelectors = AdSelectors;
}

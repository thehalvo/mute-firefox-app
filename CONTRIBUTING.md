# Contributing to Mute

Thank you for your interest in contributing to Mute. This project relies on community contributions to keep ad detection working as Twitch updates their player.

## Important: This Extension Mutes, It Does Not Block

Mute does **not** block advertisements. It mutes your system audio when ads play and unmutes when they end. This distinction matters:

- Ads still play and are visible
- Advertisers still receive impressions
- Twitch still receives ad revenue
- You just don't hear the audio during ads

This is intentional and by design.

## How Ad Detection Works

Mute uses multiple detection strategies in order of reliability:

1. **CSS Selectors** - Direct queries for ad-related elements
2. **Player State Attributes** - Checking video/container data attributes
3. **Class Name Patterns** - Regex matching against class names
4. **Data Attribute Patterns** - Checking for ad-related data attributes
5. **Text Content** - Looking for text like "Ad playing" (last resort)

When Twitch updates their player, one or more of these strategies may break.

## Contributing Updated Selectors

The most common contribution is updating selectors when Twitch changes their DOM.

### Step 1: Identify the Problem

1. Open a Twitch stream and wait for an ad
2. Open browser DevTools (F12)
3. Check the Console tab for `[Mute]` messages
4. If ads aren't being detected, the selectors need updating

### Step 2: Find Working Selectors

While an ad is playing:

1. Use the Elements inspector to examine the video player
2. Look for elements that only appear during ads
3. Note their:
   - CSS selectors (`[data-a-target="..."]`, `.class-name`, `#id`)
   - Class names that contain "ad" patterns
   - Data attributes related to ad state
   - Text content indicating an ad

**Tips for finding good selectors:**

- Elements with `data-a-target` or `data-test-selector` attributes are often stable
- Look for ad countdowns, banners, or overlay elements
- Check the video element and player container for state attributes
- Text content like "Ad will end in" is very stable but checked last

### Step 3: Update selectors.js

Edit `extension/selectors.js` and add your new selectors:

```javascript
// Add to the 'selectors' array (checked first, most reliable)
selectors: [
    '[data-a-target="your-new-selector"]',  // Add new selectors at top
    // ... existing selectors
],

// Add to 'classPatterns' array (regex patterns)
classPatterns: [
    /your-new-pattern/i,
    // ... existing patterns
],

// Add to 'textIndicators' array (text content search)
textIndicators: [
    'New ad text indicator',
    // ... existing indicators
],
```

### Step 4: Test Your Changes

1. Reload the extension in `about:debugging`
2. Navigate to a Twitch stream
3. Wait for an ad to verify detection works
4. Check the console for `[Mute] Ad detected via...` messages

### Step 5: Submit a Pull Request

1. Fork the repository
2. Create a branch: `git checkout -b fix/update-selectors`
3. Commit your changes with a descriptive message
4. Push and open a pull request

In your PR, please include:
- What was broken (which detection strategy failed)
- What you added to fix it
- Confirmation that you tested it with actual ads

## Selector Guidelines

**DO:**
- Add new selectors at the top of arrays (checked in order)
- Use specific selectors over generic ones
- Test with multiple streams and ad types
- Include the date you verified the selector works

**DON'T:**
- Remove old selectors unless confirmed permanently broken
- Use overly broad selectors that might match non-ad elements
- Guess at selectors without testing

## Other Contributions

### Bug Reports

When reporting bugs, include:
- Firefox version
- macOS version
- Console output (`[Mute]` messages)
- Steps to reproduce

### Feature Requests

Open an issue describing:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

### Code Contributions

For non-selector code changes:

1. Open an issue first to discuss the change
2. Follow existing code style
3. Test thoroughly
4. Update documentation if needed

## Development Setup

1. Clone the repository
2. Run `install/install.sh` to set up the native host
3. Load the extension in Firefox via `about:debugging`
4. Make changes and reload to test

Enable debug mode for verbose logging:
- `extension/content.js`: Set `DEBUG = true`
- `extension/background.js`: Set `DEBUG = true`

## Questions?

Open an issue if you need help or have questions about contributing.

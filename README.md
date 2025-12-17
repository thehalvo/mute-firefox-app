# Mute - Twitch Ad Muter

A Firefox extension that automatically mutes your Mac's system audio when Twitch displays advertisements, then unmutes when the ad ends.

## What This Extension Does (and Doesn't Do)

**This extension MUTES ads. It does NOT block them.**

- Ads still play and are fully visible
- Advertisers still receive impressions
- Twitch still receives ad revenue
- Your system audio is simply muted during the ad

This is a convenience tool for viewers who find ad audio disruptive, not an ad blocker.

## Maintenance Notice

Twitch periodically updates their video player DOM structure. When this happens, ad detection may stop working until selectors are updated. This is expected behavior, not a bug.

**If ad detection stops working:**
1. Check the [Issues](../../issues) page for known problems
2. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to help update selectors
3. Pull requests with updated selectors are welcome

The community keeps this extension working through contributions.

## How It Works

1. **Content Script** - Monitors the Twitch video player DOM for ad-related elements using multiple fallback detection strategies
2. **Background Script** - Routes mute/unmute commands to the native host and manages connection state
3. **Native Host** - A Python script that controls macOS system audio via AppleScript

When an ad is detected, system wide audio is muted. When the ad ends, audio is restored.

## Requirements

- **macOS** 10.15 (Catalina) or later
- **Firefox** 78 or later
- **Python 3** (usually pre-installed on macOS)

## Installation

### Step 1: Install the Native Messaging Host

```bash
cd /path/to/Mute/install
./install.sh
```

Verify the installation completed without errors.

### Step 2: Install the Firefox Extension

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" in the left sidebar
3. Click "Load Temporary Add-on..."
4. Navigate to the `extension` directory and select `manifest.json`
5. The extension icon should appear in your toolbar

### Step 3: Restart Firefox

Restart Firefox to ensure the native messaging connection is established.

## Verification

1. Click the Mute extension icon in your toolbar
2. The popup should display "Status: Connected"
3. Navigate to a live Twitch stream
4. When an ad plays, your system audio should mute
5. When the ad ends, your system audio should unmute

Check the browser console (F12 > Console) for `[Mute]` messages to verify operation.

## Troubleshooting

### "Status: Error" or "Setup Required"

**Native host not installed:**
```bash
ls ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/
```
You should see `com.twitchadmuter.host.json`. If not, re-run the install script.

**Path issues:**
If the project was moved after installation, re-run `install.sh`.

### Extension Not Detecting Ads

**Verify content script is running:**
1. Open browser console on a Twitch stream page
2. Look for `[Mute] Content script initializing` message

**Selectors may need updating:**
Twitch updates their player periodically. Check [Issues](../../issues) or see [CONTRIBUTING.md](CONTRIBUTING.md).

### System Audio Not Muting

**Check macOS permissions:**
1. System Settings > Privacy & Security > Accessibility
2. Ensure Terminal (or Python) has permission

**Test native host manually:**
```bash
echo '{"command":"mute"}' | python3 /path/to/native-host/twitch_ad_muter_host.py
```

### Connection Lost During Use

The extension automatically reconnects with exponential backoff. Click "Retry Connection" in the popup for manual reconnection.

## Debug Mode

Enable verbose logging:

1. **Content Script** - `extension/content.js`, set `DEBUG = true`
2. **Background Script** - `extension/background.js`, set `DEBUG = true`
3. **Native Host** - `native-host/twitch_ad_muter_host.py`, set `DEBUG = True`

Native host logs: `~/Library/Logs/TwitchAdMuter/host.log`

## Uninstall

**Remove native host:**
```bash
./install/uninstall.sh
```

**Remove extension:**
1. Navigate to `about:addons`
2. Find "Mute" and click Remove

## Privacy

This extension:
- Only activates on twitch.tv domains
- Does not collect any user data
- Does not transmit any information externally
- Only communicates between browser and local Python script
- Contains no analytics or tracking

All code runs locally on your machine.

## Known Limitations

1. **System-wide mute** - Mutes all system audio, not just Firefox
2. **Manual mute conflict** - If you manually mute during an ad, extension unmutes when ad ends
3. **Pre-muted state** - If system already muted when ad starts, remains muted after
4. **VOD ads** - May be less reliably detected than live stream ads
5. **Twitch Turbo/Prime** - Ad-free subscribers won't trigger the extension

## Contributing

Contributions are welcome, especially selector updates when Twitch changes their player.

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- How to update selectors when detection breaks
- Guidelines for submitting changes
- Development setup instructions

## Project Structure

```
Mute/
├── extension/
│   ├── manifest.json       # Extension configuration
│   ├── selectors.js        # Ad detection selectors (edit this to fix detection)
│   ├── content.js          # Ad detection logic
│   ├── background.js       # Native host communication
│   ├── popup.html/css/js   # Browser action popup
│   └── icons/
├── native-host/
│   └── twitch_ad_muter_host.py   # macOS audio control
├── install/
│   ├── install.sh          # Installation script
│   ├── uninstall.sh        # Removal script
│   └── com.twitchadmuter.host.json
├── CONTRIBUTING.md         # Contribution guidelines
└── README.md
```

## License

MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

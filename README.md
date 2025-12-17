# Mute - Twitch Ad Muter

A Firefox extension that automatically mutes your system audio when Twitch displays advertisements, then unmutes when the ad ends.

## How It Works

1. **Content Script** - Monitors the Twitch video player DOM for ad-related elements
2. **Background Script** - Routes mute/unmute commands from content scripts to the native host
3. **Native Host** - A Python script that controls macOS system audio via AppleScript

When an ad is detected on a Twitch stream, the extension mutes system-wide audio. When the ad ends, audio is restored.

## Requirements

- **macOS** - 10.15 (Catalina) or later
- **Firefox** - Version 78 or later
- **Python 3** - Usually pre-installed on macOS

## Installation

### Step 1: Install the Native Messaging Host

1. Open Terminal
2. Navigate to the project directory:
   ```bash
   cd /path/to/Mute/install
   ```
3. Run the install script:
   ```bash
   ./install.sh
   ```
4. Verify the installation completed without errors

### Step 2: Install the Firefox Extension

1. Open Firefox
2. Navigate to `about:debugging`
3. Click "This Firefox" in the left sidebar
4. Click "Load Temporary Add-on..."
5. Navigate to the `extension` directory and select `manifest.json`
6. The extension icon should appear in your toolbar

### Step 3: Restart Firefox

After installing both components, restart Firefox to ensure the native messaging connection is established.

## Verification

1. Click the Mute extension icon in your toolbar
2. The popup should display "Status: Connected"
3. Navigate to any live Twitch stream
4. When an ad plays, your system audio should mute
5. When the ad ends, your system audio should unmute

Check the browser console (F12 > Console) for `[Mute]` prefixed messages to verify operation.

## Troubleshooting

### "Status: Error" or "Setup Required" in Popup

**Native host not installed:**
1. Open Terminal
2. Run: `ls ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/`
3. You should see `com.twitchadmuter.host.json`
4. If not, re-run the install script

**Path issues:**
1. Open `~/Library/Application Support/Mozilla/NativeMessagingHosts/com.twitchadmuter.host.json`
2. Verify the `path` field points to an existing file
3. If the project was moved after installation, re-run `install.sh`

### Extension Not Detecting Ads

**Verify content script is running:**
1. Open browser console on a Twitch stream page
2. Look for `[Mute] Content script initializing` message
3. If not present, check that the extension is enabled

**DOM selectors may have changed:**
Twitch frequently updates their player. If detection stops working, the extension may need updated selectors.

### System Audio Not Muting

**Check macOS permissions:**
1. Go to System Settings > Privacy & Security > Accessibility
2. Ensure Terminal (or the Python interpreter) has permission
3. You may need to remove and re-add the permission

**Test the native host manually:**
```bash
echo '{"command":"mute"}' | python3 /path/to/native-host/twitch_ad_muter_host.py
```

### Connection Lost During Use

The extension automatically attempts to reconnect with exponential backoff. Click "Retry Connection" in the popup to manually attempt reconnection.

## Debug Mode

To enable verbose logging:

1. **Content Script** - Edit `extension/content.js`, set `DEBUG = true`
2. **Background Script** - Edit `extension/background.js`, set `DEBUG = true`
3. **Native Host** - Edit `native-host/twitch_ad_muter_host.py`, set `DEBUG = True`
4. Reload the extension

Debug logs for the native host are written to:
`~/Library/Logs/TwitchAdMuter/host.log`

## Uninstall

### Remove Native Messaging Host

```bash
rm ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/com.twitchadmuter.host.json
```

Or run the uninstall script:
```bash
./install/uninstall.sh
```

### Remove Firefox Extension

1. Navigate to `about:addons`
2. Find "Mute" in the extensions list
3. Click the three-dot menu and select "Remove"

## Privacy

This extension:
- **Only activates** on twitch.tv domains
- **Does not collect** any user data
- **Does not transmit** any information to external servers
- **Only communicates** between the browser and a local Python script on your machine
- **No analytics** or tracking of any kind

All code runs locally on your machine.

## Known Limitations

1. **System-wide mute** - The extension mutes all system audio, not just Firefox. Other applications will also be muted during ads.

2. **Manual mute conflict** - If you manually mute during an ad, the extension will unmute when the ad ends.

3. **Pre-muted state** - If your system is already muted when an ad starts, it will remain muted after the ad ends (the extension does not track prior state).

4. **Twitch DOM changes** - Twitch may update their player DOM structure, which could break ad detection. Updates may be required.

5. **No VOD ad timing** - VOD ads may not be detected as reliably as live stream ads.

6. **Twitch Turbo/Prime users** - Users with ad-free subscriptions won't see ads, so the extension won't activate.

7. **Theater/Fullscreen modes** - Detection generally works in these modes, but DOM structure differences may occasionally cause issues.

## Project Structure

```
Mute/
├── extension/
│   ├── manifest.json       # Extension configuration
│   ├── content.js          # Ad detection logic
│   ├── background.js       # Native host communication
│   ├── popup.html          # Browser action popup
│   ├── popup.css           # Popup styles
│   ├── popup.js            # Popup logic
│   └── icons/
│       ├── icon-48.png
│       └── icon-96.png
├── native-host/
│   └── twitch_ad_muter_host.py   # macOS audio control
├── install/
│   ├── install.sh          # Installation script
│   ├── uninstall.sh        # Removal script
│   └── com.twitchadmuter.host.json  # Manifest template
└── README.md
```

## License

This project is provided as-is for personal use.

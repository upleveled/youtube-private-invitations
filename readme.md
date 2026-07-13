# YouTube Private Invitations

> Browser extension to quickly invite emails to private YouTube videos

## Manual Use

Install dependencies:

```bash
pnpm install
```

Build the Chrome MV3 extension:

```bash
pnpm build
```

Load the extension in Chrome:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select `.output/chrome-mv3`

Test the manual workflow:

1. Open YouTube Studio
2. Go to Content
3. Select one or more private videos
4. Click `Share privately` in the bulk-actions toolbar
5. Add emails to `Add invitees`, `Remove invitees`, or both
6. Click Apply
7. Wait for the status message to finish applying invitees

The extension applies the same add/remove changes to every selected video, disables notification emails, and waits 1-3 seconds between videos.

## Development

```bash
pnpm dev
```

Build and zip the extension:

```bash
pnpm build
pnpm zip
```

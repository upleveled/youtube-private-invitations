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
5. If YouTube's native dialog opens, add invitee emails and click Done
6. If the fallback dialog opens, paste one email per line and click Apply
7. Wait for the status message to finish applying invitees

The extension applies the same invitee list to every selected video, disables notification emails, and waits 1-3 seconds between videos.

If the native dialog cannot be captured, the extension shows a minimal email-entry dialog and applies those emails to all selected videos.

## Troubleshooting

If `Share privately` is missing, select at least one video in Studio's Content list and reload Studio.

If the extension reports that it cannot open the private-share dialog, test with one private video first. The selected row must expose Studio's visibility control or a native `Share privately` action.

## Development

```bash
pnpm dev
```

Build and zip the extension:

```bash
pnpm build
pnpm zip
```

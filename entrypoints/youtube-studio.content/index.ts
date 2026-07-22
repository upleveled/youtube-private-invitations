/// <reference types="wxt/vite-builder-env" />

import { defineContentScript } from 'wxt/utils/define-content-script';
import { injectScript } from 'wxt/utils/inject-script';
import './style.css';

// Inject youtube-studio-main.ts into the MAIN world, where it can patch Studio's own fetch/XHR.
// This isolated launcher carries the stylesheet, which the browser injects regardless of world.
export default defineContentScript({
  matches: ['https://studio.youtube.com/*'],
  runAt: 'document_start',
  async main() {
    await injectScript('/youtube-studio-main.js', { keepInDom: true });
  },
});

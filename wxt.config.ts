import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'YouTube Private Invitations',
    description:
      'Bulk-apply private YouTube video invitations from YouTube Studio',
    host_permissions: ['https://studio.youtube.com/*'],
    // injectScript loads youtube-studio-main.js into the page, so it must be web-accessible
    web_accessible_resources: [
      {
        resources: ['youtube-studio-main.js'],
        matches: ['https://studio.youtube.com/*'],
      },
    ],
  },
});

import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'YouTube Private Invitations',
    description:
      'Bulk-apply private YouTube video invitations from YouTube Studio',
    host_permissions: ['https://studio.youtube.com/*'],
  },
});

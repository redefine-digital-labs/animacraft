import { defineConfig } from 'vite';

// Only the fresh-v8 runtime lock is copied to production. Historical creator
// fixtures remain in the repository for archaeology but are never public
// assets or fallback product data.
export default defineConfig({
  publicDir: 'public-v8',
});

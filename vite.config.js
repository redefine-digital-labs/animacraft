import { defineConfig } from 'vite';
import { browserBackendRetirementPlugin } from './scripts/browser-backend-retirement-guard.mjs';

// Only the fresh-v8 runtime lock is copied to production. No other repository
// path is a public asset source.
export default defineConfig({
  publicDir: 'public-v8',
  plugins: [browserBackendRetirementPlugin()],
});

import { defineConfig } from 'vite';

// Only the fresh-v8 runtime lock is copied to production. No other repository
// path is a public asset source.
export default defineConfig({
  publicDir: 'public-v8',
});

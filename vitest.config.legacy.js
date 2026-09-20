import { defineConfig } from 'vitest/config';
import base from './vitest.config.js';

/* The same suites, driven against the monolith rather than the migrated tree. */
export default defineConfig({
  ...base,
  test: { ...base.test, env: { PLY_TARGET: 'legacy' } }
});

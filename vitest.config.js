import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    include: ['test/suites/**/*.test.js'],
    isolate: true,
    pool: 'forks',
    restoreMocks: true
  }
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.mjs'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['lib/**/*.mjs']
    }
  }
});

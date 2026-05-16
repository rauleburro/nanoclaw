import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['agent-skills/**/tests/*.test.ts'],
    passWithNoTests: true,
  },
});

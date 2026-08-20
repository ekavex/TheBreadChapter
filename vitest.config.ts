import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration suites talk to a real Postgres and must not run concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})

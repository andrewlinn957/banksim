import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/banksim/' : '/',
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: { charts: ['chart.js', 'react-chartjs-2'] } } } },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    includeSource: ['src/engine/simulationTestSuite.ts'],
  },
}));

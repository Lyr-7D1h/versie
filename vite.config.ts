import { resolve } from 'path'
import dts from 'unplugin-dts/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [dts({ bundleTypes: true })],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'versie',
      formats: ['es', 'cjs'],
      fileName: (format) => `versie.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      external: ['fast-diff', 'lru-cache', 'typescript-result', 'zod'],
    },
    sourcemap: true,
  },
})

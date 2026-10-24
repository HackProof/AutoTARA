import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { drawioAssets } from './build/drawioAssets.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools(), drawioAssets()],
  server: {
    proxy: {
      '/api/simulations': 'http://127.0.0.1:8000',
      '/api': 'http://127.0.0.1:3000',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

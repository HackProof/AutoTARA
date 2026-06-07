import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

const viteHost = process.env.VITE_HOST || '127.0.0.1'
const vitePort = Number(process.env.VITE_PORT || 8080)
const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
    server: {
        host: viteHost,
        port: vitePort,
        proxy: {
            '/api': {
                target: proxyTarget,
                changeOrigin: true,
            },
        }
    },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})

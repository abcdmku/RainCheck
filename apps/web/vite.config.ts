import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const internalApiBaseUrl =
  process.env.RAINCHECK_INTERNAL_API_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://localhost:3001'

const publicApiBaseUrl =
  process.env.RAINCHECK_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? ''

const config = defineConfig({
  define: {
    __RAINCHECK_API_BASE_URL__: JSON.stringify(publicApiBaseUrl),
  },
  plugins: [
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  server: {
    proxy: {
      '/api': {
        target: internalApiBaseUrl,
        changeOrigin: true,
      },
    },
  },
})

export default config

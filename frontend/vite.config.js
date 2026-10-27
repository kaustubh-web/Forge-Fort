import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Must match CORS_ORIGIN in backend/.env. strictPort makes Vite fail loudly
    // instead of silently moving to 5174 (which the backend would block).
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      // "@/components/x" resolves to src/components/x (shadcn relies on this)
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

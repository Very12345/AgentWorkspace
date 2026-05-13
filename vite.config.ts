import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  base: '/AgentWorkspace',   // 添加这一行
  build: {
    sourcemap: 'hidden',
  },
  plugins: [
    react(),
    tsconfigPaths()
  ],
})
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/axmed-chat-widget/' : '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
});

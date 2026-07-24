import { defineConfig } from 'vite';

// base: './' produces relative asset paths so the built site works when
// uploaded into any subdirectory on xneelo shared hosting (public_html/typer, etc.)
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2019',
  },
});

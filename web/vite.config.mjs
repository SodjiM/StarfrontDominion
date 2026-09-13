import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';
const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: webRoot,
  plugins: [
    react(),
    {
      name: 'local-game-entry',
      configureServer(server) {
        // The game client and its authenticated API share the Node server's origin.
        server.middlewares.use((req, res, next) => {
          const requestUrl = new URL(req.url || '/', 'http://localhost');
          if (requestUrl.pathname !== '/play') return next();
          const destination = new URL(`http://${req.headers.host || 'localhost:5173'}`);
          destination.port = process.env.GAME_SERVER_PORT || '3000';
          destination.pathname = '/play';
          destination.search = requestUrl.search;
          res.writeHead(302, { Location: destination.toString() });
          res.end();
        });
      },
    },
  ],
  build: {
    outDir: path.resolve(webRoot, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});



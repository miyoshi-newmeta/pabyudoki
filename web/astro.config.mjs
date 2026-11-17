import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwind from '@astrojs/tailwind';

// ローカル版は Node で動かす（本番は Cloudflare Pages + Workers）
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [tailwind()],
});

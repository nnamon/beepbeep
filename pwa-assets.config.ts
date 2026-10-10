import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Run once (in the dev container) to regenerate icons from public/icon.svg:
//   docker compose run --rm dev npx pwa-assets-generator
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#0F1113' }, padding: 0.3 },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#0F1113' }, padding: 0.3 },
  },
  images: ['public/icon.svg'],
});

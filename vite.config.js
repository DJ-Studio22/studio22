import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, readdirSync, statSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const gamesDir = resolve(__dirname, 'games')

// Discover every games/<folder>/index.html automatically. Adding a new game
// means creating a folder with an index.html inside it — nothing here needs
// to change.
function findGameEntries() {
  const entries = {}
  if (!existsSync(gamesDir)) return entries

  for (const name of readdirSync(gamesDir)) {
    const gameDir = resolve(gamesDir, name)
    if (!statSync(gameDir).isDirectory()) continue

    const entryHtml = resolve(gameDir, 'index.html')
    if (existsSync(entryHtml)) {
      entries[`games/${name}/index`] = entryHtml
    }
  }
  return entries
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        arcade: resolve(__dirname, 'arcade.html'),
        about: resolve(__dirname, 'about.html'),
        party: resolve(__dirname, 'party.html'),
        ...findGameEntries(),
      },
    },
  },
})

import react from '@vitejs/plugin-react'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { renderSw } from './src/sw/precache.ts'

/** Arquivos de um diretório (recursivo), caminhos relativos com "/". */
function listar(dir: string, pref = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? listar(join(dir, d.name), `${pref}${d.name}/`) : [`${pref}${d.name}`],
  )
}

/** Gera sw.js no build com o app shell (HTML, chunks, assets e public/). */
function swPlugin(): Plugin {
  let publicDir = ''
  return {
    name: 'chordplanner-sw',
    apply: 'build',
    configResolved(c) {
      publicDir = c.publicDir
    },
    generateBundle(_, bundle) {
      // o HTML é emitido por outro plugin, possivelmente depois deste hook: entra explicitamente
      const arquivos = [...Object.keys(bundle), 'index.html']
      try {
        arquivos.push(...listar(publicDir))
      } catch {
        // sem public/
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: renderSw(arquivos) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), swPlugin()],
})

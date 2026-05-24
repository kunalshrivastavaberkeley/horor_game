import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const MAX_BACKUPS = 30

function timestamp() {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    '_',
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join('')
}

/** Write file to disk, creating a timestamped backup first. */
function safeSave(targetPath, json) {
  const backupDir = path.join(path.dirname(targetPath), 'backups')
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })

  const base = path.basename(targetPath, '.json')

  // Backup existing file before overwriting
  if (fs.existsSync(targetPath)) {
    const dest = path.join(backupDir, `${base}_${timestamp()}.json`)
    try { fs.copyFileSync(targetPath, dest) } catch {}

    // Prune oldest backups for this file, keeping MAX_BACKUPS
    const pattern = new RegExp(`^${base}_\\d{8}_\\d{6}\\.json$`)
    const existing = fs.readdirSync(backupDir)
      .filter(f => pattern.test(f))
      .sort()
    for (const old of existing.slice(0, Math.max(0, existing.length - MAX_BACKUPS))) {
      try { fs.unlinkSync(path.join(backupDir, old)) } catch {}
    }
  }

  fs.writeFileSync(targetPath, json)
}

function makeSaveRoute(server, route, filename) {
  server.middlewares.use(route, (req, res) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        JSON.parse(body)   // validate before touching disk
        const outPath = path.resolve(__dirname, 'data', filename)
        safeSave(outPath, JSON.stringify(JSON.parse(body), null, 2))
        res.statusCode = 200
        res.end('ok')
      } catch (e) {
        res.statusCode = 400
        res.end('bad json')
      }
    })
  })
}

export default defineConfig({
  optimizeDeps: {
    exclude: ['@recast-navigation/core', '@recast-navigation/wasm'],
  },
  plugins: [
    {
      name: 'dev-save',
      configureServer(server) {
        makeSaveRoute(server, '/dev/save-spatial', 'spatial.json')
        makeSaveRoute(server, '/dev/save-zones',   'zones.json')
        makeSaveRoute(server, '/dev/save-tags',    'tags.json')
        makeSaveRoute(server, '/dev/save-map',     'map_data.json')

        // Save a named camera path to data/paths/{name}.json
        server.middlewares.use('/dev/save-path', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const name = data.name
              if (!name || !/^[\w-]+$/.test(name)) { res.statusCode = 400; res.end('bad name'); return }
              const dir = path.resolve(__dirname, 'data', 'paths')
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
              safeSave(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2))
              res.statusCode = 200
              res.end('ok')
            } catch {
              res.statusCode = 400
              res.end('bad json')
            }
          })
        })

        // List all saved path names
        server.middlewares.use('/dev/list-paths', (req, res) => {
          if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
          const dir = path.resolve(__dirname, 'data', 'paths')
          if (!fs.existsSync(dir)) { res.setHeader('Content-Type', 'application/json'); res.end('[]'); return }
          const names = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json') && !fs.statSync(path.join(dir, f)).isDirectory())
            .map(f => f.replace(/\.json$/, ''))
            .filter(n => /^[\w-]+$/.test(n))
            .sort()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(names))
        })

        // Delete a named path
        server.middlewares.use('/dev/delete-path', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => {
            try {
              const { name } = JSON.parse(body)
              if (!name || !/^[\w-]+$/.test(name)) { res.statusCode = 400; res.end('bad name'); return }
              const filePath = path.resolve(__dirname, 'data', 'paths', `${name}.json`)
              if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
              res.statusCode = 200; res.end('ok')
            } catch { res.statusCode = 400; res.end('bad json') }
          })
        })

        // Serve data/paths/{name}.json for CutscenePlayer to fetch at runtime
        server.middlewares.use('/data/paths/', (req, res) => {
          const name = req.url.replace(/^\//, '').replace(/\.json$/, '')
          if (!/^[\w-]+$/.test(name)) { res.statusCode = 400; res.end(); return }
          const filePath = path.resolve(__dirname, 'data', 'paths', `${name}.json`)
          if (!fs.existsSync(filePath)) { res.statusCode = 404; res.end('{}'); return }
          res.setHeader('Content-Type', 'application/json')
          res.end(fs.readFileSync(filePath, 'utf8'))
        })
      }
    }
  ]
})

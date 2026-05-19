import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    {
      name: 'zone-editor-save',
      configureServer(server) {
        server.middlewares.use('/dev/save-zones', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => {
            try {
              const zones = JSON.parse(body)
              const outPath = path.resolve(__dirname, 'data/zones.json')
              fs.writeFile(outPath, JSON.stringify(zones, null, 2), err => {
                if (err) { res.statusCode = 500; res.end('write failed'); return }
                res.statusCode = 200
                res.end('ok')
              })
            } catch (e) {
              res.statusCode = 400; res.end('bad json')
            }
          })
        })

        server.middlewares.use('/dev/save-tags', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const outPath = path.resolve(__dirname, 'data/tags.json')
              fs.writeFile(outPath, JSON.stringify(data, null, 2), err => {
                if (err) { res.statusCode = 500; res.end('write failed'); return }
                res.statusCode = 200
                res.end('ok')
              })
            } catch (e) {
              res.statusCode = 400; res.end('bad json')
            }
          })
        })

        server.middlewares.use('/dev/save-spatial', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const outPath = path.resolve(__dirname, 'data/spatial.json')
              fs.writeFile(outPath, JSON.stringify(data, null, 2), err => {
                if (err) { res.statusCode = 500; res.end('write failed'); return }
                res.statusCode = 200
                res.end('ok')
              })
            } catch (e) {
              res.statusCode = 400; res.end('bad json')
            }
          })
        })

        server.middlewares.use('/dev/save-map', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const outPath = path.resolve(__dirname, 'data/map_data.json')
              fs.writeFile(outPath, JSON.stringify(data, null, 2), err => {
                if (err) { res.statusCode = 500; res.end('write failed'); return }
                res.statusCode = 200
                res.end('ok')
              })
            } catch (e) {
              res.statusCode = 400; res.end('bad json')
            }
          })
        })
      }
    }
  ]
})

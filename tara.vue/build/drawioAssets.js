import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const drawioRoot = fileURLToPath(new URL('../../drawio/', import.meta.url))
const webappRoot = join(drawioRoot, 'src/main/webapp')

// Share the same files between the dev server, production builds and model tests.
export async function getDrawioAssets() {
  const assets = new Map([
    ['mxgraph/mxClient.js', join(webappRoot, 'mxgraph/mxClient.js')],
    ['pako.min.js', join(webappRoot, 'js/deflate/pako.min.js')],
    ['purify.min.js', join(webappRoot, 'js/sanitizer/purify.min.js')],
    ['LICENSE', join(drawioRoot, 'LICENSE')],
  ])

  async function addDirectory(relativePath) {
    for (const entry of await readdir(join(webappRoot, relativePath), { withFileTypes: true })) {
      const assetPath = `${relativePath}/${entry.name}`
      if (entry.isDirectory()) await addDirectory(assetPath)
      else if (entry.isFile()) assets.set(assetPath, join(webappRoot, assetPath))
    }
  }

  try {
    await addDirectory('mxgraph/css')
    await addDirectory('mxgraph/images')
    for (const file of assets.values()) {
      if (!(await stat(file)).isFile()) throw new Error(`Not a file: ${file}`)
    }
  } catch (cause) {
    throw new Error(
      `Could not load draw.io assets from ${drawioRoot}. Restore the drawio source folder next to tara.vue (see README.md).`,
      { cause },
    )
  }

  return assets
}

const contentTypes = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

export function drawioAssets() {
  let assets
  let publicPath

  return {
    name: 'autotara-drawio-assets',
    async configResolved(config) {
      assets = await getDrawioAssets()
      publicPath = `${config.base}vendor/drawio/`
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?')[0]
        if (!pathname?.startsWith(publicPath)) return next()
        if (request.method !== 'GET' && request.method !== 'HEAD') return next()

        // Only serve manifest entries; request paths never become filesystem paths.
        const assetPath = pathname.slice(publicPath.length)
        const sourcePath = assets.get(assetPath)
        if (!sourcePath) {
          response.statusCode = 404
          response.end('draw.io asset not found')
          return
        }

        try {
          const source = await readFile(sourcePath)
          response.setHeader(
            'Content-Type',
            contentTypes[extname(assetPath)] || 'text/plain; charset=utf-8',
          )
          response.setHeader('Content-Length', source.length)
          response.end(request.method === 'HEAD' ? undefined : source)
        } catch (error) {
          next(error)
        }
      })
    },
    async generateBundle() {
      for (const [assetPath, sourcePath] of assets) {
        this.emitFile({
          type: 'asset',
          fileName: `vendor/drawio/${assetPath}`,
          source: await readFile(sourcePath),
        })
      }
    },
  }
}

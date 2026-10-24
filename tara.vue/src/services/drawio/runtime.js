import { registerDrawioShapes } from './shapes.js'

let runtimePromise

function loadElement(element) {
  return new Promise((resolve, reject) => {
    element.onload = () => resolve()
    element.onerror = () => {
      element.remove()
      reject(new Error('The diagram editor could not be loaded. Please try again.'))
    }
    document.head.appendChild(element)
  })
}

async function loadScript(src) {
  const script = document.createElement('script')
  script.src = src
  await loadElement(script)
}

export function loadDrawioRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const base = `${import.meta.env.BASE_URL}vendor/drawio/`
      if (!document.querySelector('link[data-autotara-drawio]')) {
        const stylesheet = document.createElement('link')
        stylesheet.rel = 'stylesheet'
        stylesheet.href = `${base}mxgraph/css/common.css`
        stylesheet.dataset.autotaraDrawio = ''
        await loadElement(stylesheet)
      }

      if (!window.mxGraph) {
        window.mxBasePath = `${base}mxgraph`
        window.mxImageBasePath = `${base}mxgraph/images`
        window.mxLoadResources = false
        window.mxLoadStylesheets = false
        window.mxLanguage = 'en'
        await loadScript(`${base}mxgraph/mxClient.js`)
      }
      if (!window.pako) await loadScript(`${base}pako.min.js`)
      if (!window.DOMPurify) await loadScript(`${base}purify.min.js`)

      if (!window.mxGraph || !window.mxCodec || !window.pako || !window.DOMPurify) {
        throw new Error('The diagram editor runtime is incomplete. Reload the page to try again.')
      }

      // Match draw.io's codec restrictions; imported XML is data, never executable code.
      window.mxCodec.allowlist = [
        'mxGraphModel',
        'mxCell',
        'mxGeometry',
        'mxPoint',
        'mxRectangle',
        'Array',
      ]
      window.mxObjectCodec.allowEval = false
      window.mxStencil.allowEval = false
      registerDrawioShapes(window)
      return window
    })().catch((error) => {
      runtimePromise = null
      throw error
    })
  }
  return runtimePromise
}

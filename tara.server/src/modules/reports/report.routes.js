import { Router } from 'express'
import { createReportService } from './report.service.js'
import { ReportError } from './report.validation.js'

export function createReportRouter({ service = createReportService() } = {}) {
  const router = Router()
  for (const action of ['generate', 'verify', 'preview']) {
    router.post(`/${action}`, async (req, res) => {
      const controller = new AbortController()
      const cancel = () => {
        if (!res.writableEnded) controller.abort()
      }
      res.on('close', cancel)
      const streaming = action !== 'preview' && req.get('accept')?.includes('text/event-stream')
      let heartbeat
      const send = (event) => {
        if (!controller.signal.aborted && !res.writableEnded)
          res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      try {
        if (streaming) {
          res.set({
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
          })
          res.flushHeaders()
          send({ type: 'status', status: 'preparing' })
          heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10000)
        }
        let result
        if (action === 'preview')
          result = await service.preview(
            req.body?.action,
            req.body?.input,
            req.body?.draft,
            req.body?.stream === true,
          )
        else if (action === 'generate')
          result = await service.generate(
            req.body?.input,
            controller.signal,
            streaming ? send : undefined,
          )
        else
          result = await service.verify(
            req.body?.input,
            req.body?.draft,
            controller.signal,
            streaming ? send : undefined,
          )
        if (!controller.signal.aborted) {
          if (streaming) {
            send({ type: 'result', result })
            res.end()
          } else res.json(result)
        }
      } catch (error) {
        if (controller.signal.aborted) return
        const status = error instanceof ReportError ? error.status : 500
        const message =
          error instanceof ReportError
            ? error.message
            : 'Unable to create the scenario report. Please retry.'
        if (streaming) {
          send({ type: 'error', error: message, status })
          res.end()
        } else res.status(status).json({ error: message })
      } finally {
        clearInterval(heartbeat)
        res.off('close', cancel)
      }
    })
  }
  return router
}

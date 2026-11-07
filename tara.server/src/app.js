import express from 'express'
import { errorHandler } from './middlewares/errorHandler.js'
import { createCatalogRouter } from './modules/catalog/catalog.routes.js'
import { createReportRouter } from './modules/reports/report.routes.js'

export function createApp({ database, reportService }) {
  const app = express()
  app.use(express.json({ limit: '256kb' }))
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend server is running' })
  })
  app.use('/api/v1/lang-schemas', createCatalogRouter({ database }))
  app.use('/api/v1/reports', createReportRouter({ service: reportService }))
  app.use(errorHandler)
  return app
}

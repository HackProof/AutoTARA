import express from 'express'
import { errorHandler } from './middlewares/errorHandler.js'
import { createCatalogRouter } from './modules/catalog/catalog.routes.js'

export function createApp({ database }) {
  const app = express()
  app.use(express.json({ limit: '256kb' }))
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend server is running' })
  })
  app.use('/api/v1/lang-schemas', createCatalogRouter({ database }))
  app.use(errorHandler)
  return app
}

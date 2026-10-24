export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error)
  if (error.status === 400) return res.status(400).json({ error: 'Invalid request body.' })
  if (error.status === 404) return res.status(404).json({ error: error.message })
  console.error('Unable to load language catalog:', error.code || error.name)
  res.status(503).json({
    error:
      'Unable to load the language catalog. Check the database connection and catalog initialization.',
  })
}

import { createApp } from './app.js'
import { createDatabasePool } from './config/db.js'
import { config } from './config/env.js'

const pool = createDatabasePool()
const server = createApp({ database: pool }).listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => pool.end()))
}

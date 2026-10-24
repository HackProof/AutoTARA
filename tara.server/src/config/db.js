import pg from 'pg'
import { config } from './env.js'

export function createDatabasePool() {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  })
}

import { readFile } from 'node:fs/promises'
import { createDatabasePool } from '../src/config/db.js'

const pool = createDatabasePool()
const db = await pool.connect()
try {
  const sql = await readFile(
    new URL('../../db/sql/07-step-semantics.sql', import.meta.url), 'utf8',
  )
  await db.query('BEGIN')
  await db.query(sql)
  const { rows } = await db.query(`
    SELECT language, semantic_category, count(*)::int AS total,
           count(*) FILTER (WHERE mapping_status = 'mapped')::int AS mapped,
           count(*) FILTER (WHERE mapping_status = 'unmapped')::int AS unmapped
    FROM vehicle_lang.v_attack_step_semantics
    GROUP BY language, semantic_category ORDER BY language, semantic_category
  `)
  await db.query('COMMIT')
  console.log(JSON.stringify({ steps: rows.reduce((sum, row) => sum + row.total, 0), groups: rows }))
} catch (error) {
  await db.query('ROLLBACK')
  throw error
} finally {
  db.release()
  await pool.end()
}

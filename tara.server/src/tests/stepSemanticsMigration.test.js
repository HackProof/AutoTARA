import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createDatabasePool } from '../config/db.js'
import { getAttackSteps } from '../modules/catalog/catalog.service.js'

test('catalog joins reviewed semantics only when the optional schema contract is available', async () => {
  const metadata = {
    attack_step_id: 'VehicleLang:ECU.connect', asset: 'ECU', name: 'connect',
    semantic_category: 'attack_attempt', classification_reason: '연결 시도',
    mitre_unmapped_reason: '후속 공격 문맥 필요', technique_mappings: [],
  }
  const db = { async query(sql, params) {
    if (sql.includes('information_schema.columns'))
      return { rows: [{ schema: 'vehicle_lang', has_step_semantics: true }] }
    if (!params) return { rows: [] }
    assert.match(sql, /LEFT JOIN "vehicle_lang"\.attack_step_semantics/)
    assert.match(sql, /CASE WHEN jsonb_array_length/)
    assert.deepEqual(params, [['ECU']])
    return { rows: [metadata] }
  } }
  const [result] = await getAttackSteps(db, 'vehicle_lang', ['ECU'])
  assert.equal(result.semantic_category, metadata.semantic_category)
  assert.equal(result.mitre_unmapped_reason, metadata.mitre_unmapped_reason)
})

test('CSV semantics seed is complete, idempotent and keeps absent reasons unknown', {
  skip: process.env.STEP_SEMANTICS_DB_TESTS !== '1',
}, async () => {
  const schema = `step_semantics_test_${process.pid}`
  const source = `${schema}_source`
  const sql = (await readFile(new URL('../../../db/sql/07-step-semantics.sql', import.meta.url), 'utf8'))
    .replaceAll('vehicle_lang_source.', `${source}.`).replaceAll('vehicle_lang.', `${schema}.`)
  const pool = createDatabasePool()
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query(`CREATE SCHEMA ${schema}; CREATE SCHEMA ${source}`)
    await db.query(`CREATE TABLE ${source}.mal_attack_steps AS TABLE vehicle_lang_source.mal_attack_steps;
      CREATE TABLE ${schema}.technique_mapping AS TABLE vehicle_lang.technique_mapping;
      CREATE TABLE ${schema}.attack_step_semantics (LIKE vehicle_lang.attack_step_semantics INCLUDING ALL)`)
    await db.query(sql)
    await db.query(sql)
    const { rows: [counts] } = await db.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE mapping_status_at_review='mapped')::int AS mapped,
      count(*) FILTER (WHERE classification_reason IS NULL AND mitre_unmapped_reason IS NULL)::int AS unknown
      FROM ${schema}.attack_step_semantics`)
    assert.deepEqual(counts,{ total: 233,mapped: 66,unknown: 233 })
    await db.query('SAVEPOINT invalid_category')
    await assert.rejects(db.query(`UPDATE ${schema}.attack_step_semantics SET semantic_category='guessed'`),{ code: '23514' })
    await db.query('ROLLBACK TO SAVEPOINT invalid_category')
    await db.query(`UPDATE ${schema}.attack_step_semantics SET classification_reason='Manual review' WHERE attack_step_id='VehicleLang:ECU.connect'`)
    await db.query(sql)
    const { rows: [retained] } = await db.query(`SELECT classification_reason FROM ${schema}.attack_step_semantics WHERE attack_step_id='VehicleLang:ECU.connect'`)
    assert.equal(retained.classification_reason,'Manual review')
  } finally {
    await db.query('ROLLBACK')
    db.release()
    await pool.end()
  }
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createDatabasePool } from '../config/db.js'
import { readMitreEffectCsv, syncMitreEffectSources } from '../../scripts/lib/mitre-effect-csv.js'

test('CSV effect seed refreshes stale Enterprise rows, preserves edits and rejects invalid effects', {
  skip: process.env.CRRA_EFFECT_DB_TESTS !== '1',
}, async () => {
  const schema = `effect_test_${process.pid}`
  const source = `${schema}_source`
  const rewrite = (sql) => sql.replaceAll('vehicle_lang_source.', `${source}.`)
    .replaceAll('vehicle_lang.', `${schema}.`)
  const sql = rewrite(await readFile(new URL('../../../db/sql/06-effect-profiles.sql', import.meta.url), 'utf8'))
  const pool = createDatabasePool()
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query(`CREATE SCHEMA ${schema}; CREATE SCHEMA ${source}`)
    await db.query(`CREATE TABLE ${source}.mitre_effects (LIKE vehicle_lang_source.mitre_effects INCLUDING ALL);
      INSERT INTO ${source}.mitre_effects (csv_file,"ID","STIX ID",name,effect,confidence,cost,reason)
      SELECT csv_file,"ID","STIX ID",name,effect,confidence,cost,reason FROM vehicle_lang_source.mitre_effects`)
    for (const table of ['un_r155_effects','un_r155_mitigations']) {
      await db.query(`CREATE TABLE ${source}.${table} AS TABLE vehicle_lang_source.${table}`)
    }
    for (const table of ['mitre_mitigation','un_r155_attack_method_mitigation']) {
      await db.query(`CREATE TABLE ${schema}.${table} AS TABLE vehicle_lang.${table}`)
    }
    for (const table of ['mitre_mitigation_effect_profile','un_r155_mitigation_effect_profile']) {
      await db.query(`CREATE TABLE ${schema}.${table} (LIKE vehicle_lang.${table} INCLUDING ALL)`)
    }
    // Reproduce an existing volume initialized before Enterprise effects were filled.
    await db.query(`UPDATE ${source}.mitre_effects SET effect=NULL,confidence=NULL,cost=NULL,reason=NULL
      WHERE csv_file LIKE '%enterprise-%'`)
    const { rows: originalSources } = await db.query(`SELECT "ID",source_row FROM ${source}.mitre_effects ORDER BY "ID"`)
    await db.query(sql)
    await db.query(`UPDATE ${schema}.mitre_mitigation_effect_profile SET effect_types=ARRAY['R'],cost=5,basis='Manual review' WHERE mitigation_id='M0801'`)
    const connection = { query: (query, params) => db.query(rewrite(query), params) }
    await syncMitreEffectSources(connection)
    await db.query(sql)
    const { rows: [counts] } = await db.query(`SELECT
      (SELECT count(*)::int FROM ${schema}.mitre_mitigation_effect_profile) AS mitre,
      (SELECT count(*)::int FROM ${schema}.un_r155_mitigation_effect_profile) AS un`)
    assert.deepEqual(counts,{ mitre: 97, un: 74 })
    const { rows: refreshedSources } = await db.query(`SELECT "ID",source_row FROM ${source}.mitre_effects ORDER BY "ID"`)
    assert.deepEqual(refreshedSources, originalSources)
    const { rows: sourceValues } = await db.query(`SELECT csv_file,"ID","STIX ID",name,effect,confidence,cost,reason
      FROM ${source}.mitre_effects ORDER BY "ID"`)
    assert.deepEqual(sourceValues, (await readMitreEffectCsv()).sort((a,b) => a.ID.localeCompare(b.ID)))
    const { rows: enterprise } = await db.query(`SELECT p.mitigation_id,p.effect_types,p.confidence,p.cost,p.basis
      FROM ${schema}.mitre_mitigation_effect_profile p
      JOIN ${schema}.mitre_mitigation c USING (mitigation_id)
      WHERE c.domain='enterprise-attack' ORDER BY p.mitigation_id`)
    const expectedEnterprise = (await readMitreEffectCsv()).filter((row) => row.csv_file.includes('enterprise-'))
      .map((row) => ({ mitigation_id: row.ID, effect_types: [row.effect], confidence: row.confidence, cost: Number(row.cost), basis: row.reason }))
      .sort((a,b) => a.mitigation_id.localeCompare(b.mitigation_id))
    assert.deepEqual(enterprise, expectedEnterprise)
    const { rows: [profile] } = await db.query(`SELECT effect_types,confidence FROM ${schema}.mitre_mitigation_effect_profile WHERE mitigation_id='M0816'`)
    assert.equal(profile.confidence,'L')
    assert.equal(profile.effect_types.length,1)
    await db.query(`UPDATE ${schema}.mitre_mitigation_effect_profile SET effect_types=ARRAY['D'],cost=4,basis='Enterprise manual review' WHERE mitigation_id='M1036'`)
    await syncMitreEffectSources(connection)
    await db.query(sql)
    const { rows: [retained] } = await db.query(`SELECT effect_types,cost,basis FROM ${schema}.mitre_mitigation_effect_profile WHERE mitigation_id='M0801'`)
    assert.deepEqual(retained,{ effect_types: ['R'],cost: 5,basis: 'Manual review' })
    const { rows: [retainedEnterprise] } = await db.query(`SELECT effect_types,cost,basis FROM ${schema}.mitre_mitigation_effect_profile WHERE mitigation_id='M1036'`)
    assert.deepEqual(retainedEnterprise,{ effect_types: ['D'],cost: 4,basis: 'Enterprise manual review' })
    // An absent source row is inserted with an identity before its profile is seeded.
    await db.query(`DELETE FROM ${schema}.mitre_mitigation_effect_profile WHERE mitigation_id='M1047';
      DELETE FROM ${source}.mitre_effects WHERE "ID"='M1047'`)
    await syncMitreEffectSources(connection)
    await db.query(sql)
    const { rows: [inserted] } = await db.query(`SELECT effect_types,confidence,cost FROM ${schema}.mitre_mitigation_effect_profile WHERE mitigation_id='M1047'`)
    assert.deepEqual(inserted,{ effect_types: ['D'],confidence: 'M',cost: 3 })
    for (const types of [['X'],['P','P'],[null],[]]) {
      await db.query('SAVEPOINT invalid_effect')
      await assert.rejects(db.query(`UPDATE ${schema}.mitre_mitigation_effect_profile SET effect_types=$1 WHERE mitigation_id='M0801'`,[types]),{ code: '23514' })
      await db.query('ROLLBACK TO SAVEPOINT invalid_effect')
    }
  } finally {
    await db.query('ROLLBACK')
    db.release()
    await pool.end()
  }
})

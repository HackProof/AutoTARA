import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { parse } from 'csv-parse/sync'
import { createDatabasePool } from '../config/db.js'

const fixtures = [
  { file: 'coreLang-AttackStep_Defenses.csv', source: 'mal_attack_step_defenses',
    table: 'mal_attack_step_defense', reference: 'source_row', keys: ['attack_step_id', 'defense_id'] },
  { file: 'vehicleLang-AttackStep_Defenses.csv', source: 'mal_attack_step_defenses',
    table: 'mal_attack_step_defense', reference: 'source_row', keys: ['attack_step_id', 'defense_id'] },
  { file: 'mapping_table/enterprise-attack-v20.0-mitigations-effect-mapping.csv', source: 'mitre_effects',
    table: 'mitre_mitigation_effect_profile', reference: 'source_row', keys: ['ID'] },
  { file: 'mapping_table/ics-attack-v20.0-mitigation_effect-mapping.csv', source: 'mitre_effects',
    table: 'mitre_mitigation_effect_profile', reference: 'source_row', keys: ['ID'] },
  { file: 'mapping_table/UN_R155_Annex5-PART_B-C_effect-mapping.csv', source: 'un_r155_effects',
    table: 'un_r155_mitigation_effect_profile', reference: 'effect_source_row',
    keys: ['attack_method_id', 'part', 'table_id', 'mitigation_id', 'mitigation'] },
]

test('PostgreSQL loads every countermeasure CSV cost and rejects missing or out-of-range scores', {
  skip: process.env.CATALOG_DB_TESTS !== '1',
}, async () => {
  const pool = createDatabasePool()
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    let total = 0
    for (const fixture of fixtures) {
      const csv = await readFile(new URL(`../../../db/data/${fixture.file}`, import.meta.url), 'utf8')
      const expected = parse(csv, { bom: true, columns: true, skip_empty_lines: true })
      const key = (row) => JSON.stringify(fixture.keys.map((name) => row[name]))
      const byKey = new Map(expected.map((row) => [key(row), row.cost]))
      assert.equal(byKey.size, expected.length, `Unique source keys: ${fixture.file}`)
      const { rows } = await db.query(`
        SELECT to_jsonb(s) AS source, t.cost
        FROM vehicle_lang_source.${fixture.source} s
        JOIN vehicle_lang.${fixture.table} t ON t.${fixture.reference} = s.source_row
        WHERE s.csv_file = $1
      `, [fixture.file])
      assert.equal(rows.length, expected.length, `Coverage: ${fixture.file}`)
      const seen = new Set()
      for (const row of rows) {
        const sourceKey = key(row.source)
        assert.ok(byKey.has(sourceKey), `Known CSV record: ${fixture.file}: ${sourceKey}`)
        assert.ok(!seen.has(sourceKey), `No duplicated record: ${sourceKey}`)
        seen.add(sourceKey)
        assert.equal(row.source.cost, byKey.get(sourceKey), `Raw cost: ${sourceKey}`)
        assert.equal(row.cost, Number(byKey.get(sourceKey)), `Typed cost: ${sourceKey}`)
        assert.ok(Number.isInteger(row.cost) && row.cost >= 1 && row.cost <= 5)
      }
      total += rows.length
    }
    assert.equal(total, 204)

    for (const table of new Set(fixtures.map((fixture) => fixture.table))) {
      const { rows: [column] } = await db.query(`
        SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'vehicle_lang' AND table_name = $1 AND column_name = 'cost'
      `, [table])
      assert.deepEqual(column, { data_type: 'smallint', is_nullable: 'NO' })
      for (const value of [0, 6, null]) {
        await db.query('SAVEPOINT invalid_cost')
        await assert.rejects(db.query(`UPDATE vehicle_lang.${table} SET cost = $1
          WHERE ctid = (SELECT ctid FROM vehicle_lang.${table} LIMIT 1)`, [value]),
        { code: value === null ? '23502' : '23514' })
        await db.query('ROLLBACK TO SAVEPOINT invalid_cost')
        await db.query('RELEASE SAVEPOINT invalid_cost')
      }
    }
  } finally {
    await db.query('ROLLBACK')
    db.release()
    await pool.end()
  }
})

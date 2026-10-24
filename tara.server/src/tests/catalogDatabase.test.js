import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatabasePool } from '../config/db.js'
import { createApp } from '../app.js'

test('PostgreSQL CSV catalog serves both languages and both ATT&CK domains through the API', {
  skip: process.env.CATALOG_DB_TESTS !== '1',
}, async () => {
  const database = createDatabasePool()
  const server = createApp({ database }).listen(0, '127.0.0.1')
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/v1/lang-schemas`
    const { rows: [counts] } = await database.query(`SELECT
      current_setting('server_version_num') AS version,
      (SELECT count(*)::int FROM vehicle_lang.v_attack_step_catalog) AS steps,
      (SELECT count(*)::int FROM vehicle_lang.mitre_technique) AS techniques,
      (SELECT count(*)::int FROM vehicle_lang.mitre_mitigation) AS mitigations,
      (SELECT count(*)::int FROM vehicle_lang.mitre_technique_mitigation) AS relationships,
      (SELECT count(*)::int FROM vehicle_lang.mitre_technique_detection) AS detections`)
    assert.deepEqual(counts, {
      version: '180006', steps: 233, techniques: 810, mitigations: 97,
      relationships: 1901, detections: 807,
    })
    const schemas = await fetch(base)
    assert.equal(schemas.status, 200)
    assert.deepEqual(await schemas.json(), {
      schemas: [{ schema: 'vehicle_lang', label: 'vehicleLang' }],
    })
    async function post(route, body) {
      const response = await fetch(`${base}/vehicle_lang/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      assert.equal(response.status, 200)
      return response.json()
    }
    const { attackSteps } = await post('attack-steps', { assetTypes: ['ECU', 'Application', 'Data'] })
    assert.ok(attackSteps.some((s) => s.attack_step_id.startsWith('CoreLang:')))
    assert.ok(attackSteps.some((s) => s.attack_step_id.startsWith('VehicleLang:')))
    const injection = attackSteps.find((s) => s.attack_step_id === 'VehicleLang:ECU._networkServiceMessageInjection')
    assert.ok(injection)
    assert.deepEqual(injection.technique_mappings.filter((m) => m.un_r155_attack_id)
      .map((m) => m.un_r155_attack_id).sort(), ['11.1', '20.4', '20.5'])
    assert.equal(injection.technique_mappings.filter((m) => m.mitre_technique_id).length, 1)
    assert.equal(injection.ctsa.ctsa_score, null)
    assert.equal(injection.riskScore, null)
    assert.equal(injection.classification_reason, null)
    const result = await post('countermeasures', { techniqueIds: ['T0800', 'T1078', 'T9999'] })
    assert.deepEqual(result.unmappedAvIds, ['T9999'])
    const ics = result.countermeasures.filter((c) => c.mappings.some((m) => m.avId === 'T0800'))
    const enterprise = result.countermeasures.filter((c) => c.mappings.some((m) => m.avId === 'T1078'))
    assert.ok(ics.length > 0 && enterprise.length > 0)
    assert.ok(ics.every((c) => c.defaultEffects.length === 1))
    assert.ok(enterprise.every((c) => c.defaultEffects.length === 1))
    assert.ok(enterprise.every((c) => c.defaultEffects[0].level === 'M'))
    assert.ok(enterprise.every((c) => c.effectProfile.source ===
      'mapping_table/enterprise-attack-v20.0-mitigations-effect-mapping.csv'))
    assert.deepEqual(result.missingEffectCmIds, [])
    const { rows: costs } = await database.query(`SELECT mitigation_id, cost
      FROM vehicle_lang.mitre_mitigation_effect_profile
      WHERE mitigation_id = ANY($1::text[])`, [result.countermeasures.map((cm) => cm.id)])
    const costById = new Map(costs.map((row) => [row.mitigation_id, row.cost]))
    assert.ok(result.countermeasures.every((cm) =>
      Number.isInteger(cm.cost) && cm.cost >= 1 && cm.cost <= 5 && cm.cost === costById.get(cm.id)))
    assert.ok(!result.missingFields.includes('cost score'))
    assert.ok(enterprise.every((c) => c.mappings.every((m) => m.evidence.source === 'MITRE ATT&CK Enterprise')))
    const { rows: [encoding] } = await database.query(`SELECT
      bool_or(description LIKE '%’%') AS has_unicode_apostrophe,
      bool_or(description LIKE '%¡¯%') AS has_mojibake
      FROM vehicle_lang.mitre_technique WHERE domain = 'ics-attack'`)
    assert.deepEqual(encoding, { has_unicode_apostrophe: true, has_mojibake: false })
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await database.end()
  }
})

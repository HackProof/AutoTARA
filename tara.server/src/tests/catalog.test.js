import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createApp } from '../app.js'
import { getAttackSteps, listLangSchemas } from '../modules/catalog/catalog.service.js'

test('discovers only compatible catalogs and presents vehicle_lang as vehicleLang', async () => {
  const schemas = await listLangSchemas({
    query: async (sql) => {
      assert.match(sql, /information_schema\.columns/)
      assert.match(sql, /HAVING count\(DISTINCT column_name\) = 12/)
      return { rows: [{ schema: 'vehicle_lang' }, { schema: 'customLang' }] }
    },
  })
  assert.deepEqual(schemas, [
    { schema: 'vehicle_lang', label: 'vehicleLang' },
    { schema: 'customLang', label: 'customLang' },
  ])
})

test('binds asset names and returns unmapped, hidden and CoreLang steps with no risk score', async () => {
  const rows = [
    {
      attack_step_id: 'VehicleLang:ECU.connect',
      asset: 'ECU',
      name: 'connect',
      technique_mappings: [],
      hidden: false,
    },
    {
      attack_step_id: 'VehicleLang:ECU._hidden',
      asset: 'ECU',
      name: '_hidden',
      technique_mappings: [],
      hidden: true,
    },
    {
      attack_step_id: 'CoreLang:Data.access',
      asset: 'Data',
      name: 'access',
      technique_mappings: [],
    },
  ]
  const names = ['ECU', 'Data', "ECU'); DROP SCHEMA vehicle_lang; --"]
  const database = {
    query: async (sql, params) => {
      if (sql.includes('information_schema.columns')) return { rows: [{ schema: 'vehicle_lang' }] }
      if (!params) return { rows: [] }
      assert.match(sql, /FROM "vehicle_lang"\.v_attack_step_catalog/)
      assert.match(sql, /asset = ANY\(\$1::text\[\]\)/)
      assert.ok(!sql.includes(names[2]))
      assert.ok(!sql.includes('WHERE hidden'))
      assert.deepEqual(params, [names])
      return { rows }
    },
  }
  assert.deepEqual(
    await getAttackSteps(database, 'vehicle_lang', names),
    rows.map((row) => ({
      ...row,
      declared_asset: row.asset,
      inheritance_depth: 0,
      riskScore: null,
    })),
  )
})

test('rejects unknown schema names before constructing catalog SQL', async () => {
  let calls = 0
  const database = {
    query: async () => {
      calls++
      return { rows: [{ schema: 'vehicle_lang' }] }
    },
  }
  await assert.rejects(getAttackSteps(database, 'vehicle_lang; DROP SCHEMA public', ['ECU']), {
    status: 404,
  })
  assert.equal(calls, 1)
})

test('quotes discovered schema identifiers including embedded quotes', async () => {
  const database = {
    query: async (sql, params) => {
      if (sql.includes('information_schema.columns')) return { rows: [{ schema: 'custom"Lang' }] }
      assert.match(sql, /FROM "custom""Lang"\.v_attack_step_catalog/)
      return { rows: [] }
    },
  }
  assert.deepEqual(await getAttackSteps(database, 'custom"Lang', ['ECU']), [])
})

function catalogDatabase(rows, parents) {
  const queries = []
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params })
      if (sql.includes('information_schema.columns')) return { rows: [{ schema: 'vehicle_lang' }] }
      if (!params) return { rows: parents }
      return { rows: rows.filter((row) => params[0].includes(row.asset)) }
    },
  }
}

const step = (asset, name, extra = {}) => ({
  asset,
  name,
  attack_step_id: `Lang:${asset}.${name}`,
  technique_mappings: [],
  ...extra,
})

test('includes all DB ancestors, gives child overrides precedence, and preserves each source ID and mapping', async () => {
  const own = step('ECU', 'fullAccess', {
    technique_mappings: [{ mitre_technique_id: 'T0801' }],
  })
  const parent = step('Machine', 'authenticate', {
    hidden: true,
    auxiliary: true,
  })
  const grandparent = step('Hardware', 'physicalAccess', {
    technique_mappings: [{ mitre_technique_id: 'T0840', un_r155_attack_id: '18.1' }],
  })
  const database = catalogDatabase(
    [own, step('Machine', 'fullAccess'), parent, grandparent],
    [
      { asset: 'ECU', language_key: 'vehiclelang', extends_name: 'Machine' },
      {
        asset: 'Machine',
        language_key: 'vehiclelang',
        extends_name: 'Hardware',
      },
      { asset: 'Hardware', language_key: 'corelang', extends_name: null },
    ],
  )
  const rows = await getAttackSteps(database, 'vehicle_lang', ['ECU', 'Machine'])
  const ecu = rows.filter((row) => row.asset === 'ECU')
  assert.deepEqual(
    ecu.map((row) => [row.name, row.declared_asset, row.inheritance_depth]),
    [
      ['fullAccess', 'ECU', 0],
      ['authenticate', 'Machine', 1],
      ['physicalAccess', 'Hardware', 2],
    ],
  )
  assert.equal(ecu[1].attack_step_id, parent.attack_step_id)
  assert.equal(ecu[1].hidden, true)
  assert.equal(ecu[1].auxiliary, true)
  assert.deepEqual(ecu[0].technique_mappings, own.technique_mappings)
  assert.deepEqual(ecu[2].technique_mappings, grandparent.technique_mappings)
  assert.ok(rows.every((row) => row.riskScore === null))
  const queries = database.queries.filter(({ params }) => params)
  assert.equal(queries.length, 1)
  assert.deepEqual(queries[0].params, [['ECU', 'Machine', 'Hardware']])
  assert.equal(rows.filter((row) => row.asset === 'Machine').length, 3)
})

test('uses LangGraph ancestors through abstract or missing DB assets and honors explicit roots', async () => {
  const database = catalogDatabase(
    [
      step('Router', 'forward'),
      step('VehicularApplication', 'fullAccess'),
      step('Application', 'read'),
      step('Obsolete', 'stale'),
    ],
    [
      { asset: 'Router', extends_name: 'WrongParent' },
      { asset: 'VehicularApplication', extends_name: 'Application' },
      { asset: 'Application', extends_name: 'Obsolete' },
      { asset: 'Obsolete', extends_name: null },
    ],
  )
  const rows = await getAttackSteps(database, 'vehicle_lang', ['Router', 'NewAsset'], {
    Router: 'Service',
    Service: 'VehicularApplication',
    NewAsset: 'Service',
    VehicularApplication: 'Application',
    Application: '',
  })
  assert.deepEqual(
    rows.filter((row) => row.asset === 'Router').map((row) => [row.name, row.inheritance_depth]),
    [
      ['forward', 0],
      ['fullAccess', 2],
      ['read', 3],
    ],
  )
  assert.deepEqual(
    rows.filter((row) => row.asset === 'NewAsset').map((row) => row.name),
    ['fullAccess', 'read'],
  )
  assert.ok(!rows.some((row) => row.name === 'stale'))
})

test('terminates cyclic inheritance and does not guess ambiguous DB parents', async () => {
  const database = catalogDatabase(
    [step('Child', 'own'), step('Parent', 'inherited')],
    [
      { asset: 'Child', language_key: 'childlang', extends_name: 'Parent' },
      { asset: 'Parent', language_key: 'lang_a', extends_name: null },
      { asset: 'Parent', language_key: 'lang_b', extends_name: null },
    ],
  )
  assert.deepEqual(
    (await getAttackSteps(database, 'vehicle_lang', ['Child'])).map((row) => row.name),
    ['own'],
  )
  const rows = await getAttackSteps(database, 'vehicle_lang', ['Child'], {
    Child: 'Parent',
    Parent: 'Child',
  })
  assert.deepEqual(
    rows.map((row) => row.name),
    ['own', 'inherited'],
  )
})

let server
let baseUrl
let failDatabase = false
const requestedAssets = []
before(async () => {
  const database = {
    query: async (sql, params) => {
      if (failDatabase)
        throw Object.assign(new Error('private connection details'), {
          code: 'ECONNREFUSED',
        })
      if (sql.includes('information_schema.columns')) return { rows: [{ schema: 'vehicle_lang' }] }
      if (!params) return { rows: [] }
      requestedAssets.push(params[0])
      return {
        rows: [
          {
            attack_step_id: 'VehicleLang:ECU.connect',
            asset: 'ECU',
            name: 'connect',
            technique_mappings: [],
          },
        ],
      }
    },
  }
  server = createApp({ database }).listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
})

test('HTTP catalog routes expose schemas, deduplicate requested assets and include null scores', async () => {
  const schemas = await fetch(`${baseUrl}/api/v1/lang-schemas`)
  assert.equal(schemas.status, 200)
  assert.deepEqual(await schemas.json(), {
    schemas: [{ schema: 'vehicle_lang', label: 'vehicleLang' }],
  })
  const response = await fetch(`${baseUrl}/api/v1/lang-schemas/vehicle_lang/attack-steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetTypes: ['ECU', 'ECU'] }),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.schema, 'vehicle_lang')
  assert.equal(body.attackSteps[0].riskScore, null)
  assert.deepEqual(requestedAssets.at(-1), ['ECU'])
})

test('HTTP routes distinguish invalid requests, unavailable schemas and database failures', async () => {
  for (const assetTypes of [null, [], [''], [1], ['x'.repeat(257)], Array(1001).fill('ECU')]) {
    const response = await fetch(`${baseUrl}/api/v1/lang-schemas/vehicle_lang/attack-steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetTypes }),
    })
    assert.equal(response.status, 400)
  }
  for (const assetParents of [
    null,
    [],
    'ECU',
    { ECU: 1 },
    { '': 'ECU' },
    { ECU: ' ' },
    { ECU: 'x'.repeat(257) },
  ]) {
    const response = await fetch(`${baseUrl}/api/v1/lang-schemas/vehicle_lang/attack-steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetTypes: ['ECU'], assetParents }),
    })
    assert.equal(response.status, 400)
  }
  const missing = await fetch(`${baseUrl}/api/v1/lang-schemas/unknown/attack-steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetTypes: ['ECU'] }),
  })
  assert.equal(missing.status, 404)
  failDatabase = true
  try {
    const response = await fetch(`${baseUrl}/api/v1/lang-schemas`)
    assert.equal(response.status, 503)
    assert.ok(!(await response.text()).includes('private connection details'))
  } finally {
    failDatabase = false
  }
})

test('HTTP routes pass the supplied LangGraph parents to inherited attack-step lookup', async () => {
  const response = await fetch(`${baseUrl}/api/v1/lang-schemas/vehicle_lang/attack-steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assetTypes: ['GatewayECU'],
      assetParents: { GatewayECU: 'ECU', ECU: '' },
    }),
  })
  assert.equal(response.status, 200)
  const { attackSteps } = await response.json()
  assert.deepEqual(requestedAssets.at(-1), ['GatewayECU', 'ECU'])
  assert.equal(attackSteps[0].asset, 'GatewayECU')
  assert.equal(attackSteps[0].declared_asset, 'ECU')
  assert.equal(attackSteps[0].inheritance_depth, 1)
  assert.equal(attackSteps[0].attack_step_id, 'VehicleLang:ECU.connect')
})

test('catalog returns CSV CTSA and abstract metadata without replacing project risk scores', async () => {
  const ctsa = { proximity: 2, ctsa_score: 2.6 }
  const db = { async query(sql, params) {
    if (sql.includes('information_schema.columns')) return { rows: [{ schema: 'vehicle_lang' }] }
    if (!params) return { rows: [] }
    return { rows: [{ attack_step_id: 'VehicleLang:ECU.connect', asset: 'ECU', name: 'connect', abstract: null, ctsa }] }
  } }
  const [step] = await getAttackSteps(db, 'vehicle_lang', ['ECU'])
  assert.deepEqual(step.ctsa, ctsa)
  assert.equal(step.abstract, null)
  assert.equal(step.riskScore, null)
})

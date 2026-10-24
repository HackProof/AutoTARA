import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { parse, parseDocument } from 'yaml'
import { parseLanguageGraph } from '../src/services/languageGraph.js'
import { prepareMalExport, resolveMalExport, serializeMalModel } from '../src/services/malModel.js'

const { languageGraph } = parseLanguageGraph(
  await readFile(new URL('../../sample/vehicleLang_v2-langgraph.json', import.meta.url), 'utf8'),
)
const vertex = (id, type, label = id, dfdShape = 'process') => ({
  id,
  assetType: type,
  label,
  dfdShape,
  position: { x: -20, y: 35 },
})
const flow = (id, source, target) => ({ id, source, target })
function chooseField(plan, field) {
  return Object.fromEntries(
    plan.flows.map((edge) => [
      edge.id,
      edge.candidates.find((candidate) => candidate.sourceField === field)?.id,
    ]),
  )
}

test('Tesla sample exports all 22 assets and 48 reciprocal references with the same relationships', async () => {
  const sample = parse(
    await readFile(new URL('../../sample/Tesla_Model_S_MAL_Model.yaml', import.meta.url), 'utf8'),
  )
  const vertices = Object.entries(sample.assets).map(([id, asset]) => ({
    ...vertex(id, asset.type, asset.name),
    position: asset.extras.position,
  }))
  const edges = []
  const fields = new Map()
  for (const [source, asset] of Object.entries(sample.assets)) {
    for (const [field, targets] of Object.entries(asset.associated_assets || {})) {
      for (const target of Object.keys(targets)) {
        const id = `flow${edges.length}`
        edges.push(flow(id, source, target))
        fields.set(id, field)
      }
    }
  }
  const plan = prepareMalExport({ vertices, edges }, languageGraph, {
    title: sample.metadata.name,
    version: 'unrelated-diagram-version',
  })
  const choices = Object.fromEntries(
    plan.flows.map((edge) => [
      edge.id,
      edge.candidates.find((candidate) => candidate.sourceField === fields.get(edge.id))?.id,
    ]),
  )
  const yaml = serializeMalModel(plan, choices)
  const actual = parse(yaml)
  assert.equal(Object.keys(actual.assets).length, 22)
  assert.equal(edges.length, 48)
  for (const expected of Object.values(sample.assets)) {
    const asset = Object.values(actual.assets).find((entry) => entry.name === expected.name)
    assert.equal(asset.type, expected.type)
    assert.deepEqual(asset.extras.position, expected.extras.position)
    assert.deepEqual(
      Object.keys(asset.associated_assets).sort(),
      Object.keys(expected.associated_assets || {}).sort(),
    )
    for (const [field, links] of Object.entries(expected.associated_assets || {})) {
      assert.deepEqual(
        Object.values(asset.associated_assets[field]).sort(),
        Object.values(links).sort(),
      )
      for (const [id, name] of Object.entries(asset.associated_assets[field]))
        assert.equal(actual.assets[id].name, name)
    }
  }
  assert.equal(actual.metadata.name, sample.metadata.name)
  assert.equal(actual.metadata.langID, sample.metadata.langID)
  assert.equal(actual.metadata.langVersion, '2.0.1')
  const numericAssets = parseDocument(yaml).toJS({ mapAsMap: true }).get('assets')
  assert.ok([...numericAssets.keys()].every((key) => typeof key === 'number'))
  for (const asset of numericAssets.values()) {
    for (const targets of asset.get('associated_assets').values())
      assert.ok([...targets.keys()].every((key) => typeof key === 'number'))
  }
})

test('ambiguous inherited associations require an explicit selection and export both endpoint fields', () => {
  const snapshot = {
    vertices: [vertex('a', 'ECU', 'ECU', 'store'), vertex('b', 'Firmware', 'Firmware', 'actor')],
    edges: [flow('e', 'a', 'b')],
  }
  const before = structuredClone(snapshot)
  const plan = prepareMalExport(snapshot, languageGraph)
  assert.equal(plan.flows[0].candidates.length, 3)
  assert.throws(() => serializeMalModel(plan), /Choose an association/)
  assert.throws(() => serializeMalModel(plan, { e: 'invalid' }), /Choose an association/)
  const yaml = serializeMalModel(plan, chooseField(plan, 'firmware'))
  const model = parse(yaml)
  assert.equal(model.assets[1].type, 'ECU')
  assert.equal(model.assets[1].extras.dfdShape, 'store')
  assert.deepEqual(model.assets[1].associated_assets, { firmware: { 2: 'Firmware' } })
  assert.deepEqual(model.assets[2].associated_assets, { hardware: { 1: 'ECU' } })
  assert.deepEqual(snapshot, before)
})

test('single associations resolve automatically, including inherited endpoints and reversed arrows', () => {
  const vertices = [vertex('a', 'GatewayECU'), vertex('b', 'User')]
  for (const edge of [flow('e', 'a', 'b'), flow('e', 'b', 'a')]) {
    const plan = prepareMalExport({ vertices, edges: [edge] }, languageGraph)
    assert.equal(plan.flows[0].candidates.length, 1)
    const model = parse(serializeMalModel(plan))
    assert.deepEqual(model.assets[1].associated_assets, { users: { 2: 'b' } })
    assert.deepEqual(model.assets[2].associated_assets, { hardwareSystems: { 1: 'a' } })
  }
})

test('saved Data Flow associations are used automatically and stale choices require correction', () => {
  const snapshot = {
    vertices: [vertex('a', 'ECU'), vertex('b', 'Firmware')],
    edges: [flow('e', 'a', 'b')],
  }
  let plan = prepareMalExport(snapshot, languageGraph)
  const firmware = plan.flows[0].candidates.find(
    (candidate) => candidate.sourceField === 'firmware',
  )
  snapshot.edges[0].associationId = firmware.id
  plan = prepareMalExport(snapshot, languageGraph)
  assert.deepEqual(parse(serializeMalModel(plan)).assets[1].associated_assets, {
    firmware: { 2: 'b' },
  })
  const alternate = parse(serializeMalModel(plan, chooseField(plan, 'sysExecutedApps')))
  assert.deepEqual(alternate.assets[1].associated_assets, { sysExecutedApps: { 2: 'b' } })
  assert.equal(snapshot.edges[0].associationId, firmware.id)
  // A different endpoint must not silently reinterpret the stored relationship.
  snapshot.vertices[1].assetType = 'CANNetwork'
  plan = prepareMalExport(snapshot, languageGraph)
  assert.equal(plan.flows[0].candidates.length, 1)
  assert.throws(() => serializeMalModel(plan), /Choose an association/)
  assert.doesNotThrow(() => serializeMalModel(plan, chooseField(plan, 'vehiclenetworks')))
})

test('cardinality checks both ends, but parallel and reciprocal flows do not duplicate an association', () => {
  const vertices = [vertex('a', 'ECU'), vertex('b', 'Firmware'), vertex('c', 'Firmware')]
  let plan = prepareMalExport(
    { vertices, edges: [flow('e1', 'a', 'b'), flow('e2', 'a', 'c')] },
    languageGraph,
  )
  assert.throws(
    () => serializeMalModel(plan, chooseField(plan, 'firmware')),
    /firmware allows at most 1 linked assets; 2/,
  )
  plan = prepareMalExport(
    {
      vertices: [vertex('a', 'ECU'), vertex('b', 'Firmware'), vertex('c', 'ECU')],
      edges: [flow('e1', 'a', 'b'), flow('e2', 'c', 'b')],
    },
    languageGraph,
  )
  assert.throws(
    () => serializeMalModel(plan, chooseField(plan, 'firmware')),
    /hardware allows at most 1 linked assets; 2/,
  )
  plan = prepareMalExport(
    { vertices, edges: [flow('e1', 'a', 'b'), flow('e2', 'a', 'b'), flow('e3', 'b', 'a')] },
    languageGraph,
  )
  const choices = chooseField(plan, 'firmware')
  choices.e3 = plan.flows[2].candidates.find((candidate) => candidate.sourceField === 'hardware').id
  assert.deepEqual(parse(serializeMalModel(plan, choices)).assets[1].associated_assets, {
    firmware: { 2: 'b' },
  })
})

test('self-type associations retain both roles instead of inferring semantics from arrow direction', () => {
  const plan = prepareMalExport(
    {
      vertices: [vertex('a', 'Application'), vertex('b', 'Application')],
      edges: [flow('e', 'a', 'b')],
    },
    languageGraph,
  )
  assert.deepEqual(plan.flows[0].candidates.map((candidate) => candidate.sourceField).sort(), [
    'appExecutedApps',
    'hostApp',
  ])
  assert.throws(() => serializeMalModel(plan), /Choose an association/)
  const model = parse(serializeMalModel(plan, chooseField(plan, 'hostApp')))
  assert.deepEqual(model.assets[1].associated_assets, { hostApp: { 2: 'b' } })
  assert.deepEqual(model.assets[2].associated_assets, { appExecutedApps: { 1: 'a' } })
})

test('omits boundaries and text, but rejects generic, unknown, abstract assets and broken flows', () => {
  const base = {
    vertices: [
      vertex('a', 'ECU'),
      { id: 'boundary', kind: 'boundary' },
      { id: 'text', kind: 'annotation' },
    ],
    edges: [],
  }
  let plan = prepareMalExport(base, languageGraph)
  assert.equal(Object.keys(parse(serializeMalModel(plan)).assets).length, 1)
  assert.match(plan.notes[0], /2 boundary\/text shapes/)
  for (const type of [
    '',
    'not-a-type',
    languageGraph.assets.find((asset) => asset.isAbstract).name,
  ]) {
    plan = prepareMalExport(
      { vertices: [...base.vertices, vertex('bad', type)], edges: [] },
      languageGraph,
    )
    assert.throws(() => serializeMalModel(plan), /no valid MAL asset type|abstract asset type/)
  }
  for (const target of ['', 'missing', 'boundary']) {
    plan = prepareMalExport({ ...base, edges: [flow('e', 'a', target)] }, languageGraph)
    assert.throws(() => serializeMalModel(plan), /must connect two valid MAL assets/)
  }
  plan = prepareMalExport(
    { vertices: [vertex('a', 'ECU'), vertex('b', 'ECU')], edges: [flow('e', 'a', 'b')] },
    languageGraph,
  )
  assert.throws(() => serializeMalModel(plan), /no MAL association/)
})

test('missing language metadata, missing catalog, and empty models cannot produce misleading YAML', () => {
  const snapshot = { vertices: [vertex('a', 'ECU')], edges: [] }
  assert.throws(() => serializeMalModel(prepareMalExport(snapshot, null)), /requires a LangGraph/)
  assert.throws(
    () => serializeMalModel(prepareMalExport(snapshot, { ...languageGraph, metadata: {} })),
    /metadata.id and metadata.version/,
  )
  assert.throws(
    () => serializeMalModel(prepareMalExport({ vertices: [], edges: [] }, languageGraph)),
    /at least one MAL asset/,
  )
})

test('YAML names, Unicode, multiline descriptions and special keys survive YAML 1.1 and 1.2', () => {
  const labels = ['on', 'yes', 'null', '123', '테스트: ECU #1', '__proto__', 'a\nb', 'true']
  const vertices = labels.map((label, index) => ({
    ...vertex(String(index), 'ECU', label),
    description: 'first: "quoted"\nsecond # line',
  }))
  const plan = prepareMalExport({ vertices, edges: [] }, languageGraph, { title: 'yes' })
  const yaml = serializeMalModel(plan)
  for (const version of ['1.1', '1.2']) {
    const model = parse(yaml, { version })
    assert.deepEqual(
      Object.values(model.assets).map((asset) => asset.name),
      labels,
    )
    assert.equal(model.metadata.name, 'yes')
    assert.equal(model.assets[1].extras.description, vertices[0].description)
  }
})

test('duplicate names receive collision-free suffixes with matching link names and no diagram mutation', () => {
  const snapshot = {
    vertices: [
      vertex('a', 'ECU', 'ECU'),
      vertex('b', 'ECU', 'ECU'),
      vertex('c', 'ECU', 'ECU:2'),
      vertex('d', 'CANNetwork', 'CAN'),
    ],
    edges: [flow('e', 'b', 'd')],
  }
  const before = structuredClone(snapshot)
  const plan = prepareMalExport(snapshot, languageGraph)
  const model = parse(serializeMalModel(plan))
  assert.deepEqual(
    Object.values(model.assets).map((asset) => asset.name),
    ['ECU', 'ECU:2:2', 'ECU:2', 'CAN'],
  )
  assert.deepEqual(model.assets[4].associated_assets, { networkECUs: { 2: 'ECU:2:2' } })
  assert.match(plan.notes[0], /duplicate asset names/)
  assert.deepEqual(snapshot, before)
  assert.deepEqual(resolveMalExport(plan).errors, [])
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { parse, stringify } from 'yaml'
import { parseLanguageGraph } from '../src/services/languageGraph.js'
import { parseMalModel } from '../src/services/malModelImport.js'
import { prepareMalExport, serializeMalModel } from '../src/services/malModel.js'
import { createAssociationMatcher } from '../src/services/associations.js'
import { createCtsaDraft, serializeCtsaDraft } from '../src/services/ttpScoring.js'

const { languageGraph } = parseLanguageGraph(
  await readFile(new URL('../../sample/vehicleLang_v2-langgraph.json', import.meta.url), 'utf8'),
)
const tesla = await readFile(
  new URL('../../sample/Tesla_Model_S_MAL_Model.yaml', import.meta.url),
  'utf8',
)

function minimalModel() {
  return {
    assets: {
      0: {
        name: 'ECU',
        type: 'ECU',
        associated_assets: { firmware: { 1: 'Firmware' } },
      },
      1: {
        name: 'Firmware',
        type: 'Firmware',
        associated_assets: { hardware: { 0: 'ECU' } },
      },
    },
  }
}

test('YAML CTSA metadata restores inputs and calculated scores and rejects invalid assessments', () => {
  const model = minimalModel()
  const id = 'VehicleLang:ECU.changeOperationMode'
  const draft = createCtsaDraft([{ attack_step_id: id }])
  for (const factor of draft.threats[0].factors) factor.value = 5
  model.assets[0].extras = { ctsa: { vehicle_lang: serializeCtsaDraft(draft) } }
  model.assets[0].extras.ctsa.vehicle_lang.riskScores[id] = 99
  const snapshot = parseMalModel(stringify(model), languageGraph)
  assert.equal(snapshot.vertices[0].threatAssessments.vehicle_lang.riskScores[id], 5)
  for (const invalid of ['text', [], { vehicle_lang: { version: 2, weights: {}, steps: {} } }]) {
    const malformed = structuredClone(model)
    malformed.assets[0].extras.ctsa = invalid
    assert.throws(() => parseMalModel(stringify(malformed), languageGraph), /CTSA metadata/)
  }
  const malformed = structuredClone(model)
  malformed.assets[0].extras.ctsa.vehicle_lang.steps[id][0].value = 6
  assert.throws(() => parseMalModel(stringify(malformed), languageGraph), /CTSA metadata/)
})

test('imports every Tesla asset, position and association, collapsing reciprocal entries without losing export semantics', () => {
  const snapshot = parseMalModel(tesla, languageGraph)
  const original = parse(tesla)
  assert.equal(snapshot.vertices.length, 22)
  assert.equal(snapshot.edges.length, 24)
  assert.equal(snapshot.title, original.metadata.name)
  const matcher = createAssociationMatcher(languageGraph)
  for (const [id, asset] of Object.entries(original.assets)) {
    const vertex = snapshot.vertices.find((vertex) => vertex.id === `mal-asset-${id}`)
    assert.equal(vertex.label, asset.name)
    assert.equal(vertex.assetType, asset.type)
    assert.equal(vertex.dfdShape, 'process')
    assert.deepEqual(vertex.position, asset.extras.position)
  }
  for (const edge of snapshot.edges) {
    const source = snapshot.vertices.find((vertex) => vertex.id === edge.source)
    const target = snapshot.vertices.find((vertex) => vertex.id === edge.target)
    const association = matcher
      .getAssociations(source.assetType, target.assetType)
      .find((option) => option.id === edge.associationId)
    assert.equal(edge.label, association.name)
  }
  const restored = parse(
    serializeMalModel(prepareMalExport(snapshot, languageGraph, { title: snapshot.title })),
  )
  for (const expected of Object.values(original.assets)) {
    const asset = Object.values(restored.assets).find((asset) => asset.name === expected.name)
    assert.equal(asset.type, expected.type)
    assert.deepEqual(asset.extras.position, expected.extras.position)
    assert.deepEqual(
      Object.keys(asset.associated_assets).sort(),
      Object.keys(expected.associated_assets).sort(),
    )
    for (const field of Object.keys(expected.associated_assets)) {
      assert.deepEqual(
        Object.values(asset.associated_assets[field]).sort(),
        Object.values(expected.associated_assets[field]).sort(),
      )
    }
  }
})

test('restores descriptions and saved DFD shapes while preserving zero/negative coordinates and placing missing positions', () => {
  const model = minimalModel()
  model.assets[0].name = 'ECU <>& "한글"'
  model.assets[0].extras = {
    dfdShape: 'store',
    description: 'Line 1\nLine 2 <>&',
    position: { x: 0, y: -25.5 },
  }
  model.assets[1].extras = { dfdShape: 'actor' }
  const snapshot = parseMalModel(stringify(model), languageGraph)
  assert.equal(snapshot.vertices[0].label, model.assets[0].name)
  assert.equal(snapshot.vertices[0].description, model.assets[0].extras.description)
  assert.equal(snapshot.vertices[0].dfdShape, 'store')
  assert.equal(snapshot.vertices[1].dfdShape, 'actor')
  assert.deepEqual(snapshot.vertices[0].position, { x: 0, y: -25.5 })
  assert.deepEqual(snapshot.vertices[1].position, { x: 240, y: 40 })
  assert.equal(snapshot.edges.length, 1)
  assert.equal(parseMalModel('assets: { 7: ECU }', languageGraph).vertices[0].label, 'ECU:7')
  assert.deepEqual(parseMalModel('assets: {}', languageGraph).vertices, [])
})

test('without a LangGraph imports types as Process assets and retains each directed association field', () => {
  const snapshot = parseMalModel(tesla)
  assert.equal(snapshot.vertices.length, 22)
  assert.equal(snapshot.edges.length, 48)
  assert.ok(snapshot.vertices.every((vertex) => vertex.dfdShape === 'process'))
  assert.equal(snapshot.edges[0].label, 'appExecutedApps')
  assert.ok(snapshot.edges.every((edge) => !edge.associationId))
  assert.throws(
    () =>
      parseMalModel('assets: { 1: { type: Custom, associated_assets: { link: { 2: missing } } } }'),
    /missing MAL asset ID 2/,
  )
})

test('accepts one-sided relations and preserves distinct parallel relationships and self-type endpoint roles', () => {
  const model = minimalModel()
  delete model.assets[1].associated_assets
  assert.equal(parseMalModel(stringify(model), languageGraph).edges.length, 1)
  model.assets[0].associated_assets.sysExecutedApps = { 1: 'Firmware' }
  const parallel = parseMalModel(stringify(model), languageGraph)
  assert.equal(parallel.edges.length, 2)
  assert.equal(new Set(parallel.edges.map((edge) => edge.associationId)).size, 2)
  const recursive = {
    assets: {
      1: {
        name: 'One',
        type: 'Application',
        associated_assets: { appExecutedApps: { 2: 'Two' }, hostApp: { 2: 'Two' } },
      },
      2: {
        name: 'Two',
        type: 'Application',
        associated_assets: { appExecutedApps: { 1: 'One' }, hostApp: { 1: 'One' } },
      },
    },
  }
  const snapshot = parseMalModel(stringify(recursive), languageGraph)
  assert.equal(snapshot.edges.length, 2)
  assert.equal(new Set(snapshot.edges.map((edge) => edge.associationId)).size, 2)
  const single = { assets: { 1: recursive.assets[1] } }
  single.assets[1].associated_assets = { appExecutedApps: { 1: 'One' }, hostApp: { 1: 'One' } }
  assert.equal(parseMalModel(stringify(single), languageGraph).edges.length, 1)
})

test('rejects mismatched language metadata, unknown/abstract asset types, invalid fields and cardinality violations', () => {
  const model = minimalModel()
  model.metadata = { langID: 'wrong.language' }
  assert.throws(() => parseMalModel(stringify(model), languageGraph), /langID.*does not match/)
  model.metadata = { langVersion: '99.0' }
  assert.throws(() => parseMalModel(stringify(model), languageGraph), /langVersion.*does not match/)
  delete model.metadata
  model.assets[0].type = 'MissingType'
  assert.throws(() => parseMalModel(stringify(model), languageGraph), /unknown MAL asset type/)
  model.assets[0].type = 'PhysicalMachine'
  assert.throws(() => parseMalModel(stringify(model), languageGraph), /abstract MAL asset type/)
  model.assets[0].type = 'ECU'
  model.assets[0].associated_assets = { incorrect: { 1: 'Firmware' } }
  assert.throws(() => parseMalModel(stringify(model), languageGraph), /unique association/)
  model.assets[0].associated_assets = { firmware: { 9: 'Missing' } }
  assert.throws(() => parseMalModel(stringify(model), languageGraph), /missing MAL asset ID 9/)
  model.assets[0].associated_assets = { firmware: { 1: 'Firmware' } }
  model.assets[2] = { ...model.assets[0], name: 'Second ECU' }
  assert.throws(() => parseMalModel(stringify(model), languageGraph), /allows at most 1/)
})

test('rejects broken YAML and malformed IDs, asset definitions, coordinates and association mappings', () => {
  const invalid = [
    ['', /assets mapping/],
    ['assets: [', /invalid YAML/],
    ['assets: {}\n---\nassets: {}', /invalid YAML/],
    ['assets: { 1: ECU, 1: Firmware }', /invalid YAML/],
    ['assets: { 1: ECU, "1": Firmware }', /duplicate asset ID/],
    ['assets: { true: ECU }', /IDs must be safe integers/],
    ['assets: { 9007199254740993: ECU }', /IDs must be safe integers/],
    ['assets: { 1: null }', /must be a YAML mapping/],
    ['assets: { 1: {} }', /must define a MAL asset type/],
    ['assets: { 1: { type: ECU, name: 5 } }', /non-empty name/],
    ['assets: { 1: { type: ECU, extras: { description: [] } } }', /description.*must be text/],
    ['assets: { 1: { type: ECU, extras: { dfdShape: cylinder } } }', /invalid DFD shape/],
    ['assets: { 1: { type: ECU, extras: { position: { x: .inf, y: 0 } } } }', /finite numeric/],
    ['assets: { 1: { type: ECU, extras: { position: { x: 1 } } } }', /finite numeric/],
    ['assets: { 1: { type: ECU, associated_assets: { field: [] } } }', /YAML mapping/],
    ['assets: { 1: { type: ECU, associated_assets: { 3: {} } } }', /invalid association field/],
    ['metadata: []\nassets: {}', /metadata must be a YAML mapping/],
    ['metadata: { threatCatalogSchema: 1 }\nassets: {}', /threatCatalogSchema must be text/],
  ]
  for (const [yaml, message] of invalid) assert.throws(() => parseMalModel(yaml), message, yaml)
})

test('Defense activation states survive YAML round trips without filling unknown values', () => {
  const model = minimalModel()
  model.assets[0].defenses = { shield: 1, bypass: 0, uncertain: 0.5, unknown: null }
  const snapshot = parseMalModel(stringify(model), languageGraph)
  assert.deepEqual(snapshot.vertices[0].defenses, model.assets[0].defenses)
  const restored = parse(serializeMalModel(prepareMalExport(snapshot, languageGraph)))
  assert.deepEqual(restored.assets[1].defenses, model.assets[0].defenses)
  for (const value of [-1, 2, 'false', [], {}]) {
    model.assets[0].defenses.shield = value
    assert.throws(() => parseMalModel(stringify(model), languageGraph), /Defense states/)
  }
})

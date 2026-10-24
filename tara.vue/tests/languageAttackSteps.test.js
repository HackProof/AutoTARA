import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { effectScope, nextTick, ref } from 'vue'
import { getAttackSteps } from '../../tara.server/src/modules/catalog/catalog.service.js'
import { getAssetParents, parseLanguageGraph } from '../src/services/languageGraph.js'
import { mergeLanguageAttackSteps } from '../src/services/languageAttackSteps.js'
import { useThreatCatalog } from '../src/services/useThreatCatalog.js'
import {
  assessAssetThreats,
  createCtsaDraft,
  serializeCtsaDraft,
} from '../src/services/ttpScoring.js'
import { prepareMalExport, serializeMalModel } from '../src/services/malModel.js'
import { parseMalModel } from '../src/services/malModelImport.js'

const { languageGraph } = parseLanguageGraph(
  await readFile(new URL('../../sample/vehicleLang_v2-langgraph.json', import.meta.url), 'utf8'),
)
// Original mapping snapshot used to produce the DB's partial Attack Step CSV.
const snapshot = JSON.parse(
  await readFile(
    new URL(
      '../../deprecated/attackpath_toyproject/Data/vehicleLang_coreLang_AttackSteps.json',
      import.meta.url,
    ),
    'utf8',
  ),
)
const dbDefinitions = [
  ...snapshot.vehiclelang.categories.flatMap((category) =>
    category.assets.map((asset) => ({ ...asset, language: category.language })),
  ),
  ...snapshot.corelang.api_attack_step_candidates,
]
const dbRows = dbDefinitions.flatMap((asset) =>
  asset.attack_steps.map((step) => ({
    ...step,
    asset: asset.asset,
    attack_step_id: `${asset.language}:${step.qualified_name}`,
    technique_mappings: step.name === 'fullAccess' ? [{ mitre_technique_id: 'T0801' }] : [],
  })),
)
const database = {
  query: async (sql, params) => ({
    rows: sql.includes('information_schema.columns')
      ? [{ schema: 'vehicle_lang' }]
      : params
        ? dbRows.filter((row) => params[0].includes(row.asset))
        : [],
  }),
}
const assetTypes = languageGraph.assets
  .filter((asset) => !asset.isAbstract)
  .map((asset) => asset.name)
const loadSteps = (schema, names) =>
  getAttackSteps(database, schema, names, getAssetParents(languageGraph))
const partialRows = await loadSteps('vehicle_lang', assetTypes)
const completeRows = mergeLanguageAttackSteps(partialRows, languageGraph, assetTypes)

test('NetworkClient includes Application.localConnect and all 69 attack steps from the attached LangGraph', () => {
  const before = partialRows.filter((step) => step.asset === 'NetworkClient')
  const steps = completeRows.filter((step) => step.asset === 'NetworkClient')
  assert.equal(before.length, 17)
  assert.equal(steps.length, 69)
  const localConnect = steps.find((step) => step.name === 'localConnect')
  assert.equal(localConnect.declared_asset, 'Application')
  assert.equal(localConnect.inheritance_depth, 3)
  assert.equal(localConnect.qualified_name, 'Application.localConnect')
  assert.match(localConnect.definition, /without going through networking/)
  assert.deepEqual(localConnect.technique_mappings, [])
  const applicationStep = completeRows.find(
    (step) => step.asset === 'Application' && step.name === 'localConnect',
  )
  assert.equal(applicationStep.attack_step_id, localConnect.attack_step_id)
  for (const name of [
    'networkConnect',
    'localAccess',
    'unsafeUserActivity',
    'attemptUseVulnerability',
  ]) {
    assert.ok(
      steps.some((step) => step.name === name),
      name,
    )
  }
  const fullAccess = steps.find((step) => step.name === 'fullAccess')
  assert.equal(fullAccess.attack_step_id, 'VehicleLang:NetworkClient.fullAccess')
  assert.deepEqual(fullAccess.technique_mappings, [{ mitre_technique_id: 'T0801' }])
})

test('every concrete sample asset has exactly its LangGraph OR/AND steps, with no duplicates or defense/condition nodes', () => {
  assert.equal(assetTypes.length, 49)
  for (const type of assetTypes) {
    const asset = languageGraph.assets.find((asset) => asset.name === type)
    const expected = Object.entries(asset.attack_steps)
      .filter(([, step]) => ['or', 'and'].includes(step.type))
      .map(([name]) => name)
      .sort()
    const actual = completeRows.filter((step) => step.asset === type)
    assert.deepEqual(actual.map((step) => step.name).sort(), expected, type)
    assert.equal(new Set(actual.map((step) => step.attack_step_id)).size, expected.length, type)
    assert.ok(actual.every((step) => step.riskScore === null))
  }
  assert.equal(completeRows.filter((step) => step.asset === 'ECU').length, 46)
})

test('explicit child overrides do not borrow parent mappings, and normalized declaration catalogs inherit all parent steps', () => {
  const graph = {
    metadata: { id: 'custom' },
    assets: [
      {
        name: 'Parent',
        attack_steps: {
          access: { type: 'or' },
          inherited: { type: 'and', info: { user: 'Inherited step' } },
          protection: { type: 'defense' },
          condition: { type: 'exist' },
        },
      },
      {
        name: 'Child',
        extends: 'Parent',
        attackSteps: [
          { name: 'access', type: 'OR', overrides: true },
          { name: 'inherited', type: 'AND', inherits: 'Parent:inherited' },
          { name: 'own', type: 'or', tags: ['hidden', 'auxiliary'] },
        ],
      },
    ],
  }
  const mapping = [{ mitre_technique_id: 'T0801' }]
  const rows = [
    {
      asset: 'Child',
      name: 'access',
      declared_asset: 'Parent',
      attack_step_id: 'DB:Parent.access',
      technique_mappings: mapping,
    },
    {
      asset: 'Child',
      name: 'inherited',
      declared_asset: 'Parent',
      attack_step_id: 'DB:Parent.inherited',
      technique_mappings: mapping,
    },
    {
      asset: 'Child',
      name: 'obsolete',
      declared_asset: 'Child',
      attack_step_id: 'DB:Child.obsolete',
    },
  ]
  const before = structuredClone(rows)
  const steps = mergeLanguageAttackSteps(rows, graph, ['Child'])
  assert.deepEqual(
    steps.map((step) => step.name),
    ['access', 'inherited', 'own'],
  )
  assert.equal(steps[0].attack_step_id, 'LangGraph:custom:Child.access')
  assert.deepEqual(steps[0].technique_mappings, [])
  assert.equal(steps[1].attack_step_id, 'DB:Parent.inherited')
  assert.deepEqual(steps[1].technique_mappings, mapping)
  assert.equal(steps[2].hidden, true)
  assert.equal(steps[2].auxiliary, true)
  assert.deepEqual(rows, before)
  graph.assets[1].attackSteps = []
  assert.deepEqual(
    mergeLanguageAttackSteps(rows, graph, ['Child']).map((step) => step.name),
    ['access', 'inherited'],
  )
})

test('diagrams without LangGraph step definitions retain the DB catalog', () => {
  assert.equal(mergeLanguageAttackSteps(partialRows, null, assetTypes), partialRows)
  const graph = { assets: [{ name: 'NetworkClient' }] }
  assert.deepEqual(
    mergeLanguageAttackSteps(partialRows, graph, ['NetworkClient']),
    partialRows.filter((row) => row.asset === 'NetworkClient'),
  )
})

test('the shared threat catalog exposes complete steps and reloads a new LangGraph with the same ancestry', async () => {
  const graph = ref(languageGraph)
  const scope = effectScope()
  const catalog = scope.run(() =>
    useThreatCatalog('vehicle_lang', ['NetworkClient'], {
      languageGraph: graph,
      load: loadSteps,
    }),
  )
  try {
    await setImmediate()
    assert.equal(catalog.assets.value.get('NetworkClient').length, 69)
    const changed = structuredClone(languageGraph)
    changed.assets.find((asset) => asset.name === 'NetworkClient').attack_steps.newStep = {
      name: 'newStep',
      type: 'or',
    }
    graph.value = changed
    await nextTick()
    await setImmediate()
    assert.equal(catalog.assets.value.get('NetworkClient').length, 70)
  } finally {
    scope.stop()
  }
})

test('newly discovered steps can be assessed and persisted as Entry/Target points through MAL YAML', () => {
  const localConnect = completeRows.find(
    (step) => step.asset === 'NetworkClient' && step.name === 'localConnect',
  )
  const draft = createCtsaDraft([localConnect])
  for (const factor of draft.threats[0].factors) factor.value = 3
  const assessments = serializeCtsaDraft(draft)
  assert.equal(assessAssetThreats([localConnect], assessments)[0].riskScore, 3)
  const endpoint = { attackStepId: localConnect.attack_step_id, name: localConnect.name }
  const attackEndpoints = { vehicle_lang: { entry: [endpoint], target: [endpoint] } }
  const snapshot = {
    vertices: [
      {
        id: 'client',
        label: 'Client',
        kind: 'asset',
        assetType: 'NetworkClient',
        attackEndpoints,
        threatAssessments: { vehicle_lang: assessments },
      },
    ],
    edges: [],
    metadata: { threatCatalogSchema: 'vehicle_lang' },
  }
  const restored = parseMalModel(
    serializeMalModel(prepareMalExport(snapshot, languageGraph)),
    languageGraph,
  )
  assert.deepEqual(restored.vertices[0].attackEndpoints, attackEndpoints)
  assert.equal(
    restored.vertices[0].threatAssessments.vehicle_lang.riskScores[localConnect.attack_step_id],
    3,
  )
})

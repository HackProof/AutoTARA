import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { parseLanguageGraph } from '../src/services/languageGraph.js'
import { parseMalModel } from '../src/services/malModelImport.js'
import { createAssociationMatcher } from '../src/services/associations.js'
import { createTtpFactors, createTtpWeights } from '../src/services/ttpScoring.js'
import { buildAttackGraph, attackNodeId } from '../src/services/attackGraph.js'
import { findAttackPaths, buildPathPrerequisites } from '../src/services/attackPaths.js'

function graph(types, edges, entries = ['0'], targets = ['3']) {
  return {
    nodes: types.map((type, index) => ({ id: String(index), type, fullName: `Asset:s${index}` })),
    edges: edges.map(([source, target]) => ({ source: String(source), target: String(target) })),
    entryIds: entries,
    targetIds: targets,
  }
}
const pathKeys = (paths) => paths.map((path) => JSON.stringify(path)).sort()

test('graph Risk Values use saved factors for the matching instance, schema and inherited declaration', () => {
  const factors = (value) => createTtpFactors().map((factor) => ({ ...factor, value }))
  const language = {
    metadata: { id: 'test', version: '1' },
    assets: [
      {
        name: 'Parent',
        attack_steps: {
          start: { type: 'or', own_children: { 'Parent:gate': [null] } },
          gate: { type: 'and', own_children: { 'Parent:target': [null] } },
          support: { type: 'or', own_children: { 'Parent:gate': [null] } },
          target: { type: 'or', own_children: {} },
        },
      },
      {
        name: 'Child',
        super_asset: 'Parent',
        attack_steps: {
          support: { type: 'or', overrides: true, own_children: { 'Parent:gate': [null] } },
        },
      },
    ],
  }
  const snapshot = {
    vertices: ['a', 'b'].map((id, index) => ({
      id,
      label: 'Same',
      assetType: 'Child',
      threatAssessments: {
        active: {
          version: 2,
          weights: createTtpWeights(),
          steps: {
            'Catalog:Parent.start': factors(index ? 1 : 4),
            'Catalog:Parent.gate': factors(3),
            'Catalog:Parent.support': factors(5),
            'Catalog:Parent.target': factors(null),
          },
          riskScores: { 'Catalog:Parent.start': 99, 'Catalog:Parent.target': 5 },
        },
        other: {
          version: 2,
          weights: createTtpWeights(),
          steps: { 'Catalog:Parent.target': factors(5) },
        },
      },
      attackEndpoints: {
        active: {
          entry: [
            { attackStepId: 'Catalog:Parent.start', name: 'start' },
            { attackStepId: 'Catalog:Child.support', name: 'support' },
          ],
          target: [{ attackStepId: 'Catalog:Parent.target', name: 'target' }],
        },
      },
    })),
    edges: [],
  }
  const before = structuredClone(snapshot)
  const data = buildAttackGraph(snapshot, language, 'active')
  const score = (asset, name) =>
    data.nodes.find((node) => node.id === attackNodeId(asset, name)).riskScore
  assert.equal(score('a', 'start'), 4)
  assert.equal(score('b', 'start'), 1)
  assert.equal(score('a', 'gate'), 3)
  assert.equal(score('a', 'support'), null) // A child override cannot borrow its parent's assessment.
  assert.equal(score('a', 'target'), null) // Neither cached nor other-schema scores can fill missing factors.
  assert.deepEqual(snapshot, before)
  const path = findAttackPaths(data).paths.find((path) => path[0] === attackNodeId('a', 'start'))
  assert.equal(buildPathPrerequisites(data, path).requirements[0].node.riskScore, 3)

  const saved = snapshot.vertices[0].threatAssessments.active
  saved.steps['Opaque catalog ID'] = factors(2)
  saved.steps['Alternative:Parent.gate'] = factors(5)
  // Conflicting readable declarations are not guessed when the catalog is absent.
  assert.equal(
    buildAttackGraph(snapshot, language, 'active').nodes.find(
      (node) => node.id === attackNodeId('a', 'gate'),
    ).riskScore,
    null,
  )
  const catalog = [
    {
      asset: 'Child',
      declared_asset: 'Parent',
      name: 'gate',
      attack_step_id: 'Opaque catalog ID',
      qualified_name: 'Parent.gate',
    },
  ]
  assert.equal(
    buildAttackGraph(snapshot, language, 'active', catalog).nodes.find(
      (node) => node.id === attackNodeId('a', 'gate'),
    ).riskScore,
    2,
  )
  saved.steps['Opaque catalog ID'] = factors(null)
  assert.equal(
    buildAttackGraph(snapshot, language, 'active', catalog).nodes.find(
      (node) => node.id === attackNodeId('a', 'gate'),
    ).riskScore,
    null,
  )
})
function occurrences(requirements) {
  return requirements.flatMap((item) => [item, ...occurrences(item.children)])
}

test('structural candidates retain unavailable AND support and condition explanations', () => {
  const data = graph(
    ['or', 'and', 'or', 'or', 'or', 'defense', 'exist'],
    [
      [0, 1],
      [1, 3],
      [0, 2],
      [2, 3],
      [4, 1],
      [5, 1],
      [6, 1],
    ],
  )
  assert.deepEqual(
    pathKeys(findAttackPaths(data).paths),
    pathKeys([
      ['0', '1', '3'],
      ['0', '2', '3'],
    ]),
  )
  assert.equal(findAttackPaths(data).metrics[0].status, 'infeasible')
  const items = occurrences(buildPathPrerequisites(data, ['0', '1', '3']).requirements)
  assert.equal(items.find((item) => item.node.id === '0').terminal, 'earlier')
  assert.equal(items.find((item) => item.node.id === '4').terminal, 'external')
  assert.equal(items.find((item) => item.node.id === '6').terminal, 'condition')
  assert.equal(items.find((item) => item.node.type === 'defense').terminal, 'condition')
  data.nodes[5].enabled = true
  data.nodes[6].existenceStatus = true
  assert.equal(findAttackPaths(data).paths.length, 2)
  data.nodes[5].enabled = false
  data.entryIds.push('4')
  assert.equal(findAttackPaths(data).paths.length, 3)
})

test('nested AND/OR branches, selected Entries, earlier references and cycles remain distinct', () => {
  const data = graph(
    ['or', 'and', 'and', 'or', 'or', 'or', 'or'],
    [
      [0, 1],
      [1, 3],
      [2, 1],
      [4, 2],
      [5, 2],
      [6, 4],
      [0, 4],
      [2, 6],
    ],
    ['0', '5'],
  )
  const items = occurrences(buildPathPrerequisites(data, ['0', '1', '3']).requirements)
  assert.equal(items.find((item) => item.node.id === '2').node.type, 'and')
  assert.equal(items.find((item) => item.node.id === '4').children.length, 2)
  assert(items.some((item) => item.terminal === 'cycle'))
  assert(items.some((item) => item.node.id === '5' && item.terminal === 'entry'))
  assert(items.some((item) => item.node.id === '0' && item.terminal === 'earlier'))
  assert(items.length < 20)
})

test('a later step on the primary path cannot prove an earlier AND prerequisite', () => {
  const data = graph(
    ['or', 'and', 'or', 'or'],
    [
      [0, 1],
      [1, 2],
      [2, 1],
      [2, 3],
    ],
  )
  const items = occurrences(buildPathPrerequisites(data, ['0', '1', '2', '3']).requirements)
  assert.notEqual(items.find((item) => item.node.id === '2').terminal, 'earlier')
  assert(items.some((item) => item.terminal === 'cycle'))
})

test('bounded prerequisite display preserves sibling inputs and reports omissions', () => {
  const data = graph(
    ['or', 'and', 'or', 'or', 'or', 'or', 'or'],
    [
      [0, 1],
      [1, 3],
      [2, 1],
      [4, 1],
      [5, 2],
      [6, 5],
    ],
  )
  const result = buildPathPrerequisites(data, ['0', '1', '3'], { maxNodes: 3 })
  assert.equal(result.truncated, true)
  assert.deepEqual(
    result.requirements[0].children.map((item) => item.node.id),
    ['0', '2', '4'],
  )
  assert.equal(result.requirements[0].children[1].omitted, 1)
})

test('multiple endpoints share a per-Target cap, including zero-hop and disconnected targets', () => {
  const data = graph(
    ['or', 'or', 'or', 'or', 'or'],
    [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
    ['0', '2'],
    ['2', '3', '4'],
  )
  const result = findAttackPaths(data, { maxPaths: 1 })
  assert.deepEqual(result.paths, [['2'], ['2', '3']])
  assert.deepEqual(
    result.targetResults.map((item) => item.pathCount),
    [1, 1, 0],
  )
  assert.deepEqual(findAttackPaths(data, { maxHops: 0 }).paths, [['2']])
  assert.equal(findAttackPaths(data, { maxExpansions: 1 }).targetResults[2].stopReason, 'workLimit')
})

test('limits and missing endpoints fail explicitly', () => {
  const data = graph(['or', 'or', 'or', 'or'], [[0, 3]])
  for (const options of [
    { maxPaths: 0 },
    { maxPaths: 101 },
    { maxHops: -1 },
    { maxHops: 201 },
    { maxHops: 1.5 },
    { maxPaths: '' },
  ])
    assert.throws(() => findAttackPaths(data, options), /integer/)
  assert.throws(() => findAttackPaths({ ...data, entryIds: ['missing'] }), /missing/)
})

test('shortest simple paths agree with exhaustive enumeration on cyclic graphs', () => {
  let seed = 125
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
  for (let trial = 0; trial < 60; trial++) {
    const edges = []
    for (let a = 0; a < 6; a++)
      for (let b = 0; b < 6; b++) if (a !== b && random() < 0.25) edges.push([a, b])
    const data = graph(['or', 'and', 'or', 'or', 'or', 'or'], edges, ['0', '2'], ['5'])
    const expected = []
    function visit(path) {
      if (path.at(-1) === '5') {
        expected.push(path)
        return
      }
      if (path.length > 4) return
      for (const edge of data.edges)
        if (edge.source === path.at(-1) && !path.includes(edge.target))
          visit([...path, edge.target])
    }
    for (const entry of data.entryIds) visit([entry])
    const all = findAttackPaths(data, { maxHops: 4, maxPaths: 100 }).paths
    assert.deepEqual(pathKeys(all), pathKeys(expected), `trial ${trial}`)
    const limited = findAttackPaths(data, { maxHops: 4, maxPaths: 3 }).paths
    assert.deepEqual(
      limited.map((path) => path.length),
      expected
        .map((path) => path.length)
        .sort((a, b) => a - b)
        .slice(0, 3),
    )
  }
})

const sampleText = (name) => readFileSync(new URL(`../../sample/${name}`, import.meta.url), 'utf8')
function sample() {
  const language = parseLanguageGraph(sampleText('vehicleLang_v2-langgraph.json')).languageGraph
  const snapshot = parseMalModel(sampleText('Tesla_Model_S_MAL_Model.yaml'), language)
  snapshot.vertices.find((asset) => asset.label === 'Center Information Display').attackEndpoints =
    {
      vehicle_lang: { entry: [{ attackStepId: 'inherited-catalog-id', name: 'connect' }] },
      other_schema: { target: [{ attackStepId: 'unused', name: 'missingStep' }] },
    }
  snapshot.vertices.find((asset) => asset.label === 'ESP ECU').attackEndpoints = {
    vehicle_lang: { target: [{ attackStepId: 'target-catalog-id', name: 'fullAccess' }] },
  }
  return { language, snapshot }
}

test('Tesla model instantiation exactly matches the reference attack graph, including inherited edges', () => {
  const { language, snapshot } = sample()
  const data = buildAttackGraph(snapshot, language, 'vehicle_lang')
  const expected = parse(sampleText('Tesla_Model_S_attackgraph.yml')).attack_steps
  const actualNodes = new Map(data.nodes.map((node) => [node.id, node]))
  assert.equal(data.nodes.length, 1015)
  assert.equal(data.edges.length, 1450)
  assert.deepEqual(new Set(data.nodes.map((node) => node.fullName)), new Set(Object.keys(expected)))
  for (const node of data.nodes) {
    assert.equal(node.type, expected[node.fullName].type.toLowerCase())
    if (node.existenceStatus !== undefined)
      assert.equal(node.existenceStatus, expected[node.fullName].existence_status)
  }
  assert.deepEqual(
    new Set(
      data.edges.map(({ source, target }) =>
        JSON.stringify([actualNodes.get(source).fullName, actualNodes.get(target).fullName]),
      ),
    ),
    new Set(
      Object.entries(expected).flatMap(([name, node]) =>
        Object.values(node.children).map((child) => JSON.stringify([name, child])),
      ),
    ),
  )
  const result = findAttackPaths(data)
  // Structural candidates remain available even with unseeded support.
  assert.equal(result.paths.length, 30)
  assert.equal(result.metrics[0].routeHops, 22)
  assert(result.metrics.every((metric) => metric.status === 'infeasible'))
  assert.equal(result.targetResults[0].feasibility, 'infeasible')
  assert(result.unknownConditionIds.length > 0)
  assert.equal(data.entryIds.length, 1)
})

test('stale endpoints and incomplete association choices report actionable errors', () => {
  const { language, snapshot } = sample()
  snapshot.vertices[0].attackEndpoints = {
    vehicle_lang: { target: [{ attackStepId: 'old', name: 'missing' }] },
  }
  assert.throws(() => buildAttackGraph(snapshot, language, 'vehicle_lang'), /Select it again/)
  delete snapshot.vertices[0].attackEndpoints
  snapshot.edges[0].associationId = 'invalid-association'
  assert.throws(() => buildAttackGraph(snapshot, language, 'vehicle_lang'), /Choose an association/)
})

test('instance IDs disambiguate duplicate asset names and catalog declaration IDs', () => {
  const language = {
    metadata: { id: 'test', version: '1' },
    assets: [
      {
        name: 'Asset',
        attack_steps: {
          entry: { type: 'or', own_children: { 'Asset:target': [null] } },
          target: { type: 'and', own_children: {} },
        },
      },
    ],
  }
  const snapshot = {
    vertices: ['a', 'b'].map((id) => ({
      id,
      assetType: 'Asset',
      label: 'Same',
      attackEndpoints: {
        schema: {
          entry: [{ attackStepId: 'shared-id', name: 'entry' }],
          target: [{ attackStepId: 'shared-target-id', name: 'target' }],
        },
      },
    })),
    edges: [],
  }
  const data = buildAttackGraph(snapshot, language, 'schema')
  assert.equal(data.entryIds.length, 2)
  assert.deepEqual(
    pathKeys(findAttackPaths(data).paths),
    pathKeys(['a', 'b'].map((id) => [attackNodeId(id, 'entry'), attackNodeId(id, 'target')])),
  )
  language.assets[0].attack_steps.entry.own_children['Asset:target'] = [{ type: 'unsupported' }]
  assert.throws(() => buildAttackGraph(snapshot, language, 'schema'), /Unsupported MAL association/)
})

test('association expressions resolve sets, composition, subtype and transitive cycles on instances', () => {
  const field = (fieldname) => ({ type: 'field', Link: { fieldname, 'asset type': 'Node' } })
  const children = field('children'),
    parents = field('parents')
  const subtype = { type: 'subType', subType: 'Special', expression: children }
  const binary = (type, left, right) => ({ type, [type]: { left, right } })
  const expressions = {
    union: binary('union', parents, children),
    intersection: binary('intersection', children, subtype),
    difference: binary('difference', children, subtype),
    collect: binary('collect', children, children),
    transitive: { type: 'transitive', transitive: children },
    subtype,
  }
  const language = {
    metadata: { id: 'test', version: '1' },
    assets: [
      {
        name: 'Node',
        associations: {
          children: {
            name: 'Link',
            left: { asset: 'Node', fieldname: 'parents' },
            right: { asset: 'Node', fieldname: 'children' },
          },
        },
        attack_steps: {
          target: { type: 'or', own_children: {} },
          ...Object.fromEntries(
            Object.entries(expressions).map(([name, expression]) => [
              name,
              { type: 'or', own_children: { 'Node:target': [expression] } },
            ]),
          ),
        },
      },
      { name: 'Special', super_asset: 'Node', attack_steps: {} },
    ],
  }
  const associationId = createAssociationMatcher(language)
    .getAssociations('Node', 'Node')
    .find((a) => a.sourceField === 'children').id
  const snapshot = {
    vertices: ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      label: id,
      assetType: ['c', 'd'].includes(id) ? 'Special' : 'Node',
    })),
    edges: [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'd'],
      ['d', 'a'],
    ].map(([source, target], i) => ({ id: String(i), source, target, associationId })),
  }
  snapshot.vertices[0].attackEndpoints = {
    schema: {
      entry: [{ attackStepId: 'e', name: 'transitive' }],
      target: [{ attackStepId: 't', name: 'target' }],
    },
  }
  const data = buildAttackGraph(snapshot, language, 'schema')
  const targets = (name) =>
    data.edges
      .filter((e) => e.source === attackNodeId('a', name))
      .map((e) => JSON.parse(e.target)[0])
      .sort()
  assert.deepEqual(targets('union'), ['b', 'c', 'd'])
  assert.deepEqual(targets('intersection'), ['c'])
  assert.deepEqual(targets('difference'), ['b'])
  assert.deepEqual(targets('collect'), ['d'])
  assert.deepEqual(targets('subtype'), ['c'])
  assert.deepEqual(targets('transitive'), ['a', 'b', 'c', 'd'])
})

test('overriding outgoing steps replaces inherited children and cyclic inheritance fails', () => {
  const language = {
    metadata: { id: 'test', version: '1' },
    assets: [
      {
        name: 'Base',
        attack_steps: {
          start: { type: 'or', own_children: { 'Base:old': [null] } },
          old: { type: 'or', own_children: {} },
        },
      },
      {
        name: 'Child',
        super_asset: 'Base',
        attack_steps: {
          start: {
            type: 'or',
            inherits: 'Base:start',
            overrides: true,
            own_children: { 'Child:target': [null] },
          },
          target: { type: 'or', own_children: {} },
        },
      },
    ],
  }
  const snapshot = {
    vertices: [
      {
        id: 'a',
        label: 'a',
        assetType: 'Child',
        attackEndpoints: {
          schema: {
            entry: [{ attackStepId: 'e', name: 'start' }],
            target: [{ attackStepId: 't', name: 'target' }],
          },
        },
      },
    ],
    edges: [],
  }
  const targets = () =>
    buildAttackGraph(snapshot, language, 'schema')
      .edges.map((e) => JSON.parse(e.target)[1])
      .sort()
  assert.deepEqual(targets(), ['target'])
  language.assets[1].attack_steps.start.overrides = false
  assert.deepEqual(targets(), ['old', 'target'])
  language.assets[0].attack_steps.start.inherits = 'Child:start'
  assert.throws(targets, /Cyclic MAL attack step/)
})

test('graph preserves model defense overrides, deterministic TTC defaults and causal mode', () => {
  const language = {
    metadata: { id: 'test', version: '1' },
    assets: [
      {
        name: 'Asset',
        attack_steps: {
          entry: { type: 'or', causal_mode: 'action', own_children: { 'Asset:target': [null] } },
          target: { type: 'and', causal_mode: 'effect', own_children: {} },
          shield: {
            type: 'defense',
            ttc: { type: 'function', name: 'Enabled', arguments: [] },
            own_children: { 'Asset:target': [null] },
          },
        },
      },
    ],
  }
  const snapshot = {
    vertices: ['a', 'b', 'c'].map((id) => ({
      id,
      label: id,
      assetType: 'Asset',
      ...(id === 'a'
        ? { defenses: { shield: 0 } }
        : id === 'c'
          ? { defenses: { shield: 0.5 } }
          : {}),
      attackEndpoints: {
        schema: {
          entry: [{ attackStepId: 'e', name: 'entry' }],
          target: [{ attackStepId: 't', name: 'target' }],
        },
      },
    })),
    edges: [],
  }
  const data = buildAttackGraph(snapshot, language, 'schema')
  const node = (asset, name) => data.nodes.find((n) => n.id === attackNodeId(asset, name))
  assert.equal(node('a', 'shield').defenseStatus, false)
  assert.equal(node('b', 'shield').defenseStatus, true)
  assert.equal(node('c', 'shield').defenseStatus, null)
  assert.equal(node('a', 'entry').causalMode, 'action')
  assert.equal(node('a', 'target').causalMode, 'effect')
  const result = findAttackPaths(data)
  assert.deepEqual(
    result.paths,
    ['a', 'b', 'c'].map((id) => [attackNodeId(id, 'entry'), attackNodeId(id, 'target')]),
  )
  assert.deepEqual(
    result.metrics.map((metric) => metric.status),
    ['feasible', 'infeasible', 'unresolved'],
  )
  assert.deepEqual(
    result.targetResults.map((target) => target.feasibility),
    ['feasible', 'infeasible', 'unresolved'],
  )
  language.assets[0].attack_steps.shield.ttc.name = 'Disabled'
  assert.equal(
    buildAttackGraph(snapshot, language, 'schema').nodes.find(
      (n) => n.id === attackNodeId('b', 'shield'),
    ).defenseStatus,
    false,
  )
})

test('the per-Target cap has no per-Entry quota', () => {
  const data = graph(
    ['or', 'or', 'or', 'or', 'or', 'or', 'or'],
    [
      [0, 1],
      [1, 3],
      [0, 2],
      [2, 3],
      [4, 5],
      [5, 6],
      [6, 3],
    ],
    ['0', '4'],
  )
  const result = findAttackPaths(data, { maxPaths: 2 })
  assert(result.paths.every((path) => path[0] === '0'))
  assert.equal(result.hopRankingScope, 'per-target-across-entries')
})

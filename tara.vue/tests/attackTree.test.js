import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildCandidateAttackTree,
  describeTreeOccurrence,
  initialCollapsedBranches,
  layoutAttackTree,
  treeNodeLabel,
  treeNodeHtmlLabel,
} from '../src/services/attackTree.js'
import { findAttackPaths } from '../src/services/attackPaths.js'
import { buildAttackGraph } from '../src/services/attackGraph.js'
import { parseLanguageGraph } from '../src/services/languageGraph.js'
import { parseMalModel } from '../src/services/malModelImport.js'

function graph(types, edges, entryIds = ['0'], targetIds = ['3']) {
  return {
    nodes: types.map((type, index) => ({
      id: String(index),
      name: `step${index}`,
      asset: 'ECU',
      fullName: `ECU:step${index}`,
      type,
    })),
    edges: edges.map(([source, target]) => ({ source: String(source), target: String(target) })),
    entryIds,
    targetIds,
  }
}
const fixture = () =>
  graph(
    ['or', 'and', 'or', 'or', 'or', 'or', 'defense'],
    [
      [0, 1],
      [1, 3],
      [2, 1],
      [4, 2],
      [5, 2],
      [6, 1],
      [0, 3],
    ],
  )

test('tree labels emphasize asset/step names, escape markup and preserve scored badges on every occurrence', () => {
  const data = fixture()
  data.nodes[0].asset = '<svg onload="run()">'
  data.nodes[0].name = 'drive & <attack>'
  data.nodes[0].riskScore = 3.5
  data.nodes[2].riskScore = 4
  const tree = buildCandidateAttackTree(data, ['0', '1', '3'])
  const entry = tree.occurrences.find((item) => item.node.id === '0')
  const support = tree.occurrences.find((item) => item.node.id === '2')
  const label = treeNodeHtmlLabel(entry)
  assert.match(label, /<strong>&lt;svg onload=&quot;run\(\)&quot;&gt;<\/strong>/)
  assert.match(label, /<strong>drive &amp; &lt;attack&gt;<\/strong>/)
  assert(!label.includes('<svg'))
  assert.match(label, /Risk Value: 3\.5/)
  assert.match(label, /<span class="badge rounded-pill [^"]+"[^>]*>Risk Value: 3\.5<\/span>/)
  assert(!label.includes('<strong>Risk Value'))
  assert.match(treeNodeLabel(support), /Risk Value: 4\.0/)
  assert.match(treeNodeHtmlLabel(support, true), /Risk Value: 4\.0/)
  for (const score of [null, undefined, NaN, Infinity]) {
    const item = { ...entry, node: { ...entry.node, riskScore: score } }
    assert(!treeNodeHtmlLabel(item).includes('Risk Value'))
  }
  assert.match(
    treeNodeLabel({ ...entry, node: { ...entry.node, riskScore: 0 } }),
    /Risk Value: 0\.0/,
  )
})

test('Risk Value adds room to a tree node', () => {
  const data = graph(['or'], [], ['0'], ['0'])
  const unscored = layoutAttackTree(buildCandidateAttackTree(data, ['0'])).nodes[0]
  data.nodes[0].riskScore = 2.5
  const scored = layoutAttackTree(buildCandidateAttackTree(data, ['0'])).nodes[0]
  assert(scored.height > unscored.height)
  assert.equal(scored.label.split('\n').length, unscored.label.split('\n').length + 1)
  assert.match(scored.htmlLabel, /Risk Value: 2\.5/)
})

test('a selected candidate unfolds Target to Entry and attaches AND inputs with OR alternatives', () => {
  const data = fixture(),
    before = structuredClone(data)
  const tree = buildCandidateAttackTree(data, ['0', '1', '3'])
  assert.equal(tree.root.node.id, '3')
  assert.equal(tree.root.isTarget, true)
  assert.deepEqual(
    tree.root.children.map((item) => item.node.id),
    ['1'],
  )
  const gate = tree.root.children[0]
  assert.deepEqual(
    gate.children.map((item) => item.node.id),
    ['0', '2', '6'],
  )
  assert.equal(gate.children[0].terminal, 'entry')
  assert.equal(gate.children[1].role, 'support')
  assert.deepEqual(
    gate.children[1].children.map((item) => item.node.id),
    ['4', '5'],
  )
  assert.match(describeTreeOccurrence(gate.children[1]), /one alternative/)
  assert.equal(
    tree.occurrences.some((item) => item.node.type === 'defense'),
    true,
  )
  assert.equal(new Set(tree.occurrences.map((item) => item.id)).size, tree.occurrences.length)
  assert.deepEqual(data, before)
  assert.deepEqual(
    buildCandidateAttackTree(data, ['0', '3']).occurrences.map((item) => item.node.id),
    ['0', '3'],
  )
})

test('repeated prerequisite references and cycles remain separate occurrences', () => {
  const data = graph(
    ['or', 'and', 'or', 'or'],
    [
      [0, 1],
      [1, 3],
      [2, 1],
      [0, 2],
      [1, 2],
    ],
  )
  const tree = buildCandidateAttackTree(data, ['0', '1', '3'])
  const entryCopies = tree.occurrences.filter((item) => item.node.id === '0')
  assert.equal(entryCopies.length, 2)
  assert.notEqual(entryCopies[0].id, entryCopies[1].id)
  assert.equal(entryCopies[1].terminal, 'earlier')
  assert.match(describeTreeOccurrence(entryCopies[1]), /before the AND/)
  assert(tree.occurrences.some((item) => item.terminal === 'cycle' && item.children.length === 0))
  const layout = layoutAttackTree(tree)
  assert.equal(layout.edges.length, layout.nodes.length - 1)
  assert.equal(new Set(layout.edges.map((edge) => edge.source)).size, layout.edges.length)
})

test('collapse/expand preserves underlying prerequisites, visible edges and non-overlapping positions', () => {
  const tree = buildCandidateAttackTree(fixture(), ['0', '1', '3'])
  const collapsed = initialCollapsedBranches(tree),
    before = structuredClone(tree)
  assert.equal(collapsed.size, 1)
  const compact = layoutAttackTree(tree, collapsed),
    expanded = layoutAttackTree(tree)
  assert.equal(compact.nodes.length, 5)
  assert.equal(expanded.nodes.length, 7)
  for (const layout of [compact, expanded]) {
    const nodes = new Map(layout.nodes.map((placed) => [placed.item.id, placed]))
    for (const edge of layout.edges) {
      const child = nodes.get(edge.source),
        parent = nodes.get(edge.target)
      assert(child.y > parent.y + parent.height)
    }
    for (const a of layout.nodes)
      for (const b of layout.nodes) {
        if (a.item.id === b.item.id) continue
        assert(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        )
      }
  }
  assert.match(
    compact.nodes.find((placed) => placed.item.node.id === '2').label,
    /\+ 2 alternatives/,
  )
  assert.deepEqual(tree, before)
})

test('support limits never remove the main candidate and omissions are explicitly represented', () => {
  const tree = buildCandidateAttackTree(fixture(), ['0', '1', '3'], { maxNodes: 1 })
  assert.equal(tree.truncated, true)
  assert.deepEqual(
    tree.occurrences.filter((item) => item.role === 'primary').map((item) => item.node.id),
    ['0', '1', '3'],
  )
  assert.equal(tree.root.children[0].omitted, 2)
  assert.match(treeNodeLabel(tree.root.children[0]), /2 branches omitted/)
  const onlyPath = graph(
    ['or', 'and', 'and', 'or'],
    [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
  )
  const complete = buildCandidateAttackTree(onlyPath, ['0', '1', '2', '3'], { maxNodes: 1 })
  assert.equal(complete.truncated, false)
})

test('zero-hop, absent paths, and malformed candidates are handled without inventing edges', () => {
  const data = fixture()
  const empty = buildCandidateAttackTree(data, [])
  assert.deepEqual(layoutAttackTree(empty), { nodes: [], edges: [] })
  data.targetIds.push('0')
  const tree = buildCandidateAttackTree(data, ['0'])
  assert.equal(tree.occurrences.length, 1)
  assert.match(describeTreeOccurrence(tree.root), /Entry and Target/)
  for (const path of [['0', '2', '3'], ['0', '1', '0', '3'], ['missing'], ['2', '1', '3']])
    assert.throws(() => buildCandidateAttackTree(data, path), /valid Entry-to-Target/)
})

test('Tesla candidate trees retain their exact primary chain and stay bounded', () => {
  const text = (name) => readFileSync(new URL(`../../sample/${name}`, import.meta.url), 'utf8')
  const language = parseLanguageGraph(text('vehicleLang_v2-langgraph.json')).languageGraph
  const snapshot = parseMalModel(text('Tesla_Model_S_MAL_Model.yaml'), language)
  for (const [name, role, step] of [
    ['ESP ECU', 'entry', 'bypassAccessControl'],
    ['ESP ECU', 'target', 'fullAccess'],
  ]) {
    const asset = snapshot.vertices.find((asset) => asset.label === name)
    asset.attackEndpoints ||= { schema: {} }
    asset.attackEndpoints.schema[role] = [{ attackStepId: step, name: step }]
  }
  const data = buildAttackGraph(snapshot, language, 'schema')
  const result = findAttackPaths(data, { maxPaths: 3 })
  assert(result.paths.length > 0)
  for (const path of result.paths) {
    const tree = buildCandidateAttackTree(data, path)
    const actual = []
    let item = tree.root
    while (item) {
      actual.push(item.node.id)
      item = item.children.find((child) => child.role === 'primary')
    }
    assert.deepEqual(actual.reverse(), path)
    assert(tree.occurrences.length <= path.length + 500)
    assert.equal(layoutAttackTree(tree).edges.length, tree.occurrences.length - 1)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { routeSimulationConnection } from '../src/services/simulationRouting.js'
import {
  buildSimulationResultGraph,
  layoutSimulationResult,
} from '../src/services/simulationResult.js'

const middle = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
function assertClear(source, target, obstacles) {
  const route = routeSimulationConnection(source, target, obstacles)
  assert(route.length > 0, 'blocked connections must have a detour')
  const points = [middle(source), ...route, middle(target)]
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1],
      b = points[index]
    for (let sample = 0; sample <= 200; sample++) {
      const x = a.x + ((b.x - a.x) * sample) / 200,
        y = a.y + ((b.y - a.y) * sample) / 200
      assert(
        !obstacles.some(
          (rect) => x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height,
        ),
        'connection crossed another shape',
      )
    }
  }
  return route
}

test('floating connections stay direct when clear and route around blocking or staggered assets', () => {
  const source = { x: 0, y: 100, width: 100, height: 80 }
  const target = { x: 600, y: 170, width: 100, height: 80 }
  assert.deepEqual(routeSimulationConnection(source, target, []), [])
  const blockers = [
    { x: 220, y: 40, width: 100, height: 240 },
    { x: 400, y: 140, width: 100, height: 260 },
  ]
  const before = structuredClone(blockers)
  assertClear(source, target, blockers)
  assertClear(target, source, blockers)
  assertClear(source, { ...target, y: -140 }, blockers)
  assert.deepEqual(blockers, before)
})

test('expanded steps route around sibling steps and the asset header', () => {
  const source = { x: 24, y: 72, width: 272, height: 68 }
  const target = { x: 24, y: 324, width: 272, height: 68 }
  const obstacles = [
    { x: 0, y: 0, width: 320, height: 64 },
    { x: 24, y: 156, width: 272, height: 68 },
    { x: 24, y: 240, width: 272, height: 68 },
  ]
  assertClear(source, target, obstacles)
  assertClear(target, source, obstacles)
})

test('default layouts follow attack flow and keep expanded branches, cycles and disconnected assets apart', () => {
  const names = ['Entry', 'Branch', 'Goal', 'Support', 'Other']
  const tree = {
    performedNodes: names.flatMap((asset, index) =>
      Array.from({ length: index === 1 ? 8 : 1 }, (_, step) => ({
        id: `${index}:${step}`,
        asset,
        name: `step${step}`,
        type: 'or',
        performedAt: index,
      })),
    ),
    performedEdges: [
      ['0:0', '1:0'],
      ['1:0', '2:0'],
      ['0:0', '3:0'],
      ['3:0', '2:0'],
      ['2:0', '1:0'],
    ].map(([source, target]) => ({ source, target })),
    entryIds: ['0:0'],
    targetIds: ['2:0'],
    targets: [{ id: '2:0', reached: true }],
  }
  const graph = buildSimulationResultGraph(tree)
  const before = structuredClone(graph)
  const layout = layoutSimulationResult(graph, new Set(graph.assets.map((asset) => asset.id)))
  assert.equal(layout.assets.length, names.length)
  const entry = layout.assets.find((asset) => asset.name === 'Entry')
  const branch = layout.assets.find((asset) => asset.name === 'Branch')
  const goal = layout.assets.find((asset) => asset.name === 'Goal')
  assert(entry.x < branch.x && branch.x < goal.x)
  for (const a of layout.assets)
    for (const b of layout.assets) {
      if (a === b) continue
      assert(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
      )
    }
  // Check the default collapsed asset connections against every unrelated box.
  const collapsed = layoutSimulationResult(graph)
  const owner = new Map(
    collapsed.assets.flatMap((asset) => asset.nodes.map((node) => [node.id, asset])),
  )
  for (const edge of tree.performedEdges) {
    const source = owner.get(edge.source),
      target = owner.get(edge.target)
    if (source === target) continue
    const obstacles = collapsed.assets.filter((asset) => asset !== source && asset !== target)
    const route = routeSimulationConnection(source, target, obstacles)
    if (route.length) assertClear(source, target, obstacles)
  }
  assert.deepEqual(graph, before)
})

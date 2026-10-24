import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as paths from '../src/services/attackPaths.js'
import * as metrics from '../src/services/attackPathMetrics.js'
import * as diagnostics from '../src/services/attackPathDiagnostics.js'
import * as scoring from '../src/services/ttpScoring.js'
import * as treeService from '../src/services/attackTree.js'

// Compile the real components, following the existing project UI test runner.
async function compile(name, dependencies = {}) {
  const source = await readFile(new URL(`../src/components/${name}.vue`, import.meta.url), 'utf8')
  const { descriptor } = parse(source, { filename: `${name}.vue` })
  const executable = compileScript(descriptor, { id: name, inlineTemplate: true })
    .content.replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
      (_, names, from) =>
        `const { ${names.replace(/\bas\b/g, ':')} } = ${from === 'vue' ? 'Vue' : `dependencies[${JSON.stringify(from)}]`};`,
    )
    .replace(
      /import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g,
      (_, name, from) => `const ${name} = dependencies[${JSON.stringify(from)}];`,
    )
    .replace('export default', 'return')
  return new Function('Vue', 'dependencies', executable)(Vue, dependencies)
}
const Status = await compile('AttackPathStatus')
const dependencies = {
  './AttackPathStatus.vue': Status,
  '@/services/attackPathDiagnostics.js': diagnostics,
  '@/services/attackPathMetrics.js': metrics,
  '@/services/ttpScoring.js': scoring,
  '@/services/attackPaths.js': paths,
}
const Choices = await compile('AttackPathChoices', dependencies)
const Prerequisite = await compile('AttackPrerequisite')
const Panel = await compile('AttackPathsPanel', {
  ...dependencies,
  './AttackPathChoices.vue': Choices,
  './AttackPrerequisite.vue': Prerequisite,
})
const Tree = await compile('AttackTreeView', {
  ...dependencies,
  '@/components/AttackPathChoices.vue': Choices,
  '@/services/attackTree.js': treeService,
  '@/services/drawio/runtime.js': {},
  '@/services/drawio/attackTree.js': {},
})
function analysis(state = false, maxHops = 40) {
  const graph = {
    nodes: [
      { id: 'E', type: 'or', fullName: 'Browser:localConnect', riskScore: 3 },
      { id: 'X', type: 'and', fullName: 'Gateway:access', riskScore: 3 },
      { id: 'D', type: 'defense', fullName: 'Gateway:shield', defenseStatus: state },
      { id: 'T', type: 'or', fullName: 'PT-CAN:messageInjection', riskScore: 3 },
    ],
    edges: [
      ['E', 'X'],
      ['D', 'X'],
      ['X', 'T'],
    ].map(([source, target]) => ({ source, target })),
    entryIds: ['E'],
    targetIds: ['T'],
  }
  return { graph, result: paths.findAttackPaths(graph, { maxHops }) }
}
const render = (component, data) => renderToString(Vue.createSSRApp(component, { analysis: data }))

test('both result views label blocked candidates and expose the actual unmet Defense', async () => {
  for (const component of [Panel, Tree]) {
    const html = await render(component, analysis(true))
    assert.match(html, /Infeasible — required prerequisites cannot be satisfied/)
    assert.match(html, /Unmet prerequisites and conditions/)
    assert.match(html, /Gateway:shield/)
    assert.match(html, /Defense is active/)
    assert.match(html, /No executable support plan established/)
    assert(!html.includes('No candidate paths were returned'))
  }
})

test('unknown conditions are visibly unresolved, while confirmed plans have Risk and execution order', async () => {
  const unknown = await render(Panel, analysis(null))
  assert.match(unknown, /Unresolved — unknown conditions/)
  assert.match(unknown, /Condition state is unknown/)
  const known = await render(Panel, analysis(false))
  assert.match(known, /Feasible — executable/)
  assert.match(known, /Execution order for Path 1/)
  assert.match(known, /Avg Risk Value: 3.0/)
})

test('both empty views explain hop limits and actual lack of structural connectivity separately', async () => {
  const capped = analysis(false, 1)
  const disconnected = analysis()
  disconnected.graph.edges = []
  disconnected.result = paths.findAttackPaths(disconnected.graph)
  for (const component of [Panel, Tree]) {
    assert.match(await render(component, capped), /beyond maxHops=1/)
    assert.match(await render(component, disconnected), /No structural directed Entry/)
  }
})

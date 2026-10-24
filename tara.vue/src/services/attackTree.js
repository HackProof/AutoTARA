import { conditionStatus, isAttackStep } from './attackFeasibility.js'
import { buildPathPrerequisites } from './attackPaths.js'
import { riskScoreClass, riskScoreLabel } from './ttpScoring.js'

// Unfold one returned candidate, with the Target at the root. Occurrence IDs
// keep repeated prerequisites separate; graph IDs alone would create a DAG.
export function buildCandidateAttackTree(data, path, options = {}) {
  if (!path.length) return { root: null, occurrences: [], truncated: false }
  const nodes = new Map(data.nodes.map((node) => [node.id, node]))
  const edgeKeys = new Set(data.edges.map((edge) => JSON.stringify([edge.source, edge.target])))
  if (
    new Set(path).size !== path.length ||
    path.some((id) => !isAttackStep(nodes.get(id))) ||
    !data.entryIds.includes(path[0]) ||
    !data.targetIds.includes(path.at(-1)) ||
    path.slice(1).some((id, index) => !edgeKeys.has(JSON.stringify([path[index], id])))
  ) {
    throw new Error('Select a valid Entry-to-Target candidate path.')
  }
  const support = buildPathPrerequisites(data, path, options)
  const requirements = new Map(support.requirements.map((item) => [item.node.id, item]))
  const occurrences = []
  function add(node, role, terminal = null, omitted = 0) {
    const item = {
      id: `occurrence-${occurrences.length}`,
      node,
      feasibility: options.metric?.nodeStatuses?.[node.id] ?? (options.metric ? 'limited' : null),
      role,
      terminal,
      omitted,
      children: [],
      isTarget: false,
    }
    occurrences.push(item)
    return item
  }
  function branch(input) {
    const item = add(input.node, 'support', input.terminal, input.omitted)
    item.children = input.children.map(branch)
    return item
  }
  // Allocate the complete primary chain first, independent of support limits.
  const primary = path.map((id, index) =>
    add(nodes.get(id), 'primary', index === 0 ? 'entry' : null),
  )
  for (let index = 1; index < primary.length; index++) {
    const item = primary[index],
      requirement = requirements.get(item.node.id)
    item.children.push(primary[index - 1])
    item.omitted = requirement?.omitted || 0
    for (const input of requirement?.children || []) {
      // The direct predecessor is already drawn as the primary child.
      if (input.node.id !== path[index - 1]) item.children.push(branch(input))
    }
    // A capped prerequisite expansion may omit the direct predecessor, which
    // is nevertheless present in the complete primary chain above.
    if (requirement && !requirement.children.some((input) => input.node.id === path[index - 1]))
      item.omitted = Math.max(0, item.omitted - 1)
  }
  const root = primary.at(-1)
  root.isTarget = true
  return { root, occurrences, truncated: occurrences.some((item) => item.omitted > 0) }
}

export function describeTreeOccurrence(item) {
  if (item.simulated) {
    if (item.terminal === 'entry') return 'Entry — initially compromised'
    if (item.terminal === 'reference')
      return 'Shared performed step — expanded elsewhere in this tree'
    if (item.terminal === 'route-reference') return 'Performed step on the selected route'
    if (item.terminal === 'cycle') return 'Cycle reference — performed step'
    return item.node.type === 'and'
      ? 'AND — performed attack prerequisites'
      : item.routeStep
        ? 'OR — selected path input'
        : 'OR — performed alternatives'
  }
  if (item.terminal === 'entry')
    return item.isTarget ? 'Selected Entry and Target' : 'Selected Entry'
  if (item.terminal === 'earlier') return 'Earlier on the selected route, before the AND step'
  if (item.terminal === 'cycle') return 'Repeated step'
  if (item.terminal === 'external') return 'Unreachable non-Entry leaf'
  if (item.terminal === 'condition') {
    const state = conditionStatus(item.node)
    return state === true
      ? 'Condition satisfied'
      : state === false
        ? 'Condition blocks this input'
        : 'Condition state unknown'
  }
  return item.node.type === 'and'
    ? 'AND — all prerequisites'
    : item.role === 'primary'
      ? 'OR — selected candidate route'
      : 'OR — perform one alternative'
}

function wrap(text, width = 32) {
  const chars = Array.from(text || '')
  const lines = []
  let line = '',
    length = 0
  for (const char of chars) {
    // Leave room for bold text and wide Unicode characters inside the node.
    const size = /[MW@#%]/.test(char) ? 1.5 : char.codePointAt(0) >= 0x2e80 ? 2 : 1
    if (char === '\n' || length + size > width) {
      lines.push(line)
      line = ''
      length = 0
    }
    if (char !== '\n') {
      line += char
      length += size
    }
  }
  if (line) lines.push(line)
  return lines.join('\n')
}

function treeNodeLabelParts(item, collapsed) {
  const gate = item.node.type.toUpperCase()
  const heading = item.isTarget
    ? `TARGET · ${gate}`
    : item.terminal === 'entry'
      ? `ENTRY · ${gate}`
      : `${gate} · ${item.routeStep ? 'Path step' : item.simulated ? 'Compromised step' : item.role === 'primary' ? 'Path step' : 'Prerequisite'}`
  const terminal = item.terminal ? wrap(describeTreeOccurrence(item)) : ''
  const fold = item.children.length
    ? `${collapsed ? '+' : '−'} ${item.children.length} ${item.simulated ? 'performed inputs' : item.node.type === 'and' ? 'required inputs' : item.role === 'primary' ? 'path input' : 'alternatives'}`
    : ''
  return [
    { text: heading },
    { text: wrap(item.node.asset, 28), bold: true },
    { text: wrap(item.node.name, 28), bold: true },
    {
      text: Number.isFinite(item.node.riskScore)
        ? `${item.simulated ? 'Risk Score' : 'Risk Value'}: ${riskScoreLabel(item.node.riskScore)}`
        : item.simulated
          ? 'Risk Score: 0.0'
          : '',
      badge: true,
    },
    { text: item.feasibility ? `Feasibility: ${item.feasibility}` : '' },
    { text: item.simulated ? `Performed · iteration ${item.node.performedAt ?? '—'}` : '' },
    { text: terminal },
    { text: fold },
    { text: item.omitted ? `${item.omitted} branches omitted (limit)` : '' },
  ].filter((part) => part.text)
}

export function treeNodeLabel(item, collapsed = false) {
  return treeNodeLabelParts(item, collapsed)
    .map((part) => part.text)
    .join('\n')
}

export function treeNodeHtmlLabel(item, collapsed = false) {
  const escape = (text) =>
    text.replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[char],
    )
  const lines = treeNodeLabelParts(item, collapsed).map(({ text, bold, badge }) => {
    const content = escape(text).replace(/\n/g, '<br>')
    if (badge)
      return `<span class="badge rounded-pill ${riskScoreClass(item.node.riskScore)}" style="font-size:11px;line-height:13px;padding:2px 7px;">${content}</span>`
    return bold ? `<strong>${content}</strong>` : content
  })
  return `<div style="line-height:17px;font-weight:400;white-space:nowrap;">${lines.join('<br>')}</div>`
}

// Each subtree gets its own interval; no shared cell or crossing dependency is
// introduced by layout. Edges point from a prerequisite toward its goal.
export function layoutAttackTree(tree, collapsed = new Set()) {
  const nodes = [],
    edges = [],
    byId = new Map(),
    rowHeights = []
  let nextLeaf = 0
  function visit(item, depth) {
    const label = treeNodeLabel(item, collapsed.has(item.id))
    const placed = {
      item,
      label,
      htmlLabel: treeNodeHtmlLabel(item, collapsed.has(item.id)),
      depth,
      x: 0,
      y: 0,
      width: 270,
      height: Math.max(100, label.split('\n').length * 17 + 24),
    }
    nodes.push(placed)
    byId.set(item.id, placed)
    rowHeights[depth] = Math.max(rowHeights[depth] || 0, placed.height)
    const children = collapsed.has(item.id) ? [] : item.children
    for (const child of children) {
      visit(child, depth + 1)
      edges.push({ source: child.id, target: item.id, role: child.role })
    }
    placed.x = children.length
      ? (byId.get(children[0].id).x + byId.get(children.at(-1).id).x) / 2
      : nextLeaf++ * 310
  }
  if (tree.root) visit(tree.root, 0)
  const offsets = [24]
  for (const height of rowHeights) offsets.push(offsets.at(-1) + height + 64)
  for (const placed of nodes) {
    placed.x += 24
    placed.y = offsets[placed.depth]
  }
  return { nodes, edges }
}

export function initialCollapsedBranches(tree) {
  return new Set(
    tree.occurrences
      .filter((item) => item.role === 'support' && item.children.length)
      .map((item) => item.id),
  )
}

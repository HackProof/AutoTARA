export const isAttackStep = (node) => ['and', 'or'].includes(node?.type)

// This API consumes buildAttackGraph() output, never a Diagram snapshot or
// the { graph, result } Worker envelope. Fail before accessing optional arrays.
export function validateAttackGraph(data) {
  for (const field of ['nodes', 'edges', 'entryIds', 'targetIds'])
    if (!Array.isArray(data?.[field]))
      throw new Error(`Attack graph.${field} must be an array. Pass buildAttackGraph() output.`)
  const ids = new Set()
  for (const node of data.nodes) {
    if (
      !node ||
      typeof node.id !== 'string' ||
      !node.id ||
      ids.has(node.id) ||
      !['and', 'or', 'defense', 'exist', 'notexist', 'notExist'].includes(node.type)
    )
      throw new Error('Attack graph nodes need unique string IDs and valid MAL types.')
    ids.add(node.id)
  }
  for (const edge of data.edges)
    if (!edge || !ids.has(edge.source) || !ids.has(edge.target))
      throw new Error('Missing graph edge endpoint.')
  const attackIds = new Set(data.nodes.filter(isAttackStep).map((node) => node.id))
  for (const field of ['entryIds', 'targetIds'])
    for (const id of data[field])
      if (typeof id !== 'string' || !attackIds.has(id))
        throw new Error(`An Entry or Target attack step is missing: ${String(id)}.`)
}

// Keep logical inputs in the index. Conditions are never route actions.
export function indexAttackGraph(data) {
  validateAttackGraph(data)
  const nodes = new Map(data.nodes.map((node) => [node.id, node]))
  const incoming = new Map([...nodes.keys()].map((id) => [id, new Set()]))
  const outgoing = new Map([...nodes.keys()].map((id) => [id, new Set()]))
  for (const { source, target } of data.edges) {
    if (!nodes.has(source) || !nodes.has(target)) throw new Error('Missing graph edge endpoint.')
    incoming.get(target).add(source)
    outgoing.get(source).add(target)
  }
  return {
    nodes,
    incoming: new Map([...incoming].map(([id, values]) => [id, [...values].sort()])),
    outgoing: new Map([...outgoing].map(([id, values]) => [id, [...values].sort()])),
  }
}

// true means this logical input permits progress, null means not evaluated.
// Defense status is activation, whereas existenceStatus is raw existence.
export function conditionStatus(node) {
  if (node.type === 'defense') {
    const key = ['defenseStatus', 'defense_status', 'enabled'].find((key) =>
      Object.hasOwn(node, key),
    )
    const value = node[key]
    if (value === true || value === 1) return false
    if (value === false || value === 0) return true
    return null
  }
  const exists = Object.hasOwn(node, 'existenceStatus')
    ? node.existenceStatus
    : node.existence_status
  if (typeof exists !== 'boolean') return null
  return node.type.toLowerCase() === 'notexist' ? !exists : exists
}

// Two least fixed points distinguish proven reachability from reachability
// conditional on unknown inputs. A closed cycle is seeded by neither pass.
// MAL condition inputs obey their child's AND/OR operator; an OR alternative
// can bypass a defense. Independent mandatory gates must be represented by AND.
export function analyzeAttackFeasibility(data, options = {}) {
  const index = options.index || indexAttackGraph(data)
  const { nodes, incoming } = index
  const tick = options.tick || (() => {})
  const entries = new Set(data.entryIds)
  const forcedParents = options.forcedParents || new Map()
  const dependencies = new Map(),
    dependents = new Map(),
    conditions = new Map()
  for (const [id, node] of nodes) {
    tick()
    if (!isAttackStep(node)) {
      if (!['defense', 'exist', 'notexist'].includes(node.type.toLowerCase()))
        throw new Error(`Unsupported graph node type: ${node.type}.`)
      conditions.set(id, conditionStatus(node))
    }
    if (forcedParents.has(id) && !incoming.get(id).includes(forcedParents.get(id)))
      throw new Error('A forced route predecessor must be an existing graph edge.')
    const parents =
      forcedParents.has(id) && node.type === 'or' && !entries.has(id)
        ? [forcedParents.get(id)]
        : incoming.get(id)
    dependencies.set(id, parents)
    for (const parent of parents) {
      tick()
      if (!dependents.has(parent)) dependents.set(parent, [])
      dependents.get(parent).push(id)
    }
  }
  for (const children of dependents.values()) children.sort()
  function closure(allowUnknown) {
    const reached = new Set(),
      evidence = new Map(),
      depth = new Map(),
      order = []
    const remaining = new Map([...dependencies].map(([id, parents]) => [id, parents.length]))
    function add(id, parents) {
      if (reached.has(id)) return
      reached.add(id)
      evidence.set(id, parents)
      let level = 0
      for (const parent of parents) {
        tick()
        level = Math.max(level, depth.get(parent) + 1)
      }
      depth.set(id, level)
      order.push(id)
    }
    // Entries are explicitly already compromised, even with incoming conditions.
    for (const id of [...entries].sort()) {
      tick()
      if (!isAttackStep(nodes.get(id))) throw new Error('An Entry attack step is missing.')
      add(id, [])
    }
    for (const [id, state] of [...conditions].sort(([a], [b]) => a.localeCompare(b))) {
      tick()
      if (state === true || (allowUnknown && state === null)) add(id, [])
    }
    for (let head = 0; head < order.length; head++) {
      tick()
      const parent = order[head]
      for (const id of dependents.get(parent) || []) {
        tick()
        if (reached.has(id) || !isAttackStep(nodes.get(id))) continue
        remaining.set(id, remaining.get(id) - 1)
        if (nodes.get(id).type === 'or') add(id, [parent])
        else if (remaining.get(id) === 0) add(id, dependencies.get(id))
      }
    }
    // A parentless non-Entry has no event to activate it (no vacuous AND).
    return { reached, evidence, depth, order }
  }
  const proven = closure(false),
    possible = closure(true)
  const statuses = new Map(
    [...nodes.keys()].map((id) => [
      id,
      proven.reached.has(id) ? 'feasible' : possible.reached.has(id) ? 'unresolved' : 'infeasible',
    ]),
  )
  return {
    ...proven,
    possible: possible.reached,
    statuses,
    conditions,
    dependencies,
    entries,
    index,
  }
}

// Explain the relevant dependency subgraph without pretending it is an execution
// plan. For unresolved/blocked OR nodes, retain all alternatives; for reached OR
// nodes, the recorded witness is enough. Main-route ORs are already constrained.
export function explainAttackFeasibility(analysis, roots, tick = () => {}) {
  const {
    index: { nodes },
    reached,
    dependencies,
    evidence,
    entries,
    statuses,
    conditions,
  } = analysis
  const included = new Set(),
    pending = [...roots],
    prerequisites = new Map()
  const blockedPrerequisites = [],
    unknownConditions = [],
    conditionIds = []
  for (let head = 0; head < pending.length; head++) {
    tick()
    const id = pending[head]
    if (included.has(id)) continue
    included.add(id)
    const node = nodes.get(id)
    if (!node) throw new Error('Missing feasibility root.')
    if (!isAttackStep(node)) {
      conditionIds.push(id)
      if (conditions.get(id) === null) unknownConditions.push(id)
    }
    const parents =
      entries.has(id) || !isAttackStep(node)
        ? []
        : reached.has(id)
          ? evidence.get(id)
          : dependencies.get(id)
    prerequisites.set(id, [...parents])
    for (const parent of parents) {
      tick()
      pending.push(parent)
    }
    if (!reached.has(id)) {
      const reason = !isAttackStep(node)
        ? conditions.get(id) === null
          ? 'unknown-condition'
          : node.type === 'defense'
            ? 'active-defense'
            : node.type.toLowerCase() === 'notexist'
              ? 'required-absence-false'
              : 'required-existence-false'
        : !parents.length
          ? 'non-entry-leaf'
          : node.type === 'and'
            ? 'unsatisfied-and'
            : 'no-reachable-or-input'
      const unsatisfiedParents = []
      for (const parent of parents) {
        tick()
        if (!reached.has(parent)) unsatisfiedParents.push(parent)
      }
      blockedPrerequisites.push({
        id,
        type: node.type,
        status: statuses.get(id),
        reason,
        unsatisfiedParents,
      })
    }
  }
  return {
    prerequisites: Object.fromEntries(prerequisites),
    conditionIds,
    blockedPrerequisites,
    unknownConditions,
  }
}

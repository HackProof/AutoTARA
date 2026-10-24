import { resolveDefenseStatus, defenseStatusFromTtc } from './defenseStates.js'
import { prepareMalExport, resolveMalExport } from './malModel.js'
import { createAttackStepRiskResolver } from './attackStepRisk.js'

export const attackNodeId = (cellId, step) => JSON.stringify([String(cellId), step])

// Instantiate the attached MAL language on the diagram's actual associations.
// Catalog IDs describe declarations; graph IDs must identify asset instances.
export function buildAttackGraph(snapshot, languageGraph, schema, catalogRows = []) {
  const plan = prepareMalExport(snapshot, languageGraph)
  const { model, errors } = resolveMalExport(plan)
  if (errors.length) throw new Error(errors.join('\n'))
  const riskScore = createAttackStepRiskResolver(
    languageGraph,
    schema,
    plan.assets.map((asset) => asset.type),
    catalogRows,
  )
  const definitions = new Map(languageGraph.assets.map((asset) => [asset.name, asset]))
  const steps = new Map(
    languageGraph.assets.map((asset) => {
      const values = asset.attack_steps ?? asset.attackSteps
      return [
        asset.name,
        new Map(
          Array.isArray(values)
            ? values.map((step) => [step.name, step])
            : Object.entries(values || {}),
        ),
      ]
    }),
  )
  const lineages = new Map()
  function lineage(type) {
    if (lineages.has(type)) return lineages.get(type)
    const names = []
    let name = type
    while (name) {
      if (names.includes(name)) throw new Error(`Cyclic MAL asset inheritance: ${name}.`)
      const definition = definitions.get(name)
      if (!definition) throw new Error(`Unknown MAL parent asset: ${name}.`)
      names.push(name)
      name = definition.super_asset ?? definition.superAsset ?? definition.extends ?? ''
    }
    lineages.set(type, names)
    return names
  }
  function effectiveSteps(type) {
    const result = new Map()
    for (const name of lineage(type))
      for (const [key, step] of steps.get(name)) {
        if (!result.has(key)) result.set(key, { owner: name, step })
      }
    return result
  }
  function inheritedDefinitions(owner, name, includeOverridden = false) {
    const result = [],
      seen = new Set()
    let reference = `${owner}:${name}`
    while (reference) {
      if (seen.has(reference)) throw new Error(`Cyclic MAL attack step inheritance: ${reference}.`)
      seen.add(reference)
      const separator = reference.indexOf(':')
      const step = steps.get(reference.slice(0, separator))?.get(reference.slice(separator + 1))
      if (!step) throw new Error(`Unknown inherited MAL attack step: ${reference}.`)
      result.push(step)
      reference = !includeOverridden && step.overrides ? null : step.inherits
    }
    return result
  }
  function follow(ids, expression, depth = 0) {
    if (depth > 100) throw new Error('MAL association expression is too deeply nested.')
    if (expression === null) return new Set(ids)
    if (!expression || typeof expression !== 'object')
      throw new Error('Invalid MAL association expression.')
    const type = expression.type
    const next = (values, expr) => follow(values, expr, depth + 1)
    if (type === 'field') {
      const fields = Object.entries(expression).filter(([key]) => key !== 'type')
      if (fields.length !== 1 || !fields[0][1]?.fieldname)
        throw new Error('Invalid MAL field expression.')
      const field = fields[0][1].fieldname
      return new Set(
        [...ids].flatMap((id) => [
          ...(model.assets.get(id).associated_assets.get(field)?.keys() || []),
        ]),
      )
    }
    if (['union', 'intersection', 'difference', 'collect'].includes(type)) {
      const parts = expression[type]
      const left = next(ids, parts?.left)
      // Evaluate collect's right expression per asset: intersection/difference
      // must not accidentally combine associations belonging to different assets.
      if (type === 'collect')
        return new Set([...left].flatMap((id) => [...next(new Set([id]), parts?.right)]))
      const right = next(ids, parts?.right)
      if (type === 'union') return new Set([...left, ...right])
      return new Set([...left].filter((id) => right.has(id) === (type === 'intersection')))
    }
    if (type === 'subType')
      return new Set(
        [...next(ids, expression.expression)].filter((id) =>
          lineage(model.assets.get(id).type).includes(expression.subType),
        ),
      )
    if (type === 'transitive') {
      const reached = new Set(ids)
      let pending = new Set(ids)
      while (pending.size) {
        pending = new Set(
          [...next(pending, expression.transitive)].filter((id) => !reached.has(id)),
        )
        for (const id of pending) reached.add(id)
      }
      return reached
    }
    throw new Error(`Unsupported MAL association expression: ${type || '(missing type)'}.`)
  }

  const nodes = [],
    byId = new Map(),
    instances = new Map(plan.assets.map((asset) => [asset.id, asset]))
  const effective = new Map()
  for (const asset of plan.assets) {
    if (!effective.has(asset.type)) effective.set(asset.type, effectiveSteps(asset.type))
    if (!effective.get(asset.type).size)
      throw new Error(
        `The LangGraph has no attack step definitions for ${asset.type}. Attach a complete LangGraph.`,
      )
    for (const [name, { owner, step }] of effective.get(asset.type)) {
      const type = String(step.type ?? step.attack_step_type ?? '').toLowerCase()
      if (!['or', 'and', 'exist', 'notexist', 'defense'].includes(type))
        throw new Error(`Unsupported MAL step type for ${asset.type}:${name}: ${type}.`)
      const node = {
        id: attackNodeId(asset.cellId, name),
        cellId: asset.cellId,
        name,
        asset: asset.name,
        assetType: asset.type,
        fullName: `${asset.name}:${name}`,
        type,
        causalMode: step.causal_mode ?? step.causalMode ?? null,
        ttc: step.ttc ?? null,
        riskScore: ['or', 'and'].includes(type) ? riskScore(asset, name) : null,
      }
      if (type === 'defense') {
        const specified = Object.hasOwn(asset.defenses || {}, name)
        node.defenseStatus = specified
          ? resolveDefenseStatus(asset.defenses[name])
          : defenseStatusFromTtc(step.ttc)
        node.defenseStatusSource = specified ? 'model' : 'language'
      }
      if (type === 'exist' || type === 'notexist') {
        const requirements = inheritedDefinitions(owner, name, true).flatMap(
          (item) => item.requires || [],
        )
        node.existenceStatus = requirements.some(
          (expr) => follow(new Set([asset.id]), expr).size > 0,
        )
      }
      nodes.push(node)
      byId.set(node.id, node)
    }
  }
  const edges = new Map()
  for (const asset of plan.assets)
    for (const [name, { owner }] of effective.get(asset.type)) {
      const source = attackNodeId(asset.cellId, name)
      for (const definition of inheritedDefinitions(owner, name)) {
        const children = definition.own_children ?? definition.children
        if (!children || typeof children !== 'object' || Array.isArray(children))
          throw new Error(
            `Missing MAL child expressions for ${owner}:${name}. Attach a complete LangGraph.`,
          )
        for (const [reference, expressions] of Object.entries(children)) {
          const separator = reference.indexOf(':')
          if (separator < 1 || !Array.isArray(expressions))
            throw new Error(`Invalid MAL child definition: ${reference}.`)
          const childName = reference.slice(separator + 1)
          for (const expression of expressions)
            for (const targetAsset of follow(new Set([asset.id]), expression)) {
              const target = attackNodeId(instances.get(targetAsset).cellId, childName)
              if (!byId.has(target))
                throw new Error(
                  `Missing MAL attack step ${instances.get(targetAsset).name}:${childName}.`,
                )
              edges.set(JSON.stringify([source, target]), { source, target })
            }
        }
      }
    }
  const entryIds = new Set(),
    targetIds = new Set()
  for (const asset of plan.assets) {
    const endpoints = asset.extras.attackEndpoints?.[schema] || {}
    for (const [kind, ids] of [
      ['entry', entryIds],
      ['target', targetIds],
    ])
      for (const endpoint of endpoints[kind] || []) {
        const id = attackNodeId(asset.cellId, endpoint.name)
        if (!['or', 'and'].includes(byId.get(id)?.type))
          throw new Error(
            `The ${kind} ${asset.name}:${endpoint.name} is not an attack step in this LangGraph. Select it again.`,
          )
        ids.add(id)
      }
  }
  if (!entryIds.size || !targetIds.size)
    throw new Error('Select at least one Entry and one Target attack step in the diagram.')
  return { nodes, edges: [...edges.values()], entryIds: [...entryIds], targetIds: [...targetIds] }
}

import { normalizeDefenseStates } from './defenseStates.js'
import { stringify } from 'yaml'
import { createAssociationMatcher } from './associations.js'
import { createAssetCtsaMetadata } from './ttpScoring.js'
import { normalizeAttackEndpoints } from './attackEndpoints.js'
import { normalizeCrraAssessments } from './drawio/crraMetadata.js'

export function prepareMalExport(snapshot, languageGraph, modelInfo = {}) {
  const plan = {
    assets: [],
    flows: [],
    errors: [],
    notes: [],
    metadata: {
      name: modelInfo.title || 'diagram',
      langID: String(languageGraph?.metadata?.id || ''),
      langVersion: String(languageGraph?.metadata?.version || ''),
      malVersion: '0.1.0-SNAPSHOT',
      info: 'Created by AutoTARA.',
      ...(snapshot.metadata?.crra
        ? { crra: normalizeCrraAssessments(snapshot.metadata.crra) }
        : {}),
      ...(typeof snapshot.metadata?.threatCatalogSchema === 'string'
        ? { threatCatalogSchema: snapshot.metadata.threatCatalogSchema }
        : {}),
    },
  }
  if (!languageGraph?.assets?.length) {
    plan.errors.push(
      'MAL export requires a LangGraph. Create a New Diagram with a MAL LangGraph attached.',
    )
    return plan
  }
  if (!plan.metadata.langID || !plan.metadata.langVersion) {
    plan.errors.push('The LangGraph must define metadata.id and metadata.version for MAL export.')
  }
  const catalog = new Map(languageGraph.assets.map((asset) => [asset.name, asset]))
  const vertices = snapshot.vertices.filter(
    (vertex) => !['boundary', 'annotation'].includes(vertex.kind),
  )
  const omitted = snapshot.vertices.length - vertices.length
  if (omitted) plan.notes.push(`${omitted} boundary/text shapes are omitted from the MAL model.`)
  if (!vertices.length) plan.errors.push('Add at least one MAL asset before exporting a model.')
  const reservedNames = new Set(vertices.map((vertex) => vertex.label))
  const usedNames = new Set()
  let renamed = 0
  for (const vertex of vertices) {
    const asset = catalog.get(vertex.assetType)
    const label = vertex.label || vertex.assetType || `Shape ${vertex.id}`
    if (!asset) {
      plan.errors.push(
        `“${label}” has no valid MAL asset type. Use a MAL asset stencil from the attached LangGraph.`,
      )
      continue
    }
    if (asset.isAbstract || asset.is_abstract) {
      plan.errors.push(
        `“${label}” uses abstract asset type ${asset.name}. Replace it with a concrete asset.`,
      )
      continue
    }
    const id = plan.assets.length + 1
    let name = label
    if (usedNames.has(name)) {
      name = `${label}:${id}`
      while (usedNames.has(name) || reservedNames.has(name)) name += `:${id}`
      renamed += 1
    }
    usedNames.add(name)
    plan.assets.push({
      id,
      cellId: vertex.id,
      name,
      type: asset.name,
      ...(vertex.defenses ? { defenses: normalizeDefenseStates(vertex.defenses) } : {}),
      extras: {
        position: { x: vertex.position?.x || 0, y: vertex.position?.y || 0 },
        ...(vertex.description ? { description: vertex.description } : {}),
        ...(vertex.dfdShape ? { dfdShape: vertex.dfdShape } : {}),
        ...(vertex.threatAssessments && Object.keys(vertex.threatAssessments).length
          ? { ctsa: createAssetCtsaMetadata(vertex.threatAssessments) }
          : {}),
        ...(vertex.attackEndpoints && Object.keys(vertex.attackEndpoints).length
          ? { attackEndpoints: normalizeAttackEndpoints(vertex.attackEndpoints) }
          : {}),
      },
    })
  }
  if (renamed)
    plan.notes.push(
      `${renamed} duplicate asset names receive an ID suffix in the YAML. Diagram names stay unchanged.`,
    )
  const byCell = new Map(plan.assets.map((asset) => [asset.cellId, asset]))
  const matcher = createAssociationMatcher(languageGraph)
  for (const edge of snapshot.edges) {
    const source = byCell.get(edge.source)
    const target = byCell.get(edge.target)
    const label = edge.label || `Data Flow ${edge.id}`
    if (!source || !target) {
      plan.errors.push(
        `“${label}” must connect two valid MAL assets. Reconnect or remove this flow before exporting.`,
      )
      continue
    }
    const candidates = matcher.getAssociations(source.type, target.type)
    if (!candidates.length) {
      plan.errors.push(`“${label}”: no MAL association connects ${source.name} and ${target.name}.`)
      continue
    }
    plan.flows.push({
      id: edge.id,
      label,
      source,
      target,
      candidates,
      associationId: edge.associationId || '',
    })
  }
  return plan
}

// Also used by the save dialog so malformed/incomplete mappings cannot be downloaded.
export function resolveMalExport(plan, choices = {}) {
  const errors = [...plan.errors]
  const assets = new Map(
    plan.assets.map((asset) => [
      asset.id,
      {
        name: asset.name,
        type: asset.type,
        ...(asset.defenses ? { defenses: asset.defenses } : {}),
        associated_assets: new Map(),
        extras: asset.extras,
      },
    ]),
  )
  const limits = new Map()
  function connect(source, target, field, max) {
    const fields = assets.get(source.id).associated_assets
    if (!fields.has(field)) fields.set(field, new Map())
    fields.get(field).set(target.id, target.name)
    const key = JSON.stringify([source.id, field])
    if (max !== null && max !== undefined && Number.isFinite(Number(max))) {
      const previous = limits.get(key)
      limits.set(key, {
        asset: source,
        field,
        max: Math.min(previous?.max ?? Infinity, Number(max)),
      })
    }
  }
  for (const flow of plan.flows) {
    const choice = Object.hasOwn(choices, flow.id) ? choices[flow.id] : flow.associationId
    const association = choice
      ? flow.candidates.find((candidate) => candidate.id === choice)
      : flow.candidates.length === 1
        ? flow.candidates[0]
        : null
    if (!association) {
      errors.push(
        `Choose an association for “${flow.label}” (${flow.source.name} → ${flow.target.name}).`,
      )
      continue
    }
    connect(flow.source, flow.target, association.sourceField, association.sourceMax)
    connect(flow.target, flow.source, association.targetField, association.targetMax)
  }
  for (const { asset, field, max } of limits.values()) {
    const count = assets.get(asset.id).associated_assets.get(field).size
    if (count > max)
      errors.push(
        `“${asset.name}”: ${field} allows at most ${max} linked assets; ${count} are connected. Choose another association or remove a flow.`,
      )
  }
  return { errors, model: { assets, metadata: { ...plan.metadata } } }
}

export function serializeMalModel(plan, choices = {}) {
  const { errors, model } = resolveMalExport(plan, choices)
  if (errors.length) throw new Error(errors.join('\n'))
  // Numeric IDs stay numeric; quote strings such as "on" for YAML 1.1 consumers too.
  return stringify(model, { compat: 'yaml-1.1', lineWidth: 0, aliasDuplicateObjects: false })
}

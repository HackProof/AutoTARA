import { normalizeDefenseStates } from './defenseStates.js'
import { parseDocument } from 'yaml'
import { createAssociationMatcher } from './associations.js'
import { assetShapes } from './drawio/palette.js'
import { createAssetCtsaMetadata, validTtpFactors, validTtpWeights } from './ttpScoring.js'
import { normalizeAttackEndpoints } from './attackEndpoints.js'
import { normalizeCrraAssessments } from './drawio/crraMetadata.js'

function plainMetadata(value) {
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value].map(([key, item]) => {
        if (typeof key !== 'string') throw new Error('Metadata keys must be text.')
        return [key, plainMetadata(item)]
      }),
    )
  }
  return Array.isArray(value) ? value.map(plainMetadata) : value
}

function readCtsaMetadata(value, assetName) {
  mapping(value, `CTSA metadata for “${assetName}”`)
  const assessments = plainMetadata(value)
  for (const [schema, assessment] of Object.entries(assessments)) {
    if (
      !schema.trim() ||
      !assessment ||
      typeof assessment !== 'object' ||
      Array.isArray(assessment) ||
      assessment.version !== 2 ||
      !validTtpWeights(assessment.weights) ||
      !assessment.steps ||
      typeof assessment.steps !== 'object' ||
      Array.isArray(assessment.steps) ||
      Object.entries(assessment.steps).some(
        ([id, factors]) => !id.trim() || !validTtpFactors(factors),
      )
    ) {
      throw new Error(
        `Invalid CTSA metadata for “${assetName}”: provide valid asset weights and twelve scoring factors per attack step.`,
      )
    }
  }
  return createAssetCtsaMetadata(assessments)
}

function assetId(value) {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?\d+$/.test(value)
        ? Number(value)
        : NaN
  if (!Number.isSafeInteger(number)) throw new Error('MAL asset IDs must be safe integers.')
  return String(number)
}

function mapping(value, label) {
  if (!(value instanceof Map)) throw new Error(`${label} must be a YAML mapping.`)
  return value
}

function readYaml(text) {
  try {
    const document = parseDocument(text, { prettyErrors: false })
    if (document.errors.length) throw document.errors[0]
    return document.toJS({ mapAsMap: true, maxAliasCount: 100 })
  } catch (error) {
    throw new Error(`The MAL Model file contains invalid YAML: ${error.message}`, { cause: error })
  }
}

// Keep parsing independent of mxGraph. No live diagram is touched until the
// entire model, including all association references, has been validated.
export function parseMalModel(text, languageGraph = null) {
  const data = readYaml(text)
  if (!(data instanceof Map) || !(data.get('assets') instanceof Map)) {
    throw new Error('Select a draw.io XML file or a MAL Model YAML file with an assets mapping.')
  }
  const metadata = mapping(data.get('metadata') ?? new Map(), 'MAL metadata')
  const schema = metadata.get('threatCatalogSchema')
  const crra = metadata.has('crra')
    ? normalizeCrraAssessments(plainMetadata(mapping(metadata.get('crra'), 'CRRA metadata')))
    : {}
  if (schema !== undefined && typeof schema !== 'string') {
    throw new Error('The MAL Model threatCatalogSchema must be text.')
  }
  if (languageGraph) {
    for (const [modelKey, languageKey] of [
      ['langID', 'id'],
      ['langVersion', 'version'],
    ]) {
      const expected = languageGraph.metadata?.[languageKey]
      const actual = metadata.get(modelKey)
      if (expected && actual !== undefined && String(actual) !== String(expected)) {
        throw new Error(
          `The MAL Model ${modelKey} (${actual}) does not match the attached LangGraph (${expected}). Attach the matching LangGraph in New Diagram.`,
        )
      }
    }
  }
  const catalog = new Map((languageGraph?.assets || []).map((asset) => [asset.name, asset]))
  const assets = new Map()
  for (const [key, entry] of data.get('assets')) {
    const id = assetId(key)
    if (assets.has(id)) throw new Error(`The MAL Model contains duplicate asset ID ${id}.`)
    const asset =
      typeof entry === 'string' ? new Map([['type', entry]]) : mapping(entry, `Asset ${id}`)
    const type = asset.get('type')
    if (typeof type !== 'string' || !type.trim()) {
      throw new Error(`Asset ${id} must define a MAL asset type.`)
    }
    const name = asset.get('name') ?? `${type}:${id}`
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`Asset ${id} must have a non-empty name.`)
    }
    if (languageGraph) {
      const definition = catalog.get(type)
      if (!definition)
        throw new Error(`“${name}”: unknown MAL asset type ${type} in the LangGraph.`)
      if (definition.isAbstract || definition.is_abstract) {
        throw new Error(`“${name}” uses abstract MAL asset type ${type}. Use a concrete asset.`)
      }
    }
    const defenses = asset.has('defenses')
      ? normalizeDefenseStates(
          plainMetadata(mapping(asset.get('defenses'), `Defenses for “${name}”`)),
        )
      : {}
    const extras = mapping(asset.get('extras') ?? new Map(), `Extras for “${name}”`)
    const assessments = extras.has('ctsa') ? readCtsaMetadata(extras.get('ctsa'), name) : {}
    const endpoints = extras.has('attackEndpoints')
      ? normalizeAttackEndpoints(
          plainMetadata(mapping(extras.get('attackEndpoints'), `Attack endpoints for “${name}”`)),
        )
      : {}
    const description = extras.get('description') ?? ''
    if (typeof description !== 'string') {
      throw new Error(`The description for “${name}” must be text.`)
    }
    const dfdShape = extras.get('dfdShape') ?? 'process'
    if (!assetShapes.some((shape) => shape.id === dfdShape)) {
      throw new Error(`“${name}” has an invalid DFD shape. Use process, actor, or store.`)
    }
    const position = extras.get('position')
    const index = assets.size
    let point = { x: 40 + (index % 5) * 200, y: 40 + Math.floor(index / 5) * 160 }
    if (position !== undefined && position !== null) {
      mapping(position, `Position for “${name}”`)
      const x = position.get('x')
      const y = position.get('y')
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`“${name}” must have finite numeric x and y coordinates.`)
      }
      point = { x, y }
    }
    const fields = new Map()
    for (const [field, targets] of mapping(
      asset.get('associated_assets') ?? new Map(),
      `Associations for “${name}”`,
    )) {
      if (typeof field !== 'string' || !field.trim()) {
        throw new Error(`“${name}” has an invalid association field name.`)
      }
      fields.set(
        field,
        new Set([...mapping(targets, `Association ${field} for “${name}”`).keys()].map(assetId)),
      )
    }
    assets.set(id, {
      id: `mal-asset-${id}`,
      label: name,
      kind: 'asset',
      assetType: type,
      ...(Object.keys(defenses).length ? { defenses } : {}),
      dfdShape,
      description,
      ...(Object.keys(assessments).length ? { threatAssessments: assessments } : {}),
      ...(Object.keys(endpoints).length ? { attackEndpoints: endpoints } : {}),
      position: point,
      fields,
    })
  }
  const matcher = languageGraph ? createAssociationMatcher(languageGraph) : null
  const edges = []
  const seen = new Set()
  const limits = new Map()
  function checkLimit(source, target, field, max) {
    const key = JSON.stringify([source.id, field])
    if (!limits.has(key)) limits.set(key, { source, field, targets: new Set(), max: Infinity })
    const limit = limits.get(key)
    limit.targets.add(target.id)
    if (max !== null && max !== undefined && Number.isFinite(Number(max))) {
      limit.max = Math.min(limit.max, Number(max))
    }
  }
  for (const source of assets.values()) {
    for (const [field, targets] of source.fields) {
      for (const targetId of targets) {
        const target = assets.get(targetId)
        if (!target) {
          throw new Error(
            `“${source.label}”: ${field} references missing MAL asset ID ${targetId}.`,
          )
        }
        let association
        if (matcher) {
          let candidates = matcher
            .getAssociations(source.assetType, target.assetType)
            .filter((candidate) => candidate.sourceField === field)
          if (candidates.length > 1) {
            const sourceId = source.id.slice('mal-asset-'.length)
            candidates = candidates.filter((candidate) =>
              target.fields.get(candidate.targetField)?.has(sourceId),
            )
          }
          if (candidates.length !== 1) {
            throw new Error(
              `“${source.label}” → “${target.label}”: ${field} does not identify a unique association in the attached LangGraph.`,
            )
          }
          association = candidates[0]
        }
        const forward = JSON.stringify([source.id, field, target.id, association?.targetField])
        const reverse = JSON.stringify([target.id, association?.targetField, source.id, field])
        // With a LangGraph, both reciprocal entries describe the same relation.
        // Without it, retain directed fields rather than guessing which belong together.
        const key = association ? [forward, reverse].sort()[0] : forward
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({
          id: `mal-flow-${edges.length + 1}`,
          source: source.id,
          target: target.id,
          label: association?.name || field,
          ...(association ? { associationId: association.id } : {}),
        })
        if (association) {
          checkLimit(source, target, field, association.sourceMax)
          checkLimit(target, source, association.targetField, association.targetMax)
        }
      }
    }
  }
  for (const { source, field, targets, max } of limits.values()) {
    if (targets.size > max) {
      throw new Error(`“${source.label}”: ${field} allows at most ${max} linked assets.`)
    }
  }
  return {
    title: typeof metadata.get('name') === 'string' ? metadata.get('name') : 'Diagram',
    vertices: [...assets.values()].map(({ fields: _fields, ...vertex }) => vertex),
    edges,
    ...(schema !== undefined || Object.keys(crra).length
      ? {
          metadata: {
            ...(schema !== undefined ? { threatCatalogSchema: schema.trim() } : {}),
            ...(Object.keys(crra).length ? { crra } : {}),
          },
        }
      : {}),
  }
}

import { findAssetParents, findAttackSteps, findLangSchemas } from './catalog.repository.js'

export async function listLangSchemas(database) {
  const schemas = await findLangSchemas(database)
  return schemas.map(({ schema }) => ({
    schema,
    label: schema.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
  }))
}

export async function getAttackSteps(database, schema, assetTypes, assetParents = {}) {
  const schemas = await findLangSchemas(database)
  if (!schemas.some((entry) => entry.schema === schema)) {
    const error = new Error('The selected language schema is not available.')
    error.status = 404
    throw error
  }
  const definitions = new Map()
  for (const row of await findAssetParents(database, schema)) {
    if (!definitions.has(row.asset)) definitions.set(row.asset, [])
    definitions.get(row.asset).push(row)
  }
  function parentOf(name) {
    // The compiled LangGraph includes imported/abstract ancestors missing from
    // the CSV. An explicit root also takes precedence over the DB snapshot.
    if (Object.hasOwn(assetParents, name)) return assetParents[name]
    const matches = definitions.get(name) || []
    if (matches.length !== 1) return null
    const parent = matches[0].extends_name
    // Resolve explicit DB extends only when the named parent is unambiguous.
    return definitions.get(parent)?.length === 1 ? parent : null
  }
  const lineages = new Map()
  for (const type of assetTypes) {
    const lineage = new Set()
    let name = type
    while (name && !lineage.has(name)) {
      lineage.add(name)
      name = parentOf(name)
    }
    lineages.set(type, [...lineage])
  }
  const names = [...new Set([...lineages.values()].flat())]
  const rowsByAsset = new Map()
  const includeSemantics = schemas.some((entry) => entry.schema === schema && entry.has_step_semantics)
  for (const row of await findAttackSteps(database, schema, names, includeSemantics)) {
    if (!rowsByAsset.has(row.asset)) rowsByAsset.set(row.asset, [])
    rowsByAsset.get(row.asset).push(row)
  }
  const result = []
  for (const [type, lineage] of lineages) {
    const seenSteps = new Set()
    for (const [depth, declaringAsset] of lineage.entries()) {
      for (const row of rowsByAsset.get(declaringAsset) || []) {
        // A child declaration shadows the same named step on any ancestor.
        if (seenSteps.has(row.name)) continue
        seenSteps.add(row.name)
        result.push({
          ...row,
          asset: type,
          declared_asset: row.asset,
          inheritance_depth: depth,
          riskScore: null,
        })
      }
    }
  }
  return result
}

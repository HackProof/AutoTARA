function stepDefinitions(asset) {
  const steps = asset.attack_steps ?? asset.attackSteps
  return new Map(
    (Array.isArray(steps)
      ? steps.map((step) => [step.name, step])
      : Object.entries(steps || {})
    ).filter(([name, step]) => name && step && typeof step === 'object'),
  )
}

// The mapping DB is a partial snapshot. The attached language defines which
// steps exist; DB rows enrich those steps without limiting their availability.
export function mergeLanguageAttackSteps(rows, languageGraph, assetTypes) {
  const definitions = new Map((languageGraph?.assets || []).map((asset) => [asset.name, asset]))
  if (!definitions.size) return rows
  const stepsByAsset = new Map(
    [...definitions].map(([name, asset]) => [name, stepDefinitions(asset)]),
  )
  const rowsByAsset = new Map()
  for (const row of rows) {
    if (!rowsByAsset.has(row.asset)) rowsByAsset.set(row.asset, new Map())
    rowsByAsset.get(row.asset).set(row.name, row)
  }
  const result = []
  for (const type of assetTypes) {
    const lineage = []
    let name = type
    while (name && definitions.has(name) && !lineage.includes(name)) {
      lineage.push(name)
      const asset = definitions.get(name)
      name = asset.super_asset ?? asset.superAsset ?? asset.extends ?? ''
    }
    const dbSteps = rowsByAsset.get(type) || new Map()
    // Older normalized catalogs may contain asset names/associations only.
    if (
      !lineage.some((name) => {
        const asset = definitions.get(name)
        return asset.attack_steps !== undefined || asset.attackSteps !== undefined
      })
    ) {
      result.push(...dbSteps.values())
      continue
    }
    const effective = new Map()
    for (const owner of lineage) {
      for (const [name, step] of stepsByAsset.get(owner)) {
        if (!effective.has(name)) effective.set(name, { owner, step })
      }
    }
    for (const [name, { owner, step }] of effective) {
      const candidate = dbSteps.get(name)
      const typeName = String(
        step.type ?? step.attack_step_type ?? candidate?.attack_step_type ?? '',
      ).toLowerCase()
      // Defenses and existence conditions are nodes in a LangGraph too, but
      // are not attack steps that an attacker can select as an endpoint.
      if (!['or', 'and'].includes(typeName)) continue
      const references = [owner]
      let declaration = owner
      let definition = step
      while (typeof definition?.inherits === 'string') {
        const [parent, inheritedName] = definition.inherits.split(':')
        if (inheritedName !== name || !lineage.includes(parent) || references.includes(parent))
          break
        references.push(parent)
        declaration = parent
        definition = stepsByAsset.get(parent)?.get(name)
      }
      // A language override missing from the DB must not borrow an ancestor's
      // ID or mappings just because it has the same step name.
      const row =
        candidate && references.includes(candidate.declared_asset || candidate.asset)
          ? candidate
          : null
      const qualifiedName = `${declaration}.${name}`
      const tags = new Set(step.tags || [])
      result.push({
        ...row,
        attack_step_id:
          row?.attack_step_id ||
          `LangGraph:${languageGraph.metadata?.id || 'attached'}:${qualifiedName}`,
        asset: type,
        name,
        qualified_name: row?.qualified_name || qualifiedName,
        declared_asset: row?.declared_asset || declaration,
        inheritance_depth: row?.inheritance_depth ?? lineage.indexOf(declaration),
        attack_step_type: typeName.toUpperCase(),
        definition:
          step.info?.user ||
          step.info?.developer ||
          step.info?.modeler ||
          step.definition ||
          row?.definition ||
          '',
        hidden:
          step.hidden ?? (Array.isArray(step.tags) ? tags.has('hidden') : row?.hidden || false),
        auxiliary:
          step.auxiliary ??
          (Array.isArray(step.tags) ? tags.has('auxiliary') : row?.auxiliary || false),
        technique_mappings: row?.technique_mappings || [],
        riskScore: null,
      })
    }
  }
  return result
}

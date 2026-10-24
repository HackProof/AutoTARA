// Associations are bidirectional type relationships; their endpoints also accept
// descendants. Keep abstract assets in the ancestry even though they have no stencil.
export function createAssociationMatcher(languageGraph) {
  const assets = new Map((languageGraph?.assets || []).map((asset) => [asset.name, asset]))
  const ancestry = new Map()
  function lineage(name) {
    if (!ancestry.has(name)) {
      const names = new Set()
      let asset = assets.get(name)
      while (asset && !names.has(asset.name)) {
        names.add(asset.name)
        asset = assets.get(asset.super_asset || asset.superAsset)
      }
      ancestry.set(name, names)
    }
    return ancestry.get(name)
  }
  const relationships = new Map()
  const declarations = new Map()
  for (const asset of assets.values()) {
    for (const association of Object.values(asset.associations || {})) {
      const left = association?.left?.asset
      const right = association?.right?.asset
      if (!assets.has(left) || !assets.has(right)) continue
      if (!relationships.has(left)) relationships.set(left, new Set())
      if (!relationships.has(right)) relationships.set(right, new Set())
      relationships.get(left).add(right)
      relationships.get(right).add(left)
      if (association.left.fieldname && association.right.fieldname) {
        const id = JSON.stringify([
          association.name || '',
          left,
          association.left.fieldname,
          right,
          association.right.fieldname,
        ])
        declarations.set(id, association)
      }
    }
  }
  return {
    hasAsset: (name) => assets.has(name),
    getAssociations(sourceType, targetType) {
      const matches = new Map()
      for (const [id, association] of declarations) {
        for (const reverse of [false, true]) {
          const source = reverse ? association.right : association.left
          const target = reverse ? association.left : association.right
          if (!lineage(sourceType).has(source.asset) || !lineage(targetType).has(target.asset))
            continue
          // MAL's field on an asset is named by the opposite endpoint.
          const key = JSON.stringify([target.fieldname, source.fieldname])
          if (!matches.has(key))
            matches.set(key, {
              id: `${id}:${reverse ? 'reverse' : 'forward'}`,
              name: association.name || 'Association',
              sourceField: target.fieldname,
              targetField: source.fieldname,
              sourceMax: target.max ?? null,
              targetMax: source.max ?? null,
            })
        }
      }
      return [...matches.values()]
    },
    canConnect(sourceType, targetType) {
      if (!assets.has(sourceType) || !assets.has(targetType)) return false
      const targets = lineage(targetType)
      for (const source of lineage(sourceType)) {
        for (const target of relationships.get(source) || []) {
          if (targets.has(target)) return true
        }
      }
      return false
    },
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// Accept both exported MAL LangGraphs and the normalized format used by the old project.
export function parseLanguageGraph(sourceText, fileName = '') {
  let source
  try {
    source = JSON.parse(sourceText)
  } catch {
    throw new Error('The MAL LangGraph file must contain valid JSON.')
  }

  if (!isObject(source)) {
    throw new Error('The MAL LangGraph must be a JSON object.')
  }

  let entries
  if (Array.isArray(source.assets)) {
    entries = source.assets.map((asset) => [asset?.name, asset])
  } else if (isObject(source.assets)) {
    entries = Object.entries(source.assets)
  } else {
    entries = Object.entries(source).filter(
      ([name, asset]) =>
        name !== 'metadata' &&
        isObject(asset) &&
        (asset.attack_steps || asset.attackSteps || asset.associations),
    )
  }

  const assets = entries.map(([name, asset]) => {
    const assetName = asset?.name || name
    if (!isObject(asset) || typeof assetName !== 'string' || !assetName.trim()) {
      throw new Error('Every MAL LangGraph asset must be an object with a name.')
    }
    const parent = asset.super_asset ?? asset.superAsset ?? asset.extends ?? ''
    if (typeof parent !== 'string') {
      throw new Error('Every MAL LangGraph parent must be an asset name.')
    }
    return {
      ...asset,
      name: assetName,
      super_asset: parent,
      isAbstract: asset.isAbstract === true || asset.is_abstract === true,
    }
  })

  if (!assets.some((asset) => !asset.isAbstract)) {
    throw new Error('No concrete assets were found in the MAL LangGraph file.')
  }

  return {
    languageGraph: {
      fileName,
      metadata: isObject(source.metadata) ? source.metadata : {},
      assets,
    },
    source,
    sourceText,
  }
}

// Include every definition, including abstract assets with no stencil/DB rows.
export function getAssetParents(languageGraph) {
  return Object.fromEntries(
    (languageGraph?.assets || []).map((asset) => [
      asset.name,
      asset.super_asset ?? asset.superAsset ?? asset.extends ?? '',
    ]),
  )
}

const common =
  'whiteSpace=wrap;html=0;fontSize=13;fontColor=#000000;strokeWidth=2;fillColor=none;strokeColor=#000000;'

export const dfdShapes = [
  {
    id: 'process',
    label: 'Process',
    icon: 'ellipse',
    width: 100,
    height: 100,
    style: `${common}overflow=hidden;shape=ellipse;perimeter=ellipsePerimeter;aspect=fixed;`,
    kind: 'asset',
  },
  {
    id: 'actor',
    label: 'External Entity',
    icon: 'rectangle',
    width: 130,
    height: 70,
    style: `${common}overflow=hidden;shape=rectangle;perimeter=rectanglePerimeter;`,
    kind: 'asset',
  },
  {
    id: 'store',
    label: 'Data Store',
    icon: 'store',
    width: 130,
    height: 70,
    style: `${common}overflow=hidden;shape=partialRectangle;perimeter=rectanglePerimeter;top=1;bottom=1;left=0;right=0;`,
    kind: 'asset',
  },
  {
    id: 'boundary',
    label: 'Trust Boundary',
    icon: 'boundary',
    width: 300,
    height: 220,
    style: `${common.replaceAll('#000000;', '#ff0000;')}fontStyle=1;rounded=1;dashed=1;dashPattern=8 4;verticalAlign=top;spacingTop=8;`,
    kind: 'boundary',
  },
]

export const generalShapes = [
  ...dfdShapes,
  {
    id: 'text',
    label: 'Text',
    icon: 'text',
    width: 120,
    height: 40,
    style: `${common}strokeColor=none;`,
    kind: 'annotation',
  },
]

export const assetShapes = dfdShapes.filter((shape) => shape.kind === 'asset')

function getAssetCategory(asset, assetsByName) {
  if (typeof asset.category === 'string' && asset.category.trim()) return asset.category.trim()
  let current = asset
  const visited = new Set()
  while (current) {
    if (visited.has(current.name)) return 'Uncategorized'
    visited.add(current.name)
    const parent = assetsByName.get(current.super_asset || current.superAsset)
    if (!parent) return current.name
    current = parent
  }
}

export function createAssetShapes(languageGraph) {
  const assets = languageGraph?.assets || []
  const assetsByName = new Map(assets.map((asset) => [asset.name, asset]))
  return assets
    .filter((asset) => !asset.isAbstract && !asset.is_abstract)
    .map((asset) => ({
      ...dfdShapes[0],
      id: `mal:${asset.name}`,
      label: asset.name,
      assetType: asset.name,
      dfdShape: 'process',
      category: getAssetCategory(asset, assetsByName),
    }))
}

export function createStencilGroups(languageGraph, search = '') {
  const categories = new Map()
  for (const shape of createAssetShapes(languageGraph)) {
    if (!categories.has(shape.category)) categories.set(shape.category, [])
    categories.get(shape.category).push(shape)
  }
  const query = search.trim().toLowerCase()
  return [
    ...Array.from(categories, ([category, shapes]) => ({
      id: `mal:${category}`,
      title: category,
      shapes: shapes.sort((left, right) => left.label.localeCompare(right.label)),
    })).sort((left, right) => left.title.localeCompare(right.title)),
    {
      id: 'general',
      title: 'General',
      shapes: languageGraph
        ? generalShapes.filter((shape) => shape.kind !== 'asset')
        : generalShapes,
    },
  ]
    .map((group) => ({
      ...group,
      shapes: group.shapes.filter(
        (shape) =>
          group.title.toLowerCase().includes(query) || shape.label.toLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.shapes.length)
}

export const DRAWIO_EDITOR_KEY = Symbol('autotara-drawio-editor')

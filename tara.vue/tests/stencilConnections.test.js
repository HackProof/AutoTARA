import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { getStencilConnectionContext } from '../src/services/drawio/stencilConnections.js'
import { createStencilGroups } from '../src/services/drawio/palette.js'
import { parseLanguageGraph } from '../src/services/languageGraph.js'

const catalog = {
  assets: [
    {
      name: 'Hardware',
      isAbstract: true,
      associations: [{ left: { asset: 'Hardware' }, right: { asset: 'Application' } }],
    },
    { name: 'ECU', super_asset: 'Hardware' },
    { name: 'Application', is_abstract: true },
    { name: 'Firmware', superAsset: 'Application' },
    { name: 'Client', super_asset: 'Application' },
    { name: 'Unrelated' },
  ],
}
const selected = (assetType, dfdShape = 'process') => ({
  assetType,
  dfdShape,
  label: 'Selected asset',
  isEdge: false,
})

test('stencil hints include unplaced concrete descendants and remain independent of the DFD shape', () => {
  for (const shape of ['process', 'actor', 'store']) {
    const result = getStencilConnectionContext(catalog, selected('ECU', shape), null)
    assert.equal(result.sourceLabel, 'Selected asset')
    assert.equal(result.sourceAssetType, 'ECU')
    assert.deepEqual([...result.compatibleAssetTypes], ['Firmware', 'Client'])
  }
  const reverse = getStencilConnectionContext(catalog, selected('Firmware'), null)
  assert.deepEqual([...reverse.compatibleAssetTypes], ['ECU'])
  const noMatches = getStencilConnectionContext(catalog, selected('Unrelated'), null)
  assert.equal(noMatches.compatibleAssetTypes.size, 0)
})

test('active connection anchor overrides selection and cancelling restores selection context', () => {
  const selection = selected('Firmware')
  const before = structuredClone(selection)
  const feedback = { sourceAssetType: 'ECU', sourceLabel: 'Engine controller', targetCount: 0 }
  let result = getStencilConnectionContext(catalog, selection, feedback)
  assert.equal(result.sourceLabel, 'Engine controller')
  assert.deepEqual([...result.compatibleAssetTypes], ['Firmware', 'Client'])
  result = getStencilConnectionContext(catalog, selection, null)
  assert.equal(result.sourceAssetType, 'Firmware')
  assert.deepEqual([...result.compatibleAssetTypes], ['ECU'])
  assert.equal(getStencilConnectionContext(catalog, null, null), null)
  assert.deepEqual(selection, before)
  // Do not keep highlighting a previous selection if a generic/unknown source is dragged.
  assert.equal(getStencilConnectionContext(catalog, selection, { sourceAssetType: '' }), null)
  assert.equal(
    getStencilConnectionContext(catalog, selection, { sourceAssetType: 'Missing' }),
    null,
  )
})

test('no catalog, no single asset selection, edges and General shapes have no stencil hints', () => {
  assert.equal(getStencilConnectionContext(null, selected('ECU'), null), null)
  for (const selection of [
    null,
    selected(''),
    selected('Missing'),
    selected('ECU', ''),
    { ...selected('ECU'), isEdge: true },
  ]) {
    assert.equal(getStencilConnectionContext(catalog, selection, null), null)
  }
  const selfCatalog = {
    assets: [
      {
        name: 'Application',
        associations: [{ left: { asset: 'Application' }, right: { asset: 'Application' } }],
      },
    ],
  }
  assert.deepEqual(
    [
      ...getStencilConnectionContext(selfCatalog, selected('Application'), null)
        .compatibleAssetTypes,
    ],
    ['Application'],
  )
})

test('vehicleLang hints preserve category/search results, exclude abstract types and never mark General', async () => {
  const { languageGraph } = parseLanguageGraph(
    await readFile(new URL('../../sample/vehicleLang_v2-langgraph.json', import.meta.url), 'utf8'),
  )
  const result = getStencilConnectionContext(languageGraph, selected('ECU'), null)
  for (const name of ['Firmware', 'FirmwareUpdaterService', 'CANNetwork', 'User'])
    assert.equal(result.compatibleAssetTypes.has(name), true, name)
  for (const name of [
    'ECU',
    'GatewayECU',
    'MessageID',
    ...languageGraph.assets.filter((asset) => asset.isAbstract).map((asset) => asset.name),
  ])
    assert.equal(result.compatibleAssetTypes.has(name), false, name)
  const groups = createStencilGroups(languageGraph)
  const matching = (group) =>
    group.shapes.filter((shape) => result.compatibleAssetTypes.has(shape.assetType))
  assert.equal(groups.flatMap(matching).length, result.compatibleAssetTypes.size)
  assert.deepEqual(matching(groups.find((group) => group.id === 'general')), [])
  assert.ok(
    matching(groups.find((group) => group.title === 'Application')).some(
      (shape) => shape.assetType === 'Firmware',
    ),
  )
  const filtered = createStencilGroups(languageGraph, 'Firmware')
  assert.deepEqual(
    filtered.flatMap(matching).map((shape) => shape.assetType),
    ['Firmware', 'FirmwareUpdaterService'],
  )
  assert.deepEqual(createStencilGroups(languageGraph, 'no such asset'), [])
})

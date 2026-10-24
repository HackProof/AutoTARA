import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createAssociationMatcher } from '../src/services/associations.js'
import { parseLanguageGraph } from '../src/services/languageGraph.js'

test('matches both association endpoints and their descendants, in either direction', () => {
  const matcher = createAssociationMatcher({
    assets: [
      {
        name: 'Hardware',
        isAbstract: true,
        associations: {
          apps: { left: { asset: 'Hardware' }, right: { asset: 'Application' } },
        },
      },
      { name: 'ECU', super_asset: 'Hardware' },
      { name: 'Gateway', superAsset: 'ECU' },
      { name: 'Application', isAbstract: true },
      { name: 'Firmware', super_asset: 'Application' },
      { name: 'User' },
    ],
  })
  assert.equal(matcher.canConnect('Gateway', 'Firmware'), true)
  assert.equal(matcher.canConnect('Firmware', 'Gateway'), true)
  assert.equal(matcher.canConnect('Gateway', 'ECU'), false)
  assert.equal(matcher.canConnect('ECU', 'ECU'), false)
  assert.equal(matcher.canConnect('ECU', 'User'), false)
  assert.equal(matcher.canConnect('Process', 'Firmware'), false)
  assert.equal(matcher.canConnect('', 'Firmware'), false)
})

test('supports association arrays and declared self-relations without inventing missing links', () => {
  const matcher = createAssociationMatcher({
    assets: [
      {
        name: 'Application',
        associations: [
          { left: { asset: 'Application' }, right: { asset: 'Application' } },
          { left: { asset: 'Application' }, right: { asset: 'Missing' } },
          null,
        ],
      },
      { name: 'Client', superAsset: 'Application' },
      { name: 'CycleA', super_asset: 'CycleB' },
      { name: 'CycleB', super_asset: 'CycleA' },
    ],
  })
  assert.equal(matcher.canConnect('Application', 'Client'), true)
  assert.equal(matcher.canConnect('Client', 'Client'), true)
  assert.equal(matcher.canConnect('Client', 'Missing'), false)
  assert.equal(matcher.canConnect('CycleA', 'Client'), false)
  assert.equal(matcher.canConnect('CycleB', 'CycleA'), false)
  assert.equal(createAssociationMatcher(null).canConnect('Client', 'Client'), false)
})

test('vehicleLang associations include inherited relationships and abstract endpoint descendants', async () => {
  const source = await readFile(
    new URL('../../sample/vehicleLang_v2-langgraph.json', import.meta.url),
    'utf8',
  )
  const { languageGraph } = parseLanguageGraph(source)
  const matcher = createAssociationMatcher(languageGraph)
  for (const [source, target, allowed] of [
    ['ECU', 'Firmware', true],
    ['GatewayECU', 'CANNetwork', true],
    ['ECU', 'User', true],
    ['NetworkService', 'ConnectionOrientedDataflow', true],
    ['Firmware', 'VehicularIdentity', true],
    ['Hardware', 'SoftwareVulnerability', false],
    ['ECU', 'ECU', false],
    ['CANNetwork', 'CANNetwork', false],
    ['MessageID', 'Hardware', false],
  ]) {
    assert.equal(matcher.canConnect(source, target), allowed, `${source} -> ${target}`)
    assert.equal(matcher.canConnect(target, source), allowed, `${target} -> ${source}`)
  }
})

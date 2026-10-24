import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { stringify } from 'yaml'
import { parseMalModel } from '../src/services/malModelImport.js'
import { normalizeAttackEndpoints } from '../src/services/attackEndpoints.js'
import {
  assessAssetThreats,
  createCtsaDraft,
  riskScoreClass,
  riskScoreLabel,
  serializeCtsaDraft,
} from '../src/services/ttpScoring.js'

// Exercise the actual modal's draft and save handlers. Bootstrap display and
// lifecycle are stubbed; native model/history persistence is tested separately.
const { descriptor } = parse(
  await readFile(new URL('../src/components/AttackEndpointModal.vue', import.meta.url), 'utf8'),
)
const executable = compileScript(descriptor, { id: 'AttackEndpointModal' })
  .content.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, 'const {$1} = Vue;')
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]bootstrap['"];?/g, 'const {$1} = bootstrap;')
  .replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]@\/services\/ttpScoring.js['"];?/g,
    'const {$1} = scoring;',
  )
  .replace('export default', 'return')
const component = new Function('Vue', 'bootstrap', 'document', 'scoring', executable)(
  { ...Vue, onMounted() {}, onBeforeUnmount() {} },
  { Modal: class {} },
  { activeElement: { focus() {} } },
  { assessAssetThreats, riskScoreClass, riskScoreLabel },
)
const inherited = { attackStepId: 'CoreLang:HardwareAccess.access', name: 'access' }
const target = { attackStepId: 'VehicleLang:ECU.changeOperationMode', name: 'changeOperationMode' }

function createModal() {
  const calls = []
  const props = Vue.reactive({
    editor: { updateAttackEndpoints: (...args) => calls.push(args) },
    catalogSchema: 'vehicle_lang',
    threatsByAsset: new Map([
      [
        'ECU',
        [
          {
            attack_step_id: inherited.attackStepId,
            name: inherited.name,
            declared_asset: 'HardwareAccess',
            definition: 'Obtain hardware access',
          },
          { attack_step_id: target.attackStepId, name: target.name, declared_asset: 'ECU' },
        ],
      ],
    ]),
    loading: false,
    error: '',
  })
  const state = component.setup(props, { expose() {} })
  const display = { shown: 0, hidden: 0 }
  state.modalInstance = { show: () => display.shown++, hide: () => display.hidden++ }
  const asset = {
    id: 'ecu-1',
    label: 'Engine ECU',
    assetType: 'ECU',
    attackEndpoints: { vehicle_lang: { entry: [inherited], target: [target] } },
  }
  return {
    props,
    state,
    display,
    calls,
    asset,
    open: (kind = 'entry') => state.openModal({ asset, schema: 'vehicle_lang', kind }),
  }
}

test('Entry and Target dialogs restore independent drafts, discard cancellation and save against the opened asset', () => {
  const { state, calls, asset, open, display } = createModal()
  const before = structuredClone(asset)
  open()
  assert.equal(display.shown, 1)
  assert.equal(state.title.value, 'Entry')
  assert.deepEqual(state.selectedIds.value, [inherited.attackStepId])
  state.selectedIds.value = [target.attackStepId]
  state.handleHidden()
  assert.deepEqual(calls, [])
  assert.deepEqual(asset, before)
  open()
  assert.deepEqual(state.selectedIds.value, [inherited.attackStepId])
  state.selectedIds.value = [inherited.attackStepId, target.attackStepId]
  state.save()
  assert.deepEqual(calls[0], ['ecu-1', 'vehicle_lang', 'entry', [inherited, target], 'ECU'])
  assert.equal(display.hidden, 1)
  open('target')
  assert.equal(state.title.value, 'Target')
  assert.deepEqual(state.selectedIds.value, [target.attackStepId])
  state.selectedIds.value = []
  state.save()
  assert.deepEqual(calls[1], ['ecu-1', 'vehicle_lang', 'target', [], 'ECU'])
  assert.deepEqual(asset, before)
})

test('endpoint search retains hidden selections, inherited IDs and previously selected steps missing from the catalog', () => {
  const { state, props, calls, open } = createModal()
  open()
  state.selectedIds.value = [inherited.attackStepId, target.attackStepId]
  state.search.value = 'MODE'
  assert.deepEqual(
    state.filteredOptions.value.map((step) => step.attackStepId),
    [target.attackStepId],
  )
  state.save()
  assert.equal(calls[0][3].length, 2)
  state.search.value = 'hardware access'
  assert.equal(state.filteredOptions.value[0].declaredAsset, 'HardwareAccess')
  state.search.value = 'no match'
  assert.equal(state.filteredOptions.value.length, 0)
  props.threatsByAsset = new Map()
  assert.equal(state.options.value[0].available, false)
  assert.equal(state.options.value[0].attackStepId, inherited.attackStepId)
})

test('both endpoint dialogs calculate saved CTSA scores for the opened asset and schema, including inherited steps', () => {
  const { state, props, asset, open, calls } = createModal()
  const threats = props.threatsByAsset.get('ECU')
  const draft = createCtsaDraft(threats)
  for (const factor of draft.threats[0].factors) factor.value = 4
  draft.threats[1].factors[0].value = 5
  const assessment = serializeCtsaDraft(draft)
  // Display the score from saved values, rather than trusting stale cached scores.
  assessment.riskScores[inherited.attackStepId] = 99
  const otherDraft = createCtsaDraft(threats)
  for (const threat of otherDraft.threats) for (const factor of threat.factors) factor.value = 1
  asset.threatAssessments = { vehicle_lang: assessment, other_lang: serializeCtsaDraft(otherDraft) }
  for (const kind of ['entry', 'target']) {
    open(kind)
    assert.equal(state.options.value[0].riskScore, 4)
    assert.equal(state.options.value[1].riskScore, null)
  }
  state.save()
  assert.deepEqual(calls[0][3], [target])
  // The same asset type must not share another instance's assessment.
  state.openModal({
    asset: { ...asset, id: 'ecu-2', threatAssessments: {} },
    schema: 'vehicle_lang',
    kind: 'entry',
  })
  assert.ok(state.options.value.every((step) => step.riskScore === null))
  // Previously selected steps retain their assessment even if absent from the catalog.
  props.threatsByAsset = new Map()
  open('entry')
  assert.equal(state.options.value[0].available, false)
  assert.equal(state.options.value[0].riskScore, 4)
})

test('loading, catalog errors and schema changes prevent saving; errors from stale assets keep the dialog open', () => {
  const { state, props, display, calls, open } = createModal()
  open()
  for (const [key, value] of [
    ['loading', true],
    ['error', 'Catalog unavailable'],
    ['catalogSchema', 'other_lang'],
  ]) {
    const previous = props[key]
    props[key] = value
    assert.equal(state.canSave.value, false)
    state.save()
    assert.equal(calls.length, 0)
    props[key] = previous
  }
  assert.equal(state.canSave.value, true)
  props.editor.updateAttackEndpoints = () => {
    throw new Error('The asset is no longer available.')
  }
  state.save()
  assert.match(state.errorMessage.value, /no longer available/)
  assert.equal(display.hidden, 0)
})

test('MAL import rejects malformed endpoint metadata and retains all schemas and role names', () => {
  const metadata = {
    vehicle_lang: { entry: [inherited], target: [target] },
    other_lang: { entry: [], target: [inherited] },
  }
  const model = {
    assets: { 1: { name: 'ECU', type: 'ECU', extras: { attackEndpoints: metadata } } },
  }
  assert.deepEqual(
    parseMalModel(stringify(model)).vertices[0].attackEndpoints,
    normalizeAttackEndpoints(metadata),
  )
  for (const invalid of [
    [],
    'text',
    { vehicle_lang: { entry: ['access'] } },
    { vehicle_lang: { target: [{ attackStepId: 'step' }] } },
  ]) {
    model.assets[1].extras.attackEndpoints = invalid
    assert.throws(() => parseMalModel(stringify(model)), /[Aa]ttack endpoint/)
  }
})

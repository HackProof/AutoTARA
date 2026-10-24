import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeAttackStep, filterCtsaThreats } from '../src/services/attackStepSemantics.js'
import { mergeLanguageAttackSteps } from '../src/services/languageAttackSteps.js'
import { groupAssetThreats } from '../src/services/threatCatalog.js'
import {
  createCtsaDraft,
  serializeCtsaDraft,
  assessAssetThreats,
} from '../src/services/ttpScoring.js'
import { createSusceptibilityMatrix } from '../src/services/susceptibilityMatrix.js'
import { readFile } from 'node:fs/promises'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import * as scoring from '../src/services/ttpScoring.js'
import * as semantics from '../src/services/attackStepSemantics.js'

const helper = {
  attack_step_id: 'VehicleLang:Machine._accessData',
  asset: 'Machine',
  name: '_accessData',
  declared_asset: 'Machine',
  qualified_name: 'Machine._accessData',
  hidden: true,
  auxiliary: true,
  technique_mappings: [],
  semantic_category: 'auxiliary_step',
  classification_reason: 'Relays data access.',
  classification_source: 'sample/vehicleLang_v2/vehicleLang.mal:84 (Machine._accessData)',
  classification_version: 'autotara-step-semantics-v1',
  mitre_unmapped_reason_code: 'modeling_helper',
  mitre_unmapped_reason: 'Review the actual data read and write steps.',
}

test('current mappings override stale review reasons; missing catalog entries are explicit', () => {
  assert.equal(describeAttackStep(helper).unmappedReason, helper.mitre_unmapped_reason)
  assert.equal(
    describeAttackStep({
      ...helper,
      technique_mappings: [{ mitre_technique_id: 'T0801' }],
    }).unmappedReason,
    '',
  )
  const unknown = describeAttackStep({ attack_step_id: 'LangGraph:test:Machine.other' })
  assert.equal(unknown.label, 'Unclassified')
  assert.match(unknown.unmappedReason, /not registered in the current ATKB catalog/)
  assert.match(describeAttackStep({}).unmappedReason, /no step-specific reason has been recorded/)
})

test('display filtering preserves all draft inputs and searches visible classification metadata', () => {
  const mapped = {
    ...helper,
    attack_step_id: 'VehicleLang:Machine.deny',
    name: 'deny',
    semantic_category: 'attack_behavior',
    techniques: [{ id: 'T0814' }],
  }
  const draft = createCtsaDraft([helper, mapped])
  for (const threat of draft.threats) for (const factor of threat.factors) factor.value = 4
  const visible = filterCtsaThreats(draft.threats, {
    category: 'auxiliary_step',
    mapping: 'unmapped',
    search: 'auxiliary step',
  })
  assert.equal(visible.length, 1)
  assert.equal(visible[0], draft.threats[0])
  visible[0].factors[0].value = 2
  assert.equal(draft.threats[0].factors[0].value, 2)
  const saved = serializeCtsaDraft(draft)
  assert.equal(Object.keys(saved.steps).length, 2)
  assert.equal(assessAssetThreats([helper, mapped], saved).length, 2)
  assert.equal(filterCtsaThreats(draft.threats, { mapping: 'mapped' })[0].name, 'deny')
  assert.equal(filterCtsaThreats([{}], { category: 'unclassified' }).length, 1)
  assert.equal(filterCtsaThreats(draft.threats, { search: 'actual data read' }).length, 0)
  assert.equal(filterCtsaThreats(draft.threats, { search: 'data access' }).length, 0)
})

test('inherited metadata survives LangGraph enrichment while a new override never borrows it', () => {
  const ctsa = { proximity: 4, recovery_time: 2, ctsa_score: 3.1 }
  const graph = {
    metadata: { id: 'test' },
    assets: [
      { name: 'Machine', attack_steps: { _accessData: { type: 'or' } } },
      { name: 'ECU', extends: 'Machine', attack_steps: {} },
      { name: 'Override', extends: 'Machine', attack_steps: { _accessData: { type: 'or' } } },
    ],
  }
  const rows = mergeLanguageAttackSteps(
    [
      { ...helper, asset: 'ECU', ctsa },
      { ...helper, asset: 'Override', ctsa },
    ],
    graph,
    ['ECU', 'Override'],
  )
  assert.equal(rows[0].semantic_category, 'auxiliary_step')
  assert.equal(rows[0].classification_source, helper.classification_source)
  assert.deepEqual(rows[0].ctsa, ctsa)
  assert.equal(rows[0].attack_step_id, helper.attack_step_id)
  assert.equal(rows[1].semantic_category, undefined)
  assert.equal(rows[1].ctsa, undefined)
  assert.equal(describeAttackStep(rows[1]).label, 'Unclassified')
})

test('scored unmapped helper remains assessable and carries its explanation into CTSA Matrix', () => {
  const threats = groupAssetThreats([helper])
  const draft = createCtsaDraft(threats.get('Machine'))
  for (const factor of draft.threats[0].factors) factor.value = 3
  const matrix = createSusceptibilityMatrix(
    {
      vertices: [
        {
          id: 'machine-1',
          label: 'Machine 1',
          assetType: 'Machine',
          threatAssessments: { vehicle_lang: serializeCtsaDraft(draft) },
        },
      ],
    },
    'vehicle_lang',
    threats,
  )
  assert.equal(matrix.rows.length, 0)
  assert.equal(matrix.unmappedSteps.length, 1)
  assert.equal(matrix.unmappedSteps[0].riskScore, 3)
  assert.equal(
    describeAttackStep(matrix.unmappedSteps[0].semantics).unmappedReason,
    helper.mitre_unmapped_reason,
  )
})

async function compileComponent(name, inlineTemplate = false) {
  const { descriptor } = parse(
    await readFile(new URL(`../src/components/${name}.vue`, import.meta.url), 'utf8'),
  )
  const dependencies = {
    '@/services/ttpScoring.js': scoring,
    '@/services/attackStepSemantics.js': semantics,
  }
  if (name === 'CtsaScoringModal') {
    dependencies['./AttackStepSemantics.vue'] = await compileComponent('AttackStepSemantics', true)
  }
  const script = compileScript(descriptor, { id: name, inlineTemplate })
  const executable = script.content
    .replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
      (_, names, from) =>
        `const { ${names.replace(/\bas\b/g, ':')} } = ${from === 'vue' ? 'Vue' : `dependencies[${JSON.stringify(from)}] || {}`};`,
    )
    .replace(
      /import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g,
      (_, name, from) => `const ${name} = dependencies[${JSON.stringify(from)}];`,
    )
    .replace('export default', 'return')
  const component = new Function('Vue', 'dependencies', 'document', executable)(
    { ...Vue, onMounted() {}, onBeforeUnmount() {} },
    dependencies,
    { activeElement: { focus() {} } },
  )
  if (!inlineTemplate) {
    const template = compileTemplate({
      source: descriptor.template.content,
      filename: `${name}.vue`,
      id: name,
      compilerOptions: { bindingMetadata: script.bindings },
    })
    assert.deepEqual(template.errors, [])
    const render = template.code
      .replace(
        /import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g,
        (_, names) => `const { ${names.replace(/\bas\b/g, ':')} } = Vue;`,
      )
      .replace('export function render', 'return function render')
    component.render = new Function('Vue', render)(Vue)
  }
  return component
}

test('CTSA modal filters by meaning and mapping, saves the whole assessment and resets filters on reopen', async () => {
  const component = await compileComponent('CtsaScoringModal')
  const savedCalls = []
  const state = component.setup(
    {
      editor: { updateThreatAssessments: (...args) => savedCalls.push(args) },
    },
    { expose() {} },
  )
  state.modalInstance = { show() {}, hide() {} }
  const mapped = {
    ...helper,
    name: 'deny',
    attack_step_id: 'VehicleLang:Machine.deny',
    semantic_category: 'attack_behavior',
    techniques: [{ id: 'T0814' }],
  }
  const context = {
    schema: 'vehicle_lang',
    asset: { id: 'm1', label: 'Machine 1', assetType: 'Machine' },
    threats: [helper, mapped],
  }
  state.openModal(context)
  state.categoryFilter.value = 'auxiliary_step'
  state.mappingFilter.value = 'unmapped'
  state.stepSearch.value = 'auxiliary step'
  assert.deepEqual(
    state.visibleThreats.value.map((row) => row.name),
    ['_accessData'],
  )
  state.fillBlankValues()
  assert.equal(state.assessedCount.value, 2)
  assert.equal(state.canSave.value, true)
  state.save()
  assert.equal(savedCalls.length, 1)
  assert.equal(savedCalls[0][2].threats.length, 2)
  state.handleHidden()
  state.openModal(context)
  assert.equal(state.visibleThreats.value.length, 2)
  assert.equal(state.categoryFilter.value, '')
  assert.equal(state.mappingFilter.value, '')
  assert.equal(state.stepSearch.value, '')
})

test('CTSA modal shows DB scores as references without rating import controls', async () => {
  for (const ctsa of [
    { proximity: 2, recovery_time: 4, ctsa_score: 2.6 },
    { ctsa_score: 2.6 },
    null,
  ]) {
    const component = await compileComponent('CtsaScoringModal')
    const setup = component.setup
    component.setup = (props, context) => {
      const state = setup(props, context)
      state.modalInstance = { show() {} }
      state.openModal({
        schema: 'vehicle_lang',
        asset: { id: 'm1', label: 'Machine 1', assetType: 'Machine' },
        threats: groupAssetThreats([{ ...helper, ctsa }]).get('Machine'),
      })
      return state
    }
    const context = {}
    await renderToString(Vue.createSSRApp(component, { editor: {} }), context)
    const html = context.teleports.body
    assert.doesNotMatch(html, /Load DB CTSA values|ctsa-database-help|No DB CTSA values/)
    if (ctsa) assert.match(html, /DB CTSA: 2\.6/)
    else assert.doesNotMatch(html, /DB CTSA:/)
    assert.match(html, /0 \/ 1 threats assessed/)
    assert.doesNotMatch(html, /Temporary: Set MITRE-mapped steps/)
  }
})

test('semantic details use English labels and escape classification and unmapped explanations', async () => {
  const component = await compileComponent('AttackStepSemantics', true)
  const html = await renderToString(
    Vue.createSSRApp(component, {
      threat: {
        ...helper,
        classification_reason: 'Relays data access. <script>alert(1)</script>',
        mitre_unmapped_reason: 'Review required <script>alert(1)</script>',
      },
    }),
  )
  assert.match(html, /Auxiliary step/)
  assert.match(html, /MITRE unmapped/)
  assert.match(html, /Classification rationale/)
  assert.match(html, /MAL source:/)
  assert.doesNotMatch(html, /[가-힣]/)
  assert.match(html, /sample\/vehicleLang_v2\/vehicleLang.mal/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>alert/)
  const mapped = await renderToString(
    Vue.createSSRApp(component, {
      threat: {
        ...helper,
        techniques: [{ id: 'T0814' }],
      },
    }),
  )
  assert.doesNotMatch(mapped, /MITRE unmapped/)
})

test('semantic details can hide unmapped reasons independently of classification evidence', async () => {
  const component = await compileComponent('AttackStepSemantics', true)
  const html = await renderToString(
    Vue.createSSRApp(component, { threat: helper, showUnmappedReason: false }),
  )
  assert.match(html, /Auxiliary step/)
  assert.match(html, /MITRE unmapped/)
  assert.match(html, /Relays data access/)
  assert.match(html, /MAL source:/)
  assert.doesNotMatch(html, /unmapped-reason|Review the actual data read/)
})

test('opened TTP scoring modal renders English controls and hides rationale and unmapped reasons', async () => {
  const component = await compileComponent('CtsaScoringModal')
  const setup = component.setup
  component.setup = (props, context) => {
    const state = setup(props, context)
    state.modalInstance = { show() {} }
    state.openModal({
      schema: 'vehicle_lang',
      asset: { id: 'm1', label: 'Machine 1', assetType: 'Machine' },
      threats: [helper, { attack_step_id: 'LangGraph:test:Machine.other', name: 'other' }],
    })
    return state
  }
  const context = {}
  await renderToString(Vue.createSSRApp(component, { editor: {} }), context)
  const html = context.teleports.body
  assert.match(html, /Search Attack Steps/)
  assert.match(html, /Semantic classification/)
  assert.match(html, /All classifications/)
  assert.match(html, /Unclassified/)
  assert.match(html, /2 \/ 2 steps shown/)
  assert.doesNotMatch(
    html,
    /[가-힣]|Classification rationale|Relays data access|MAL source:|autotara-step-semantics-v1|unmapped-reason|Review the actual data read|not registered in the current ATKB catalog/,
  )
})

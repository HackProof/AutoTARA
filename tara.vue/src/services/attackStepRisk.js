import { mergeLanguageAttackSteps } from './languageAttackSteps.js'
import { createTtpFactors, createTtpFactorsFromCtsa } from './ttpScoring.js'

function createIdentityResolver(languageGraph, assetTypes, catalogRows) {
  const identities = new Map()
  for (const row of mergeLanguageAttackSteps(catalogRows, languageGraph, [
    ...new Set(assetTypes),
  ])) {
    if (!identities.has(row.asset)) identities.set(row.asset, new Map())
    identities.get(row.asset).set(row.name, row)
  }
  return (asset, name) => identities.get(asset?.type)?.get(name)
}

function assessmentKey(values, identity) {
  if (!identity || !values) return null
  if (Object.hasOwn(values, identity.attack_step_id)) return identity.attack_step_id
  // Catalog and LangGraph IDs may differ, but must identify one exact
  // declaration. Child overrides and other asset instances cannot borrow it.
  const matches = Object.keys(values).filter(
    (id) => id.includes(':') && id.slice(id.lastIndexOf(':') + 1) === identity.qualified_name,
  )
  return matches.length === 1 ? matches[0] : null
}

// Assets come from prepareMalExport(), which recalculates scores from the
// saved factors and weights. Resolve the exact declaration and asset instance.
export function createAttackStepRiskResolver(languageGraph, schema, assetTypes, catalogRows = []) {
  const resolveIdentity = createIdentityResolver(languageGraph, assetTypes, catalogRows)
  return (asset, name) => {
    const scores = asset?.extras?.ctsa?.[schema]?.riskScores
    const key = assessmentKey(scores, resolveIdentity(asset, name))
    return key === null ? null : scores[key]
  }
}

// AFR uses raw factor ratings, independently of the weighted CTSA total.
// A saved assessment (including blanks) takes precedence over catalog values.
export function createAttackStepTtpResolver(languageGraph, schema, assetTypes, catalogRows = []) {
  const resolveIdentity = createIdentityResolver(languageGraph, assetTypes, catalogRows)
  return (asset, name) => {
    const identity = resolveIdentity(asset, name)
    if (!identity) return null
    const steps = asset?.extras?.ctsa?.[schema]?.steps
    const key = assessmentKey(steps, identity)
    if (key !== null) return { factors: createTtpFactors(steps[key]), source: 'assessment' }
    const factors = createTtpFactorsFromCtsa(identity.ctsa)
    return factors.some((factor) => factor.value !== null) ? { factors, source: 'catalog' } : null
  }
}

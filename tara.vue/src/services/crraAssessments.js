import { assessAssetThreats } from './ttpScoring.js'

// Assess each diagram instance independently using the active schema's saved
// factors and asset weights. Cached scores and simulation defaults are not inputs.
export function collectCrraAssessments(snapshot, schema, threatsByAsset) {
  const assets = (snapshot?.vertices || []).filter(
    (asset) => asset.assetType && (!asset.kind || asset.kind === 'asset'),
  )
  const rows = []
  const assessedAssets = new Set()
  for (const asset of assets) {
    const threats = assessAssetThreats(
      threatsByAsset.get(asset.assetType) || [],
      asset.threatAssessments?.[schema],
    )
    const seen = new Set()
    for (const threat of threats) {
      if (!Number.isFinite(threat.riskScore) || seen.has(threat.attack_step_id)) continue
      seen.add(threat.attack_step_id)
      assessedAssets.add(asset.id)
      rows.push({
        assetId: asset.id,
        assetName: asset.label || asset.assetType,
        assetType: asset.assetType,
        attackStepId: threat.attack_step_id,
        attackVector: threat.name,
        definition: threat.definition || '',
        declaredAsset: threat.declared_asset || asset.assetType,
        techniques: threat.techniques || [],
        // Keep reviewed metadata available in CTSA's unmapped Matrix rows too.
        semantics: {
          attack_step_id: threat.attack_step_id,
          semantic_category: threat.semantic_category,
          classification_reason: threat.classification_reason,
          classification_source: threat.classification_source,
          classification_version: threat.classification_version,
          mitre_unmapped_reason_code: threat.mitre_unmapped_reason_code,
          mitre_unmapped_reason: threat.mitre_unmapped_reason,
          techniques: threat.techniques || [],
        },
        riskScore: threat.riskScore,
      })
    }
  }
  return { rows, assetCount: assets.length, assessedAssetCount: assessedAssets.size }
}

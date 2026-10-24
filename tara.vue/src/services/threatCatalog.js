import api from '../api/client.js'

export async function fetchLangSchemas({ signal } = {}) {
  const { data } = await api.get('/v1/lang-schemas', { signal })
  return data.schemas
}

export async function fetchAttackSteps(schema, assetTypes, { signal, assetParents } = {}) {
  const { data } = await api.post(
    `/v1/lang-schemas/${encodeURIComponent(schema)}/attack-steps`,
    { assetTypes, assetParents },
    { signal },
  )
  return data.attackSteps
}

export function groupAssetThreats(rows) {
  const assets = new Map()
  for (const row of rows) {
    const techniques = new Map()
    const r155 = new Map()
    for (const mapping of row.technique_mappings || []) {
      if (mapping.mitre_technique_id) {
        techniques.set(mapping.mitre_technique_id, {
          id: mapping.mitre_technique_id,
          name: mapping.mitre_technique_name,
          description: mapping.mitre_technique_description,
        })
      }
      if (mapping.un_r155_attack_id) {
        r155.set(mapping.un_r155_attack_id, {
          id: mapping.un_r155_attack_id,
          description: mapping.un_r155_attack_method,
        })
      }
    }
    if (!assets.has(row.asset)) assets.set(row.asset, [])
    assets.get(row.asset).push({
      ...row,
      riskScore: null,
      techniques: [...techniques.values()],
      r155: [...r155.values()],
    })
  }
  return assets
}

export function catalogErrorMessage(error) {
  return (
    error.response?.data?.error ||
    'Unable to load the language catalog. Check the server connection and retry.'
  )
}

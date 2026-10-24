import api from '../api/client.js'

export async function fetchCountermeasures(schema, techniqueIds, { signal } = {}) {
  const { data } = await api.post(
    `/v1/lang-schemas/${encodeURIComponent(schema)}/countermeasures`,
    { techniqueIds },
    { signal },
  )
  return data
}

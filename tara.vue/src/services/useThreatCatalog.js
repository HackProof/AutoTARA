import { ref, shallowRef, toValue, watch } from 'vue'
import { catalogErrorMessage, fetchAttackSteps, groupAssetThreats } from './threatCatalog.js'
import { getAssetParents } from './languageGraph.js'
import { mergeLanguageAttackSteps } from './languageAttackSteps.js'

// Fetch when the stencil catalog loads, rather than once per clicked instance.
// Cleanup aborts requests when the schema changes or the editor is unmounted.
export function useThreatCatalog(
  schema,
  assetTypes,
  { languageGraph = null, load = fetchAttackSteps } = {},
) {
  const assets = shallowRef(new Map())
  const loading = ref(false)
  const error = ref('')
  const revision = ref(0)
  watch(
    [
      () => toValue(schema),
      () => JSON.stringify([...new Set(toValue(assetTypes))].sort()),
      () => JSON.stringify(getAssetParents(toValue(languageGraph))),
      () => toValue(languageGraph),
      revision,
    ],
    async ([selectedSchema, assetNames, parentNames], previous, onCleanup) => {
      const controller = new AbortController()
      let active = true
      onCleanup(() => {
        active = false
        controller.abort()
      })
      assets.value = new Map()
      error.value = ''
      loading.value = false
      const names = JSON.parse(assetNames)
      if (!selectedSchema || !names.length) return
      loading.value = true
      try {
        const rows = []
        for (let start = 0; start < names.length; start += 1000) {
          rows.push(
            ...(await load(selectedSchema, names.slice(start, start + 1000), {
              signal: controller.signal,
              assetParents: JSON.parse(parentNames),
            })),
          )
          if (!active) return
        }
        assets.value = groupAssetThreats(
          mergeLanguageAttackSteps(rows, toValue(languageGraph), names),
        )
      } catch (cause) {
        if (active) error.value = catalogErrorMessage(cause)
      } finally {
        if (active) loading.value = false
      }
    },
    { immediate: true },
  )
  return { assets, loading, error, retry: () => revision.value++ }
}

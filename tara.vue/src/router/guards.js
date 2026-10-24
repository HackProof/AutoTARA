import { useThreatModelStore } from '../stores/threatModelStore.js'

export function requireDiagram(to) {
  if (to.name !== 'EditDiagram') return
  const tmStore = useThreatModelStore()
  if (!tmStore.hasDiagram || tmStore.data.modelInfo.title !== to.params.title) {
    return { name: 'MainPage', replace: true }
  }
}

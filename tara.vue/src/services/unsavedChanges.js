export const UNSAVED_DIAGRAM_MESSAGE =
  'You have unsaved changes.\nIf you leave this page without saving, your work may be lost.\nDo you want to leave without saving?'

export function protectUnsavedDiagram({ router, target, hasUnsavedChanges, flushChanges }) {
  function needsWarning() {
    // Flush inline labels and property inputs before checking the saved snapshot.
    return flushChanges() === false || hasUnsavedChanges()
  }
  const removeRouteGuard = router.beforeEach((to, from) => {
    if (from.name !== 'EditDiagram') return true
    if (to.name === from.name && to.params.title === from.params.title) return true
    return !needsWarning() || target.confirm(UNSAVED_DIAGRAM_MESSAGE)
  })
  function beforeUnload(event) {
    if (!needsWarning()) return
    // Browsers control the wording of reload/tab-close confirmation dialogs.
    event.preventDefault()
    event.returnValue = true
  }
  target.addEventListener('beforeunload', beforeUnload)
  return () => {
    removeRouteGuard()
    target.removeEventListener('beforeunload', beforeUnload)
  }
}

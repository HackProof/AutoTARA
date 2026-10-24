import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import {
  createMemoryHistory,
  createRouter,
  isNavigationFailure,
  NavigationFailureType,
} from 'vue-router'
import { useThreatModelStore } from '../src/stores/threatModelStore.js'
import { requireDiagram } from '../src/router/guards.js'
import { protectUnsavedDiagram, UNSAVED_DIAGRAM_MESSAGE } from '../src/services/unsavedChanges.js'

async function setup({ flushChanges = () => true } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useThreatModelStore(pinia)
  store.createDiagram({ title: 'Vehicle' })
  store.initializeDiagramXml('initial graph')
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'MainPage', component: {} },
      { path: '/edit-diagram/:title', name: 'EditDiagram', component: {} },
      { path: '/dashboard', name: 'Dashboard', component: {} },
      { path: '/mitre-admin', name: 'MitreAdmin', component: {} },
    ],
  })
  // Match the production registration order, including invalid-title redirects.
  router.beforeEach(requireDiagram)
  const listeners = new Map()
  const messages = []
  const target = {
    allowLeave: false,
    confirm(message) {
      messages.push(message)
      return this.allowLeave
    },
    addEventListener(type, handler) {
      listeners.set(type, handler)
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type)
    },
  }
  await router.push('/')
  await router.push('/edit-diagram/Vehicle')
  const remove = protectUnsavedDiagram({
    router,
    target,
    hasUnsavedChanges: () => store.hasUnsavedChanges,
    flushChanges: () => flushChanges(store),
  })
  function unload() {
    const event = {
      prevented: false,
      returnValue: undefined,
      preventDefault() {
        this.prevented = true
      },
    }
    listeners.get('beforeunload')?.(event)
    return event
  }
  return { store, router, target, messages, listeners, remove, unload }
}

test('dirty diagrams can cancel navigation or explicitly leave without marking changes saved', async () => {
  const { store, router, target, messages, remove } = await setup()
  store.updateDiagramXml('unsaved changes')
  const failure = await router.push('/dashboard')
  assert.ok(isNavigationFailure(failure, NavigationFailureType.aborted))
  assert.equal(router.currentRoute.value.name, 'EditDiagram')
  assert.deepEqual(messages, [UNSAVED_DIAGRAM_MESSAGE])
  assert.equal(store.data.diagrams.xml, 'unsaved changes')
  target.allowLeave = true
  await router.push('/mitre-admin')
  assert.equal(router.currentRoute.value.name, 'MitreAdmin')
  assert.equal(messages.length, 2)
  assert.equal(store.hasUnsavedChanges, true)
  remove()
})

test('clean and successfully saved diagrams navigate freely, while query changes need no warning', async () => {
  const { store, router, messages, remove } = await setup()
  await router.push('/dashboard')
  assert.deepEqual(messages, [])
  await router.push('/edit-diagram/Vehicle')
  store.updateDiagramXml('new content')
  await router.push('/edit-diagram/Vehicle?panel=properties')
  assert.deepEqual(messages, [])
  store.markDiagramSaved(store.data.diagrams.xml)
  await router.push('/')
  assert.equal(router.currentRoute.value.name, 'MainPage')
  assert.deepEqual(messages, [])
  remove()
})

test('an invalid diagram title redirects through the guard and cannot bypass the warning', async () => {
  const { store, router, messages, remove } = await setup()
  store.updateDiagramXml('unsaved changes')
  await router.push('/edit-diagram/Other')
  assert.equal(router.currentRoute.value.name, 'EditDiagram')
  assert.equal(router.currentRoute.value.params.title, 'Vehicle')
  assert.equal(messages.length, 1)
  remove()
})

test(
  'browser back navigation is cancelled when the user chooses to stay',
  { timeout: 2000 },
  async () => {
    const { store, router, messages, remove } = await setup()
    store.updateDiagramXml('unsaved changes')
    const navigation = new Promise((resolve) => {
      const stop = router.afterEach((_to, _from, failure) => {
        stop()
        resolve(failure)
      })
    })
    router.back()
    assert.ok(isNavigationFailure(await navigation, NavigationFailureType.aborted))
    assert.equal(router.currentRoute.value.name, 'EditDiagram')
    assert.equal(messages.length, 1)
    remove()
  },
)

test('pending text edits are flushed before route and unload checks, and native unload only warns while dirty', async () => {
  let pending = ''
  const { store, router, unload, messages, remove } = await setup({
    flushChanges: (store) => {
      if (pending) {
        store.updateDiagramXml(pending)
        pending = ''
      }
    },
  })
  assert.equal(unload().prevented, false)
  pending = 'editing a name before blur'
  await router.push('/')
  assert.equal(router.currentRoute.value.name, 'EditDiagram')
  assert.equal(messages.length, 1)
  store.markDiagramSaved(store.data.diagrams.xml)
  assert.equal(unload().prevented, false)
  pending = 'editing a description before blur'
  const event = unload()
  assert.equal(event.prevented, true)
  assert.equal(event.returnValue, true)
  assert.equal(messages.length, 1) // No custom confirm inside beforeunload.
  remove()
  assert.equal(unload().prevented, false)
})

test('disposing the editor removes both protections and commit failures still warn', async () => {
  const { router, unload, messages, listeners, remove } = await setup({ flushChanges: () => false })
  await router.push('/')
  assert.equal(router.currentRoute.value.name, 'EditDiagram')
  assert.equal(messages.length, 1)
  assert.equal(unload().prevented, true)
  remove()
  assert.equal(listeners.size, 0)
  await router.push('/')
  assert.equal(router.currentRoute.value.name, 'MainPage')
  assert.equal(messages.length, 1)
})

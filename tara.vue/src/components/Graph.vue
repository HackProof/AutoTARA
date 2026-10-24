<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useRouter } from 'vue-router'
import GraphButtonView from '@/views/GraphButtonView.vue'
import ElementProperties from '@/components/ElementProperties.vue'
import ThreatProperties from '@/components/ThreatProperties.vue'
import StencilPalette from '@/components/StencilPalette.vue'
import SaveDiagramModal from '@/components/SaveDiagramModal.vue'
import FlowAssociationModal from '@/components/FlowAssociationModal.vue'
import CtsaScoringModal from '@/components/CtsaScoringModal.vue'
import SusceptibilityMatrixModal from '@/components/SusceptibilityMatrixModal.vue'
import CrraModal from '@/components/CrraModal.vue'
import AttackEndpointModal from '@/components/AttackEndpointModal.vue'
import AttackPathsPanel from '@/components/AttackPathsPanel.vue'
import AttackTreeView from '@/components/AttackTreeView.vue'
import SimulationTreeView from '@/components/SimulationTreeView.vue'
import SimulationResultView from '@/components/SimulationResultView.vue'
import {
  prepareSimulation,
  requestSimulation,
  attachSimulationCells,
} from '@/services/simulation.js'
import { useThreatModelStore } from '@/stores/threatModelStore.js'
import { loadDrawioRuntime } from '@/services/drawio/runtime.js'
import { createDrawioEditor } from '@/services/drawio/editor.js'
import { DRAWIO_EDITOR_KEY } from '@/services/drawio/palette.js'
import { downloadFile } from '@/services/drawio/xml.js'
import { protectUnsavedDiagram } from '@/services/unsavedChanges.js'
import { useThreatCatalog } from '@/services/useThreatCatalog.js'
import { createAssetShapes } from '@/services/drawio/palette.js'
import { assessAssetThreats } from '@/services/ttpScoring.js'
import { sortAttackPathIndexes } from '@/services/attackPathMetrics.js'

defineOptions({ name: 'DiagramGraph' })

const tmStore = useThreatModelStore()
const router = useRouter()
const modelInfo = computed(() => tmStore.data?.modelInfo)
const graphContainer = ref(null)
const editor = shallowRef(null)
const saveDialog = ref(null)
const associationDialog = ref(null)
const ctsaDialog = ref(null)
const susceptibilityDialog = ref(null)
const crraDialog = ref(null)
const endpointDialog = ref(null)
const elementProperties = ref(null)
const errorMessage = ref('')
const loading = ref(true)
const pathAnalysis = shallowRef(null)
const activeTab = ref('diagram')
const selectedPathIndex = ref(0)
const pathSort = ref('hops')
const pathSearching = ref(false)
const pathOptions = reactive({ maxPaths: 30, maxHops: 40 })
const attackerType = ref('BreadthFirstAttacker')
const simulationRunning = ref(false)
const simulationResult = shallowRef(null)
const compromisedAssetIds = computed(() => [
  ...new Set(
    (simulationResult.value?.tree.performedNodes || []).map((node) => node.cellId).filter(Boolean),
  ),
])
const hasTree = computed(() => Boolean(pathAnalysis.value || simulationResult.value))
const availableTabs = computed(() => [
  'diagram',
  ...(hasTree.value ? ['tree'] : []),
  ...(simulationResult.value ? ['simulation'] : []),
])
watch([compromisedAssetIds, editor], ([ids, instance]) => instance?.setCompromisedAssets(ids), {
  flush: 'sync',
})
let simulationController = null
let pathWorker = null
const state = reactive({
  ready: false,
  busy: false,
  canUndo: false,
  canRedo: false,
  selectionCount: 0,
  shapeCount: 0,
  edgeCount: 0,
  zoom: 100,
  selection: null,
  connectionFeedback: null,
  attackEndpointCounts: { entry: 0, target: 0 },
})
const pathsAvailable = computed(
  () =>
    state.ready &&
    !state.busy &&
    !pathSearching.value &&
    !simulationRunning.value &&
    Boolean(tmStore.data?.languageGraph) &&
    state.attackEndpointCounts.entry > 0 &&
    state.attackEndpointCounts.target > 0,
)
const pathsHint = computed(() => {
  if (pathSearching.value) return 'Searching for attack path candidates…'
  if (!tmStore.data?.languageGraph) return 'Attach a complete MAL LangGraph in New Diagram.'
  if (!state.attackEndpointCounts.entry || !state.attackEndpointCounts.target)
    return 'Select at least one Entry and one Target attack step in the diagram.'
  return 'Find candidate paths and the Attack Steps required by their AND conditions.'
})
const simulationAvailable = computed(() => pathsAvailable.value && !catalogLoading.value)
const simulationHint = computed(() => {
  if (simulationRunning.value) return 'Running the simulation…'
  if (!state.ready || state.busy) return 'Wait for the diagram editor to be ready.'
  if (catalogLoading.value) return 'Loading attack steps and CTSA scores…'
  if (!tmStore.data?.languageGraph) return 'Attach a complete MAL LangGraph in New Diagram.'
  if (!state.attackEndpointCounts.entry || !state.attackEndpointCounts.target)
    return 'Select at least one Entry and one Target attack step in the diagram.'
  return `Simulate with ${attackerType.value} and display compromised paths to the Targets.`
})

async function simulate() {
  if (!simulationAvailable.value || !flushPendingChanges()) return
  const prepared = prepareSimulation({
    snapshot: editor.value.getSnapshot(),
    languageGraph: tmStore.data.languageGraph,
    schema: catalogSchema.value,
    modelInfo: modelInfo.value,
    attackerType: attackerType.value,
    catalogRows: [...assetThreats.value.values()].flat(),
  })
  resetPaths()
  const controller = new AbortController()
  simulationController = controller
  simulationRunning.value = true
  try {
    const result = await requestSimulation(prepared.request, controller.signal)
    if (simulationController !== controller) return
    simulationResult.value = attachSimulationCells(
      result,
      prepared.cellIds,
      prepared.riskScore,
      prepared.ctsaScore,
      prepared.ttpAssessment,
    )
  } catch (error) {
    if (simulationController === controller && !controller.signal.aborted)
      errorMessage.value = error.message || 'Simulation failed.'
  } finally {
    if (simulationController === controller) {
      simulationController = null
      simulationRunning.value = false
    }
  }
}

function resetPaths() {
  simulationController?.abort()
  simulationController = null
  simulationRunning.value = false
  simulationResult.value = null
  pathWorker?.terminate()
  pathWorker = null
  pathSearching.value = false
  pathAnalysis.value = null
  activeTab.value = 'diagram'
  selectedPathIndex.value = 0
}

function switchTab(tab) {
  if (!availableTabs.value.includes(tab)) return
  if (tab !== 'diagram' && (!flushPendingChanges() || !availableTabs.value.includes(tab))) return
  activeTab.value = tab
}

async function navigateTabs(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const tabs = availableTabs.value
  const direction = event.key === 'ArrowLeft' ? -1 : 1
  const next =
    event.key === 'Home'
      ? tabs[0]
      : event.key === 'End'
        ? tabs.at(-1)
        : tabs[(tabs.indexOf(activeTab.value) + direction + tabs.length) % tabs.length]
  switchTab(next)
  await nextTick()
  document.getElementById(`${activeTab.value}-tab`)?.focus()
}

async function inspectPathAsset(id) {
  activeTab.value = 'diagram'
  await nextTick()
  editor.value?.inspectAsset(id)
}

function findPaths() {
  if (!pathsAvailable.value || !flushPendingChanges()) return
  resetPaths()
  const snapshot = editor.value.getSnapshot()
  const worker = new Worker(new URL('../services/attackPaths.worker.js', import.meta.url), {
    type: 'module',
  })
  pathWorker = worker
  pathSearching.value = true
  const finish = () => {
    worker.terminate()
    pathWorker = null
    pathSearching.value = false
  }
  worker.onmessage = ({ data }) => {
    if (pathWorker !== worker) return
    finish()
    if (data.error) errorMessage.value = data.error
    else {
      pathAnalysis.value = data
      selectedPathIndex.value = sortAttackPathIndexes(data.result, pathSort.value)[0] ?? 0
      activeTab.value = 'tree'
    }
  }
  worker.onerror = () => {
    if (pathWorker !== worker) return
    finish()
    errorMessage.value = 'Attack path search failed. Try Find Paths again.'
  }
  try {
    // Vue proxies cannot be structured-cloned into a Worker.
    worker.postMessage(
      JSON.parse(
        JSON.stringify({
          snapshot,
          languageGraph: tmStore.data.languageGraph,
          schema: catalogSchema.value,
          catalogRows: [...assetThreats.value.values()]
            .flat()
            .map(({ asset, name, attack_step_id, qualified_name, declared_asset }) => ({
              asset,
              name,
              attack_step_id,
              qualified_name,
              declared_asset,
            })),
          options: pathOptions,
        }),
      ),
    )
  } catch (error) {
    finish()
    throw error
  }
}

// Endpoint/association edits, imports, and undo/redo invalidate the old result.
// Selection and zoom changes leave it intact; a superseded Worker cannot publish.
watch(
  () => [
    tmStore.data?.diagrams.xml,
    tmStore.data?.languageGraph,
    tmStore.data?.threatCatalogSchema,
    attackerType.value,
  ],
  resetPaths,
  { flush: 'sync' },
)
const catalogSchema = computed(() => tmStore.data?.threatCatalogSchema || '')
const diagramSnapshot = computed(() => {
  // XML changes include edits, imports, undo/redo and saved CTSA assessments.
  // Track them so every diagram instance's type is loaded, without a selection.
  const xml = tmStore.data?.diagrams.xml
  return xml != null ? editor.value?.getSnapshot() : null
})
const catalogAssetTypes = computed(() => {
  const names = createAssetShapes(tmStore.data?.languageGraph).map((shape) => shape.assetType)
  for (const asset of diagramSnapshot.value?.vertices || []) {
    if (asset.assetType && (!asset.kind || asset.kind === 'asset')) names.push(asset.assetType)
  }
  const selected = state.selection
  if (selected?.assetType && !selected.isEdge && !selected.isBoundary)
    names.push(selected.assetType)
  return names
})
const {
  assets: assetThreats,
  loading: catalogLoading,
  error: catalogError,
  retry: retryCatalog,
} = useThreatCatalog(catalogSchema, catalogAssetTypes, {
  languageGraph: computed(() => tmStore.data?.languageGraph),
})
const selectedThreats = computed(() =>
  assessAssetThreats(
    assetThreats.value.get(state.selection?.assetType) || [],
    state.selection?.threatAssessments?.[catalogSchema.value],
  ),
)
const endpointHint = computed(() => {
  if (!state.ready || state.busy) return 'Wait for the diagram editor to be ready.'
  if (
    state.selectionCount !== 1 ||
    !state.selection?.assetType ||
    state.selection.isEdge ||
    state.selection.isBoundary
  )
    return 'Select one MAL asset to set Entry or Target attack steps.'
  if (!catalogSchema.value)
    return 'Choose a DB Schema (Lang) in New Diagram to set attack endpoints.'
  return 'Choose Entry or Target attack steps for the selected asset.'
})
const endpointsAvailable = computed(
  () =>
    state.ready &&
    !state.busy &&
    state.selectionCount === 1 &&
    Boolean(state.selection?.assetType) &&
    !state.selection.isEdge &&
    !state.selection.isBoundary &&
    Boolean(catalogSchema.value),
)
const selectedEndpoints = computed(() =>
  state.selectionCount === 1 ? state.selection?.attackEndpoints?.[catalogSchema.value] || {} : {},
)
const ctsaHint = computed(() => {
  if (!state.ready || state.busy) return 'Wait for the diagram editor to be ready.'
  if (!catalogSchema.value)
    return 'Choose a DB Schema (Lang) in New Diagram to enable threat analysis.'
  if (state.selectionCount === 0) return 'View the Susceptibility Matrix for all diagram assets.'
  if (
    state.selectionCount !== 1 ||
    !state.selection?.assetType ||
    state.selection.isEdge ||
    state.selection.isBoundary
  )
    return 'Select one MAL asset to assess all of its threats.'
  if (catalogLoading.value) return 'Loading asset threats…'
  if (catalogError.value) return 'Retry loading the asset threats before opening CTSA.'
  if (!selectedThreats.value.length) return 'No attack steps are recorded for this asset.'
  return 'Assess all threats for the selected asset.'
})
const ctsaAvailable = computed(
  () =>
    state.ready &&
    !state.busy &&
    Boolean(catalogSchema.value) &&
    (state.selectionCount === 0 ||
      (state.selectionCount === 1 &&
        Boolean(state.selection?.assetType) &&
        !state.selection.isEdge &&
        !state.selection.isBoundary &&
        !catalogLoading.value &&
        !catalogError.value &&
        selectedThreats.value.length > 0)),
)
const crraAvailable = computed(() => state.ready && !state.busy && Boolean(catalogSchema.value))
const crraHint = computed(() => {
  if (!state.ready || state.busy) return 'Wait for the diagram editor to be ready.'
  if (!catalogSchema.value) return 'Choose a DB Schema (Lang) in New Diagram to enable CRRA.'
  return 'Select attack vectors, evaluate countermeasures and build a CRRA solution.'
})
let initialization = 0
let removeNavigationProtection

async function initialize() {
  const request = ++initialization
  loading.value = true
  errorMessage.value = ''
  try {
    const runtime = await loadDrawioRuntime()
    if (request !== initialization) return
    editor.value = createDrawioEditor({
      container: graphContainer.value,
      runtime,
      xml: tmStore.data.diagrams.xml,
      languageGraph: tmStore.data.languageGraph,
      catalogSchema: catalogSchema.value,
      onChange: (xml, schema) => tmStore.updateDiagramXml(xml, schema),
      onState: (next) => Object.assign(state, next),
      onSave: () => perform('save'),
      onChooseAssociation: (id) => associationDialog.value?.openModal(id),
    })
    tmStore.initializeDiagramXml(editor.value.getXml(), editor.value.getCatalogSchema())
  } catch (error) {
    if (request === initialization) errorMessage.value = error.message
  } finally {
    if (request === initialization) loading.value = false
  }
}

async function perform(action) {
  if (!editor.value || state.busy) return
  errorMessage.value = ''
  try {
    const filename = modelInfo.value.title || 'diagram'
    if (action === 'simulate') {
      await simulate()
    } else if (action === 'findPaths') {
      findPaths()
    } else if (action === 'resetPaths') {
      resetPaths()
    } else if (action === 'entry' || action === 'target') {
      if (!endpointsAvailable.value || !flushPendingChanges()) return
      endpointDialog.value.openModal({
        asset: state.selection,
        schema: catalogSchema.value,
        kind: action,
      })
    } else if (action === 'ctsa') {
      if (!ctsaAvailable.value || !flushPendingChanges()) return
      if (state.selectionCount === 0) {
        susceptibilityDialog.value.openModal({
          snapshot: editor.value.getSnapshot(),
          schema: catalogSchema.value,
        })
      } else {
        ctsaDialog.value.openModal({
          asset: state.selection,
          schema: catalogSchema.value,
          threats: selectedThreats.value,
        })
      }
    } else if (action === 'crra') {
      if (!crraAvailable.value || !flushPendingChanges()) return
      crraDialog.value.openModal({
        snapshot: editor.value.getSnapshot(),
        schema: catalogSchema.value,
      })
    } else if (action === 'save' || action === 'extract') {
      if (!flushPendingChanges()) return
      saveDialog.value.openModal(action === 'extract' ? 'mal' : 'drawio')
    } else if (action === 'screenshot') {
      state.busy = true
      downloadFile(await editor.value.exportPng(), `${filename}.png`, 'image/png')
    } else {
      editor.value[action]?.()
    }
  } catch (error) {
    errorMessage.value = error.message || 'The diagram action failed.'
  } finally {
    state.busy = false
  }
}

async function importFile(file) {
  if (!file || !editor.value || state.busy) return
  state.busy = true
  errorMessage.value = ''
  const instance = editor.value
  try {
    const text = await file.text()
    if (editor.value !== instance) return
    const result = await instance.loadFile(text)
    if (editor.value === instance && result?.ctsaError) errorMessage.value = result.ctsaError
  } catch (error) {
    if (editor.value === instance)
      errorMessage.value = error.message || 'The diagram file could not be opened.'
  } finally {
    state.busy = false
  }
}

function updateProperties(id, changes) {
  if (!editor.value || state.busy) return
  errorMessage.value = ''
  try {
    editor.value.updateProperties(id, changes)
  } catch (error) {
    errorMessage.value = error.message || 'The element properties could not be updated.'
  }
}

function flushPendingChanges() {
  if (!editor.value) return true
  try {
    elementProperties.value?.flushChanges()
    tmStore.updateDiagramXml(editor.value.getXml(), editor.value.getCatalogSchema())
    return true
  } catch (error) {
    errorMessage.value = error.message || 'The current edits could not be applied.'
    return false
  }
}

provide(DRAWIO_EDITOR_KEY, {
  editor,
  state,
  perform,
  importFile,
  ctsaAvailable,
  ctsaHint,
  crraAvailable,
  crraHint,
  endpointsAvailable,
  endpointHint,
  selectedEndpoints,
  pathsAvailable,
  pathsHint,
  pathSearching,
  pathAnalysis,
  pathOptions,
  attackerType,
  simulationAvailable,
  simulationHint,
  simulationRunning,
  simulationResult,
})
onMounted(initialize)
onMounted(() => {
  removeNavigationProtection = protectUnsavedDiagram({
    router,
    target: window,
    hasUnsavedChanges: () => tmStore.hasUnsavedChanges,
    flushChanges: flushPendingChanges,
  })
})
onBeforeUnmount(() => {
  removeNavigationProtection?.()
  initialization += 1
  resetPaths()
  editor.value?.destroy()
  editor.value = null
  state.ready = false
})
</script>

<template>
  <div class="diagram-workspace mt-2" :class="{ 'tree-active': activeTab !== 'diagram' }">
    <aside
      v-show="activeTab === 'diagram'"
      id="stencil_container"
      class="stencil-container"
      aria-label="Stencil list"
    >
      <StencilPalette
        :language-graph="tmStore.data?.languageGraph"
        :selected-element="state.selectionCount === 1 ? state.selection : null"
        :connection-feedback="state.connectionFeedback"
        :catalog-loading="catalogLoading"
        :catalog-error="catalogError"
        @retry-catalog="retryCatalog"
      />
    </aside>

    <section class="app-main" aria-labelledby="diagram-title-heading">
      <h1 id="diagram-title-heading" class="h3 mb-2 text-break">{{ modelInfo?.title }}</h1>
      <div class="nav nav-tabs" role="tablist" aria-label="Diagram views" @keydown="navigateTabs">
        <button
          id="diagram-tab"
          type="button"
          class="nav-link"
          :class="{ active: activeTab === 'diagram' }"
          role="tab"
          aria-controls="diagram-panel"
          :aria-selected="activeTab === 'diagram'"
          :tabindex="activeTab === 'diagram' ? 0 : -1"
          @click="switchTab('diagram')"
        >
          Diagram
        </button>
        <button
          v-if="hasTree"
          id="tree-tab"
          type="button"
          class="nav-link"
          :class="{ active: activeTab === 'tree' }"
          role="tab"
          aria-controls="tree-panel"
          :aria-selected="activeTab === 'tree'"
          :tabindex="activeTab === 'tree' ? 0 : -1"
          @click="switchTab('tree')"
        >
          Attack Path
          <span class="badge text-bg-primary ms-1">{{
            simulationResult ? simulationResult.tree.nodes.length : pathAnalysis.result.paths.length
          }}</span>
        </button>
        <button
          v-if="simulationResult"
          id="simulation-tab"
          type="button"
          class="nav-link"
          :class="{ active: activeTab === 'simulation' }"
          role="tab"
          aria-controls="simulation-panel"
          :aria-selected="activeTab === 'simulation'"
          :tabindex="activeTab === 'simulation' ? 0 : -1"
          @click="switchTab('simulation')"
        >
          Simulator Result
          <span class="badge text-bg-danger ms-1">{{
            simulationResult.tree.performedNodes.length
          }}</span>
        </button>
      </div>
      <div v-show="activeTab === 'diagram'"><GraphButtonView /></div>
      <p v-if="tmStore.storageError" class="alert alert-warning py-2 mb-0 small" role="status">
        {{ tmStore.storageError }}
      </p>
      <div v-if="errorMessage" class="alert alert-danger py-2 mb-0 small" role="alert">
        {{ errorMessage }}
        <button
          v-if="!state.ready"
          type="button"
          class="btn btn-sm btn-outline-danger ms-2"
          @click="initialize"
        >
          Retry
        </button>
      </div>
      <div v-if="pathSearching" class="alert alert-info py-2 mb-0 small" role="status">
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        Finding attack path candidates…
        <button type="button" class="btn btn-sm btn-outline-secondary ms-2" @click="resetPaths">
          Cancel
        </button>
      </div>
      <div v-if="simulationRunning" class="alert alert-info py-2 mb-0 small" role="status">
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        Running {{ attackerType }} simulation…
        <button type="button" class="btn btn-sm btn-outline-secondary ms-2" @click="resetPaths">
          Cancel
        </button>
      </div>
      <div
        v-show="activeTab === 'diagram'"
        id="diagram-panel"
        class="diagram-tab"
        role="tabpanel"
        aria-labelledby="diagram-tab"
      >
        <div class="graph-shell">
          <div
            id="graph_container"
            ref="graphContainer"
            class="graph-container"
            role="region"
            aria-label="Graph"
            aria-describedby="graph-help"
            tabindex="0"
          ></div>
          <div v-if="loading" class="graph-loading" role="status">
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading
            diagram editor…
          </div>
        </div>
        <div class="graph-status small text-muted">
          <p v-if="simulationResult" class="simulation-feedback text-danger mb-0" role="status">
            <i class="fa-solid fa-circle me-1" aria-hidden="true"></i>
            Red fill: {{ compromisedAssetIds.length }} compromised assets (including Entry).
            <button
              type="button"
              class="btn btn-sm btn-outline-primary ms-2"
              @click="switchTab('tree')"
            >
              View attack paths
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline-danger ms-2"
              @click="switchTab('simulation')"
            >
              View simulator result
            </button>
          </p>
          <p v-if="state.connectionFeedback" class="connection-feedback mb-0" role="status">
            <i class="fa-solid fa-circle-nodes me-1" aria-hidden="true"></i>
            <template v-if="!state.connectionFeedback.hasAssetType">
              This shape has no MAL asset type. Start from a MAL asset in the diagram.
            </template>
            <template v-else-if="state.connectionFeedback.targetCount">
              {{ state.connectionFeedback.sourceLabel }}:
              {{ state.connectionFeedback.targetCount }} compatible assets highlighted in green.
              Drag to a highlighted asset to connect. Esc to cancel.
            </template>
            <template v-else>
              {{ state.connectionFeedback.sourceLabel }}: No compatible assets are currently placed
              in the diagram. Esc to cancel.
            </template>
          </p>
          <span id="graph-help"
            >Drag shapes to move. Double-click to rename. Hover a shape and drag one of its 8 ports
            to connect. Right-drag to pan.</span
          >
          <div class="d-flex gap-2 align-items-center flex-shrink-0">
            <span
              >{{ state.shapeCount }} shapes · {{ state.edgeCount }} flows · {{ state.zoom }}%</span
            >
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              :disabled="!state.ready || !state.shapeCount"
              @click="perform('fit')"
            >
              Fit
            </button>
          </div>
        </div>
        <AttackPathsPanel
          v-if="pathAnalysis"
          v-model:selected-index="selectedPathIndex"
          v-model:sort-by="pathSort"
          :analysis="pathAnalysis"
          @reset="resetPaths"
          @inspect="inspectPathAsset"
        />
      </div>
      <div
        v-if="simulationResult"
        v-show="activeTab === 'simulation'"
        id="simulation-panel"
        class="tree-tab"
        role="tabpanel"
        aria-labelledby="simulation-tab"
      >
        <SimulationResultView
          :result="simulationResult"
          :active="activeTab === 'simulation'"
          @reset="resetPaths"
          @inspect="inspectPathAsset"
        />
      </div>
      <div
        v-if="hasTree"
        v-show="activeTab === 'tree'"
        id="tree-panel"
        class="tree-tab"
        role="tabpanel"
        aria-labelledby="tree-tab"
      >
        <SimulationTreeView
          v-if="simulationResult"
          :result="simulationResult"
          :active="activeTab === 'tree'"
          @reset="resetPaths"
          @inspect="inspectPathAsset"
        />
        <AttackTreeView
          v-else
          :analysis="pathAnalysis"
          v-model:selected-index="selectedPathIndex"
          v-model:sort-by="pathSort"
          :active="activeTab === 'tree'"
          @reset="resetPaths"
          @inspect="inspectPathAsset"
        />
      </div>
    </section>

    <aside
      v-show="activeTab === 'diagram'"
      class="properties-container"
      aria-label="Diagram properties and threats"
    >
      <ElementProperties
        ref="elementProperties"
        :selected-element="state.selection"
        :disabled="state.busy"
        @update-properties="updateProperties"
      />
      <ThreatProperties
        :selected-element="state.selectionCount === 1 ? state.selection : null"
        :catalog-schema="catalogSchema"
        :threats="selectedThreats"
        :loading="catalogLoading"
        :error="catalogError"
        @retry="retryCatalog"
      />
    </aside>
  </div>
  <SaveDiagramModal
    ref="saveDialog"
    :editor="editor"
    :model-info="modelInfo"
    :language-graph="tmStore.data?.languageGraph"
    @saved="tmStore.markDiagramSaved"
  />
  <FlowAssociationModal ref="associationDialog" :editor="editor" />
  <CtsaScoringModal ref="ctsaDialog" :editor="editor" />
  <SusceptibilityMatrixModal
    ref="susceptibilityDialog"
    :threats-by-asset="assetThreats"
    :catalog-schema="catalogSchema"
    :loading="catalogLoading"
    :error="catalogError"
    @retry="retryCatalog"
  />
  <CrraModal
    ref="crraDialog"
    :editor="editor"
    :threats-by-asset="assetThreats"
    :catalog-schema="catalogSchema"
    :loading="catalogLoading"
    :error="catalogError"
    @retry="retryCatalog"
  />
  <AttackEndpointModal
    ref="endpointDialog"
    :editor="editor"
    :threats-by-asset="assetThreats"
    :catalog-schema="catalogSchema"
    :loading="catalogLoading"
    :error="catalogError"
    @retry="retryCatalog"
  />
</template>

<style scoped>
.diagram-workspace {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) 280px;
  gap: 8px;
  height: max(620px, calc(100dvh - 88px));
  align-items: stretch;
}

.diagram-workspace.tree-active {
  grid-template-columns: minmax(0, 1fr);
}
.diagram-tab,
.tree-tab {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.stencil-container {
  min-height: 0;
  border: 1px solid #f0f0f0;
  background-color: #fff;
}

.app-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.graph-shell {
  position: relative;
  flex: 1;
  min-height: 300px;
}

.graph-container {
  position: absolute;
  inset: 0;
  overflow: auto;
  border: 1px solid #f0f0f0;
  border-top: 0;
  background-color: #fff;
  background-image: radial-gradient(#d6dce2 0.75px, transparent 0.75px);
  background-attachment: local;
  outline: none;
  touch-action: none;
}

.graph-container:focus-visible {
  outline: 2px solid #9ec5fe;
  outline-offset: -2px;
}
.graph-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffffdd;
}
.graph-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid #e9ecef;
  background: #f8f9fa;
  font-size: 0.72rem;
}

.properties-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}

.connection-feedback {
  flex-basis: 100%;
  color: #146c43;
  overflow-wrap: anywhere;
}

.simulation-feedback {
  flex-basis: 100%;
}

@media (max-width: 1199.98px) {
  .diagram-workspace {
    grid-template-columns: 160px minmax(0, 1fr) 240px;
  }
}

@media (max-width: 767.98px) {
  .diagram-workspace {
    grid-template-columns: 120px minmax(0, 1fr);
    height: auto;
    min-height: calc(100dvh - 88px);
    grid-template-rows: minmax(620px, 1fr) auto;
  }

  .properties-container {
    grid-column: 1 / -1;
  }
}

@media (max-width: 399.98px) {
  .diagram-workspace {
    grid-template-columns: 80px minmax(0, 1fr);
  }
}
</style>

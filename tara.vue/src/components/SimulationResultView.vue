<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  buildSimulationResultGraph,
  buildSimulationTimeline,
  groupSimulationTimelineByAsset,
  getSimulationCtsaScore,
  simulationCtsaScoreTitle,
  layoutSimulationResult,
  sortSimulationAssets,
  summarizeSimulationAfr,
} from '@/services/simulationResult.js'
import { loadDrawioRuntime } from '@/services/drawio/runtime.js'
import { createSimulationResultDiagram } from '@/services/drawio/simulationResult.js'
import { riskScoreClass, riskScoreLabel } from '@/services/ttpScoring.js'

const props = defineProps({
  result: { type: Object, required: true },
  active: { type: Boolean, default: true },
})
const emit = defineEmits(['inspect', 'reset'])
const container = ref(null)
const selected = shallowRef(null)
const selectedAssetId = ref(null)
const expandedAssets = shallowRef(new Set())
const targetPathsOnly = ref(true)
const assetSortBy = ref('iteration-asc')
const listView = ref('flow')
const flowSortBy = ref('iteration-asc')
const ctsaScore = (node) => getSimulationCtsaScore(node)?.value ?? null
const ready = ref(false)
const error = ref('')
const zoom = ref(100)
const graph = computed(() =>
  buildSimulationResultGraph(props.result.tree, { targetPathsOnly: targetPathsOnly.value }),
)
const layout = computed(() => layoutSimulationResult(graph.value, expandedAssets.value))
const sortedAssets = computed(() => sortSimulationAssets(graph.value.assets, assetSortBy.value))
const timeline = computed(() =>
  groupSimulationTimelineByAsset(buildSimulationTimeline(graph.value.nodes, flowSortBy.value)),
)
const timelineIterationLabel = (group) => {
  if (group.firstIteration === null) return 'Iteration unknown'
  if (group.firstIteration === group.lastIteration) return `Iteration ${group.firstIteration}`
  return `Iterations ${Math.min(group.firstIteration, group.lastIteration)}–${Math.max(group.firstIteration, group.lastIteration)}`
}
const selectedAsset = computed(() =>
  graph.value.assets.find((asset) => asset.id === selectedAssetId.value),
)
const reachedCount = computed(() => props.result.tree.targets.filter((node) => node.reached).length)
const afrResults = computed(() => summarizeSimulationAfr(props.result.tree))
const afrClass = (rating) => {
  if (rating === 2) return 'text-bg-danger'
  if (rating === 1.5) return 'text-bg-warning'
  if (rating === 1) return 'text-bg-info'
  return 'text-bg-secondary'
}
const outcome = computed(() => {
  if (props.result.partial) return 'Step limit reached · partial result'
  if (props.result.stopReason === 'goals_reached') return 'All Targets reached'
  return 'Available actions exhausted'
})
let diagram
let disposed = false
let needsRender = true
let needsInitialView = true
let renderedResult = null

function select(node) {
  selected.value = node
  selectedAssetId.value = node.assetKey
  if (!expandedAssets.value.has(node.assetKey))
    expandedAssets.value = new Set(expandedAssets.value).add(node.assetKey)
  else diagram?.select(node.id)
}
function toggleAsset(id) {
  selected.value = null
  selectedAssetId.value = id
  const next = new Set(expandedAssets.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedAssets.value = next
}
function render() {
  if (!diagram || !props.active || !needsRender) return
  diagram.render(layout.value, {
    selectedNodeId: selected.value?.id,
    selectedAssetId: selectedAssetId.value,
    resetLayout: renderedResult !== props.result,
  })
  renderedResult = props.result
  if (needsInitialView) {
    diagram.fit()
    needsInitialView = false
  }
  needsRender = false
}
function resetLayout() {
  renderedResult = null
  needsInitialView = true
  needsRender = true
  render()
}
watch(
  graph,
  (graph) => {
    selected.value = graph.nodes.find((node) => node.id === selected.value?.id) || null
    const assetIds = new Set(graph.assets.map((asset) => asset.id))
    if (!assetIds.has(selectedAssetId.value)) selectedAssetId.value = null
    expandedAssets.value = new Set([...expandedAssets.value].filter((id) => assetIds.has(id)))
    needsInitialView = true
  },
  { flush: 'sync' },
)
watch(
  layout,
  () => {
    needsRender = true
    render()
  },
  { flush: 'post' },
)
watch(
  () => props.active,
  async (active) => {
    if (!active) return
    await nextTick()
    if (disposed || !diagram) return
    diagram.resize()
    render()
  },
)
onMounted(async () => {
  try {
    const runtime = await loadDrawioRuntime()
    if (disposed) return
    diagram = createSimulationResultDiagram({
      container: container.value,
      runtime,
      onSelect: (node) => {
        selected.value = node
      },
      onSelectAsset: (asset) => {
        selectedAssetId.value = asset?.id || null
      },
      onToggleAsset: toggleAsset,
      onZoom: (value) => {
        zoom.value = value
      },
    })
    ready.value = true
    render()
  } catch (cause) {
    error.value = cause.message || 'Unable to display the Simulator Result diagram.'
  }
})
onBeforeUnmount(() => {
  disposed = true
  diagram?.destroy()
})
</script>

<template>
  <section class="simulation-result border" aria-label="Simulator Result workspace">
    <div class="result-summary p-2 border-bottom small" role="status">
      <strong>{{ result.attackerType }}</strong>
      <span class="badge" :class="result.partial ? 'text-bg-warning' : 'text-bg-secondary'">
        {{ outcome }}
      </span>
      <span>{{ graph.nodes.length }} compromised steps · {{ graph.assets.length }} assets</span>
      <span v-if="targetPathsOnly">{{ graph.hiddenStepCount }} unrelated steps hidden</span>
      <span>{{ reachedCount }}/{{ result.tree.targets.length }} Targets reached</span>
      <span>{{ result.steps }} actions</span>
    </div>
    <div class="result-body">
      <aside class="result-assets p-2 border-end" aria-label="Compromised assets and attack steps">
        <h2 class="h6">{{ listView === 'flow' ? 'Compromise flow' : 'Compromised assets' }}</h2>
        <div
          class="btn-group btn-group-sm w-100 mb-2"
          role="group"
          aria-label="Compromise list view"
        >
          <button
            type="button"
            class="btn"
            :class="listView === 'flow' ? 'btn-primary' : 'btn-outline-secondary'"
            :aria-pressed="listView === 'flow'"
            @click="listView = 'flow'"
          >
            Compromise flow
          </button>
          <button
            type="button"
            class="btn"
            :class="listView === 'assets' ? 'btn-primary' : 'btn-outline-secondary'"
            :aria-pressed="listView === 'assets'"
            @click="listView = 'assets'"
          >
            By asset
          </button>
        </div>
        <template v-if="listView === 'flow'">
          <label for="simulation-flow-sort" class="form-label small mb-1">Sort flow</label>
          <select id="simulation-flow-sort" v-model="flowSortBy" class="form-select form-select-sm">
            <option value="iteration-asc">Iteration: Earliest first</option>
            <option value="iteration-desc">Iteration: Latest first</option>
          </select>
          <p class="small text-secondary mt-1 mb-2">
            Multiple consecutive steps on the same asset are grouped together. Single steps are
            shown directly. Steps in the same iteration have no recorded internal order.
          </p>
          <p v-if="targetPathsOnly && graph.hiddenStepCount" class="small text-secondary">
            {{ graph.hiddenStepCount }} unrelated steps hidden. Uncheck the Target filter to view
            the complete run.
          </p>
          <ol
            class="compromise-timeline list-unstyled mb-3"
            aria-label="Compromise flow by iteration"
          >
            <li
              v-for="group in timeline"
              :key="group.id"
              class="timeline-iteration"
              :class="{ 'timeline-selected': group.nodes.some((node) => node.id === selected?.id) }"
            >
              <h3 class="small fw-bold mb-1">
                {{ timelineIterationLabel(group) }}
              </h3>
              <p class="small text-secondary mb-1">
                {{ group.nodes.length }} {{ group.nodes.length === 1 ? 'step' : 'steps' }} ·
                {{ group.assetCount }}
                {{ group.assetCount === 1 ? 'asset' : 'assets' }}
              </p>
              <div v-for="(asset, assetIndex) in group.assets" :key="asset.assetKey" class="mb-2">
                <h4 v-if="asset.nodes.length > 1" class="h6 mb-1">
                  <button
                    type="button"
                    class="btn btn-sm w-100 text-start text-break"
                    :class="
                      selectedAssetId === asset.assetKey ? 'btn-primary' : 'btn-outline-secondary'
                    "
                    :aria-expanded="expandedAssets.has(asset.assetKey)"
                    :aria-controls="`simulation-flow-${group.id}-asset-${assetIndex}`"
                    @click="toggleAsset(asset.assetKey)"
                  >
                    <strong class="d-block"
                      >{{ expandedAssets.has(asset.assetKey) ? '▾' : '▸' }}
                      {{ asset.name || 'Unknown asset' }}</strong
                    >
                    <span class="d-block small"
                      >{{ asset.type || 'Asset' }} (+{{ asset.nodes.length }} steps)</span
                    >
                    <span
                      v-if="asset.nodes.some((node) => node.isEntry)"
                      class="badge text-bg-success me-1"
                      >Entry</span
                    >
                    <span
                      v-if="asset.nodes.some((node) => node.isTarget)"
                      class="badge text-bg-purple"
                      >Target reached</span
                    >
                  </button>
                </h4>
                <div
                  :id="`simulation-flow-${group.id}-asset-${assetIndex}`"
                  class="d-grid gap-1"
                  :class="{ 'ms-2': asset.nodes.length > 1 }"
                >
                  <template v-if="asset.nodes.length === 1 || expandedAssets.has(asset.assetKey)">
                    <button
                      v-for="node in asset.nodes"
                      :key="node.id"
                      type="button"
                      class="btn btn-sm w-100 text-start text-break"
                      :class="selected?.id === node.id ? 'btn-primary' : 'btn-outline-secondary'"
                      :aria-pressed="selected?.id === node.id"
                      @click="select(node)"
                    >
                      <strong>{{
                        asset.nodes.length === 1
                          ? node.fullName || `${asset.name || 'Unknown asset'}:${node.name}`
                          : node.name
                      }}</strong>
                      <span v-if="node.isEntry" class="badge text-bg-success ms-1">Entry</span>
                      <span v-if="node.isTarget" class="badge text-bg-purple ms-1"
                        >Target reached</span
                      >
                      <span class="d-block small"
                        >{{ node.type.toUpperCase() }} · Iteration
                        {{ node.performedAt ?? '—' }}</span
                      >
                      <span
                        v-if="ctsaScore(node) !== null"
                        class="badge rounded-pill mt-1"
                        :class="riskScoreClass(ctsaScore(node))"
                        :title="simulationCtsaScoreTitle(node)"
                        >CTSA Score: {{ riskScoreLabel(ctsaScore(node)) }}</span
                      >
                    </button>
                  </template>
                </div>
              </div>
            </li>
          </ol>
          <p v-if="!timeline.length" class="small text-secondary">
            No compromised steps in this view.
          </p>
        </template>
        <template v-else>
          <label for="simulation-asset-sort" class="form-label small mb-1">Sort assets</label>
          <select
            id="simulation-asset-sort"
            v-model="assetSortBy"
            class="form-select form-select-sm"
            aria-describedby="simulation-asset-sort-help"
          >
            <option value="iteration-asc">Iteration: Earliest first</option>
            <option value="iteration-desc">Iteration: Latest first</option>
            <option value="name">Asset name: A–Z</option>
          </select>
          <p id="simulation-asset-sort-help" class="small text-secondary mt-1 mb-2">
            Iteration order uses each asset's first compromise.
          </p>
          <p class="small text-secondary">
            Click an asset in the diagram or this list to show or hide its Attack Steps.
          </p>
          <div v-for="(asset, index) in sortedAssets" :key="asset.id" class="mb-3">
            <h3 class="h6 mb-1">
              <button
                type="button"
                class="btn btn-sm w-100 text-start text-break"
                :class="selectedAssetId === asset.id ? 'btn-primary' : 'btn-outline-secondary'"
                :aria-expanded="expandedAssets.has(asset.id)"
                :aria-controls="`simulation-asset-steps-${index}`"
                @click="toggleAsset(asset.id)"
              >
                <strong
                  >{{ expandedAssets.has(asset.id) ? '▾' : '▸' }}
                  {{ asset.name || 'Unknown asset' }}</strong
                >
                <span class="d-block small"
                  >{{ asset.type || 'Asset' }} (+{{ asset.nodes.length }} steps)</span
                >
                <span class="d-block small"
                  >First compromise · Iteration {{ asset.firstCompromisedAt ?? '—' }}</span
                >
              </button>
            </h3>
            <div :id="`simulation-asset-steps-${index}`" class="d-grid gap-1 ms-2">
              <template v-if="expandedAssets.has(asset.id)">
                <button
                  v-for="node in asset.nodes"
                  :key="node.id"
                  type="button"
                  class="btn btn-sm text-start text-break"
                  :class="selected?.id === node.id ? 'btn-primary' : 'btn-outline-secondary'"
                  :aria-pressed="selected?.id === node.id"
                  @click="select(node)"
                >
                  <strong>{{ node.name }}</strong>
                  <span v-if="node.isEntry" class="badge text-bg-success ms-1">Entry</span>
                  <span v-if="node.isTarget" class="badge text-bg-purple ms-1">Target reached</span>
                  <span class="d-block small">
                    {{ node.type.toUpperCase() }} · Iteration {{ node.performedAt ?? '—' }}
                  </span>
                  <span
                    v-if="ctsaScore(node) !== null"
                    class="badge rounded-pill mt-1"
                    :class="riskScoreClass(ctsaScore(node))"
                    :title="simulationCtsaScoreTitle(node)"
                    >CTSA Score: {{ riskScoreLabel(ctsaScore(node)) }}</span
                  >
                </button>
              </template>
            </div>
          </div>
        </template>
        <details class="small border-top pt-2">
          <summary>Targets · {{ reachedCount }}/{{ result.tree.targets.length }} reached</summary>
          <ul class="ps-3 mt-2 mb-0">
            <li v-for="target in result.tree.targets" :key="target.id" class="text-break mb-1">
              {{ target.fullName }}
              <span :class="target.reached ? 'text-success' : 'text-secondary'">
                · {{ target.reached ? 'Reached' : 'Not reached' }}
              </span>
            </li>
          </ul>
        </details>
      </aside>
      <div class="result-main">
        <div class="result-toolbar p-2 border-bottom">
          <h2 class="h6 mb-0 me-auto">Compromised assets</h2>
          <div class="btn-group btn-group-sm" role="group" aria-label="Simulator Result zoom">
            <button
              type="button"
              class="btn btn-outline-secondary"
              :disabled="!ready || !graph.nodes.length"
              aria-label="Zoom out Simulator Result"
              @click="diagram?.zoomOut()"
            >
              −
            </button>
            <button
              type="button"
              class="btn btn-outline-secondary"
              :disabled="!ready || !graph.nodes.length"
              aria-label="Reset Simulator Result zoom"
              @click="diagram?.home()"
            >
              {{ zoom }}%
            </button>
            <button
              type="button"
              class="btn btn-outline-secondary"
              :disabled="!ready || !graph.nodes.length"
              aria-label="Zoom in Simulator Result"
              @click="diagram?.zoomIn()"
            >
              +
            </button>
            <button
              type="button"
              class="btn btn-outline-secondary"
              :disabled="!ready || !graph.nodes.length"
              @click="diagram?.fit()"
            >
              Fit diagram
            </button>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            :disabled="!ready || !graph.nodes.length"
            @click="resetLayout"
          >
            Reset layout
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary" @click="emit('reset')">
            Reset Simulation
          </button>
        </div>
        <section class="result-afr p-2 border-bottom small" aria-label="Attack Feasibility Rating">
          <h3 class="h6 mb-1">Attack Feasibility Rating (AFR)</h3>
          <p class="text-secondary mb-2">
            Per reached Target, use the maximum Proximity, Required Skills and Required Resources
            across its compromised predecessors, including Entries and AND support. Performed OR
            alternatives are included; this is a Target-level summary of the recorded connections.
          </p>
          <div class="afr-table table-responsive">
            <table class="table table-sm align-middle mb-0" aria-label="AFR results by Target">
              <thead>
                <tr>
                  <th scope="col">Target</th>
                  <th scope="col">Proximity max</th>
                  <th scope="col">Required Skills max</th>
                  <th scope="col">Required Resources max</th>
                  <th scope="col">AF score A(π)</th>
                  <th scope="col">AFR F(π)</th>
                  <th scope="col">Rating</th>
                  <th scope="col">Assessment coverage</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="afr in afrResults" :key="afr.target.id">
                  <th scope="row" class="text-break">
                    {{ afr.target.fullName || `${afr.target.asset}:${afr.target.name}` }}
                  </th>
                  <td>{{ afr.maxima.proximity ?? '—' }}</td>
                  <td>{{ afr.maxima['Required Skills'] ?? '—' }}</td>
                  <td>{{ afr.maxima['Required Resources'] ?? '—' }}</td>
                  <td>{{ afr.score === null ? 'N/A' : afr.score.toFixed(2) }}</td>
                  <td class="fw-bold">{{ afr.rating ?? 'N/A' }}</td>
                  <td>
                    <span v-if="afr.label" class="badge" :class="afrClass(afr.rating)">
                      {{ afr.label }}
                    </span>
                    <span v-else class="text-secondary">N/A</span>
                  </td>
                  <td>
                    <span v-if="afr.status === 'not-reached'" class="text-secondary">
                      Target not reached
                    </span>
                    <span v-else-if="afr.status === 'no-entry'" class="text-secondary">
                      No compromised Entry-to-Target connection
                    </span>
                    <template v-else>
                      <span>{{ afr.assessedSteps }}/{{ afr.totalSteps }} steps</span>
                      <span v-if="afr.status === 'partial'" class="d-block text-warning-emphasis">
                        Partial assessment · {{ afr.missingStepIds.length }} missing
                      </span>
                      <span v-else-if="afr.status === 'unavailable'" class="d-block text-secondary">
                        No complete TTP factors
                      </span>
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <details class="text-secondary mt-2">
            <summary>AFR calculation and rating thresholds</summary>
            <p class="mb-1 mt-1">
              A(π) = (Proximity max + Required Skills max + Required Resources max) / 3. 1 ≤ A &lt;
              2: 0 (Very Low); 2 ≤ A &lt; 3: 1 (Low); 3 ≤ A &lt; 4: 1.5 (Medium); 4 ≤ A ≤ 5: 2
              (High). Classification uses the unrounded score.
            </p>
            <p class="mb-0">
              Only steps with all three TTP factor ratings from 1 to 5 are assessed. Saved asset
              assessments take precedence over catalog ratings. Missing steps are excluded and
              reported in coverage; a partial assessment may underestimate difficulty. The labels
              follow the supplied rubric: higher raw values mean greater attack difficulty.
            </p>
          </details>
        </section>
        <div class="px-2 py-2 border-bottom small">
          <div class="form-check">
            <input
              id="simulation-target-paths-only"
              v-model="targetPathsOnly"
              class="form-check-input"
              type="checkbox"
              aria-describedby="simulation-target-paths-help"
            />
            <label class="form-check-label" for="simulation-target-paths-only">
              Only steps leading to reached Targets
            </label>
          </div>
          <p id="simulation-target-paths-help" class="text-secondary mb-0 mt-1">
            Hide unrelated compromised branches. Keep performed prerequisites of reached Targets,
            including AND support steps. Uncheck to show all compromised steps.
          </p>
        </div>
        <div class="result-legend small px-2 py-1 border-bottom">
          <span class="text-danger">● Compromised step</span>
          <span class="text-success">● Initial Entry</span>
          <span class="target-legend">● Reached Target</span>
          <span
            >Click an asset to expand its steps, sorted by iteration. Click again to collapse.</span
          >
        </div>
        <p id="simulation-result-help" class="small text-secondary px-2 py-1 mb-0 border-bottom">
          Dashed arrows summarize step connections between collapsed assets. Expand assets to
          inspect individual connections. OR inputs show performed alternatives; connections do not
          establish a single causal execution trace. Drag shapes to move them; use their handles to
          resize. Select a line and drag its segment handles to adjust its route. Drag the
          background to pan. Ctrl/⌘ + scroll to zoom. Reset layout restores the automatic
          arrangement.
        </p>
        <p
          v-if="!graph.completeConnections && !targetPathsOnly"
          class="alert alert-warning small m-2"
          role="status"
        >
          This result includes only Target-related connections. Restart the simulation server and
          rerun to include all compromised-step connections.
        </p>
        <p v-if="error" class="alert alert-danger m-2" role="alert">{{ error }}</p>
        <div class="result-canvas-shell">
          <div
            ref="container"
            class="result-canvas"
            tabindex="0"
            role="region"
            aria-label="Compromised Attack Steps and assets diagram"
            aria-describedby="simulation-result-help"
          ></div>
          <p v-if="!graph.nodes.length" class="result-empty p-4 text-secondary" role="status">
            {{
              targetPathsOnly
                ? 'No compromised steps lead to a reached Target in this simulation. Uncheck the filter to view all compromised steps.'
                : 'No compromised Attack Steps were recorded in this simulation.'
            }}
          </p>
          <p v-else-if="!ready && !error" class="result-empty p-4 text-secondary" role="status">
            Loading Simulator Result diagram…
          </p>
        </div>
        <div class="result-toolbar small p-2 border-top" aria-live="polite">
          <template v-if="selected">
            <strong class="text-break">{{
              selected.fullName || `${selected.asset}:${selected.name}`
            }}</strong>
            <span>{{ selected.assetType }} · {{ selected.type.toUpperCase() }}</span>
            <span>Iteration {{ selected.performedAt ?? '—' }}</span>
            <span class="badge rounded-pill" :class="riskScoreClass(selected.riskScore)">
              Risk Score: {{ riskScoreLabel(selected.riskScore ?? 0) }}
            </span>
            <span
              v-if="ctsaScore(selected) !== null"
              class="badge rounded-pill"
              :class="riskScoreClass(ctsaScore(selected))"
              :title="simulationCtsaScoreTitle(selected)"
              >CTSA Score: {{ riskScoreLabel(ctsaScore(selected)) }}</span
            >
            <button
              v-if="selected.cellId"
              type="button"
              class="btn btn-sm btn-outline-primary ms-auto"
              @click="emit('inspect', selected.cellId)"
            >
              Show asset in Diagram
            </button>
          </template>
          <template v-else-if="selectedAsset">
            <strong class="text-break">{{ selectedAsset.name }}</strong>
            <span>{{ selectedAsset.type }} (+{{ selectedAsset.nodes.length }} steps)</span>
            <button
              v-if="selectedAsset.cellId"
              type="button"
              class="btn btn-sm btn-outline-primary ms-auto"
              @click="emit('inspect', selectedAsset.cellId)"
            >
              Show asset in Diagram
            </button>
          </template>
          <span v-else class="text-secondary">
            Click an asset to show its Attack Steps, then select a step to view its details.
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.simulation-result,
.result-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.result-summary,
.result-toolbar,
.result-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.result-body {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.result-assets {
  overflow-y: auto;
}
.afr-table {
  max-height: 210px;
}
.afr-table th,
.afr-table td {
  min-width: 90px;
}
.timeline-iteration {
  position: relative;
  margin-left: 5px;
  padding: 0 0 16px 16px;
  border-left: 2px solid #dee2e6;
}
.timeline-iteration::before {
  content: '';
  position: absolute;
  top: 3px;
  left: -5px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6c757d;
}
.timeline-selected {
  border-color: #0d6efd;
}
.timeline-selected::before {
  background: #0d6efd;
}
.result-canvas-shell {
  position: relative;
  flex: 1;
  min-height: 300px;
}
.result-canvas {
  position: absolute;
  inset: 0;
  overflow: auto;
  background: #fff;
  background-image: radial-gradient(#d6dce2 0.75px, transparent 0.75px);
  background-size: 12px 12px;
}
.result-canvas:focus-visible {
  outline: 2px solid #9ec5fe;
  outline-offset: -2px;
}
.result-empty {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.target-legend {
  color: #6f42c1;
}
.text-bg-purple {
  color: #fff;
  background: #6f42c1;
}
@media (max-width: 767.98px) {
  .result-body {
    grid-template-columns: minmax(0, 1fr);
  }
  .result-assets {
    max-height: 220px;
    border-bottom: 1px solid #dee2e6;
  }
  .result-main {
    min-height: 500px;
  }
}
</style>

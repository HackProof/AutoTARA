<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { buildSimulationTree } from '@/services/simulation.js'
import { describeTreeOccurrence, layoutAttackTree } from '@/services/attackTree.js'
import { loadDrawioRuntime } from '@/services/drawio/runtime.js'
import { createAttackTreeDiagram } from '@/services/drawio/attackTree.js'
import { riskScoreClass, riskScoreLabel } from '@/services/ttpScoring.js'

const props = defineProps({
  result: { type: Object, required: true },
  active: { type: Boolean, default: true },
})
const emit = defineEmits(['inspect', 'reset'])
const targetId = ref('')
const container = ref(null)
const selected = shallowRef(null)
const collapsed = shallowRef(new Set())
const error = ref('')
const ready = ref(false)
const zoom = ref(100)
const pathResult = shallowRef(null)
const selectedPathIndex = ref(-1)
const pathSearching = ref(false)
const pathError = ref('')
const pathOptions = reactive({ maxPaths: 30, maxHops: 40 })
const paths = computed(() => pathResult.value?.paths || [])
const pathRisks = computed(() => pathResult.value?.riskSummaries || [])
const selectedRisk = computed(() => pathRisks.value[selectedPathIndex.value] || null)
const selectedPath = computed(() => paths.value[selectedPathIndex.value] || null)
const graphNodes = computed(() => new Map(props.result.tree.nodes.map((node) => [node.id, node])))
const pathSummary = computed(() => pathResult.value?.targetResults[0])
const target = computed(() => props.result.tree.targets.find((item) => item.id === targetId.value))
const reachedCount = computed(() => props.result.tree.targets.filter((item) => item.reached).length)
const tree = computed(() =>
  buildSimulationTree(props.result.tree, targetId.value, { path: selectedPath.value }),
)
const layout = computed(() => layoutAttackTree(tree.value, collapsed.value))
let diagram
let pathWorker = null
let disposed = false
let needsInitialView = true

function cancelPathSearch() {
  pathWorker?.terminate()
  pathWorker = null
  pathSearching.value = false
}
function searchPaths() {
  cancelPathSearch()
  pathResult.value = null
  selectedPathIndex.value = -1
  pathError.value = ''
  if (!target.value?.reached) return
  let worker
  try {
    worker = new Worker(new URL('../services/simulationPaths.worker.js', import.meta.url), {
      type: 'module',
    })
    pathWorker = worker
    pathSearching.value = true
    worker.onmessage = ({ data }) => {
      if (pathWorker !== worker) return
      cancelPathSearch()
      if (data.error) pathError.value = data.error
      else pathResult.value = data
    }
    worker.onerror = () => {
      if (pathWorker !== worker) return
      cancelPathSearch()
      pathError.value = 'Unable to find simulation paths. Use Update candidates to retry.'
    }
    worker.postMessage(
      JSON.parse(
        JSON.stringify({
          tree: props.result.tree,
          targetId: targetId.value,
          options: pathOptions,
        }),
      ),
    )
  } catch (cause) {
    cancelPathSearch()
    pathError.value = cause.message || 'Unable to start the simulation path search.'
  }
}

watch(
  () => props.result,
  (result) => {
    targetId.value =
      (result.tree.targets.find((item) => item.reached) || result.tree.targets[0])?.id || ''
  },
  { immediate: true },
)
watch(
  [() => props.result, targetId],
  () => {
    cancelPathSearch()
    pathResult.value = null
    selectedPathIndex.value = -1
    pathError.value = ''
    if (props.active) searchPaths()
  },
  { flush: 'post' },
)
watch(
  tree,
  () => {
    selected.value = null
    collapsed.value = new Set()
    needsInitialView = true
  },
  { flush: 'sync' },
)
function render() {
  if (!diagram || !props.active) return
  diagram.render(layout.value, needsInitialView ? null : selected.value?.id)
  if (needsInitialView) {
    diagram.initialView()
    needsInitialView = false
  }
}
function toggle(id) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}
watch(layout, render, { flush: 'post' })
watch(
  () => props.active,
  async (active) => {
    if (!active) return
    if (!pathResult.value && !pathSearching.value) searchPaths()
    await nextTick()
    if (disposed || !diagram) return
    diagram.resize()
    render()
  },
)
onMounted(async () => {
  if (props.active) searchPaths()
  try {
    const runtime = await loadDrawioRuntime()
    if (disposed) return
    diagram = createAttackTreeDiagram({
      container: container.value,
      runtime,
      onSelect: (item) => {
        selected.value = item
      },
      onToggle: toggle,
      onZoom: (value) => {
        zoom.value = value
      },
    })
    ready.value = true
    render()
  } catch (cause) {
    error.value = cause.message || 'Unable to display the simulation Attack Tree.'
  }
})
onBeforeUnmount(() => {
  disposed = true
  cancelPathSearch()
  diagram?.destroy()
})
</script>

<template>
  <section class="simulation-tree border" aria-label="Simulation Attack Tree workspace">
    <div class="p-2 border-bottom small">
      <strong>{{ result.attackerType }} · Simulation result</strong>
      <span class="ms-2">{{ reachedCount }}/{{ result.tree.targets.length }} Targets reached</span>
      <span class="ms-2"
        >{{ result.performedCount }} performed steps · {{ result.steps }} actions</span
      >
      <span class="ms-2">
        {{ result.tree.nodes.length }} steps / {{ result.tree.compromisedAssets.length }} assets
        connected to reached Targets
      </span>
      <p class="text-secondary mb-0 mt-1">
        Target is the root. Branches show performed attack steps from this simulation. AND/OR gates
        retain the language semantics; OR branches show performed alternatives, not a single causal
        trace. Defense and existence conditions are evaluated by the simulator. Seed:
        {{ result.seed }} · TTC: {{ result.ttcMode }}.
      </p>
    </div>
    <p v-if="result.partial" class="alert alert-warning m-2 py-2 small" role="status">
      The step limit was reached. This is a partial result; unreached Targets may still be
      reachable.
    </p>
    <div class="tree-toolbar p-2 border-bottom">
      <label for="simulation-tree-target" class="small fw-bold">Target</label>
      <select
        id="simulation-tree-target"
        v-model="targetId"
        class="form-select form-select-sm target-select"
      >
        <option v-for="item in result.tree.targets" :key="item.id" :value="item.id">
          {{ item.fullName }} — {{ item.reached ? 'Reached' : 'Not reached' }}
        </option>
      </select>
      <div class="btn-group btn-group-sm" role="group" aria-label="Simulation tree zoom">
        <button
          type="button"
          class="btn btn-outline-secondary"
          :disabled="!ready || !tree.root"
          aria-label="Zoom out"
          @click="diagram?.zoomOut()"
        >
          −
        </button>
        <button
          type="button"
          class="btn btn-outline-secondary"
          :disabled="!ready || !tree.root"
          aria-label="Reset zoom"
          @click="diagram?.home()"
        >
          {{ zoom }}%
        </button>
        <button
          type="button"
          class="btn btn-outline-secondary"
          :disabled="!ready || !tree.root"
          aria-label="Zoom in"
          @click="diagram?.zoomIn()"
        >
          +
        </button>
        <button
          type="button"
          class="btn btn-outline-secondary"
          :disabled="!ready || !tree.root"
          @click="diagram?.fit()"
        >
          Fit tree
        </button>
      </div>
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        :disabled="!selected?.children.length"
        @click="toggle(selected.id)"
      >
        {{ selected && collapsed.has(selected.id) ? 'Expand branch' : 'Collapse branch' }}
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        :disabled="!tree.root"
        @click="collapsed = new Set()"
      >
        Expand all
      </button>
      <button type="button" class="btn btn-sm btn-outline-secondary ms-auto" @click="emit('reset')">
        Reset simulation
      </button>
    </div>
    <details class="small px-2 py-1 border-bottom">
      <summary>Scenario and simulation files</summary>
      <pre class="scenario mt-2">{{ result.scenario }}</pre>
      <div class="d-flex flex-wrap gap-3 pb-2">
        <a v-for="(url, name) in result.artifacts" :key="name" :href="url" download>{{ name }}</a>
      </div>
    </details>
    <p v-if="error" class="alert alert-danger m-2" role="alert">{{ error }}</p>
    <p v-if="tree.truncated" class="alert alert-warning m-2 py-1 small" role="status">
      The display limit was reached. Omitted branches are marked; download result.json for the full
      subgraph.
    </p>
    <div class="tree-content">
      <aside class="path-candidates p-2 border-end" aria-label="Simulation attack path candidates">
        <h2 class="h6">
          Attack paths <span class="badge text-bg-primary">{{ paths.length }}</span>
        </h2>
        <p class="small text-secondary">
          Choose an Entry-to-Target route from the compromised steps.
        </p>
        <details class="small text-secondary mb-2">
          <summary>Risk Score calculation</summary>
          <p class="mb-0 mt-1">
            Scores use this asset's TTP assessment. Average Risk Score is the arithmetic mean of
            assessed unique main-route attack steps, including Entry and Target when assessed.
            Support branches are scored individually. Unassessed attack steps display Risk Score 0
            but are excluded from the average. If no steps are assessed, the average is unavailable.
          </p>
        </details>
        <button
          type="button"
          class="btn btn-sm w-100 text-start mb-2"
          :class="selectedPathIndex < 0 ? 'btn-primary' : 'btn-outline-secondary'"
          :aria-pressed="selectedPathIndex < 0"
          @click="selectedPathIndex = -1"
        >
          All performed branches
        </button>
        <form class="small border rounded p-2 mb-2" @submit.prevent="searchPaths">
          <label for="simulation-max-paths" class="form-label mb-1">Maximum candidates</label>
          <input
            id="simulation-max-paths"
            v-model.number="pathOptions.maxPaths"
            class="form-control form-control-sm mb-2"
            type="number"
            min="1"
            max="100"
            required
          />
          <label for="simulation-max-hops" class="form-label mb-1">Maximum route hops</label>
          <input
            id="simulation-max-hops"
            v-model.number="pathOptions.maxHops"
            class="form-control form-control-sm mb-2"
            type="number"
            min="0"
            max="200"
            required
          />
          <button
            type="submit"
            class="btn btn-sm btn-outline-primary"
            :disabled="pathSearching || !target?.reached"
          >
            Update candidates
          </button>
          <button
            v-if="pathSearching"
            type="button"
            class="btn btn-sm btn-outline-secondary ms-1"
            @click="cancelPathSearch"
          >
            Cancel
          </button>
        </form>
        <p v-if="pathSearching" class="small text-secondary" role="status">
          Finding attack path candidates…
        </p>
        <p v-if="pathError" class="alert alert-danger small p-2" role="alert">{{ pathError }}</p>
        <p v-if="!target?.reached" class="small text-secondary" role="status">
          This Target was not reached; no path candidates are available.
        </p>
        <p v-else-if="pathResult" class="small text-secondary" role="status">
          {{ paths.length }} candidates · shortest routes first.
          <span v-if="pathSummary?.stopReason === 'pathLimit'"
            >Candidate limit reached; more routes may exist.</span
          >
          <span v-else-if="!pathResult.candidateSearchComplete"
            >Search limit reached; these are partial results.</span
          >
          <span v-else>Search within the hop limit is complete.</span>
          <span v-if="!paths.length && pathSummary?.noPathReason === 'hopLimit'"
            >The shortest route needs {{ pathSummary.shortestHops }} hops. Increase Maximum route
            hops.</span
          >
          <span v-else-if="!paths.length"
            >No Entry-to-Target route was found in the performed steps within these limits.</span
          >
        </p>
        <details v-if="selectedPath" class="small mb-2">
          <summary>Selected route · {{ selectedPath.length }} steps</summary>
          <ol class="route-steps ps-3 mt-2">
            <li v-for="id in selectedPath" :key="id" class="mb-2 text-break">
              {{ graphNodes.get(id)?.fullName }}
              <span
                class="badge rounded-pill"
                :class="riskScoreClass(graphNodes.get(id)?.riskScore)"
              >
                Risk Score:
                {{
                  Number.isFinite(graphNodes.get(id)?.riskScore)
                    ? riskScoreLabel(graphNodes.get(id).riskScore)
                    : '0.0'
                }}
              </span>
              <span class="d-block text-secondary"
                >Iteration {{ graphNodes.get(id)?.performedAt ?? '—' }}</span
              >
              <button
                v-if="graphNodes.get(id)?.cellId"
                type="button"
                class="btn btn-sm btn-link p-0"
                @click="emit('inspect', graphNodes.get(id).cellId)"
              >
                Show asset
              </button>
            </li>
          </ol>
        </details>
        <div class="d-grid gap-1" aria-label="Choose a simulation attack path">
          <button
            v-for="(path, index) in paths"
            :key="JSON.stringify(path)"
            type="button"
            class="btn btn-sm text-start text-break"
            :class="selectedPathIndex === index ? 'btn-primary' : 'btn-outline-secondary'"
            :aria-pressed="selectedPathIndex === index"
            @click="selectedPathIndex = index"
          >
            <strong>Path {{ index + 1 }} · {{ path.length - 1 }} hops</strong>
            <span class="d-block small"
              >{{ graphNodes.get(path[0])?.fullName }} →
              {{ graphNodes.get(path.at(-1))?.fullName }}</span
            >
            <span
              class="badge rounded-pill mt-1"
              :class="riskScoreClass(pathRisks[index]?.averageRiskScore)"
              title="Mean of assessed unique main-route attack steps, including Entry and Target when assessed. Unassessed steps are excluded."
              >Avg Risk Score:
              {{
                Number.isFinite(pathRisks[index]?.averageRiskScore)
                  ? riskScoreLabel(pathRisks[index].averageRiskScore)
                  : '—'
              }}</span
            >
            <span class="d-block small"
              >Route scores: {{ pathRisks[index]?.scoredSteps ?? 0 }}/{{
                pathRisks[index]?.totalSteps ?? path.length
              }}
              assessed</span
            >
          </button>
        </div>
      </aside>
      <div class="tree-main">
        <div class="small tree-toolbar border-bottom p-2" role="status">
          <strong>{{
            selectedPath
              ? `Path ${selectedPathIndex + 1} · ${selectedPath.length - 1} hops`
              : 'All performed branches'
          }}</strong>
          <template v-if="selectedRisk">
            <span class="badge rounded-pill" :class="riskScoreClass(selectedRisk.averageRiskScore)">
              Avg Risk Score:
              {{
                Number.isFinite(selectedRisk.averageRiskScore)
                  ? riskScoreLabel(selectedRisk.averageRiskScore)
                  : '—'
              }}
            </span>
            <span
              >Route scores: {{ selectedRisk.scoredSteps }}/{{
                selectedRisk.totalSteps
              }}
              assessed</span
            >
          </template>
          <span v-if="selectedPath"
            >Blue: selected route · Amber: AND support and performed OR alternatives · Green: Entry
            / references.</span
          >
          <span
            >Routes describe structural possibilities within this simulation, rather than a unique
            causal execution trace.</span
          >
        </div>
        <div class="tree-canvas-shell">
          <div
            ref="container"
            class="tree-canvas"
            tabindex="0"
            role="region"
            aria-label="Simulation Attack Tree diagram"
            aria-describedby="simulation-tree-help"
          ></div>
          <div v-if="!tree.root" class="tree-empty p-4 text-secondary" role="status">
            <strong>{{ target?.fullName }}</strong> was not reached in this simulation.
            <p class="mt-2">
              {{
                result.partial
                  ? 'The simulation stopped at its step limit.'
                  : 'The attacker exhausted its available actions.'
              }}
              No compromised path to this Target is displayed.
            </p>
          </div>
        </div>
        <div class="tree-toolbar small p-2 border-top">
          <template v-if="selected">
            <strong class="text-break">{{ selected.node.fullName }}</strong>
            <span class="badge rounded-pill" :class="riskScoreClass(selected.node.riskScore)">
              Risk Score:
              {{
                Number.isFinite(selected.node.riskScore)
                  ? riskScoreLabel(selected.node.riskScore)
                  : '0.0'
              }}
            </span>
            <span
              >{{ describeTreeOccurrence(selected) }} · iteration
              {{ selected.node.performedAt }}</span
            >
            <button
              v-if="selected.node.cellId"
              type="button"
              class="btn btn-sm btn-outline-primary ms-auto"
              @click="emit('inspect', selected.node.cellId)"
            >
              Show asset in Diagram
            </button>
          </template>
          <span v-else>Select a node to inspect its performed Attack Step.</span>
        </div>
        <p id="simulation-tree-help" class="small text-secondary px-2 py-1 mb-0 border-top">
          Scroll or drag the background to navigate. Ctrl/⌘ + wheel to zoom. Double-click a node to
          expand or collapse. Green marks Entry/shared references; dashed nodes mark repeated steps.
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.simulation-tree {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: #fff;
}
.tree-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.tree-content {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.path-candidates {
  min-height: 0;
  overflow: auto;
}
.tree-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.target-select {
  width: auto;
  max-width: min(100%, 480px);
}
.scenario {
  max-height: 150px;
  overflow: auto;
}
.tree-canvas-shell {
  position: relative;
  flex: 1;
  min-height: 300px;
}
.tree-canvas {
  position: absolute;
  inset: 0;
  overflow: auto;
  background-image: radial-gradient(#dce2e9 0.75px, transparent 0.75px);
  background-size: 12px 12px;
  outline: none;
  touch-action: none;
}
.tree-canvas:focus-visible {
  outline: 2px solid #9ec5fe;
  outline-offset: -2px;
}
.tree-empty {
  position: relative;
}
@media (max-width: 800px) {
  .tree-content {
    grid-template-columns: 220px minmax(0, 1fr);
  }
}
@media (max-width: 575px) {
  .tree-content {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(160px, 240px) minmax(300px, 1fr);
  }
}
</style>

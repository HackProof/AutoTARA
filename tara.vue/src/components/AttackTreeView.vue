<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import AttackPathStatus from './AttackPathStatus.vue'
import { describeAttackPathTarget } from '@/services/attackPathDiagnostics.js'
import AttackPathChoices from '@/components/AttackPathChoices.vue'
import {
  buildCandidateAttackTree,
  describeTreeOccurrence,
  initialCollapsedBranches,
  layoutAttackTree,
} from '@/services/attackTree.js'
import { loadDrawioRuntime } from '@/services/drawio/runtime.js'
import { createAttackTreeDiagram } from '@/services/drawio/attackTree.js'
import { riskScoreClass, riskScoreLabel } from '@/services/ttpScoring.js'

const props = defineProps({
  analysis: { type: Object, required: true },
  selectedIndex: { type: Number, default: 0 },
  sortBy: { type: String, default: 'hops' },
  active: { type: Boolean, default: true },
})
const emit = defineEmits(['update:selectedIndex', 'update:sortBy', 'inspect', 'reset'])
const container = ref(null)
const selected = shallowRef(null)
const error = ref('')
const ready = ref(false)
const zoom = ref(100)
const collapsed = shallowRef(new Set())
const metric = computed(() => props.analysis.result.metrics[props.selectedIndex])
const tree = computed(() =>
  buildCandidateAttackTree(
    props.analysis.graph,
    props.analysis.result.paths[props.selectedIndex] || [],
    { metric: metric.value },
  ),
)
const layout = computed(() => layoutAttackTree(tree.value, collapsed.value))
const selectedCollapsed = computed(() => selected.value && collapsed.value.has(selected.value.id))
let diagram,
  disposed = false,
  needsInitialView = true

function toggle(id) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}
function collapseSupport() {
  collapsed.value = initialCollapsedBranches(tree.value)
}
function render() {
  if (!diagram || !props.active) return
  diagram.render(layout.value, needsInitialView ? null : selected.value?.id)
  if (needsInitialView) {
    diagram.initialView()
    needsInitialView = false
  }
}
watch(
  tree,
  () => {
    selected.value = null
    needsInitialView = true
    collapseSupport()
  },
  { immediate: true, flush: 'sync' },
)
watch(layout, render, { flush: 'post' })
watch(
  () => props.active,
  async (active) => {
    if (!active) return
    await nextTick()
    if (disposed || !diagram) return
    diagram.resize()
    if (needsInitialView) render()
  },
)
onMounted(async () => {
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
    error.value = cause.message || 'Unable to display the Attack Tree.'
  }
})
onBeforeUnmount(() => {
  disposed = true
  diagram?.destroy()
})
</script>

<template>
  <section class="attack-tree-view border" aria-label="Attack Tree workspace">
    <aside class="tree-candidates p-2 border-end" aria-label="Attack Tree candidates">
      <h2 class="h6">
        Candidate paths
        <span class="badge text-bg-primary">{{ analysis.result.paths.length }}</span>
      </h2>
      <p class="small text-secondary">Select a path to draw its Attack Tree.</p>
      <AttackPathChoices
        :analysis="analysis"
        :selected-index="selectedIndex"
        :sort-by="sortBy"
        @update:selected-index="emit('update:selectedIndex', $event)"
        @update:sort-by="emit('update:sortBy', $event)"
      />
    </aside>
    <div class="tree-main">
      <div class="tree-toolbar border-bottom p-2">
        <h2 class="h6 mb-0 me-auto">
          {{ tree.root ? `Path ${selectedIndex + 1} · Attack Tree` : 'Attack Tree' }}
        </h2>
        <div class="btn-group btn-group-sm" role="group" aria-label="Attack Tree zoom">
          <button
            type="button"
            class="btn btn-outline-secondary"
            :disabled="!ready || !tree.root"
            aria-label="Zoom out Attack Tree"
            @click="diagram?.zoomOut()"
          >
            −
          </button>
          <button
            type="button"
            class="btn btn-outline-secondary"
            :disabled="!ready || !tree.root"
            aria-label="Reset Attack Tree zoom"
            @click="diagram?.home()"
          >
            {{ zoom }}%
          </button>
          <button
            type="button"
            class="btn btn-outline-secondary"
            :disabled="!ready || !tree.root"
            aria-label="Zoom in Attack Tree"
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
          {{ selectedCollapsed ? 'Expand branch' : 'Collapse branch' }}
        </button>
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          :disabled="!tree.root"
          @click="collapseSupport"
        >
          Collapse support
        </button>
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          :disabled="!tree.root"
          @click="collapsed = new Set()"
        >
          Expand all
        </button>
        <button type="button" class="btn btn-sm btn-outline-secondary" @click="emit('reset')">
          Reset Paths
        </button>
      </div>
      <div class="tree-legend small px-2 py-1 border-bottom">
        <span class="legend-primary">● Candidate path</span>
        <span class="legend-support">● AND prerequisites / OR alternatives</span>
        <span class="legend-entry">● Entry / earlier path step</span>
        <span
          >Target is the root. Arrows point toward the goal. Conditions are evaluated. Expanded OR
          branches show alternatives; the execution list shows the chosen plan.</span
        >
      </div>
      <AttackPathStatus
        v-if="metric"
        :metric="metric"
        :graph="analysis.graph"
        details
        class="p-2 border-bottom"
        @inspect="emit('inspect', $event)"
      />
      <p v-if="error" class="alert alert-danger m-2" role="alert">{{ error }}</p>
      <p v-if="tree.truncated" class="alert alert-warning small py-1 m-2" role="status">
        The prerequisite display limit was reached. Omitted branches are marked on their nodes.
      </p>
      <div class="tree-canvas-shell">
        <div
          ref="container"
          class="tree-canvas"
          tabindex="0"
          role="region"
          aria-label="Attack Tree diagram"
          aria-describedby="attack-tree-help"
        ></div>
        <div v-if="!tree.root" class="tree-empty text-secondary p-4" role="status">
          <p v-for="target in analysis.result.targetResults" :key="target.target">
            {{ describeAttackPathTarget(target, analysis.result.maxHops) }}
          </p>
        </div>
      </div>
      <div class="tree-inspector border-top p-2 small">
        <template v-if="selected">
          <strong class="text-break">{{ selected.node.fullName }}</strong>
          <span
            v-if="Number.isFinite(selected.node.riskScore)"
            class="badge rounded-pill"
            :class="riskScoreClass(selected.node.riskScore)"
            >Risk Value: {{ riskScoreLabel(selected.node.riskScore) }}</span
          >
          <span v-if="describeTreeOccurrence(selected)" class="ms-2">{{
            describeTreeOccurrence(selected)
          }}</span>
          <button
            type="button"
            class="btn btn-sm btn-outline-primary ms-auto"
            @click="emit('inspect', selected.node.cellId)"
          >
            Show asset in Diagram
          </button>
        </template>
        <span v-else>Select a node to inspect its Attack Step.</span>
      </div>
      <p id="attack-tree-help" class="small text-secondary px-2 py-1 mb-0 border-top">
        Scroll or drag the background to navigate. Ctrl/⌘ + wheel to zoom. Double-click a node to
        expand or collapse its inputs.
      </p>
    </div>
  </section>
</template>

<style scoped>
.attack-tree-view {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  background: #fff;
}
.tree-candidates {
  min-height: 0;
  overflow: auto;
}
.tree-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.tree-toolbar,
.tree-legend,
.tree-inspector {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.legend-primary {
  color: #0d6efd;
}
.legend-support {
  color: #946200;
}
.legend-entry {
  color: #198754;
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
  .attack-tree-view {
    grid-template-columns: 180px minmax(0, 1fr);
  }
}
@media (max-width: 575px) {
  .attack-tree-view {
    grid-template-columns: 1fr;
  }
  .tree-candidates {
    max-height: 140px;
  }
}
</style>

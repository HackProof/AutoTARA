<template>
  <div class="row mt-2">
    <div class="col-md-10">
      <div class="stencil-app ">
        <div class="stencil-container" id="stencil_container" ref="stencil_container"></div>

        <div class="app-main">
          <div class="row">
            <div class="col">
              <h3 class="mb-0">{{ modelInfo.title }}</h3>
            </div>
          </div>

          <div class="row mt-2 mb-2">
            <div class="col">
              <graph-button-view />
            </div>
          </div>

          <div class="row">
            <div class="col graph-wrapper">
              <div class="graph-container" id="graph_container" ref="graph_container"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="col-md-2">
      <div class="mb-2">
        <ElementProperties />
      </div>
      <div v-if="showThreatProperties" class="mb-2">
        <ThreatProperties @open-threat-edit-modal="showThreatEditModal" />
      </div>
      <SimulationResult />
    </div>

    <div>
      <ThreatEditModal ref="threatEditModalRef" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, provide, watch } from 'vue'
import diagramService from '@/service/diagram/diagram.js'
import stencilService from '@/service/x6/stencil.js'
import ElementProperties from "@/components/ElementProperties.vue";
import GraphButtonView from "@/views/GraphButtonView.vue";
import ThreatProperties from "@/components/ThreatProperties.vue";
import ThreatEditModal from "@/components/ThreatEditModal.vue";
import SimulationResult from "@/components/SimulationResult.vue";
import { useThreatModelStore } from '@/stores/threatModelStore.js';
import {useCellStore} from "@/stores/cellStore.js";
import axios from "axios";
import {storeToRefs} from "pinia";
import { isThreatAnalysisCellData } from "@/service/asset-types.js";

const tmStore = useThreatModelStore()
const modelInfo = computed(() => tmStore.data.modelInfo)
const modifiedDiagram = computed(() => tmStore.modifiedDiagram)

const stencil_container = ref(null)
const graph_container = ref(null)
const graphInstance = ref(null) // Renamed from graph to avoid confusion
const stencilController = ref(null)
const cellStore = useCellStore();
const { ref: cellRef } = storeToRefs(cellStore);
const showThreatProperties = computed(() =>
  !cellRef.value || isThreatAnalysisCellData(cellRef.value?.data)
);

// Provide graph instance to child components
// Note: provide expects a Ref or reactive object if we want children to reap updates? 
// Or just the value? If we provide 'graph', children get the ref unless we unwrap.
// Using provide('graph', graphInstance) means children inject('graph') will receive the Ref object.
provide('graph', graphInstance)
provide('stencilController', stencilController)

const threatEditModalRef = ref(false);

const disposeStencil = () => {
  const controller = stencilController.value
  controller?.dispose?.()
  controller?.stencil?.container?.remove?.()
  stencilController.value = null
  if (stencil_container.value) {
    stencil_container.value.innerHTML = ''
  }
}

const rebuildStencil = () => {
  if (!graphInstance.value || !stencil_container.value) return
  disposeStencil()
  stencilController.value = stencilService.get(
    graphInstance.value,
    stencil_container.value,
    undefined,
    tmStore.data.languageGraph
  )
}

onMounted(() => {
  graphInstance.value = diagramService.loadEditDiagram(graph_container.value, modifiedDiagram.value) // 그래프 초기화
  rebuildStencil()

  // Listen to history changes
  graphInstance.value.getPlugin('history').on('change', () => {
    if (!modifiedDiagram.value) return;
    const updated = { ...modifiedDiagram.value }
    updated.cells = graphInstance.value.toJSON().cells
    tmStore.modifyDiagram(updated)
  })

  graphInstance.value.on('node:added', async (event) => {
    const cell = event?.node || event?.cell || event
    const data = cell?.getData?.() || cell?.data || {}

    if (data.description || data.malInfo?.source === 'LanguageGraph' || !isThreatAnalysisCellData(data)) {
      return
    }

    console.log('node:added')
    console.log('Current Cells:', cell)
    let assetName = data.name
    if (!assetName) return
    let des = ''
    await axios.get(`/api/v1/asset-description/${assetName}`)
        .then(res => {
            if (res.data.description) {
              des = res.data.description
            }
        })
        .catch(err => {
            console.error(err);
        })
    cellStore.updateData({ description: des }, 'Graph.vue');
  })
})

onUnmounted(() => {
  disposeStencil()
})

watch(
  () => tmStore.data.languageGraph,
  () => {
    rebuildStencil()
  },
  { deep: false }
)

const showThreatEditModal = (threatId, state) => {
  if (threatEditModalRef.value) {
    threatEditModalRef.value.editThreat(threatId, state)
  }
}

</script>

<style scoped>
.stencil-app {
  display: flex;
  padding: 0;
}

.stencil-container {
  position: relative;
  width: 200px;
  border: 1px solid #f0f0f0;
}

.stencil-container :deep(.x6-widget-stencil.association-highlight-active .x6-node) {
  opacity: 0.32;
}

.stencil-container :deep(.x6-widget-stencil.association-highlight-active .x6-node.association-connectable) {
  opacity: 1;
}

.stencil-container :deep(.x6-widget-stencil .x6-node.association-connectable circle),
.stencil-container :deep(.x6-widget-stencil .x6-node.association-connectable rect),
.stencil-container :deep(.x6-widget-stencil .x6-node.association-connectable ellipse),
.stencil-container :deep(.x6-widget-stencil .x6-node.association-connectable path),
.stencil-container :deep(.x6-widget-stencil .x6-node.association-connectable polygon) {
  stroke: #0d6efd !important;
  stroke-width: 3px !important;
  filter: drop-shadow(0 0 4px rgba(13, 110, 253, 0.45));
}

.stencil-container :deep(.x6-widget-stencil .x6-node.association-connectable text) {
  fill: #0b5ed7 !important;
  font-weight: 700;
}

.stencil-container :deep(.x6-widget-stencil-group.association-connectable-group > .x6-widget-stencil-group-title) {
  color: #0b5ed7;
  background: #e7f1ff;
  border-left: 4px solid #0d6efd;
}

.app-main {
  flex: 1;
  margin-left: 8px;
}

.graph-container {
  height: 85vh;
  width: 100%;
  flex: 1;
  cursor: default;
}

.graph-wrapper {
  display: flex;
  width: 60vw;
}
</style>

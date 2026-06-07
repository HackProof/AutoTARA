<template>
  <div class="diagram-view-wrapper">
    <!-- Graph Component -->
    <Graph />

    <!-- Simulation Loading Overlay (Only covers DiagramView) -->
    <div v-if="isSimulating" class="diagram-loading-overlay">
      <div class="d-flex flex-column align-items-center p-4 bg-white rounded shadow-sm border">
        <div class="spinner-border text-primary mb-2" role="status" style="width: 2.5rem; height: 2.5rem;">
          <span class="visually-hidden">Loading...</span>
        </div>
        <h6 class="fw-bold text-dark m-0">Running Simulation...</h6>
        <small class="text-muted mt-1">Please wait for analysis</small>
      </div>
    </div>
  </div>
</template>

<script setup>
import Graph from '@/components/Graph.vue'; // .js가 아니라 .vue여야 함

import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useThreatModelStore } from '@/stores/threatModelStore'
import { useCellStore } from "@/stores/cellStore.js";

const tmStore = useThreatModelStore()
const cellStore = useCellStore()
const { modelChanged, isSimulating } = storeToRefs(tmStore) // getters.modelChanged 사용

// 공통 확인 함수
const confirmLeave = () => {
  // 변경 없으면 그냥 통과
  if (!modelChanged.value) {
    tmStore.clear()
    cellStore.unselect()
    return true
  }

  const ok = window.confirm(
      'There are unsaved changes in the diagram.\n' +
      'If you leave now, your current work will be reset.\n' +
      'Do you want to continue?'
  )

  if (!ok) return false

  tmStore.clear()   // 전체 ThreatModel 초기화 (selectedDiagram 포함)
  cellStore.unselect()
  // 혹은 다이어그램만 정리하고 싶다면 tmStore.closeDiagram() 등으로 변경 가능

  return true
}

// 1) /edit-diagram/:title 에서 다른 라우트(MainPage 등)로 나갈 때
onBeforeRouteLeave((to, from) => {
  // false를 리턴하면 내비게이션 취소
  if (!confirmLeave()) return false
})

// 2) /edit-diagram/AAA -> /edit-diagram/BBB 처럼 title만 바뀔 때
onBeforeRouteUpdate((to, from) => {
  if (to.params.title !== from.params.title) {
    if (!confirmLeave()) return false
  }
})
</script>

<style scoped>
.diagram-view-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.diagram-loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(2px);
  z-index: 999;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
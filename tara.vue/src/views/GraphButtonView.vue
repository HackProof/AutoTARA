<script setup>
import GraphButtons from '@/components/GraphButtons.vue'
import SimulateButtons from '@/components/SimulateButtons.vue'
</script>

<template>
  <div
    class="toolbar-container bg-light border-bottom p-2 d-flex flex-wrap align-items-start gap-2 rounded-top"
    role="group"
    aria-label="Diagram toolbar"
    aria-describedby="diagram-toolbar-status"
  >
    <div class="toolbar-section">
      <GraphButtons />
    </div>
    <div class="toolbar-section toolbar-section-right">
      <SimulateButtons />
    </div>
    <span id="diagram-toolbar-status" class="visually-hidden">
      Diagram editing, MAL model export, attack path candidates, CTSA TTP scoring and Susceptibility
      Matrix are available. Simulation and reporting are coming soon.
    </span>
  </div>
</template>

<style scoped>
.toolbar-container {
  min-height: 48px;
}

.toolbar-section {
  display: flex;
  align-items: center;
  min-width: 0;
}

.toolbar-section-right {
  margin-left: auto;
}
</style>

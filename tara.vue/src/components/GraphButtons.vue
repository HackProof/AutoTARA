<script setup>
import { inject, ref } from 'vue'
import { DRAWIO_EDITOR_KEY } from '@/services/drawio/palette.js'

const { state, perform, importFile } = inject(DRAWIO_EDITOR_KEY)
const fileInput = ref(null)
const fileButtons = [
  { title: 'Open', action: 'open', icon: 'fa-folder-open', color: 'text-secondary' },
  { title: 'Save', action: 'save', icon: 'fa-floppy-disk', color: 'text-primary' },
  { title: 'Export MAL Model', action: 'extract', icon: 'fa-file-export', color: 'text-success' },
]
const historyButtons = [
  { title: 'Undo', action: 'undo', icon: 'fa-arrow-rotate-left' },
  { title: 'Redo', action: 'redo', icon: 'fa-arrow-rotate-right' },
]
const zoomButtons = [
  { title: 'Zoom In', action: 'zoomIn', icon: 'fa-magnifying-glass-plus' },
  { title: 'Zoom Out', action: 'zoomOut', icon: 'fa-magnifying-glass-minus' },
]
const buttonGroups = [fileButtons, historyButtons, zoomButtons]

function isDisabled(action) {
  if (!state.ready || state.busy) return true
  if (action === 'undo') return !state.canUndo
  if (action === 'redo') return !state.canRedo
  return false
}

function activate(action) {
  if (action === 'open') fileInput.value.click()
  else perform(action)
}

async function handleFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  await importFile(file)
}
</script>

<template>
  <input
    ref="fileInput"
    type="file"
    class="d-none"
    accept=".drawio,.xml,.yaml,.yml,application/xml,text/xml,application/yaml,text/yaml"
    aria-label="Open draw.io diagram or MAL Model"
    @change="handleFile"
  />
  <div class="d-flex flex-wrap align-items-center gap-2" aria-label="Graph actions">
    <div
      v-for="(buttons, index) in buttonGroups"
      :key="index"
      class="btn-group shadow-sm"
      role="group"
      :aria-label="['Files', 'History', 'Zoom'][index]"
    >
      <button
        v-for="button in buttons"
        :key="button.title"
        type="button"
        class="btn btn-sm btn-white border"
        :title="button.title"
        :aria-label="button.title"
        :disabled="isDisabled(button.action)"
        @click="activate(button.action)"
      >
        <i class="fa-solid" :class="[button.icon, button.color]" aria-hidden="true"></i>
      </button>
    </div>
    <button
      type="button"
      class="btn btn-sm btn-white border"
      title="Auto Layout"
      aria-label="Auto Layout"
      :disabled="!state.ready || state.busy || !state.shapeCount"
      @click="perform('autoLayout')"
    >
      <i class="fa-solid fa-diagram-project" aria-hidden="true"></i>
    </button>
    <button
      type="button"
      class="btn btn-sm btn-white border shadow-sm text-danger"
      title="Delete Selected"
      aria-label="Delete Selected"
      :disabled="!state.ready || state.busy || !state.selectionCount"
      @click="perform('remove')"
    >
      <i class="fa-solid fa-trash" aria-hidden="true"></i>
    </button>
    <div class="vr text-muted mx-1" aria-hidden="true"></div>
    <div class="btn-group shadow-sm" role="group" aria-label="Export">
      <button
        type="button"
        class="btn btn-sm btn-white border"
        title="Screenshot"
        aria-label="Screenshot"
        :disabled="!state.ready || state.busy || !(state.shapeCount + state.edgeCount)"
        @click="perform('screenshot')"
      >
        <i class="fa-solid fa-camera" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="btn btn-sm btn-white border fw-bold text-dark"
        title="Create Report"
        disabled
      >
        <i class="fa-solid fa-file-lines me-1 text-muted" aria-hidden="true"></i> Report
      </button>
    </div>
  </div>
</template>

<style scoped>
.btn-white {
  background-color: #fff;
  color: #495057;
  border-color: #dee2e6;
}

.btn-white:hover {
  background-color: #f8f9fa;
  border-color: #c6c7ca;
}

.vr {
  align-self: center;
  height: 24px;
  width: 1px;
  background-color: #ccc;
  opacity: 1;
}
</style>

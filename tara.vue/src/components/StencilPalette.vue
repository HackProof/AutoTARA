<script setup>
import { computed, ref } from 'vue'
import StencilItem from '@/components/StencilItem.vue'
import { createStencilGroups } from '@/services/drawio/palette.js'
import { getStencilConnectionContext } from '@/services/drawio/stencilConnections.js'

const props = defineProps({
  languageGraph: { type: Object, default: null },
  selectedElement: { type: Object, default: null },
  connectionFeedback: { type: Object, default: null },
  catalogLoading: { type: Boolean, default: false },
  catalogError: { type: String, default: '' },
})
const emit = defineEmits(['retry-catalog'])
const search = ref('')
const groups = computed(() => createStencilGroups(props.languageGraph, search.value))
const connectionContext = computed(() =>
  getStencilConnectionContext(props.languageGraph, props.selectedElement, props.connectionFeedback),
)
const visibleCompatibleCount = computed(() =>
  groups.value.reduce((count, group) => count + compatibleCount(group), 0),
)
function isCompatible(shape) {
  return connectionContext.value?.compatibleAssetTypes.has(shape.assetType) || false
}
function compatibleCount(group) {
  return group.shapes.filter(isCompatible).length
}
</script>

<template>
  <div class="stencil-palette">
    <div class="p-2 border-bottom bg-light">
      <p v-if="catalogLoading" class="small text-muted" role="status">Loading asset threats…</p>
      <div v-if="catalogError" class="small text-danger mb-2" role="alert">
        {{ catalogError }}
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary mt-1"
          @click="emit('retry-catalog')"
        >
          Retry threats
        </button>
      </div>
      <h2 class="h6 mb-2">Shapes</h2>
      <input
        v-model="search"
        type="search"
        class="form-control form-control-sm"
        placeholder="Search shapes"
        aria-label="Search shapes"
      />
    </div>
    <!-- <p class="small text-muted px-2 pt-2 mb-2 stencil-help">
      Click or drag a shape onto the diagram.
      <template v-if="languageGraph && !connectionContext">
        Select a MAL asset to highlight compatible stencils.
      </template>
    </p> -->
    <div v-if="connectionContext" class="stencil-connections mx-2 mb-2 p-2" role="status">
      <strong class="d-block text-break">{{ connectionContext.sourceLabel }}</strong>
      <template v-if="connectionContext.compatibleAssetTypes.size">
        {{ connectionContext.compatibleAssetTypes.size }} compatible asset types marked in green.
        <span v-if="search.trim()" class="d-block">
          {{ visibleCompatibleCount }} shown by this search.
        </span>
      </template>
      <template v-else>No compatible MAL asset types.</template>
    </div>
    <details v-for="group in groups" :key="group.id" class="stencil-group" open>
      <summary :class="{ 'stencil-group-compatible': compatibleCount(group) > 0 }">
        {{ group.title }}
        <span
          v-if="compatibleCount(group)"
          class="badge rounded-pill text-bg-success ms-1"
          :aria-label="`${compatibleCount(group)} compatible asset types`"
          :title="`${compatibleCount(group)} compatible asset types`"
          >{{ compatibleCount(group) }}</span
        >
      </summary>
      <div class="stencil-grid">
        <StencilItem
          v-for="shape in group.shapes"
          :key="shape.id"
          :shape="shape"
          :compatible="isCompatible(shape)"
          :connection-source="connectionContext?.sourceLabel || ''"
        />
      </div>
    </details>
    <p v-if="!groups.length" class="small text-muted p-2" role="status">No matching shapes.</p>
  </div>
</template>

<style scoped>
.stencil-palette {
  height: 100%;
  overflow: auto;
}
.stencil-help {
  font-size: 0.72rem;
}
.stencil-connections {
  border: 1px solid #a3cfbb;
  border-radius: 4px;
  background: #f0faf4;
  color: #146c43;
  font-size: 0.72rem;
}
.stencil-group {
  border-bottom: 1px solid #e9ecef;
}
.stencil-group summary {
  padding: 8px;
  background: #f8f9fa;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}
.stencil-group summary.stencil-group-compatible {
  color: #146c43;
  background: #edf8f1;
}
.stencil-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 6px;
}
@media (max-width: 767.98px) {
  .stencil-grid {
    grid-template-columns: 1fr;
  }
}
</style>

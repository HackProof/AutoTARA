<script setup>
import { inject, onBeforeUnmount, ref, watch } from 'vue'
import { DRAWIO_EDITOR_KEY } from '@/services/drawio/palette.js'

const props = defineProps({
  shape: { type: Object, required: true },
  compatible: { type: Boolean, default: false },
  connectionSource: { type: String, default: '' },
})
const { editor, state } = inject(DRAWIO_EDITOR_KEY)
const button = ref(null)
let dispose

watch(
  [editor, button, () => props.shape],
  ([instance, element, shape]) => {
    dispose?.()
    dispose = instance && element ? instance.registerStencil(element, shape) : null
  },
  { flush: 'post' },
)
onBeforeUnmount(() => dispose?.())

function insertWithKeyboard(event) {
  if (event.detail === 0) editor.value?.insertShape(props.shape)
}
</script>

<template>
  <button
    ref="button"
    type="button"
    class="stencil-item"
    :class="{ 'stencil-item-compatible': compatible }"
    :title="compatible ? `${shape.label} — Can connect to ${connectionSource}` : shape.label"
    :aria-label="`Add ${shape.label}${compatible ? `, can connect to ${connectionSource}` : ''}`"
    :disabled="!state.ready"
    @click="insertWithKeyboard"
  >
    <svg viewBox="0 0 80 60" width="60" height="46" aria-hidden="true" class="stencil-icon">
      <ellipse
        v-if="shape.icon === 'ellipse'"
        cx="40"
        cy="30"
        rx="25"
        ry="25"
        fill="none"
        stroke="black"
      />
      <path v-else-if="shape.icon === 'store'" d="M6 10 H74 M6 50 H74" fill="none" stroke="black" />
      <rect
        v-else-if="shape.icon === 'boundary'"
        x="6"
        y="6"
        width="68"
        height="48"
        rx="6"
        fill="none"
        stroke="#ff0000"
        stroke-dasharray="6 3"
      />
      <text
        v-else-if="shape.icon === 'text'"
        x="40"
        y="42"
        text-anchor="middle"
        font-size="38"
        fill="black"
        stroke="none"
      >
        T
      </text>
      <rect v-else x="6" y="10" width="68" height="40" fill="none" stroke="black" />
    </svg>
    <span class="stencil-label">{{ shape.label }}</span>
    <span v-if="compatible" class="stencil-connection-label" aria-hidden="true">
      <i class="fa-solid fa-link" aria-hidden="true"></i> Connectable
    </span>
  </button>
</template>

<style scoped>
.stencil-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 8px 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: white;
  color: #495057;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.stencil-item:hover,
.stencil-item:focus-visible {
  background: #f1f6ff;
  border-color: #9ec5fe;
}
.stencil-item:active {
  cursor: grabbing;
}
.stencil-item-compatible {
  border-color: #198754;
  background: #f0faf4;
  box-shadow: inset 0 0 0 1px #198754;
}
.stencil-item-compatible:hover,
.stencil-item-compatible:focus-visible {
  background: #d1e7dd;
  border-color: #146c43;
  outline: 2px solid #146c43;
  outline-offset: 1px;
}
.stencil-connection-label {
  color: #146c43;
  font-size: 0.65rem;
  line-height: 1.2;
}
.stencil-item:disabled {
  opacity: 0.5;
  cursor: default;
}
.stencil-icon {
  max-width: 100%;
  stroke-width: 2;
}
.stencil-label {
  font-size: 0.72rem;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
</style>

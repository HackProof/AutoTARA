<script setup>
import { ref } from 'vue'
import { assetShapes } from '@/services/drawio/palette.js'

const props = defineProps({
  selectedElement: { type: Object, default: null },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update-properties'])
const nameInput = ref(null)
const descriptionInput = ref(null)

function flushChanges() {
  const selected = props.selectedElement
  if (!selected || props.disabled) return
  const changes = {}
  if (nameInput.value && nameInput.value.value !== selected.label)
    changes.label = nameInput.value.value
  if (descriptionInput.value && descriptionInput.value.value !== selected.description)
    changes.description = descriptionInput.value.value
  if (Object.keys(changes).length) emit('update-properties', selected.id, changes)
}
defineExpose({ flushChanges })

function updateProperty(name, event) {
  if (props.selectedElement && !props.disabled) {
    emit('update-properties', props.selectedElement.id, { [name]: event.target.value })
  }
}
</script>

<template>
  <section class="card shadow-sm flex-shrink-0" aria-labelledby="element-properties-title">
    <div class="card-header bg-white border-bottom-0 pt-3 pb-2">
      <h2 id="element-properties-title" class="fs-6 fw-bold mb-0">
        <i class="fa-solid fa-sliders text-primary me-2" aria-hidden="true"></i>Properties
      </h2>
    </div>
    <div class="card-body">
      <div v-if="selectedElement" :key="selectedElement.id">
        <div class="mb-3">
          <label for="asset-name" class="form-label small fw-semibold">
            {{ selectedElement.isEdge ? 'Data Flow Name' : 'Asset Name' }}
          </label>
          <input
            v-if="!selectedElement.association"
            ref="nameInput"
            id="asset-name"
            type="text"
            class="form-control form-control-sm"
            :value="selectedElement.label"
            :disabled="disabled"
            @change="updateProperty('label', $event)"
            @keydown.enter="$event.target.blur()"
          />
          <template v-else>
            <select
              id="asset-name"
              class="form-select form-select-sm"
              :value="selectedElement.association.id"
              :disabled="disabled || !selectedElement.association.options.length"
              aria-describedby="data-flow-association-help"
              @change="updateProperty('associationId', $event)"
            >
              <option value="" disabled>Select an association…</option>
              <option
                v-for="option in selectedElement.association.options"
                :key="option.id"
                :value="option.id"
              >
                {{ option.name }}: {{ option.sourceField }} → {{ option.targetField }}
              </option>
            </select>
            <p id="data-flow-association-help" class="form-text small mb-0">
              <template v-if="selectedElement.association.options.length">
                Association for {{ selectedElement.association.sourceLabel }} →
                {{ selectedElement.association.targetLabel }}. This name and relationship are used
                for MAL export.
              </template>
              <template v-else
                >No association is available. Connect two compatible MAL assets.</template
              >
            </p>
          </template>
        </div>
        <div v-if="selectedElement.dfdShape" class="mb-3">
          <label for="asset-type" class="form-label small fw-semibold">Asset Type</label>
          <select
            id="asset-type"
            class="form-select form-select-sm"
            :value="selectedElement.dfdShape"
            :disabled="disabled"
            @change="updateProperty('dfdShape', $event)"
          >
            <option v-for="shape in assetShapes" :key="shape.id" :value="shape.id">
              {{ shape.label }}
            </option>
          </select>
        </div>
        <div :class="selectedElement.assetType ? 'mb-3' : ''">
          <label for="asset-description" class="form-label small fw-semibold">Description</label>
          <textarea
            ref="descriptionInput"
            id="asset-description"
            class="form-control form-control-sm"
            rows="5"
            :value="selectedElement.description"
            :disabled="disabled"
            @change="updateProperty('description', $event)"
          ></textarea>
        </div>
        <p v-if="selectedElement.assetType" class="small text-muted text-break mb-0">
          MAL Asset: {{ selectedElement.assetType }}
        </p>
      </div>
      <p v-else class="small text-center text-muted opacity-75 mb-0">
        Select an element in the diagram<br />to edit its properties.
      </p>
    </div>
  </section>
</template>

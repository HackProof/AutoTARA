<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { Modal } from 'bootstrap'
import { prepareMalExport, resolveMalExport, serializeMalModel } from '@/services/malModel.js'
import { downloadFile } from '@/services/drawio/xml.js'

const props = defineProps({
  editor: { type: Object, default: null },
  languageGraph: { type: Object, default: null },
  modelInfo: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['saved'])
const modalElement = ref(null)
const formatInput = ref(null)
const format = ref('drawio')
const filename = ref('diagram')
const plan = shallowRef(null)
const choices = ref({})
const errorMessage = ref('')
const errors = computed(() =>
  plan.value ? resolveMalExport(plan.value, choices.value).errors : [],
)
const ambiguousFlows = computed(
  () =>
    plan.value?.flows.filter(
      (flow) =>
        flow.candidates.length > 1 ||
        (flow.associationId &&
          !flow.candidates.some((candidate) => candidate.id === flow.associationId)),
    ) || [],
)
let modalInstance
let triggerElement

function focusFormat() {
  formatInput.value?.focus()
}
function handleHidden() {
  triggerElement?.focus()
}
function openModal(initialFormat = 'drawio') {
  if (!props.editor) return
  format.value = initialFormat
  filename.value =
    (props.modelInfo.title || 'diagram').replace(/\.(drawio|xml|ya?ml)$/i, '') || 'diagram'
  choices.value = Object.create(null)
  errorMessage.value = ''
  plan.value = prepareMalExport(props.editor.getSnapshot(), props.languageGraph, props.modelInfo)
  for (const flow of plan.value.flows) choices.value[flow.id] = flow.associationId
  triggerElement = document.activeElement
  modalInstance.show()
}
function save() {
  errorMessage.value = ''
  try {
    const savedXml = props.editor.getXml()
    if (format.value === 'mal') {
      downloadFile(
        serializeMalModel(plan.value, choices.value),
        `${filename.value}.yaml`,
        'application/yaml',
      )
    } else {
      downloadFile(
        props.editor.getFile(props.modelInfo.title),
        `${filename.value}.drawio`,
        'application/xml',
      )
    }
    emit('saved', savedXml)
    modalInstance.hide()
  } catch (error) {
    errorMessage.value = error.message || 'The diagram could not be saved.'
  }
}
onMounted(() => {
  modalInstance = new Modal(modalElement.value)
  modalElement.value.addEventListener('shown.bs.modal', focusFormat)
  modalElement.value.addEventListener('hidden.bs.modal', handleHidden)
})
onBeforeUnmount(() => {
  modalElement.value.removeEventListener('shown.bs.modal', focusFormat)
  modalElement.value.removeEventListener('hidden.bs.modal', handleHidden)
  modalInstance?.hide()
  modalInstance?.dispose()
})
defineExpose({ openModal })
</script>

<template>
  <Teleport to="body">
    <div
      id="saveDiagramModal"
      ref="modalElement"
      class="modal"
      tabindex="-1"
      aria-labelledby="saveDiagramModalLabel"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <form class="modal-content shadow" @submit.prevent="save">
          <div class="modal-header">
            <h2 id="saveDiagramModalLabel" class="modal-title fw-bold fs-4">Save Diagram</h2>
            <button
              type="button"
              class="btn-close"
              aria-label="Close"
              data-bs-dismiss="modal"
            ></button>
          </div>
          <div class="modal-body">
            <label for="save-diagram-format" class="form-label fw-bold">File format</label>
            <select
              id="save-diagram-format"
              ref="formatInput"
              v-model="format"
              class="form-select"
              aria-describedby="save-format-help"
            >
              <option value="drawio">draw.io (.drawio) — Default</option>
              <option value="mal">MAL Model (.yaml)</option>
            </select>
            <p id="save-format-help" class="form-text">
              <template v-if="format === 'drawio'"
                >Preserves diagram shapes, labels, layout, and connections for editing in draw.io,
                including asset CTSA values, weights, and Risk Scores.</template
              >
              <template v-else
                >Exports MAL assets, associations, positions, and CTSA metadata using the attached
                LangGraph. Use draw.io to preserve the complete diagram appearance.</template
              >
            </p>
            <p class="small text-break">
              File: <strong>{{ filename }}.{{ format === 'mal' ? 'yaml' : 'drawio' }}</strong>
            </p>
            <template v-if="format === 'mal' && plan">
              <p class="small text-muted">
                {{ plan.assets.length }} assets · {{ plan.flows.length }} flows
              </p>
              <p v-for="note in plan.notes" :key="note" class="alert alert-info small py-2">
                {{ note }}
              </p>
              <div v-if="ambiguousFlows.length" class="mb-3">
                <h3 class="fs-6 fw-bold">Choose associations</h3>
                <p class="small text-muted">
                  Diagram associations are preselected. Choose a relationship for any unassigned or
                  outdated Data Flow. Fields are shown in source → target order.
                </p>
                <div v-for="(flow, index) in ambiguousFlows" :key="flow.id" class="mb-3">
                  <label :for="`save-association-${index}`" class="form-label small text-break">
                    <strong>{{ flow.label }}</strong> · {{ flow.source.name }} →
                    {{ flow.target.name }}
                  </label>
                  <select
                    :id="`save-association-${index}`"
                    v-model="choices[flow.id]"
                    class="form-select form-select-sm"
                    required
                  >
                    <option value="" disabled>Select an association…</option>
                    <option
                      v-for="candidate in flow.candidates"
                      :key="candidate.id"
                      :value="candidate.id"
                    >
                      {{ candidate.name }}: {{ candidate.sourceField }} →
                      {{ candidate.targetField }}
                    </option>
                  </select>
                </div>
              </div>
              <div v-if="errors.length" class="alert alert-warning small" role="status">
                <ul class="mb-0 ps-3">
                  <li v-for="error in errors" :key="error">{{ error }}</li>
                </ul>
              </div>
            </template>
            <div v-if="errorMessage" class="alert alert-danger mb-0" role="alert">
              {{ errorMessage }}
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button
              type="submit"
              class="btn btn-primary"
              :disabled="format === 'mal' && errors.length > 0"
            >
              Save {{ format === 'mal' ? '.yaml' : '.drawio' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

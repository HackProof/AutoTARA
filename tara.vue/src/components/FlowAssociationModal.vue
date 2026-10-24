<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { Modal } from 'bootstrap'

const props = defineProps({ editor: { type: Object, default: null } })
const modalElement = ref(null)
const associationInput = ref(null)
const association = shallowRef(null)
const edgeId = ref('')
const choice = ref('')
const errorMessage = ref('')
let modalInstance
let triggerElement

function focusAssociation() {
  nextTick(() => associationInput.value?.focus())
}
function handleHidden() {
  triggerElement?.focus()
}
function openModal(id) {
  const details = props.editor?.getFlowAssociation(id)
  if (!details?.options.length) return
  edgeId.value = id
  association.value = details
  choice.value = details.id || (details.options.length === 1 ? details.options[0].id : '')
  errorMessage.value = ''
  triggerElement = document.activeElement
  modalInstance.show()
}
function apply() {
  try {
    props.editor.updateProperties(edgeId.value, { associationId: choice.value })
    modalInstance.hide()
  } catch (error) {
    errorMessage.value = error.message || 'The association could not be applied.'
  }
}
onMounted(() => {
  modalInstance = new Modal(modalElement.value)
  modalElement.value.addEventListener('shown.bs.modal', focusAssociation)
  modalElement.value.addEventListener('hidden.bs.modal', handleHidden)
})
onBeforeUnmount(() => {
  modalElement.value.removeEventListener('shown.bs.modal', focusAssociation)
  modalElement.value.removeEventListener('hidden.bs.modal', handleHidden)
  modalInstance?.hide()
  modalInstance?.dispose()
})
defineExpose({ openModal })
</script>

<template>
  <Teleport to="body">
    <div
      id="flowAssociationModal"
      ref="modalElement"
      class="modal"
      tabindex="-1"
      aria-labelledby="flowAssociationModalLabel"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-lg modal-dialog-centered">
        <form class="modal-content shadow" @submit.prevent="apply">
          <div class="modal-header">
            <h2 id="flowAssociationModalLabel" class="modal-title fs-4">Data Flow Association</h2>
            <button
              type="button"
              class="btn-close"
              data-bs-dismiss="modal"
              aria-label="Close"
            ></button>
          </div>
          <div v-if="association" class="modal-body">
            <p class="text-break fw-semibold">
              {{ association.sourceLabel }} → {{ association.targetLabel }}
            </p>
            <label for="flow-association-choice" class="form-label"
              >Association / Data Flow Name</label
            >
            <select
              id="flow-association-choice"
              ref="associationInput"
              v-model="choice"
              class="form-select"
              aria-describedby="flow-association-help"
              required
            >
              <option value="" disabled>Select an association…</option>
              <option v-for="option in association.options" :key="option.id" :value="option.id">
                {{ option.name }}: {{ option.sourceField }} → {{ option.targetField }}
              </option>
            </select>
            <p id="flow-association-help" class="form-text">
              The association name becomes the Data Flow label and is used for MAL export. Fields
              are shown in source → target order. You can change this in Properties later.
            </p>
            <div v-if="errorMessage" class="alert alert-danger mb-0" role="alert">
              {{ errorMessage }}
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
              Choose later
            </button>
            <button type="submit" class="btn btn-primary" :disabled="!choice">
              Apply association
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

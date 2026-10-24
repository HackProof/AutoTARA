<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { Modal } from 'bootstrap'
import { assessAssetThreats, riskScoreClass, riskScoreLabel } from '@/services/ttpScoring.js'

const props = defineProps({
  editor: { type: Object, default: null },
  threatsByAsset: { type: Map, default: () => new Map() },
  catalogSchema: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
defineEmits(['retry'])
const modalElement = ref(null)
const searchInput = ref(null)
const asset = shallowRef(null)
const schema = ref('')
const kind = ref('entry')
const savedSteps = ref([])
const selectedIds = ref([])
const search = ref('')
const errorMessage = ref('')
const title = computed(() => (kind.value === 'entry' ? 'Entry' : 'Target'))
const schemaMatches = computed(() => schema.value === props.catalogSchema)
const options = computed(() => {
  if (!asset.value || !schemaMatches.value) return []
  const steps = (props.threatsByAsset.get(asset.value.assetType) || []).map((threat) => ({
    attackStepId: threat.attack_step_id,
    name: threat.name,
    definition: threat.definition,
    declaredAsset: threat.declared_asset,
    available: true,
  }))
  const ids = new Set(steps.map((step) => step.attackStepId))
  // Keep earlier selections visible when a catalog step has been removed.
  for (const step of savedSteps.value) {
    if (!ids.has(step.attackStepId)) steps.push({ ...step, available: false })
  }
  return assessAssetThreats(
    steps.map((step) => ({ ...step, attack_step_id: step.attackStepId })),
    asset.value.threatAssessments?.[schema.value],
  )
})
const filteredOptions = computed(() => {
  const query = search.value.trim().toLowerCase()
  return options.value.filter((step) =>
    [step.name, step.attackStepId, step.definition, step.declaredAsset].some((text) =>
      text?.toLowerCase().includes(query),
    ),
  )
})
const canSave = computed(
  () => Boolean(asset.value) && schemaMatches.value && !props.loading && !props.error,
)
let modalInstance
let triggerElement

function openModal(context) {
  if (!props.editor || !['entry', 'target'].includes(context.kind)) return
  asset.value = { ...context.asset }
  schema.value = context.schema
  kind.value = context.kind
  savedSteps.value = (context.asset.attackEndpoints?.[context.schema]?.[context.kind] || []).map(
    (step) => ({ ...step }),
  )
  selectedIds.value = savedSteps.value.map((step) => step.attackStepId)
  search.value = ''
  errorMessage.value = ''
  triggerElement = document.activeElement
  modalInstance.show()
}
function focusSearch() {
  nextTick(() => searchInput.value?.focus())
}
function handleHidden() {
  asset.value = null
  savedSteps.value = []
  selectedIds.value = []
  triggerElement?.focus()
}
function save() {
  if (!canSave.value) return
  try {
    const selected = new Set(selectedIds.value)
    props.editor.updateAttackEndpoints(
      asset.value.id,
      schema.value,
      kind.value,
      options.value
        .filter((step) => selected.has(step.attackStepId))
        .map(({ attackStepId, name }) => ({ attackStepId, name })),
      asset.value.assetType,
    )
    modalInstance.hide()
  } catch (error) {
    errorMessage.value = error.message || 'The attack endpoints could not be saved.'
  }
}
onMounted(() => {
  modalInstance = new Modal(modalElement.value)
  modalElement.value.addEventListener('shown.bs.modal', focusSearch)
  modalElement.value.addEventListener('hidden.bs.modal', handleHidden)
})
onBeforeUnmount(() => {
  modalElement.value.removeEventListener('shown.bs.modal', focusSearch)
  modalElement.value.removeEventListener('hidden.bs.modal', handleHidden)
  modalInstance?.hide()
  modalInstance?.dispose()
})
defineExpose({ openModal })
</script>

<template>
  <Teleport to="body">
    <div
      id="attackEndpointModal"
      ref="modalElement"
      class="modal"
      tabindex="-1"
      aria-labelledby="attack-endpoint-title"
      aria-describedby="attack-endpoint-help"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <form class="modal-content shadow" @submit.prevent="save">
          <div class="modal-header">
            <div>
              <h2 id="attack-endpoint-title" class="modal-title fs-4">
                Set {{ title }} Attack Steps
              </h2>
              <p v-if="asset" class="small text-muted mb-0 text-break">
                {{ asset.label }} · {{ asset.assetType }} · {{ schema }}
              </p>
            </div>
            <button
              type="button"
              class="btn-close"
              data-bs-dismiss="modal"
              aria-label="Close"
            ></button>
          </div>
          <div class="modal-body">
            <p id="attack-endpoint-help" class="small text-muted">
              Select one or more attack steps as {{ title }} points for this asset. Clear the
              selection to remove its {{ title }} points. Changes apply when you save.
            </p>
            <label for="attack-endpoint-search" class="form-label small">Search attack steps</label>
            <input
              id="attack-endpoint-search"
              ref="searchInput"
              v-model="search"
              type="search"
              class="form-control mb-3"
              placeholder="Search by name or description"
            />
            <div class="d-flex align-items-center justify-content-between gap-2 mb-3">
              <span class="small text-muted" role="status">{{ selectedIds.length }} selected</span>
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                :disabled="!selectedIds.length"
                @click="selectedIds = []"
              >
                Clear selection
              </button>
            </div>
            <p v-if="!schemaMatches" class="text-danger small" role="alert">
              The diagram language has changed. Close the dialog and select the asset again.
            </p>
            <p v-else-if="loading" class="text-muted small" role="status">
              <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
              Loading attack steps…
            </p>
            <div v-else-if="error" class="alert alert-danger small" role="alert">
              {{ error }}
              <button
                type="button"
                class="btn btn-sm btn-outline-danger ms-2"
                @click="$emit('retry')"
              >
                Retry
              </button>
            </div>
            <p v-else-if="!options.length" class="text-muted small mb-0">
              No attack steps are recorded for this asset in the selected schema.
            </p>
            <p v-else-if="!filteredOptions.length" class="text-muted small mb-0">
              No attack steps match your search.
            </p>
            <fieldset v-else class="m-0">
              <legend class="visually-hidden">{{ title }} attack steps</legend>
              <div class="list-group">
                <label
                  v-for="(step, index) in filteredOptions"
                  :key="step.attackStepId"
                  :for="`attack-endpoint-step-${index}`"
                  class="list-group-item list-group-item-action d-flex gap-3 align-items-start"
                >
                  <input
                    :id="`attack-endpoint-step-${index}`"
                    v-model="selectedIds"
                    type="checkbox"
                    class="form-check-input flex-shrink-0 mt-1"
                    :value="step.attackStepId"
                  />
                  <span class="text-break">
                    <span class="fw-semibold">{{ step.name }}</span>
                    <span
                      v-if="Number.isFinite(step.riskScore)"
                      class="badge rounded-pill ms-2"
                      :class="riskScoreClass(step.riskScore)"
                      :aria-label="`Risk Score: ${riskScoreLabel(step.riskScore)}`"
                    >
                      Risk Score {{ riskScoreLabel(step.riskScore) }}
                    </span>
                    <span v-if="!step.available" class="d-block small text-warning-emphasis">
                      Previously selected; no longer in the catalog. Uncheck to remove.
                    </span>
                    <span
                      v-if="step.declaredAsset && step.declaredAsset !== asset.assetType"
                      class="d-block small text-muted"
                    >
                      Inherited from {{ step.declaredAsset }}
                    </span>
                    <span v-if="step.definition" class="d-block small text-muted mt-1">{{
                      step.definition
                    }}</span>
                  </span>
                </label>
              </div>
            </fieldset>
          </div>
          <div class="modal-footer">
            <p v-if="errorMessage" class="text-danger small mb-0 me-auto" role="alert">
              {{ errorMessage }}
            </p>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="!canSave">
              Save {{ title }} points
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

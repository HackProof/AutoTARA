<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { Modal } from 'bootstrap'
import AttackStepSemantics from './AttackStepSemantics.vue'
import { ATTACK_STEP_CATEGORIES, filterCtsaThreats } from '@/services/attackStepSemantics.js'
import {
  TTP_FACTORS,
  TTP_VALUES,
  calculateTtpScore,
  createCtsaDraft,
  createTtpWeights,
  databaseCtsaScore,
  riskScoreClass,
  riskScoreLabel,
  validTtpFactors,
  validTtpWeights,
} from '@/services/ttpScoring.js'

const props = defineProps({ editor: { type: Object, default: null } })
const modalElement = ref(null)
const firstInput = ref(null)
const asset = shallowRef(null)
const schema = ref('')
const draft = ref(createCtsaDraft([]))
const errorMessage = ref('')
const categoryFilter = ref('')
const mappingFilter = ref('')
const stepSearch = ref('')
const visibleThreats = computed(() =>
  filterCtsaThreats(draft.value.threats, {
    category: categoryFilter.value,
    mapping: mappingFilter.value,
    search: stepSearch.value,
  }),
)
const canSave = computed(
  () =>
    draft.value.threats.length > 0 &&
    validTtpWeights(draft.value.weights) &&
    draft.value.threats.every((threat) => validTtpFactors(threat.factors)),
)
const assessedCount = computed(
  () =>
    draft.value.threats.filter(
      (threat) => calculateTtpScore(threat.factors, draft.value.weights) !== null,
    ).length,
)
let modalInstance
let triggerElement

function openModal(context) {
  if (!props.editor || !context.threats.length) return
  asset.value = { ...context.asset }
  schema.value = context.schema
  draft.value = createCtsaDraft(context.threats, context.asset.threatAssessments?.[context.schema])
  errorMessage.value = ''
  categoryFilter.value = ''
  mappingFilter.value = ''
  stepSearch.value = ''
  triggerElement = document.activeElement
  modalInstance.show()
}
function focusFirstInput() {
  nextTick(() => firstInput.value?.focus())
}
function handleHidden() {
  draft.value = createCtsaDraft([])
  asset.value = null
  triggerElement?.focus()
}
function fillBlankValues() {
  for (const threat of draft.value.threats) {
    for (const factor of threat.factors) if (factor.value === null) factor.value = 3
  }
}
function resetWeights() {
  draft.value.weights = createTtpWeights()
}
function save() {
  if (!canSave.value || !asset.value) return
  try {
    props.editor.updateThreatAssessments(
      asset.value.id,
      schema.value,
      draft.value,
      asset.value.assetType,
    )
    modalInstance.hide()
  } catch (error) {
    errorMessage.value = error.message || 'The TTP assessments could not be saved.'
  }
}
onMounted(() => {
  modalInstance = new Modal(modalElement.value)
  modalElement.value.addEventListener('shown.bs.modal', focusFirstInput)
  modalElement.value.addEventListener('hidden.bs.modal', handleHidden)
})
onBeforeUnmount(() => {
  modalElement.value.removeEventListener('shown.bs.modal', focusFirstInput)
  modalElement.value.removeEventListener('hidden.bs.modal', handleHidden)
  modalInstance?.hide()
  modalInstance?.dispose()
})
defineExpose({ openModal })
</script>

<template>
  <Teleport to="body">
    <div
      id="ctsaScoringModal"
      ref="modalElement"
      class="modal"
      tabindex="-1"
      aria-labelledby="ctsa-scoring-title"
      aria-hidden="true"
    >
      <div
        class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-fullscreen-sm-down ctsa-dialog"
      >
        <form class="modal-content shadow" @submit.prevent="save">
          <div class="modal-header">
            <div>
              <h2 id="ctsa-scoring-title" class="modal-title fs-4">CTSA — TTP Scoring</h2>
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
          <div class="modal-body ctsa-body p-0">
            <div class="ctsa-controls p-3 border-bottom">
              <p id="ctsa-scoring-help" class="small text-muted mb-2">
                Assess all threats for this asset. Values: 1 (Very Low) to 5 (Very High). Each
                weight must be non-negative, and the total weight must be greater than 0. Set shared
                asset weights in the column headers. The twelve default weights are 0.1 each (total
                1.2). Risk Score = Σ(value × weight) / Σ(weight), ranging from 1 to 5 and rounded to
                one decimal. Blank values keep the Risk Score unassessed. Higher ratings increase
                this score. Apply a consistent risk-oriented rubric; raw skill/resource requirements
                are not automatically inverted.
              </p>
              <div class="d-flex flex-wrap gap-2 align-items-center">
                <button
                  ref="firstInput"
                  type="button"
                  class="btn btn-sm btn-outline-secondary"
                  @click="fillBlankValues"
                >
                  Fill blank values with Medium (3)
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary"
                  @click="resetWeights"
                >
                  Reset weights to 0.1
                </button>
                <span class="small text-muted ms-sm-auto" role="status"
                  >{{ assessedCount }} / {{ draft.threats.length }} threats assessed</span
                >
              </div>
              <p class="small text-muted mt-3 mb-2">
                Review each step's semantic classification. Steps without MITRE mappings can also be
                assessed and saved. Filters only change the visible rows; saving and bulk input
                apply to the full assessment.
              </p>
              <div class="row g-2">
                <div class="col-md-5">
                  <label for="ctsa-step-search" class="form-label small">Search Attack Steps</label>
                  <input
                    id="ctsa-step-search"
                    v-model="stepSearch"
                    type="search"
                    class="form-control form-control-sm"
                    placeholder="Step name or classification"
                  />
                </div>
                <div class="col-md-4">
                  <label for="ctsa-category-filter" class="form-label small"
                    >Semantic classification</label
                  >
                  <select
                    id="ctsa-category-filter"
                    v-model="categoryFilter"
                    class="form-select form-select-sm"
                  >
                    <option value="">All classifications</option>
                    <option
                      v-for="category in ATTACK_STEP_CATEGORIES"
                      :key="category.value"
                      :value="category.value"
                    >
                      {{ category.label }}
                    </option>
                    <option value="unclassified">Unclassified</option>
                  </select>
                </div>
                <div class="col-md-3">
                  <label for="ctsa-mapping-filter" class="form-label small">MITRE mapping</label>
                  <select
                    id="ctsa-mapping-filter"
                    v-model="mappingFilter"
                    class="form-select form-select-sm"
                  >
                    <option value="">All</option>
                    <option value="mapped">Mapped</option>
                    <option value="unmapped">Unmapped</option>
                  </select>
                </div>
              </div>
              <p class="small text-muted mt-2 mb-0" role="status">
                {{ visibleThreats.length }} / {{ draft.threats.length }} steps shown
              </p>
              <p
                v-if="!validTtpWeights(draft.weights)"
                class="small text-danger mt-2 mb-0"
                role="alert"
              >
                Weights must be non-negative numbers, with at least one weight greater than 0.
              </p>
              <p
                v-if="draft.weightConflicts.length"
                class="small text-warning-emphasis mt-2 mb-0"
                role="status"
              >
                Some earlier attack steps used different weights. The corresponding shared asset
                weights start at 0.1; review them before saving.
              </p>
            </div>
            <div
              class="ctsa-table-container"
              role="region"
              aria-label="TTP scoring for all asset threats"
              tabindex="0"
            >
              <table
                class="table table-bordered table-hover align-middle mb-0 ctsa-table"
                aria-describedby="ctsa-scoring-help"
              >
                <caption class="visually-hidden">
                  All asset threats and their twelve TTP scoring factors with shared asset weights
                </caption>
                <thead class="table-light">
                  <tr>
                    <th scope="col" class="attack-step-column">
                      Attack Step
                      <span class="d-block small fw-normal text-muted mt-2"
                        >Shared asset weights →</span
                      >
                    </th>
                    <th
                      v-for="factor in TTP_FACTORS"
                      :key="factor.key"
                      scope="col"
                      class="factor-column"
                    >
                      {{ factor.label }}
                      <label class="d-flex align-items-center gap-1 mt-2 weight-label">
                        <span class="text-muted fw-normal">Weight</span>
                        <input
                          v-model.number="draft.weights[factor.key]"
                          type="number"
                          min="0"
                          step="any"
                          class="form-control form-control-sm weight-input"
                          required
                          :aria-label="`${factor.label} weight for all asset threats`"
                        />
                      </label>
                    </th>
                    <th scope="col" class="risk-column">Risk Score</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!visibleThreats.length">
                    <td :colspan="TTP_FACTORS.length + 2" class="text-muted p-3">
                      No Attack Steps match your filters.
                    </td>
                  </tr>
                  <tr v-for="threat in visibleThreats" :key="threat.attack_step_id">
                    <th scope="row" class="attack-step-column">
                      <div
                        class="fw-semibold text-break"
                        :title="threat.definition || threat.qualified_name"
                      >
                        {{ threat.name }}
                      </div>
                      <div class="small text-muted text-break">{{ threat.qualified_name }}</div>
                      <div class="d-flex flex-wrap gap-1 mt-2">
                        <span
                          v-for="technique in threat.techniques"
                          :key="technique.id"
                          class="badge rounded-pill bg-primary-subtle text-primary-emphasis"
                          :title="technique.name || technique.id"
                          >{{ technique.id }}</span
                        >
                        <span
                          v-for="mapping in threat.r155"
                          :key="mapping.id"
                          class="badge rounded-pill bg-info-subtle text-info-emphasis"
                          :title="mapping.description"
                          >UN R155 {{ mapping.id }}</span
                        >
                      </div>
                      <AttackStepSemantics
                        :threat="threat"
                        :show-unmapped-reason="false"
                        :show-rationale="false"
                      />
                    </th>
                    <td v-for="(factor, index) in threat.factors" :key="factor.key">
                      <select
                        v-model="factor.value"
                        class="form-select form-select-sm"
                        :aria-label="`${threat.name} — ${TTP_FACTORS[index].label} value`"
                      >
                        <option :value="null">—</option>
                        <option
                          v-for="option in TTP_VALUES"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.value }} · {{ option.label }}
                        </option>
                      </select>
                    </td>
                    <td class="risk-column text-center">
                      <span
                        class="badge rounded-pill"
                        :class="riskScoreClass(calculateTtpScore(threat.factors, draft.weights))"
                        >{{
                          riskScoreLabel(calculateTtpScore(threat.factors, draft.weights))
                        }}</span
                      >
                      <div
                        v-if="databaseCtsaScore(threat.ctsa) !== null"
                        class="small text-muted mt-1"
                      >
                        DB CTSA: {{ riskScoreLabel(databaseCtsaScore(threat.ctsa)) }}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="modal-footer">
            <p v-if="errorMessage" class="text-danger small mb-0 me-auto" role="alert">
              {{ errorMessage }}
            </p>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="!canSave">
              Save assessments
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ctsa-dialog {
  width: calc(100vw - 2rem);
  max-width: 1800px;
}
.ctsa-dialog .ctsa-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.ctsa-controls {
  flex: 0 0 auto;
  max-height: 40dvh;
  overflow-y: auto;
}
.ctsa-table-container {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  max-height: 65dvh;
  overflow-x: scroll;
  overflow-y: auto;
}
.ctsa-table-container::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}
.ctsa-table-container::-webkit-scrollbar-track {
  background: #f1f3f5;
}
.ctsa-table-container::-webkit-scrollbar-thumb {
  border: 2px solid #f1f3f5;
  border-radius: 6px;
  background: #adb5bd;
}
.ctsa-table {
  min-width: 1760px;
  font-size: 0.75rem;
}
.ctsa-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  vertical-align: middle;
  background: #f8f9fa;
}
.attack-step-column {
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 320px;
  max-width: 380px;
  background: white;
}
.ctsa-table thead .attack-step-column,
.ctsa-table thead .risk-column {
  z-index: 3;
}
.factor-column {
  min-width: 118px;
}
.risk-column {
  position: sticky;
  right: 0;
  z-index: 1;
  min-width: 90px;
  background: white;
}
.ctsa-table .form-select,
.weight-input {
  font-size: 0.75rem;
}
.weight-label {
  font-size: 0.65rem;
}
.weight-input {
  width: 64px;
  padding: 2px 4px;
}
@media (max-width: 575.98px) {
  .ctsa-dialog {
    width: 100%;
  }
  .attack-step-column {
    position: static;
    left: auto;
  }
}
</style>

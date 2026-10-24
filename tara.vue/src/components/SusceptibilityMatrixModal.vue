<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { Modal } from 'bootstrap'
import AttackStepSemantics from './AttackStepSemantics.vue'
import { describeAttackStep } from '@/services/attackStepSemantics.js'
import { createSusceptibilityMatrix } from '@/services/susceptibilityMatrix.js'
import { riskScoreClass, riskScoreLabel } from '@/services/ttpScoring.js'

const props = defineProps({
  threatsByAsset: { type: Map, default: () => new Map() },
  catalogSchema: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
defineEmits(['retry'])
const modalElement = ref(null)
const searchInput = ref(null)
const evidencePanel = ref(null)
const snapshot = shallowRef(null)
const schema = ref('')
const search = ref('')
const selectedCell = ref(null)
const schemaMatches = computed(() => schema.value === props.catalogSchema)
const matrix = computed(() =>
  createSusceptibilityMatrix(
    schemaMatches.value ? snapshot.value : null,
    schema.value,
    props.threatsByAsset,
  ),
)
const visibleRows = computed(() => {
  const query = search.value.trim().toLowerCase()
  return matrix.value.rows.filter((row) =>
    [
      row.avId,
      row.attackVector,
      ...row.cells.flatMap((cell) =>
        cell.sourceSteps.flatMap((step) => [step.attackStepId, step.name]),
      ),
    ].some((text) => text.toLowerCase().includes(query)),
  )
})
const visibleUnmappedSteps = computed(() => {
  const query = search.value.trim().toLowerCase()
  return matrix.value.unmappedSteps.filter((step) =>
    [
      step.assetName,
      step.assetId,
      step.attackStepId,
      step.attackVector,
      describeAttackStep(step.semantics || {}).label,
      describeAttackStep(step.semantics || {}).unmappedReason,
    ].some((text) => text.toLowerCase().includes(query)),
  )
})
const selectedEvidence = computed(() => {
  if (!selectedCell.value) return null
  const row = matrix.value.rows.find((item) => item.avId === selectedCell.value.avId)
  const cell = row?.cells.find((item) => item.cartId === selectedCell.value.cartId)
  const column = matrix.value.columns.find((item) => item.id === cell?.cartId)
  return cell?.sourceSteps.length && column ? { row, cell, column } : null
})
let modalInstance
let triggerElement

function openModal(context) {
  snapshot.value = context.snapshot
  schema.value = context.schema
  search.value = ''
  selectedCell.value = null
  triggerElement = document.activeElement
  modalInstance.show()
}
function focusSearch() {
  nextTick(() => searchInput.value?.focus())
}
function handleHidden() {
  snapshot.value = null
  selectedCell.value = null
  triggerElement?.focus()
}
function selectCell(avId, cartId) {
  selectedCell.value = { avId, cartId }
  nextTick(() => {
    evidencePanel.value?.focus({ preventScroll: true })
    evidencePanel.value?.scrollIntoView({ block: 'nearest' })
  })
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
      id="susceptibilityMatrixModal"
      ref="modalElement"
      class="modal"
      tabindex="-1"
      aria-labelledby="susceptibility-matrix-title"
      aria-describedby="susceptibility-matrix-help"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable matrix-dialog">
        <div class="modal-content shadow">
          <div class="modal-header">
            <div>
              <h2 id="susceptibility-matrix-title" class="modal-title fs-4">
                Susceptibility Matrix
              </h2>
              <p class="small text-muted mb-0">CTSA · {{ schema }}</p>
            </div>
            <button
              type="button"
              class="btn-close"
              data-bs-dismiss="modal"
              aria-label="Close"
            ></button>
          </div>
          <div class="modal-body">
            <p id="susceptibility-matrix-help" class="small text-muted">
              Each Shopping Cart represents a diagram asset. AV ID is the MITRE ATT&amp;CK Technique
              ID, and Attack Vector is its technique name. Scores use completed TTP assessments of
              the mapped Attack Steps.
            </p>
            <p v-if="!schemaMatches" class="alert alert-warning small" role="alert">
              The diagram language has changed. Close the matrix, clear the selection and reopen
              CTSA to review the current diagram.
            </p>
            <p v-else-if="loading" class="text-muted small" role="status">
              <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
              Loading attack vectors…
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
            <template v-else>
              <div class="d-flex flex-wrap gap-2 mb-3 small" role="status">
                <span class="badge text-bg-light border"
                  >{{ matrix.columns.length }} Shopping Carts</span
                >
                <span class="badge text-bg-primary">{{ matrix.rows.length }} Attack Vectors</span>
                <span class="text-muted">Risk Score: High to low</span>
              </div>
              <p class="small text-muted">
                For each Technique, X (score) shows the Cart's highest TTP Risk Score among its
                mapped Attack Steps. Risk Score is the maximum across Carts. Empty cells have no
                assessed mapping. Select a marked cell to inspect its source Steps. Technique scores
                are not additive.
              </p>
              <label for="susceptibility-matrix-search" class="form-label small"
                >Search attack vectors</label
              >
              <input
                id="susceptibility-matrix-search"
                ref="searchInput"
                v-model="search"
                type="search"
                class="form-control mb-3"
                placeholder="Technique ID, technique name or source Attack Step"
              />
              <p v-if="!matrix.columns.length" class="text-muted small mb-0">
                No MAL assets are present in this diagram.
              </p>
              <div v-else class="table-responsive matrix-table-container">
                <table class="table table-bordered table-hover align-middle mb-0 matrix-table">
                  <caption class="small">
                    Showing
                    {{
                      visibleRows.length
                    }}
                    of
                    {{
                      matrix.rows.length
                    }}
                    attack vectors.
                  </caption>
                  <thead class="table-light">
                    <tr>
                      <th scope="col" class="av-id-column">AV ID</th>
                      <th scope="col" class="vector-column">Attack Vector</th>
                      <th scope="col" class="text-center text-nowrap" aria-sort="descending">
                        Risk Score
                      </th>
                      <th
                        v-for="column in matrix.columns"
                        :key="column.id"
                        scope="col"
                        class="cart-column text-center"
                      >
                        <span class="d-block small text-muted fw-normal">Shopping Cart</span>
                        {{ column.name }}
                        <span class="d-block small text-muted fw-normal">ID: {{ column.id }}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!visibleRows.length">
                      <td :colspan="matrix.columns.length + 3" class="text-muted small p-3">
                        <p v-if="!matrix.rows.length && !matrix.unmappedSteps.length" class="mb-0">
                          No TTP-scored attack vectors yet. Select an asset and save a complete TTP
                          assessment in CTSA, then clear the selection and reopen CTSA.
                        </p>
                        <p v-else-if="!matrix.rows.length" class="mb-0">
                          No assessed Attack Steps have MITRE ATT&amp;CK mappings. Review MITRE
                          unmapped below.
                        </p>
                        <p v-else class="mb-0">No attack vectors match your search.</p>
                      </td>
                    </tr>
                    <tr v-for="row in visibleRows" :key="row.avId">
                      <th scope="row" class="av-id-column fw-normal">{{ row.avId }}</th>
                      <td class="vector-column">{{ row.attackVector }}</td>
                      <td class="text-center">
                        <span
                          class="badge rounded-pill"
                          :class="riskScoreClass(row.riskScore)"
                          :aria-label="`Risk Score: ${riskScoreLabel(row.riskScore)}`"
                          >{{ riskScoreLabel(row.riskScore) }}</span
                        >
                      </td>
                      <td
                        v-for="cell in row.cells"
                        :key="cell.cartId"
                        class="text-center text-nowrap"
                        :class="{ 'matrix-hit': cell.riskScore !== null }"
                      >
                        <button
                          v-if="cell.sourceSteps.length"
                          type="button"
                          class="btn btn-link p-0 text-decoration-none fw-semibold"
                          :title="`Cart score: ${riskScoreLabel(cell.riskScore)}. View source Steps.`"
                          :aria-label="`${row.avId}, Shopping Cart ${cell.cartId}: ${cell.label}. View source Steps`"
                          :aria-expanded="
                            selectedEvidence?.row.avId === row.avId &&
                            selectedEvidence.cell.cartId === cell.cartId
                          "
                          aria-controls="susceptibility-evidence"
                          @click="selectCell(row.avId, cell.cartId)"
                        >
                          {{ cell.label }}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <section
                v-if="selectedEvidence"
                id="susceptibility-evidence"
                ref="evidencePanel"
                class="border rounded p-3 mt-3"
                tabindex="-1"
                aria-labelledby="susceptibility-evidence-title"
              >
                <div class="d-flex justify-content-between align-items-start gap-2">
                  <h3 id="susceptibility-evidence-title" class="fs-6 mb-2">
                    Source Attack Steps · {{ selectedEvidence.row.avId }} ·
                    {{ selectedEvidence.column.name }} (ID: {{ selectedEvidence.column.id }})
                  </h3>
                  <button
                    type="button"
                    class="btn-close"
                    aria-label="Close source Steps"
                    @click="selectedCell = null"
                  ></button>
                </div>
                <p class="small text-muted">
                  Cart score: {{ riskScoreLabel(selectedEvidence.cell.riskScore) }} · Representative
                  Risk Score: {{ riskScoreLabel(selectedEvidence.row.riskScore) }}. The highest
                  assessed Step score determines this Cart's score.
                </p>
                <div class="table-responsive">
                  <table class="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th scope="col">Attack Step</th>
                        <th scope="col">Attack Step ID</th>
                        <th scope="col" class="text-end text-nowrap">TTP Risk Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="step in selectedEvidence.cell.sourceSteps"
                        :key="step.attackStepId"
                      >
                        <th scope="row" class="fw-normal text-break" :title="step.definition">
                          {{ step.name }}
                        </th>
                        <td class="text-break">{{ step.attackStepId }}</td>
                        <td class="text-end">
                          <span
                            v-if="step.riskScore === selectedEvidence.cell.riskScore"
                            class="small text-muted me-2"
                            >Maximum</span
                          >
                          <span
                            class="badge rounded-pill"
                            :class="riskScoreClass(step.riskScore)"
                            >{{ riskScoreLabel(step.riskScore) }}</span
                          >
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
              <details v-if="matrix.unmappedSteps.length" class="mt-3">
                <summary class="fw-semibold small">
                  MITRE unmapped · {{ matrix.unmappedSteps.length }} assessed Steps
                </summary>
                <p class="small text-muted mt-2">
                  These assessed Steps have no MITRE ATT&amp;CK mapping. Their original TTP scores
                  remain available here and are excluded from Technique rows.
                </p>
                <p v-if="!visibleUnmappedSteps.length" class="text-muted small">
                  No unmapped Steps match your search.
                </p>
                <div v-else class="table-responsive">
                  <table class="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th scope="col">Shopping Cart</th>
                        <th scope="col">Attack Step</th>
                        <th scope="col">Attack Step ID</th>
                        <th scope="col" class="text-end text-nowrap">TTP Risk Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="step in visibleUnmappedSteps"
                        :key="JSON.stringify([step.assetId, step.attackStepId])"
                      >
                        <th scope="row" class="text-break fw-normal">
                          {{ step.assetName
                          }}<span class="d-block small text-muted">ID: {{ step.assetId }}</span>
                        </th>
                        <td class="text-break" :title="step.definition">
                          {{ step.attackVector }}
                          <AttackStepSemantics :threat="step.semantics || {}" />
                        </td>
                        <td class="text-break">{{ step.attackStepId }}</td>
                        <td class="text-end">
                          <span
                            class="badge rounded-pill"
                            :class="riskScoreClass(step.riskScore)"
                            >{{ riskScoreLabel(step.riskScore) }}</span
                          >
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>
            </template>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped src="../assets/matrix-table.css"></style>

<style scoped>
.matrix-dialog {
  width: calc(100% - 2rem);
  max-width: 1800px;
  margin-inline: auto;
}
</style>

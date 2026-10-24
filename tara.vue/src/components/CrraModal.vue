<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Modal } from 'bootstrap'
import { createSusceptibilityMatrix } from '@/services/susceptibilityMatrix.js'
import {
  CRRA_RISK_BANDS,
  createCrraDraft,
  createSolutionTable,
  evaluateCountermeasures,
  sortCountermeasures,
} from '@/services/crra.js'
import { fetchCountermeasures } from '@/services/crraCatalog.js'
import { riskScoreClass, riskScoreLabel } from '@/services/ttpScoring.js'
import CrraCandidateTable from './CrraCandidateTable.vue'
import CrraSolutionTable from './CrraSolutionTable.vue'

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
const snapshot = shallowRef(null)
const schema = ref('')
const tab = ref('vectors')
const search = ref('')
const draft = ref(createCrraDraft())
const schemaMatches = computed(() => schema.value === props.catalogSchema)
const matrix = computed(() =>
  createSusceptibilityMatrix(
    schemaMatches.value ? snapshot.value : null,
    schema.value,
    props.threatsByAsset,
  ),
)
const visibleVectors = computed(() =>
  matrix.value.rows.filter((row) =>
    `${row.avId} ${row.attackVector}`.toLowerCase().includes(search.value.trim().toLowerCase()),
  ),
)
const vectors = computed(() =>
  matrix.value.rows.filter((row) => draft.value.selectedAvIds.includes(row.avId)),
)
const allVectorsSelected = computed(
  () => matrix.value.rows.length > 0 && vectors.value.length === matrix.value.rows.length,
)
const catalog = shallowRef({ countermeasures: [] })
const catalogLoading = ref(false)
const catalogError = ref('')
const revision = ref(0)
const errorMessage = ref('')
const saveMessage = ref('')
const candidates = computed(() =>
  evaluateCountermeasures(vectors.value, catalog.value, draft.value),
)
const ranked = computed(() => sortCountermeasures(candidates.value, draft.value.sort))
const solution = computed(() =>
  createSolutionTable(vectors.value, ranked.value, draft.value.selectedCmIds, draft.value.strategy),
)
const unmapped = computed(() =>
  vectors.value.filter(
    (av) => !candidates.value.some((cm) => cm.mappings.some((mapping) => mapping.avId === av.avId)),
  ),
)
const solving = ref(false)
const selectionResult = shallowRef(null)
let worker
let modalInstance
let triggerElement

function cancelSearch() {
  worker?.terminate()
  worker = null
  solving.value = false
}
function invalidate() {
  cancelSearch()
  selectionResult.value = null
  saveMessage.value = ''
}
watch(
  () => JSON.stringify([vectors.value, candidates.value, draft.value.strategy, draft.value.sort]),
  invalidate,
  { flush: 'sync' },
)
watch(
  draft,
  () => {
    saveMessage.value = ''
  },
  { deep: true, flush: 'sync' },
)
watch(
  [
    schemaMatches,
    () => Boolean(snapshot.value),
    () => props.loading,
    () => props.error,
    () => JSON.stringify(vectors.value.map((av) => av.avId).sort()),
    revision,
  ],
  async (_, previous, onCleanup) => {
    const controller = new AbortController()
    let active = true
    onCleanup(() => {
      active = false
      controller.abort()
    })
    catalog.value = { countermeasures: [] }
    catalogError.value = ''
    catalogLoading.value = false
    if (
      !snapshot.value ||
      !schemaMatches.value ||
      props.loading ||
      props.error ||
      !vectors.value.length
    )
      return
    catalogLoading.value = true
    try {
      const data = await fetchCountermeasures(
        schema.value,
        vectors.value.map((av) => av.avId),
        { signal: controller.signal },
      )
      if (active) catalog.value = data
    } catch (error) {
      if (active)
        catalogError.value =
          error.response?.data?.error ||
          'Unable to load countermeasures. Check the server connection and retry.'
    } finally {
      if (active) catalogLoading.value = false
    }
  },
)
function openModal(context) {
  snapshot.value = context.snapshot
  schema.value = context.schema
  draft.value = createCrraDraft(context.snapshot?.metadata?.crra?.[context.schema])
  search.value = ''
  tab.value = 'vectors'
  errorMessage.value = ''
  saveMessage.value = ''
  revision.value++
  triggerElement = document.activeElement
  modalInstance.show()
}
function selectVisible() {
  draft.value.selectedAvIds = [
    ...new Set([...draft.value.selectedAvIds, ...visibleVectors.value.map((av) => av.avId)]),
  ]
}
function toggleAllVectors(checked) {
  draft.value.selectedAvIds = checked ? matrix.value.rows.map((av) => av.avId) : []
}
function editCandidate(id, changes) {
  const previous = draft.value.overrides[id] || {}
  if (changes.avId) {
    const { avId, ...mapping } = changes
    draft.value.overrides[id] = {
      ...previous,
      mappings: { ...previous.mappings, [avId]: { ...previous.mappings?.[avId], ...mapping } },
    }
  } else {
    draft.value.overrides[id] = { ...previous, ...changes }
    if (changes.excluded)
      draft.value.selectedCmIds = draft.value.selectedCmIds.filter((cmId) => cmId !== id)
  }
}
function toggleCandidate(id, checked) {
  invalidate()
  draft.value.selectedCmIds = checked
    ? [...new Set([...draft.value.selectedCmIds, id])]
    : draft.value.selectedCmIds.filter((cmId) => cmId !== id)
}
function selectAutomatically() {
  cancelSearch()
  selectionResult.value = null
  errorMessage.value = ''
  try {
    worker = new Worker(new URL('../services/crra.worker.js', import.meta.url), { type: 'module' })
    solving.value = true
    worker.onmessage = ({ data }) => {
      if (data.error) errorMessage.value = data.error
      else {
        draft.value.selectedCmIds = data.result.selectedCmIds
        selectionResult.value = data.result
        tab.value = 'solution'
      }
      cancelSearch()
    }
    worker.onerror = () => {
      errorMessage.value = 'Countermeasure selection failed. Retry or select CMs manually.'
      cancelSearch()
    }
    worker.postMessage(
      JSON.parse(
        JSON.stringify({
          vectors: vectors.value,
          candidates: candidates.value,
          strategy: draft.value.strategy,
          sort: draft.value.sort,
        }),
      ),
    )
  } catch (error) {
    errorMessage.value = error.message
    cancelSearch()
  }
}
function save() {
  try {
    // Persist inputs and selections only; scores and coverage are recomputed on reopening.
    props.editor.updateCrraAssessment(
      schema.value,
      createCrraDraft({
        ...draft.value,
        selectedAvIds: vectors.value.map((av) => av.avId),
        selectedCmIds: solution.value.rows.map((cm) => cm.id),
      }),
    )
    saveMessage.value =
      'Analysis saved to the diagram. Save the diagram file to keep a portable copy.'
  } catch (error) {
    errorMessage.value = error.message || 'The analysis could not be saved.'
  }
}
function focusSearch() {
  nextTick(() => searchInput.value?.focus())
}
function handleHidden() {
  cancelSearch()
  snapshot.value = null
  triggerElement?.focus()
}
onMounted(() => {
  modalInstance = new Modal(modalElement.value)
  modalElement.value.addEventListener('shown.bs.modal', focusSearch)
  modalElement.value.addEventListener('hidden.bs.modal', handleHidden)
})
onBeforeUnmount(() => {
  cancelSearch()
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
      id="crraModal"
      ref="modalElement"
      class="modal"
      tabindex="-1"
      aria-labelledby="crra-title"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable crra-dialog">
        <div class="modal-content shadow">
          <div class="modal-header">
            <div>
              <h2 id="crra-title" class="modal-title fs-4">MITRE CRRA</h2>
              <p class="small text-muted mb-0">Cyber Risk Remediation Analysis · {{ schema }}</p>
            </div>
            <button
              type="button"
              class="btn-close"
              data-bs-dismiss="modal"
              aria-label="Close"
            ></button>
          </div>
          <div class="modal-body">
            <p v-if="!schemaMatches" class="alert alert-warning">
              The diagram language has changed. Close and reopen CRRA.
            </p>
            <p v-else-if="loading" role="status">Loading attack vectors…</p>
            <div v-else-if="error" class="alert alert-danger" role="alert">
              {{ error }}
              <button class="btn btn-sm btn-outline-danger" @click="$emit('retry')">Retry</button>
            </div>
            <template v-else>
              <nav class="d-flex flex-wrap gap-2 mb-3" aria-label="CRRA workflow">
                <button
                  v-for="step in [
                    { id: 'vectors', name: '1. Select AVs' },
                    { id: 'evaluate', name: '2. Evaluate CMs' },
                    { id: 'strategy', name: '3. Selection Strategy' },
                    { id: 'solution', name: '4. Solution Effectiveness Table' },
                  ]"
                  :key="step.id"
                  type="button"
                  class="btn btn-sm"
                  :class="tab === step.id ? 'btn-primary' : 'btn-outline-primary'"
                  :aria-current="tab === step.id ? 'step' : undefined"
                  @click="tab = step.id"
                >
                  {{ step.name }}
                </button>
              </nav>
              <div v-if="errorMessage" class="alert alert-danger small" role="alert">
                {{ errorMessage }}
              </div>
              <p v-if="saveMessage" class="alert alert-success small" role="status">
                {{ saveMessage }}
              </p>
              <section v-if="tab === 'vectors'" aria-label="Select attack vectors">
                <p class="small text-muted">
                  Select Technique-based AVs from the current Susceptibility Matrix. Scores retain
                  the maximum assessed Risk Score across Shopping Carts. A selected CM is evaluated
                  across these AVs for this diagram.
                </p>
                <div class="d-flex flex-wrap align-items-end gap-2 mb-3">
                  <div class="flex-grow-1">
                    <label for="crra-search" class="form-label small">Search attack vectors</label
                    ><input
                      id="crra-search"
                      ref="searchInput"
                      v-model="search"
                      type="search"
                      class="form-control"
                      placeholder="Technique ID or name"
                    />
                  </div>
                  <button
                    class="btn btn-outline-primary"
                    :disabled="!visibleVectors.length"
                    @click="selectVisible"
                  >
                    Select visible AVs</button
                  ><button class="btn btn-outline-secondary" @click="draft.selectedAvIds = []">
                    Clear AV selection</button
                  ><span class="badge text-bg-primary"
                    >{{ vectors.length }} selected / {{ matrix.rows.length }}</span
                  >
                </div>
                <p v-if="!matrix.rows.length" class="alert alert-info small">
                  No mapped, TTP-scored AVs. Complete asset assessments in CTSA and reopen CRRA.
                </p>
                <p v-if="matrix.unmappedSteps.length" class="alert alert-warning small">
                  {{ matrix.unmappedSteps.length }} assessed Attack Steps have no MITRE Technique
                  mapping. Review the MITRE unmapped list in CTSA; they cannot be selected as
                  Technique AVs.
                </p>
                <div class="table-responsive matrix-table-container">
                  <table class="table table-bordered table-hover align-middle mb-0 matrix-table">
                    <caption class="small">
                      Current Susceptibility Matrix ·
                      {{
                        matrix.columns.length
                      }}
                      Shopping Carts
                    </caption>
                    <thead class="table-light">
                      <tr>
                        <th scope="col" class="text-center text-nowrap">
                          <label
                            class="d-inline-flex align-items-center gap-2 mb-0"
                            title="Select or clear all attack vectors, including those hidden by search"
                          >
                            <input
                              class="form-check-input mt-0"
                              type="checkbox"
                              aria-label="Select all attack vectors"
                              :checked="allVectorsSelected"
                              :indeterminate.prop="vectors.length > 0 && !allVectorsSelected"
                              :disabled="!matrix.rows.length"
                              @change="toggleAllVectors($event.target.checked)"
                            />
                          </label>
                        </th>
                        <th scope="col" class="av-id-column">AV ID</th>
                        <th scope="col" class="vector-column">Attack Vector</th>
                        <th scope="col" class="text-center text-nowrap" aria-sort="descending">
                          Risk Score
                        </th>
                        <th
                          v-for="cart in matrix.columns"
                          :key="cart.id"
                          scope="col"
                          class="cart-column text-center"
                        >
                          <span class="d-block small text-muted fw-normal">Shopping Cart</span>
                          {{ cart.name }}
                          <span class="d-block small text-muted fw-normal">ID: {{ cart.id }}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="av in visibleVectors" :key="av.avId">
                        <td class="text-center">
                          <input
                            v-model="draft.selectedAvIds"
                            class="form-check-input"
                            type="checkbox"
                            :value="av.avId"
                            :aria-label="`Select ${av.avId}`"
                          />
                        </td>
                        <th scope="row" class="av-id-column fw-normal">{{ av.avId }}</th>
                        <td class="vector-column">{{ av.attackVector }}</td>
                        <td class="text-center">
                          <span
                            class="badge rounded-pill"
                            :class="riskScoreClass(av.riskScore)"
                            :aria-label="`Risk Score: ${riskScoreLabel(av.riskScore)}`"
                            >{{ riskScoreLabel(av.riskScore) }}</span
                          >
                        </td>
                        <td
                          v-for="cell in av.cells"
                          :key="cell.cartId"
                          class="text-center text-nowrap text-primary"
                          :class="{ 'matrix-hit': cell.riskScore !== null }"
                        >
                          {{ cell.label }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
              <template v-else>
                <p v-if="!vectors.length" class="alert alert-info">
                  Select at least one Attack Vector in step 1.
                </p>
                <p v-else-if="catalogLoading" role="status">Loading countermeasure mappings…</p>
                <div v-else-if="catalogError" class="alert alert-danger" role="alert">
                  {{ catalogError }}
                  <button class="btn btn-sm btn-outline-danger" @click="revision++">
                    Retry countermeasures
                  </button>
                </div>
                <template v-else>
                  <div v-if="catalog.mappingAvailable === false" class="alert alert-warning small">
                    This language schema has no MITRE mitigation catalog.
                  </div>
                  <div v-if="unmapped.length" class="alert alert-warning small">
                    No CM mapping: {{ unmapped.map((av) => av.avId).join(', ') }}. These AVs remain
                    in the solution table so their gaps are visible.
                  </div>
                  <section v-if="tab === 'evaluate'" aria-label="Evaluate countermeasures">
                    <p class="small text-muted">
                      P = Preventative; R = Responsive. Utility counts each effect type once per
                      selected AV. Confidence / level is displayed as evidence and does not multiply
                      Utility. D (Detect) is retained for reference and excluded from P/R scoring
                      and coverage. P and R weights default to 1 each. Available catalog costs
                      are prefilled and can be adjusted for this assessment.
                    </p>
                    <p v-if="catalog.missingFields?.length" class="alert alert-info small">
                      Missing catalog data: {{ catalog.missingFields.join(', ') }}. Enter assessment
                      values below; missing values are never filled automatically.
                    </p>
                    <div class="row g-2 mb-3">
                      <div v-for="type in ['P', 'R']" :key="type" class="col-sm-2">
                        <label :for="`crra-weight-${type}`" class="form-label small"
                          >{{ type }} weight</label
                        ><input
                          :id="`crra-weight-${type}`"
                          v-model.number="draft.weights[type]"
                          class="form-control"
                          type="number"
                          min="0"
                          step="any"
                          :placeholder="`Default: ${catalog.weights?.[type] ?? 1}`"
                        />
                      </div>
                      <div class="col-sm-4">
                        <label for="crra-sort" class="form-label small">Rank Countermeasures</label
                        ><select id="crra-sort" v-model="draft.sort" class="form-select">
                          <option value="ratio">U/C Ratio: High to low</option>
                          <option value="utility">Utility: High to low</option>
                          <option value="cost">Cost: Low to high</option>
                        </select>
                      </div>
                    </div>
                    <p class="small">
                      {{ candidates.length }} candidates ·
                      {{ candidates.filter((cm) => cm.eligible).length }} ready for automatic
                      selection. Missing scores sort last.
                    </p>
                    <CrraCandidateTable
                      :candidates="ranked"
                      :selected-ids="draft.selectedCmIds"
                      @edit="editCandidate"
                      @toggle="toggleCandidate"
                    />
                  </section>
                  <section v-else-if="tab === 'strategy'" aria-label="Selection Strategy">
                    <p class="small">
                      Set the minimum distinct CM count per AV risk band. Optional P and R minimums
                      default to no additional constraint. Risk bands use the existing Risk Score
                      thresholds. Requirements have no prefilled policy values.
                    </p>
                    <div class="table-responsive matrix-table-container mb-3">
                      <table
                        class="table table-bordered table-hover align-middle mb-0 matrix-table strategy-table"
                      >
                        <thead class="table-light">
                          <tr>
                            <th scope="col">Risk band</th>
                            <th scope="col">Minimum CM count</th>
                            <th scope="col">Minimum P (optional)</th>
                            <th scope="col">Minimum R (optional)</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="band in CRRA_RISK_BANDS" :key="band.id">
                            <th scope="row" class="fw-normal">
                              {{ band.label }}
                              <span class="d-block small text-muted">{{ band.range }}</span>
                            </th>
                            <td v-for="field in ['total', 'P', 'R']" :key="field">
                              <input
                                v-model.number="draft.strategy[band.id][field]"
                                type="number"
                                min="0"
                                step="1"
                                class="form-control"
                                :aria-label="`${band.label} minimum ${field}`"
                                :placeholder="
                                  field === 'total'
                                    ? 'Required for selected AVs'
                                    : '0 (no additional constraint)'
                                "
                              />
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <label for="crra-strategy-basis" class="form-label small"
                      >Selection Strategy basis / scope</label
                    ><textarea
                      id="crra-strategy-basis"
                      v-model="draft.strategyBasis"
                      class="form-control mb-3"
                      rows="2"
                    ></textarea>
                    <p class="small text-muted">
                      Automatic selection uses fully scored, applicable CMs only. It first visits
                      high-risk AVs in the chosen CM ranking, removes redundant CMs, then searches
                      for the fewest CMs satisfying the strategy. Equal-size sets are not compared
                      by total cost. A search limit is reported explicitly.
                    </p>
                    <div class="d-flex gap-2">
                      <button
                        class="btn btn-primary"
                        :disabled="solving || !vectors.length"
                        @click="selectAutomatically"
                      >
                        {{ solving ? 'Searching…' : 'Find minimum CM combination' }}</button
                      ><button
                        v-if="solving"
                        class="btn btn-outline-secondary"
                        @click="cancelSearch"
                      >
                        Cancel search
                      </button>
                    </div>
                  </section>
                  <section v-else aria-label="Solution Effectiveness Table">
                    <h3 class="fs-5">Solution Effectiveness Table</h3>
                    <p
                      v-if="selectionResult"
                      class="alert small"
                      :class="
                        selectionResult.status === 'optimal' ? 'alert-success' : 'alert-warning'
                      "
                      role="status"
                    >
                      {{ selectionResult.reason }}
                      <span v-if="selectionResult.visited"
                        >({{ selectionResult.visited }} search nodes)</span
                      >
                    </p>
                    <p v-else class="small text-muted">
                      Current manual / saved selection. Run automatic selection in step 3 to verify
                      a minimum combination.
                    </p>
                    <CrraSolutionTable :solution="solution" />
                  </section>
                </template>
              </template>
            </template>
          </div>
          <div class="modal-footer">
            <span class="small text-muted me-auto"
              >Use Save analysis to keep inputs and selections in this diagram.</span
            ><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button
            ><button
              class="btn btn-primary"
              :disabled="
                !editor ||
                !schemaMatches ||
                loading ||
                Boolean(error) ||
                catalogLoading ||
                Boolean(catalogError) ||
                solving
              "
              @click="save"
            >
              Save analysis
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped src="../assets/matrix-table.css"></style>

<style scoped>
.crra-dialog {
  width: calc(100% - 2rem);
  max-width: 1800px;
  margin-inline: auto;
}
.crra-workflow {
  position: sticky;
  top: -1rem;
  background: white;
  padding-block: 0.75rem;
  z-index: 3;
}
.strategy-table input {
  min-width: 145px;
}
</style>

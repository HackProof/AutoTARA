<script setup>
import { computed, ref, shallowRef, watch } from 'vue'
import {
  IMPACT_CATEGORIES,
  IMPACT_LEVELS,
  FEASIBILITY_LEVELS,
  createRiskAssessment,
  evaluateRiskAssessment,
} from '@/services/riskAssessment.js'
import { summarizeSimulationAfr } from '@/services/simulationResult.js'
import ScenarioEvidenceView from '@/components/ScenarioEvidenceView.vue'
import { downloadFile } from '@/services/drawio/xml.js'

const props = defineProps({
  result: { type: Object, required: true },
  reports: { type: Map, required: true },
  selectedKey: { type: String, default: '' },
})
const emit = defineEmits(['update:selectedKey', 'open-scenarios'])
const assessments = shallowRef(new Map())
const exportError = ref('')
const entries = computed(() =>
  [...props.reports].flatMap(([key, record]) => {
    const document = record.verified || record.draft
    return document?.scenario ? [{ key, record, document }] : []
  }),
)
const selected = computed(
  () => entries.value.find(({ key }) => key === props.selectedKey) || entries.value[0],
)
const scenario = computed(() => selected.value?.document.scenario)
const verification = computed(() => selected.value?.record.verified?.verification)
const candidateId = ref('')
const candidate = computed(
  () =>
    scenario.value?.Scenario_Candidates?.find((item) => item.Scenario_ID === candidateId.value) ||
    scenario.value?.Scenario_Candidates?.[0],
)
const assessmentKey = computed(() =>
  JSON.stringify([selected.value?.key, candidate.value?.Scenario_ID]),
)
const candidateReview = computed(() =>
  verification.value?.Candidate_Verifications?.find(
    (item) => item.Scenario_ID === candidate.value?.Scenario_ID,
  ),
)
const canAssess = computed(() =>
  Boolean(
    candidate.value?.Damage_Scenario &&
    verification.value?.Path_Structure_Valid !== false &&
    verification.value?.Overall_Verdict !== 'REJECT' &&
    candidateReview.value?.Verdict !== 'REJECT',
  ),
)
const afrResults = computed(() => summarizeSimulationAfr(props.result.graph))
const simulationAfr = computed(() =>
  afrResults.value.find((item) => item.target.id === selected.value?.record.input.graph.targetId),
)
const assessment = computed(() => {
  const saved = assessments.value.get(assessmentKey.value)
  return saved && saved.document === selected.value?.document
    ? saved.assessment
    : createRiskAssessment()
})
const evaluation = computed(() =>
  canAssess.value
    ? evaluateRiskAssessment(assessment.value, simulationAfr.value)
    : { impact: null, feasibility: null, risk: null },
)
const riskClass = computed(
  () =>
    ({
      Low: 'text-bg-success',
      Medium: 'text-bg-warning',
      High: 'text-bg-danger',
      Critical: 'text-bg-dark',
    })[evaluation.value.risk?.label] || 'text-bg-secondary',
)
const automaticFeasibility = computed(() =>
  simulationAfr.value?.status === 'complete'
    ? `${simulationAfr.value.label} (${simulationAfr.value.rating})`
    : 'Incomplete or unavailable',
)

function saveAssessment(value) {
  if (!selected.value || !candidate.value) return
  assessments.value = new Map(assessments.value).set(assessmentKey.value, {
    reportKey: selected.value.key,
    document: selected.value.document,
    assessment: value,
  })
}
function updateAssessment(changes) {
  saveAssessment({ ...assessment.value, ...changes, finalizedAt: null })
}
function setImpact(category, value) {
  updateAssessment({ impacts: { ...assessment.value.impacts, [category]: value } })
}
function setImpactNote(category, value) {
  updateAssessment({ impactNotes: { ...assessment.value.impactNotes, [category]: value } })
}
function finalize() {
  if (!evaluation.value.risk) return
  saveAssessment({ ...assessment.value, finalizedAt: new Date().toISOString() })
}
function exportReport() {
  if (!selected.value) return
  exportError.value = ''
  try {
    downloadFile(
      JSON.stringify(
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          ...selected.value.record,
          assessment: {
            ...assessment.value,
            scenarioId: candidate.value?.Scenario_ID || null,
            status: assessment.value.finalizedAt ? 'finalized' : 'draft',
            impactAggregation: 'maximum',
            impactRating: evaluation.value.impact,
            attackFeasibility: evaluation.value.feasibility,
            simulationAfr: simulationAfr.value,
            risk: evaluation.value.risk,
            formula: '1 + Attack Feasibility × Impact Rating',
          },
        },
        null,
        2,
      ),
      'tara-risk-report.json',
      'application/json',
    )
  } catch (cause) {
    exportError.value = cause.message || 'Could not download the report.'
  }
}

// Verification/regeneration changes the evidence. An assessment of the old
// scenario must never remain finalized against the replacement scenario.
watch(
  () => props.reports,
  () => {
    assessments.value = new Map(
      [...assessments.value].filter(([, saved]) => {
        const record = props.reports.get(saved.reportKey)
        return saved.document === (record?.verified || record?.draft)
      }),
    )
  },
  { flush: 'sync' },
)
watch(
  () => props.result,
  () => {
    assessments.value = new Map()
  },
  { flush: 'sync' },
)
watch(
  () => selected.value?.key,
  () => {
    exportError.value = ''
    candidateId.value = ''
  },
)
</script>

<template>
  <section class="risk-report border" aria-label="Report workspace">
    <header class="p-3 border-bottom">
      <div class="d-flex align-items-center flex-wrap gap-2">
        <h2 class="h5 mb-0">Report</h2>
        <span v-if="result.partial" class="badge text-bg-warning">Partial simulation</span>
        <button
          v-if="selected"
          type="button"
          class="btn btn-sm btn-outline-secondary ms-auto"
          @click="exportReport"
        >
          Download report JSON
        </button>
      </div>
      <p class="small text-secondary mt-2 mb-0">
        Review the scenario candidates and their shared MAL backbone, assess a candidate’s damage
        impact, then finalize its risk.
      </p>
    </header>
    <div class="report-content p-3" tabindex="0" aria-label="Risk assessment content">
      <div v-if="!selected" class="alert alert-light border" role="status">
        <h3 class="h6">No scenarios available</h3>
        <p>Generate scenarios in the Threat Scenario tab to start a report.</p>
        <button type="button" class="btn btn-primary" @click="emit('open-scenarios')">
          Open Threat Scenario
        </button>
      </div>
      <template v-else>
        <div v-if="exportError" class="alert alert-danger" role="alert">{{ exportError }}</div>
        <label for="risk-report-scenario" class="form-label fw-semibold">Scenario to assess</label>
        <select
          id="risk-report-scenario"
          class="form-select mb-3"
          :value="selected.key"
          @change="emit('update:selectedKey', $event.target.value)"
        >
          <option v-for="(entry, index) in entries" :key="entry.key" :value="entry.key">
            {{ index + 1 }}. {{ entry.document.scenario.Entry_Asset }} →
            {{ entry.document.scenario.Target_Asset }} · {{ entry.record.input.ciaAttribute }}
            {{ entry.record.input.context ? ` · ${entry.record.input.context}` : '' }}
          </option>
        </select>
        <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
          <h3 class="h6 mb-0">{{ scenario.Entry_Asset }} → {{ scenario.Target_Asset }}</h3>
          <span
            class="badge"
            :class="
              verification?.Overall_Verdict === 'REJECT' ? 'text-bg-danger' : 'text-bg-warning'
            "
          >
            {{
              verification
                ? `LLM review · ${verification.Overall_Verdict}`
                : 'LLM draft · verification pending'
            }}
          </span>
          <span class="badge text-bg-secondary">{{ selected.record.input.ciaAttribute }}</span>
        </div>
        <p class="small text-secondary report-text">
          {{ selected.document.model }} · {{ selected.document.createdAt }}
          <template v-if="selected.record.input.context">
            · {{ selected.record.input.context }}</template
          >
        </p>

        <ScenarioEvidenceView :scenario="scenario" :verification="verification" />
        <template v-if="scenario.Scenario_Candidates?.length">
          <label for="risk-report-candidate" class="form-label fw-semibold"
            >Candidate to assess</label
          >
          <select
            id="risk-report-candidate"
            :value="candidate?.Scenario_ID || ''"
            class="form-select mb-3"
            @change="candidateId = $event.target.value"
          >
            <option value="" disabled>Select candidate…</option>
            <option
              v-for="item in scenario.Scenario_Candidates"
              :key="item.Scenario_ID"
              :value="item.Scenario_ID"
            >
              {{ item.Scenario_ID }} · {{ item.CIA_Attribute }} · {{ item.Support_Level }}
            </option>
          </select>
          <p class="report-text">
            {{ candidate?.Damage_Scenario || 'Damage scenario undetermined' }}
          </p>
        </template>
        <p v-if="!canAssess" class="alert alert-light border" role="status">
          Risk assessment requires a damage scenario and a candidate that has not been rejected.
          Review the missing evidence and LLM findings before regenerating.
        </p>
        <template v-if="canAssess">
          <section class="mb-4" aria-labelledby="impact-rating-heading">
            <h3 id="impact-rating-heading" class="h6">Impact Rating</h3>
            <p id="impact-rating-help" class="small text-secondary">
              Assess the Damage Scenario in all four categories. The highest score determines the
              final Impact Rating for the selected candidate. Negligible (0), Moderate (1), Major
              (1.5), Severe (2).
            </p>
            <div class="table-responsive">
              <table class="table align-middle impact-table" aria-label="Damage impact assessment">
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Impact level</th>
                    <th scope="col">Assessment rationale</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="category in IMPACT_CATEGORIES" :key="category.name">
                    <th scope="row">
                      <label :for="`impact-${category.name}`">{{ category.name }}</label>
                      <p class="small text-secondary fw-normal mb-0">{{ category.description }}</p>
                    </th>
                    <td>
                      <select
                        :id="`impact-${category.name}`"
                        class="form-select form-select-sm"
                        :value="assessment.impacts[category.name] ?? ''"
                        aria-describedby="impact-rating-help"
                        @change="
                          setImpact(
                            category.name,
                            $event.target.value === '' ? null : Number($event.target.value),
                          )
                        "
                      >
                        <option value="">Select impact…</option>
                        <option
                          v-for="level in IMPACT_LEVELS"
                          :key="level.label"
                          :value="level.score"
                        >
                          {{ level.label }} ({{ level.score }})
                        </option>
                      </select>
                    </td>
                    <td>
                      <textarea
                        class="form-control form-control-sm"
                        rows="2"
                        :aria-label="`${category.name} assessment rationale`"
                        placeholder="Evidence or rationale (optional)"
                        :value="assessment.impactNotes[category.name]"
                        @input="setImpactNote(category.name, $event.target.value)"
                      ></textarea>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="fw-semibold" aria-live="polite">
              Final Impact Rating:
              {{
                evaluation.impact
                  ? `${evaluation.impact.label} (${evaluation.impact.score})`
                  : 'Awaiting all four ratings'
              }}
            </p>
          </section>

          <section class="mb-4" aria-labelledby="report-afr-heading">
            <h3 id="report-afr-heading" class="h6">Attack Feasibility</h3>
            <p id="report-afr-help" class="small text-secondary">
              Attack Path rating for this Target: {{ automaticFeasibility }}. This includes its
              compromised predecessors and performed alternatives. A complete rating is used
              automatically; you can select a final rating manually. Very Low (0), Low (1), Medium
              (1.5), High (2).
            </p>
            <div class="row g-3">
              <div class="col-md-5">
                <label for="report-afr" class="form-label">Final Attack Feasibility</label>
                <select
                  id="report-afr"
                  class="form-select"
                  :value="assessment.feasibility"
                  aria-describedby="report-afr-help"
                  @change="updateAssessment({ feasibility: $event.target.value })"
                >
                  <option value="simulation">
                    Use Attack Path rating · {{ automaticFeasibility }}
                  </option>
                  <option
                    v-for="level in FEASIBILITY_LEVELS"
                    :key="level.label"
                    :value="level.label"
                  >
                    {{ level.label }} ({{ level.score }}) · Manual
                  </option>
                </select>
              </div>
              <div class="col-md-7">
                <label for="report-afr-note" class="form-label"
                  >Feasibility rationale (optional)</label
                >
                <textarea
                  id="report-afr-note"
                  class="form-control"
                  rows="2"
                  :value="assessment.feasibilityNote"
                  @input="updateAssessment({ feasibilityNote: $event.target.value })"
                ></textarea>
              </div>
            </div>
          </section>

          <section class="card bg-body-tertiary" aria-labelledby="risk-value-heading">
            <div class="card-body">
              <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                <h3 id="risk-value-heading" class="h6 mb-0">Risk Value</h3>
                <span
                  class="badge"
                  :class="assessment.finalizedAt ? 'text-bg-success' : 'text-bg-secondary'"
                  >{{ assessment.finalizedAt ? 'Finalized' : 'Draft assessment' }}</span
                >
              </div>
              <p class="small mb-2">Risk Value = 1 + Attack Feasibility × Impact Rating</p>
              <div aria-live="polite" aria-atomic="true">
                <p v-if="evaluation.risk" class="fs-5 fw-semibold">
                  1 + {{ evaluation.feasibility.score }} × {{ evaluation.impact.score }} =
                  {{ evaluation.risk.value }}
                  <span class="badge ms-2" :class="riskClass">{{ evaluation.risk.label }}</span>
                </p>
                <p v-else class="text-secondary">
                  <template v-if="!evaluation.impact"
                    >Select an impact level for all four categories.
                  </template>
                  <template v-if="!evaluation.feasibility"
                    >Complete the Target's Attack Feasibility assessment or select a manual
                    rating.</template
                  >
                </p>
              </div>
              <p class="small text-secondary">
                Low [1, 2.5) · Medium [2.5, 3.25) · High [3.25, 5) · Critical {5}
              </p>
              <button
                type="button"
                class="btn btn-primary"
                :disabled="!evaluation.risk || Boolean(assessment.finalizedAt)"
                @click="finalize"
              >
                {{ assessment.finalizedAt ? 'Risk finalized' : 'Finalize Risk Value' }}
              </button>
              <p v-if="assessment.finalizedAt" class="small text-secondary mt-2 mb-0" role="status">
                Finalized {{ assessment.finalizedAt }}. Changing the assessment requires
                finalization again.
              </p>
            </div>
          </section>
        </template>
        <p class="small text-secondary mt-3 mb-0">
          Assessments remain available while switching tabs in this simulation session. Download the
          report to keep a copy before editing the diagram, resetting the simulation or leaving this
          page. Regenerating or verifying a scenario clears its previous assessment.
        </p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.risk-report {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}
.report-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.report-content:focus-visible {
  outline: 2px solid #9ec5fe;
  outline-offset: -2px;
}
.report-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.impact-table {
  min-width: 620px;
}
.impact-table th:first-child {
  width: 30%;
}
.impact-table td:nth-child(2) {
  width: 25%;
}
</style>

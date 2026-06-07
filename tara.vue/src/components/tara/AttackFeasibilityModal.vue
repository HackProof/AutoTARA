<template>
  <div v-if="show" class="modal-backdrop" @click.self="cancel">
    <div class="attack-feasibility-modal">
      <div class="modal-header">
        <div>
          <h5 class="modal-title mb-1">Attack Feasibility</h5>
          <div class="small text-muted">
            {{ assessmentRow?.attackPathLabel || 'Attack Path' }}
          </div>
        </div>
        <button type="button" class="btn-close" @click="cancel"></button>
      </div>

      <div class="modal-body">
        <div v-if="assessmentRow" class="d-grid gap-3">
          <div class="summary-strip">
            <div>
              <div class="summary-label">Final Value</div>
              <div class="summary-value">{{ formatNumber(totalScore) }}</div>
            </div>
            <div>
              <div class="summary-label">Matched Steps</div>
              <div class="summary-value">
                {{ autoCalculation.matchedSteps.length }}/{{ autoCalculation.sourceStepCount }}
              </div>
            </div>
          </div>

          <div v-if="legacyLabel" class="alert alert-secondary py-2 mb-0">
            Previously saved value: {{ legacyLabel }}
          </div>

          <div class="score-grid">
            <div class="score-card">
              <div class="score-card-header">
                <div>
                  <div class="score-card-title">Elapsed time</div>
                  <div class="score-card-hint">Average TTC across shortest path steps</div>
                </div>
                <button type="button" class="btn btn-sm btn-outline-secondary" @click="applyAutoField('elapsed_time')">
                  Apply Auto
                </button>
              </div>
              <input v-model="form.elapsed_time" type="number" step="0.01" min="0" class="form-control" />
              <div class="small text-muted mt-1">Auto: {{ formatMaybe(autoCalculation.elapsed_time) }}</div>
            </div>

            <div class="score-card">
              <div class="score-card-header">
                <div>
                  <div class="score-card-title">Specialist expertise</div>
                  <div class="score-card-hint">Average of `(weight * value)` for Required Skills</div>
                </div>
                <button type="button" class="btn btn-sm btn-outline-secondary" @click="applyAutoField('specialist_expertise')">
                  Apply Auto
                </button>
              </div>
              <input v-model="form.specialist_expertise" type="number" step="0.01" min="0" class="form-control" />
              <div class="small text-muted mt-1">Auto: {{ formatMaybe(autoCalculation.specialist_expertise) }}</div>
            </div>

            <div class="score-card">
              <div class="score-card-header">
                <div>
                  <div class="score-card-title">Knowledge of the item or component</div>
                  <div class="score-card-hint">User assessment</div>
                </div>
              </div>
              <input v-model="form.knowledge_of_item_or_component" type="number" step="0.01" min="0" class="form-control" />
            </div>

            <div class="score-card">
              <div class="score-card-header">
                <div>
                  <div class="score-card-title">Windows of opportunity</div>
                  <div class="score-card-hint">User assessment</div>
                </div>
              </div>
              <input v-model="form.windows_of_opportunity" type="number" step="0.01" min="0" class="form-control" />
            </div>

            <div class="score-card">
              <div class="score-card-header">
                <div>
                  <div class="score-card-title">Equipment</div>
                  <div class="score-card-hint">Average of `(weight * value)` for Required Resources</div>
                </div>
                <button type="button" class="btn btn-sm btn-outline-secondary" @click="applyAutoField('equipment')">
                  Apply Auto
                </button>
              </div>
              <input v-model="form.equipment" type="number" step="0.01" min="0" class="form-control" />
              <div class="small text-muted mt-1">Auto: {{ formatMaybe(autoCalculation.equipment) }}</div>
            </div>
          </div>

          <div class="d-flex justify-content-end">
            <button type="button" class="btn btn-outline-primary btn-sm" @click="applyAllAutoFields">
              Apply All Auto Values
            </button>
          </div>

          <div>
            <div class="section-title">Auto Calculation Breakdown</div>
            <div v-if="autoCalculation.matchedSteps.length > 0" class="table-responsive">
              <table class="table table-sm table-bordered align-middle mb-0">
                <thead class="table-light">
                  <tr>
                    <th>Step</th>
                    <th>Threat</th>
                    <th class="text-end">TTC</th>
                    <th class="text-end">Required Skills</th>
                    <th class="text-end">Required Resources</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="step in autoCalculation.matchedSteps" :key="step.key">
                    <td>{{ step.stepLabel }}</td>
                    <td>{{ step.threatName }}</td>
                    <td class="text-end">{{ formatMaybe(step.elapsed_time) }}</td>
                    <td class="text-end">{{ formatMaybe(step.specialist_expertise) }}</td>
                    <td class="text-end">{{ formatMaybe(step.equipment) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="text-muted small">
              No CTSA threat data matched the shortest path.
            </div>
          </div>

          <div v-if="autoCalculation.unresolvedSteps.length > 0">
            <div class="section-title">Unresolved Steps</div>
            <ul class="small mb-0">
              <li v-for="step in autoCalculation.unresolvedSteps" :key="step.key">
                {{ step.stepLabel }}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" @click="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" @click="save">Save</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, watch } from 'vue';
import { useThreatModelStore } from '@/stores/threatModelStore.js';

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  assessmentRow: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['save', 'cancel']);
const tmStore = useThreatModelStore();

const form = reactive({
  elapsed_time: '',
  specialist_expertise: '',
  knowledge_of_item_or_component: '',
  windows_of_opportunity: '',
  equipment: ''
});

const sourcePathSteps = computed(() => {
  const steps = props.assessmentRow?.parsed_attack_path?.source_shortest_path;
  return Array.isArray(steps) ? steps : [];
});

const threatIndex = computed(() => buildThreatIndex(tmStore));

const autoCalculation = computed(() =>
  calculateAutoAssessment(sourcePathSteps.value, threatIndex.value)
);

const parsedAttackFeasibility = computed(() =>
  parseAttackFeasibilityValue(props.assessmentRow?.attack_feasibility)
);

const legacyLabel = computed(() =>
  parsedAttackFeasibility.value?.legacyLabel || ''
);

const totalScore = computed(() =>
  roundNumber(
    toNumber(form.elapsed_time) +
    toNumber(form.specialist_expertise) +
    toNumber(form.knowledge_of_item_or_component) +
    toNumber(form.windows_of_opportunity) +
    toNumber(form.equipment)
  )
);

watch(
  () => [props.show, props.assessmentRow?.rowKey, props.assessmentRow?.attack_feasibility],
  ([isVisible]) => {
    if (!isVisible) return;
    initializeForm();
  },
  { immediate: true }
);

function initializeForm() {
  const parsed = parsedAttackFeasibility.value;
  const details = parsed?.details || {};

  form.elapsed_time = toInputValue(details.elapsed_time, autoCalculation.value.elapsed_time);
  form.specialist_expertise = toInputValue(details.specialist_expertise, autoCalculation.value.specialist_expertise);
  form.knowledge_of_item_or_component = toInputValue(details.knowledge_of_item_or_component, '');
  form.windows_of_opportunity = toInputValue(details.windows_of_opportunity, '');
  form.equipment = toInputValue(details.equipment, autoCalculation.value.equipment);
}

function applyAutoField(field) {
  if (field === 'elapsed_time') {
    form.elapsed_time = toInputValue(autoCalculation.value.elapsed_time, '');
  }

  if (field === 'specialist_expertise') {
    form.specialist_expertise = toInputValue(autoCalculation.value.specialist_expertise, '');
  }

  if (field === 'equipment') {
    form.equipment = toInputValue(autoCalculation.value.equipment, '');
  }
}

function applyAllAutoFields() {
  applyAutoField('elapsed_time');
  applyAutoField('specialist_expertise');
  applyAutoField('equipment');
}

function save() {
  emit('save', JSON.stringify({
    version: 1,
    total: totalScore.value,
    details: {
      elapsed_time: toNullableNumber(form.elapsed_time),
      specialist_expertise: toNullableNumber(form.specialist_expertise),
      knowledge_of_item_or_component: toNullableNumber(form.knowledge_of_item_or_component),
      windows_of_opportunity: toNullableNumber(form.windows_of_opportunity),
      equipment: toNullableNumber(form.equipment)
    },
    auto_calculated: {
      elapsed_time: autoCalculation.value.elapsed_time,
      specialist_expertise: autoCalculation.value.specialist_expertise,
      equipment: autoCalculation.value.equipment,
      source_step_count: autoCalculation.value.sourceStepCount,
      matched_step_count: autoCalculation.value.matchedSteps.length,
      unresolved_steps: autoCalculation.value.unresolvedSteps.map((item) => item.stepLabel)
    }
  }));
}

function cancel() {
  emit('cancel');
}

function calculateAutoAssessment(pathSteps, index) {
  const matchedSteps = [];
  const unresolvedSteps = [];

  (Array.isArray(pathSteps) ? pathSteps : []).forEach((step, indexInPath) => {
    const assetName = displayValue(step?.assetName);
    const attackStep = displayValue(step?.attackStep);
    const stepLabel = [assetName, attackStep].filter(Boolean).join(':');

    if (!normalizeValue(assetName) || !normalizeValue(attackStep)) {
      unresolvedSteps.push({
        key: `${indexInPath}-${stepLabel || 'unknown'}`,
        stepLabel: stepLabel || `Step ${indexInPath + 1}`
      });
      return;
    }

    const match = pickThreatCandidate(index.get(buildThreatKey(assetName, attackStep)) || []);
    if (!match) {
      unresolvedSteps.push({
        key: `${indexInPath}-${stepLabel}`,
        stepLabel
      });
      return;
    }

    matchedSteps.push({
      key: `${indexInPath}-${stepLabel}`,
      stepLabel,
      threatName: match.threatName,
      elapsed_time: match.elapsed_time,
      specialist_expertise: match.specialist_expertise,
      equipment: match.equipment
    });
  });

  return {
    sourceStepCount: Array.isArray(pathSteps) ? pathSteps.length : 0,
    matchedSteps,
    unresolvedSteps,
    elapsed_time: averageNumbers(matchedSteps.map((item) => item.elapsed_time)),
    specialist_expertise: averageNumbers(matchedSteps.map((item) => item.specialist_expertise)),
    equipment: averageNumbers(matchedSteps.map((item) => item.equipment))
  };
}

function buildThreatIndex(store) {
  const index = new Map();
  const seen = new Set();

  collectDiagramCandidates(store).forEach((diagram) => {
    const cells = Array.isArray(diagram?.cells) ? diagram.cells : [];

    cells.forEach((cell) => {
      const cellData = cell?.data || {};
      const assetName = normalizeValue(cellData?.name || cellData?.label);
      const threats = Array.isArray(cellData?.threats) ? cellData.threats : [];

      if (!assetName || threats.length === 0) {
        return;
      }

      threats.forEach((threat, threatIndex) => {
        const labels = [threat?.attackStep, threat?.technique]
          .map((value) => normalizeValue(value))
          .filter(Boolean);

        if (labels.length === 0) {
          return;
        }

        const candidate = {
          threatId: threat?.id || `${cell?.id || assetName}-${threatIndex}`,
          threatName: threat?.attackStep || threat?.technique || 'Unknown Threat',
          status: normalizeValue(threat?.status),
          elapsed_time: toFiniteOrNull(threat?.ttc),
          specialist_expertise: resolveWeightedScore(threat?.ttp_score, 'Required Skills'),
          equipment: resolveWeightedScore(threat?.ttp_score, 'Required Resources')
        };

        labels.forEach((label) => {
          const key = buildThreatKey(assetName, label);
          const uniqueKey = `${key}|${candidate.threatId}`;
          if (seen.has(uniqueKey)) {
            return;
          }
          seen.add(uniqueKey);

          if (!index.has(key)) {
            index.set(key, []);
          }
          index.get(key).push(candidate);
        });
      });
    });
  });

  return index;
}

function collectDiagramCandidates(store) {
  const candidates = [];

  if (store?.modifiedDiagram?.cells) {
    candidates.push(store.modifiedDiagram);
  }

  const diagrams = store?.data?.diagrams || {};
  Object.values(diagrams).forEach((diagram) => {
    if (diagram?.cells) {
      candidates.push(diagram);
    }
  });

  return candidates;
}

function pickThreatCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  return candidates
    .slice()
    .sort((left, right) => {
      const leftOpen = left.status === 'open' ? 1 : 0;
      const rightOpen = right.status === 'open' ? 1 : 0;
      if (leftOpen !== rightOpen) {
        return rightOpen - leftOpen;
      }

      const leftTtc = Number.isFinite(left.elapsed_time) ? left.elapsed_time : Number.POSITIVE_INFINITY;
      const rightTtc = Number.isFinite(right.elapsed_time) ? right.elapsed_time : Number.POSITIVE_INFINITY;
      return leftTtc - rightTtc;
    })[0];
}

function resolveWeightedScore(ttpScore, targetKey) {
  if (Array.isArray(ttpScore)) {
    const matched = ttpScore.find((item) => normalizeValue(item?.key) === normalizeValue(targetKey));
    if (!matched) return null;
    const value = toFiniteOrNull(matched?.value);
    const weight = toFiniteOrNull(matched?.weight);
    if (value === null || weight === null) return null;
    return roundNumber(value * weight);
  }

  if (ttpScore && typeof ttpScore === 'object') {
    const direct = ttpScore[targetKey];
    if (direct && typeof direct === 'object') {
      const value = toFiniteOrNull(direct?.value);
      const weight = toFiniteOrNull(direct?.weight);
      if (value === null || weight === null) return null;
      return roundNumber(value * weight);
    }
  }

  return null;
}

function parseAttackFeasibilityValue(value) {
  if (!value) return null;

  if (typeof value === 'object') {
    return normalizeAttackFeasibilityPayload(value);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return normalizeAttackFeasibilityPayload(JSON.parse(trimmed));
  } catch (_) {
    return {
      legacyLabel: trimmed,
      total: null,
      details: {}
    };
  }
}

function normalizeAttackFeasibilityPayload(value) {
  const details = value?.details || {};

  return {
    legacyLabel: '',
    total: toFiniteOrNull(value?.total),
    details: {
      elapsed_time: toFiniteOrNull(details?.elapsed_time),
      specialist_expertise: toFiniteOrNull(details?.specialist_expertise),
      knowledge_of_item_or_component: toFiniteOrNull(details?.knowledge_of_item_or_component),
      windows_of_opportunity: toFiniteOrNull(details?.windows_of_opportunity),
      equipment: toFiniteOrNull(details?.equipment)
    }
  };
}

function buildThreatKey(assetName, attackStep) {
  return `${normalizeValue(assetName)}::${normalizeValue(attackStep)}`;
}

function averageNumbers(values) {
  const normalized = values.filter((value) => Number.isFinite(value));
  if (normalized.length === 0) {
    return null;
  }

  const sum = normalized.reduce((acc, value) => acc + value, 0);
  return roundNumber(sum / normalized.length);
}

function toFiniteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toNullableNumber(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  return roundNumber(toNumber(value));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toInputValue(primary, fallback) {
  if (primary !== null && primary !== undefined && primary !== '') {
    return String(primary);
  }

  if (fallback !== null && fallback !== undefined && fallback !== '') {
    return String(fallback);
  }

  return '';
}

function roundNumber(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function displayValue(value) {
  return String(value || '').trim();
}

function formatMaybe(value) {
  return value === null || value === undefined ? '-' : formatNumber(value);
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.00';
  return number.toFixed(2);
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1080;
  padding: 1rem;
}

.attack-feasibility-modal {
  width: min(960px, 100%);
  max-height: min(90vh, 900px);
  overflow: hidden;
  background: #fff;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.2);
}

.modal-header,
.modal-footer {
  padding: 1rem 1.25rem;
  border-bottom: 1px solid #e9ecef;
}

.modal-footer {
  border-top: 1px solid #e9ecef;
  border-bottom: 0;
  justify-content: flex-end;
  gap: 0.5rem;
}

.modal-body {
  padding: 1.25rem;
  overflow-y: auto;
}

.summary-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.summary-strip > div {
  padding: 0.85rem 1rem;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  background: #f8f9fa;
}

.summary-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #6c757d;
  margin-bottom: 0.25rem;
}

.summary-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: #212529;
}

.score-grid {
  display: grid;
  gap: 0.75rem;
}

.score-card {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 0.9rem;
}

.score-card-header {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.score-card-title {
  font-weight: 600;
}

.score-card-hint {
  font-size: 0.78rem;
  color: #6c757d;
}

.section-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: #6c757d;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
}

@media (min-width: 768px) {
  .score-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .score-grid > :last-child {
    grid-column: 1 / -1;
  }
}
</style>

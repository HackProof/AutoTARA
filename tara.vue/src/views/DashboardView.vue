<template>
  <div class="container-fluid py-4">
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h2 class="fw-bold mb-0">TARA Assessment Dashboard</h2>
      <div class="d-flex gap-2">
        <router-link to="/" class="btn btn-outline-secondary">
          <i class="fa-solid fa-home"></i> Home
        </router-link>
      </div>
    </div>

    <div v-if="store.error" class="alert alert-danger alert-dismissible fade show" role="alert">
      {{ store.error }}
      <button type="button" class="btn-close" @click="store.error = null"></button>
    </div>

    <div v-if="store.isLoading && sessions.length === 0" class="text-center py-5">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      <p class="mt-2 text-muted">Loading sessions...</p>
    </div>

    <div v-else-if="sessions.length > 0" class="row g-4">
      <div class="col-12 col-lg-4 col-xl-3">
        <div class="border rounded bg-white overflow-hidden session-sidebar">
          <div class="px-3 py-2 border-bottom fw-semibold">
            Simulation Sessions
          </div>
          <div class="list-group list-group-flush">
            <button
              v-for="session in sessions"
              :key="session.sessionId"
              type="button"
              class="list-group-item list-group-item-action text-start"
              :class="{ active: session.sessionId === selectedSessionId }"
              @click="selectedSessionId = session.sessionId"
            >
              <div class="d-flex justify-content-between align-items-start gap-2">
                <div class="fw-semibold small text-break">{{ session.sessionId }}</div>
                <span
                  class="badge flex-shrink-0"
                  :class="session.hasAnalysis ? 'bg-success' : 'bg-warning text-dark'"
                >
                  {{ session.hasAnalysis ? 'Expanded' : 'Shortest Path Ready' }}
                </span>
              </div>
              <div class="small opacity-75 mt-1">
                {{ formatDate(session.createdAt) }}
              </div>
              <div class="small mt-1">
                {{ session.entryAsset || 'Unknown' }} -> {{ session.targetAsset || 'Unknown' }}
              </div>
              <div class="small opacity-75">
                {{ session.assessmentCount }} assessment<span v-if="session.assessmentCount > 1">s</span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <div class="col-12 col-lg-8 col-xl-9">
        <template v-if="selectedSessionSummary">
          <div class="border rounded bg-white mb-4">
            <div class="px-3 py-3 border-bottom">
              <div class="d-flex flex-wrap justify-content-between align-items-start gap-3">
                <div>
                  <div class="small text-muted">Selected Session</div>
                  <div class="fw-semibold text-break">{{ selectedSessionSummary.sessionId }}</div>
                  <div class="small text-muted mt-1">
                    {{ formatDate(selectedSessionSummary.createdAt) }}
                  </div>
                </div>

                <div class="d-flex flex-wrap gap-2">
                  <button
                    v-if="canExpandSelectedSession"
                    class="btn btn-primary"
                    @click="expandSelectedSessionAttackPaths"
                    :disabled="isExpandingSelectedSession || isDeletingSelectedSession"
                  >
                    <span
                      v-if="isExpandingSelectedSession"
                      class="spinner-border spinner-border-sm me-1"
                      role="status"
                    ></span>
                    <i v-else class="fa-solid fa-wand-magic-sparkles me-1"></i>
                    {{ selectedSessionSummary.hasAnalysis ? 'Rebuild Expanded Attack Paths' : 'Expand Attack Paths' }}
                  </button>
                  <button
                    class="btn btn-outline-danger"
                    @click="deleteSelectedSession"
                    :disabled="isDeletingSelectedSession || isExpandingSelectedSession"
                  >
                    <span
                      v-if="isDeletingSelectedSession"
                      class="spinner-border spinner-border-sm me-1"
                      role="status"
                    ></span>
                    <i v-else class="fa-solid fa-trash me-1"></i>
                    Delete Session
                  </button>
                </div>
              </div>
            </div>

            <div class="p-3">
              <div class="row g-3 mb-4">
                <div class="col-md-4">
                  <div class="small text-muted">Entry Asset</div>
                  <div class="fw-semibold">{{ selectedSessionSummary.entryAsset || 'Unknown' }}</div>
                </div>
                <div class="col-md-4">
                  <div class="small text-muted">Target Asset</div>
                  <div class="fw-semibold">{{ selectedSessionSummary.targetAsset || 'Unknown' }}</div>
                </div>
                <div class="col-md-4">
                  <div class="small text-muted">Status</div>
                  <span class="badge" :class="selectedSessionSummary.hasAnalysis ? 'bg-success' : 'bg-warning text-dark'">
                    {{ selectedSessionSummary.hasAnalysis ? 'Expanded' : 'Shortest Path Ready' }}
                  </span>
                </div>
              </div>

              <div class="mb-4">
                <details class="collapsible-section">
                  <summary class="h5 mb-0 py-1">
                    <span>Shortest Path</span>
                  </summary>

                  <div class="pt-3">
                    <div v-if="shortestPathSteps.length > 0" class="list-group">
                      <div
                        v-for="(step, idx) in shortestPathSteps"
                        :key="`shortest-${idx}`"
                        class="list-group-item"
                      >
                        <span class="badge bg-primary me-2">{{ step.step || idx + 1 }}</span>
                        <strong>{{ step.assetName }}</strong>
                        <span class="text-muted ms-1">: {{ step.attackStep }}</span>
                      </div>
                    </div>
                    <div v-else class="text-muted small">
                      No shortest path data available.
                    </div>
                  </div>
                </details>
              </div>

              <div class="mb-3">
                <h5 class="mb-3">Expanded Attack Paths</h5>

                <div v-if="generatedPathEntries.length > 0" class="path-accordion d-grid gap-2">
                  <details
                    v-for="(path, pathIndex) in generatedPathEntries"
                    :key="path.key"
                    class="border rounded bg-light-subtle"
                  >
                    <summary class="d-flex flex-wrap justify-content-between align-items-center gap-2 px-3 py-3">
                      <div class="d-flex flex-wrap gap-2 align-items-center">
                        <span class="fw-semibold">{{ path.label }}</span>
                        <span class="badge bg-secondary">{{ path.value.Realism_Assessment || 'N/A' }}</span>
                        <span class="badge bg-primary">Score {{ path.value.Completeness_Score_1to5 || '-' }}/5</span>
                        <span class="badge text-bg-light border">
                          {{ expandedPathSteps(path).length }} step<span v-if="expandedPathSteps(path).length !== 1">s</span>
                        </span>
                      </div>
                    </summary>

                    <div class="px-3 pb-3">
                      <div class="small text-muted mb-1">Rewritten Attack Path</div>
                      <div v-if="expandedPathSteps(path).length > 0" class="mb-3">
                        <div
                          v-for="step in expandedPathSteps(path)"
                          :key="`${path.key}-rewritten-${step.label}`"
                          class="rewritten-step py-2"
                        >
                          <div class="d-flex align-items-start gap-2">
                            <span class="badge bg-primary flex-shrink-0 mt-1">({{ step.label }})</span>
                            <div class="flex-grow-1">
                              <div>{{ step.text }}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <p v-else class="mb-3 path-text">{{ path.value.Rewritten_Attack_Path || 'N/A' }}</p>

                      <!-- <div v-if="path.value.Missing_Steps?.length" class="mb-3">
                        <div class="small text-muted mb-1">Missing Steps</div>
                        <ul class="mb-0 small">
                          <li v-for="(item, idx) in path.value.Missing_Steps" :key="`${path.key}-missing-${idx}`">
                            {{ item }}
                          </li>
                        </ul>
                      </div> -->

                      <div v-if="path.value.Key_Assumptions?.length" class="mb-3">
                        <div class="small text-muted mb-1">Key Assumptions</div>
                        <ul class="mb-0 small">
                          <li v-for="(item, idx) in path.value.Key_Assumptions" :key="`${path.key}-assumption-${idx}`">
                            {{ item }}
                          </li>
                        </ul>
                      </div>

                      <div v-if="path.value.Evidence_Needed?.length">
                        <div class="small text-muted mb-1">Evidence Needed</div>
                        <ul class="mb-0 small">
                          <li v-for="(item, idx) in path.value.Evidence_Needed" :key="`${path.key}-evidence-${idx}`">
                            {{ item }}
                          </li>
                        </ul>
                      </div>
                    </div>
                  </details>
                </div>

                <div v-else class="text-muted small">
                  <span v-if="canExpandSelectedSession">
                    Click `Expand Attack Paths` to send this session's shortest path to Gemini.
                  </span>
                  <span v-else>
                    No expanded attack path data available.
                  </span>
                </div>
              </div>

              <div v-if="scenarioLinkageCheck" class="border-top pt-3">
                <h5 class="mb-2">Scenario Linkage Check</h5>
                <div class="d-flex flex-wrap gap-2 mb-2 small">
                  <span class="badge bg-dark">
                    Damage-Threat: {{ scenarioLinkageCheck.Damage_to_Threat_Consistency || 'N/A' }}
                  </span>
                  <span class="badge bg-dark">
                    Threat-Path: {{ scenarioLinkageCheck.Threat_to_AttackPath_Consistency || 'N/A' }}
                  </span>
                  <span class="badge bg-dark">
                    CIA: {{ scenarioLinkageCheck.CIA_Consistency || 'N/A' }}
                  </span>
                </div>
                <ul v-if="Array.isArray(scenarioLinkageCheck.Notes) && scenarioLinkageCheck.Notes.length > 0" class="mb-0 small">
                  <li v-for="(note, idx) in scenarioLinkageCheck.Notes" :key="`scenario-note-${idx}`">
                    {{ note }}
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div class="border rounded bg-white overflow-hidden">
            <div class="px-3 py-2 border-bottom fw-semibold">
              Session Assessments
            </div>

            <div v-if="selectedSessionAssessmentGroups.length > 0" class="table-responsive">
              <table class="table table-bordered table-hover align-middle mb-0 assessment-table">
                <thead class="table-dark">
                  <tr>
                    <th style="width: 88px">#</th>
                    <th>Target Asset</th>
                    <th class="cia-column">CIA</th>
                    <th>Damage Scenario</th>
                    <th class="impact-column">Impact</th>
                    <th>Threat Scenario</th>
                    <th class="attack-path-column">Attack Path</th>
                    <th class="assessment-panel-column">Assessment</th>
                    <th class="actions-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="group in selectedSessionAssessmentGroups" :key="group.groupKey">
                    <tr
                      v-for="(row, rowIndex) in group.rows"
                      :key="row.rowKey"
                      :class="{ 'group-divider': rowIndex === 0 && group.displayIndex > 1 }"
                    >
                      <td v-if="rowIndex === 0" :rowspan="group.rowSpan" class="align-top">
                        <div class="fw-semibold">{{ group.displayIndex }}</div>
                        <div class="small text-muted">{{ formatDate(group.createdAt) }}</div>
                      </td>
                      <td v-if="rowIndex === 0" :rowspan="group.rowSpan" class="align-top">
                        {{ group.target_asset }}
                      </td>
                      <td v-if="rowIndex === 0" :rowspan="group.rowSpan" class="align-top cia-cell">
                        <span class="badge compact-badge" :class="ciaBadgeClass(group.cia_attribute)">
                          {{ group.cia_attribute }}
                        </span>
                      </td>
                      <td
                        v-if="rowIndex === 0"
                        :rowspan="group.rowSpan"
                        class="align-top"
                        style="max-width: 200px"
                        :title="group.damage_scenario"
                      >
                        {{ group.damage_scenario }}
                      </td>
                      <td v-if="rowIndex === 0" :rowspan="group.rowSpan" class="align-top impact-cell">
                        <span class="badge bg-secondary compact-badge">{{ group.impact_category }}</span>
                      </td>
                      <td
                        v-if="rowIndex === 0"
                        :rowspan="group.rowSpan"
                        class="align-top"
                        style="max-width: 220px"
                        :title="group.threat_scenario"
                      >
                        {{ group.threat_scenario }}
                      </td>
                      <td class="align-top">
                        <div class="attack-path-inline">
                          <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                            <span class="badge text-bg-light border">{{ row.attackPathLabel }}</span>
                            <span class="badge bg-secondary">{{ row.attackPathRealism }}</span>
                            <span class="badge bg-primary">Score {{ row.attackPathScore }}/5</span>
                          </div>
                          <div v-if="row.attackPathSteps.length > 0" class="attack-path-steps">
                            <div
                              v-for="step in row.attackPathSteps"
                              :key="`${row.rowKey}-${step.label}`"
                              class="attack-path-step"
                            >
                              <span class="attack-path-step-label">({{ step.label }})</span>
                              <span>{{ step.text }}</span>
                            </div>
                          </div>
                          <div v-else class="small text-break">
                            {{ row.attackPathText || 'N/A' }}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div class="assessment-panel">
                          <div class="assessment-field">
                            <div class="assessment-field-label">Attack Feasibility</div>
                            <div class="d-grid gap-2">
                              <button
                                type="button"
                                class="btn btn-sm btn-outline-primary assessment-action-button"
                                @click="openAttackFeasibilityModal(row)"
                              >
                                {{ row.attackFeasibilityTotal !== null ? 'Edit Details' : 'Assess Details' }}
                              </button>
                              <div class="assessment-feasibility-summary">
                                <span
                                  class="badge compact-badge"
                                  :class="row.attackFeasibilityTotal !== null ? 'bg-primary' : 'bg-secondary'"
                                >
                                  {{ formatAttackFeasibilitySummary(row) }}
                                </span>
                                <div v-if="row.attackFeasibilityLegacyLabel" class="assessment-helper-text">
                                  Legacy: {{ row.attackFeasibilityLegacyLabel }}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div class="assessment-field">
                            <div class="assessment-field-label">Impact Rating</div>
                            <EditableDropdown
                              :modelValue="row.impact_rating || ''"
                              :options="impactRatingOptions"
                              @update:modelValue="onFieldUpdate(row.sourceAssessment, 'impact_rating', $event)"
                            />
                          </div>
                          <div class="assessment-field">
                            <div class="assessment-field-label">Risk Treatment</div>
                            <EditableDropdown
                              :modelValue="row.risk_treatment || ''"
                              :options="riskTreatmentOptions"
                              @update:modelValue="onFieldUpdate(row.sourceAssessment, 'risk_treatment', $event)"
                            />
                          </div>
                          <div class="assessment-field">
                            <div class="assessment-field-label">CAL</div>
                            <EditableDropdown
                              :modelValue="row.cal_rating || ''"
                              :options="calOptions"
                              @update:modelValue="onFieldUpdate(row.sourceAssessment, 'cal_rating', $event)"
                            />
                          </div>
                        </div>
                      </td>
                      <td class="text-center actions-cell">
                        <button class="btn btn-sm btn-outline-danger actions-button" @click="confirmDeleteAttackPath(row)">
                          <i class="fa-solid fa-trash"></i>
                        </button>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>

            <div v-else class="p-4 text-muted small">
              No assessment rows yet. Expand this session's attack paths to generate Gemini results.
            </div>
          </div>
        </template>
      </div>
    </div>

    <div v-else class="text-center py-5 text-muted">
      <i class="fa-solid fa-clipboard-list fa-3x mb-3"></i>
      <p>No simulation sessions available.</p>
      <p>Run malsim in the Diagram Editor to create a session.</p>
    </div>

    <AttackFeasibilityModal
      :show="isAttackFeasibilityModalOpen"
      :assessmentRow="selectedAttackFeasibilityRow"
      @save="saveAttackFeasibilityDetail"
      @cancel="closeAttackFeasibilityModal"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useTaraAssessmentStore } from '@/stores/taraAssessmentStore.js';
import { useThreatModelStore } from '@/stores/threatModelStore.js';
import EditableDropdown from '@/components/tara/EditableDropdown.vue';
import AttackFeasibilityModal from '@/components/tara/AttackFeasibilityModal.vue';
import { deleteSimulationSession } from '@/service/mal/malApiService.js';

const store = useTaraAssessmentStore();
const tmStore = useThreatModelStore();

const selectedSessionId = ref(null);
const expandingSessionId = ref(null);
const deletingSessionId = ref(null);
const isAttackFeasibilityModalOpen = ref(false);
const selectedAttackFeasibilityRow = ref(null);

const impactRatingOptions = ['Negligible', 'Moderate', 'Major', 'Severe'];
const riskTreatmentOptions = ['Avoid', 'Reduce', 'Share', 'Retain'];
const calOptions = ['CAL 1', 'CAL 2', 'CAL 3', 'CAL 4'];

const normalizedAssessments = computed(() =>
  store.assessments.map((item) => {
    const parsedAttackPath = parseAttackPath(item.attack_path);
    return {
      ...item,
      parsed_attack_path: parsedAttackPath,
      parsed_attack_feasibility: parseAttackFeasibilityField(item.attack_feasibility),
      analysis_batch_id: parsedAttackPath?.analysis_batch_id || null,
      generated_path_entries: extractGeneratedPathEntries(parsedAttackPath)
    };
  })
);

const normalizedMalsimSessions = computed(() =>
  (tmStore.malsimSessions || []).map((session) => {
    const summary = extractSimulationSummary(session.simulationResult);
    return {
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      simulationResult: session.simulationResult,
      entryAsset: summary.entryAsset,
      targetAsset: summary.targetAsset
    };
  })
);

const sessions = computed(() => {
  const grouped = new Map();

  normalizedMalsimSessions.value.forEach((session) => {
    grouped.set(session.sessionId, {
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      entryAsset: session.entryAsset,
      targetAsset: session.targetAsset,
      ciaAttribute: null,
      assessmentCount: 0,
      hasAnalysis: false,
      simulationResult: session.simulationResult
    });
  });

  normalizedAssessments.value.forEach((item) => {
    const sessionId = item.session_id || 'unknown-session';
    if (!grouped.has(sessionId)) {
      grouped.set(sessionId, {
        sessionId,
        createdAt: item.created_at,
        entryAsset: item.entry_asset,
        targetAsset: item.target_asset,
        ciaAttribute: item.cia_attribute,
        assessmentCount: 0,
        hasAnalysis: true,
        simulationResult: null
      });
    }

    const session = grouped.get(sessionId);
    session.assessmentCount += 1;
    session.hasAnalysis = true;
    session.entryAsset = session.entryAsset || item.entry_asset;
    session.targetAsset = session.targetAsset || item.target_asset;
    session.ciaAttribute = session.ciaAttribute || item.cia_attribute;

    if (item.created_at && new Date(item.created_at) > new Date(session.createdAt || 0)) {
      session.createdAt = item.created_at;
    }
  });

  return Array.from(grouped.values()).sort((a, b) => {
    const left = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const right = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return right - left;
  });
});

const selectedSessionSummary = computed(() => {
  if (!selectedSessionId.value) return null;
  return sessions.value.find((session) => session.sessionId === selectedSessionId.value) || null;
});

const selectedSessionAssessments = computed(() => {
  if (!selectedSessionId.value) return [];
  return normalizedAssessments.value
    .filter((item) => item.session_id === selectedSessionId.value)
    .slice()
    .sort(compareAssessmentOrder);
});

const selectedSessionAssessmentGroups = computed(() => {
  const grouped = new Map();

  selectedSessionAssessments.value.forEach((assessment) => {
    const groupKey = getAssessmentGroupKey(assessment);

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        groupKey,
        createdAt: assessment.created_at,
        sortId: Number(assessment.id) || 0,
        session_id: assessment.session_id,
        target_asset: assessment.target_asset,
        cia_attribute: assessment.cia_attribute,
        damage_scenario: assessment.damage_scenario,
        impact_category: assessment.impact_category,
        threat_scenario: assessment.threat_scenario,
        analysisBatchId: assessment.analysis_batch_id || null,
        sourceShortestPath: Array.isArray(assessment.parsed_attack_path?.source_shortest_path)
          ? assessment.parsed_attack_path.source_shortest_path
          : [],
        scenarioLinkageCheck: assessment.parsed_attack_path?.scenario_linkage_check || null,
        generatedAttackPaths: {},
        rows: []
      });
    }

    const group = grouped.get(groupKey);

    if (!group.createdAt || compareDateValues(assessment.created_at, group.createdAt) < 0) {
      group.createdAt = assessment.created_at;
    }
    group.sortId = Math.min(group.sortId, Number(assessment.id) || group.sortId || 0);

    if (
      (!group.sourceShortestPath || group.sourceShortestPath.length === 0) &&
      Array.isArray(assessment.parsed_attack_path?.source_shortest_path)
    ) {
      group.sourceShortestPath = assessment.parsed_attack_path.source_shortest_path;
    }

    if (!group.scenarioLinkageCheck && assessment.parsed_attack_path?.scenario_linkage_check) {
      group.scenarioLinkageCheck = assessment.parsed_attack_path.scenario_linkage_check;
    }

    const pathEntries = assessment.generated_path_entries.length > 0
      ? assessment.generated_path_entries
      : [{
          key: `assessment_${assessment.id}`,
          label: 'Attack Path',
          value: {}
        }];

    pathEntries.forEach((entry) => {
      if (entry.key && entry.value && !group.generatedAttackPaths[entry.key]) {
        group.generatedAttackPaths[entry.key] = entry.value;
      }

      group.rows.push({
        ...assessment,
        rowKey: `${assessment.id}-${entry.key}`,
        sourceAssessment: assessment,
        attackPathKey: entry.key,
        attackPathLabel: entry.label,
        attackPathPayload: buildAttackPathPayload(assessment.parsed_attack_path, entry, assessment.analysis_batch_id),
        attackPathStepCount: expandedPathSteps(entry).length,
        attackPathSteps: expandedPathSteps(entry),
        attackPathText: entry.value?.Rewritten_Attack_Path || '',
        attackPathRealism: entry.value?.Realism_Assessment || 'N/A',
        attackPathScore: entry.value?.Completeness_Score_1to5 || '-',
        attackFeasibilityDetail: assessment.parsed_attack_feasibility,
        attackFeasibilityTotal: assessment.parsed_attack_feasibility?.total ?? null,
        attackFeasibilityLegacyLabel: assessment.parsed_attack_feasibility?.legacyLabel || ''
      });
    });
  });

  return Array.from(grouped.values())
    .sort(compareAssessmentGroupOrder)
    .map((group, index) => ({
      ...group,
      rows: group.rows.slice().sort(compareAssessmentRowOrder),
      rowSpan: group.rows.length,
      displayIndex: index + 1,
      attackPathPayload: {
        analysis_batch_id: group.analysisBatchId,
        source_shortest_path: group.sourceShortestPath || [],
        generated_attack_paths: group.generatedAttackPaths,
        scenario_linkage_check: group.scenarioLinkageCheck || null
      }
    }));
});

const selectedLatestAssessmentGroup = computed(() =>
  selectedSessionAssessmentGroups.value[selectedSessionAssessmentGroups.value.length - 1] || null
);

const selectedSessionAttackPath = computed(() => {
  if (selectedLatestAssessmentGroup.value?.attackPathPayload) {
    return selectedLatestAssessmentGroup.value.attackPathPayload;
  }

  const summary = selectedSessionSummary.value;
  if (!summary?.simulationResult) {
    return null;
  }

  const shortestPath = extractSimulationSummary(summary.simulationResult).steps;
  if (!shortestPath.length) {
    return null;
  }

  return {
    source_shortest_path: shortestPath
  };
});

const shortestPathSteps = computed(() => {
  const path = selectedSessionAttackPath.value;

  if (Array.isArray(path)) {
    return path;
  }

  if (Array.isArray(path?.source_shortest_path)) {
    return path.source_shortest_path;
  }

  return [];
});

const generatedPathEntries = computed(() =>
  extractGeneratedPathEntries(selectedSessionAttackPath.value)
);

const scenarioLinkageCheck = computed(() =>
  selectedSessionAttackPath.value?.scenario_linkage_check || null
);

const canExpandSelectedSession = computed(() =>
  Boolean(selectedSessionSummary.value?.simulationResult)
);

const isExpandingSelectedSession = computed(() =>
  expandingSessionId.value === selectedSessionId.value
);

const isDeletingSelectedSession = computed(() =>
  deletingSessionId.value === selectedSessionId.value
);

function expandedPathSteps(path) {
  const rewrittenPath = path?.value?.Rewritten_Attack_Path || '';
  const structuredSteps = path?.value?.Expanded_Steps;

  if (rewrittenPath.trim()) {
    const matches = [...rewrittenPath.matchAll(/\((\d+(?:-\d+)?)\)\s*([\s\S]*?)(?=\s*\(\d+(?:-\d+)?\)|$)/g)];
    if (matches.length > 0) {
      return matches.map((match, index) => {
        const label = match[1];
        const baseStepNumber = Number(String(label).match(/^(\d+)/)?.[1]) || index + 1;

        return {
          label,
          number: baseStepNumber,
          text: match[2].trim().replace(/\s+/g, ' ')
        };
      });
    }
  }

  if (Array.isArray(structuredSteps) && structuredSteps.length > 0) {
    return structuredSteps.map((item, index) => ({
      label: String(Number(item.Shortest_Path_Step) || index + 1),
      number: Number(item.Shortest_Path_Step) || index + 1,
      text: item.Expanded_Description || ''
    }));
  }

  if (!rewrittenPath.trim()) return [];

  return [{
    label: '1',
    number: 1,
    text: rewrittenPath.trim()
  }];
}

watch(
  sessions,
  (nextSessions) => {
    if (nextSessions.length === 0) {
      selectedSessionId.value = null;
      return;
    }

    const stillExists = nextSessions.some((session) => session.sessionId === selectedSessionId.value);
    if (!stillExists) {
      selectedSessionId.value = nextSessions[0].sessionId;
    }
  },
  { immediate: true }
);

onMounted(() => {
  store.loadAllAssessments();
});

function extractSimulationSummary(simulationResult) {
  const shortestPaths =
    simulationResult?.rawResult?.result?.shortest_paths ||
    simulationResult?.result?.shortest_paths ||
    simulationResult?.shortest_paths ||
    null;

  if (!shortestPaths?.agents) {
    return {
      entryAsset: null,
      targetAsset: null,
      steps: []
    };
  }

  for (const agentData of Object.values(shortestPaths.agents)) {
    const entryAsset = normalizeStepLabel(agentData?.entry_points?.[0]?.full_name || agentData?.entry_points?.[0]?.name);
    const goals = agentData?.goals || {};

    for (const [goalName, goalData] of Object.entries(goals)) {
      if (!goalData?.path_found) continue;

      const targetAsset = normalizeStepLabel(goalData?.goal?.full_name || goalName);
      const steps = normalizePathSteps(goalData?.full_path || []);

      return {
        entryAsset,
        targetAsset,
        steps
      };
    }
  }

  return {
    entryAsset: null,
    targetAsset: null,
    steps: []
  };
}

function normalizePathSteps(pathNodes) {
  return (Array.isArray(pathNodes) ? pathNodes : [])
    .map((node, index) => {
      const fullStep = normalizeStepLabel(
        node?.full_name ||
        node?.fullStep ||
        (node?.assetName && node?.attackStep ? `${node.assetName}:${node.attackStep}` : node?.name)
      );

      if (!fullStep) return null;

      const separatorIndex = fullStep.indexOf(':');
      const assetName = separatorIndex >= 0 ? fullStep.slice(0, separatorIndex) : fullStep;
      const attackStep = separatorIndex >= 0 ? fullStep.slice(separatorIndex + 1) : '';

      return {
        step: Number(node?.step) || index + 1,
        assetName,
        attackStep,
        fullStep
      };
    })
    .filter(Boolean);
}

function normalizeStepLabel(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function comparePathKeys(leftKey, rightKey) {
  const leftMatch = String(leftKey).match(/(\d+)$/);
  const rightMatch = String(rightKey).match(/(\d+)$/);

  if (leftMatch && rightMatch) {
    return Number(leftMatch[1]) - Number(rightMatch[1]);
  }

  return String(leftKey).localeCompare(String(rightKey));
}

function extractGeneratedPathEntries(attackPath) {
  const generatedPaths = attackPath?.generated_attack_paths || {};

  return Object.entries(generatedPaths)
    .filter(([, value]) => value && typeof value === 'object')
    .sort(([leftKey], [rightKey]) => comparePathKeys(leftKey, rightKey))
    .map(([key, value]) => ({
      key,
      label: formatAttackPathLabel(key),
      value
    }));
}

function formatAttackPathLabel(pathKey) {
  const match = String(pathKey || '').match(/(\d+)$/);
  if (match) {
    return `Attack Path ${match[1]}`;
  }

  return String(pathKey || 'Attack Path')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildAttackPathPayload(baseAttackPath, entry, analysisBatchId = null) {
  if (!entry?.key || !entry?.value) {
    return baseAttackPath || null;
  }

  return {
    analysis_batch_id: analysisBatchId || baseAttackPath?.analysis_batch_id || null,
    source_shortest_path: Array.isArray(baseAttackPath?.source_shortest_path)
      ? baseAttackPath.source_shortest_path
      : [],
    generated_attack_paths: {
      [entry.key]: entry.value
    },
    scenario_linkage_check: baseAttackPath?.scenario_linkage_check || null
  };
}

function getAssessmentGroupKey(assessment) {
  if (assessment.analysis_batch_id) {
    return `batch:${assessment.analysis_batch_id}`;
  }

  if (assessment.generated_path_entries.length > 1) {
    return `legacy-combined:${assessment.id}`;
  }

  return [
    'legacy',
    assessment.session_id || '',
    assessment.target_asset || '',
    assessment.cia_attribute || '',
    assessment.damage_scenario || '',
    assessment.impact_category || '',
    assessment.threat_scenario || '',
    roundToSecond(assessment.created_at)
  ].join('|');
}

function roundToSecond(value) {
  const date = parseDateValue(value);
  if (!date) return String(value || '');
  return date.toISOString().slice(0, 19);
}

function parseDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function compareDateValues(leftValue, rightValue) {
  const leftDate = parseDateValue(leftValue);
  const rightDate = parseDateValue(rightValue);

  if (!leftDate && !rightDate) return 0;
  if (!leftDate) return -1;
  if (!rightDate) return 1;

  return leftDate.getTime() - rightDate.getTime();
}

function compareAssessmentOrder(left, right) {
  const dateDiff = compareDateValues(left.created_at, right.created_at);
  if (dateDiff !== 0) return dateDiff;
  return (Number(left.id) || 0) - (Number(right.id) || 0);
}

function compareAssessmentGroupOrder(left, right) {
  const dateDiff = compareDateValues(left.createdAt, right.createdAt);
  if (dateDiff !== 0) return dateDiff;
  return (Number(left.sortId) || 0) - (Number(right.sortId) || 0);
}

function compareAssessmentRowOrder(left, right) {
  const pathDiff = comparePathKeys(left.attackPathKey || '', right.attackPathKey || '');
  if (pathDiff !== 0) return pathDiff;
  return compareAssessmentOrder(left, right);
}

function parseAttackPath(attackPath) {
  if (!attackPath) return null;

  if (typeof attackPath === 'string') {
    try {
      return JSON.parse(attackPath);
    } catch (error) {
      console.warn('[DashboardView] Failed to parse attack_path JSON:', error);
      return null;
    }
  }

  return attackPath;
}

function parseAttackFeasibilityField(value) {
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
      total: null,
      legacyLabel: trimmed,
      details: {}
    };
  }
}

function normalizeAttackFeasibilityPayload(value) {
  const details = value?.details || {};

  return {
    total: toFiniteNumberOrNull(value?.total),
    legacyLabel: '',
    details: {
      elapsed_time: toFiniteNumberOrNull(details?.elapsed_time),
      specialist_expertise: toFiniteNumberOrNull(details?.specialist_expertise),
      knowledge_of_item_or_component: toFiniteNumberOrNull(details?.knowledge_of_item_or_component),
      windows_of_opportunity: toFiniteNumberOrNull(details?.windows_of_opportunity),
      equipment: toFiniteNumberOrNull(details?.equipment)
    }
  };
}

function toFiniteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDate(value) {
  if (!value) return 'Unknown';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatAttackFeasibilitySummary(row) {
  if (row?.attackFeasibilityTotal !== null && row?.attackFeasibilityTotal !== undefined) {
    return `Final ${Number(row.attackFeasibilityTotal).toFixed(2)}`;
  }

  if (row?.attackFeasibilityLegacyLabel) {
    return row.attackFeasibilityLegacyLabel;
  }

  return 'Not Assessed';
}

function ciaBadgeClass(cia) {
  switch (cia) {
    case 'Confidentiality':
      return 'bg-info text-dark';
    case 'Integrity':
      return 'bg-warning text-dark';
    case 'Availability':
      return 'bg-danger';
    default:
      return 'bg-secondary';
  }
}

async function expandSelectedSessionAttackPaths() {
  const session = selectedSessionSummary.value;
  if (!session?.simulationResult) {
    alert('No simulation result found for this session.');
    return;
  }

  expandingSessionId.value = session.sessionId;

  try {
    await store.analyzeFromSimulation(session.sessionId, session.simulationResult);
    await store.loadAllAssessments();
  } catch (err) {
    alert(`Expansion failed: ${err.message}`);
  } finally {
    expandingSessionId.value = null;
  }
}

async function onFieldUpdate(item, field, value) {
  try {
    await store.updateAssessment(item.id, { [field]: value });
  } catch (err) {
    alert(`Update failed: ${err.message}`);
  }
}

function openAttackFeasibilityModal(row) {
  selectedAttackFeasibilityRow.value = row;
  isAttackFeasibilityModalOpen.value = true;
}

function closeAttackFeasibilityModal() {
  isAttackFeasibilityModalOpen.value = false;
  selectedAttackFeasibilityRow.value = null;
}

async function saveAttackFeasibilityDetail(serializedPayload) {
  if (!selectedAttackFeasibilityRow.value?.sourceAssessment?.id) return;

  try {
    await store.updateAssessment(selectedAttackFeasibilityRow.value.sourceAssessment.id, {
      attack_feasibility: serializedPayload
    });
    closeAttackFeasibilityModal();
  } catch (err) {
    alert(`Update failed: ${err.message}`);
  }
}

async function confirmDeleteAttackPath(row) {
  if (!row?.sourceAssessment?.id) return;
  if (!confirm(`Are you sure you want to delete ${row.attackPathLabel || 'this attack path'}?`)) return;

  try {
    await store.deleteAssessmentAttackPath(row.sourceAssessment.id, row.attackPathKey);
  } catch (err) {
    alert(`삭제 실패: ${err.message}`);
  }
}

async function deleteSelectedSession() {
  const session = selectedSessionSummary.value;
  if (!session?.sessionId) return;

  if (!confirm('Are you sure you want to delete this simulation session and all related assessments?')) {
    return;
  }

  deletingSessionId.value = session.sessionId;

  try {
    await store.deleteSessionAssessments(session.sessionId);
    tmStore.removeMalsimSession(session.sessionId);

    try {
      await deleteSimulationSession(session.sessionId);
    } catch (cleanupErr) {
      console.warn('[DashboardView] Failed to clean up simulation session:', cleanupErr);
      alert(`Session was removed from the dashboard, but simulator cleanup failed: ${cleanupErr.message}`);
    }
  } catch (err) {
    alert(`Session deletion failed: ${err.message}`);
  } finally {
    deletingSessionId.value = null;
  }
}
</script>

<style scoped>
.path-text {
  white-space: pre-wrap;
}

.rewritten-step + .rewritten-step {
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}

.path-accordion summary {
  cursor: pointer;
  list-style: none;
}

.path-accordion summary::-webkit-details-marker {
  display: none;
}

.collapsible-section summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  cursor: pointer;
  list-style: none;
}

.collapsible-section summary::-webkit-details-marker {
  display: none;
}

.collapsible-section summary::after {
  content: '\f078';
  font-family: 'Font Awesome 7 Free';
  font-weight: 900;
  font-size: 0.8rem;
  color: #6c757d;
  transition: transform 0.2s ease;
}

.collapsible-section:not([open]) summary::after {
  transform: rotate(-90deg);
}

.session-sidebar {
  min-height: 100%;
}

.assessment-table {
  table-layout: fixed;
}

.assessment-table th,
.assessment-table td {
  vertical-align: top;
}

.cia-column {
  width: 92px;
}

.impact-column {
  width: 108px;
}

.cia-column,
.impact-column,
.cia-cell,
.impact-cell {
  text-align: center;
}

.attack-path-column {
  width: 34%;
}

.assessment-panel-column {
  width: 220px;
}

.actions-column {
  width: 76px;
}

.attack-path-inline {
  min-width: 0;
}

.attack-path-steps {
  display: grid;
  gap: 0.4rem;
}

.attack-path-step {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.875rem;
  line-height: 1.4;
}

.attack-path-step-label {
  flex-shrink: 0;
  font-weight: 600;
  color: #495057;
}

.attack-path-step span:last-child {
  word-break: break-word;
}

.assessment-panel {
  display: grid;
  gap: 0.6rem;
}

.assessment-field {
  display: grid;
  gap: 0.25rem;
}

.assessment-field-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #6c757d;
}

.assessment-action-button {
  width: 100%;
}

.assessment-feasibility-summary {
  display: grid;
  gap: 0.25rem;
}

.assessment-helper-text {
  font-size: 0.74rem;
  color: #6c757d;
  word-break: break-word;
}

.group-divider > td {
  border-top-width: 2px;
}

.actions-cell {
  min-width: 76px;
}

.actions-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
}

.compact-badge {
  display: inline-block;
  max-width: 100%;
  padding: 0.35em 0.5em;
  font-size: 0.72rem;
  line-height: 1.2;
  white-space: normal;
  word-break: break-word;
}

:deep(.assessment-table .editable-dropdown .form-select) {
  width: 100%;
  min-width: 0;
  font-size: 0.82rem;
  padding-right: 1.8rem;
}
</style>

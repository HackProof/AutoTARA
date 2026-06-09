<template>
  <div v-if="visible" class="modal-backdrop fade show"></div>
  <div
    class="modal fade"
    :class="{ 'show d-block': visible }"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    @click.self="handleClose"
  >
    <div class="modal-dialog modal-xl modal-dialog-scrollable report-dialog" role="document">
      <div class="modal-content">
        <div class="modal-header">
          <div>
            <h5 class="modal-title mb-1">
              <i class="fa-solid fa-shield-halved text-danger me-2"></i>
              Attack Simulation Report
            </h5>
            <div class="small text-muted">
              {{ reportSubtitle }}
            </div>
          </div>
          <button type="button" class="btn-close" aria-label="Close" @click="handleClose"></button>
        </div>

        <div class="modal-body">
          <div v-if="!hasResult" class="text-center py-5 text-muted">
            No simulation results available.
          </div>

          <template v-else>
            <div class="report-summary border rounded bg-light-subtle mb-3">
              <div>
                <div class="summary-label">Status</div>
                <div class="fw-semibold">{{ activeResult.rawResult?.status || 'completed' }}</div>
              </div>
              <div>
                <div class="summary-label">Entry</div>
                <div class="fw-semibold text-break">{{ entryLabel || 'Unknown' }}</div>
              </div>
              <div>
                <div class="summary-label">Target</div>
                <div class="fw-semibold text-break">{{ targetLabel || 'Unknown' }}</div>
              </div>
              <div>
                <div class="summary-label">Paths</div>
                <div class="fw-semibold">{{ attackPaths.length }}</div>
              </div>
            </div>

            <ul class="nav nav-tabs mb-3">
              <li class="nav-item">
                <button
                  type="button"
                  class="nav-link"
                  :class="{ active: activeTab === 'graph' }"
                  @click="activeTab = 'graph'"
                >
                  Attack Graph
                </button>
              </li>
              <li class="nav-item">
                <button
                  type="button"
                  class="nav-link"
                  :class="{ active: activeTab === 'paths' }"
                  @click="activeTab = 'paths'"
                >
                  Attack Path
                </button>
              </li>
            </ul>

            <section v-if="activeTab === 'graph'">
              <div v-if="attackGraph" class="d-grid gap-3">
                <div class="row g-3">
                  <div class="col-md-4">
                    <div class="metric-box border rounded">
                      <div class="summary-label">Nodes</div>
                      <div class="metric-value">{{ attackGraph.nodeCount || 0 }}</div>
                    </div>
                  </div>
                  <div class="col-md-4">
                    <div class="metric-box border rounded">
                      <div class="summary-label">Edges</div>
                      <div class="metric-value">{{ attackGraph.edgeCount || 0 }}</div>
                    </div>
                  </div>
                  <div class="col-md-4">
                    <a
                      v-if="attackGraphArtifactUrl"
                      class="btn btn-outline-secondary w-100 h-100 d-flex align-items-center justify-content-center"
                      :href="attackGraphArtifactUrl"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <i class="fa-solid fa-download me-2"></i>
                      attackgraph.yml
                    </a>
                  </div>
                </div>

                <div class="table-responsive border rounded">
                  <table class="table table-sm align-middle mb-0">
                    <thead class="table-light">
                      <tr>
                        <th style="width: 90px">ID</th>
                        <th>Asset</th>
                        <th>Attack Step</th>
                        <th style="width: 110px">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="node in visibleGraphNodes" :key="node.id">
                        <td class="text-muted">{{ node.id }}</td>
                        <td class="fw-semibold text-break">{{ node.assetName }}</td>
                        <td class="text-break">{{ node.attackStep || node.fullName }}</td>
                        <td><span class="badge text-bg-light border">{{ node.type || '-' }}</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div v-else class="text-muted border rounded p-4">
                Attack Graph data is not available for this result.
              </div>
            </section>

            <section v-else>
              <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                <div>
                  <div class="fw-semibold">Attack Paths</div>
                  <div class="small text-muted">{{ attackPaths.length }} exported path(s)</div>
                </div>
                <a
                  v-if="attackPathPdfUrl"
                  class="btn btn-sm btn-outline-secondary"
                  :href="attackPathPdfUrl"
                  target="_blank"
                  rel="noreferrer"
                  download="attack_paths.pdf"
                >
                  <i class="fa-solid fa-download me-1"></i>
                  PDF
                </a>
              </div>

              <div v-if="attackPaths.length === 0" class="text-muted border rounded p-4">
                No attack paths were exported.
              </div>

              <div v-else class="path-list d-grid gap-3">
                <label
                  v-for="path in attackPaths"
                  :key="path.key"
                  class="path-card border rounded"
                  :class="{ selected: selectedPathKeys.includes(path.key) }"
                >
                  <div class="path-card-header">
                    <div class="d-flex align-items-center gap-2 min-w-0">
                      <input
                        v-model="selectedPathKeys"
                        class="form-check-input mt-0"
                        type="checkbox"
                        :value="path.key"
                      />
                      <span class="fw-semibold text-truncate">{{ path.label }}</span>
                    </div>
                    <span class="badge text-bg-light border">{{ path.steps.length }} steps</span>
                  </div>

                  <div class="path-steps">
                    <div
                      v-for="(step, index) in path.steps"
                      :key="`${path.key}-${index}`"
                      class="path-step"
                    >
                      <div class="path-step-index">{{ index + 1 }}</div>
                      <div class="path-step-body">
                        <div class="fw-semibold text-break">{{ step.assetName || '-' }}</div>
                        <div class="small text-muted text-break">{{ step.attackStep || step.fullStep || '-' }}</div>
                      </div>
                    </div>
                  </div>
                </label>
              </div>
            </section>
          </template>
        </div>

        <div class="modal-footer bg-light">
          <div class="me-auto small text-muted">
            <span v-if="selectedPathKeys.length">{{ selectedPathKeys.length }} selected</span>
          </div>
          <button type="button" class="btn btn-light border" @click="handleClose">Close</button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!canAddSelected || isAdding"
            @click="addSelectedToDashboard"
          >
            <span v-if="isAdding" class="spinner-border spinner-border-sm me-1" role="status"></span>
            <i v-else class="fa-solid fa-wand-magic-sparkles me-1"></i>
            Add selected to Dashboard
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, toRaw, unref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useToast } from 'vue-toastification';
import { useThreatModelStore } from '@/stores/threatModelStore.js';
import { useTaraAssessmentStore } from '@/stores/taraAssessmentStore.js';
import { getSimulationArtifactUrl } from '@/service/mal/malApiService.js';

const props = defineProps({
  visible: Boolean,
  graph: Object
});

const emit = defineEmits(['close']);

const tmStore = useThreatModelStore();
const taraStore = useTaraAssessmentStore();
const toast = useToast();
const { simulationResult, malsimResult } = storeToRefs(tmStore);

const activeTab = ref('paths');
const selectedPathKeys = ref([]);
const isAdding = ref(false);

const activeResult = computed(() => malsimResult.value || simulationResult.value || null);
const hasResult = computed(() => Boolean(activeResult.value));
const sessionId = computed(() => activeResult.value?.sessionId || activeResult.value?.rawResult?.session_id || null);

const reportSubtitle = computed(() => {
  if (!activeResult.value) return '';
  return sessionId.value ? `Session ${sessionId.value}` : 'Local simulation result';
});

const resultBody = computed(() =>
  activeResult.value?.rawResult?.result ||
  activeResult.value?.result ||
  activeResult.value ||
  {}
);

const attackGraph = computed(() =>
  activeResult.value?.attackGraph ||
  resultBody.value?.attack_graph ||
  activeResult.value?.rawResult?.attack_graph ||
  null
);

const attackPathPayload = computed(() =>
  activeResult.value?.attackPath ||
  resultBody.value?.attack_path ||
  activeResult.value?.attack_path ||
  null
);

const entryLabel = computed(() =>
  attackPathPayload.value?.entry ||
  extractShortestPathLabels.value.entry ||
  ''
);

const targetLabel = computed(() =>
  attackPathPayload.value?.target ||
  extractShortestPathLabels.value.target ||
  ''
);

const attackPaths = computed(() => {
  if (Array.isArray(attackPathPayload.value?.paths)) {
    return attackPathPayload.value.paths.map((path, index) => normalizeReportPath(path, index));
  }

  if (activeResult.value?.attackPaths) {
    return flattenLegacyMalsimPaths(activeResult.value.attackPaths);
  }

  if (simulationResult.value?.paths) {
    return simulationResult.value.paths.map((path, index) => normalizeLocalPath(path, index));
  }

  return [];
});

const extractShortestPathLabels = computed(() => {
  const shortestPaths = resultBody.value?.shortest_paths;
  if (!shortestPaths?.agents) return { entry: '', target: '' };

  for (const agentData of Object.values(shortestPaths.agents)) {
    const entry = agentData?.entry_points?.[0]?.full_name || '';
    for (const [goalName, goalData] of Object.entries(agentData?.goals || {})) {
      if (!goalData?.path_found) continue;
      return {
        entry,
        target: goalData?.goal?.full_name || goalName
      };
    }
  }

  return { entry: '', target: '' };
});

const visibleGraphNodes = computed(() => (attackGraph.value?.nodes || []).slice(0, 250));

const artifacts = computed(() => resultBody.value?.artifacts || activeResult.value?.artifacts || {});

const attackGraphArtifactUrl = computed(() => {
  const artifact = artifacts.value.attackGraph || attackGraph.value?.artifact;
  return sessionId.value && artifact ? getSimulationArtifactUrl(sessionId.value, artifact) : '';
});

const attackPathPdfUrl = computed(() => {
  const artifact = artifacts.value.attackPathPdf || attackPathPayload.value?.pdfArtifact;
  return sessionId.value && artifact ? getSimulationArtifactUrl(sessionId.value, artifact) : '';
});

const selectedAttackPaths = computed(() =>
  attackPaths.value.filter((path) => selectedPathKeys.value.includes(path.key))
);

const canAddSelected = computed(() =>
  Boolean(sessionId.value) && selectedAttackPaths.value.length > 0
);

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      activeTab.value = attackGraph.value ? 'graph' : 'paths';
      selectedPathKeys.value = [];
    }
  }
);

function handleClose() {
  emit('close');
}

function normalizeReportPath(path, index) {
  const key = path.key || `path${index + 1}`;
  return {
    key,
    label: path.label || formatPathLabel(key, index),
    steps: normalizeSteps(path.steps || [])
  };
}

function normalizeLocalPath(path, index) {
  const graphInstance = toRaw(unref(props.graph));
  const steps = (path.nodes || []).map((nodeId, nodeIndex) => {
    const cell = graphInstance?.getCellById?.(nodeId) || graphInstance?.getCell?.(nodeId);
    const data = cell?.getData?.() || {};
    const assetName = data.name || String(nodeId);
    return {
      step: nodeIndex + 1,
      assetName,
      attackStep: '',
      fullStep: assetName
    };
  });

  return {
    key: `localPath${index + 1}`,
    label: `Attack Path ${index + 1}`,
    steps
  };
}

function flattenLegacyMalsimPaths(attackPaths) {
  const paths = [];

  Object.values(attackPaths || {}).forEach((agentPaths) => {
    Object.values(agentPaths || {}).forEach((goalPaths) => {
      const pathList = Array.isArray(goalPaths?.[0]) ? goalPaths : [goalPaths];
      pathList.forEach((rawPath) => {
        paths.push({
          key: `path${paths.length + 1}`,
          label: `Attack Path ${paths.length + 1}`,
          steps: normalizeSteps(rawPath || [])
        });
      });
    });
  });

  return paths;
}

function normalizeSteps(steps) {
  return (Array.isArray(steps) ? steps : [])
    .map((step, index) => {
      const fullStep =
        step.fullStep ||
        step.full_name ||
        (step.assetName && step.attackStep ? `${step.assetName}:${step.attackStep}` : step.name);

      if (!fullStep) return null;

      const { assetName, attackStep } = splitFullStep(fullStep);
      return {
        step: Number(step.step) || index + 1,
        assetType: step.assetType || '',
        assetName: step.assetName || assetName,
        attackStep: step.attackStep || attackStep,
        fullStep: step.fullStep || fullStep
      };
    })
    .filter(Boolean);
}

function splitFullStep(fullStep) {
  const text = String(fullStep || '').trim();
  const separator = text.indexOf(':');
  if (separator === -1) {
    return { assetName: text, attackStep: '' };
  }
  return {
    assetName: text.slice(0, separator),
    attackStep: text.slice(separator + 1)
  };
}

function formatPathLabel(key, index) {
  const match = String(key || '').match(/(\d+)$/);
  return `Attack Path ${match ? match[1] : index + 1}`;
}

async function addSelectedToDashboard() {
  if (!canAddSelected.value) return;

  isAdding.value = true;
  try {
    const created = await taraStore.analyzeSelectedAttackPaths(sessionId.value, selectedAttackPaths.value);
    await taraStore.loadAllAssessments();
    toast.success(`${created.length} dashboard item(s) added.`);
    selectedPathKeys.value = [];
  } catch (error) {
    toast.error(error.message || 'Failed to add selected paths.');
  } finally {
    isAdding.value = false;
  }
}
</script>

<style scoped>
.report-dialog {
  max-width: min(1280px, calc(100vw - 48px));
}

.report-summary {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr) minmax(0, 1fr) 100px;
  gap: 16px;
  padding: 14px 16px;
}

.summary-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: #6c757d;
  text-transform: uppercase;
}

.metric-box {
  padding: 14px 16px;
  background: #ffffff;
}

.metric-value {
  font-size: 1.35rem;
  font-weight: 700;
}

.path-card {
  display: block;
  padding: 14px;
  cursor: pointer;
  background: #ffffff;
}

.path-card:hover,
.path-card.selected {
  border-color: #0d6efd !important;
  background: #f4f8ff;
}

.path-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.path-steps {
  display: grid;
  gap: 8px;
}

.path-step {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.path-step-index {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #f1f3f5;
  color: #495057;
  font-size: 0.75rem;
  font-weight: 700;
}

.path-step-body {
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  background: #fbfcfd;
}

@media (max-width: 992px) {
  .report-summary {
    grid-template-columns: 1fr;
  }
}
</style>

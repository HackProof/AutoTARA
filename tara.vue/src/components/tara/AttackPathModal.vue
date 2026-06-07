<template>
  <div
    class="modal fade"
    ref="modalRef"
    tabindex="-1"
    aria-labelledby="attackPathModalLabel"
    aria-hidden="true"
  >
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="attackPathModalLabel">Attack Path Details</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <div v-if="pathGroups.length > 0">
            <div class="mb-4" v-for="group in pathGroups" :key="group.key">
              <h6 class="fw-bold mb-3">{{ group.title }}</h6>

              <div v-if="group.type === 'steps'" class="list-group">
                <div
                  v-for="(step, idx) in group.steps"
                  :key="`${group.key}-${idx}`"
                  class="list-group-item"
                >
                  <div class="d-flex align-items-start">
                    <span class="badge bg-primary rounded-pill me-3 mt-1">{{ step.step || idx + 1 }}</span>
                    <div>
                      <strong>{{ step.assetName }}</strong>
                      <span class="text-muted ms-1">: {{ step.attackStep }}</span>
                      <p v-if="step.description" class="mb-0 mt-1 small text-secondary">
                        {{ step.description }}
                      </p>
                    </div>
                  </div>
                  <div v-if="idx < group.steps.length - 1" class="text-center text-muted my-1">
                    <i class="fa-solid fa-arrow-down"></i>
                  </div>
                </div>
              </div>

              <div v-else class="border rounded p-3 bg-light">
                <div class="d-flex flex-wrap gap-2 mb-3">
                  <span class="badge bg-secondary">{{ group.realism }}</span>
                  <span class="badge bg-primary">Score {{ group.score }}/5</span>
                </div>

                <p class="mb-3 attack-path-text">{{ group.rewrittenPath }}</p>

                <div v-if="group.missingSteps.length > 0" class="mb-3">
                  <div class="fw-semibold small text-muted mb-1">Missing Steps</div>
                  <ul class="mb-0 small">
                    <li v-for="(item, idx) in group.missingSteps" :key="`${group.key}-missing-${idx}`">
                      {{ item }}
                    </li>
                  </ul>
                </div>

                <div v-if="group.assumptions.length > 0" class="mb-3">
                  <div class="fw-semibold small text-muted mb-1">Key Assumptions</div>
                  <ul class="mb-0 small">
                    <li v-for="(item, idx) in group.assumptions" :key="`${group.key}-assumption-${idx}`">
                      {{ item }}
                    </li>
                  </ul>
                </div>

                <div v-if="group.evidence.length > 0">
                  <div class="fw-semibold small text-muted mb-1">Evidence Needed</div>
                  <ul class="mb-0 small">
                    <li v-for="(item, idx) in group.evidence" :key="`${group.key}-evidence-${idx}`">
                      {{ item }}
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div v-if="scenarioLinkage" class="border-top pt-3">
              <h6 class="fw-bold mb-2">Scenario Linkage</h6>
              <div class="d-flex flex-wrap gap-2 mb-2 small">
                <span class="badge bg-dark">
                  Damage-Threat: {{ scenarioLinkage.Damage_to_Threat_Consistency || 'N/A' }}
                </span>
                <span class="badge bg-dark">
                  Threat-Path: {{ scenarioLinkage.Threat_to_AttackPath_Consistency || 'N/A' }}
                </span>
                <span class="badge bg-dark">
                  CIA: {{ scenarioLinkage.CIA_Consistency || 'N/A' }}
                </span>
              </div>
              <ul v-if="Array.isArray(scenarioLinkage.Notes) && scenarioLinkage.Notes.length > 0" class="mb-0 small">
                <li v-for="(note, idx) in scenarioLinkage.Notes" :key="`scenario-note-${idx}`">
                  {{ note }}
                </li>
              </ul>
            </div>
          </div>
          <div v-else class="text-muted text-center py-3">
            No attack path data available.
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { Modal } from 'bootstrap';

const props = defineProps({
  attackPath: {
    type: [Array, Object],
    default: () => []
  }
});

const modalRef = ref(null);
let modalInstance = null;

const attackPathPayload = computed(() => {
  if (Array.isArray(props.attackPath)) {
    return { source_shortest_path: props.attackPath };
  }
  return props.attackPath || {};
});

const pathGroups = computed(() => {
  const payload = attackPathPayload.value;
  const groups = [];

  if (Array.isArray(payload.source_shortest_path) && payload.source_shortest_path.length > 0) {
    groups.push({
      key: 'source-shortest-path',
      title: 'Shortest Path',
      type: 'steps',
      steps: payload.source_shortest_path
    });
  }

  const generatedPaths = payload.generated_attack_paths || {};
  Object.entries(generatedPaths).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') return;

    groups.push({
      key,
      title: key.replace('_', ' ').toUpperCase(),
      type: 'summary',
      realism: value.Realism_Assessment || 'N/A',
      score: value.Completeness_Score_1to5 || '-',
      missingSteps: Array.isArray(value.Missing_Steps) ? value.Missing_Steps : [],
      assumptions: Array.isArray(value.Key_Assumptions) ? value.Key_Assumptions : [],
      evidence: Array.isArray(value.Evidence_Needed) ? value.Evidence_Needed : [],
      rewrittenPath: value.Rewritten_Attack_Path || ''
    });
  });

  return groups;
});

const scenarioLinkage = computed(() => attackPathPayload.value?.scenario_linkage_check || null);

onMounted(() => {
  modalInstance = new Modal(modalRef.value);
});

onBeforeUnmount(() => {
  modalInstance?.dispose();
});

function show() {
  modalInstance?.show();
}

function hide() {
  modalInstance?.hide();
}

defineExpose({ show, hide });
</script>

<style scoped>
.attack-path-text {
  white-space: pre-wrap;
}
</style>

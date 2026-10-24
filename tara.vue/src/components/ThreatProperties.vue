<script setup>
import { computed } from 'vue'
import { riskScoreClass, riskScoreLabel } from '@/services/ttpScoring.js'

const props = defineProps({
  selectedElement: { type: Object, default: null },
  catalogSchema: { type: String, default: '' },
  threats: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
defineEmits(['retry'])
const isAsset = computed(
  () =>
    props.selectedElement?.assetType &&
    !props.selectedElement.isEdge &&
    !props.selectedElement.isBoundary,
)
const endpointIds = computed(() => {
  const endpoints = props.selectedElement?.attackEndpoints?.[props.catalogSchema]
  return {
    entry: new Set((endpoints?.entry || []).map((step) => step.attackStepId)),
    target: new Set((endpoints?.target || []).map((step) => step.attackStepId)),
  }
})
</script>

<template>
  <section class="card shadow-sm flex-shrink-0" aria-labelledby="threats-title">
    <div
      class="card-header bg-white fw-bold d-flex justify-content-between align-items-center border-bottom-0 py-3"
    >
      <h2 id="threats-title" class="fs-6 fw-bold mb-0">
        <i class="fa-solid fa-shield-virus me-2" aria-hidden="true"></i>Threats
      </h2>
      <span
        v-if="isAsset && catalogSchema && !loading && !error"
        class="badge rounded-pill text-bg-secondary"
      >
        {{ threats.length }}
      </span>
    </div>
    <div class="card-body">
      <p v-if="!selectedElement" class="small text-center text-muted opacity-75 mb-0">
        Select an element in the diagram<br />to view its threats.
      </p>
      <p v-else-if="!isAsset" class="small text-muted mb-0">
        Select a MAL asset to view its attack steps.
      </p>
      <p v-else-if="!catalogSchema" class="small text-muted mb-0">
        Choose a DB Schema (Lang) in New Diagram to enable threat analysis.
      </p>
      <p v-else-if="loading" class="small text-muted mb-0" role="status">Loading attack steps…</p>
      <div v-else-if="error" class="small text-danger" role="alert">
        {{ error }}
        <button type="button" class="btn btn-sm btn-outline-secondary mt-2" @click="$emit('retry')">
          Retry
        </button>
      </div>
      <template v-else>
        <p class="small text-muted text-break mb-2">
          {{ selectedElement.assetType }} · {{ catalogSchema }}
        </p>
        <p v-if="!threats.length" class="small text-muted mb-0">
          No attack steps are recorded for this asset in the selected schema.
        </p>
        <ul v-else class="list-group list-group-flush threat-list" aria-label="Asset attack steps">
          <li
            v-for="threat in threats"
            :key="threat.attack_step_id"
            class="list-group-item px-0 py-3"
          >
            <div
              class="fw-semibold text-break mb-2 attack-step-name"
              :title="threat.definition || threat.qualified_name"
            >
              {{ threat.name }}
              <span
                v-if="endpointIds.entry.has(threat.attack_step_id)"
                class="badge text-bg-primary ms-1"
                >Entry</span
              >
              <span
                v-if="endpointIds.target.has(threat.attack_step_id)"
                class="badge text-bg-danger ms-1"
                >Target</span
              >
            </div>
            <div class="d-flex flex-wrap gap-1 align-items-center small">
              <span class="text-muted">Risk Score</span>
              <span
                class="badge rounded-pill"
                :class="riskScoreClass(threat.riskScore)"
                :aria-label="`Risk Score: ${riskScoreLabel(threat.riskScore)}`"
              >
                {{ riskScoreLabel(threat.riskScore) }}
              </span>
            </div>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>

<style scoped>
.threat-list {
  max-height: 440px;
  overflow-y: auto;
}
.attack-step-name {
  font-size: 0.8rem;
  overflow-wrap: anywhere;
  line-height: 1.45;
}
</style>

<script setup>
import { computed } from 'vue'
import { describeAttackStep } from '@/services/attackStepSemantics.js'

const props = defineProps({
  threat: { type: Object, required: true },
  showUnmappedReason: { type: Boolean, default: true },
  showRationale: { type: Boolean, default: true },
})
const info = computed(() => describeAttackStep(props.threat))
</script>

<template>
  <div class="step-semantics small fw-normal mt-2">
    <span class="badge text-bg-light border text-wrap" :title="info.description">{{
      info.label
    }}</span>
    <div v-if="!info.mapped" class="mt-2">
      <span class="badge bg-warning-subtle text-warning-emphasis">MITRE unmapped</span>
      <p v-if="showUnmappedReason" class="mb-1 mt-1 text-break unmapped-reason">
        {{ info.unmappedReason }}
      </p>
    </div>
    <details v-if="showRationale && (info.rationale || info.source)" class="mt-2">
      <summary>Classification rationale</summary>
      <p class="mb-1 mt-1 text-break">{{ info.rationale }}</p>
      <p v-if="info.source" class="text-muted text-break mb-1">MAL source: {{ info.source }}</p>
      <span class="text-muted">AutoTARA · {{ info.version }}</span>
    </details>
  </div>
</template>

<style scoped>
.step-semantics {
  font-size: 0.75rem;
  line-height: 1.45;
}
summary {
  cursor: pointer;
}
</style>

<script setup>
import { computed } from 'vue'
const props = defineProps({
  metric: { type: Object, required: true },
  graph: { type: Object, required: true },
  details: Boolean,
})
defineEmits(['inspect'])
const names = computed(() => new Map(props.graph.nodes.map((node) => [node.id, node])))
const labels = {
  feasible: 'Feasible — executable from the selected Entries and confirmed conditions.',
  unresolved: 'Unresolved — unknown conditions prevent a definite feasibility decision.',
  infeasible:
    'Infeasible — required prerequisites cannot be satisfied under the current assumptions.',
  limited: 'Limited — feasibility calculation stopped at its work or time limit.',
}
const colors = {
  feasible: 'text-success',
  unresolved: 'text-warning-emphasis',
  infeasible: 'text-danger',
  limited: 'text-secondary',
}
const reasons = {
  'unknown-condition': 'Condition state is unknown',
  'active-defense': 'Defense is active',
  'required-absence-false': 'Required absence is false',
  'required-existence-false': 'Required existence is false',
  'non-entry-leaf': 'No predecessors; this step is not an initial Entry',
  'unsatisfied-and': 'AND has unmet mandatory inputs',
  'no-reachable-or-input':
    'No permitted OR input is reachable (including the selected route input)',
}
</script>

<template>
  <component :is="details ? 'div' : 'span'" class="small d-block" role="status">
    <strong :class="colors[metric.status]">{{
      labels[metric.status] || 'Feasibility not assessed'
    }}</strong>
    <details v-if="details && metric.blockedPrerequisites?.length" class="mt-1">
      <summary>
        Unmet prerequisites and conditions ({{ metric.blockedPrerequisites.length }})
      </summary>
      <ul class="ps-3 mt-1 dependency-reasons">
        <li v-for="item in metric.blockedPrerequisites.slice(0, 100)" :key="item.id" class="mb-1">
          <button
            type="button"
            class="btn btn-link btn-sm p-0 text-start text-break"
            @click="$emit('inspect', names.get(item.id)?.cellId)"
          >
            {{ names.get(item.id)?.fullName || item.id }}
          </button>
          — {{ reasons[item.reason] || item.reason }} ({{ item.status }})
          <span v-if="item.unsatisfiedParents.length" class="d-block text-secondary">
            Inputs:
            {{ item.unsatisfiedParents.map((id) => names.get(id)?.fullName || id).join(', ') }}
          </span>
        </li>
      </ul>
      <p v-if="metric.blockedPrerequisites.length > 100" class="text-secondary">
        Showing the first 100 causes. Expand the Attack Tree to inspect other dependencies.
      </p>
    </details>
  </component>
</template>

<style scoped>
.dependency-reasons {
  max-height: 15rem;
  overflow: auto;
  overflow-wrap: anywhere;
}
</style>

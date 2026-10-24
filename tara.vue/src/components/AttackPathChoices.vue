<script setup>
import { computed } from 'vue'
import AttackPathStatus from './AttackPathStatus.vue'
import { describeAttackPathTarget } from '@/services/attackPathDiagnostics.js'
import { sortAttackPathIndexes } from '@/services/attackPathMetrics.js'
import { riskScoreClass, riskScoreLabel } from '@/services/ttpScoring.js'

const props = defineProps({
  analysis: { type: Object, required: true },
  selectedIndex: { type: Number, default: 0 },
  sortBy: { type: String, default: 'hops' },
})
defineEmits(['update:selectedIndex', 'update:sortBy'])
const nodes = computed(() => new Map(props.analysis.graph.nodes.map((node) => [node.id, node])))
const candidates = computed(() =>
  sortAttackPathIndexes(props.analysis.result, props.sortBy).map((index) => ({
    index,
    path: props.analysis.result.paths[index],
    metric: props.analysis.result.metrics[index],
  })),
)
const selectedMetric = computed(() => props.analysis.result.metrics[props.selectedIndex])
const reasons = {
  pathLimit: 'Candidate limit reached; additional paths may exist.',
  workLimit: 'Search work limit reached; results are partial.',
  timeLimit: 'Search time limit reached; results are partial.',
}
</script>

<template>
  <div>
    <label class="small d-block mb-2">
      Sort candidates
      <select
        class="form-select form-select-sm mt-1"
        :value="sortBy"
        @change="$emit('update:sortBy', $event.target.value)"
      >
        <option value="hops">Route hops: Low to high</option>
        <option value="risk">Candidate Avg Risk: High to low</option>
      </select>
    </label>
    <details class="small text-secondary mb-2">
      <summary>How totals are calculated</summary>
      <p class="mb-1">
        Route hops count main-route edges. Required steps count unique attack steps in the verified
        plan, including its Entries. Additional steps are outside the main route. Critical depth is
        the longest dependency chain from the initial state.
      </p>
      <p class="mb-1">
        Average Risk includes every required attack step, including Entries. It is available only at
        100% assessment coverage; incomplete assessments sort last in Risk order.
      </p>
      <p class="mb-0">
        Risk ranking covers returned candidates and their chosen support plans only, not global Risk
        Top-K. Search selects short structural routes across all Entries, without per-Entry quotas.
        OR support uses a deterministic earliest-reachable witness; it does not optimize step count
        or Risk. Path numbers stay the same when sorting.
      </p>
    </details>
    <p class="small text-secondary" role="status">
      Candidate search within hop limit:
      {{ analysis.result.candidateSearchComplete ? 'exhausted' : 'partial' }}. Risk scope: returned
      candidates only.
    </p>
    <p
      v-for="target in analysis.result.targetResults"
      :key="target.target"
      class="small text-break mb-2"
      role="status"
    >
      <strong>{{ nodes.get(target.target).fullName }}</strong
      >: {{ target.pathCount }} candidates.
      <span v-if="target.stopReason" class="text-warning-emphasis">{{
        reasons[target.stopReason]
      }}</span>
      <span class="d-block">{{ describeAttackPathTarget(target, analysis.result.maxHops) }}</span>
      <span v-if="target.statusCounts" class="d-block text-secondary">
        Feasible {{ target.statusCounts.feasible }} · Unresolved
        {{ target.statusCounts.unresolved }} · Infeasible {{ target.statusCounts.infeasible }} ·
        Limited {{ target.statusCounts.limited }}
      </span>
    </p>
    <details v-if="analysis.result.diagnostics" class="small text-secondary mb-2">
      <summary>Graph and search diagnostics</summary>
      <p class="mb-1">
        {{ analysis.result.diagnostics.nodeCount }} nodes ·
        {{ analysis.result.diagnostics.edgeCount }} edges. Structural reach:
        {{ analysis.result.diagnostics.structuralReachableCount ?? 'unknown' }} attack steps. With
        the previous feasibility filter:
        {{ analysis.result.diagnostics.reachableAfterFeasibilityFilterCount ?? 'unknown' }}.
      </p>
      <p
        v-for="entry in analysis.result.diagnostics.entries"
        :key="entry.id"
        class="text-break mb-1"
      >
        Entry: {{ entry.fullName }} · ID {{ entry.id }}
      </p>
      <div
        v-for="target in analysis.result.diagnostics.targets"
        :key="target.target"
        class="text-break mb-1"
      >
        Target: {{ target.fullName }} · ID {{ target.target }}<br />
        Shortest structural route: {{ target.shortestHops ?? 'unknown / absent' }} hops. Global
        Target feasibility: {{ target.targetFeasibility }}.
        {{ target.unknownConditions.length }} unknown related conditions.
      </div>
      <p v-if="analysis.result.validationStopReason" class="mb-0">
        Validation limit: {{ analysis.result.validationStopReason }}. Retained candidates may be
        unassessed.
      </p>
    </details>
    <div class="d-grid gap-1" aria-label="Choose a candidate path">
      <button
        v-for="{ path: candidate, index, metric } in candidates"
        :key="index"
        type="button"
        class="btn btn-sm text-start text-break"
        :class="selectedIndex === index ? 'btn-primary' : 'btn-outline-secondary'"
        :aria-pressed="selectedIndex === index"
        @click="$emit('update:selectedIndex', index)"
      >
        <strong>Path {{ index + 1 }} · {{ metric.routeHops }} route hops</strong><br />
        {{ nodes.get(candidate[0]).fullName }} → {{ nodes.get(candidate.at(-1)).fullName }}
        <AttackPathStatus :metric="metric" :graph="analysis.graph" />
        <span v-if="metric.status === 'feasible'" class="d-block small mt-1">
          {{ metric.requiredStepCount }} required steps ·
          {{ metric.additionalStepCount }} additional · Critical depth {{ metric.criticalPathHops
          }}<br />
          <span class="badge rounded-pill" :class="riskScoreClass(metric.averageRisk)">
            Avg Risk Value: {{ riskScoreLabel(metric.averageRisk) }}
          </span>
          · {{ metric.scoredSteps }}/{{ metric.stepIds.length }} scored ({{
            Math.round(metric.riskCoverage * 100)
          }}%)
          <span v-if="metric.riskStatus !== 'complete'"> · Risk assessment incomplete</span>
        </span>
        <span v-else class="d-block small mt-1">
          {{ metric.routeHops }} main-route hops ·
          {{
            metric.status === 'limited'
              ? 'Totals unavailable: calculation limit'
              : 'No executable support plan established; step totals and Risk are unavailable'
          }}
        </span>
      </button>
    </div>
    <details v-if="selectedMetric?.stepIds.length" class="small mt-2">
      <summary>Execution order for Path {{ selectedIndex + 1 }}</summary>
      <ul class="ps-3 mt-1 counted-steps">
        <li v-for="id in selectedMetric.executionOrder" :key="id">
          {{ nodes.get(id).fullName }}
          <span
            v-if="Number.isFinite(nodes.get(id).riskScore)"
            class="badge rounded-pill"
            :class="riskScoreClass(nodes.get(id).riskScore)"
          >
            {{ riskScoreLabel(nodes.get(id).riskScore) }}
          </span>
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.counted-steps {
  max-height: 16rem;
  overflow: auto;
  overflow-wrap: anywhere;
}
</style>

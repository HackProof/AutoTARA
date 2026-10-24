<script setup>
import { effectLabel, crraScoreLabel } from '@/services/crra.js'
import { riskScoreLabel } from '@/services/ttpScoring.js'
defineProps({ solution: { type: Object, required: true } })
</script>

<template>
  <div>
    <div class="d-flex flex-wrap gap-2 mb-3" role="status">
      <span class="badge text-bg-light border">{{ solution.rows.length }} selected CMs</span>
      <span class="badge text-bg-light border"
        >Total Cost: {{ crraScoreLabel(solution.totalCost) }}</span
      >
      <span
        class="badge"
        :class="solution.strategySatisfied ? 'text-bg-success' : 'text-bg-warning'"
        >{{
          solution.strategySatisfied
            ? 'Selection strategy satisfied'
            : 'Selection strategy not satisfied'
        }}</span
      >
    </div>
    <p v-if="solution.incompleteCmIds.length" class="alert alert-warning small">
      Incomplete score data: {{ solution.incompleteCmIds.join(', ') }}. Coverage and score
      completeness are reported separately.
    </p>
    <div class="table-responsive matrix-table-container">
      <table class="table table-bordered table-hover align-middle mb-0 matrix-table solution-table">
        <caption class="small">
          P = Preventative; R = Responsive; D = Detect (displayed only). ? = unassessed
          classification. Levels / confidence retain their source wording. A CM with both P and R
          counts once toward total coverage. This is planned coverage, not proof of deployment or a
          reduced Risk Score.
        </caption>
        <thead class="table-light">
          <tr>
            <th scope="col">CM ID / name</th>
            <th scope="col" class="text-center text-nowrap">Utility</th>
            <th scope="col" class="text-center text-nowrap">Cost</th>
            <th scope="col" class="text-center text-nowrap">U/C Ratio</th>
            <th
              v-for="av in solution.coverage"
              :key="av.avId"
              scope="col"
              class="text-center solution-vector-column"
            >
              <span :title="av.attackVector">{{ av.avId }}</span
              ><span class="d-block small text-muted fw-normal"
                >Risk {{ riskScoreLabel(av.riskScore) }}</span
              >
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cm in solution.rows" :key="cm.id">
            <th scope="row" class="fw-normal">
              {{ cm.id }}<span class="d-block fw-normal">{{ cm.name }}</span>
            </th>
            <td class="text-center text-nowrap">{{ crraScoreLabel(cm.utility) }}</td>
            <td class="text-center text-nowrap">{{ crraScoreLabel(cm.cost) }}</td>
            <td class="text-center text-nowrap">{{ crraScoreLabel(cm.ratio) }}</td>
            <td
              v-for="av in solution.coverage"
              :key="av.avId"
              class="text-center text-nowrap"
              :class="{
                'matrix-hit': cm.mappings.some(
                  (mapping) => mapping.avId === av.avId && mapping.effects?.length,
                ),
              }"
            >
              {{ effectLabel(cm.mappings.find((mapping) => mapping.avId === av.avId)) }}
            </td>
          </tr>
          <tr v-if="!solution.rows.length">
            <td :colspan="4 + solution.coverage.length" class="text-muted">
              No countermeasures selected.
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total cost</th>
            <td class="text-center">—</td>
            <td class="text-center text-nowrap">{{ crraScoreLabel(solution.totalCost) }}</td>
            <td class="text-center">—</td>
            <td v-for="av in solution.coverage" :key="av.avId"></td>
          </tr>
          <tr>
            <th scope="row" colspan="4">Applied CM count (P / R)</th>
            <td v-for="av in solution.coverage" :key="av.avId" class="text-center text-nowrap">
              {{ av.counts.total }} ({{ av.counts.P }} / {{ av.counts.R }})
            </td>
          </tr>
          <tr>
            <th scope="row" colspan="4">Required CM count (P / R)</th>
            <td v-for="av in solution.coverage" :key="av.avId" class="text-center text-nowrap">
              {{
                av.required.valid
                  ? `${av.required.total} (${av.required.P} / ${av.required.R})`
                  : 'Strategy missing / invalid'
              }}
            </td>
          </tr>
          <tr>
            <th scope="row" colspan="4">Selection strategy / Gap</th>
            <td
              v-for="av in solution.coverage"
              :key="av.avId"
              class="text-center"
              :class="av.satisfied ? 'table-success' : 'table-warning'"
            >
              {{
                av.satisfied
                  ? 'Satisfied'
                  : av.gaps
                    ? `Gap: ${av.gaps.total} CM, ${av.gaps.P} P, ${av.gaps.R} R`
                    : 'Set strategy'
              }}<small v-if="av.unknownCmIds.length" class="d-block"
                >Unknown effects: {{ av.unknownCmIds.join(', ') }}</small
              >
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    <details class="mt-3">
      <summary>Recommendation evidence and affected Shopping Carts</summary>
      <div v-for="cm in solution.rows" :key="cm.id" class="border-bottom py-2 small">
        <strong>{{ cm.id }} · {{ cm.name }}</strong>
        <div v-for="mapping in cm.mappings" :key="mapping.avId">
          {{ mapping.avId }}: {{ effectLabel(mapping) }} —
          {{ mapping.basis || 'Assessment rationale not provided.' }}
        </div>
        <div class="text-muted">Cost basis: {{ cm.costBasis || 'Not provided' }}</div>
      </div>
      <div v-for="av in solution.coverage" :key="av.avId" class="mt-2 small">
        <strong>{{ av.avId }} · {{ av.attackVector }}</strong>
        <span
          v-for="cell in av.cells.filter((cell) => cell.riskScore !== null)"
          :key="cell.cartId"
          class="d-block"
          >Shopping Cart {{ cell.cartId }} · Risk {{ riskScoreLabel(cell.riskScore) }} · Steps:
          {{ cell.sourceSteps.map((step) => step.attackStepId).join(', ') }}</span
        >
      </div>
      <p class="small text-muted mt-2">
        Mission impact and deployment verification require a separate assessment; no impact or
        residual-risk score is inferred.
      </p>
    </details>
  </div>
</template>

<style scoped src="../assets/matrix-table.css"></style>

<style scoped>
.solution-table th,
.solution-table td {
  min-width: 100px;
}
.solution-table th:first-child {
  min-width: 240px;
  overflow-wrap: anywhere;
}
.solution-table .solution-vector-column {
  min-width: 150px;
  max-width: 220px;
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
}
</style>

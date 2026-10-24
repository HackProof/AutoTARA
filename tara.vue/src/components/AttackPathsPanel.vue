<script setup>
import { computed } from 'vue'
import AttackPathStatus from './AttackPathStatus.vue'
import { describeAttackPathTarget } from '@/services/attackPathDiagnostics.js'
import AttackPathChoices from './AttackPathChoices.vue'
import AttackPrerequisite from './AttackPrerequisite.vue'
import { buildPathPrerequisites } from '@/services/attackPaths.js'

const props = defineProps({
  analysis: { type: Object, required: true },
  selectedIndex: { type: Number, default: 0 },
  sortBy: { type: String, default: 'hops' },
})
defineEmits(['reset', 'inspect', 'update:selectedIndex', 'update:sortBy'])
const selected = computed(() => props.selectedIndex)
const nodes = computed(() => new Map(props.analysis.graph.nodes.map((node) => [node.id, node])))
const path = computed(() => props.analysis.result.paths[selected.value] || [])
const metric = computed(() => props.analysis.result.metrics[selected.value])
const prerequisites = computed(() =>
  buildPathPrerequisites(props.analysis.graph, path.value, { metric: metric.value }),
)
</script>

<template>
  <section class="attack-paths border rounded mt-2" aria-label="Attack path candidates">
    <div class="d-flex align-items-start justify-content-between gap-2 p-2 border-bottom">
      <div>
        <h2 class="h6 mb-1">
          Attack path candidates
          <span class="badge text-bg-primary">{{ analysis.result.paths.length }}</span>
        </h2>
        <p class="small text-secondary mb-0">
          {{ analysis.graph.entryIds.length }} Entries ·
          {{ analysis.graph.targetIds.length }} Targets · Up to
          {{ analysis.result.maxPaths }} candidates per Target /
          {{ analysis.result.maxHops }} main-route hops
        </p>
        <p class="small mb-0">
          Structural candidates are listed with separate feasibility assessments. All selected
          Entries are initial states; Defense and existence inputs are evaluated with AND/OR
          dependencies.
        </p>
      </div>
      <button
        type="button"
        class="btn-close flex-shrink-0"
        aria-label="Reset Paths"
        @click="$emit('reset')"
      ></button>
    </div>
    <div class="path-results">
      <div class="path-list border-end p-2">
        <AttackPathChoices
          :analysis="analysis"
          :selected-index="selected"
          :sort-by="sortBy"
          @update:selected-index="$emit('update:selectedIndex', $event)"
          @update:sort-by="$emit('update:sortBy', $event)"
        />
      </div>
      <div class="path-detail p-3">
        <template v-if="path.length">
          <h3 class="h6">Path {{ selected + 1 }} · Entry → Target</h3>
          <AttackPathStatus
            :metric="metric"
            :graph="analysis.graph"
            details
            @inspect="$emit('inspect', $event)"
          />
          <p v-if="path.length === 1" class="small text-success">
            The selected Entry is already the Target.
          </p>
          <ol class="main-path small">
            <li v-for="(id, index) in path" :key="id">
              <button
                type="button"
                class="btn btn-sm btn-light text-start text-break"
                @click="$emit('inspect', nodes.get(id).cellId)"
              >
                <span class="text-secondary me-1">{{ index + 1 }}.</span>
                {{ nodes.get(id).fullName }}
                <span v-if="nodes.get(id).type === 'and'" class="badge text-bg-warning ms-1"
                  >AND</span
                >
              </button>
              <span v-if="index < path.length - 1" class="mx-1" aria-hidden="true">→</span>
            </li>
          </ol>
          <h3 class="h6 mt-3">Prerequisites, conditions and supporting Attack Steps</h3>
          <p v-if="!prerequisites.requirements.length" class="small text-secondary">
            No additional prerequisites on this path.
          </p>
          <p v-else class="small text-secondary">
            AND requires every input; OR shows alternatives. The execution-order list identifies the
            chosen support plan. Expand an input to inspect its dependencies.
          </p>
          <p v-if="prerequisites.truncated" class="alert alert-warning small py-1">
            The prerequisite display limit was reached. Omitted branches are marked below.
          </p>
          <ul class="list-unstyled small">
            <AttackPrerequisite
              v-for="item in prerequisites.requirements"
              :key="item.node.id"
              :item="item"
              @inspect="$emit('inspect', $event)"
            />
          </ul>
        </template>
        <div v-else class="text-secondary" role="status">
          <p v-for="target in analysis.result.targetResults" :key="target.target">
            {{ nodes.get(target.target)?.fullName }}:
            {{ describeAttackPathTarget(target, analysis.result.maxHops) }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.attack-paths {
  background: #fff;
  flex-shrink: 0;
}
.path-results {
  display: grid;
  grid-template-columns: minmax(170px, 28%) minmax(0, 1fr);
  max-height: 42vh;
  overflow: auto;
}
.path-list,
.path-detail {
  min-width: 0;
  overflow: auto;
}
.main-path {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  list-style: none;
  padding: 0;
}
.main-path li {
  display: inline;
  max-width: 100%;
}
@media (max-width: 800px) {
  .path-results {
    grid-template-columns: 1fr;
  }
  .path-list {
    max-height: 160px;
  }
}
</style>

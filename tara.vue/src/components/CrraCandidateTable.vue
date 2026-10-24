<script setup>
import { effectLabel, crraScoreLabel } from '@/services/crra.js'

defineProps({
  candidates: { type: Array, required: true },
  selectedIds: { type: Array, required: true },
})
const emit = defineEmits(['edit', 'toggle'])
const typeValue = (mapping) =>
  mapping.effects === null
    ? '?'
    : [...new Set(mapping.effects.map((effect) => effect.type))].sort().join('+') || '-'
function changeType(cm, mapping, value) {
  emit('edit', cm.id, {
    avId: mapping.avId,
    effects:
      value === '?'
        ? null
        : value === '-'
          ? []
          : value.split('+').map((type) => ({
              type,
              level: mapping.effects?.find((effect) => effect.type === type)?.level || '',
            })),
  })
}
</script>

<template>
  <div class="table-responsive matrix-table-container">
    <table class="table table-bordered table-hover align-middle mb-0 matrix-table">
      <caption class="small">
        Scores use only selected AVs. Expand a CM to review mappings and edit effect
        classifications.
      </caption>
      <thead class="table-light">
        <tr>
          <th scope="col" class="text-center">Select</th>
          <th scope="col" class="cm-description">Countermeasure</th>
          <th scope="col" class="text-center text-nowrap">P / R</th>
          <th scope="col" class="text-center text-nowrap">Utility</th>
          <th scope="col" class="text-center text-nowrap">Cost</th>
          <th scope="col" class="text-center text-nowrap">U/C Ratio</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="cm in candidates" :key="cm.id" :class="{ 'table-secondary': cm.excluded }">
          <td class="text-center">
            <input
              type="checkbox"
              class="form-check-input"
              :aria-label="`Select ${cm.id}`"
              :checked="selectedIds.includes(cm.id) && !cm.excluded"
              :disabled="cm.excluded"
              @change="$emit('toggle', cm.id, $event.target.checked)"
            />
          </td>
          <th scope="row" class="fw-normal cm-description">
            <details>
              <summary>
                <strong>{{ cm.id }} · {{ cm.name }}</strong
                ><span v-if="cm.excluded" class="badge text-bg-secondary ms-2">Excluded</span>
              </summary>
              <p class="mt-2 text-muted">{{ cm.description }}</p>
              <a
                v-if="/^https?:\/\//.test(cm.url || '')"
                :href="cm.url"
                target="_blank"
                rel="noopener noreferrer"
                >MITRE source</a
              >
              <fieldset
                v-for="mapping in cm.mappings"
                :key="mapping.avId"
                class="border rounded p-2 mt-3"
              >
                <legend class="float-none w-auto fs-6 px-1 mb-0">
                  {{ mapping.avId }} · {{ effectLabel(mapping) }}
                </legend>
                <p class="small mb-1">
                  {{ mapping.evidence?.description || 'Mapping description unavailable.' }}
                </p>
                <label class="form-label" :for="`effect-${cm.id}-${mapping.avId}`"
                  >Effect classification</label
                >
                <select
                  :id="`effect-${cm.id}-${mapping.avId}`"
                  class="form-select form-select-sm"
                  :value="typeValue(mapping)"
                  @change="changeType(cm, mapping, $event.target.value)"
                >
                  <option value="?">Unassessed</option>
                  <option value="P">Preventative (P)</option>
                  <option value="R">Responsive (R)</option>
                  <option value="P+R">P + R</option>
                  <option value="D">Detect (D) only</option>
                  <option value="D+P">D + P</option>
                  <option value="D+R">D + R</option>
                  <option value="D+P+R">D + P + R</option>
                  <option value="-">Assessed: no effect</option>
                </select>
              </fieldset>
            </details>
            <ul v-if="cm.missing.length" class="text-danger mb-0 mt-1">
              <li v-for="item in cm.missing" :key="item">{{ item }}</li>
            </ul>
          </th>
          <td class="text-center text-nowrap">{{ cm.counts.P }} / {{ cm.counts.R }}</td>
          <td class="text-center text-nowrap">{{ crraScoreLabel(cm.utility) }}</td>
          <td class="text-center text-nowrap">
            <select
              :id="`cost-${cm.id}`"
              class="form-select form-select-sm cost-select"
              :aria-label="`Cost for ${cm.id}`"
              :value="cm.cost ?? ''"
              @change="$emit('edit', cm.id, { cost: Number($event.target.value) })"
            >
              <option disabled value="">-</option>
              <option v-for="cost in 5" :key="cost" :value="cost">{{ cost }}</option>
            </select>
          </td>
          <td class="text-center text-nowrap">{{ crraScoreLabel(cm.ratio) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped src="../assets/matrix-table.css"></style>

<style scoped>
.cm-description {
  min-width: 340px;
  max-width: 800px;
  overflow-wrap: anywhere;
}
.cost-select {
  min-width: 5rem;
}
summary {
  cursor: pointer;
}
tbody th,
tbody td {
  vertical-align: top;
}
</style>

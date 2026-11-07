<script setup>
import { computed } from 'vue'
import { effectLabel, crraScoreLabel, crraRatioLabel } from '@/services/crra.js'

const props = defineProps({
  candidates: { type: Array, required: true },
  selectedIds: { type: Array, required: true },
  vectors: { type: Array, default: () => [] },
  assets: { type: Array, default: () => [] },
})
const emit = defineEmits(['edit', 'toggle'])
const vectorDetails = computed(() => {
  const assetsById = new Map(props.assets.map((asset) => [asset.id, asset]))
  return new Map(
    props.vectors.map((vector) => [
      vector.avId,
      {
        name: vector.attackVector === vector.avId ? '' : vector.attackVector,
        assets: (vector.cells || [])
          .filter((cell) => Number.isFinite(cell.riskScore))
          .map((cell) => ({
            id: cell.cartId,
            name: assetsById.get(cell.cartId)?.name || cell.cartId,
          })),
      },
    ]),
  )
})
const mitigationLabel = (cm) => (cm.sourceIds?.length ? cm.sourceIds : [cm.id]).join(' / ')
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
  <div class="table-responsive matrix-table-container candidate-table-container">
    <table class="table table-bordered table-hover align-middle mb-0 matrix-table candidate-table">
      <caption class="small">
        Scores use only selected AVs. Expand a CM to review Technique names, mapped diagram assets
        and effect classifications. UN R155 references share the assessed Attack Steps; expand a
        reference to read its mitigation.
      </caption>
      <colgroup>
        <col class="cm-selection-column" />
        <col />
        <col class="cm-un-r155-column" />
        <col class="cm-effects-column" />
        <col class="cm-utility-column" />
        <col class="cm-cost-column" />
        <col class="cm-ratio-column" />
      </colgroup>
      <thead class="table-light">
        <tr>
          <th scope="col" class="text-center">
            Include in solution
            <span class="d-block small text-muted fw-normal">Manual selection</span>
          </th>
          <th scope="col" class="cm-description">Countermeasure</th>
          <th scope="col" class="text-nowrap">UN R155 Ref</th>
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
              :aria-label="`Include ${mitigationLabel(cm)} in solution`"
              :checked="selectedIds.includes(cm.id) && !cm.excluded"
              :disabled="cm.excluded"
              @change="$emit('toggle', cm.id, $event.target.checked)"
            />
          </td>
          <th scope="row" class="fw-normal cm-description">
            <details>
              <summary>
                <strong>{{ mitigationLabel(cm) }} · {{ cm.name }}</strong
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
                  <span class="d-block small text-muted">MITRE ATT&amp;CK Technique</span>
                  <strong>
                    {{ mapping.avId }} ·
                    {{ vectorDetails.get(mapping.avId)?.name || 'Technique name unavailable' }}
                  </strong>
                </legend>
                <p class="small mt-2 mb-2">
                  <span class="fw-semibold">Effect:</span> {{ effectLabel(mapping) }}
                </p>
                <div class="small mb-2">
                  <p class="fw-semibold mb-1">
                    Mapped assets ({{ vectorDetails.get(mapping.avId)?.assets.length || 0 }})
                  </p>
                  <ul v-if="vectorDetails.get(mapping.avId)?.assets.length" class="ps-3 mb-0">
                    <li v-for="asset in vectorDetails.get(mapping.avId).assets" :key="asset.id">
                      <span class="fw-medium">{{ asset.name }}</span>
                      <span class="text-muted ms-1">(ID: {{ asset.id }})</span>
                    </li>
                  </ul>
                  <p v-else class="text-muted mb-0">No assessed asset mappings.</p>
                </div>
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
          <td class="cm-un-r155">
            <ul v-if="cm.unR155Refs?.length" class="list-unstyled mb-0">
              <li v-for="ref in cm.unR155Refs" :key="ref.id">
                <details>
                  <summary :title="ref.descriptions.join('\n')">
                    Part {{ ref.parts.join(' / ') }} · {{ ref.id }}
                  </summary>
                  <p
                    v-for="description in ref.descriptions"
                    :key="description"
                    class="small text-muted mt-1 mb-2"
                  >
                    {{ description }}
                  </p>
                </details>
              </li>
            </ul>
            <span v-else class="text-muted">—</span>
          </td>
          <td class="text-center text-nowrap">{{ cm.counts.P }} / {{ cm.counts.R }}</td>
          <td class="text-center text-nowrap">{{ crraScoreLabel(cm.utility) }}</td>
          <td class="text-center text-nowrap">
            <select
              :id="`cost-${cm.id}`"
              class="form-select form-select-sm cost-select"
              :aria-label="`Cost for ${mitigationLabel(cm)}`"
              :value="cm.cost ?? ''"
              @change="$emit('edit', cm.id, { cost: Number($event.target.value) })"
            >
              <option disabled value="">-</option>
              <option v-for="cost in 5" :key="cost" :value="cost">{{ cost }}</option>
            </select>
          </td>
          <td class="text-center text-nowrap">{{ crraRatioLabel(cm.ratio) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped src="../assets/matrix-table.css"></style>

<style scoped>
.candidate-table-container {
  height: 55dvh;
  overflow: auto;
  scrollbar-gutter: stable;
}
.candidate-table {
  width: 100%;
  min-width: 1100px;
  table-layout: fixed;
}
.cm-selection-column {
  width: 9rem;
}
.cm-un-r155-column {
  width: 15rem;
}
.cm-effects-column {
  width: 5rem;
}
.cm-utility-column {
  width: 6rem;
}
.cm-cost-column,
.cm-ratio-column {
  width: 7rem;
}
.cm-description,
.cm-un-r155 {
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

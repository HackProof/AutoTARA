<script setup>
defineProps({
  results: { type: Array, required: true },
  selectedId: { type: String, default: null },
})
defineEmits(['select'])

const factors = [
  { key: 'proximity', label: 'Proximity' },
  { key: 'Required Skills', label: 'Required Skills' },
  { key: 'Required Resources', label: 'Required Resources' },
]
</script>

<template>
  <div>
    <section v-for="afr in results" :key="afr.target.id" class="mb-3">
      <h4 class="small fw-bold text-break mb-1">
        Target: {{ afr.target.fullName || `${afr.target.asset}:${afr.target.name}` }}
      </h4>
      <template v-if="afr.attackVectors.length">
        <p class="text-secondary mb-1">
          {{ afr.attackVectors.length }} Attack Steps used in the maximum calculation. Max marks
          each factor's maximum, including ties.
        </p>
        <div class="table-responsive">
          <table class="table table-sm align-middle mb-0" aria-label="Attack Steps used for AFR">
            <thead>
              <tr>
                <th scope="col">Attack Step</th>
                <th v-for="factor in factors" :key="factor.key" scope="col">{{ factor.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="vector in afr.attackVectors" :key="vector.node.id">
                <th scope="row" class="text-break">
                  <button
                    type="button"
                    class="btn btn-link btn-sm p-0 text-start text-break"
                    :aria-pressed="selectedId === vector.node.id"
                    @click="$emit('select', vector.node)"
                  >
                    {{ vector.node.fullName || `${vector.node.asset}:${vector.node.name}` }}
                  </button>
                </th>
                <td v-for="factor in factors" :key="factor.key">
                  {{ vector.factors[factor.key] }}
                  <span
                    v-if="vector.factors[factor.key] === afr.maxima[factor.key]"
                    class="badge text-bg-primary ms-1"
                    >Max</span
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p v-else class="text-secondary mb-0">
        No Attack Steps were used to calculate AFR for this Target.
      </p>
    </section>
  </div>
</template>

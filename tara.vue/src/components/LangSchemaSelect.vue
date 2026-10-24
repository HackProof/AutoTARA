<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { catalogErrorMessage, fetchLangSchemas } from '@/services/threatCatalog.js'

defineProps({
  modelValue: { type: String, default: '' },
  id: { type: String, required: true },
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
const schemas = ref([])
const loading = ref(false)
const error = ref('')
let controller

async function loadSchemas() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  error.value = ''
  try {
    const result = await fetchLangSchemas({ signal: request.signal })
    if (!request.signal.aborted) schemas.value = result
  } catch (cause) {
    if (!request.signal.aborted) error.value = catalogErrorMessage(cause)
  } finally {
    if (!request.signal.aborted) loading.value = false
  }
}
onMounted(loadSchemas)
onBeforeUnmount(() => controller?.abort())
defineExpose({ refresh: loadSchemas })
</script>

<template>
  <div>
    <label :for="id" class="form-label fw-bold" :class="compact ? 'small mb-1' : 'fs-5'">
      DB Schema (Lang) <span class="text-muted fw-normal">(Optional)</span>
    </label>
    <select
      :id="id"
      :value="modelValue"
      class="form-select"
      :class="{ 'form-select-sm': compact }"
      :disabled="loading"
      :aria-describedby="`${id}-help`"
      @change="emit('update:modelValue', $event.target.value)"
    >
      <option value="">No database catalog</option>
      <option
        v-if="modelValue && !schemas.some((entry) => entry.schema === modelValue)"
        :value="modelValue"
      >
        {{ modelValue }} (unavailable)
      </option>
      <option v-for="entry in schemas" :key="entry.schema" :value="entry.schema">
        {{ entry.label }} ({{ entry.schema }})
      </option>
    </select>
    <div :id="`${id}-help`" class="form-text" aria-live="polite">
      <span v-if="loading">Loading language schemas…</span>
      <span v-else-if="error" class="text-danger">{{ error }}</span>
      <span v-else-if="!schemas.length">No language catalogs are available in the database.</span>
      <span v-else>Load asset attack steps and MITRE ATT&amp;CK / UN R155 mappings.</span>
      <button
        v-if="!loading && (error || !schemas.length)"
        type="button"
        class="btn btn-sm btn-outline-secondary mt-1"
        @click="loadSchemas"
      >
        Retry
      </button>
    </div>
  </div>
</template>

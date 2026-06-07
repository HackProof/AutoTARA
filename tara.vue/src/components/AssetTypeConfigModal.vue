<template>
  <div v-if="visible" class="modal-backdrop fade show"></div>
  <div
    class="modal fade"
    :class="{ 'show d-block': visible }"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    @click.self="handleCancel"
  >
    <div class="modal-dialog modal-lg modal-dialog-scrollable" role="document">
      <div class="modal-content">
        <div class="modal-header bg-light">
          <h5 class="modal-title">
            <i class="fa-solid fa-shapes text-primary me-2"></i>
            Configure Asset Types
          </h5>
          <button type="button" class="btn-close" aria-label="Close" @click="handleCancel"></button>
        </div>

        <div class="modal-body">
          <!-- Description -->
          <div class="alert alert-info small mb-3">
            <i class="fa-solid fa-info-circle me-2"></i>
            Set the DFD element type for each identified asset. This determines how each asset is displayed in the diagram.
          </div>

          <!-- Asset List Table -->
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th style="width: 40%;">Asset Name</th>
                  <th style="width: 30%;">MAL Type</th>
                  <th style="width: 30%;">Asset Type</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(asset, index) in localAssets" :key="asset.id">
                  <td>
                    <span class="fw-medium">{{ asset.name }}</span>
                  </td>
                  <td>
                    <span class="badge bg-secondary">{{ asset.malType }}</span>
                  </td>
                  <td>
                    <select 
                      class="form-select form-select-sm"
                      v-model="localAssets[index].dfdShape"
                    >
                      <option value="process">Process</option>
                      <option value="actor">Actor</option>
                      <option value="store">Data Store</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Quick Actions -->
          <div class="mt-3 d-flex gap-2 justify-content-end">
            <button class="btn btn-sm btn-outline-secondary" @click="setAllTo('process')">
              All to Process
            </button>
            <button class="btn btn-sm btn-outline-secondary" @click="setAllTo('actor')">
              All to Actor
            </button>
            <button class="btn btn-sm btn-outline-secondary" @click="setAllTo('store')">
              All to Data Store
            </button>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="handleCancel">
            <i class="fa-solid fa-times me-1"></i>
            Cancel
          </button>
          <button type="button" class="btn btn-primary" @click="handleConfirm">
            <i class="fa-solid fa-check me-1"></i>
            Apply
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  assets: {
    type: Array,
    default: () => []
    // Expected format: [{ id, name, malType, dfdShape }]
  }
});

const emit = defineEmits(['confirm', 'cancel']);

// Local copy of assets for editing
const localAssets = ref([]);

// Watch for assets prop changes and create a local copy
watch(() => props.assets, (newAssets) => {
  localAssets.value = newAssets.map(asset => ({
    ...asset,
    dfdShape: asset.dfdShape || 'process'
  }));
}, { immediate: true, deep: true });

// Set all assets to a specific shape
const setAllTo = (shape) => {
  localAssets.value.forEach(asset => {
    asset.dfdShape = shape;
  });
};

const handleConfirm = () => {
  emit('confirm', localAssets.value);
};

const handleCancel = () => {
  emit('cancel');
};
</script>

<style scoped>
.modal-dialog.modal-lg {
  max-width: 700px;
}

.form-select-sm {
  font-size: 0.875rem;
  padding: 0.25rem 0.5rem;
}

.table th {
  font-size: 0.8rem;
  text-transform: uppercase;
  color: #6c757d;
  font-weight: 600;
}

.table td {
  vertical-align: middle;
}
</style>

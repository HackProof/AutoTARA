<template>
  <div class="mitre-admin py-4">
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-4">
      <div>
        <h2 class="fw-bold mb-1">MITRE Schema Admin</h2>
        <div class="text-muted small">Manage MITRE techniques, mitigations, scoring, and MAL attack-step mappings.</div>
      </div>
      <button class="btn btn-outline-secondary" type="button" @click="loadRows" :disabled="isLoading">
        <i class="fa-solid fa-rotate me-1"></i>
        Refresh
      </button>
    </div>

    <div v-if="errorMessage" class="alert alert-danger d-flex justify-content-between align-items-start gap-3">
      <span>{{ errorMessage }}</span>
      <button type="button" class="btn-close" @click="errorMessage = ''"></button>
    </div>

    <ul class="nav nav-tabs mb-3">
      <li v-for="table in tables" :key="table.key" class="nav-item">
        <button
          type="button"
          class="nav-link"
          :class="{ active: selectedTableKey === table.key }"
          @click="selectTable(table.key)"
        >
          {{ formatTableName(table.key) }}
        </button>
      </li>
    </ul>

    <div class="row g-3">
      <div class="col-12">
        <div v-if="selectedTable" class="border rounded bg-white overflow-hidden">
          <div class="admin-toolbar border-bottom p-3">
            <div class="input-group search-control">
              <span class="input-group-text"><i class="fa-solid fa-magnifying-glass"></i></span>
              <input
                v-model.trim="searchText"
                type="search"
                class="form-control"
                placeholder="Search records"
                @keyup.enter="runSearch"
              >
              <button class="btn btn-outline-secondary" type="button" @click="runSearch">Search</button>
            </div>
            <div class="d-flex flex-wrap align-items-center gap-3">
              <div class="form-check form-switch mb-0">
                <input id="show-all-columns" v-model="showAllColumns" class="form-check-input" type="checkbox">
                <label class="form-check-label small" for="show-all-columns">Show all columns</label>
              </div>
              <button class="btn btn-primary" type="button" @click="startCreate">
                <i class="fa-solid fa-plus me-1"></i>
                Add
              </button>
            </div>
          </div>

          <div v-if="isLoading" class="p-5 text-center">
            <div class="spinner-border text-primary" role="status">
              <span class="visually-hidden">Loading...</span>
            </div>
          </div>

          <div v-else class="table-responsive admin-table-wrap">
            <table class="table table-sm table-hover align-middle mb-0 admin-table">
              <colgroup>
                <col
                  v-for="column in visibleColumns"
                  :key="`col-${column.name}`"
                  :style="{ width: columnWidth(column.name) }"
                >
                <col style="width: 96px">
              </colgroup>
              <thead class="table-light">
                <tr>
                  <th
                    v-for="column in visibleColumns"
                    :key="column.name"
                    :class="headerCellClass(column.name)"
                  >
                    {{ formatColumnName(column.name) }}
                  </th>
                  <th class="actions-column text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="rowKey(row)">
                  <td
                    v-for="column in visibleColumns"
                    :key="`${rowKey(row)}-${column.name}`"
                    class="record-cell"
                    :class="recordCellClass(column.name)"
                    :title="formatCell(row[column.name])"
                  >
                    <span class="cell-content" :class="cellValueClass(column.name)">
                      {{ formatCell(row[column.name]) }}
                    </span>
                  </td>
                  <td class="actions-cell">
                    <button class="btn btn-sm btn-outline-primary me-1" type="button" @click="startEdit(row)">
                      <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" type="button" @click="deleteRow(row)">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </td>
                </tr>
                <tr v-if="rows.length === 0">
                  <td :colspan="visibleColumns.length + 1" class="text-center text-muted py-4">
                    No records found.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="pagination-bar border-top px-3 py-2">
            <div class="small text-muted">
              Showing {{ pageStart }}-{{ pageEnd }} of {{ totalRows }} records.
            </div>
            <div class="d-flex align-items-center gap-2">
              <button class="btn btn-sm btn-outline-secondary" type="button" @click="previousPage" :disabled="!canGoPrevious || isLoading">
                <i class="fa-solid fa-chevron-left"></i>
              </button>
              <span class="small text-muted">Page {{ currentPage }} / {{ totalPages }}</span>
              <button class="btn btn-sm btn-outline-secondary" type="button" @click="nextPage" :disabled="!canGoNext || isLoading">
                <i class="fa-solid fa-chevron-right"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>

    <div
      v-if="isFormOpen"
      class="modal fade show admin-modal"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      style="display: block"
    >
      <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ isEditing ? 'Edit Record' : 'New Record' }}</h5>
            <button type="button" class="btn-close" aria-label="Close" @click="closeForm"></button>
          </div>

          <div class="modal-body">
            <form id="mitre-record-form" class="record-form-grid" @submit.prevent="saveRecord">
              <div v-for="column in editableColumns" :key="column.name">
                <label class="form-label small fw-semibold" :for="`field-${column.name}`">
                  {{ column.name }}
                  <span v-if="column.required" class="text-danger">*</span>
                </label>
                <textarea
                  v-if="column.type === 'textarea'"
                  :id="`field-${column.name}`"
                  v-model="form[column.name]"
                  class="form-control form-control-sm"
                  rows="3"
                  :disabled="isPrimaryKey(column.name) && isEditing"
                ></textarea>
                <input
                  v-else
                  :id="`field-${column.name}`"
                  v-model="form[column.name]"
                  :type="column.type === 'number' ? 'number' : 'text'"
                  class="form-control form-control-sm"
                  :step="column.type === 'number' ? '0.0001' : undefined"
                  :disabled="isPrimaryKey(column.name) && isEditing"
                >
              </div>
            </form>

            <section v-if="showMalMapping" class="border rounded bg-light-subtle mt-4">
              <div class="border-bottom px-3 py-2 fw-semibold">
                MAL Attack Step Mapping
              </div>
              <div class="p-3 d-grid gap-3">
                <div>
                  <label class="form-label small fw-semibold" for="mal-file">MAL file</label>
                  <input id="mal-file" class="form-control form-control-sm" type="file" accept=".mal,text/plain" @change="onMalFileChange">
                </div>
                <button class="btn btn-outline-primary align-self-start" type="button" @click="parseMalFile" :disabled="!malFile || isParsingMal">
                  <span v-if="isParsingMal" class="spinner-border spinner-border-sm me-1" role="status"></span>
                  <i v-else class="fa-solid fa-file-import me-1"></i>
                  Parse MAL
                </button>

                <div v-if="malParseResult" class="small text-muted">
                  Parsed {{ malParseResult.assetCount }} assets and {{ malParseResult.attackStepCount }} attack steps.
                </div>

                <template v-if="malAssets.length > 0">
                  <div class="row g-3">
                    <div class="col-12 col-lg-6">
                      <label class="form-label small fw-semibold" for="mal-asset">Asset</label>
                      <select id="mal-asset" v-model="selectedMalAssetKey" class="form-select form-select-sm">
                        <option v-for="asset in malAssets" :key="assetKey(asset)" :value="assetKey(asset)">
                          {{ asset.category || 'Uncategorized' }} / {{ asset.asset }}
                        </option>
                      </select>
                    </div>

                    <div class="col-12 col-lg-6">
                      <label class="form-label small fw-semibold" for="mal-step">Attack Step</label>
                      <select id="mal-step" v-model="selectedMalStepName" class="form-select form-select-sm">
                        <option v-for="step in selectedMalAssetSteps" :key="step.step_name" :value="step.step_name">
                          {{ step.step_name }}{{ step.hidden ? ' (@hidden)' : '' }}
                        </option>
                      </select>
                    </div>

                    <div class="col-12">
                      <label class="form-label small fw-semibold" for="technique-filter">Technique Filter</label>
                      <input id="technique-filter" v-model.trim="techniqueFilter" class="form-control form-control-sm" type="search" placeholder="Technique ID or name">
                    </div>

                    <div class="col-12">
                      <label class="form-label small fw-semibold" for="mitre-technique">MITRE Technique</label>
                      <select id="mitre-technique" v-model="selectedTechniqueId" class="form-select form-select-sm">
                        <option value="">Select technique</option>
                        <option v-for="technique in filteredTechniques" :key="technique.id" :value="technique.id">
                          {{ technique.id }} - {{ technique.name }}
                        </option>
                      </select>
                    </div>

                    <div class="col-12 col-md-4">
                      <label class="form-label small fw-semibold" for="tactic-id">Tactic ID</label>
                      <input id="tactic-id" v-model.trim="mappingDefaults.inferred_tactic_id" class="form-control form-control-sm">
                    </div>
                    <div class="col-12 col-md-4">
                      <label class="form-label small fw-semibold" for="tactic-name">Tactic</label>
                      <input id="tactic-name" v-model.trim="mappingDefaults.inferred_tactic" class="form-control form-control-sm">
                    </div>
                    <div class="col-12 col-md-4">
                      <label class="form-label small fw-semibold" for="technique-tactics">Technique Tactics</label>
                      <input id="technique-tactics" v-model.trim="mappingDefaults.technique_tactics" class="form-control form-control-sm">
                    </div>
                  </div>

                  <button class="btn btn-success align-self-start" type="button" @click="createMappingFromMal" :disabled="!canCreateMalMapping || isSaving">
                    <i class="fa-solid fa-link me-1"></i>
                    Create Mapping
                  </button>
                </template>
              </div>
            </section>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" @click="closeForm">
              Cancel
            </button>
            <button class="btn btn-primary" type="submit" form="mitre-record-form" :disabled="isSaving">
              <span v-if="isSaving" class="spinner-border spinner-border-sm me-1" role="status"></span>
              <i v-else class="fa-solid fa-floppy-disk me-1"></i>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
    <div v-if="isFormOpen" class="modal-backdrop fade show"></div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useToast } from 'vue-toastification';
import apiClient from '@/api/axios';

const toast = useToast();

const tables = ref([]);
const selectedTableKey = ref('dfd_techniques');
const rows = ref([]);
const totalRows = ref(0);
const searchText = ref('');
const showAllColumns = ref(false);
const pageSize = 100;
const currentPage = ref(1);
const form = reactive({});
const editingKey = ref(null);
const isFormOpen = ref(false);
const isLoading = ref(false);
const isSaving = ref(false);
const errorMessage = ref('');

const malFile = ref(null);
const isParsingMal = ref(false);
const malParseResult = ref(null);
const selectedMalAssetKey = ref('');
const selectedMalStepName = ref('');
const techniques = ref([]);
const selectedTechniqueId = ref('');
const techniqueFilter = ref('');
const mappingDefaults = reactive({
  inferred_tactic_id: '',
  inferred_tactic: '',
  technique_tactics: ''
});

const selectedTable = computed(() =>
  tables.value.find((table) => table.key === selectedTableKey.value) || null
);

const editableColumns = computed(() =>
  (selectedTable.value?.columns || []).filter((column) => !column.readonly)
);

const compactColumnsByTable = {
  dfd_techniques: ['id', 'category', 'asset', 'parent', 'step_name', 'technique_id', 'technique_name'],
  techniques: ['id', 'name', 'description'],
  mitigations: ['id', 'name', 'description'],
  mitigation_technique: ['mitigation_id', 'technique_id', 'm_description'],
  ttp_scoring: ['technique_id', 'Proximity', 'Locality', 'Impact_C', 'Impact_I', 'Impact_A', 'Required Skills', 'Required Resources'],
  ttp_scoring_reason: ['technique_id', 'reason_impact_c', 'reason_impact_i', 'reason_impact_a', 'reason_required_skills', 'reason_required_resources']
};

const visibleColumns = computed(() => {
  const columns = selectedTable.value?.columns || [];
  if (showAllColumns.value) return columns;

  const compactNames = compactColumnsByTable[selectedTableKey.value];
  if (compactNames) {
    return compactNames
      .map((name) => columns.find((column) => column.name === name))
      .filter(Boolean);
  }

  return columns
    .filter((column) => !['created_at', 'updated_at'].includes(column.name))
    .slice(0, 8);
});

const isEditing = computed(() => Boolean(editingKey.value));

const showMalMapping = computed(() =>
  selectedTableKey.value === 'dfd_techniques' && !isEditing.value
);

const totalPages = computed(() =>
  Math.max(Math.ceil(totalRows.value / pageSize), 1)
);

const pageStart = computed(() => {
  if (totalRows.value === 0) return 0;
  return (currentPage.value - 1) * pageSize + 1;
});

const pageEnd = computed(() =>
  Math.min(currentPage.value * pageSize, totalRows.value)
);

const canGoPrevious = computed(() => currentPage.value > 1);

const canGoNext = computed(() => currentPage.value < totalPages.value);

const malAssets = computed(() => malParseResult.value?.assets || []);

const selectedMalAsset = computed(() =>
  malAssets.value.find((asset) => assetKey(asset) === selectedMalAssetKey.value) || null
);

const selectedMalAssetSteps = computed(() =>
  selectedMalAsset.value?.attackSteps || []
);

const selectedTechnique = computed(() =>
  techniques.value.find((technique) => technique.id === selectedTechniqueId.value) || null
);

const filteredTechniques = computed(() => {
  const filter = techniqueFilter.value.toLowerCase();
  if (!filter) return techniques.value;
  return techniques.value.filter((technique) =>
    `${technique.id} ${technique.name}`.toLowerCase().includes(filter)
  );
});

const canCreateMalMapping = computed(() =>
  Boolean(selectedMalAsset.value && selectedMalStepName.value && selectedTechnique.value)
);

watch(selectedTableKey, () => {
  searchText.value = '';
  showAllColumns.value = false;
  currentPage.value = 1;
  editingKey.value = null;
  isFormOpen.value = false;
  resetForm();
  loadRows();
  if (selectedTableKey.value === 'dfd_techniques') {
    loadTechniques();
  }
});

watch(selectedMalAssetKey, () => {
  selectedMalStepName.value = selectedMalAssetSteps.value[0]?.step_name || '';
});

onMounted(async () => {
  await loadTables();
  await loadRows();
  await loadTechniques();
});

async function loadTables() {
  try {
    const { data } = await apiClient.get('/v1/mitre/admin/tables');
    tables.value = data;
    if (!tables.value.some((table) => table.key === selectedTableKey.value)) {
      selectedTableKey.value = tables.value[0]?.key || '';
    }
    editingKey.value = null;
    isFormOpen.value = false;
    resetForm();
  } catch (error) {
    showError(error, 'Failed to load MITRE table definitions.');
  }
}

async function loadRows() {
  if (!selectedTableKey.value) return;
  isLoading.value = true;
  errorMessage.value = '';

  try {
    const { data } = await apiClient.get(`/v1/mitre/admin/${selectedTableKey.value}`, {
      params: {
        search: searchText.value || undefined,
        limit: pageSize,
        offset: (currentPage.value - 1) * pageSize
      }
    });
    rows.value = data.rows || [];
    totalRows.value = data.total || 0;

    if (rows.value.length === 0 && totalRows.value > 0 && currentPage.value > 1) {
      currentPage.value -= 1;
      await loadRows();
    }
  } catch (error) {
    showError(error, 'Failed to load records.');
  } finally {
    isLoading.value = false;
  }
}

function runSearch() {
  currentPage.value = 1;
  loadRows();
}

function previousPage() {
  if (!canGoPrevious.value) return;
  currentPage.value -= 1;
  loadRows();
}

function nextPage() {
  if (!canGoNext.value) return;
  currentPage.value += 1;
  loadRows();
}

async function loadTechniques() {
  try {
    const { data } = await apiClient.get('/v1/mitre/admin/techniques', {
      params: { limit: 500 }
    });
    techniques.value = data.rows || [];
  } catch (error) {
    showError(error, 'Failed to load MITRE techniques.');
  }
}

function selectTable(tableKey) {
  selectedTableKey.value = tableKey;
}

function startCreate() {
  editingKey.value = null;
  resetForm();
  resetMalMapping();
  isFormOpen.value = true;
}

function startEdit(row) {
  editingKey.value = extractKey(row);
  resetForm(row);
  resetMalMapping();
  isFormOpen.value = true;
}

function closeForm() {
  editingKey.value = null;
  isFormOpen.value = false;
  resetForm();
  resetMalMapping();
}

function resetForm(source = {}) {
  Object.keys(form).forEach((key) => {
    delete form[key];
  });

  for (const column of editableColumns.value) {
    form[column.name] = source[column.name] ?? '';
  }
}

function resetMalMapping() {
  malFile.value = null;
  malParseResult.value = null;
  selectedMalAssetKey.value = '';
  selectedMalStepName.value = '';
  selectedTechniqueId.value = '';
  techniqueFilter.value = '';
  mappingDefaults.inferred_tactic_id = '';
  mappingDefaults.inferred_tactic = '';
  mappingDefaults.technique_tactics = '';
}

function payloadFromForm() {
  return editableColumns.value.reduce((payload, column) => {
    payload[column.name] = form[column.name];
    return payload;
  }, {});
}

async function saveRecord() {
  isSaving.value = true;
  errorMessage.value = '';

  try {
    if (isEditing.value) {
      await apiClient.put(`/v1/mitre/admin/${selectedTableKey.value}`, {
        key: editingKey.value,
        values: payloadFromForm()
      });
      toast.success('Record updated.');
    } else {
      await apiClient.post(`/v1/mitre/admin/${selectedTableKey.value}`, payloadFromForm());
      toast.success('Record created.');
    }

    await loadRows();
    closeForm();
  } catch (error) {
    showError(error, 'Save failed.');
  } finally {
    isSaving.value = false;
  }
}

async function deleteRow(row) {
  if (!confirm('Delete this MITRE record?')) return;

  try {
    await apiClient.delete(`/v1/mitre/admin/${selectedTableKey.value}`, {
      data: { key: extractKey(row) }
    });
    toast.success('Record deleted.');
    await loadRows();
    if (JSON.stringify(editingKey.value) === JSON.stringify(extractKey(row))) {
      closeForm();
    }
  } catch (error) {
    showError(error, 'Delete failed.');
  }
}

function extractKey(row) {
  return (selectedTable.value?.primaryKey || []).reduce((key, columnName) => {
    key[columnName] = row[columnName];
    return key;
  }, {});
}

function rowKey(row) {
  return JSON.stringify(extractKey(row));
}

function formatCell(value) {
  if (value === null || value === undefined || value === '') return 'N/A';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : Number(value).toFixed(2);
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    }
  }
  return String(value);
}

function formatTableName(value) {
  return value.replace(/_/g, ' ');
}

function formatColumnName(value) {
  return String(value)
    .replace(/^reason_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function columnWidth(columnName) {
  if (columnName === 'id') return '72px';
  if (columnName === 'technique_id' || columnName === 'mitigation_id') return '112px';
  if (columnName.endsWith('_id')) return '128px';
  if (['category', 'parent'].includes(columnName)) return '140px';
  if (['asset', 'step_name'].includes(columnName)) return '180px';
  if (columnName === 'name' || columnName === 'technique_name') return '260px';
  if (['description', 'm_description'].includes(columnName) || columnName.startsWith('reason_')) return '360px';
  if (['created_at', 'updated_at'].includes(columnName)) return '168px';
  if (isScoreColumn(columnName)) return '112px';
  return '160px';
}

function headerCellClass(columnName) {
  return isScoreColumn(columnName) ? 'text-end' : '';
}

function recordCellClass(columnName) {
  if (isScoreColumn(columnName)) {
    return 'record-cell-number';
  }

  if (['description', 'm_description'].includes(columnName) || columnName.startsWith('reason_')) {
    return 'record-cell-wide';
  }

  if (columnName === 'name' || columnName === 'technique_name') {
    return 'record-cell-name';
  }

  return '';
}

function cellValueClass(columnName) {
  if (columnName === 'id' || columnName.endsWith('_id') || columnName === 'technique_id' || columnName === 'mitigation_id') {
    return 'cell-badge';
  }

  if (['category', 'asset', 'step_name'].includes(columnName)) {
    return 'cell-strong';
  }

  return '';
}

function isScoreColumn(columnName) {
  return [
    'Proximity',
    'Locality',
    'Restoration Costs',
    'Impact_C',
    'Impact_I',
    'Impact_A',
    'Prior Use',
    'Required Skills',
    'Required Resources',
    'Stealth',
    'Attribution'
  ].includes(columnName);
}

function isPrimaryKey(columnName) {
  return selectedTable.value?.primaryKey?.includes(columnName);
}

function assetKey(asset) {
  return `${asset.category || ''}:${asset.asset}`;
}

function onMalFileChange(event) {
  malFile.value = event.target.files?.[0] || null;
}

async function parseMalFile() {
  if (!malFile.value) return;
  isParsingMal.value = true;
  errorMessage.value = '';

  try {
    const formData = new FormData();
    formData.append('mal', malFile.value);
    const { data } = await apiClient.post('/v1/mitre/admin/dfd-techniques/parse-mal', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    malParseResult.value = data;
    selectedMalAssetKey.value = data.assets?.[0] ? assetKey(data.assets[0]) : '';
    selectedMalStepName.value = selectedMalAssetSteps.value[0]?.step_name || '';
    toast.success('MAL file parsed.');
  } catch (error) {
    showError(error, 'MAL parsing failed.');
  } finally {
    isParsingMal.value = false;
  }
}

async function createMappingFromMal() {
  if (!canCreateMalMapping.value) return;

  const asset = selectedMalAsset.value;
  const technique = selectedTechnique.value;
  const payload = {
    category: asset.category || 'Uncategorized',
    asset: asset.asset,
    parent: asset.parent || '',
    step_name: selectedMalStepName.value,
    inferred_tactic_id: mappingDefaults.inferred_tactic_id,
    inferred_tactic: mappingDefaults.inferred_tactic,
    technique_id: technique.id,
    technique_name: technique.name,
    technique_tactics: mappingDefaults.technique_tactics
  };

  Object.keys(form).forEach((key) => {
    delete form[key];
  });
  Object.assign(form, payload);

  isSaving.value = true;
  try {
    await apiClient.post('/v1/mitre/admin/dfd_techniques', payload);
    toast.success('Mapping created.');
    await loadRows();
    closeForm();
  } catch (error) {
    showError(error, 'Mapping creation failed.');
  } finally {
    isSaving.value = false;
  }
}

function showError(error, fallback) {
  const message = error?.response?.data?.message || error?.message || fallback;
  errorMessage.value = `${fallback} ${message}`;
  toast.error(errorMessage.value);
}
</script>

<style scoped>
.mitre-admin {
  min-width: 0;
}

.admin-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: space-between;
  align-items: center;
}

.search-control {
  max-width: 520px;
}

.admin-table-wrap {
  max-height: 68vh;
  background: #fff;
}

.admin-table {
  width: max-content;
  min-width: 100%;
  table-layout: fixed;
  font-size: 0.86rem;
}

.admin-table th,
.admin-table td {
  padding: 0.48rem 0.62rem;
  border-color: #edf0f2;
}

.admin-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  white-space: nowrap;
  color: #495057;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.admin-table tbody tr:hover {
  background: #f8fafc;
}

.pagination-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.record-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.actions-column {
  width: 96px;
  text-align: center;
}

.actions-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  white-space: nowrap;
}

.record-cell {
  min-width: 0;
  overflow: hidden;
  line-height: 1.35;
  color: #343a40;
}

.record-cell-name {
  font-weight: 600;
}

.record-cell-number {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.record-cell-wide .cell-content {
  display: -webkit-box;
  white-space: normal;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cell-content {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-badge {
  display: inline-block;
  max-width: 100%;
  padding: 0.16rem 0.42rem;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #f6f8fa;
  color: #24292f;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.76rem;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}

.cell-strong {
  font-weight: 600;
  color: #212529;
}

.admin-table .btn-sm {
  --bs-btn-padding-y: 0.18rem;
  --bs-btn-padding-x: 0.38rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.85rem;
}

.nav-link {
  text-transform: capitalize;
}

@media (max-width: 768px) {
  .admin-toolbar {
    align-items: stretch;
  }

  .search-control {
    max-width: none;
    width: 100%;
  }

  .record-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>

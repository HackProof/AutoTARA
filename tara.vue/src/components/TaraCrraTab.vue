<template>
  <div class="row crra-card-row">
    <div class="col-md-6 crra-card-column">
      <div class="card mb-3 shadow-sm crra-card">
          <div class="card-header fw-bold bg-light">
            Countermeasure Catalog
            <span class="badge bg-secondary float-end">{{ filteredCMs.length }}</span>
          </div>
          <div class="card-body d-flex flex-column">
            <div class="input-group mb-3">
              <span class="input-group-text bg-white"><i class="fas fa-search"></i></span>
              <input type="text" class="form-control" v-model.trim="cmSearch" placeholder="Search firewall, encryption..." />
              <button class="btn btn-outline-secondary" type="button" @click="cmSearch = ''" v-if="cmSearch">X</button>
            </div>

            <div
              v-if="filteredCMs.length === 0"
              class="crra-catalog-scroll border-top d-flex flex-column justify-content-center align-items-center text-center text-muted px-3"
            >
              <i class="fas fa-database fa-3x mb-3 opacity-25"></i>
              <div>No countermeasure data available.</div>
              <div class="small">
                {{ cmSearch ? 'No countermeasures matched your search.' : 'MITRE countermeasures are not loaded in the database.' }}
              </div>
            </div>

            <div v-else class="crra-catalog-scroll list-group overflow-auto border-top">
              <div
                  v-for="cm in filteredCMs"
                  :key="cm.id"
                  class="list-group-item list-group-item-action d-flex justify-content-between align-items-start py-3"
              >
                <div class="me-2">
                  <div class="fw-bold text-dark">
                    <span class="badge bg-light text-dark border me-1">{{ cm.id }}</span>
                    {{ cm.name }}
                  </div>
                  <small class="text-muted d-block mt-1" style="font-size: 0.85rem; display:block; max-height: 100px; overflow-y: auto;">
                    {{ cm.description }}
                  </small>
                </div>
                <button class="btn btn-sm btn-success mt-1" @click="addCM(cm)" :disabled="isCMSelected(cm.id)">
                  <i class="fas" :class="isCMSelected(cm.id) ? 'fa-check' : 'fa-plus'"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

    <div class="col-md-6 crra-card-column">
      <div class="card mb-3 shadow-sm crra-card">
          <div class="card-header fw-bold bg-light">Selected Countermeasures</div>
          <div class="card-body p-0">
            <div class="table-responsive">
              <table class="table table-hover mb-0 align-middle small">
                <thead class="table-light">
                <tr>
                  <th style="width: 30px;"></th>
                  <th>Name</th>
                  <th style="width: 120px;">Type</th>
                  <th style="width: 120px;">Effect</th>
                  <th style="width: 120px;">Cost</th>
                  <th style="width: 60px;">U/C</th>
                  <th style="width: 40px;"></th>
                </tr>
                </thead>
                <tbody>
                <tr v-if="selectedCMs.length === 0">
                  <td colspan="10" class="text-center text-muted py-5">
                    <i class="fas fa-shield-alt fa-3x mb-3 text-secondary opacity-25"></i>
                    <div>No countermeasures selected.</div>
                    <div class="small">Select from the catalog to mitigate this threat.</div>
                  </td>
                </tr>
                <template v-for="(item, index) in selectedCMs" :key="item.id">
                  <tr>
                    <td class="text-center">
                      <button 
                        class="btn btn-sm p-0 text-secondary" 
                        @click="toggleRow(item.id)"
                        v-if="item.nist_controls && item.nist_controls.length > 0"
                      >
                        <i class="fas" :class="isRowExpanded(item.id) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
                      </button>
                    </td>
                    <td>
                      <div class="fw-bold">{{ item.name }}</div>
                      <div class="text-muted text-xs">{{ item.id }}</div>
                    </td>
                    <td>
                      <select class="form-select form-select-sm" v-model="item.mitigationTypes">
                        <option value="prevent">Prevent</option>
                        <option value="detect">Detect</option>
                        <option value="respond">Respond</option>
                      </select>
                    </td>
                    <td>
                      <select class="form-select form-select-sm" v-model="item.effectiveness">
                        <option :value="1">Low</option>
                        <option :value="2">Medium</option>
                        <option :value="3">High</option>
                      </select>
                    </td>
                    <td>
                      <select class="form-select form-select-sm" v-model="item.cost">
                        <option :value="1">Low</option>
                        <option :value="2">Medium</option>
                        <option :value="3">High</option>
                      </select>
                    </td>
                    <td class="text-center">
                      <span class="badge bg-dark">{{ calcUC(item).toFixed(1) }}</span>
                    </td>
                    <td class="text-center">
                      <button class="btn btn-sm btn-link text-danger p-0" @click="deleteCM(item.id)">
                        <i class="fas fa-trash-alt"></i>
                      </button>
                    </td>
                  </tr>
                  <tr v-if="isRowExpanded(item.id)" class="bg-light">
                    <td colspan="7" class="p-3">
                      <div class="card border-0 shadow-sm">
                         <div class="card-header bg-white border-bottom-0 fw-bold text-primary">
                           <i class="fas fa-list-ul me-2"></i> NIST 800-53 Controls Mapping
                         </div>
                         <div class="card-body p-0">
                           <table class="table table-bordered mb-0 table-sm" style="font-size: 0.8rem;">
                             <thead class="bg-light text-secondary">
                               <tr>
                                 <th style="width: 15%;">Control ID</th>
                                 <th style="width: 25%;">Control Name</th>
                                 <th style="width: 60%;">Description</th>
                               </tr>
                             </thead>
                             <tbody>
                               <tr v-for="ctrl in item.nist_controls" :key="ctrl.id">
                                 <td class="fw-bold text-center">{{ ctrl.id }}</td>
                                 <td>{{ ctrl.name }}</td>
                                 <td class="text-muted">{{ ctrl.description }}</td>
                               </tr>
                             </tbody>
                           </table>
                         </div>
                      </div>
                    </td>
                  </tr>
                </template>
                </tbody>
              </table>
            </div>
          </div>
          <div class="card-footer d-flex justify-content-end align-items-center bg-white">
            <button class="btn btn-sm btn-outline-secondary" @click="sortCMs" :disabled="selectedCMs.length < 2">
              <i class="fas fa-sort-amount-down me-1"></i> Sort by Efficiency (U/C)
            </button>
          </div>
        </div>
    </div>
  </div>
</template>

<script setup>
import {computed, onMounted, reactive, ref, watch} from "vue"
import axios from "axios"
import {useThreatEditStore} from "@/stores/threatEditStore.js";
import {useThreatModelStore} from "@/stores/threatModelStore.js";
import {storeToRefs} from "pinia";

const editStore = useThreatEditStore();
const tmStore = useThreatModelStore();

const { threatData } = storeToRefs(editStore);

const selectedCMs = reactive([]);
const expandedRows = ref([]);

const cmSearch = ref('');
const isCMSelected = (id) => selectedCMs.some(c => c.id === id);
const calcUC = (item) => (item.effectiveness * 10) / item.cost;
const sortCMs = () => { selectedCMs.sort((a, b) => calcUC(b) - calcUC(a)); };

const toggleRow = (id) => {
  const idx = expandedRows.value.indexOf(id);
  if (idx === -1) expandedRows.value.push(id);
  else expandedRows.value.splice(idx, 1);
};

const isRowExpanded = (id) => expandedRows.value.includes(id);

const addCM = (cm) => {
  if (!isCMSelected(cm.id)) {
    selectedCMs.push({
      ...cm,
      mitigationTypes: 'prevent',
      effectiveness: 2, // Medium default
      cost: 2, // Medium default
      nist_controls: Array.isArray(cm.nist_controls) ? cm.nist_controls : []
    });
  }
  tmStore.setModified()
};

const deleteCM = (cmId) => {
  const index = selectedCMs.findIndex(c => c.id === cmId);
  if (index !== -1) {
    selectedCMs.splice(index, 1);
  }
  tmStore.setModified()
};

// selectedCm 을 watch 하고 있다가 변경사항이 있으면 editStore.threatData.selectedCMs 에도 반영
watch(selectedCMs, (newVal) => {
  editStore.threatData.selectedCMs = JSON.parse(JSON.stringify(newVal));
}, { deep: true });

const allCMs = ref([]);

const filteredCMs = computed(() => {
  if (!cmSearch.value) return allCMs.value;

  const k = cmSearch.value.toLowerCase();

  return allCMs.value.filter(cm =>
      (cm.name && cm.name.toLowerCase().includes(k)) ||
      (cm.id && cm.id.toLowerCase().includes(k)) ||
      (getCmDescription(cm) && getCmDescription(cm).toLowerCase().includes(k))
  );
});

const getCmDescription = (cm) => cm?.description || cm?.m_description || '';

const init = () => {
  const storedCMs = Array.isArray(threatData.value?.selectedCMs)
    ? JSON.parse(JSON.stringify(threatData.value.selectedCMs))
    : [];

  selectedCMs.splice(0, selectedCMs.length, ...storedCMs);
  expandedRows.value = [];

  const mitreId = threatData.value?.mitre_id || null;
  if (mitreId && mitreId !== '') {
    getMitreCMsByThreatId(mitreId)
    return;
  }

  allCMs.value = [];
}

const getMitreCMsByThreatId = async (mitreId) => {
  try {
    const res = await axios.get(`/api/v1/mitre/countermeasures/${mitreId}`)
    allCMs.value = Array.isArray(res.data)
      ? res.data.map(item => ({
          ...item,
          description: item.description || item.m_description || ''
        }))
      : [];
  } catch (error) {
    console.error('Error get MITRE countermeasures by threat ID:', error);
    allCMs.value = [];
  }
};

const getAllMitreCMs = async () => {
  try {
    const res = await axios.get('/api/v1/mitre/countermeasures')
    allCMs.value = Array.isArray(res.data)
      ? res.data.map(item => ({
          ...item,
          description: item.description || item.m_description || ''
        }))
      : [];
  } catch (error) {
    console.error('Error get MITRE countermeasures:', error);
    allCMs.value = [];
  }
};

onMounted(() => {
  init()
})

watch(
  () => [threatData.value?.id, threatData.value?.mitre_id],
  () => {
    init();
  }
);
</script>

<style scoped>
@media (min-width: 768px) {
  .crra-card-row {
    align-items: stretch;
    height: 100%;
  }

  .crra-card-column {
    display: flex;
    flex: 0 0 50%;
    max-width: 50%;
    min-width: 0;
  }

  .crra-card {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    width: 100%;
  }

  .crra-card > .card-body {
    flex: 1 1 auto;
  }
}

.crra-card {
  min-height: 0;
  min-width: 0;
}

.crra-card > .card-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.crra-catalog-scroll,
.crra-card .table-responsive {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>

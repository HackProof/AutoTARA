<template>
  <div class="row ctsa-card-row">
    <div class="col-md-6 ctsa-card-column">
      <div class="card mb-3 shadow-sm ctsa-card">
        <div class="card-header bg-light fw-bold">Threat Basics</div>
        <div class="card-body">

<!--          <div class="mb-3">-->
<!--            <label class="form-label small text-muted fw-bold">ASSET NAME</label>-->
<!--            <input type="text" class="form-control" v-model.trim="assetName" disabled />-->
<!--          </div>-->

          <div class="mb-3">
            <label class="form-label small text-muted fw-bold">ATTACK NAME</label>
            <input type="text" class="form-control" :value="threatData.attackStep || threatData.technique" disabled />
          </div>

          <div class="mb-3">
            <label class="form-label small text-muted fw-bold">MITRE ATT&CK ID</label>
            <input type="text" class="form-control" v-model="threatData.mitre_id" disabled />
          </div>

          <div class="mb-3">
            <label class="form-label small text-muted fw-bold">TECHNIQUE</label>
            <div class="position-relative">
              <input
                  type="text"
                  class="form-control"
                  v-model="keyword"
                  placeholder="Enter ID or Name (e.g. T1068)"
                  @input="onTechniqueInput"
                  @focus="onTechniqueFocus"
                  @blur="onTechniqueBlur"
                  maxlength="50"
              />

              <div
                  v-if="showDropdown"
                  class="position-absolute w-100 bg-white border rounded shadow-lg mt-1"
                  style="z-index: 1050; max-height: 250px; overflow-y: auto; cursor: pointer;"
              >
                <ul class="list-group list-group-flush" v-if="suggestions.length > 0">
                  <li
                      v-for="item in suggestions"
                      :key="item.id"
                      class="list-group-item list-group-item-action"
                      @mousedown.prevent="selectTechnique(item)"
                  >
                    <span class="fw-bold text-primary small me-2">{{ item.id }}</span>
                    <span>{{ item.name }}</span>
                  </li>
                </ul>
                <div v-else-if="keyword.trim().length > 0" class="p-3 text-center bg-light">
                  <div class="mb-2 text-muted small">No matching technique found.</div>
<!--                  <button class="btn btn-sm btn-success" @mousedown.prevent="addNewTechniqueFromInput">-->
<!--                    <i class="fas fa-plus me-1"></i> Add "{{ keyword.trim() }}"-->
<!--                  </button>-->
                </div>
              </div>
            </div>
          </div>

          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label small text-muted fw-bold">TTC (Time To Compromise)</label>
              <input type="number" class="form-control" v-model="threatData.ttc" />
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label small text-muted fw-bold">RISK LEVEL</label>
              <input type="text" class="form-control bg-light" :value="riskLevel" disabled />
            </div>
          </div>

          <div class="mb-3">
            <label class="form-label small text-muted fw-bold">RELATED CVES</label>
            <div class="form-control d-flex flex-wrap gap-2 align-items-center" style="min-height: 38px;">
                            <span v-for="(cve, idx) in threatData.cve" :key="idx" class="badge bg-info text-dark">
                                {{ cve }} <i class="fas fa-times ms-1" style="cursor:pointer" @click="threatData.cve.splice(idx, 1)"></i>
                            </span>
              <input
                  type="text"
                  class="border-0 p-0"
                  style="outline:none; width: 100px;"
                  placeholder="+ Add CVE"
                  @keydown.enter.prevent="addCve($event)"
              />
            </div>
            <div class="form-text text-xs">Press Enter to add CVE.</div>
          </div>

          <div class="mb-3">
            <label class="form-label small text-muted fw-bold">DESCRIPTION</label>
            <textarea class="form-control" v-model="threatData.description" rows="6"></textarea>
          </div>

        </div>
      </div>
    </div>

    <div class="col-md-6 ctsa-card-column">
      <div class="card mb-3 shadow-sm ctsa-card">
        <div class="card-header bg-light d-flex justify-content-between align-items-center">
          <span class="fw-bold">TTP Scoring (Impact & Feasibility)</span>
          <i class="fas fa-question-circle text-secondary" title="Scoring Help"></i>
        </div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-bordered table-hover mb-0 align-middle">
              <thead class="table-light">
              <tr class="text-center text-uppercase small">
                <th class="text-start">Factor</th>
                <th style="width: 80px;">Weight</th>
                <th>Value</th>
                <th style="width: 40px;">Info</th>
              </tr>
              </thead>
              <tbody>
              <tr v-for="risk in riskRows" :key="risk.key">
                <td class="fw-semibold">{{ risk.label }}</td>
                <td>
                  <input type="number" step="0.1" min="0" max="1" class="form-control form-control-sm text-center" v-model.number="risk.weight" />
                </td>
                <td>
                  <select class="form-select form-select-sm" v-model.number="risk.value">
                    <option v-for="opt in ttpScoreOptions" :key="opt.value" :value="opt.value">
                      {{ opt.text }} ({{ opt.value }})
                    </option>
                  </select>
                </td>
                <td class="text-center">
                      <span
                          class="badge bg-light text-dark border cursor-pointer"
                          data-bs-toggle="tooltip" data-bs-placement="right"
                          :title="risk.description"
                      >
                        <i class="fas fa-info"></i>
                      </span>
                </td>
              </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="card-footer bg-white">
          <div class="d-flex justify-content-between align-items-center">
            <button class="btn btn-sm btn-outline-secondary" @click="resetDefaultWeights">
              <i class="fas fa-undo me-1"></i> Reset Weights
            </button>

            <div class="d-flex align-items-center">
              <span class="fw-bold me-2 text-muted">Risk Score:</span>
              <span class="badge rounded-pill fs-6" :class="riskBadgeClass">
                {{ riskScore.toFixed(1) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {computed, onMounted, reactive, ref, watch, nextTick} from 'vue'
import { storeToRefs } from 'pinia';
import { useThreatEditStore } from "@/stores/threatEditStore.js";
import axios from 'axios';
import { Tooltip } from 'bootstrap';

const editStore = useThreatEditStore();

const { threatData } = storeToRefs(editStore);

const keyword = ref('');
const showDropdown = ref(false);
const suggestions = ref([]);

const mitreTechniques = ref([
  /**
    * Example Data Structure
    * { id: 'T1068', name: 'Exploitation for Privilege Escalation' },
   */
]);

const defaultRiskRows = [
  { key:'proximity',         label:'Proximity',                  weight:0.1, value:3, description: '' },
  { key:'locality',          label:'Locality',                   weight:0.1, value:3, description: '' },
  { key:'restorationCosts',  label:'Restoration Costs',          weight:0.1, value:3, description: '' },
  { key:'Impact_C',          label:'Impact: Confidentiality',    weight:0.1, value:3, description: '' },
  { key:'Impact_I',          label:'Impact: Integrity',          weight:0.1, value:3, description: '' },
  { key:'Impact_A',          label:'Impact: Availability',       weight:0.1, value:3, description: '' },
  { key:'Prior Use',         label:'Prior Use',                  weight:0.1, value:3, description: '' },
  { key:'Required Skills',   label:'Required Skills',            weight:0.1, value:3, description: '' },
  { key:'Required Resources',label:'Required Resources',         weight:0.1, value:3, description: '' },
  { key:'Stealth',           label:'Stealth',                    weight:0.1, value:3, description: '' },
  { key:'Attribution',       label:'Attribution',                weight:0.1, value:3, description: '' }
];

const riskRows = reactive(JSON.parse(JSON.stringify(defaultRiskRows)));

const ttpScoreOptions = [
  { value:1, text:'Very Low' },
  { value:2, text:'Low' },
  { value:3, text:'Medium' },
  { value:4, text:'High' },
  { value:5, text:'Very High' }
];

const onTechniqueInput = () => {
  showDropdown.value = true;
  if(!keyword.value) {
    suggestions.value = [];
    return;
  }
  // Mock Filtering
  suggestions.value = mitreTechniques.value.filter(s =>
      s.id.toLowerCase().includes(keyword.value.toLowerCase()) ||
      s.name.toLowerCase().includes(keyword.value.toLowerCase())
  );
};

const onTechniqueFocus = () => { if(keyword.value) showDropdown.value = true; };
const onTechniqueBlur = () => { setTimeout(() => showDropdown.value = false, 200); };
const selectTechnique = (item) => {
  keyword.value = item.name;
  if (threatData.value) {
    threatData.value.mitre_id = item.id;
    threatData.value.mitre_name = item.name;
    // Fetch TTP Score, Description, Countermeasures

  }
  showDropdown.value = false;
};

const addNewTechniqueFromInput = () => {
  if (threatData.value) {
    threatData.value.mitre_name = keyword.value;
    threatData.value.mitre_id = 'CUSTOM-' + Math.floor(Math.random() * 1000);
  }
  showDropdown.value = false;
};

const addCve = (e) => {
  const val = e.target.value.trim();
  if (threatData.value && val) {
    if (!threatData.value.cve) threatData.value.cve = [];
    if (!threatData.value.cve.includes(val)) {
      threatData.value.cve.push(val);
      e.target.value = '';
    }
  }
};

const resetDefaultWeights = () => {
  defaultRiskRows.forEach((row, index) => {
    if (riskRows[index]) {
      riskRows[index].weight = row.weight;
      // riskRows[index].value = row.value;
    }
  });
};

const riskScore = computed(() => {
  const reverseKeys = ['Required Skills', 'Required Resources', 'Stealth', 'Attribution'];

  const sum = riskRows.reduce((sum, row) => {
    const val = reverseKeys.includes(row.key)
        ? (6 - Number(row.value))
        : Number(row.value);

    return sum + (val * (Number(row.weight) || 0));
  }, 0);

  return Math.round(sum * 10) / 10; // 소수점 1자리
});

const riskBadgeClass = computed(() => {
  const s = Number(riskScore.value);

  if (s >= 4.0) return 'bg-danger';
  if (s >= 2.5) return 'bg-warning text-dark';
  if (s >= 1.0) return 'bg-info text-dark';

  return 'bg-secondary';
});

const riskLevel = computed(() => {
  const s = Number(riskScore.value);

  if (s >= 4.0) return 'Danger';
  if (s >= 2.5) return 'Caution';
  if (s >= 1.0) return 'Info';

  return 'Unknown';
});

const init = () => {
  if (!threatData.value) return;

  if (!threatData.value.attackStep) {
    threatData.value.attackStep = threatData.value.technique || '';
  }

  if (!threatData.value.mitre_name && threatData.value.mitre_id) {
    threatData.value.mitre_name = threatData.value.technique || '';
  }

  getTTPScoreReason()

  const savedScores = threatData.value.ttp_score;
  if (savedScores) {
    setExistTTPScores(savedScores)
  }

  if (threatData.value.mitre_id) {
    keyword.value = threatData.value.mitre_name || ''
  }
}

const getTTPScoreReason = () => {
  let threatId = threatData.value.mitre_id || null;
  if (threatId) {
    axios.get(`/api/v1/mitre/ttp-score-reason/${threatId}`)
        .then(res => {
          const reasons = res.data;

          // Helper to normalize keys for loose matching (lowercase, remove non-alphanumeric)
          const normalize = (k) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

          // Create a normalized map of the API response
          const normalizedReasons = {};
          Object.keys(reasons).forEach(k => {
            normalizedReasons[normalize(k)] = reasons[k];
          });

          riskRows.forEach(row => {
            const rowKey = row.key;
            const normalizedRowKey = normalize(rowKey);

            // Priority 1: Exact Match
            if (reasons[rowKey]) {
              row.description = reasons[rowKey];
            }
            // Priority 2: Normalized Match
            else if (normalizedReasons[normalizedRowKey]) {
              row.description = normalizedReasons[normalizedRowKey];
            }
            // Priority 3: Specific handling for Impact mappings if needed
            else if (rowKey === 'Impact_C' && normalizedReasons['confidentiality']) row.description = normalizedReasons['confidentiality'];
            else if (rowKey === 'Impact_I' && normalizedReasons['integrity']) row.description = normalizedReasons['integrity'];
            else if (rowKey === 'Impact_A' && normalizedReasons['availability']) row.description = normalizedReasons['availability'];
          });

          // Refresh tooltips after DOM update
          nextTick(() => {
            refreshTooltips();
          });
        })
        .catch(err => {
          console.error('Error fetching TTP score reasons:', err);
        });
  }
}

const setExistTTPScores = (savedScores) => {
  if (Array.isArray(savedScores) && savedScores.length > 0) {

    savedScores.forEach(scoreItem => {
      const target = riskRows.find(r => r.key === scoreItem.key);

      if (target) {
        // 값 업데이트
        target.value = scoreItem.value;

        // (선택 사항) 백엔드 쿼리에서 weight도 같이 보내주고 있으므로 필요하면 업데이트합니다.
        if (scoreItem.weight !== undefined) {
          target.weight = scoreItem.weight;
        }
      }
    });
  }
};
const fetchMitreTechniques = async () => {
  try {
    const res = await axios.get('/api/v1/mitre/techniques');
    mitreTechniques.value = res.data;
    // console.log('Fetched MITRE techniques:', mitreTechniques.value);
  } catch (error) {
    console.error(error);
  }
};

// Tooltip Management
let tooltipInstances = [];
const refreshTooltips = () => {
  // Dispose existing instances
  tooltipInstances.forEach(t => t.dispose());
  tooltipInstances = [];
  
  // Initialize new instances
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipInstances = [...tooltipTriggerList].map(tooltipTriggerEl => new Tooltip(tooltipTriggerEl));
};

onMounted( () => {
  init()
  fetchMitreTechniques()
  refreshTooltips()
})

watch(
    riskRows,
    (newRows) => {
      if (!threatData.value) return;
      threatData.value.ttp_score = newRows.map(r => ({
        key: r.key,
        value: r.value,
        weight: r.weight
      }));
      threatData.value.riskScore = riskScore.value;
    }
);

</script>

<style scoped>
@media (min-width: 768px) {
  .ctsa-card-row {
    align-items: stretch;
    height: 100%;
  }

  .ctsa-card-column {
    display: flex;
  }

  .ctsa-card {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    width: 100%;
  }

  .ctsa-card > .card-body {
    flex: 1 1 auto;
  }
}
</style>

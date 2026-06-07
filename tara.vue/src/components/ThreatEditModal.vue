<template>
  <div>
    <div v-if="visible" class="modal-backdrop fade show"></div>

    <div
        class="modal fade"
        :class="{ 'show d-block': visible }"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        @click.self="handleBackdropClick"
    >
      <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable" role="document">
        <div class="modal-content">

          <div class="modal-header">
            <h5 class="modal-title">Threat Edit : {{ assetName }}</h5>
            <button type="button" class="btn-close" aria-label="Close" @click="handleCancel"></button>
          </div>

          <div class="modal-body">
            <div v-if="editStore.isReady">
              <ul class="nav nav-tabs mb-3">
                <li class="nav-item">
                  <a class="nav-link" :class="{ active: activeTab === 'ctsa' }" href="#" @click.prevent="activeTab = 'ctsa'">
                    CTSA — Threat & Risk
                  </a>
                </li>
                <li class="nav-item">
                  <a class="nav-link" :class="{ active: activeTab === 'crra' }" href="#" @click.prevent="activeTab = 'crra'">
                    CRRA — Countermeasures
                  </a>
                </li>
              </ul>

              <div class="tab-content threat-edit-tab-content" :style="threatEditTabContentStyle">
                <div
                    v-show="activeTab === 'ctsa'"
                    ref="ctsaTabPanelRef"
                    class="threat-edit-tab-panel"
                >
                  <tara-ctsa-tab />
                </div>
                <div
                    v-show="activeTab === 'crra'"
                    class="threat-edit-tab-panel"
                    :style="crraTabPanelStyle"
                >
                  <tara-crra-tab />
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer bg-light d-flex justify-content-between">
            <button type="button" class="btn btn-outline-danger" @click="handleDelete">
              <i class="fas fa-trash me-1"></i> Remove
            </button>
            <div>
              <button type="button" class="btn btn-light border me-2" @click="handleCancel">Cancel</button>
              <button type="button" class="btn btn-primary" @click="handleApply">
                <i class="fas fa-check me-1"></i> Apply
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>

</template>

<script setup>
import { storeToRefs } from 'pinia'
import { computed, ref, onMounted, nextTick, watch } from 'vue'
import axios from 'axios'
import TaraCtsaTab from '@/components/TaraCtsaTab.vue'
import TaraCrraTab from '@/components/TaraCrraTab.vue'
import { useCellStore } from "@/stores/cellStore.js"
import { useThreatModelStore } from "@/stores/threatModelStore.js"
import { useThreatEditStore } from "@/stores/threatEditStore.js"
import dataChanged from "@/service/x6/graph/data-changed.js";

const tmStore = useThreatModelStore()
const cellStore = useCellStore()
const editStore = useThreatEditStore()
const { ref: cellRef } = storeToRefs(cellStore);
const emit = defineEmits(['changed'])

const modifiedDiagram = computed(() => tmStore.modifiedDiagram)

const visible = ref(false)
const activeTab = ref('ctsa');
const ctsaTabPanelRef = ref(null);
const ctsaTabHeight = ref(0);

const threat = ref(null)
const assetName = ref(null)

onMounted(() => {
  console.log('[ThreatEditModal] Mounted');
})

const measureCtsaTabHeight = async () => {
  await nextTick();

  const panel = ctsaTabPanelRef.value;
  if (!panel) return;

  const height = Math.ceil(panel.scrollHeight);
  if (height > 0) {
    ctsaTabHeight.value = height;
  }
};

const threatEditTabContentStyle = computed(() =>
  ctsaTabHeight.value ? { minHeight: `${ctsaTabHeight.value}px` } : {}
);

const crraTabPanelStyle = computed(() =>
  ctsaTabHeight.value ? { height: `${ctsaTabHeight.value}px` } : {}
);

watch(activeTab, (tab) => {
  if (tab === 'ctsa') {
    measureCtsaTabHeight();
  }
});

/**
 * Open Threat Edit Modal
 * @param threatId - v4() UUID
 * @param state - 'new' | 'exist'
 */
const hydrateMitreMapping = async (draftThreat) => {
  if (!draftThreat || draftThreat.mitre_id) return;

  const assetType = cellRef.value?.data?.malInfo?.assetType || draftThreat.source;
  const stepName = draftThreat.attackStep || draftThreat.technique;

  if (!assetType || !stepName) return;

  try {
    const res = await axios.get('/api/v1/mitre/attack-step-mapping', {
      params: {
        assetType,
        stepName,
      },
    });

    const [mapping] = res.data || [];
    if (!mapping) return;

    draftThreat.mitre_id = mapping.technique_id;
    draftThreat.mitre_name = mapping.technique_name;
  } catch (error) {
    console.error('[ThreatEditModal] Failed to resolve MITRE mapping:', error);
  }
}

const editThreat = async (threatId, state) => {
  activeTab.value = 'ctsa';

  const crnThreat = cellRef.value.data.threats.find(t => t.id === threatId);
  if (crnThreat) {
    const editableThreat = {
      ...crnThreat,
      attackStep: crnThreat.attackStep || crnThreat.technique,
      mitre_name: crnThreat.mitre_name || '',
    };

    await hydrateMitreMapping(editableThreat);

    threat.value = { ...editableThreat }
    assetName.value = cellRef.value.label
    editStore.startEditing(assetName.value, editableThreat, state);
    visible.value = true;
    await measureCtsaTabHeight();
  }
}

const handleBackdropClick = () => { /* Prevent Close */ };

const handleCancel = () => {
  console.log('[ThreatEditModal] Cancel Button Clicked');
  editStore.clearData()
  visible.value = false;
};

const handleDelete = () => {
  if(confirm('Are you sure you want to delete this threat?')) {
    if (threat.value) {
      cellRef.value.data.threats = cellRef.value.data.threats.filter(t => t.id !== threat.value.id);
      cellRef.value.data.hasOpenThreats = cellRef.value.data.threats.length > 0;
      // 3. [추가] Store의 modifiedDiagram(JSON) 동기화
      // tmStore.updateCellDataInDiagram(cellRef.value.id, cellRef.value.data);
      tmStore.setModified();
      editStore.clearData()
      dataChanged.updateStyleAttrs(cellRef.value);
      threat.value = null;
      emit('changed');
    }
    visible.value = false;
  }
};

const handleApply = () => {
  const crnThreat = cellRef.value.data.threats.find(t => t.id === threat.value.id);
  const editStoreData = editStore.threatData;
  if (crnThreat) {
    crnThreat.attackStep = editStoreData.attackStep || crnThreat.attackStep || crnThreat.technique
    crnThreat.mitre_id = editStoreData.mitre_id
    crnThreat.mitre_name = editStoreData.mitre_name || ''
    crnThreat.status = editStore.threatData.status
    crnThreat.description = editStore.threatData.description
    crnThreat.riskScore = editStore.threatData.riskScore
    crnThreat.new = false
    crnThreat.ttc = editStore.threatData.ttc
    crnThreat.ttp_score = editStore.threatData.ttp_score
    crnThreat.cve = editStore.threatData.cve
    crnThreat.countermeasures = editStore.threatData.countermeasures
    crnThreat.selectedCMs = editStore.threatData.selectedCMs

    if (crnThreat.selectedCMs.length > 0) {
      crnThreat.status = 'mitigated'
    } else {
      crnThreat.status = 'open'
    }

    // 3. [추가] Store의 modifiedDiagram(JSON) 동기화
    tmStore.updateCellDataInDiagram(cellRef.value.id, cellRef.value.data);

    cellStore.updateData(cellRef.value.data, 'ThreatEditModal.vue')
    tmStore.setModified();
    dataChanged.updateStyleAttrs(cellRef.value);
    emit('changed');
  }

  editStore.clearData()
  visible.value = false;
};

defineExpose({
  editThreat
})

</script>

<style scoped>
.modal-backdrop {
  z-index: 1060;
}

.modal {
  z-index: 1070;
}

.modal-dialog.modal-xl { max-width: 1300px; }

.nav-tabs .nav-link {
  color: #6c757d;
  font-weight: 500;
  border: none;
  border-bottom: 3px solid transparent;
}
.nav-tabs .nav-link.active {
  color: #0d6efd;
  border-bottom: 3px solid #0d6efd;
  background: transparent;
}
.nav-tabs .nav-link:hover { border-color: transparent; color: #0a58ca; }

.threat-edit-tab-panel {
  overflow: visible;
}
</style>

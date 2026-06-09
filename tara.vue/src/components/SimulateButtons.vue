<template>
  <div class="d-flex align-items-center gap-2">
    <div class="btn-group shadow-sm">
      <button class="btn btn-sm btn-white border fw-bold text-dark" @click="setEntryHandler" :disabled="!canUseSelectedThreatAsset">
        <i class="fa-solid fa-arrow-right-to-bracket me-1" :class="{ 'text-muted': !canUseSelectedThreatAsset }"></i> Entry
      </button>

      <button class="btn btn-sm btn-white border fw-bold text-dark" @click="setTargetHandler" :disabled="!canUseSelectedThreatAsset">
        <i class="fa-solid fa-flag me-1" :class="{ 'text-muted': !canUseSelectedThreatAsset }"></i> Target
      </button>
    </div>
    <div class="vr text-muted mx-1"></div>
    <div class="btn-group shadow-sm">
      <button ref="dropdownToggleRef" class="btn btn-sm btn-white border fw-bold text-dark dropdown-toggle" aria-expanded="false" @click="toggleDropdown">
        <i v-if="isSimulating" class="fa-solid fa-spinner fa-spin me-1 text-primary"></i>
        <i v-else class="fa-solid fa-play me-1"></i> 
        {{ isSimulating ? 'Simulating...' : 'Simulate' }}
      </button>
      <ul class="dropdown-menu">
        <li>
          <button class="dropdown-item" @click="startMalsimHandler" :disabled="!canRunMalsim">
            <i class="fa-solid fa-play me-2"></i>Run malsim
            <span v-if="!hasLanguageGraph" class="text-muted small ms-2">(Requires MAL LangGraph)</span>
            <span v-else-if="!canUseLanguageForMalsim" class="text-muted small ms-2">(Missing LangGraph source)</span>
            <span v-else-if="!tmStore.entryThreat || !tmStore.targetThreat" class="text-muted small ms-2">(Set Entry and Target)</span>
          </button>
        </li>
        <li><hr class="dropdown-divider"></li>
        <li>
          <button class="dropdown-item" @click="startTTCHandler">
            <i class="fa-solid fa-clock me-2"></i>Time To Compromise (TTC)
          </button>
        </li>
        <li>
          <button class="dropdown-item" @click="startEdgeHandler">
            <i class="fa-solid fa-share-nodes me-2"></i>Shortest Path
          </button>
        </li>
      </ul>
      <button type="button" class="btn btn-sm btn-white border" @click="resetHandler" title="Reset Simulation">
        <i class="fa-solid fa-rotate-right"></i>
      </button>
    </div>
    <div class="vr text-muted mx-1"></div>
    <div class="btn-group shadow-sm">
      <button class="btn btn-sm btn-white border fw-bold text-dark" @click="openTaraStatusModal('ctsa')" :disabled="hasUnsupportedSelectedCell">
        <i class="fa-solid fa-list-check me-1" :class="{ 'text-muted': hasUnsupportedSelectedCell }"></i> CTSA
      </button>
      <button class="btn btn-sm btn-white border fw-bold text-dark" @click="openTaraStatusModal('crra')" :disabled="hasUnsupportedSelectedCell">
        <i class="fa-solid fa-shield-halved me-1" :class="{ 'text-muted': hasUnsupportedSelectedCell }"></i> CRRA
      </button>
    </div>
  </div>
  
  <!-- Threat Select Modal -->
  <ThreatSelectModal
    :show="showThreatModal"
    :mode="threatModalMode"
    :nodeId="threatModalNodeId"
    :nodeName="threatModalNodeName"
    :nodeType="threatModalNodeType"
    :threats="threatModalThreats"
    @confirm="onThreatSelected"
    @cancel="closeThreatModal"
  />

  <!-- CTSA / CRRA Status Modal -->
  <div v-if="showTaraStatusModal" class="modal-backdrop fade show tara-status-backdrop"></div>
  <div
    class="modal fade tara-status-modal"
    :class="{ 'show d-block': showTaraStatusModal }"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    @click.self="closeTaraStatusModal"
  >
    <div class="modal-dialog modal-xl modal-dialog-scrollable tara-status-modal-dialog" role="document">
      <div class="modal-content">
        <div class="modal-header">
          <div>
            <h5 class="modal-title mb-1">
              {{ taraPhaseLabel }} Status
            </h5>
            <div class="small text-muted">
              Assets in current diagram: {{ taraRows.length }} / Open threats: {{ taraOpenThreatCount }}
            </div>
          </div>
          <button type="button" class="btn-close" aria-label="Close" @click="closeTaraStatusModal"></button>
        </div>

        <div class="modal-body">
          <ul v-if="showTaraStatusTabs" class="nav nav-tabs tara-status-tabs mb-3">
            <li class="nav-item">
              <button
                type="button"
                class="nav-link"
                :class="{ active: taraStatusTab === 'assets' }"
                @click="selectTaraStatusTab('assets')"
              >
                Asset Threats
              </button>
            </li>
            <li v-if="showThreatMatrixTab" class="nav-item">
              <button
                type="button"
                class="nav-link"
                :class="{ active: taraStatusTab === 'matrix' }"
                @click="selectTaraStatusTab('matrix')"
              >
                Susceptibility Threat Matrix
              </button>
            </li>
            <li v-if="showMitigationMappingTab" class="nav-item">
              <button
                type="button"
                class="nav-link"
                :class="{ active: taraStatusTab === 'mitigation' }"
                @click="selectTaraStatusTab('mitigation')"
              >
                Mitigation Mapping Table
              </button>
            </li>
          </ul>

          <div v-if="taraStatusTab === 'assets'">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
              <div class="input-group input-group-sm tara-search">
                <span class="input-group-text bg-white"><i class="fa-solid fa-search"></i></span>
                <input
                  v-model.trim="taraSearch"
                  type="text"
                  class="form-control"
                  placeholder="Search asset or threat"
                />
              </div>
              <button class="btn btn-sm btn-outline-secondary" @click="refreshTaraStatusData">
                <i class="fa-solid fa-rotate me-1"></i> Refresh
              </button>
              <span v-if="taraMappingsLoading" class="small text-muted">
                <i class="fa-solid fa-spinner fa-spin me-1"></i> Resolving MITRE mappings
              </span>
            </div>

            <div v-if="filteredTaraRows.length === 0" class="text-center text-muted py-5 border rounded">
              <i class="fa-solid fa-diagram-project fa-3x mb-3 opacity-25"></i>
              <div>No matching assets found in the current diagram.</div>
            </div>

            <div v-else class="tara-asset-list">
              <div
                v-for="row in filteredTaraRows"
                :key="row.id"
                class="tara-asset-item"
                :class="{ 'is-expanded': isTaraAssetExpanded(row) }"
              >
                <button
                  class="tara-asset-summary"
                  type="button"
                  :aria-expanded="isTaraAssetExpanded(row)"
                  @click="toggleTaraAsset(row)"
                >
                  <span class="tara-chevron">
                    <i class="fa-solid" :class="isTaraAssetExpanded(row) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
                  </span>
                  <span class="tara-asset-main">
                    <span class="tara-asset-name">{{ row.name }}</span>
                    <span class="tara-asset-type">{{ row.assetType }}</span>
                  </span>
                  <span class="tara-asset-metrics">
                    <span class="tara-metric">
                      <span class="tara-metric-value">{{ row.threatCount }}</span>
                      <span class="tara-metric-label">Threats</span>
                    </span>
                    <span class="tara-metric danger">
                      <span class="tara-metric-value">{{ row.openCount }}</span>
                      <span class="tara-metric-label">Open</span>
                    </span>
                    <span class="tara-metric success">
                      <span class="tara-metric-value">{{ row.mitigatedCount }}</span>
                      <span class="tara-metric-label">Mitigated</span>
                    </span>
                  </span>
                </button>

                <div v-if="isTaraAssetExpanded(row)" class="tara-threat-panel">
                  <div v-if="row.threats.length === 0" class="tara-empty-threats">
                    No threats are registered for this asset.
                  </div>
                  <div v-else class="tara-threat-grid">
                    <div class="tara-threat-grid-header">
                      <span>Threat (Attack Step)</span>
                      <span class="tara-threat-cell-center">MITRE ATT&CK ID</span>
                      <span>Technique</span>
                      <span class="tara-threat-cell-center">Risk Score</span>
                    </div>
                    <div
                      v-for="threat in row.threats"
                      :key="threat.id || threat.attackStep || threat.technique"
                      class="tara-threat-grid-row"
                    >
                      <button
                        class="tara-threat-name fw-semibold text-dark"
                        type="button"
                        :title="getThreatAttackStep(threat)"
                        @click.stop="openCtsaThreatModal(row, threat)"
                      >
                        {{ getThreatAttackStep(threat) }}
                      </button>
                      <span class="tara-threat-cell-center">
                        <span class="tara-mitre-badge" :class="{ empty: getThreatMitreId(threat) === '-' }">
                          {{ getThreatMitreId(threat) }}
                        </span>
                      </span>
                      <span class="text-break">{{ getThreatTechnique(threat) }}</span>
                      <span class="tara-threat-cell-center">
                        <span class="badge rounded-pill tara-risk-badge" :class="getRiskBadgeClass(threat.riskScore)">
                          {{ formatRiskScore(threat.riskScore) }}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="taraStatusTab === 'matrix'" class="tara-matrix-view">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
              <button class="btn btn-sm btn-outline-secondary" @click="refreshTaraStatusData">
                <i class="fa-solid fa-rotate me-1"></i> Refresh
              </button>
              <span v-if="mitreTechniquesLoading" class="small text-muted">
                <i class="fa-solid fa-spinner fa-spin me-1"></i> Loading MITRE ATT&CK IDs
              </span>
              <span v-if="taraMappingsLoading" class="small text-muted">
                <i class="fa-solid fa-spinner fa-spin me-1"></i> Resolving MITRE mappings
              </span>
              <span v-if="!mitreTechniquesLoading" class="small text-muted">
                MITRE IDs: {{ threatMatrixRows.length }} / Assets: {{ taraRows.length }}
              </span>
            </div>

            <div v-if="mitreTechniquesLoading && threatMatrixRows.length === 0" class="text-center text-muted py-5 border rounded">
              <div class="spinner-border text-primary mb-3" role="status">
                <span class="visually-hidden">Loading...</span>
              </div>
              <div>Loading MITRE ATT&CK IDs...</div>
            </div>

            <div v-else-if="threatMatrixRows.length === 0" class="text-center text-muted py-5 border rounded">
              <i class="fa-solid fa-table-cells fa-3x mb-3 opacity-25"></i>
              <div>No MITRE ATT&CK IDs are mapped to assets in the current diagram.</div>
            </div>

            <div v-else class="tara-matrix-wrap">
              <table class="table table-sm align-middle mb-0 tara-matrix-table">
                <thead>
                  <tr>
                    <th class="tara-matrix-sticky tara-matrix-id-col">MITRE ATT&CK ID</th>
                    <th class="tara-matrix-sticky tara-matrix-technique-col">Technique</th>
                    <th class="tara-matrix-sticky tara-matrix-risk-col">Risk Score</th>
                    <th
                      v-for="row in taraRows"
                      :key="`matrix-head-${row.id}`"
                      class="tara-matrix-asset-col"
                      :title="row.name"
                    >
                      {{ row.name }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="matrixRow in threatMatrixRows" :key="matrixRow.mitreId">
                    <td class="tara-matrix-sticky tara-matrix-id-col">
                      <span class="tara-mitre-badge" :title="matrixRow.techniqueName">
                        {{ matrixRow.mitreId }}
                      </span>
                    </td>
                    <td class="tara-matrix-sticky tara-matrix-technique-col" :title="matrixRow.techniqueName">
                      {{ matrixRow.techniqueName || '-' }}
                    </td>
                    <td class="tara-matrix-sticky tara-matrix-risk-col">
                      {{ matrixRow.riskScore }}
                    </td>
                    <td
                      v-for="row in taraRows"
                      :key="`${matrixRow.mitreId}-${row.id}`"
                      class="tara-matrix-hit-cell"
                      :class="{ hit: hasThreatMatrixMatch(matrixRow, row) }"
                    >
                      {{ hasThreatMatrixMatch(matrixRow, row) ? 'X' : '' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-else-if="taraStatusTab === 'mitigation'" class="tara-matrix-view">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
              <button class="btn btn-sm btn-outline-secondary" @click="refreshTaraStatusData">
                <i class="fa-solid fa-rotate me-1"></i> Refresh
              </button>
              <span v-if="mitigationMappingsLoading" class="small text-muted">
                <i class="fa-solid fa-spinner fa-spin me-1"></i> Loading mitigation mappings
              </span>
              <span v-if="taraMappingsLoading" class="small text-muted">
                <i class="fa-solid fa-spinner fa-spin me-1"></i> Resolving MITRE mappings
              </span>
              <span v-if="!mitigationMappingsLoading" class="small text-muted">
                Countermeasures: {{ mitigationMappingRows.length }} / MITRE IDs: {{ mitigationMatrixColumns.length }}
              </span>
              <span class="small text-muted ms-auto">
                PH Prevent/High · RM Respond/Moderate · DL Detect/Low
              </span>
            </div>

            <div v-if="mitigationMappingsLoading && mitigationMappingRows.length === 0" class="text-center text-muted py-5 border rounded">
              <div class="spinner-border text-primary mb-3" role="status">
                <span class="visually-hidden">Loading...</span>
              </div>
              <div>Loading mitigation mappings...</div>
            </div>

            <div v-else-if="mitigationMatrixColumns.length === 0" class="text-center text-muted py-5 border rounded">
              <i class="fa-solid fa-table-cells fa-3x mb-3 opacity-25"></i>
              <div>No MITRE ATT&CK IDs are mapped to assets in the current diagram.</div>
            </div>

            <div v-else-if="mitigationMappingRows.length === 0" class="text-center text-muted py-5 border rounded">
              <i class="fa-solid fa-shield-halved fa-3x mb-3 opacity-25"></i>
              <div>No countermeasure mappings were found for the current MITRE ATT&CK IDs.</div>
            </div>

            <div v-else class="tara-matrix-wrap">
              <table class="table table-sm align-middle mb-0 tara-matrix-table">
                <thead>
                  <tr>
                    <th class="tara-matrix-sticky tara-mitigation-id-col">CM ID</th>
                    <th class="tara-matrix-sticky tara-mitigation-name-col">CM Name</th>
                    <th
                      v-for="column in mitigationMatrixColumns"
                      :key="`mitigation-head-${column.mitreId}`"
                      class="tara-mitigation-technique-col"
                      :title="column.techniqueName"
                    >
                      {{ column.mitreId }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in mitigationMappingRows" :key="row.id">
                    <td class="tara-matrix-sticky tara-mitigation-id-col">
                      <span class="tara-mitre-badge">{{ row.id }}</span>
                    </td>
                    <td class="tara-matrix-sticky tara-mitigation-name-col" :title="row.name">
                      {{ row.name }}
                    </td>
                    <td
                      v-for="column in mitigationMatrixColumns"
                      :key="`${row.id}-${column.mitreId}`"
                      class="tara-mitigation-effect-cell"
                      :class="{ hit: getMitigationEffect(row, column) }"
                      :title="getMitigationEffectTitle(row, column)"
                    >
                      <span
                        v-if="getMitigationEffect(row, column)"
                        class="tara-effect-badge"
                        :class="`effect-${getMitigationEffect(row, column).toLowerCase()}`"
                      >
                        {{ getMitigationEffect(row, column) }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="modal-footer bg-light">
          <button type="button" class="btn btn-light border" @click="closeTaraStatusModal">Close</button>
        </div>
      </div>
    </div>
  </div>

  <ThreatEditModal ref="taraThreatEditModalRef" @changed="refreshTaraRows" />
</template>

<script setup>
import { useCellStore } from '@/stores/cellStore.js';
import { useThreatModelStore } from "@/stores/threatModelStore.js";
import { storeToRefs } from "pinia";
import dataChanged from '@/service/x6/graph/data-changed.js';
import { ref, computed, onMounted, onUnmounted, inject, toRaw, nextTick } from 'vue';
import { Dropdown } from 'bootstrap';
import { useToast } from "vue-toastification";
import ThreatSelectModal from './ThreatSelectModal.vue';
import ThreatEditModal from './ThreatEditModal.vue';
import { runSimulation as runMalsimApi } from '@/service/mal/malApiService.js';
import { createMalModelFromDiagram } from '@/service/mal/modelTransform.js';
import { isThreatAnalysisCellData } from '@/service/asset-types.js';
import axios from 'axios';

const cellStore = useCellStore();
const tmStore = useThreatModelStore();
const { isSimulating } = storeToRefs(tmStore);
const { ref: cellRef } = storeToRefs(cellStore);
const toast = useToast();
const graph = inject('graph');
const stencilController = inject('stencilController', null);
const selectedCellSupportsThreatAnalysis = computed(() =>
  Boolean(cellRef.value) && isThreatAnalysisCellData(cellRef.value?.data)
);
const canUseSelectedThreatAsset = computed(() => selectedCellSupportsThreatAnalysis.value);
const hasUnsupportedSelectedCell = computed(() =>
  Boolean(cellRef.value) && !selectedCellSupportsThreatAnalysis.value
);

// --- Threat Modal State ---
const showThreatModal = ref(false);
const threatModalMode = ref('entry'); // 'entry' or 'target'
const threatModalNodeId = ref('');
const threatModalNodeName = ref('');
const threatModalNodeType = ref('');
const threatModalThreats = ref([]);

// --- CTSA / CRRA Status Modal State ---
const showTaraStatusModal = ref(false);
const currentTaraPhase = ref('ctsa');
const taraStatusTab = ref('assets');
const taraRows = ref([]);
const taraSearch = ref('');
const expandedTaraAssetId = ref('');
const taraMappingsLoading = ref(false);
const mitreTechniques = ref([]);
const mitreTechniquesLoading = ref(false);
const mitreTechniquesLoaded = ref(false);
const mitigationMappings = ref([]);
const mitigationMappingsLoading = ref(false);
const taraThreatEditModalRef = ref(null);
const taraMappingCache = new Map();
const mitigationMappingCache = new Map();

const taraPhaseLabel = computed(() => currentTaraPhase.value === 'ctsa' ? 'CTSA' : 'CRRA');
const showThreatMatrixTab = computed(() => currentTaraPhase.value === 'ctsa');
const showMitigationMappingTab = computed(() => currentTaraPhase.value === 'crra');
const showTaraStatusTabs = computed(() => showThreatMatrixTab.value || showMitigationMappingTab.value);
const taraPhaseHint = computed(() =>
  currentTaraPhase.value === 'ctsa'
    ? 'Threat analysis summary'
    : 'Countermeasure and residual risk summary'
);

const normalizeMitreId = (value) => {
  const text = String(value || '').trim();
  return text && text !== '-' ? text.toUpperCase() : '';
};

const normalizeCountermeasureEffect = (value) => {
  const text = String(value || '').trim();
  const upper = text.toUpperCase();

  if (/\bPH\b/.test(upper) || (upper.includes('PREVENT') && upper.includes('HIGH'))) return 'PH';
  if (/\bRM\b/.test(upper) || (upper.includes('RESPOND') && upper.includes('MODERATE'))) return 'RM';
  if (/\bDL\b/.test(upper) || (upper.includes('DETECT') && upper.includes('LOW'))) return 'DL';

  return '';
};

const formatSelectedCountermeasureEffect = (countermeasure) => {
  const typeCodeByValue = {
    prevent: 'P',
    respond: 'R',
    detect: 'D'
  };
  const confidenceCodeByValue = {
    1: 'L',
    2: 'M',
    3: 'H',
    low: 'L',
    medium: 'M',
    moderate: 'M',
    high: 'H'
  };

  const typeCode = typeCodeByValue[String(countermeasure?.mitigationTypes || '').toLowerCase()];
  const confidenceCode = confidenceCodeByValue[String(countermeasure?.effectiveness || '').toLowerCase()];

  return typeCode && confidenceCode ? `${typeCode}${confidenceCode}` : '';
};

const formatSelectedCountermeasureEffectTitle = (countermeasure) => {
  const typeLabel = countermeasure?.mitigationTypes
    ? String(countermeasure.mitigationTypes).replace(/^\w/, char => char.toUpperCase())
    : '';
  const confidenceLabelByValue = {
    1: 'Low Confidence',
    2: 'Moderate Confidence',
    3: 'High Confidence'
  };
  const confidenceLabel = confidenceLabelByValue[countermeasure?.effectiveness] || '';

  return [typeLabel && `${typeLabel} Effect`, confidenceLabel].filter(Boolean).join(' / ');
};

const filteredTaraRows = computed(() => {
  const keyword = taraSearch.value.toLowerCase();

  return taraRows.value.filter(row => {
    const matchesKeyword = !keyword || [
      row.name,
      row.assetType,
      row.mappingAssetType,
      ...row.threats.flatMap(t => [
        t.attackStep,
        t.technique,
        t.mitre_id,
        t.mitre_name,
        t.technique_id,
        t.technique_name
      ])
    ]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(keyword));

    return matchesKeyword;
  });
});

const taraOpenThreatCount = computed(() =>
  taraRows.value.reduce((sum, row) => sum + row.openCount, 0)
);

const threatMatrixRows = computed(() => {
  const rowsById = new Map(
    mitreTechniques.value
      .map((technique) => {
        const mitreId = normalizeMitreId(technique.id);
        if (!mitreId) return null;

        return [
          mitreId,
          {
            mitreId,
            techniqueName: technique.name || '',
            assetIds: new Set(),
            riskScores: new Set()
          }
        ];
      })
      .filter(Boolean)
  );

  taraRows.value.forEach((assetRow) => {
    assetRow.threats.forEach((threat) => {
      const mitreId = normalizeMitreId(getThreatMitreId(threat));
      const matrixRow = rowsById.get(mitreId);
      if (!matrixRow) return;

      matrixRow.assetIds.add(assetRow.id);
      const techniqueName = getThreatTechnique(threat);
      if (!matrixRow.techniqueName && techniqueName !== '-') {
        matrixRow.techniqueName = techniqueName;
      }
      const riskScore = formatRiskScore(threat.riskScore);
      if (riskScore !== '-') {
        matrixRow.riskScores.add(String(riskScore));
      }
    });
  });

  return Array.from(rowsById.values())
    .filter((matrixRow) => matrixRow.assetIds.size > 0)
    .map((matrixRow) => ({
      ...matrixRow,
      riskScore: formatThreatMatrixRiskScores(matrixRow.riskScores)
    }));
});

// malsim 실행 가능 여부
const mitigationMatrixColumns = computed(() =>
  threatMatrixRows.value.map((matrixRow) => ({
    mitreId: matrixRow.mitreId,
    techniqueName: matrixRow.techniqueName || ''
  }))
);

const mitigationMappingRows = computed(() => {
  const activeMitreIds = new Set(mitigationMatrixColumns.value.map((column) => column.mitreId));
  const rowsById = new Map();

  mitigationMappings.value.forEach((mapping) => {
    const mitreId = normalizeMitreId(mapping.mitreId);
    if (!activeMitreIds.has(mitreId)) return;

    mapping.countermeasures.forEach((countermeasure) => {
      const id = String(countermeasure.id || '').trim();
      if (!id) return;

      if (!rowsById.has(id)) {
        rowsById.set(id, {
          id,
          name: countermeasure.name || '',
          effects: new Map()
        });
      }

      const row = rowsById.get(id);
      if (!row.name && countermeasure.name) {
        row.name = countermeasure.name;
      }
      row.effects.set(mitreId, {
        value: normalizeCountermeasureEffect(countermeasure.effect || countermeasure.description),
        title: countermeasure.description || ''
      });
    });
  });

  taraRows.value.forEach((assetRow) => {
    assetRow.threats.forEach((threat) => {
      const mitreId = normalizeMitreId(getThreatMitreId(threat));
      if (!activeMitreIds.has(mitreId) || !Array.isArray(threat.selectedCMs)) return;

      threat.selectedCMs.forEach((countermeasure) => {
        const id = String(countermeasure.id || '').trim();
        if (!id) return;

        if (!rowsById.has(id)) {
          rowsById.set(id, {
            id,
            name: countermeasure.name || '',
            effects: new Map()
          });
        }

        const row = rowsById.get(id);
        if (!row.name && countermeasure.name) {
          row.name = countermeasure.name;
        }

        const selectedEffect = formatSelectedCountermeasureEffect(countermeasure);
        if (!selectedEffect) return;

        row.effects.set(mitreId, {
          value: selectedEffect,
          title: formatSelectedCountermeasureEffectTitle(countermeasure) || countermeasure.description || ''
        });
      });
    });
  });

  return Array.from(rowsById.values())
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));
});

const hasLanguageGraph = computed(() => Boolean(tmStore.data?.languageGraph));
const malsimLanguageGraphSourceText = computed(() => tmStore.data?.languageGraphSourceText || '');
const canUseLanguageForMalsim = computed(() =>
  Boolean(malsimLanguageGraphSourceText.value)
);

const canRunMalsim = computed(() => {
  return hasLanguageGraph.value
      && canUseLanguageForMalsim.value
      && tmStore.entryThreat
      && tmStore.targetThreat;
});

const isNoMalsimPathError = (message = '') => (
  /no valid paths found from entry point to target/i.test(String(message))
  || /no attack paths found/i.test(String(message))
);

const showNoMalsimPathMessage = () => {
  toast.warning('Entry에서 Target까지 도달 가능한 공격 경로를 찾을 수 없습니다. Entry/Target attack step과 모델 연결 관계를 확인해주세요.');
};

const dropdownToggleRef = ref(null);
let dropdown = null;

const toggleDropdown = () => {
  if (dropdown) {
    dropdown.toggle();
  }
};

const compareMitreIds = (left, right) =>
  normalizeMitreId(left).localeCompare(normalizeMitreId(right), undefined, {
    numeric: true,
    sensitivity: 'base'
  });

const fetchMitreTechniques = async ({ force = false } = {}) => {
  if (mitreTechniquesLoading.value) return;
  if (mitreTechniquesLoaded.value && !force) return;

  mitreTechniquesLoading.value = true;
  try {
    const res = await axios.get('/api/v1/mitre/techniques');
    mitreTechniques.value = Array.isArray(res.data)
      ? res.data
        .filter((technique) => normalizeMitreId(technique.id))
        .sort((a, b) => compareMitreIds(a.id, b.id))
      : [];
    mitreTechniquesLoaded.value = true;
  } catch (error) {
    console.error('[SimulateButtons] Failed to load MITRE techniques:', error);
    toast.error('Failed to load MITRE ATT&CK IDs.');
  } finally {
    mitreTechniquesLoading.value = false;
  }
};

const fetchCountermeasuresByMitreId = async (mitreId, { force = false } = {}) => {
  const normalizedMitreId = normalizeMitreId(mitreId);
  if (!normalizedMitreId) return [];

  if (!force && mitigationMappingCache.has(normalizedMitreId)) {
    return mitigationMappingCache.get(normalizedMitreId);
  }

  try {
    const res = await axios.get(`/api/v1/mitre/countermeasures/${normalizedMitreId}`);
    const countermeasures = Array.isArray(res.data)
      ? res.data.map((item) => ({
        ...item,
        effect: normalizeCountermeasureEffect(item.effect || item.description || item.m_description),
        description: item.description || item.m_description || ''
      }))
      : [];
    mitigationMappingCache.set(normalizedMitreId, countermeasures);
    return countermeasures;
  } catch (error) {
    if (error?.response?.status !== 404) {
      console.error('[SimulateButtons] Failed to load mitigation mappings:', error);
    }
    mitigationMappingCache.set(normalizedMitreId, []);
    return [];
  }
};

const fetchMitigationMappings = async ({ force = false } = {}) => {
  if (mitigationMappingsLoading.value) return;

  const mitreIds = mitigationMatrixColumns.value
    .map((column) => normalizeMitreId(column.mitreId))
    .filter(Boolean);

  if (mitreIds.length === 0) {
    mitigationMappings.value = [];
    return;
  }

  mitigationMappingsLoading.value = true;
  try {
    const mappings = await Promise.all(
      mitreIds.map(async (mitreId) => ({
        mitreId,
        countermeasures: await fetchCountermeasuresByMitreId(mitreId, { force })
      }))
    );
    mitigationMappings.value = mappings;
  } finally {
    mitigationMappingsLoading.value = false;
  }
};

const selectTaraStatusTab = async (tab) => {
  taraStatusTab.value = tab;
  if (tab === 'matrix') {
    await fetchMitreTechniques();
  }
  if (tab === 'mitigation') {
    await fetchMitreTechniques();
    await fetchMitigationMappings();
  }
};

onMounted(() => {
  if (dropdownToggleRef.value) {
    dropdown = new Dropdown(dropdownToggleRef.value);
  }
});

onUnmounted(() => {
  if (dropdown) {
    dropdown.dispose();
  }
});

const getGraphModel = () => {
  if (graph && graph.value) {
    return toRaw(graph.value);
  }

  if (cellRef.value && cellRef.value.model) {
    return toRaw(cellRef.value.model);
  }

  return null;
};

const isTaraAssetNode = (node) => {
  if (!node?.isNode?.()) return false;

  const data = node.getData?.() || {};
  const type = data.type || '';

  if (!data.name) return false;
  if (type === 'tm.Boundary' || type === 'tm.BoundaryBox' || type === 'tm.Text') return false;
  if (node.shape === 'trust-boundary-box' || node.shape === 'td-text-block') return false;

  return true;
};

const getMappingCacheKey = (assetType, stepName) => `${assetType || ''}:${stepName || ''}`;

const hasStoredMitreMapping = (threat) => {
  return Boolean(getThreatMitreId(threat) !== '-' && getThreatTechnique(threat) !== '-');
};

const fetchMitreMappingForThreat = async (assetType, threat) => {
  const stepName = getThreatAttackStep(threat);
  if (!assetType || !stepName || stepName === 'Unnamed threat' || hasStoredMitreMapping(threat)) {
    return null;
  }

  const cacheKey = getMappingCacheKey(assetType, stepName);
  if (taraMappingCache.has(cacheKey)) {
    return taraMappingCache.get(cacheKey);
  }

  try {
    const res = await axios.get('/api/v1/mitre/attack-step-mapping', {
      params: {
        assetType,
        stepName,
      },
    });

    const mapping = Array.isArray(res.data) ? res.data[0] : null;
    taraMappingCache.set(cacheKey, mapping || null);
    return mapping || null;
  } catch (error) {
    console.error('[SimulateButtons] Failed to resolve MITRE mapping:', error);
    taraMappingCache.set(cacheKey, null);
    return null;
  }
};

const hydrateTaraMitreMappings = async () => {
  const mappingJobs = [];

  taraRows.value.forEach((row, rowIndex) => {
    row.threats.forEach((threat, threatIndex) => {
      if (hasStoredMitreMapping(threat)) return;

      mappingJobs.push(
        fetchMitreMappingForThreat(row.mappingAssetType, threat).then((mapping) => {
          if (!mapping) return;

          taraRows.value[rowIndex].threats[threatIndex] = {
            ...taraRows.value[rowIndex].threats[threatIndex],
            mitre_id: mapping.technique_id,
            mitre_name: mapping.technique_name
          };
        })
      );
    });
  });

  if (mappingJobs.length === 0) return;

  taraMappingsLoading.value = true;
  try {
    await Promise.all(mappingJobs);
  } finally {
    taraMappingsLoading.value = false;
  }
};

const buildTaraRows = () => {
  const model = getGraphModel();
  if (!model?.getNodes) return [];

  return model.getNodes()
    .filter(isTaraAssetNode)
    .map(node => {
      const data = node.getData?.() || {};
      const assetType = data.malInfo?.assetType || data.type || node.shape || 'Asset';
      const mappingAssetType = data.malInfo?.assetType || data.name || assetType;
      const threats = Array.isArray(data.threats)
        ? data.threats.map(threat => ({ ...threat }))
        : [];
      const mitigatedCount = threats.filter(t => t.status === 'mitigated').length;
      const openCount = threats.length - mitigatedCount;

      return {
        id: node.id,
        node,
        name: data.name || node.id,
        assetType,
        mappingAssetType,
        threats,
        threatCount: threats.length,
        openCount,
        mitigatedCount
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

const refreshTaraRows = async () => {
  taraRows.value = buildTaraRows();
  await hydrateTaraMitreMappings();
};

const refreshTaraStatusData = async () => {
  const jobs = [refreshTaraRows()];
  if (showThreatMatrixTab.value || showMitigationMappingTab.value) {
    jobs.push(fetchMitreTechniques({ force: true }));
  }

  await Promise.all(jobs);

  if (taraStatusTab.value === 'mitigation') {
    await fetchMitigationMappings({ force: true });
  }
};

const openTaraStatusModal = async (phase) => {
  if (hasUnsupportedSelectedCell.value) return;

  currentTaraPhase.value = phase;
  taraStatusTab.value = 'assets';
  taraSearch.value = '';
  expandedTaraAssetId.value = '';
  showTaraStatusModal.value = true;
  await refreshTaraStatusData();
};

const closeTaraStatusModal = () => {
  showTaraStatusModal.value = false;
};

const selectTaraAsset = (row) => {
  const model = getGraphModel();
  if (!model || !row?.node) return;

  if (typeof model.resetSelection === 'function') {
    model.resetSelection();
  }

  if (typeof model.select === 'function') {
    model.select(row.node);
  }

  cellStore.select(row.node);
};

const isTaraAssetExpanded = (row) => expandedTaraAssetId.value === row.id;

const toggleTaraAsset = (row) => {
  expandedTaraAssetId.value = isTaraAssetExpanded(row) ? '' : row.id;
  selectTaraAsset(row);
};

const openCtsaThreatModal = async (row, threat) => {
  if (!threat?.id) {
    toast.warning('Threat ID is missing. Please refresh the diagram and try again.');
    return;
  }

  selectTaraAsset(row);
  await nextTick();

  if (!taraThreatEditModalRef.value?.editThreat) {
    toast.error('CTSA editor is not ready.');
    return;
  }

  taraThreatEditModalRef.value.editThreat(threat.id, 'exist');
};

const getThreatAttackStep = (threat) => {
  return threat?.attackStep || threat?.technique || 'Unnamed threat';
};

const getThreatMitreId = (threat) => {
  return threat?.mitre_id || threat?.mitreId || threat?.technique_id || '-';
};

const getThreatTechnique = (threat) => {
  if (getThreatMitreId(threat) === '-') return '-';
  return threat?.mitre_name || threat?.technique_name || '-';
};

const formatRiskScore = (riskScore) => {
  return riskScore === undefined || riskScore === null || riskScore === '' ? '-' : riskScore;
};

const formatThreatMatrixRiskScores = (riskScores) => {
  const values = Array.from(riskScores || []);
  if (values.length === 0) return '-';

  return values
    .sort((a, b) => {
      const left = Number(a);
      const right = Number(b);
      if (Number.isFinite(left) && Number.isFinite(right)) return right - left;
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    })
    .join(', ');
};

const hasThreatMatrixMatch = (matrixRow, assetRow) => matrixRow?.assetIds?.has(assetRow?.id);

const getMitigationEffectEntry = (row, column) => row?.effects?.get?.(column?.mitreId) || null;

const getMitigationEffect = (row, column) => getMitigationEffectEntry(row, column)?.value || '';

const getMitigationEffectTitle = (row, column) => {
  const entry = getMitigationEffectEntry(row, column);
  if (!entry) return '';
  return entry.title || entry.value || '';
};

const getRiskBadgeClass = (riskScore) => {
  const score = Number(riskScore);
  if (!Number.isFinite(score)) return 'bg-light text-dark border';
  if (score < 2) return 'bg-success';
  if (score < 3) return 'bg-info text-dark';
  if (score < 4) return 'bg-warning text-dark';
  return 'bg-danger';
};

/**
 * Helper: Check if a node is compromisable (has at least one 'open' threat)
 */
const isCompromisable = (node) => {
  const data = node.getData() || {};
  if (!data.threats || !Array.isArray(data.threats) || data.threats.length === 0) {
    return false;
  }
  // Check if any threat is status 'open' (not 'mitigated')
  return data.threats.some(t => t.status && t.status.toLowerCase() === 'open');
};

/**
 * Helper: Get Minimum TTC from a node's open threats
 */
const getMinTTC = (node) => {
  const data = node.getData() || {};
  if (!isCompromisable(node)) return Infinity;

  const openThreats = data.threats.filter(t => t.status && t.status.toLowerCase() === 'open');
  if (openThreats.length === 0) return Infinity;

  // Extract TTCs and find min. Parse as float.
  const ttcs = openThreats.map(t => parseFloat(t.ttc) || 0);
  return Math.min(...ttcs);
};

/**
 * Helper: Reset previous simulation path visualization
 */
const resetStencilAttackPathFill = (cell) => {
  if (!cell?.isNode?.()) return;

  const data = cell.getData?.() || {};
  if (cell.shape === 'trust-boundary-box' || data.type === 'tm.BoundaryBox') return;

  cell.setAttrByPath?.('body/fill', 'transparent');
  cell.setAttrByPath?.('body/fillOpacity', 0);
};

const clearAttackPath = (model, { resetStencilFill = false } = {}) => {
  const cells = model?.getCells?.() || [];
  cells.forEach(cell => {
    const data = cell.getData() || {};
    if (data.isAttackPath) {
      cell.setData({ isAttackPath: false }, { merge: true, skipSelection: true });
      dataChanged.updateStyleAttrs(cell);
      if (resetStencilFill) {
        resetStencilAttackPathFill(cell);
      }
    }
  });
};

const clearStencilAttackPath = () => {
  const stencil = stencilController?.value?.stencil;
  if (!stencil?.graphs) return;

  Object.values(stencil.graphs).forEach((stencilGraph) => {
    clearAttackPath(stencilGraph, { resetStencilFill: true });
  });
};

/**
 * Core Algorithm: Find ALL Shortest Paths (All Optimal Paths)
 * @param model X6 Graph Model
 * @param startId ID of Entry Node
 * @param targetId ID of Target Node
 * @param weightType 'edge' (hops) or 'ttc' (time)
 */
const findAllShortestPaths = (model, startId, targetId, weightType) => {
  const nodes = model.getNodes();
  const edges = model.getEdges();

  const adj = new Map();
  nodes.forEach(n => adj.set(n.id, []));

  edges.forEach(edge => {
    const sourceId = edge.getSourceCellId();
    const targetId = edge.getTargetCellId();
    if (sourceId && targetId && adj.has(sourceId)) {
        adj.get(sourceId).push({ neighborId: targetId, edgeId: edge.id });
    }
  });

  const distances = new Map();
  // previous stores list of possible predecessors for traversing optimal path
  // Map<NodeId, Array<{ prevNodeId: string, edgeId: string }>>
  const previous = new Map(); 
  const queue = [];

  nodes.forEach(n => {
    distances.set(n.id, Infinity);
    previous.set(n.id, []);
    queue.push(n.id);
  });

  const startNodeCell = nodes.find(n => n.id === startId);
  if (!startNodeCell) return null;

  if (!isCompromisable(startNodeCell)) {
      toast.error("Entry Node has no open threats and cannot be compromised!");
      return null;
  }

  let startCost = 0;
  if (weightType === 'ttc') {
      startCost = getMinTTC(startNodeCell);
  }
  distances.set(startId, startCost);

  while (queue.length > 0) {
    queue.sort((a, b) => distances.get(a) - distances.get(b));
    const uId = queue.shift();

    if (distances.get(uId) === Infinity) break;
    // Note: In standard Dijkstra for single path we break early. 
    // For ALL paths, we must continue to explore to find other equal cost paths to target?
    // Actually, once we pull target from queue, we found min cost. 
    // But we might have other nodes in queue with SAME min cost that also lead to target?
    // Safe to continue until queue front > target dist, or just process normally.
    // Standard approach: Process normally. We track multiple predecessors during relaxation.
    
    // Slight Optimization: if uId == targetId, we don't strictly need to expand IT, 
    // but we need to ensure we reached it from all possible parents. 
    // By the time uId is popped, its distance is finalized.

    const userNeighbors = adj.get(uId) || [];
    
    for (const { neighborId, edgeId } of userNeighbors) {
        // queue check strictly not needed for correctness if logic is robust, but optimization
        if (!queue.includes(neighborId) && distances.get(neighborId) !== Infinity) {
             // Already processed (closed set). In strict Dijkstra with positive weights, we don't revisit.
             // But if we found an EQUAL path later? Dijkstra guarantees nodes popped in increasing order.
             // So if neighbor is already popped, we found a <= path before.
             // If we found a strictly shorter path now? Impossible in Dijkstra.
             // If we found an EQUAL path? We might accept it.
             // Usually Dijkstra doesn't revisit 'closed' nodes.
             // Let's stick to standard relaxation: check if we can improve OR equal it.
        }

        const neighborNode = nodes.find(n => n.id === neighborId);
        if (!isCompromisable(neighborNode)) continue;

        let weight = 0;
        if (weightType === 'edge') {
            weight = 1; 
        } else {
            weight = getMinTTC(neighborNode);
        }

        const alt = distances.get(uId) + weight;
        const currentDist = distances.get(neighborId);

        // Tolerance for floating point (TTC)
        const EPSILON = 0.0001;

        if (alt < currentDist - EPSILON) {
            // Found strictly shorter path
            distances.set(neighborId, alt);
            previous.set(neighborId, [{ prevNodeId: uId, edgeId }]);
        } else if (Math.abs(alt - currentDist) < EPSILON) {
            // Found equal optimal path
            previous.get(neighborId).push({ prevNodeId: uId, edgeId });
        }
    }
  }

  if (distances.get(targetId) === Infinity) {
      return null; 
  }

  // Backtracking to reconstruct ALL paths
  // Returns Array of { nodes: [], edges: [], totalCost }
  const allPaths = [];
  const minCost = distances.get(targetId);

  const backtrack = (currentId, currentPathNodes, currentPathEdges) => {
      // Prepend current node
      const newPathNodes = [currentId, ...currentPathNodes];
      
      if (currentId === startId) {
          allPaths.push({
              nodes: newPathNodes,
              edges: [...currentPathEdges], // Edges are already in correct reverse order? No, edges added below are predecessors
              // Let's check edge order.
              totalCost: minCost
          });
          return;
      }

      const parents = previous.get(currentId) || [];
      parents.forEach(({ prevNodeId, edgeId }) => {
          // Edge: prev -> current.
          // Since we build path backwards (Target -> Start), we prepend edges?
          // currentPathEdges accumulates edges: E_last, E_last-1...
          backtrack(prevNodeId, newPathNodes, [edgeId, ...currentPathEdges]);
      });
  };

  backtrack(targetId, [], []);

  return {
    paths: allPaths,
    totalCost: minCost
  };
};

/**
 * Common Logic to run simulation
 */
const runSimulation = (weightType) => {
    // 1. Validation
    if (!tmStore.entryNode) {
        toast.warning("Please set an Entry node first.");
        return;
    }
    if (!tmStore.targetNode) {
        toast.warning("Please set a Target node first.");
        return;
    }

    // Access Model
    // Use injected graph instance directly if available (preferred)
    let model = null;
    if (graph && graph.value) {
        model = graph.value;
    } else if (cellRef.value && cellRef.value.model) {
        model = cellRef.value.model;
    }

    if (!model) {
        toast.error("Graph model not found. Please refresh or check application state.");
        return;
    }
    
    // UI Feedback: Start Loading
    isSimulating.value = true;

    // Use setTimeout to allow UI to render Loading state before heavy calculation
    setTimeout(() => {
        try {
            // Clear previous
            const rawModel = toRaw(model);
            console.log("Graph Model Type:", rawModel);
            
            clearAttackPath(rawModel);

            // Run Algorithm
            const result = findAllShortestPaths(rawModel, tmStore.entryNode, tmStore.targetNode, weightType);

            if (!result || result.paths.length === 0) {
                toast.error(`No valid attack path found for ${weightType.toUpperCase()} analysis. Check connectivity and open threats.`);
                return;
            }

            // Save to Store for Report
            // malsim 결과 초기화
            tmStore.malsimResult = null;
            tmStore.simulationResult = {
                paths: result.paths,
                totalCost: result.totalCost,
                weightType: weightType
            };

            // Visualisation
            result.paths.forEach(path => {
                // Highlight Nodes
                path.nodes.forEach(nodeId => {
                    // Safe lookup for cell
                    let cell = null;
                    if (typeof rawModel.getCell === 'function') {
                        cell = rawModel.getCell(nodeId);
                    } else if (typeof rawModel.getCellById === 'function') {
                        cell = rawModel.getCellById(nodeId);
                    }

                    if (cell) {
                        const data = cell.getData() || {};
                        if (!data.isAttackPath) {
                            cell.setData({ isAttackPath: true }, { merge: true, skipSelection: true });
                            dataChanged.updateStyleAttrs(cell);
                        }
                    } else {
                        console.warn(`Could not find cell for Node ID: ${nodeId}`);
                    }
                });

                // Highlight Edges
                path.edges.forEach(edgeId => {
                    let cell = null;
                    if (typeof rawModel.getCell === 'function') {
                        cell = rawModel.getCell(edgeId);
                    } else if (typeof rawModel.getCellById === 'function') {
                        cell = rawModel.getCellById(edgeId);
                    }

                    if (cell) {
                        const data = cell.getData() || {};
                        if (!data.isAttackPath) {
                            cell.setData({ isAttackPath: true }, { merge: true, skipSelection: true });
                            dataChanged.updateStyleAttrs(cell);
                        }
                    } else {
                        console.warn(`Could not find cell for Edge ID: ${edgeId}`);
                    }
                });
            });

            const costLabel = weightType === 'ttc' ? `${result.totalCost.toFixed(1)} hrs` : `${result.totalCost} hops`;
            const pathCountMsg = result.paths.length > 1 ? ` (${result.paths.length} paths found)` : '';
            toast.success(`Attack Path Found! Cost: ${costLabel}${pathCountMsg}`);

        } catch (error) {
            console.error(error);
            toast.error("An error occurred during simulation.");
        } finally {
            isSimulating.value = false;
        }
    }, 100);
};

const startTTCHandler = () => {
    if (dropdown) dropdown.hide(); // 드롭다운 닫기
    console.log("Starting TTC Analysis...");
    runSimulation('ttc');
};

const startEdgeHandler = () => {
    if (dropdown) dropdown.hide(); // 드롭다운 닫기
    console.log("Starting Edge Path Analysis...");
    runSimulation('edge');
};

// --- malsim 시뮬레이션 핸들러 ---
const startMalsimHandler = async () => {
    if (dropdown) dropdown.hide(); // 드롭다운 닫기
    
    if (!canRunMalsim.value) {
        if (!hasLanguageGraph.value) {
            toast.error('MAL Simulator requires a MAL LangGraph');
        } else if (!canUseLanguageForMalsim.value) {
            toast.error('Missing original MAL LangGraph data. Please create the diagram from a MAL LangGraph file again.');
        } else if (!tmStore.entryThreat) {
            toast.error('Please select Entry threat');
        } else if (!tmStore.targetThreat) {
            toast.error('Please select Target threat');
        }
        return;
    }
    
    isSimulating.value = true;
    
    // 이전 결과 초기화
    tmStore.simulationResult = null;
    let sessionId = null;
    
    try {
        // Entry/Target 형식: "AssetName:attackStep"
        const entryStep = tmStore.entryThreat.attackStep || tmStore.entryThreat.technique;
        const goalStep = tmStore.targetThreat.attackStep || tmStore.targetThreat.technique;
        const entryPoint = `${tmStore.entryThreat.nodeName}:${entryStep}`;
        const goal = `${tmStore.targetThreat.nodeName}:${goalStep}`;
        
        console.log(`[malsim] Running simulation: ${entryPoint} -> ${goal}`);
        
        // 1. 시뮬레이션 시작 (sessionId 받기)
        // 원본 파일(.mar, .json)을 전송해야 함
        const graphInstance = graph?.value ? toRaw(graph.value) : null;
        const currentDiagram = graphInstance?.toJSON
            ? graphInstance.toJSON()
            : tmStore.modifiedDiagram;
        const malModel = createMalModelFromDiagram(tmStore.data, currentDiagram);

        if (Object.keys(malModel.assets || {}).length === 0) {
            throw new Error('No MAL assets exist in the current diagram.');
        }

        const modelNameBase = tmStore.data.modelInfo?.title || tmStore.fileName || 'AutoTARA';
        const modelFile = new File(
            [JSON.stringify(malModel, null, 2)],
            `${modelNameBase.replace(/\.json$/i, '')}_Model.json`,
            { type: 'application/json' }
        );

        if (!malsimLanguageGraphSourceText.value) {
            throw new Error('Missing original MAL LangGraph data.');
        }
        const languageFile = new File(
            [malsimLanguageGraphSourceText.value],
            'langGraph.json',
            { type: 'application/json' }
        );

        const startResult = await runMalsimApi(
            entryPoint,
            goal,
            languageFile,
            modelFile,
            {
                seed: 42,
                ttcMode: 0,
                languageType: 'langGraph'
            }
        );
        
        sessionId = startResult.sessionId;
        console.log(`[malsim] Simulation started. Session ID: ${sessionId}`);
        // toast.info(`Simulation started. Waiting for completion...`);
        
        // 2. 폴링으로 상태 확인
        const maxWaitTime = 60000; // 최대 60초
        const pollInterval = 3000; // 3초마다 확인
        const startTime = Date.now();
        
        let status = 'pending';
        
        while (status === 'pending' || status === 'running') {
            // 타임아웃 확인
            if (Date.now() - startTime > maxWaitTime) {
                throw new Error('Simulation timeout. Please check the Python server logs.');
            }
            
            // 3초 대기
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            
            // 상태 조회
            const statusData = await import('@/service/mal/malApiService.js')
                .then(module => module.getSimulationStatus(sessionId));
            
            status = statusData.status;
            console.log(`[malsim] Status: ${status}`);
            
            if (status === 'failed') {
                const serverError = statusData.error || statusData.message || '';
                if (isNoMalsimPathError(serverError)) {
                    showNoMalsimPathMessage();
                    return;
                }
                throw new Error(serverError || 'Simulation failed on the server');
            }
        }
        
        // 3. 완료 후 결과 조회
        if (status === 'completed') {
            const resultData = await import('@/service/mal/malApiService.js')
                .then(module => module.getSimulationResult(sessionId, { view: 'shortest' }));
            
            console.log('[malsim] Result:', resultData);
            
            // 결과 객체 구조:
            // {
            //   session_id: string,
            //   status: "completed",
            //   result: {
            //     attack_path_found: boolean,
            //     attack_paths: {
            //       "Attacker": {
            //         "GoalNode:attackStep": [
            //           { id, name, full_name, type },
            //           ...
            //         ]
            //       }
            //     }
            //   }
            // }
            
            const result = resultData.result || {};
            const attackPathFound = result.attack_path_found || false;
            const attackPaths = result.attack_paths || {};
            
            if (!attackPathFound) {
                showNoMalsimPathMessage();
                return;
            }
            
            // 공격 경로를 store에 저장
            tmStore.malsimResult = {
                sessionId,
                attackPathFound,
                attackPaths,
                attackPath: result.attack_path || null,
                attackGraph: result.attack_graph || resultData.attack_graph || null,
                artifacts: result.artifacts || {},
                rawResult: resultData
            };

            tmStore.upsertMalsimSession({
                sessionId,
                createdAt: resultData.created_at || new Date().toISOString(),
                simulationResult: tmStore.malsimResult
            });
            
            // 공격 경로 시각화
            visualizeMalsimResult(attackPaths);
            
            // 공격 경로 개수 계산
            let totalPaths = 0;
            let maxSteps = 0;
            
            Object.values(attackPaths).forEach(agentPaths => {
                Object.values(agentPaths).forEach(goalPaths => {
                    const paths = (goalPaths.length > 0 && Array.isArray(goalPaths[0])) ? goalPaths : [goalPaths];
                    paths.forEach(path => {
                        totalPaths++;
                        maxSteps = Math.max(maxSteps, path.length);
                    });
                });
            });
            
            toast.success(`Attack path found! ${totalPaths} path(s), max ${maxSteps} steps.`);
        }
        
    } catch (error) {
        console.error('[malsim] Error:', error);
        if (isNoMalsimPathError(error.message)) {
            showNoMalsimPathMessage();
        } else {
            toast.error(error.message || 'Failed to run malsim simulation');
        }
    } finally {
        isSimulating.value = false;
    }
};

// malsim 결과 시각화
const visualizeMalsimResult = (attackPaths) => {
    let model = null;
    if (graph && graph.value) {
        model = toRaw(graph.value);
    } else if (cellRef.value && cellRef.value.model) {
        model = cellRef.value.model;
    }
    
    if (!model) return;
    
    // 이전 공격 경로 초기화
    clearAttackPath(model);
    
    // 공격 경로에 포함된 자산 이름 추출
    // attackPaths 구조: { "Attacker": { "Goal:step": [{ full_name: "Asset:step", ... }] } }
    const attackedAssets = new Set();
    
    Object.values(attackPaths).forEach(agentPaths => {
        Object.values(agentPaths).forEach(goalPaths => {
            const paths = (goalPaths.length > 0 && Array.isArray(goalPaths[0])) ? goalPaths : [goalPaths];
            paths.forEach(pathNodes => {
                pathNodes.forEach(node => {
                    // full_name: "AssetName:attackStep" 형식
                    // 자산 이름만 추출 (콜론 앞부분)
                    if (node && node.full_name) {
                        const assetName = node.full_name.split(':')[0];
                        attackedAssets.add(assetName);
                    }
                });
            });
        });
    });
    
    console.log('[malsim] Attacked assets:', Array.from(attackedAssets));
    
    // 모든 노드 순회하며 공격 경로에 포함된 노드 하이라이트
    const nodes = model.getNodes();
    nodes.forEach(node => {
        const data = node.getData() || {};
        const nodeName = data.name;
        
        if (attackedAssets.has(nodeName)) {
            node.setData({ isAttackPath: true }, { merge: true, skipSelection: true });
            dataChanged.updateStyleAttrs(node);
        }
    });

    // 엣지 하이라이트: 공격 경로 상의 인접한 자산 사이의 엣지를 찾음
    const edges = model.getEdges();
    
    Object.values(attackPaths).forEach(agentPaths => {
        Object.values(agentPaths).forEach(goalPaths => {
            const paths = (goalPaths.length > 0 && Array.isArray(goalPaths[0])) ? goalPaths : [goalPaths];
            paths.forEach(pathNodes => {
                for (let i = 0; i < pathNodes.length - 1; i++) {
                    if (!pathNodes[i] || !pathNodes[i].full_name || !pathNodes[i+1] || !pathNodes[i+1].full_name) continue;
                    
                    const currentAsset = pathNodes[i].full_name.split(':')[0];
                    const nextAsset = pathNodes[i+1].full_name.split(':')[0];
                    
                    if (currentAsset === nextAsset) continue; // 같은 자산 내 이동은 엣지 하이라이트 스킵
                    
                    // 그래프에서 두 자산 이름에 해당하는 노드 ID 찾기
                    const currentNode = nodes.find(n => n.getData()?.name === currentAsset);
                    const nextNode = nodes.find(n => n.getData()?.name === nextAsset);
                    
                    if (currentNode && nextNode) {
                        const currentId = currentNode.id;
                        const nextId = nextNode.id;
                        
                        // 두 노드 사이의 엣지 찾기 (방향 무관하게 연결된 엣지 하이라이트)
                        const connectedEdges = edges.filter(edge => {
                            const source = edge.getSourceCellId();
                            const target = edge.getTargetCellId();
                            return (source === currentId && target === nextId) || 
                                   (source === nextId && target === currentId);
                        });
                        
                        connectedEdges.forEach(edge => {
                            const data = edge.getData() || {};
                            if (!data.isAttackPath) {
                                edge.setData({ isAttackPath: true }, { merge: true, skipSelection: true });
                                dataChanged.updateStyleAttrs(edge);
                            }
                        });
                    }
                }
            });
        });
    });
};

// --- Threat Modal 함수들 ---
const openThreatModal = (mode, node) => {
    const data = node.getData() || {};
    
    threatModalMode.value = mode;
    threatModalNodeId.value = node.id;
    threatModalNodeName.value = data.name || node.id;
    threatModalNodeType.value = data.malInfo?.assetType || data.type || 'Unknown';
    threatModalThreats.value = (data.threats || []).filter(t => t.status === 'open');
    
    if (threatModalThreats.value.length === 0) {
        toast.warning("This node has no open threats");
        return;
    }
    
    showThreatModal.value = true;
};

const closeThreatModal = () => {
    showThreatModal.value = false;
};

const onThreatSelected = (selection) => {
    // selection: { nodeId, nodeName, threatId, attackStep, technique, ttc }
    const mode = threatModalMode.value;
    
    if (mode === 'entry') {
        tmStore.entryThreat = selection;
        tmStore.entryNode = selection.nodeId;
        // Target과 같은 노드면 Target 해제
        if (tmStore.targetNode === selection.nodeId) {
            tmStore.targetNode = null;
            tmStore.targetThreat = null;
        }
    } else {
        tmStore.targetThreat = selection;
        tmStore.targetNode = selection.nodeId;
        // Entry와 같은 노드면 Entry 해제
        if (tmStore.entryNode === selection.nodeId) {
            tmStore.entryNode = null;
            tmStore.entryThreat = null;
        }
    }
    
    // 노드 스타일 업데이트
    updateNodeStyles(selection.nodeId, mode);
    
    closeThreatModal();
    const selectedStep = selection.attackStep || selection.technique;
    toast.success(`${mode === 'entry' ? 'Entry' : 'Target'} set: ${selection.nodeName}:${selectedStep}`);
    tmStore.setModified();
};

// 노드 스타일 업데이트 (Entry/Target 표시)
const updateNodeStyles = (nodeId, mode) => {
    let model = null;
    if (graph && graph.value) {
        model = toRaw(graph.value);
    } else if (cellRef.value && cellRef.value.model) {
        model = cellRef.value.model;
    }
    
    if (!model) return;
    
    const nodes = model.getNodes();
    nodes.forEach(node => {
        const data = node.getData() || {};
        const isSelectedNode = node.id === nodeId;
        
        let nextIsEntry = data.isEntry || false;
        let nextIsTarget = data.isTarget || false;
        
        if (isSelectedNode) {
            if (mode === 'entry') {
                nextIsEntry = true;
                nextIsTarget = false;
            } else {
                nextIsTarget = true;
                nextIsEntry = false;
            }
        } else {
            // 다른 노드에서 같은 역할 해제
            if (mode === 'entry' && data.isEntry) {
                nextIsEntry = false;
            }
            if (mode === 'target' && data.isTarget) {
                nextIsTarget = false;
            }
        }
        
        if (nextIsEntry !== data.isEntry || nextIsTarget !== data.isTarget) {
            node.setData({ isEntry: nextIsEntry, isTarget: nextIsTarget }, { merge: true, skipSelection: true });
            dataChanged.updateStyleAttrs(node);
        }
    });
};

// --- 1. Entry 설정 핸들러 ---
const setEntryHandler = () => {
  if (!canUseSelectedThreatAsset.value) return;

  const selectedNode = cellRef.value;
  const currentData = selectedNode.getData() || {};
  
  // LangGraph models set Entry through the threat selection modal.
  if (hasLanguageGraph.value) {
    openThreatModal('entry', selectedNode);
    return;
  }
  
  // 기존 Entry 설정 로직 (malsim 없을 때)
  const newIsEntry = !currentData.isEntry;

  const model = selectedNode.model;
  if (!model) return;

  // 그래프의 모든 노드를 순회하며 상태 동기화
  const allNodes = model.getNodes();

  allNodes.forEach(node => {
    const data = node.getData() || {};
    const isSelected = node.id === selectedNode.id;

    let nextIsEntry = data.isEntry;
    let nextIsTarget = data.isTarget;
    let isModified = false;

    if (isSelected) {
      // 1. 선택된 노드 처리
      nextIsEntry = newIsEntry;
      if (newIsEntry) {
        nextIsTarget = false; // Entry가 되면 Target은 해제
      }
      isModified = true; // 선택된 노드는 무조건 업데이트 (스타일 갱신 등을 위해)
    } else {
      // 2. 다른 노드 처리
      // Entry를 새로 설정하는 경우, 다른 노드의 Entry 속성을 해제
      if (newIsEntry && nextIsEntry) {
        nextIsEntry = false;
        isModified = true;
      }
    }

    // 데이터가 변경되었거나, 선택된 노드인 경우 업데이트 수행
    if (isModified || nextIsEntry !== data.isEntry || nextIsTarget !== data.isTarget) {
      node.setData({ isEntry: nextIsEntry, isTarget: nextIsTarget }, { merge: true, skipSelection: true });
      dataChanged.updateStyleAttrs(node);
    }
  });

  // [3] Store 업데이트
  if (newIsEntry) {
    tmStore.entryNode = selectedNode.id;
    // Target이었다가 Entry가 된 경우 Store의 targetNode 해제
    if (tmStore.targetNode === selectedNode.id) tmStore.targetNode = null;
  } else {
    if (tmStore.entryNode === selectedNode.id) tmStore.entryNode = null;
  }
  tmStore.setModified();
};

// --- 2. Target 설정 핸들러 ---
const setTargetHandler = () => {
  if (!canUseSelectedThreatAsset.value) return;

  const selectedNode = cellRef.value;
  const currentData = selectedNode.getData() || {};
  
  // LangGraph models set Target through the threat selection modal.
  if (hasLanguageGraph.value) {
    openThreatModal('target', selectedNode);
    return;
  }
  
  // 기존 Target 설정 로직 (malsim 없을 때)
  const newIsTarget = !currentData.isTarget;

  const model = selectedNode.model;
  if (!model) return;

  // 그래프의 모든 노드를 순회하며 상태 동기화
  const allNodes = model.getNodes();

  allNodes.forEach(node => {
    const data = node.getData() || {};
    const isSelected = node.id === selectedNode.id;

    let nextIsEntry = data.isEntry;
    let nextIsTarget = data.isTarget;
    let isModified = false;

    if (isSelected) {
      // 1. 선택된 노드 처리
      nextIsTarget = newIsTarget;
      if (newIsTarget) {
        nextIsEntry = false; // Target이 되면 Entry는 해제
      }
      isModified = true; // 선택된 노드는 무조건 업데이트
    } else {
      // 2. 다른 노드 처리
      // Target을 새로 설정하는 경우, 다른 노드의 Target 속성을 해제
      if (newIsTarget && nextIsTarget) {
        nextIsTarget = false;
        isModified = true;
      }
    }

    // 데이터가 변경되었거나, 선택된 노드인 경우 업데이트 수행
    if (isModified || nextIsEntry !== data.isEntry || nextIsTarget !== data.isTarget) {
      node.setData({ isEntry: nextIsEntry, isTarget: nextIsTarget }, { merge: true, skipSelection: true });
      dataChanged.updateStyleAttrs(node);
    }
  });

  // [3] Store 업데이트
  if (newIsTarget) {
    tmStore.targetNode = selectedNode.id;
    if (tmStore.entryNode === selectedNode.id) tmStore.entryNode = null;
  } else {
    if (tmStore.targetNode === selectedNode.id) tmStore.targetNode = null;
  }
  tmStore.setModified();
};

const resetHandler = () => {
  // [1] Graph 접근: 주입된 graph 객체 우선 사용
  let model = null;
  if (graph && graph.value) {
      model = graph.value;
  } else if (cellRef.value && cellRef.value.model) {
      model = cellRef.value.model;
  }

  if (!model) {
      clearStencilAttackPath();
      // 모델 접근 불가 시 스토어 데이터만이라도 안전하게 초기화
      if (tmStore.entryNode || tmStore.targetNode) {
          tmStore.entryNode = null;
          tmStore.targetNode = null;
          tmStore.setModified();
      }
      return;
  }

  // [2] 전체 노드 순회하며 Entry/Target/AttackPath 속성 제거
  // Clear Attack Path manually here as well
  clearAttackPath(model);
  clearStencilAttackPath();

  const allNodes = model.getNodes();
  
  allNodes.forEach(node => {
    const data = node.getData() || {};
    if (data.isEntry || data.isTarget) {
      // skipSelection: true로 선택 이벤트 발생 방지 및 데이터 보호
      node.setData({ isEntry: false, isTarget: false }, { merge: true, skipSelection: true });
      dataChanged.updateStyleAttrs(node);
    }
  });

  // [3] Store 초기화
  tmStore.entryNode = null;
  tmStore.targetNode = null;
  tmStore.setModified();
};
</script>

<style scoped>
.btn-white {
  background-color: #ffffff;
  color: #495057;
  border-color: #dee2e6;
}
.btn-white:hover {
  background-color: #f8f9fa;
  border-color: #c6c7ca;
}
/* 툴바 컨테이너 배경 */
.toolbar-container {
  background-color: #f8f9fa; /* Bootstrap bg-light color */
}
  /* 구분선 */
.vr {
  align-self: center;
  height: 24px;
  width: 1px;
  background-color: #ccc;
  opacity: 1;
}

.tara-search {
  max-width: 320px;
}

.tara-status-tabs .nav-link {
  color: #495057;
  font-weight: 600;
}

.tara-status-backdrop {
  z-index: 1040;
}

.tara-status-modal {
  z-index: 1050;
}

.tara-status-modal-dialog {
  max-width: min(1440px, calc(100vw - 48px));
}

.tara-asset-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tara-asset-item {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  background-color: #ffffff;
  overflow: hidden;
}

.tara-asset-item.is-expanded {
  border-color: #9ec5fe;
  box-shadow: 0 8px 24px rgba(33, 37, 41, 0.08);
}

.tara-asset-summary {
  display: grid;
  grid-template-columns: 28px minmax(180px, 1fr) auto;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 16px 18px;
  border: 0;
  background: #ffffff;
  color: #212529;
  text-align: left;
}

.tara-asset-summary:hover {
  background: #f8f9fa;
}

.tara-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: #495057;
}

.tara-asset-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tara-asset-name {
  font-weight: 700;
  color: #212529;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tara-asset-type {
  margin-top: 2px;
  color: #6c757d;
  font-size: 0.82rem;
}

.tara-asset-metrics {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.tara-metric {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 86px;
  padding: 6px 10px;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  background: #f8f9fa;
}

.tara-metric.danger {
  border-color: #f1aeb5;
  background: #fff5f5;
  color: #b02a37;
}

.tara-metric.success {
  border-color: #a3cfbb;
  background: #f2fbf6;
  color: #146c43;
}

.tara-metric-value {
  font-weight: 700;
}

.tara-metric-label {
  color: inherit;
  font-size: 0.74rem;
  text-transform: uppercase;
}

.tara-threat-panel {
  padding: 14px 18px 18px 62px;
  border-top: 1px solid #e9ecef;
  background: #fbfcfd;
}

.tara-empty-threats {
  color: #6c757d;
  font-size: 0.9rem;
}

.tara-threat-grid {
  border: 1px solid #e9ecef;
  border-radius: 6px;
  background: #ffffff;
  overflow: hidden;
}

.tara-threat-grid-header,
.tara-threat-grid-row {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) 150px minmax(0, 1fr) 110px;
  gap: 16px;
  align-items: center;
}

.tara-threat-grid-header > span,
.tara-threat-grid-row > span,
.tara-threat-grid-row > button {
  min-width: 0;
}

.tara-threat-grid-header {
  padding: 10px 14px;
  background: #f1f3f5;
  color: #6c757d;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
}

.tara-threat-grid-row {
  padding: 12px 14px;
  border-top: 1px solid #edf0f2;
  font-size: 0.9rem;
}

.tara-threat-grid-row:hover {
  background: #f8f9fa;
}

.tara-threat-cell-center {
  text-align: center;
}

.tara-threat-name {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.tara-threat-name:hover {
  color: #0d6efd !important;
  text-decoration: underline;
}

.tara-mitre-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 3px 9px;
  border: 1px solid #b6d4fe;
  border-radius: 999px;
  background: #eef6ff;
  color: #084298;
  font-size: 0.78rem;
  font-weight: 700;
}

.tara-mitre-badge.empty {
  border-color: #dee2e6;
  background: #f8f9fa;
  color: #6c757d;
}

.tara-risk-badge {
  min-width: 44px;
  padding: 6px 11px;
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1;
}

.tara-matrix-wrap {
  max-height: 65vh;
  overflow: auto;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  background: #ffffff;
}

.tara-matrix-table {
  min-width: max-content;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.85rem;
}

.tara-matrix-table th,
.tara-matrix-table td {
  height: 42px;
  padding: 8px 12px;
  border-right: 1px solid #edf0f2;
  border-bottom: 1px solid #edf0f2;
  white-space: nowrap;
}

.tara-matrix-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #f1f3f5;
  color: #495057;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.tara-matrix-table tbody tr:hover td {
  background: #f8f9fa;
}

.tara-matrix-sticky {
  position: sticky;
  z-index: 3;
  background: #ffffff;
}

.tara-matrix-table thead .tara-matrix-sticky {
  z-index: 4;
  background: #f1f3f5;
}

.tara-matrix-id-col {
  left: 0;
  width: 158px;
  min-width: 158px;
}

.tara-matrix-risk-col {
  left: 378px;
  width: 112px;
  min-width: 112px;
  text-align: center;
  border-right: 1px solid #ced4da !important;
  font-weight: 700;
}

.tara-matrix-technique-col {
  left: 158px;
  width: 220px;
  min-width: 220px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tara-matrix-asset-col {
  width: 132px;
  min-width: 132px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}

.tara-matrix-hit-cell {
  width: 132px;
  min-width: 132px;
  text-align: center;
  color: #0d6efd;
  font-weight: 800;
}

.tara-matrix-hit-cell.hit {
  background: #e7f1ff;
}

.tara-mitigation-id-col {
  left: 0;
  width: 170px;
  min-width: 170px;
}

.tara-mitigation-name-col {
  left: 170px;
  width: 280px;
  min-width: 280px;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  border-right: 1px solid #ced4da !important;
}

.tara-mitigation-technique-col {
  width: 132px;
  min-width: 132px;
  text-align: center;
}

.tara-mitigation-effect-cell {
  width: 132px;
  min-width: 132px;
  text-align: center;
}

.tara-mitigation-effect-cell.hit {
  background: #f2fbf6;
}

.tara-effect-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  min-height: 24px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 800;
}

.tara-effect-badge.effect-ph {
  background: #d1e7dd;
  color: #0f5132;
}

.tara-effect-badge.effect-rm {
  background: #fff3cd;
  color: #664d03;
}

.tara-effect-badge.effect-dl {
  background: #cff4fc;
  color: #055160;
}

.tara-effect-badge[class*="effect-p"] {
  background: #d1e7dd;
  color: #0f5132;
}

.tara-effect-badge[class*="effect-r"] {
  background: #fff3cd;
  color: #664d03;
}

.tara-effect-badge[class*="effect-d"] {
  background: #cff4fc;
  color: #055160;
}

@media (max-width: 992px) {
  .tara-asset-summary,
  .tara-threat-grid-header,
  .tara-threat-grid-row {
    grid-template-columns: 1fr;
  }

  .tara-asset-summary {
    gap: 10px;
  }

  .tara-asset-metrics {
    justify-content: flex-start;
  }

  .tara-threat-panel {
    padding-left: 18px;
  }

  .tara-threat-grid-header {
    display: none;
  }
}
</style>

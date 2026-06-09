<template>
  <!-- Hidden File Input -->
  <input
    type="file"
    ref="fileInput"
    class="d-none"
    accept=".json"
    @change="handleFileSelected"
  >

  <!-- Report Modal -->
  <simulation-report-modal
    :visible="showReport"
    :graph="graph"
    @close="showReport = false"
  />

  <div class="d-flex align-items-center gap-2">
    <div class="btn-group shadow-sm" role="group">
      <button type="button" class="btn btn-sm btn-white border" title="Open" @click="openFileHandler">
        <i class="fa-solid fa-folder-open text-secondary"></i>
      </button>
      <button type="button" class="btn btn-sm btn-white border" title="Save" @click="saveFileHandler">
        <i class="fa-solid fa-floppy-disk text-primary"></i>
      </button>
      <button type="button" class="btn btn-sm btn-white border" title="Extract Model" @click="extractModelHandler">
        <i class="fa-solid fa-file-export text-success"></i>
      </button>
    </div>

    <div class="btn-group shadow-sm" role="group">
      <button type="button" class="btn btn-sm btn-white border" title="Undo" @click="undoHandler" :disabled="!canUndo">
        <i class="fa-solid fa-arrow-rotate-left" :class="{ 'text-muted': !canUndo }"></i>
      </button>
      <button type="button" class="btn btn-sm btn-white border" title="Redo" @click="redoHandler" :disabled="!canRedo">
        <i class="fa-solid fa-arrow-rotate-right" :class="{ 'text-muted': !canRedo }"></i>
      </button>
    </div>

    <div class="btn-group shadow-sm" role="group">
      <button type="button" class="btn btn-sm btn-white border" title="Zoom In" @click="zoomInHandler">
        <i class="fa-solid fa-magnifying-glass-plus"></i>
      </button>
      <button type="button" class="btn btn-sm btn-white border" title="Zoom Out" @click="zoomOutHandler">
        <i class="fa-solid fa-magnifying-glass-minus"></i>
      </button>
    </div>

    <button
      type="button"
      class="btn btn-sm btn-white border disabled"
      title="Auto Layout"
      @click="applyHierarchicalLayout"
    >
    <i class="fa-solid fa-diagram-project"></i>
    </button>

    <button type="button" class="btn btn-sm btn-white border shadow-sm text-danger" title="Delete Selected" @click="deleteHandler" :disabled="!cellStore.hasSelected">
      <i class="fa-solid fa-trash"></i>
    </button>

    <div class="vr text-muted mx-1"></div>

    <div class="btn-group shadow-sm">
      <button type="button" class="btn btn-sm btn-white border" title="Screenshot" @click="screenshotHandler">
        <i class="fa-solid fa-camera"></i>
      </button>
      <button 
        type="button" 
        class="btn btn-sm btn-white border fw-bold text-dark" 
        title="Create Report" 
        @click="openReportHandler" 
        :disabled="!hasReportResult"
      >
        <i class="fa-solid fa-file-lines me-1" :class="{'text-muted': !hasReportResult, 'text-primary': hasReportResult}"></i> Report
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, ref, onMounted, onUnmounted, watch } from 'vue';
import { useThreatModelStore } from '@/stores/threatModelStore.js';
import { useCellStore } from '@/stores/cellStore.js';
import SimulationReportModal from './SimulationReportModal.vue';
import { storeToRefs } from 'pinia';
import saveService from '@/service/save.js';
import { createMalModelFromDiagram } from '@/service/mal/modelTransform.js';

const graph = inject('graph');
const tmStore = useThreatModelStore();
const cellStore = useCellStore();

// Reactive references for Store
const { simulationResult, malsimResult } = storeToRefs(tmStore);
const hasReportResult = computed(() => Boolean(simulationResult.value || malsimResult.value));

// Modal State
const showReport = ref(false);

const openReportHandler = () => {
    if (hasReportResult.value) {
        showReport.value = true;
    }
};

// File input ref
const fileInput = ref(null);

// Layout Dropdown State
const showLayoutDropdown = ref(false);
const layoutDropdownRef = ref(null);

const closeLayoutDropdown = (event) => {
  if (layoutDropdownRef.value && !layoutDropdownRef.value.contains(event.target)) {
    showLayoutDropdown.value = false;
  }
};

// Undo/Redo state
const canUndo = ref(false);
const canRedo = ref(false);

// --- Lifecycle Hooks ---
onMounted(() => {
  if (graph.value) {
    setupGraphListeners(graph.value);
    updateHistoryState();
  }
  // 외부 클릭 감지를 위한 이벤트 리스너
  document.addEventListener('click', closeLayoutDropdown);
});

onUnmounted(() => {
  document.removeEventListener('click', closeLayoutDropdown);
});

// Watch for graph instance changes
watch(graph, (newGraph) => {
  if (newGraph) {
    setupGraphListeners(newGraph);
    updateHistoryState();
  }
});

const setupGraphListeners = (g) => {
  // History events
  g.on('history:change', updateHistoryState);
  g.on('history:undo', updateHistoryState);
  g.on('history:redo', updateHistoryState);
};

const updateHistoryState = () => {
  if (graph.value) {
    const history = graph.value.getPlugin('history');
    if (history) {
      canUndo.value = history.canUndo();
      canRedo.value = history.canRedo();
    }
  }
};

// --- File Operations ---
const openFileHandler = () => {
  if (tmStore.modified) {
    const confirmOpen = confirm('Current changes have not been saved. Do you want to continue?');
    if (!confirmOpen) return;
  }
  
  // Reset input value to allow selecting the same file again
  if (fileInput.value) {
    fileInput.value.value = '';
    fileInput.value.click();
  }
};

const handleFileSelected = async (evt) => {
  const file = evt.target.files[0];
  if (!file) return;

  if (file.type === "application/json") {
    try {
      const tmData = await file.text();
      const tmJson = JSON.parse(tmData);
      
      tmStore._stashThreatModel(tmJson);
      tmStore.setFileName(file.name);
      tmStore.selectDiagram(tmStore.data.diagrams);
      
      if (graph.value && tmStore.data.diagrams) {
        graph.value.fromJSON(tmStore.data.diagrams);
      }
      
      console.log('File loaded successfully:', file.name);
    } catch (error) {
      console.error("Error parsing JSON:", error);
      alert("Failed to parse JSON file.");
    }
  } else {
    alert("Please select a valid JSON file.");
  }
};

const saveFileHandler = async () => {
  try {
    if (graph.value) {
      tmStore.modifyDiagram(graph.value.toJSON());
    }
    const success = await tmStore.save();
    if (success) console.log('File saved successfully');
  } catch (error) {
    alert('Failed to save file: ' + error.message);
  }
};

const extractModelHandler = async () => {
  try {
    const diagram = graph.value ? graph.value.toJSON() : tmStore.modifiedDiagram;
    const malModel = createMalModelFromDiagram(tmStore.data, diagram);

    if (Object.keys(malModel.assets || {}).length === 0) {
      alert('No MAL model assets to extract.');
      return;
    }

    const targetFileName = tmStore.data.modelInfo?.title || tmStore.fileName || 'AutoTARA';
    const modelFileName = `${targetFileName.replace(/\.json$/i, '')}_Model.json`;
    const success = await saveService.text(
      JSON.stringify(malModel, null, 2),
      modelFileName,
      'application/json'
    );

    if (success) console.log('MAL model extracted successfully');
  } catch (error) {
    alert('Failed to extract model: ' + error.message);
  }
};

// --- History Operations ---
const undoHandler = () => {
  graph.value?.getPlugin('history')?.undo();
};

const redoHandler = () => {
  graph.value?.getPlugin('history')?.redo();
};

// --- View Operations ---
const zoomInHandler = () => {
  graph.value?.zoom(0.1);
};

const zoomOutHandler = () => {
  graph.value?.zoom(-0.1);
};

const deleteHandler = () => {
  const cells = graph.value?.getSelectedCells();
  if (cells?.length) {
    graph.value.removeCells(cells);
  }
};

const screenshotHandler = () => {
  graph.value?.toPNG((dataUri) => {
    const link = document.createElement('a');
    link.download = `${tmStore.data.modelInfo?.title || 'diagram'}.png`;
    link.href = dataUri;
    link.click();
  }, { backgroundColor: '#ffffff', padding: 10 });
};

// --- Layout Operations ---

/**
 * 레이아웃 적용 후 엣지 라우팅 최적화
 * 엣지가 겹치지 않도록 곡선 처리
 */
const optimizeEdgeRouting = () => {
  if (!graph.value) return;
  
  const edges = graph.value.getEdges();
  const edgesByPair = new Map(); // 같은 노드 쌍의 엣지들을 그룹화
  
  // 엣지들을 노드 쌍으로 그룹화
  edges.forEach(edge => {
    const sourceId = edge.getSourceCellId();
    const targetId = edge.getTargetCellId();
    if (!sourceId || !targetId) return;
    
    const pairKey = [sourceId, targetId].sort().join('-');
    if (!edgesByPair.has(pairKey)) {
      edgesByPair.set(pairKey, []);
    }
    edgesByPair.get(pairKey).push(edge);
  });
  
  // 같은 노드 쌍에 여러 엣지가 있으면 오프셋 적용
  edgesByPair.forEach((pairEdges, pairKey) => {
    if (pairEdges.length > 1) {
      pairEdges.forEach((edge, index) => {
        const offset = (index - (pairEdges.length - 1) / 2) * 30;
        edge.setConnector('smooth', {});
        // 라벨 위치 조정
        edge.setLabels([{
          attrs: { label: edge.getLabels()[0]?.attrs?.label || {} },
          position: { distance: 0.5, offset: offset }
        }]);
      });
    } else {
      // 단일 엣지는 rounded 커넥터 사용
      pairEdges[0].setConnector('rounded', { radius: 20 });
    }
  });
};

/**
 * Hierarchical Layout: 계층적 트리 구조로 정렬 (BFS 기반)
 */
const applyHierarchicalLayout = () => {
  if (!graph.value) return;

  const nodes = graph.value.getNodes();
  const edges = graph.value.getEdges();
  if (nodes.length === 0) return;

  // 인접 리스트 생성
  const adjacency = new Map();
  const inDegree = new Map();
  
  nodes.forEach(node => {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  });

  edges.forEach(edge => {
    const sourceId = edge.getSourceCellId();
    const targetId = edge.getTargetCellId();
    if (sourceId && targetId && adjacency.has(sourceId)) {
      adjacency.get(sourceId).push(targetId);
      inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
    }
  });

  // 루트 노드 찾기 (들어오는 엣지가 없는 노드)
  const roots = nodes.filter(node => inDegree.get(node.id) === 0);
  if (roots.length === 0) {
    roots.push(nodes[0]);
  }

  // BFS로 레벨 할당
  const levels = new Map();
  const visited = new Set();
  const queue = roots.map(r => ({ node: r, level: 0 }));
  
  while (queue.length > 0) {
    const { node, level } = queue.shift();
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level).push(node);

    const children = adjacency.get(node.id) || [];
    children.forEach(childId => {
      const childNode = graph.value.getCellById(childId);
      if (childNode && !visited.has(childId)) {
        queue.push({ node: childNode, level: level + 1 });
      }
    });
  }

  // 방문하지 않은 노드 처리
  nodes.forEach(node => {
    if (!visited.has(node.id)) {
      const maxLevel = Math.max(...levels.keys(), 0);
      if (!levels.has(maxLevel + 1)) levels.set(maxLevel + 1, []);
      levels.get(maxLevel + 1).push(node);
    }
  });

  // 위치 계산 (왼쪽에서 오른쪽으로 배치)
  const levelWidth = 250;  // 레벨 간 가로 간격
  const nodeHeight = 150;  // 노드 간 세로 간격
  const startX = 80;       // 시작 X 위치

  levels.forEach((levelNodes, level) => {
    const totalHeight = levelNodes.length * nodeHeight;
    const startY = Math.max(100, (600 - totalHeight) / 2);  // 세로 중앙 정렬
    
    levelNodes.forEach((node, index) => {
      node.position(startX + level * levelWidth, startY + index * nodeHeight);
    });
  });

  optimizeEdgeRouting();
  fitContentHandler();
};

/**
 * Fit to Content: 모든 요소가 보이도록 뷰포트 조정
 */
const fitContentHandler = () => {
  if (!graph.value) return;
  
  graph.value.zoomToFit({ 
    padding: 100,
    maxScale: 1.0
  });
  graph.value.centerContent();
};
</script>

<style scoped>
/* Bootstrap 기본 btn-light보다 깔끔한 흰색 버튼 스타일 */
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
</style>

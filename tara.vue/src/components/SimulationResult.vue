<template>
  <div class="card shadow-sm">
    <div class="card-header bg-white fw-bold d-flex justify-content-between align-items-center border-bottom-0 py-3">
      <span><i class="fa-solid fa-chart-line me-2"></i>Simulation Result</span>
      <div>
        <button 
          class="btn btn-sm btn-white border" 
          @click="clearResult" 
          :disabled="!hasResult"
          title="Clear Result"
        >
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>

    <div class="card-body">
      <div v-if="!hasResult" class="h-100 d-flex flex-column align-items-center justify-content-center text-muted opacity-75">
        <!-- <i class="fa-solid fa-flask fa-2x mb-3 opacity-50"></i> -->
        <p class="small text-center mb-0">
          Run a simulation to see<br/>the attack path analysis results.
        </p>
      </div>

      <div v-else>
        <!-- 결과 요약 -->
        <div class="result-summary mb-3">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="text-muted small">Analysis Type</span>
            <span class="badge" :class="analysisTypeBadge">
              <i class="fa-solid me-1" :class="analysisTypeIcon"></i>
              {{ analysisTypeLabel }}
            </span>
          </div>
          
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="text-muted small">Total Cost</span>
            <span class="fw-bold text-primary">{{ formattedCost }}</span>
          </div>
          
          <div class="d-flex justify-content-between align-items-center">
            <span class="text-muted small">Paths Found</span>
            <span class="badge bg-secondary rounded-pill">{{ pathCount }}</span>
          </div>
        </div>

        <hr class="text-muted my-3 opacity-25">

        <!-- 경로 목록 -->
        <div class="path-list">
          <label class="form-label small fw-bold text-uppercase text-muted mb-2">
            Attack Paths
          </label>
          
          <div class="list-group list-group-flush overflow-auto small" style="max-height: 300px;">
            <div
              v-for="(path, index) in displayedPaths"
              :key="index"
              class="list-group-item list-group-item-action py-2 px-2"
              :class="{ 'active-path': selectedPathIndex === index }"
              @click="selectPath(index)"
            >
              <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="fw-bold">Path {{ index + 1 }}</span>
                <span class="badge bg-light text-dark border">
                  {{ path.nodes.length }} steps
                </span>
              </div>
              
              <div class="path-nodes d-flex flex-wrap gap-1 mt-1">
                <template v-for="(node, nodeIndex) in path.nodes" :key="nodeIndex">
                  <span class="node-chip" :class="getNodeChipClass(node, nodeIndex, path.nodes.length)">
                    {{ getNodeLabel(node) }}
                  </span>
                  <i v-if="nodeIndex < path.nodes.length - 1" class="fa-solid fa-arrow-right text-muted align-self-center" style="font-size: 0.6rem;"></i>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- 선택된 경로 상세 정보 -->
        <div v-if="selectedPathIndex !== null" class="mt-3">
          <hr class="text-muted my-3 opacity-25">
          <label class="form-label small fw-bold text-uppercase text-muted mb-2">
            Path {{ selectedPathIndex + 1 }} Details
          </label>
          
          <div class="selected-path-details bg-light p-2 rounded border">
            <div v-for="(node, nodeIndex) in selectedPath.nodes" :key="nodeIndex" class="path-step mb-2">
              <div class="d-flex align-items-start">
                <div class="step-indicator me-2">
                  <span 
                    class="badge rounded-circle" 
                    :class="getStepBadgeClass(node, nodeIndex, selectedPath.nodes.length)"
                  >
                    {{ nodeIndex + 1 }}
                  </span>
                </div>
                <div class="step-content flex-grow-1">
                  <div class="fw-bold small">{{ getNodeLabel(node) }}</div>
                  <div class="text-muted" style="font-size: 0.7rem;">
                    {{ getNodeDescription(node) || 'No description' }}
                  </div>
                  <div v-if="getNodeTTC(node)" class="mt-1">
                    <span class="badge bg-warning text-dark" style="font-size: 0.65rem;">
                      <i class="fa-solid fa-stopwatch me-1"></i>TTC: {{ getNodeTTC(node) }} hrs
                    </span>
                  </div>
                </div>
              </div>
              <div v-if="nodeIndex < selectedPath.nodes.length - 1" class="step-connector">
                <i class="fa-solid fa-arrow-down text-muted"></i>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, inject, watch, toRaw } from 'vue';
import { storeToRefs } from 'pinia';
import { useThreatModelStore } from '@/stores/threatModelStore.js';
import dataChanged from '@/service/x6/graph/data-changed.js';

const tmStore = useThreatModelStore();
const { simulationResult, malsimResult, entryNode, targetNode } = storeToRefs(tmStore);
const graph = inject('graph');

const selectedPathIndex = ref(null);

const activeResultType = computed(() => {
    if (malsimResult.value) return 'malsim';
    if (simulationResult.value) return 'default';
    return null;
});

const hasResult = computed(() => !!activeResultType.value);

const displayedPaths = computed(() => {
    if (activeResultType.value === 'malsim') {
        const paths = [];
        const attackPaths = malsimResult.value.attackPaths || {};
        
        Object.values(attackPaths).forEach(agentPaths => {
            Object.values(agentPaths).forEach(goalPaths => {
                const pathList = (goalPaths.length > 0 && Array.isArray(goalPaths[0])) ? goalPaths : [goalPaths];
                
                pathList.forEach(rawPath => {
                    // 자산 이름 추출 (중복 제거하지 않고 모든 단계 표시하되, 표시는 자산명:공격단계)
                    const nodes = rawPath.map(step => {
                        if (!step || !step.full_name) {
                            return {
                                isMalsimStep: true,
                                name: 'Unknown',
                                assetName: 'Unknown',
                                stepName: 'Unknown',
                                type: step?.type || 'Unknown'
                            };
                        }
                        return {
                            // 식별을 위해 step 객체 통째로 사용 또는 포맷팅
                            isMalsimStep: true,
                            name: step.full_name, // "Asset:step"
                            assetName: step.full_name.split(':')[0],
                            stepName: step.full_name.split(':')[1],
                            type: step.type,
                            ttc: step.ttc
                        };
                    });
                    paths.push({ nodes, cost: rawPath.length });
                });
            });
        });
        return paths;
    } else if (activeResultType.value === 'default') {
        return simulationResult.value.paths.map(p => ({
            nodes: p.nodes, // ID 리스트
            cost: p.totalCost
        }));
    }
    return [];
});

const pathCount = computed(() => displayedPaths.value.length);

const analysisTypeLabel = computed(() => {
    if (activeResultType.value === 'malsim') return 'MAL Simulation';
    if (simulationResult.value?.weightType === 'ttc') return 'Time To Compromise';
    return 'Edge Path';
});

const analysisTypeBadge = computed(() => {
    if (activeResultType.value === 'malsim') return 'bg-success';
    if (simulationResult.value?.weightType === 'ttc') return 'bg-info text-dark';
    return 'bg-primary';
});

const analysisTypeIcon = computed(() => {
    if (activeResultType.value === 'malsim') return 'fa-bug';
    if (simulationResult.value?.weightType === 'ttc') return 'fa-clock';
    return 'fa-share-nodes';
});

const formattedCost = computed(() => {
    if (!hasResult.value) return '';
    if (activeResultType.value === 'malsim') {
        // malsim은 단계(Steps) 수로 표시
        // 선택된 경로가 있으면 그 경로의 스텝 수, 아니면 첫 번째 경로
        const path = selectedPath.value || displayedPaths.value[0];
        return path ? `${path.cost} steps` : '';
    }
    const cost = simulationResult.value.totalCost;
    const type = simulationResult.value.weightType;
    return type === 'ttc' ? `${cost.toFixed(1)} hrs` : `${cost} hops`;
});

const selectedPath = computed(() => {
    if (selectedPathIndex.value === null || !hasResult.value) return null;
    return displayedPaths.value[selectedPathIndex.value];
});

const selectPath = (index) => {
    selectedPathIndex.value = selectedPathIndex.value === index ? null : index;
};

// 노드 라벨 가져오기 (ID 또는 malsim step 객체)
const getNodeLabel = (node) => {
    if (node && node.isMalsimStep) {
        return node.name; // "Asset:step"
    }

    const nodeId = node; // default simulation은 nodeId가 넘어옴
    if (!graph || !graph.value) return nodeId.substring(0, 8) + '...';
  
    const cell = graph.value.getCellById ? graph.value.getCellById(nodeId) : graph.value.getCell(nodeId);
    if (!cell) return nodeId.substring(0, 8) + '...';
  
    const data = cell.getData() || {};
    return data.name || nodeId.substring(0, 8) + '...';
};

const getNodeDescription = (node) => {
    if (node && node.isMalsimStep) {
        return `Type: ${node.type}`;
    }

    const nodeId = node;
    if (!graph || !graph.value) return '';
  
    const cell = graph.value.getCellById ? graph.value.getCellById(nodeId) : graph.value.getCell(nodeId);
    if (!cell) return '';
  
    const data = cell.getData() || {};
    const desc = data.description || '';
    return desc.length > 50 ? desc.substring(0, 50) + '...' : desc;
};

const getNodeTTC = (node) => {
    if (node && node.isMalsimStep) {
        return node.ttc ? parseFloat(node.ttc).toFixed(1) : null;
    }

    const nodeId = node;
    // ... (기존 로직)
    if (!graph || !graph.value) return null;
    const cell = graph.value.getCellById ? graph.value.getCellById(nodeId) : graph.value.getCell(nodeId);
    if (!cell) return null;
    const data = cell.getData() || {};
    if (!data.threats || !Array.isArray(data.threats)) return null;
    const openThreats = data.threats.filter(t => t.status && t.status.toLowerCase() === 'open');
    if (openThreats.length === 0) return null;
    const ttcs = openThreats.map(t => parseFloat(t.ttc) || 0);
    return Math.min(...ttcs).toFixed(1);
};

const getNodeChipClass = (node, index, totalLength) => {
  if (node && node.isMalsimStep) {
    // For MAL simulation, the first step is entry, last is target
    if (index === 0) return 'node-chip-entry';
    if (index === totalLength - 1) return 'node-chip-target';
    return 'node-chip-default';
  }
  // For default simulation, use entryNode/targetNode IDs
  const nodeId = node;
  if (nodeId === entryNode.value) return 'node-chip-entry';
  if (nodeId === targetNode.value) return 'node-chip-target';
  return 'node-chip-default';
};

const getStepBadgeClass = (node, index, totalLength) => {
  if (index === 0) return 'bg-success'; // Entry
  if (index === totalLength - 1) return 'bg-danger'; // Target
  return 'bg-secondary';
};

const clearResult = () => {
    tmStore.simulationResult = null;
    tmStore.malsimResult = null; // malsim 결과도 초기화
    selectedPathIndex.value = null;

    // 그래프 시각화 초기화
    let model = null;
    if (graph && graph.value) {
        model = toRaw(graph.value);
    }
    
    if (model) {
        const cells = model.getCells();
        cells.forEach(cell => {
            const data = cell.getData() || {};
            // isAttackPath 플래그가 있는 모든 셀 초기화 (노드 및 엣지)
            if (data.isAttackPath) {
                cell.setData({ isAttackPath: false }, { merge: true, skipSelection: true });
                dataChanged.updateStyleAttrs(cell);
            }
        });
    }
};
</script>

<style scoped>
.result-summary {
  background-color: #f8f9fa;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.path-list .list-group-item {
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 6px !important;
  margin-bottom: 4px;
  border: 1px solid #e9ecef;
}

.path-list .list-group-item:hover {
  background-color: #f8f9fa;
  border-color: #0d6efd;
}

.path-list .list-group-item.active-path {
  background-color: #e7f1ff;
  border-color: #0d6efd;
}

.node-chip {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 500;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-chip-default {
  background-color: #e9ecef;
  color: #495057;
}

.node-chip-entry {
  background-color: #d1e7dd;
  color: #0f5132;
}

.node-chip-target {
  background-color: #f8d7da;
  color: #842029;
}

.step-indicator .badge {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
}

.step-connector {
  display: flex;
  justify-content: center;
  padding: 4px 0;
  margin-left: 8px;
}

.selected-path-details {
  max-height: 250px;
  overflow-y: auto;
}

/* 스크롤바 스타일 */
.list-group::-webkit-scrollbar,
.selected-path-details::-webkit-scrollbar {
  width: 4px;
}

.list-group::-webkit-scrollbar-thumb,
.selected-path-details::-webkit-scrollbar-thumb {
  background-color: #dee2e6;
  border-radius: 4px;
}

.btn-white {
  background-color: #ffffff;
  color: #495057;
  border-color: #dee2e6;
}

.btn-white:hover {
  background-color: #f8f9fa;
  border-color: #c6c7ca;
}

.btn-white:disabled {
  opacity: 0.5;
}
</style>

<template>
  <div v-if="visible" class="modal-backdrop fade show"></div>
  <div
    class="modal fade"
    :class="{ 'show d-block': visible }"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    @click.self="handleClose"
  >
    <div class="modal-dialog modal-xl modal-dialog-scrollable" role="document">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">
            <i class="fa-solid fa-shield-halved text-danger me-2"></i>
            Attack Simulation Report
          </h5>
          <button type="button" class="btn-close" aria-label="Close" @click="handleClose"></button>
        </div>

        <div class="modal-body small">
          <div v-if="!simulationResult" class="text-center py-5">
            <p class="text-muted">No simulation results available.</p>
          </div>

          <div v-else>
            <!-- Summary Section -->
            <div class="alert alert-light border shadow-sm mb-4">
              <div class="row align-items-center">
                <div class="col-md-3 border-end">
                  <div class="small text-muted fw-bold mb-1">SIMULATION TYPE</div>
                  <div class="mb-0 text-primary">
                    {{ simulationResult.weightType === 'ttc' ? 'Time To Compromise (TTC)' : 'Edge Path Analysis' }}
                  </div>
                </div>
                <div class="col-md-3 border-end">
                  <div class="small text-muted fw-bold mb-1">TOTAL COST</div>
                  <div class="mb-0 text-dark">
                    {{ simulationResult.weightType === 'ttc' ? simulationResult.totalCost.toFixed(1) + ' hrs' : simulationResult.totalCost + ' hops' }}
                  </div>
                </div>
                <div class="col-md-3">
                  <div class="small text-muted fw-bold mb-1">PATHS FOUND</div>
                  <div class="mb-0 text-dark">{{ simulationResult.paths.length }}</div>
                </div>
              </div>
            </div>

            <!-- Pre-calculate enriched paths -->
            <div v-for="(path, pathIndex) in enrichedPaths" :key="pathIndex" class="card shadow-sm mb-4">
              <div class="card-header bg-white fw-bold d-flex justify-content-between align-items-center">
                <span>
                  <i class="fa-solid fa-route text-muted me-2"></i>
                  Attack Path #{{ pathIndex + 1 }}
                </span>
                <span class="badge bg-secondary text-white small">
                  {{ path.hops }} Nodes
                </span>
              </div>
              <div class="card-body p-0">
                <div class="table-responsive">
                  <table class="table table-hover mb-0 align-middle">
                    <thead class="table-light text-uppercase small text-muted">
                      <tr>
                        <th class="ps-3" style="width: 100px;">Step</th>
                        <th class="ps-3" style="width: 100px;">Node Name</th>
                        <th style="width: 120px;">Type</th>
                        <th style="width: 600px">Vulnerability Used (Open Threat)</th>
                        <th class="text-end pe-3" v-if="simulationResult.weightType === 'ttc'" style="width: 100px;">TTC Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      <template v-for="(step, stepIndex) in path.steps" :key="stepIndex">
                        <!-- Node Row -->
                        <tr :class="{'table-warning': step.isTarget, 'table-success': step.isEntry}">
                          <td class="ps-3 fw-bold text-muted">{{ stepIndex + 1 }}</td>
                          <td>
                            <span class="fw-bold">{{ step.nodeName }}</span>
                            <span v-if="step.isEntry" class="badge bg-success ms-2">Entry</span>
                            <span v-if="step.isTarget" class="badge bg-danger ms-2">Target</span>
                          </td>
                          <td>
                            <span class="badge bg-light text-dark border">{{ step.nodeType }}</span>
                          </td>
                          <td>
                            <div v-if="step.threats.length > 0">
                              <div v-for="threat in step.threats" :key="threat.id" class="d-flex align-items-center mb-1">
                                <i class="fa-solid fa-bug text-danger me-2 small"></i>
                                <span class="d-inline-block" style="max-width: 500px;" :title="threat.description || threat.technique">
                                  {{ threat.technique || 'Unknown Threat' }}
                                </span>
                                <span class="badge bg-danger bg-opacity-10 text-danger ms-2 small" v-if="simulationResult.weightType === 'ttc'">
                                  {{ threat.ttc }}h
                                </span>
                              </div>
                            </div>
                            <div v-else class="text-muted small fst-italic">
                              (Transit / No Exploit Metadata)
                            </div>
                          </td>
                          <td class="text-end pe-3 text-muted fw-bold" v-if="simulationResult.weightType === 'ttc'">
                            <span v-if="step.minTTC !== Infinity">{{ step.minTTC }}</span>
                            <span v-else>-</span>
                          </td>
                        </tr>
                        <!-- Arrow Row (Visual Connector except for last item) -->
                        <tr v-if="stepIndex < path.steps.length - 1" class="border-0">
                            <td colspan="5" class="text-center py-1 border-0 text-muted">
                                <i class="fa-solid fa-arrow-down"></i>
                            </td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

          </div>
        </div>

        <div class="modal-footer bg-light">
          <button type="button" class="btn btn-secondary" @click="handleClose">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, unref, toRaw } from 'vue';
import { useThreatModelStore } from '@/stores/threatModelStore.js';
import { storeToRefs } from 'pinia';

const props = defineProps({
  visible: Boolean,
  graph: Object // Reference to X6 graph to lookup node details
});

const emit = defineEmits(['close']);

const tmStore = useThreatModelStore();
const { simulationResult } = storeToRefs(tmStore);

const handleClose = () => {
    emit('close');
};

/**
 * Enriches the raw node IDs from the simulation result with actual node data (Labels, Threats, Types)
 * This computed property rebuilds the data structure for easy rendering in the template.
 */
const enrichedPaths = computed(() => {
    // Resolve Graph Instance: Unref (if ref) and toRaw (remove proxy)
    const graphInstance = toRaw(unref(props.graph));

    console.log("EnrichedPaths Triggered. Graph:", graphInstance);
    console.log("Simulation Result:", simulationResult.value);

    if (!simulationResult.value || !graphInstance) {
        console.warn("Missing data for report generation.");
        return [];
    }

    return simulationResult.value.paths.map(path => {
        const steps = path.nodes.map(nodeId => {
            // Use safe lookup logic
            let cell = null;
             if (typeof graphInstance.getCell === 'function') {
                cell = graphInstance.getCell(nodeId);
            } else if (typeof graphInstance.getCellById === 'function') {
                cell = graphInstance.getCellById(nodeId);
            } 
            
            // Console log to debug data missing issue
            if (!cell) {
                 console.warn(`Report: Cell not found for ${nodeId} in graph instance`, graphInstance);
                 return { nodeName: 'Unknown (Not Found)', isEntry: false, isTarget: false, threats: [] };
            }

            const data = cell.getData() || {};
            // Filter Open Threats
            const openThreats = (data.threats || []).filter(t => t.status && t.status.toLowerCase() === 'open');
            
            // Find min TTC used for cost calculation if in TTC mode
            const ttcs = openThreats.map(t => parseFloat(t.ttc) || 0);
            const minTTC = ttcs.length > 0 ? Math.min(...ttcs) : Infinity;

            // Determine Type Label
            let typeLabel = 'Unknown';
            if (data.type) {
                typeLabel = data.type.replace('tm.', '');
            } else if (cell.isNode && cell.isNode()) {
                typeLabel = 'Node';
            } else if (cell.isEdge && cell.isEdge()) {
                typeLabel = 'Flow';
            }

            return {
                id: nodeId,
                nodeName: data.name || data.label || 'Unnamed Element',
                nodeType: typeLabel,
                isEntry: nodeId === tmStore.entryNode,
                isTarget: nodeId === tmStore.targetNode,
                threats: openThreats,
                minTTC: minTTC
            };
        });

        return {
            steps: steps,
            hops: steps.length
        };
    });
});

</script>

<style scoped>
.modal-dialog.modal-xl {
    max-width: 1000px;
}
.table-warning {
    --bs-table-bg: #fff3cd;
}
.table-success {
    --bs-table-bg: #d1e7dd;
}
</style>

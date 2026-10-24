<script setup>
import { inject } from 'vue'
import { DRAWIO_EDITOR_KEY } from '@/services/drawio/palette.js'

const {
  perform,
  ctsaAvailable,
  ctsaHint,
  crraAvailable,
  crraHint,
  endpointsAvailable,
  endpointHint,
  selectedEndpoints,
  pathsHint,
  pathSearching,
  pathAnalysis,
  attackerType,
  simulationAvailable,
  simulationHint,
  simulationRunning,
  simulationResult,
} = inject(DRAWIO_EDITOR_KEY)
</script>

<template>
  <div>
    <div class="d-flex flex-wrap align-items-center gap-2" aria-label="Simulation actions">
      <div class="btn-group shadow-sm" role="group" aria-label="Attack path endpoints">
        <button
          v-for="endpoint in [
            { kind: 'entry', label: 'Entry', icon: 'fa-arrow-right-to-bracket' },
            { kind: 'target', label: 'Target', icon: 'fa-flag' },
          ]"
          :key="endpoint.kind"
          type="button"
          class="btn btn-sm btn-white border fw-bold text-dark"
          :disabled="!endpointsAvailable"
          :title="endpointHint"
          :aria-label="endpoint.label"
          @click="perform(endpoint.kind)"
        >
          <i
            class="fa-solid me-1"
            :class="[endpoint.icon, endpointsAvailable ? 'text-primary' : 'text-muted']"
            aria-hidden="true"
          ></i>
          {{ endpoint.label }}
          <span v-if="selectedEndpoints[endpoint.kind]?.length" class="badge text-bg-primary ms-1">
            {{ selectedEndpoints[endpoint.kind].length }}
          </span>
        </button>
      </div>
      <label for="simulation-attacker-type" class="small fw-bold">Attacker</label>
      <select
        id="simulation-attacker-type"
        v-model="attackerType"
        class="form-select form-select-sm w-auto"
        :disabled="simulationRunning"
      >
        <option value="BreadthFirstAttacker">BFS (BreadthFirstAttacker)</option>
        <option value="DepthFirstAttacker">DFS (DepthFirstAttacker)</option>
      </select>
      <button
        type="button"
        class="btn btn-sm btn-success fw-bold"
        :disabled="!simulationAvailable"
        :title="simulationHint"
        @click="perform('simulate')"
      >
        <i
          class="fa-solid me-1"
          :class="simulationRunning ? 'fa-spinner fa-spin' : 'fa-play'"
          aria-hidden="true"
        ></i>
        {{ simulationRunning ? 'Simulating…' : 'Simulate' }}
      </button>
      <button
        type="button"
        class="btn btn-sm btn-primary fw-bold"
        disabled
        :title="pathsHint"
        @click="perform('findPaths')"
      >
        <i class="fa-solid fa-route me-1" aria-hidden="true"></i> Find Paths
      </button>
      <!-- Todo: 임시 비활성화 -->
      <!-- <details class="path-limits small">
        <summary>Search limits</summary>
        <div class="limits-menu border rounded shadow-sm p-2 bg-white">
          <label class="d-block mb-2"
            >Candidates per Target
            <input
              v-model.number="pathOptions.maxPaths"
              type="number"
              class="form-control form-control-sm"
              min="1"
              max="100"
              :disabled="pathSearching"
            />
          </label>
          <label class="d-block"
            >Maximum main-route hops
            <input
              v-model.number="pathOptions.maxHops"
              type="number"
              class="form-control form-control-sm"
              min="0"
              max="200"
              :disabled="pathSearching"
            />
          </label>
        </div>
      </details> -->
      <div class="vr text-muted mx-1" aria-hidden="true"></div>
      <button
        type="button"
        class="btn btn-sm btn-white border"
        title="Reset Paths"
        aria-label="Reset Paths"
        :disabled="!pathAnalysis && !pathSearching && !simulationResult && !simulationRunning"
        @click="perform('resetPaths')"
      >
        <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
      </button>
      <div class="vr text-muted mx-1" aria-hidden="true"></div>
      <div class="btn-group shadow-sm" role="group" aria-label="TARA assessment">
        <button
          type="button"
          class="btn btn-sm btn-white border fw-bold text-dark"
          :disabled="!ctsaAvailable"
          :title="ctsaHint"
          aria-label="CTSA"
          @click="perform('ctsa')"
        >
          <i
            class="fa-solid fa-list-check me-1"
            :class="ctsaAvailable ? 'text-primary' : 'text-muted'"
            aria-hidden="true"
          ></i>
          CTSA
        </button>
        <button
          type="button"
          class="btn btn-sm btn-white border fw-bold text-dark"
          :disabled="!crraAvailable"
          :title="crraHint"
          aria-label="CRRA"
          @click="perform('crra')"
        >
          <i
            class="fa-solid fa-shield-halved me-1"
            :class="crraAvailable ? 'text-primary' : 'text-muted'"
            aria-hidden="true"
          ></i>
          CRRA
        </button>
      </div>
    </div>
    <!-- <p class="mt-2 mb-0 small text-muted">
      Add diagram elements to analyze threats and attack paths.
    </p> -->
  </div>
</template>

<style scoped>
.path-limits {
  position: relative;
}
.limits-menu {
  position: absolute;
  top: 100%;
  left: 0;
  width: 185px;
  z-index: 20;
}
.btn-white {
  background-color: #fff;
  color: #495057;
  border-color: #dee2e6;
}

.btn-white:hover {
  background-color: #f8f9fa;
  border-color: #c6c7ca;
}

.vr {
  align-self: center;
  height: 24px;
  width: 1px;
  background-color: #ccc;
  opacity: 1;
}
</style>

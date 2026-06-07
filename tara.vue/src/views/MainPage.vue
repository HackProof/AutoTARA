<template>
  <div class="px-4 my-5 text-center border-bottom">
    <img class="d-block mx-auto" src="../assets/auto-tara-logo-2.png" alt="" width="256">
    <h1 class="display-4 fw-bold text-body-emphasis">
      AutoTARA
    </h1>
    <h2 class="display-6 fw-bold text-body-emphasis">
      Automated Threat Analysis and Risk Assessment Simulator
    </h2>
    <div class="col-lg-6 mx-auto">
      <p class="lead mb-4">
        <b>AutoTARA</b> revolutionizes threat modeling by automating the end-to-end TARA framework.
        Built on a customizable, <b>MITRE ATT&CK-powered catalog</b>, it moves beyond static analysis to identify
        vulnerabilities in Automotive environments. Visualize complex attack simulations,
        automatically prioritize threats, and calculate optimal remediation strategies to find the
        fastest path to compromise before attackers do.
      </p>
      <div class="d-grid gap-2 d-sm-flex justify-content-sm-center mb-5">
        <!-- <ThreatModelParser /> -->
        <MalModelParser />
        <button class="btn btn-outline-secondary btn-lg px-4" @click="openCreateDiagramModal">
          <i class="fa-solid fa-plus"></i>
          New Diagram
        </button>
        <!-- <router-link to="/dashboard" class="btn btn-outline-primary btn-lg px-4">
          <i class="fa-solid fa-chart-line"></i>
          Dashboard
        </router-link> -->
      </div>
    </div>
    <div class="overflow-hidden" style="max-height: 45vh">
      <div class="container px-5">
        <img
            src="../assets/diagram-sample.png"
            class="img-fluid border rounded-3 shadow-lg mb-4"
            alt="Example image"
            width="1200"
            loading="lazy"
        />
      </div>
    </div>
  </div>
  <div>
    <CreateDiagramModal ref="createModal" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import CreateDiagramModal from '@/components/CreateDiagramModal.vue'
import ThreatModelParser from '@/components/ThreatModelParser.vue'
import MalModelParser from '@/components/MalModelParser.vue'

const createModal = ref(null)

const openCreateDiagramModal = () => {
  if (createModal.value) {
    createModal.value.openModal()
  }
}
</script>
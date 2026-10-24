<script setup>
import { ref } from 'vue'
import CreateDiagramModal from '@/components/CreateDiagramModal.vue'
import logoUrl from '@/assets/auto-tara-logo.png'
import diagramSampleUrl from '@/assets/diagram-sample.png'

const createModal = ref(null)
</script>

<template>
  <section class="main-page px-3 px-sm-4 pt-4 pt-sm-5 text-center border-bottom">
    <div class="container">
      <img class="main-page-logo d-block mx-auto" :src="logoUrl" alt="AutoTARA logo" />
      <h1 class="display-4 fw-bold text-body-emphasis">AutoTARA</h1>
      <h2 class="display-6 fw-bold text-body-emphasis">
        Automated Threat Analysis and Risk Assessment
      </h2>

      <div class="col-lg-8 col-xl-6 mx-auto">
        <p class="lead mt-4 mb-4">
          Model automotive systems, identify threats, and assess cybersecurity risks with AutoTARA.
          Create asset and data-flow diagrams, evaluate attack steps, and compare countermeasures to
          prioritize security improvements.
        </p>

        <div
          class="d-grid gap-2 d-sm-flex flex-sm-wrap justify-content-sm-center mb-5"
          role="group"
          aria-label="Diagram actions"
        >
          <button v-if="false" type="button" class="btn btn-success btn-lg px-4" disabled>
            Open Diagram Model
          </button>
          <button
            type="button"
            class="btn btn-outline-secondary btn-lg px-4"
            @click="createModal?.openModal()"
          >
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
            New Diagram
          </button>
        </div>
        <p v-if="false" id="diagram-actions-status" class="small text-body-secondary mt-3 mb-5">
          Diagram model open is coming soon.
        </p>
      </div>

      <div class="diagram-preview overflow-hidden mx-auto">
        <img
          :src="diagramSampleUrl"
          class="img-fluid border rounded-3 shadow-lg"
          alt="Example AutoTARA automotive threat model with connected assets and data flows"
          width="1200"
          loading="lazy"
        />
      </div>
    </div>
  </section>
  <CreateDiagramModal ref="createModal" />
</template>

<style scoped>
.main-page-logo {
  width: 256px;
  max-width: 60vw;
  height: auto;
}

.diagram-preview {
  max-width: 1200px;
  max-height: 45vh;
}
</style>

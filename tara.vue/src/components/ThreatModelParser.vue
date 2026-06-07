<template>
  <div>
    <button class="btn btn-primary btn-lg px-4" @click="openFileDialog">
      <i class="fa-solid fa-arrow-up-from-bracket"></i>
      Open Diagram
    </button>
    <input
        type="file"
        ref="fileInput"
        class="d-none"
        id="inputGroupFile01"
        @change="handleFileSelected"
        accept=".json"
    >
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router';
import { useThreatModelStore } from '@/stores/threatModelStore.js';

const router = useRouter();
const tmStore = useThreatModelStore();

const fileInput = ref(null)
const tmData = ref(null)
const tmJson = ref(null)

const openFileDialog = () => {
  fileInput.value.click()
}

const handleFileSelected = async (evt) => {
  const file = evt.target.files[0]

  // Check Json file type
  if (file && file.type === "application/json") {
    tmData.value = await file.text()
    tmStore.setFileName(file.name)
    parseJson(tmData.value)
  } else {
    alert("Please select a valid JSON file.")
  }
}

const parseJson = (tmData) => {
  try {
    tmJson.value = JSON.parse(tmData)
    tmStore._stashThreatModel(tmJson.value)
    tmStore.selectDiagram(tmStore.data.diagrams)  // 원본 다이어그램을 수정할 다이어그램으로 복사

    let tmTitle = tmJson.value.modelInfo.title
    router.push({name: 'EditDiagram', params: {title: tmTitle}})
  } catch (error) {
    console.error("Error parsing JSON:", error)
    alert("Failed to parse JSON file. Please ensure it is a valid threat model.")
  }
}

</script>

<style scoped>

</style>
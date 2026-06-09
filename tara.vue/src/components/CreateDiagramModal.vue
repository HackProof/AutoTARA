<template>
  <div>
    <div
        class="modal fade"
        id="createDiagramModal"
        ref="createDiagramModal"
        tabindex="-1"
        role="dialog"
        aria-labelledby="createDiagramModalLabel"
        aria-hidden="true"
    >
      <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content shadow">
          <div class="modal-header">
            <h5 class="modal-title fw-bold fs-4" id="createDiagramModalLabel">
              New Diagram
            </h5>
            <button
                type="button"
                class="btn-close"
                aria-label="Close"
                data-bs-dismiss="modal"
            ></button>
          </div>

          <div class="modal-body">
            <form @submit.prevent="createDiagram">
              <div class="mb-3">
                <label for="title" class="form-label fw-bold fs-5">Title</label>
                <input
                    type="text"
                    v-model="form.title"
                    class="form-control"
                    id="title"
                    placeholder="New Diagram"
                    required
                />
              </div>

              <div class="mb-3">
                <label for="languageGraphFile" class="form-label fw-bold fs-5">
                  MAL LangGraph <span class="text-muted fw-normal">(Optional)</span>
                </label>
                <input
                    ref="languageGraphInput"
                    type="file"
                    class="form-control"
                    id="languageGraphFile"
                    accept=".json,application/json"
                    @change="handleLanguageGraphSelected"
                />
                <div v-if="languageGraphFile" class="form-text">
                  {{ languageGraphFile.name }} - {{ languageGraphAssetCount }} assets
                </div>
                <div v-else class="form-text">
                  Without a MAL LangGraph, only TTC and Shortest Path simulation are available. MAL Simulator is disabled.
                </div>
              </div>

              <div class="mb-3">
                <label for="version" class="form-label fw-bold fs-5">Version</label>
                <input
                    type="text"
                    v-model="form.version"
                    class="form-control"
                    id="version"
                    placeholder="1.0.0"
                />
              </div>

              <div class="mb-3">
                <label for="description" class="form-label fw-bold fs-5">Description</label>
                <textarea
                    v-model="form.description"
                    class="form-control"
                    id="description"
                    rows="4"
                    placeholder="Describe the threat model"
                ></textarea>
              </div>

              <div v-if="errorMessage" class="alert alert-danger">
                {{ errorMessage }}
              </div>

              <div class="text-end">
                <button type="button" class="btn btn-secondary me-2" @click="closeModal">
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary" :disabled="!canCreate">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>

    <AssetTypeConfigModal
      :visible="showAssetConfigModal"
      :assets="assetTypeConfigAssets"
      @confirm="handleAssetTypeConfigConfirm"
      @cancel="handleAssetTypeConfigCancel"
    />
  </div>
</template>

<script setup>
import { computed, ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useThreatModelStore } from '@/stores/threatModelStore.js'
import {
  createEmptyThreatModelFromLanguageGraph,
  normalizeLanguageGraph
} from '@/service/langGraph/languageGraph.js'
import { Modal } from 'bootstrap'
import AssetTypeConfigModal from './AssetTypeConfigModal.vue'

const tmStore = useThreatModelStore()
const router = useRouter()
const createDiagramModal = ref(null)
const languageGraphInput = ref(null)
const languageGraphFile = ref(null)
const parsedLanguageGraph = ref(null)
const languageGraphSourceText = ref('')
const errorMessage = ref('')
const showAssetConfigModal = ref(false)
const assetTypeConfigAssets = ref([])
let modalInstance = null

const form = reactive({
  title: 'New Diagram',
  version: '',
  description: ''
})

const languageGraphAssetCount = computed(() => {
  if (!parsedLanguageGraph.value) return 0
  return normalizeLanguageGraph(parsedLanguageGraph.value).assets.filter(asset => !asset.isAbstract).length
})

const canCreate = computed(() => {
  return form.title.trim().length > 0 && !errorMessage.value
})

const resetForm = () => {
  form.title = 'New Diagram'
  form.version = ''
  form.description = ''
  languageGraphFile.value = null
  parsedLanguageGraph.value = null
  languageGraphSourceText.value = ''
  errorMessage.value = ''
  showAssetConfigModal.value = false
  assetTypeConfigAssets.value = []

  if (languageGraphInput.value) {
    languageGraphInput.value.value = ''
  }
}

const handleLanguageGraphSelected = async (event) => {
  const file = event.target.files?.[0]
  languageGraphFile.value = file || null
  parsedLanguageGraph.value = null
  languageGraphSourceText.value = ''
  errorMessage.value = ''

  if (!file) return

  try {
    const content = await file.text()
    const parsed = JSON.parse(content)
    const normalized = normalizeLanguageGraph(parsed, file.name)

    if (!normalized.assets.some(asset => !asset.isAbstract)) {
      throw new Error('No concrete assets were found in the LanguageGraph file.')
    }

    if (!form.version) {
      form.version = normalized.metadata?.version || ''
    }

    parsedLanguageGraph.value = parsed
    languageGraphSourceText.value = content
  } catch (error) {
    languageGraphFile.value = null
    parsedLanguageGraph.value = null
    languageGraphSourceText.value = ''
    errorMessage.value = error.message || 'Failed to parse LanguageGraph JSON.'

    if (languageGraphInput.value) {
      languageGraphInput.value.value = ''
    }
  }
}

const buildAssetTypeConfigAssets = () => {
  if (!parsedLanguageGraph.value) return []

  return normalizeLanguageGraph(parsedLanguageGraph.value, languageGraphFile.value?.name || '')
    .assets
    .filter(asset => !asset.isAbstract)
    .map(asset => ({
      id: asset.name,
      name: asset.name,
      malType: asset.category || asset.superAsset || asset.name,
      dfdShape: asset.dfdShape || 'process'
    }))
}

const buildConfiguredLanguageGraph = (configuredAssets) => {
  if (!parsedLanguageGraph.value) return null

  const shapeByAssetName = new Map(
    configuredAssets.map(asset => [asset.id || asset.name, asset.dfdShape || 'process'])
  )
  const normalized = normalizeLanguageGraph(parsedLanguageGraph.value, languageGraphFile.value?.name || '')

  return {
    ...normalized,
    assets: normalized.assets.map(asset => ({
      ...asset,
      dfdShape: shapeByAssetName.get(asset.name) || asset.dfdShape || 'process'
    }))
  }
}

const finishCreateDiagram = async ({
  displayLanguageGraph = null,
  sourceLanguageGraph = parsedLanguageGraph.value
} = {}) => {
  if (!canCreate.value) {
    errorMessage.value = 'Enter a title and fix any invalid LanguageGraph file.'
    return
  }

  const threatModel = createEmptyThreatModelFromLanguageGraph(
      form,
      sourceLanguageGraph,
      languageGraphFile.value?.name || ''
  )
  if (displayLanguageGraph) {
    threatModel.languageGraph = displayLanguageGraph
    threatModel.languageGraphSource = sourceLanguageGraph
  }
  threatModel.languageGraphSourceText = sourceLanguageGraph ? languageGraphSourceText.value : ''

  tmStore.clear()
  tmStore.setFileName(`${form.title}.json`)
  tmStore._stashThreatModel(threatModel)
  tmStore.selectDiagram(threatModel.diagrams)

  closeModal()
  await router.push({ name: 'EditDiagram', params: { title: threatModel.modelInfo.title } })
}

const createDiagram = async () => {
  if (!canCreate.value) {
    errorMessage.value = 'Enter a title and fix any invalid LanguageGraph file.'
    return
  }

  if (parsedLanguageGraph.value) {
    assetTypeConfigAssets.value = buildAssetTypeConfigAssets()
    modalInstance?.hide()
    showAssetConfigModal.value = true
    return
  }

  await finishCreateDiagram({ displayLanguageGraph: null, sourceLanguageGraph: null })
}

const handleAssetTypeConfigConfirm = async (configuredAssets) => {
  showAssetConfigModal.value = false
  const configuredLanguageGraph = buildConfiguredLanguageGraph(configuredAssets)
  await finishCreateDiagram({
    displayLanguageGraph: configuredLanguageGraph,
    sourceLanguageGraph: parsedLanguageGraph.value
  })
}

const handleAssetTypeConfigCancel = () => {
  showAssetConfigModal.value = false
  modalInstance?.show()
}

const openModal = () => {
  resetForm()
  modalInstance?.show()
}

const closeModal = () => {
  modalInstance?.hide()
}

onMounted(() => {
  if (createDiagramModal.value) {
    modalInstance = new Modal(createDiagramModal.value)
  }
})

onUnmounted(() => {
  modalInstance?.dispose()
  modalInstance = null
})

defineExpose({
  openModal,
})
</script>

<style scoped>
.modal-content {
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}
</style>

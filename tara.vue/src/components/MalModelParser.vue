<template>
  <div class="mal-upload-container">
    <button class="btn btn-success btn-lg px-4" @click="openMalDialog">
      <i class="fa-solid fa-diagram-project"></i>
      Import Diagram Model
    </button>

    <input
      type="file"
      ref="modelInput"
      class="d-none"
      @change="handleModelSelected"
      accept=".json,application/json"
    >
    <input
      type="file"
      ref="languageGraphInput"
      class="d-none"
      @change="handleLanguageGraphSelected"
      accept=".json,application/json"
    >

    <div class="modal fade" id="malUploadModal" tabindex="-1" ref="malModal">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="fa-solid fa-file-import me-2 text-success"></i>
              Import LangGraph Model to DFD
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>

          <div class="modal-body">
            <div class="upload-section mb-3">
              <label class="form-label fw-bold">
                <i class="fa-solid fa-file-code me-2 text-primary"></i>
                Diagram Model File (.json)
              </label>
              <div
                class="upload-box p-3 rounded border text-center"
                :class="modelFile ? 'border-success bg-success-subtle' : 'border-secondary'"
                @click="$refs.modelInput.click()"
                @dragover.prevent
                @drop.prevent="handleModelDrop"
              >
                <template v-if="modelFile">
                  <i class="fa-solid fa-check-circle text-success me-2"></i>
                  <span>{{ modelFile.name }}</span>
                  <button class="btn btn-sm btn-outline-danger ms-2" @click.stop="clearModelFile">
                    <i class="fa-solid fa-times"></i>
                  </button>
                </template>
                <template v-else>
                  <i class="fa-solid fa-cloud-upload-alt fa-2x text-muted mb-2"></i>
                  <p class="mb-0 text-muted">Click or drag the model file here</p>
                </template>
              </div>
            </div>

            <div class="upload-section mb-3">
              <label class="form-label fw-bold">
                <i class="fa-solid fa-file-code me-2 text-warning"></i>
                LangGraph File (.json)
              </label>
              <div
                class="upload-box p-3 rounded border text-center"
                :class="languageGraphFile ? 'border-success bg-success-subtle' : 'border-secondary'"
                @click="$refs.languageGraphInput.click()"
                @dragover.prevent
                @drop.prevent="handleLanguageGraphDrop"
              >
                <template v-if="languageGraphFile">
                  <i class="fa-solid fa-check-circle text-success me-2"></i>
                  <span>{{ languageGraphFile.name }}</span>
                  <button class="btn btn-sm btn-outline-danger ms-2" @click.stop="clearLanguageGraphFile">
                    <i class="fa-solid fa-times"></i>
                  </button>
                </template>
                <template v-else>
                  <i class="fa-solid fa-cloud-upload-alt fa-2x text-muted mb-2"></i>
                  <p class="mb-0 text-muted">Click or drag the LangGraph file here</p>
                </template>
              </div>
            </div>

            <div v-if="isLoading" class="text-center py-3">
              <div class="spinner-border text-success" role="status">
                <span class="visually-hidden">Importing...</span>
              </div>
              <p class="mt-2 text-muted">Building diagram from LangGraph and model...</p>
            </div>

            <div v-if="errorMessage" class="alert alert-danger mt-3">
              <i class="fa-solid fa-exclamation-triangle me-2"></i>
              {{ errorMessage }}
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-success"
              :disabled="!canImport || isLoading"
              @click="importToDfd"
            >
              <i class="fa-solid fa-exchange-alt me-2"></i>
              Show Graph
            </button>
          </div>
        </div>
      </div>
    </div>

    <AssetTypeConfigModal
      :visible="showAssetConfigModal"
      :assets="extractedAssets"
      @confirm="handleAssetConfigConfirm"
      @cancel="handleAssetConfigCancel"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Modal } from 'bootstrap'
import { useThreatModelStore } from '@/stores/threatModelStore.js'
import { normalizeLanguageGraph } from '@/service/langGraph/languageGraph.js'
import { createDiagramFromMalModel } from '@/service/mal/modelTransform.js'
import AssetTypeConfigModal from './AssetTypeConfigModal.vue'

const router = useRouter()
const tmStore = useThreatModelStore()

const modelInput = ref(null)
const languageGraphInput = ref(null)
const malModal = ref(null)

const modelFile = ref(null)
const languageGraphFile = ref(null)
const isLoading = ref(false)
const errorMessage = ref('')
let modalInstance = null

const showAssetConfigModal = ref(false)
const extractedAssets = ref([])
const parsedModel = ref(null)
const parsedLanguageGraph = ref(null)
const languageGraphSourceText = ref('')
const parsedModelType = ref('')

const canImport = computed(() => modelFile.value && languageGraphFile.value)

onMounted(() => {
  if (malModal.value) {
    modalInstance = new Modal(malModal.value)
  }
})

const cleanupModalState = () => {
  modalInstance?.hide()
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove())
  document.body.classList.remove('modal-open')
  document.body.style.removeProperty('overflow')
  document.body.style.removeProperty('padding-right')
}

onUnmounted(() => {
  cleanupModalState()
  modalInstance?.dispose()
  modalInstance = null
})

const openMalDialog = () => {
  errorMessage.value = ''
  modalInstance?.show()
}

const isJsonFile = (file) => file?.name?.toLowerCase().endsWith('.json')

const handleModelSelected = (evt) => {
  const file = evt.target.files?.[0]
  if (file) {
    modelFile.value = file
    errorMessage.value = ''
  }
}

const handleLanguageGraphSelected = (evt) => {
  const file = evt.target.files?.[0]
  if (file) {
    languageGraphFile.value = file
    errorMessage.value = ''
  }
}

const handleModelDrop = (evt) => {
  const file = evt.dataTransfer.files?.[0]
  if (isJsonFile(file)) {
    modelFile.value = file
    errorMessage.value = ''
  }
}

const handleLanguageGraphDrop = (evt) => {
  const file = evt.dataTransfer.files?.[0]
  if (isJsonFile(file)) {
    languageGraphFile.value = file
    errorMessage.value = ''
  }
}

const clearModelFile = () => {
  modelFile.value = null
  if (modelInput.value) {
    modelInput.value.value = ''
  }
}

const clearLanguageGraphFile = () => {
  languageGraphFile.value = null
  if (languageGraphInput.value) {
    languageGraphInput.value.value = ''
  }
}

const parseJsonText = (text, label) => {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }
}

const getModelTitle = (model) => (
  model?.metadata?.name
  || model?.modelInfo?.title
  || modelFile.value?.name?.replace(/\.json$/i, '')
  || 'MAL Model'
)

const isMalAssetModel = (model) => (
  model?.assets
  && typeof model.assets === 'object'
  && !Array.isArray(model.assets)
)

const isDiagramThreatModel = (model) => (
  model?.diagrams?.cells
  && Array.isArray(model.diagrams.cells)
)

const buildAssetTypeConfigAssets = () => {
  const normalized = normalizeLanguageGraph(parsedLanguageGraph.value, languageGraphFile.value?.name || '')
  const languageAssetsByName = new Map(normalized.assets.map(asset => [asset.name, asset]))
  const seenTypes = new Set()

  return Object.values(parsedModel.value?.assets || {})
    .map(asset => asset?.type)
    .filter(Boolean)
    .filter(type => {
      if (seenTypes.has(type)) return false
      seenTypes.add(type)
      return true
    })
    .map(type => {
      const languageAsset = languageAssetsByName.get(type)
      return {
        id: type,
        name: type,
        malType: languageAsset?.category || languageAsset?.superAsset || type,
        dfdShape: languageAsset?.dfdShape || 'process'
      }
    })
}

const buildConfiguredLanguageGraph = (configuredAssets) => {
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

const createThreatModel = (diagram, languageGraph) => {
  const title = getModelTitle(parsedModel.value)
  const version = parsedModel.value?.version
      || parsedModel.value?.metadata?.langVersion
      || parsedModel.value?.modelInfo?.version
      || languageGraph.metadata?.version
      || '1.0.0'

  return {
    version,
    modelInfo: {
      title,
      version,
      template: 'langgraph-model',
      description: parsedModel.value?.modelInfo?.description
          || `Imported from ${modelFile.value.name} and ${languageGraphFile.value.name}`
    },
    diagrams: diagram,
    threatCounter: parsedModel.value?.threatCounter || 0,
    languageGraph,
    languageGraphSource: parsedLanguageGraph.value,
    languageGraphSourceText: languageGraphSourceText.value
  }
}

const finishImport = async (diagram, languageGraph) => {
  const threatModel = createThreatModel(diagram, languageGraph)
  const title = threatModel.modelInfo.title

  tmStore.clear()
  tmStore.setFileName(`${title}.json`)
  tmStore._stashThreatModel(threatModel)
  tmStore.selectDiagram(threatModel.diagrams)

  tmStore.malModel = isMalAssetModel(parsedModel.value) ? parsedModel.value : null
  tmStore.malLangspec = null
  tmStore.malMarFile = null
  tmStore.malModelFile = modelFile.value
  tmStore.malMarFileName = ''
  tmStore.malModelFileName = modelFile.value.name

  console.log('[MalModelParser] LangGraph, model, and diagram saved for simulation')
  cleanupModalState()
  await router.push({ name: 'EditDiagram', params: { title } })
}

const importToDfd = async () => {
  if (!canImport.value) return

  isLoading.value = true
  errorMessage.value = ''

  try {
    const modelText = await modelFile.value.text()
    languageGraphSourceText.value = await languageGraphFile.value.text()
    parsedModel.value = parseJsonText(modelText, 'Diagram model file')
    parsedLanguageGraph.value = parseJsonText(languageGraphSourceText.value, 'LangGraph file')

    const normalizedLanguageGraph = normalizeLanguageGraph(
      parsedLanguageGraph.value,
      languageGraphFile.value?.name || ''
    )

    if (!normalizedLanguageGraph.assets.some(asset => !asset.isAbstract)) {
      throw new Error('No concrete assets were found in the LangGraph file.')
    }

    if (isDiagramThreatModel(parsedModel.value)) {
      parsedModelType.value = 'diagram'
      await finishImport(parsedModel.value.diagrams, normalizedLanguageGraph)
      return
    }

    if (!isMalAssetModel(parsedModel.value)) {
      throw new Error('Diagram model file must contain either diagrams.cells or an assets object.')
    }

    parsedModelType.value = 'assets'
    extractedAssets.value = buildAssetTypeConfigAssets()
    modalInstance?.hide()
    showAssetConfigModal.value = true
  } catch (error) {
    console.error('LangGraph model import failed:', error)
    errorMessage.value = error.message || 'Failed to import LangGraph model.'
  } finally {
    isLoading.value = false
  }
}

const handleAssetConfigConfirm = async (configuredAssets) => {
  showAssetConfigModal.value = false
  isLoading.value = true
  errorMessage.value = ''

  try {
    const configuredLanguageGraph = buildConfiguredLanguageGraph(configuredAssets)
    const diagram = createDiagramFromMalModel(parsedModel.value, configuredLanguageGraph)
    await finishImport(diagram, configuredLanguageGraph)
  } catch (error) {
    console.error('LangGraph model to DFD conversion failed:', error)
    errorMessage.value = error.message || 'Failed to show graph.'
  } finally {
    isLoading.value = false
  }
}

const handleAssetConfigCancel = () => {
  showAssetConfigModal.value = false
  modalInstance?.show()
}
</script>

<style scoped>
.mal-upload-container {
  display: inline-block;
}

.upload-box {
  cursor: pointer;
  transition: all 0.3s ease;
  min-height: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #f8f9fa;
}

.upload-box:hover {
  background-color: #e9ecef;
  border-color: #5F95FF !important;
}

.upload-section label {
  color: #495057;
}

.btn-success {
  background: linear-gradient(135deg, #28a745, #20c997);
  border: none;
}

.btn-success:hover:not(:disabled) {
  background: linear-gradient(135deg, #218838, #1ea97e);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
}

.modal-content {
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

.modal-header {
  border-bottom: 1px solid #dee2e6;
}

.modal-footer {
  border-top: 1px solid #dee2e6;
}
</style>

<template>
  <div class="mal-upload-container">
    <!-- MAL Model Upload Button -->
    <button class="btn btn-success btn-lg px-4 disabled" @click="openMalDialog">
      <i class="fa-solid fa-diagram-project"></i>
      Import MAL Model
    </button>
    
    <!-- Hidden file inputs -->
    <input
        type="file"
        ref="modelInput"
        class="d-none"
        @change="handleModelSelected"
        accept=".json"
    >
    <input
        type="file"
        ref="marInput"
        class="d-none"
        @change="handleMarSelected"
        accept=".mar"
    >

    <!-- MAL Upload Modal -->
    <div class="modal fade" id="malUploadModal" tabindex="-1" ref="malModal">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="fa-solid fa-file-import me-2 text-success"></i>
              Import MAL Model to DFD
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <!-- Model File Upload -->
            <div class="upload-section mb-3">
              <label class="form-label fw-bold">
                <i class="fa-solid fa-file-code me-2 text-primary"></i>
                Model File (.json)
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
                  <p class="mb-0 text-muted">Click or drag the file here</p>
                </template>
              </div>
            </div>

            <!-- MAR File Upload -->
            <div class="upload-section mb-3">
              <label class="form-label fw-bold">
                <i class="fa-solid fa-file-archive me-2 text-warning"></i>
                Language Definition File (.mar)
              </label>
              <div 
                class="upload-box p-3 rounded border text-center"
                :class="marFile ? 'border-success bg-success-subtle' : 'border-secondary'"
                @click="$refs.marInput.click()"
                @dragover.prevent
                @drop.prevent="handleMarDrop"
              >
                <template v-if="marFile">
                  <i class="fa-solid fa-check-circle text-success me-2"></i>
                  <span>{{ marFile.name }}</span>
                  <button class="btn btn-sm btn-outline-danger ms-2" @click.stop="clearMarFile">
                    <i class="fa-solid fa-times"></i>
                  </button>
                </template>
                <template v-else>
                  <i class="fa-solid fa-cloud-upload-alt fa-2x text-muted mb-2"></i>
                  <p class="mb-0 text-muted">Click or drag the file here</p>
                </template>
              </div>
            </div>

            <!-- Loading Indicator -->
            <div v-if="isLoading" class="text-center py-3">
              <div class="spinner-border text-success" role="status">
                <span class="visually-hidden">Converting...</span>
              </div>
              <p class="mt-2 text-muted">Converting MAL model to DFD...</p>
            </div>

            <!-- Error Message -->
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
              :disabled="!canConvert || isLoading"
              @click="convertToDfd"
            >
              <i class="fa-solid fa-exchange-alt me-2"></i>
              Convert to DFD
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Asset Type Config Modal -->
    <AssetTypeConfigModal
      :visible="showAssetConfigModal"
      :assets="extractedAssets"
      @confirm="handleAssetConfigConfirm"
      @cancel="handleAssetConfigCancel"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useThreatModelStore } from '@/stores/threatModelStore.js'
import { extractLangspec, extractAssets, convertMalToDfdWithShapes } from '@/service/mal/malApiService.js'
import { Modal } from 'bootstrap'
import AssetTypeConfigModal from './AssetTypeConfigModal.vue'

const router = useRouter()
const tmStore = useThreatModelStore()

// Refs
const modelInput = ref(null)
const marInput = ref(null)
const malModal = ref(null)

// State
const modelFile = ref(null)
const marFile = ref(null)
const isLoading = ref(false)
const errorMessage = ref('')
let modalInstance = null

// Asset Type Config Modal 관련 상태
const showAssetConfigModal = ref(false)
const extractedAssets = ref([])
const parsedModel = ref(null)
const parsedLangspec = ref(null)

// Computed
const canConvert = computed(() => modelFile.value && marFile.value)

onMounted(() => {
  // Initialize Bootstrap modal
  if (malModal.value) {
    modalInstance = new Modal(malModal.value)
  }
})

const openMalDialog = () => {
  errorMessage.value = ''
  if (modalInstance) {
    modalInstance.show()
  }
}

const handleModelSelected = (evt) => {
  const file = evt.target.files[0]
  if (file) {
    modelFile.value = file
    errorMessage.value = ''
  }
}

const handleMarSelected = (evt) => {
  const file = evt.target.files[0]
  if (file) {
    marFile.value = file
    errorMessage.value = ''
  }
}

const handleModelDrop = (evt) => {
  const file = evt.dataTransfer.files[0]
  if (file && file.name.endsWith('.json')) {
    modelFile.value = file
    errorMessage.value = ''
  }
}

const handleMarDrop = (evt) => {
  const file = evt.dataTransfer.files[0]
  if (file && file.name.endsWith('.mar')) {
    marFile.value = file
    errorMessage.value = ''
  }
}

const clearModelFile = () => {
  modelFile.value = null
  if (modelInput.value) {
    modelInput.value.value = ''
  }
}

const clearMarFile = () => {
  marFile.value = null
  if (marInput.value) {
    marInput.value.value = ''
  }
}

/**
 * 1단계: 파일 파싱 및 자산 목록 추출 -> Asset Config Modal 표시
 */
const convertToDfd = async () => {
  if (!canConvert.value) return

  isLoading.value = true
  errorMessage.value = ''

  try {
    // 1. 모델 파일 읽기
    const modelText = await modelFile.value.text()
    parsedModel.value = JSON.parse(modelText)

    // 2. MAR 파일에서 langspec 추출
    parsedLangspec.value = await extractLangspec(marFile.value)

    // 3. 자산 목록 추출
    extractedAssets.value = await extractAssets(parsedModel.value)

    // 4. 업로드 모달 닫기 및 Asset Config Modal 열기
    if (modalInstance) {
      modalInstance.hide()
    }
    showAssetConfigModal.value = true

  } catch (error) {
    console.error('MAL parsing failed:', error)
    errorMessage.value = error.message || 'Failed to parse MAL model'
  } finally {
    isLoading.value = false
  }
}

/**
 * 2단계: Asset Config Modal에서 확인 -> DFD 생성
 */
const handleAssetConfigConfirm = async (configuredAssets) => {
  showAssetConfigModal.value = false
  isLoading.value = true
  errorMessage.value = ''

  try {
    // shapeMapping 객체 생성
    const shapeMapping = {}
    configuredAssets.forEach(asset => {
      shapeMapping[asset.id] = asset.dfdShape
    })

    // DFD 변환 (shapeMapping 적용)
    const result = await convertMalToDfdWithShapes(
      parsedModel.value, 
      parsedLangspec.value, 
      shapeMapping
    )

    // Store에 저장
    tmStore.setFileName(modelFile.value.name.replace('.json', '_dfd.json'))
    tmStore._stashThreatModel(result.dfd)
    tmStore.selectDiagram(result.dfd.diagrams)
    
    // 시뮬레이션을 위한 원본 model, langspec, 그리고 파일명 저장
    tmStore.malModel = parsedModel.value
    tmStore.malLangspec = parsedLangspec.value
    // 원본 .mar 파일과 모델 파일 저장 (시뮬레이션용)
    tmStore.malMarFile = marFile.value  // File 객체
    tmStore.malModelFile = modelFile.value  // File 객체
    tmStore.malMarFileName = marFile.value.name
    tmStore.malModelFileName = modelFile.value.name
    console.log('[MalModelParser] MAL model, langspec, and original files saved for simulation')

    // 다이어그램 편집 페이지로 이동
    const tmTitle = result.dfd.modelInfo?.title || 'MAL Model'
    router.push({ name: 'EditDiagram', params: { title: tmTitle } })

  } catch (error) {
    console.error('MAL to DFD conversion failed:', error)
    errorMessage.value = error.message || 'Failed to convert MAL model to DFD'
  } finally {
    isLoading.value = false
  }
}

/**
 * Asset Config Modal 취소
 */
const handleAssetConfigCancel = () => {
  showAssetConfigModal.value = false
  // 업로드 모달 다시 열기
  if (modalInstance) {
    modalInstance.show()
  }
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

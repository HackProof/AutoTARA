<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Modal } from 'bootstrap'
import { useRouter } from 'vue-router'
import { parseLanguageGraph } from '@/services/languageGraph.js'
import { useThreatModelStore } from '@/stores/threatModelStore.js'
import LangSchemaSelect from '@/components/LangSchemaSelect.vue'

const router = useRouter()
const tmStore = useThreatModelStore()
const modalElement = ref(null)
const titleInput = ref(null)
const languageGraphInput = ref(null)
const schemaSelect = ref(null)
const selectedFileName = ref('')
const form = reactive({
  title: 'New Diagram',
  version: '',
  description: '',
  threatCatalogSchema: '',
})
const languageGraphDocument = ref(null)
const errorMessage = ref('')
const isReading = ref(false)
const isCreating = ref(false)
let modalInstance
let triggerElement
let fileRequest = 0

const assetCount = computed(
  () =>
    languageGraphDocument.value?.languageGraph.assets.filter((asset) => !asset.isAbstract).length,
)
const canCreate = computed(
  () => form.title.trim() && !errorMessage.value && !isReading.value && !isCreating.value,
)

function focusTitle() {
  titleInput.value?.focus()
  titleInput.value?.select()
}

function handleHidden() {
  fileRequest += 1
  isReading.value = false
  triggerElement?.focus()
}

function openModal() {
  fileRequest += 1
  Object.assign(form, {
    title: 'New Diagram',
    version: '',
    description: '',
    threatCatalogSchema: '',
  })
  languageGraphDocument.value = null
  selectedFileName.value = ''
  languageGraphInput.value.value = ''
  errorMessage.value = ''
  isReading.value = false
  isCreating.value = false
  triggerElement = document.activeElement
  modalInstance.show()
  schemaSelect.value?.refresh()
}

async function handleLanguageGraphSelected(event) {
  const request = ++fileRequest
  const file = event.target.files?.[0]
  selectedFileName.value = file?.name || ''
  languageGraphDocument.value = null
  errorMessage.value = ''
  isReading.value = Boolean(file)
  if (!file) return

  try {
    if (!file.name.toLowerCase().endsWith('.json')) {
      throw new Error('Select a MAL LangGraph JSON file (.json).')
    }
    const content = await file.text()
    if (request !== fileRequest) return
    const parsed = parseLanguageGraph(content, file.name)
    languageGraphDocument.value = parsed
    if (!form.version) {
      form.version = String(parsed.languageGraph.metadata.version || '')
    }
  } catch (error) {
    if (request !== fileRequest) return
    errorMessage.value = error.message || 'Failed to read the MAL LangGraph file.'
  } finally {
    if (request === fileRequest) isReading.value = false
  }
}

function clearLanguageGraph() {
  fileRequest += 1
  languageGraphDocument.value = null
  selectedFileName.value = ''
  languageGraphInput.value.value = ''
  errorMessage.value = ''
  isReading.value = false
}

async function createDiagram() {
  if (!canCreate.value) return
  isCreating.value = true
  try {
    tmStore.createDiagram(form, languageGraphDocument.value)
    // The modal has no fade transition, so its backdrop and focus trap close before navigation.
    modalInstance.hide()
    await router.push({ name: 'EditDiagram', params: { title: tmStore.data.modelInfo.title } })
  } catch (error) {
    errorMessage.value = error.message || 'Failed to create the diagram.'
    modalInstance.show()
  } finally {
    isCreating.value = false
  }
}

onMounted(() => {
  modalInstance = new Modal(modalElement.value)
  modalElement.value.addEventListener('shown.bs.modal', focusTitle)
  modalElement.value.addEventListener('hidden.bs.modal', handleHidden)
})

onBeforeUnmount(() => {
  fileRequest += 1
  modalElement.value.removeEventListener('shown.bs.modal', focusTitle)
  modalElement.value.removeEventListener('hidden.bs.modal', handleHidden)
  modalInstance?.hide()
  modalInstance?.dispose()
})

defineExpose({ openModal })
</script>

<template>
  <Teleport to="body">
    <div
      id="createDiagramModal"
      ref="modalElement"
      class="modal"
      tabindex="-1"
      aria-labelledby="createDiagramModalLabel"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content shadow">
          <div class="modal-header">
            <h2 id="createDiagramModalLabel" class="modal-title fw-bold fs-4">New Diagram</h2>
            <button
              type="button"
              class="btn-close"
              aria-label="Close"
              data-bs-dismiss="modal"
            ></button>
          </div>
          <form @submit.prevent="createDiagram">
            <div class="modal-body">
              <div class="mb-3">
                <label for="diagram-title" class="form-label fw-bold fs-5">Title</label>
                <input
                  id="diagram-title"
                  ref="titleInput"
                  v-model="form.title"
                  type="text"
                  class="form-control"
                  placeholder="New Diagram"
                  required
                />
              </div>
              <div class="mb-3">
                <label for="language-graph-file" class="form-label fw-bold fs-5">
                  MAL LangGraph <span class="text-muted fw-normal">(Optional)</span>
                </label>
                <input
                  id="language-graph-file"
                  ref="languageGraphInput"
                  type="file"
                  class="form-control"
                  accept=".json"
                  aria-describedby="language-graph-help"
                  :aria-invalid="Boolean(errorMessage)"
                  @change="handleLanguageGraphSelected"
                />
                <div id="language-graph-help" class="form-text" aria-live="polite">
                  <span v-if="isReading">Reading MAL LangGraph…</span>
                  <span v-else-if="languageGraphDocument">
                    {{ languageGraphDocument.languageGraph.fileName }} — {{ assetCount }} assets
                  </span>
                  <span v-else
                    >Optionally attach an asset and attack-step catalog. Only .json files are
                    supported.</span
                  >
                </div>
                <button
                  v-if="selectedFileName"
                  type="button"
                  class="btn btn-sm btn-outline-secondary mt-2"
                  @click="clearLanguageGraph"
                >
                  Remove file
                </button>
              </div>
              <LangSchemaSelect
                ref="schemaSelect"
                id="diagram-lang-schema"
                v-model="form.threatCatalogSchema"
                class="mb-3"
              />
              <div class="mb-3">
                <label for="diagram-version" class="form-label fw-bold fs-5">Version</label>
                <input
                  id="diagram-version"
                  v-model="form.version"
                  type="text"
                  class="form-control"
                  placeholder="1.0.0"
                />
              </div>
              <div class="mb-3">
                <label for="diagram-description" class="form-label fw-bold fs-5">Description</label>
                <textarea
                  id="diagram-description"
                  v-model="form.description"
                  class="form-control"
                  rows="4"
                  placeholder="Describe the threat model"
                ></textarea>
              </div>
              <div v-if="errorMessage" class="alert alert-danger mb-0" role="alert">
                {{ errorMessage }}
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                Cancel
              </button>
              <button type="submit" class="btn btn-primary" :disabled="!canCreate">
                {{ isCreating ? 'Creating…' : 'Create' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-content {
  border-radius: 12px;
  box-shadow: 0 10px 40px rgb(0 0 0 / 20%);
}
</style>

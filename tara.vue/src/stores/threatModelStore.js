import { defineStore } from 'pinia'

const STORAGE_KEY = 'autotara.active-threat-model'

function restoreModel() {
  try {
    const data = JSON.parse(globalThis.sessionStorage?.getItem(STORAGE_KEY) || 'null')
    if (
      typeof data?.modelInfo?.title === 'string' &&
      data.modelInfo.title.trim() &&
      typeof data?.diagrams?.xml === 'string'
    ) {
      // Older sessions have no record of a file save. Keep their content dirty.
      if (typeof data.diagrams.savedXml !== 'string') data.diagrams.savedXml = ''
      if (typeof data.threatCatalogSchema !== 'string') data.threatCatalogSchema = ''
      return data
    }
  } catch {
    // A corrupt or unavailable session must not prevent opening the app.
  }
  return null
}

export const useThreatModelStore = defineStore('threatModel', {
  state: () => ({ data: restoreModel(), storageError: '' }),
  getters: {
    hasDiagram: (state) => Boolean(state.data),
    hasUnsavedChanges: (state) =>
      Boolean(state.data && state.data.diagrams.xml !== state.data.diagrams.savedXml),
  },
  actions: {
    persist() {
      try {
        if (!globalThis.sessionStorage) throw new Error('Session storage is unavailable')
        globalThis.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.data))
        this.storageError = ''
      } catch {
        this.storageError = 'Changes are kept in memory only. Save a diagram file to keep a copy.'
      }
    },
    updateDiagramXml(xml, schema = this.data?.threatCatalogSchema || '') {
      if (!this.data) throw new Error('Create a diagram before editing it.')
      if (typeof xml !== 'string') throw new Error('Diagram XML must be a string.')
      if (typeof schema !== 'string') throw new Error('Diagram language schema must be a string.')
      const trimmedSchema = schema.trim()
      if (this.data.diagrams.xml === xml && this.data.threatCatalogSchema === trimmedSchema) return
      this.data.diagrams.xml = xml
      this.data.threatCatalogSchema = trimmedSchema
      this.persist()
    },
    initializeDiagramXml(xml, schema) {
      const wasDirty = this.hasUnsavedChanges
      this.updateDiagramXml(xml, schema)
      // Use the editor's canonical XML, including its empty root, as the initial
      // baseline. Restoring an already dirty session must not mark it saved.
      if (!wasDirty) {
        this.data.diagrams.savedXml = xml
        this.persist()
      }
    },
    markDiagramSaved(xml) {
      if (!this.data) throw new Error('Create a diagram before saving it.')
      if (typeof xml !== 'string') throw new Error('Saved diagram XML must be a string.')
      // Mark exactly the downloaded snapshot, not a possibly newer diagram.
      this.data.diagrams.savedXml = xml
      this.persist()
    },
    createDiagram(
      { title, version = '', description = '', threatCatalogSchema = '' },
      languageGraphDocument = null,
    ) {
      const trimmedTitle = title.trim()
      if (!trimmedTitle) throw new Error('Enter a diagram title.')

      const modelVersion = version.trim()
      this.data = {
        version: modelVersion || '1.0.0',
        modelInfo: {
          title: trimmedTitle,
          version: modelVersion,
          description: description.trim(),
          template: languageGraphDocument ? 'langgraph' : 'manual',
        },
        // Serialized by the local draw.io runtime.
        diagrams: { xml: '', savedXml: '' },
        threatCounter: 0,
        threatCatalogSchema: threatCatalogSchema.trim(),
        languageGraph: languageGraphDocument?.languageGraph || null,
        languageGraphSource: languageGraphDocument?.source || null,
        languageGraphSourceText: languageGraphDocument?.sourceText || '',
      }

      this.persist()
    },
  },
})

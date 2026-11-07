<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { buildReportInput, getReportPaths } from '@/services/scenarioReport.js'
import { previewScenarioReport, requestScenarioReport } from '@/services/scenarioReportApi.js'
import ScenarioEvidenceView from '@/components/ScenarioEvidenceView.vue'
import { downloadFile } from '@/services/drawio/xml.js'

const props = defineProps({
  result: { type: Object, required: true },
  active: { type: Boolean, default: true },
})
const emit = defineEmits(['reports-change', 'open-report'])
const targetId = ref('')
const pathIndex = ref(0)
const ciaAttribute = ref('Integrity')
const context = ref('')
const pathResult = computed(() => getReportPaths(props.result, targetId.value))
const error = ref('')
const phase = ref('')
const promptPreview = shallowRef(null)
const promptJson = computed(() =>
  promptPreview.value ? JSON.stringify(promptPreview.value.request, null, 2) : '',
)
const liveResponse = ref(null)
const responseOutput = ref(null)
const followResponse = ref(true)
const now = ref(Date.now())
const responseStatuses = {
  preparing: 'Preparing request',
  connecting: 'Connecting to LLM',
  connected: 'Connected · waiting for output',
  processing: 'LLM processing · waiting for output',
  receiving: 'Receiving response',
  validating: 'Validating complete response',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  buffered: 'Response received without streaming',
}
const responseStatus = computed(() => responseStatuses[liveResponse.value?.status] || 'Waiting')
const elapsedSeconds = computed(() =>
  liveResponse.value
    ? Math.max(
        0,
        Math.floor(
          ((liveResponse.value.finishedAt || now.value) - liveResponse.value.startedAt) / 1000,
        ),
      )
    : 0,
)
const secondsSinceText = computed(() =>
  liveResponse.value?.lastTextAt
    ? Math.max(
        0,
        Math.floor(
          ((liveResponse.value.finishedAt || now.value) - liveResponse.value.lastTextAt) / 1000,
        ),
      )
    : null,
)
const secondsSinceSignal = computed(() =>
  liveResponse.value?.serverAt
    ? Math.max(0, Math.floor((now.value - liveResponse.value.serverAt) / 1000))
    : null,
)
const reports = shallowRef(new Map())
const paths = computed(() => pathResult.value?.paths || [])
const selectedPath = computed(() => paths.value[pathIndex.value])
const target = computed(() => props.result.graph.targets.find((node) => node.id === targetId.value))
const nodes = computed(
  () => new Map(props.result.graph.performedNodes.map((node) => [node.id, node])),
)
const label = (id) =>
  nodes.value.get(id)?.fullName || `${nodes.value.get(id)?.asset}:${nodes.value.get(id)?.name}`
const stepNumbers = computed(() => new Map((selectedPath.value || []).map((id, i) => [id, i + 1])))
const supportingSteps = (id) =>
  (pathResult.value.graph?.edges || [])
    .filter((edge) => edge.target === id)
    .map((edge) => stepNumbers.value.get(edge.source))
const requiredSteps = (id) =>
  (nodes.value.get(id)?.prerequisites?.necessaryParentIds || []).map((parent) =>
    stepNumbers.value.get(parent),
  )
const iterationGroups = computed(() => {
  const groups = []
  for (const id of selectedPath.value || []) {
    const iteration = nodes.value.get(id).performedAt
    if (groups.at(-1)?.iteration !== iteration) groups.push({ iteration, steps: [] })
    groups.at(-1).steps.push({ id, number: stepNumbers.value.get(id) })
  }
  return groups
})
const selectionKey = computed(() =>
  JSON.stringify([targetId.value, selectedPath.value, ciaAttribute.value, context.value]),
)
const report = computed(() => reports.value.get(selectionKey.value))
const scenario = computed(() => report.value?.draft?.scenario)
const verification = computed(() => report.value?.verified?.verification)
const busy = computed(() => Boolean(phase.value))
const canGenerate = computed(() =>
  Boolean(selectedPath.value?.length && selectedPath.value.length <= 201 && !busy.value),
)
const canVerify = computed(() => Boolean(report.value?.draft && canGenerate.value))
let controller = null

function cancelRequest() {
  controller?.abort()
  if (liveResponse.value && !liveResponse.value.finishedAt) {
    liveResponse.value.status = 'cancelled'
    liveResponse.value.finishedAt = Date.now()
  }
  controller = null
  phase.value = ''
}
function saveReport(key, value) {
  reports.value = new Map(reports.value).set(key, value)
  emit('reports-change', reports.value)
}
async function runReport(action, previewOnly = false) {
  const verifying = action === 'verify'
  if (verifying ? !canVerify.value : !canGenerate.value) return
  const key = selectionKey.value
  const current = new AbortController()
  controller = current
  error.value = ''
  if (previewOnly) promptPreview.value = null
  else {
    now.value = Date.now()
    liveResponse.value = {
      action,
      status: 'preparing',
      text: '',
      startedAt: now.value,
      finishedAt: null,
      lastTextAt: null,
      serverAt: null,
    }
    followResponse.value = true
  }
  try {
    const record = verifying
      ? report.value
      : {
          input: buildReportInput(
            props.result,
            targetId.value,
            selectedPath.value,
            ciaAttribute.value,
            context.value,
          ),
        }
    phase.value = previewOnly
      ? 'Preparing prompt preview…'
      : verifying
        ? 'Verifying scenarios and attack paths…'
        : 'Generating damage and threat scenarios…'
    const request = previewOnly ? previewScenarioReport : requestScenarioReport
    const result = await request(action, record.input, {
      ...(verifying ? { draft: record.draft.scenario } : {}),
      signal: current.signal,
      ...(previewOnly
        ? {}
        : {
            onEvent(event) {
              if (controller !== current || current.signal.aborted) return
              const live = liveResponse.value
              live.serverAt = Date.now()
              if (event.type === 'status') live.status = event.status
              else if (event.type === 'delta' || event.type === 'text') {
                live.text = event.type === 'delta' ? live.text + event.delta : event.text
                live.lastTextAt = live.serverAt
                if (live.status !== 'validating') live.status = 'receiving'
              }
            },
          }),
    })
    if (controller !== current) return
    if (previewOnly) promptPreview.value = { action, request: result }
    else {
      liveResponse.value.status = 'completed'
      liveResponse.value.finishedAt = Date.now()
      if (!verifying) promptPreview.value = null
      saveReport(key, { ...record, [verifying ? 'verified' : 'draft']: result })
    }
  } catch (cause) {
    if (controller === current && !current.signal.aborted) {
      if (!previewOnly) {
        liveResponse.value.status = 'failed'
        liveResponse.value.finishedAt = Date.now()
      }
      error.value =
        cause.message ||
        (previewOnly
          ? 'Prompt preview failed.'
          : verifying
            ? 'Report verification failed.'
            : 'Report generation failed.')
    }
  } finally {
    if (controller === current) {
      controller = null
      phase.value = ''
    }
  }
}
function exportPrompt() {
  if (!promptPreview.value) return
  downloadFile(
    promptJson.value,
    `tara-${promptPreview.value.action}-prompt.json`,
    'application/json',
  )
}
function exportReport() {
  if (!report.value) return
  downloadFile(
    JSON.stringify(report.value, null, 2),
    'tara-scenario-report.json',
    'application/json',
  )
}
watch(
  () => props.result,
  (result) => {
    cancelRequest()
    promptPreview.value = null
    liveResponse.value = null
    reports.value = new Map()
    emit('reports-change', reports.value)
    targetId.value =
      (result.graph.targets.find((node) => node.reached) || result.graph.targets[0])?.id || ''
  },
  { immediate: true, flush: 'sync' },
)
watch(
  targetId,
  () => {
    pathIndex.value = 0
  },
  { flush: 'sync' },
)
watch(
  selectionKey,
  () => {
    cancelRequest()
    promptPreview.value = null
    liveResponse.value = null
    error.value = ''
  },
  { flush: 'sync' },
)
watch(busy, (running, previous, onCleanup) => {
  if (!running) return
  now.value = Date.now()
  const timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  onCleanup(() => clearInterval(timer))
})
watch(
  () => liveResponse.value?.text,
  () => {
    if (followResponse.value && responseOutput.value)
      responseOutput.value.scrollTop = responseOutput.value.scrollHeight
  },
  { flush: 'post' },
)
onBeforeUnmount(cancelRequest)
</script>

<template>
  <section class="scenario-report border" aria-label="Threat Scenario workspace" :aria-busy="busy">
    <header class="report-header p-3 border-bottom">
      <div class="d-flex align-items-center flex-wrap gap-2 mb-2">
        <h2 class="h5 mb-0">Threat Scenario</h2>
        <span v-if="result.partial" class="badge text-bg-warning">Partial simulation</span>
        <button
          v-if="report?.draft"
          type="button"
          class="btn btn-sm btn-primary ms-auto"
          @click="emit('open-report', selectionKey)"
        >
          Assess in Report
        </button>
        <button
          v-if="report?.draft"
          type="button"
          class="btn btn-sm btn-outline-secondary"
          @click="exportReport"
        >
          Download JSON
        </button>
      </div>
      <p class="small text-secondary mb-0">
        Select a path to a reached Target to generate damage and threat scenarios. Use Verify
        scenarios for a separate LLM review.
      </p>
    </header>
    <div class="report-workspace">
      <aside class="report-path-panel p-3" aria-labelledby="report-original-path-title">
        <div class="d-flex align-items-center flex-wrap gap-2 mb-3">
          <h3 id="report-original-path-title" class="h6 mb-0">Original Simulation Path</h3>
          <span v-if="selectedPath" class="badge text-bg-secondary"
            >{{ selectedPath.length }} steps</span
          >
        </div>
        <div
          v-if="selectedPath"
          class="original-path"
          tabindex="0"
          role="region"
          aria-label="Simulation prerequisites by iteration"
        >
          <section
            v-for="group in iterationGroups"
            :key="group.iteration"
            class="mb-3"
            :aria-label="`Iteration ${group.iteration}`"
          >
            <h4 class="h6 text-secondary">Iteration {{ group.iteration }}</h4>
            <ol class="iteration-steps" :start="group.steps[0].number">
              <li v-for="step in group.steps" :key="step.id" class="path-step text-break">
                <strong>{{ label(step.id) }}</strong>
                <div class="small text-secondary mt-1">
                  <span v-if="pathResult.graph.entryIds.includes(step.id)"
                    >Initial Entry · granted</span
                  >
                  <template v-else>
                    <span v-if="nodes.get(step.id)?.type === 'and'"
                      >AND · all required steps:
                      {{ requiredSteps(step.id).join(', ') || 'None' }}</span
                    >
                    <span v-else>OR · at least one supporting step</span>
                    <div>Supporting steps: {{ supportingSteps(step.id).join(', ') }}</div>
                  </template>
                </div>
              </li>
            </ol>
          </section>
        </div>
        <p v-else class="small text-secondary" role="status">
          No validated prerequisite trace is available for this Target.
        </p>
        <p class="small text-secondary mb-0 mt-3">
          All required AND branches are included. OR inputs are supporting alternatives. Steps are
          grouped by recorded iteration; ordering within one iteration only respects dependencies
          and does not establish a unique causal execution trace.
        </p>
      </aside>
      <section
        class="report-main p-3"
        aria-label="Threat Scenario settings and results"
        tabindex="0"
      >
        <div class="row g-3">
          <div class="col-12">
            <label for="report-target" class="form-label">Target</label>
            <select id="report-target" v-model="targetId" class="form-select" :disabled="busy">
              <option v-for="item in result.graph.targets" :key="item.id" :value="item.id">
                {{ item.fullName || `${item.asset}:${item.name}`
                }}{{ item.reached ? '' : ' (not reached)' }}
              </option>
            </select>
          </div>
          <div class="col-12">
            <label for="report-path" class="form-label">Simulation path</label>
            <select
              id="report-path"
              v-model="pathIndex"
              class="form-select"
              :disabled="busy || !paths.length"
            >
              <option v-if="!paths.length" :value="0">No validated simulation trace</option>
              <option v-for="(path, index) in paths" :key="index" :value="index">
                Validated prerequisite trace · {{ path.length }} steps ·
                {{ pathResult.graph.entryIds.length }} Entries
              </option>
            </select>
          </div>
          <div class="col-12">
            <label for="report-cia" class="form-label">CIA attribute</label>
            <select id="report-cia" v-model="ciaAttribute" class="form-select" :disabled="busy">
              <option>Confidentiality</option>
              <option>Integrity</option>
              <option>Availability</option>
            </select>
          </div>
          <div class="col-12">
            <label for="report-context" class="form-label"
              >System context <span class="text-secondary small">(optional)</span></label
            >
            <textarea
              id="report-context"
              v-model="context"
              class="form-control"
              rows="2"
              maxlength="6000"
              :disabled="busy"
              placeholder="Describe vehicle functions, operating conditions, interfaces, and security controls to include in the scenarios."
            ></textarea>
          </div>
        </div>
        <p v-if="!target?.reached" class="alert alert-info mt-3" role="status">
          The selected Target was not reached. Select a reached Target or rerun the simulation.
        </p>
        <p v-else-if="!paths.length" class="alert alert-warning mt-3" role="status">
          {{ pathResult.reason }}
        </p>
        <p v-if="selectedPath?.length > 201" class="alert alert-warning mt-3" role="status">
          This trace has more than 201 steps. Scenario generation is disabled to avoid omitting
          required prerequisites. Select a smaller simulation scope.
        </p>
        <div class="d-flex gap-2 flex-wrap mt-3">
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!canGenerate"
            @click="runReport('generate')"
          >
            {{ report?.draft ? 'Regenerate scenarios' : 'Generate scenarios' }}
          </button>
          <button
            type="button"
            class="btn btn-outline-secondary"
            :disabled="!canGenerate"
            @click="runReport('generate', true)"
          >
            Preview generation prompt
          </button>
          <button
            type="button"
            class="btn btn-outline-primary"
            :disabled="!canVerify"
            @click="runReport('verify')"
          >
            {{ verification ? 'Verify again' : 'Verify scenarios' }}
          </button>
          <button
            type="button"
            class="btn btn-outline-secondary"
            :disabled="!canVerify"
            @click="runReport('verify', true)"
          >
            Preview verification prompt
          </button>
          <button
            v-if="busy"
            type="button"
            class="btn btn-outline-secondary"
            @click="cancelRequest"
          >
            Cancel
          </button>
        </div>
        <p v-if="phase" class="small mt-3" role="status" aria-live="polite">
          {{ phase }}
        </p>
        <p v-if="error" class="alert alert-danger mt-3" role="alert">{{ error }}</p>
        <section v-if="liveResponse" class="mt-3" aria-label="Live LLM response">
          <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
            <h3 class="h6 mb-0">
              {{ liveResponse.action === 'verify' ? 'Verification' : 'Generation' }} response
            </h3>
            <label class="form-check-label small ms-auto">
              <input v-model="followResponse" class="form-check-input me-1" type="checkbox" />
              Follow output
            </label>
          </div>
          <p class="small mb-2" role="status" aria-live="polite">
            {{ responseStatus }} · {{ elapsedSeconds }} s ·
            {{ liveResponse.text.length }} characters
            <span v-if="secondsSinceText !== null"> · last text {{ secondsSinceText }} s ago</span>
          </p>
          <p
            v-if="busy && !liveResponse.finishedAt && secondsSinceSignal !== null"
            class="small text-secondary"
          >
            Last server signal: {{ secondsSinceSignal }} s ago
          </p>
          <pre
            ref="responseOutput"
            class="prompt-content border rounded p-2"
            tabindex="0"
            aria-label="Raw LLM response"
            >{{
              liveResponse.text ||
              (liveResponse.finishedAt
                ? 'No response text received.'
                : 'Waiting for response text…')
            }}</pre>
          <p class="small text-secondary">
            Output appears as it arrives. The report is saved after the complete response is
            validated.
          </p>
        </section>
        <section v-if="promptPreview" class="mt-3" aria-label="LLM prompt preview">
          <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
            <h3 class="h6 mb-0">
              {{ promptPreview.action === 'verify' ? 'Verification' : 'Generation' }} prompt preview
            </h3>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary ms-auto"
              @click="exportPrompt"
            >
              Download prompt JSON
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              @click="promptPreview = null"
            >
              Close preview
            </button>
          </div>
          <p class="small text-secondary">
            Model: {{ promptPreview.request.model || 'Not configured' }}. Previewing does not call
            the LLM. Use Generate scenarios or Verify scenarios when ready.
          </p>
          <div v-for="message in promptPreview.request.input" :key="message.role" class="mb-3">
            <h4 class="h6">{{ message.role === 'system' ? 'System' : 'User' }} prompt</h4>
            <pre
              class="prompt-content border rounded p-2"
              tabindex="0"
              :aria-label="`${message.role} prompt`"
              >{{ message.content }}</pre>
          </div>
          <details>
            <summary>Full request JSON, including output schema</summary>
            <pre class="prompt-content border rounded p-2 mt-2" tabindex="0">{{ promptJson }}</pre>
          </details>
        </section>
        <article v-if="scenario" class="mt-4">
          <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
            <h3 class="h6 mb-0">Scenario report</h3>
            <span
              class="badge"
              :class="
                verification?.Overall_Verdict === 'REJECT' ? 'text-bg-danger' : 'text-bg-warning'
              "
              >{{
                verification
                  ? `LLM review · ${verification.Overall_Verdict}`
                  : 'Draft · not verified'
              }}</span
            >
          </div>
          <p class="small text-secondary text-break">
            {{ scenario.Entry_Asset }} → {{ scenario.Target_Asset }} ·
            {{ (report.verified || report.draft).model }}
          </p>
          <ScenarioEvidenceView :scenario="scenario" :verification="verification" />
          <p class="small text-secondary mt-3">
            {{
              verification
                ? 'These scenarios were generated and reviewed by an LLM.'
                : 'These scenarios were generated by an LLM and have not been verified.'
            }}
            Check the assumptions and required evidence against the actual system. Results remain
            available in this simulation session and can be downloaded as JSON.
          </p>
        </article>
      </section>
    </div>
  </section>
</template>

<style scoped>
.scenario-report {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}
.report-header {
  flex-shrink: 0;
}
.report-workspace {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(0, 1.6fr);
  flex: 1;
  min-height: 0;
}
.report-path-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--bs-border-color, #dee2e6);
  background: #f8f9fa;
}
.original-path {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0 8px 0 0;
  overflow-y: auto;
}
.iteration-steps {
  padding-left: 36px;
  margin-bottom: 0;
}
.path-step {
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid var(--bs-border-color, #dee2e6);
  border-radius: 6px;
  background: #fff;
  overflow-wrap: anywhere;
}
.path-step:last-child {
  margin-bottom: 0;
}
.path-step::marker {
  color: #0d6efd;
  font-weight: 600;
}
.report-main {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}
.original-path:focus-visible,
.report-main:focus-visible {
  outline: 2px solid #9ec5fe;
  outline-offset: -2px;
}
.report-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.prompt-content {
  max-height: 24rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #f8f9fa;
}
@media (max-width: 767.98px) {
  .scenario-report {
    overflow-y: auto;
  }
  .report-workspace {
    display: block;
    flex: none;
  }
  .report-path-panel {
    border-right: 0;
    border-bottom: 1px solid var(--bs-border-color, #dee2e6);
  }
  .original-path {
    flex: none;
    max-height: 55dvh;
  }
  .report-main {
    overflow: visible;
  }
}
</style>

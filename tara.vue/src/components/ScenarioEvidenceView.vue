<script setup>
defineProps({
  scenario: { type: Object, required: true },
  verification: { type: Object, default: null },
})
const title = (field) => field.replaceAll('_', ' ')
const verdictClass = (value) =>
  ({ PASS: 'text-bg-success', REJECT: 'text-bg-danger' })[value] || 'text-bg-warning'
</script>

<template>
  <div class="scenario-evidence">
    <p class="small text-secondary">
      Model outcome: {{ scenario.Model_Outcome }} · Entry vector:
      {{ scenario.Entry_Vector || 'Unknown · evidence required' }}
    </p>
    <section class="border rounded p-3 mb-3" aria-label="Original MAL backbone">
      <h4 class="h6">Original MAL backbone</h4>
      <p class="small report-text">Goal: {{ scenario.Goal_Node }}</p>
      <ol class="mb-0">
        <li v-for="step in scenario.Expanded_Steps" :key="step.Shortest_Path_Step" class="mb-2">
          <strong class="text-break">{{ step.Shortest_Path_Node }}</strong>
          <span class="badge text-bg-secondary ms-2">{{ step.Evidence_Class }}</span>
          <p class="report-text mb-1">{{ step.Expanded_Description }}</p>
          <ul v-if="step.Assumptions?.length" aria-label="Step assumptions">
            <li v-for="(item, index) in step.Assumptions" :key="index" class="report-text">
              {{ item }}
            </li>
          </ul>
        </li>
      </ol>
    </section>
    <p v-if="!scenario.Scenario_Candidates?.length" class="alert alert-light border" role="status">
      No scenario candidates are supported by the available context. Review the missing evidence
      below and add vehicle-function context before regenerating.
    </p>
    <section
      v-for="candidate in scenario.Scenario_Candidates"
      :key="candidate.Scenario_ID"
      class="border rounded p-3 mb-3"
      :aria-label="`Scenario candidate ${candidate.Scenario_ID}`"
    >
      <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
        <h4 class="h6 mb-0">{{ candidate.Scenario_ID }}</h4>
        <span class="badge text-bg-secondary">{{ candidate.CIA_Attribute }}</span>
        <span class="badge text-bg-secondary">{{ candidate.Support_Level }}</span>
      </div>
      <dl>
        <dt>Target asset / function</dt>
        <dd>{{ candidate.Target_Asset }} / {{ candidate.Target_Function || 'Unknown' }}</dd>
        <template
          v-for="field in [
            'Damage_Scenario',
            'Threat_Scenario',
            'Cause_Of_Compromise',
            'Post_Goal_Action',
            'Causal_Link',
          ]"
          :key="field"
        >
          <dt>{{ title(field) }}</dt>
          <dd class="report-text">{{ candidate[field] || 'Undetermined · evidence required' }}</dd>
        </template>
        <dt>Affected road users</dt>
        <dd>{{ candidate.Affected_Road_Users?.join(', ') || 'Undetermined' }}</dd>
        <dt>Impact categories</dt>
        <dd>{{ candidate.Impact_Categories?.join(', ') || 'Undetermined' }}</dd>
      </dl>
      <template
        v-for="field in ['Evidence_References', 'Assumptions', 'Missing_Evidence']"
        :key="field"
      >
        <template v-if="candidate[field]?.length">
          <h5 class="small fw-semibold">{{ title(field) }}</h5>
          <ul>
            <li v-for="(item, index) in candidate[field]" :key="index" class="report-text">
              {{ item }}
            </li>
          </ul>
        </template>
      </template>
    </section>
    <template v-for="field in ['Model_Limitations', 'Need_Additional_Context']" :key="field">
      <section v-if="scenario[field]?.length" class="mb-3">
        <h4 class="h6">{{ title(field) }}</h4>
        <ul>
          <li v-for="(item, index) in scenario[field]" :key="index" class="report-text">
            {{ item }}
          </li>
        </ul>
      </section>
    </template>
    <section v-if="verification" class="border rounded p-3 mb-3" aria-label="Scenario verification">
      <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
        <h4 class="h6 mb-0">LLM review</h4>
        <span class="badge" :class="verdictClass(verification.Overall_Verdict)">{{
          verification.Overall_Verdict
        }}</span>
      </div>
      <p>Path structure: {{ verification.Path_Structure_Valid ? 'Valid' : 'Invalid' }}</p>
      <details v-for="check in verification.Checks" :key="check.Check" class="mb-2">
        <summary>{{ title(check.Check) }} · {{ check.Status }}</summary>
        <p class="report-text mb-1">{{ check.Note }}</p>
        <ul v-if="check.Evidence_References?.length">
          <li v-for="(item, index) in check.Evidence_References" :key="index" class="report-text">
            {{ item }}
          </li>
        </ul>
      </details>
      <div
        v-for="review in verification.Candidate_Verifications"
        :key="review.Scenario_ID"
        class="border-top pt-2 mt-3"
      >
        <h5 class="h6">{{ review.Scenario_ID }} · {{ review.Verdict }}</h5>
        <p class="report-text">{{ review.Reason }}</p>
        <template
          v-for="field in ['Unsupported_Claims', 'Required_Evidence', 'Proposed_Changes']"
          :key="field"
        >
          <template v-if="review[field]?.length">
            <h6 class="small fw-semibold">{{ title(field) }}</h6>
            <ul>
              <li v-for="(item, index) in review[field]" :key="index" class="report-text">
                {{ item }}
              </li>
            </ul>
          </template>
        </template>
      </div>
      <template v-if="verification.Model_Gaps?.length">
        <h5 class="h6 mt-3">Model gaps</h5>
        <ul class="mb-0">
          <li v-for="(item, index) in verification.Model_Gaps" :key="index" class="report-text">
            {{ item }}
          </li>
        </ul>
      </template>
    </section>
  </div>
</template>

<style scoped>
.report-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>

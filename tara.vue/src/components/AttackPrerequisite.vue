<script setup>
defineProps({ item: { type: Object, required: true }, depth: { type: Number, default: 0 } })
defineEmits(['inspect'])
</script>

<template>
  <li class="prerequisite">
    <div class="d-flex flex-wrap align-items-baseline gap-1">
      <span class="badge" :class="item.node.type === 'and' ? 'text-bg-warning' : 'text-bg-light'">
        {{ item.node.type.toUpperCase() }}
      </span>
      <button type="button" class="step-link" @click="$emit('inspect', item.node.cellId)">
        {{ item.node.fullName }}
      </button>
      <span
        v-if="item.feasibility"
        class="small"
        :class="
          item.feasibility === 'infeasible'
            ? 'text-danger'
            : item.feasibility === 'unresolved'
              ? 'text-warning-emphasis'
              : 'text-secondary'
        "
        >{{ item.feasibility }}</span
      >
      <span v-if="item.terminal === 'earlier'" class="small text-secondary"
        >Earlier on the selected route (before the AND step)</span
      >
      <span v-else-if="item.terminal === 'entry'" class="small text-primary">Selected Entry</span>
      <span v-else-if="item.terminal === 'condition'" class="small text-secondary">
        {{
          item.conditionStatus === true
            ? 'Condition satisfied'
            : item.conditionStatus === false
              ? 'Condition blocks this input'
              : 'Condition state unknown'
        }}
      </span>
      <span v-else-if="item.terminal === 'external'" class="small text-warning-emphasis"
        >Unreachable non-Entry leaf</span
      >
      <span v-else-if="item.terminal === 'cycle'" class="small text-secondary">Repeated step</span>
    </div>
    <details v-if="item.children.length || item.omitted" :open="depth < 2">
      <summary class="small text-secondary">
        {{ item.node.type === 'and' ? 'AND — all prerequisites' : 'OR — perform one alternative' }}
      </summary>
      <ul v-if="item.children.length" class="prerequisite-list">
        <AttackPrerequisite
          v-for="(child, index) in item.children"
          :key="index"
          :item="child"
          :depth="depth + 1"
          @inspect="$emit('inspect', $event)"
        />
      </ul>
      <p v-if="item.omitted" class="small text-warning-emphasis mb-1">
        {{ item.omitted }} prerequisite branches omitted by the display limit.
      </p>
    </details>
  </li>
</template>

<style scoped>
.prerequisite {
  margin: 0.4rem 0;
  overflow-wrap: anywhere;
}
.prerequisite-list {
  padding-left: 1rem;
  border-left: 2px solid #dee2e6;
  list-style: none;
}
.step-link {
  border: 0;
  background: none;
  color: #084298;
  padding: 0;
  text-align: left;
  overflow-wrap: anywhere;
}
.step-link:hover {
  text-decoration: underline;
}
</style>

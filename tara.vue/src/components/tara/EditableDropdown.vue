<template>
  <div class="editable-dropdown">
    <select
      class="form-select form-select-sm"
      :value="modelValue"
      @change="$emit('update:modelValue', $event.target.value)"
    >
      <option value="" disabled>-- Select --</option>
      <option
        v-for="opt in options"
        :key="opt"
        :value="opt"
      >
        {{ opt }}
      </option>
    </select>
  </div>
</template>

<script setup>
defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  options: {
    type: Array,
    required: true
  }
});

defineEmits(['update:modelValue']);
</script>

<style scoped>
.editable-dropdown .form-select {
  min-width: 120px;
  font-size: 0.85rem;
}
</style>

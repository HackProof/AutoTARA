<template>
    <div class="toolbar-container bg-light border-bottom p-2 d-flex align-items-center gap-2 rounded-top">
        <div class="toolbar-section">
            <GraphButtons />
        </div>
        <div class="toolbar-section toolbar-section-right">
            <SimulateButtons />
        </div>
    </div>
</template>

<script setup>
import GraphButtons from '@/components/GraphButtons.vue';
import SimulateButtons from '@/components/SimulateButtons.vue';

</script>

<style scoped>
.toolbar-container {
    min-height: 48px;
}

.toolbar-section {
    display: flex;
    align-items: center;
}

.toolbar-section-right {
    margin-left: auto;
}
</style>

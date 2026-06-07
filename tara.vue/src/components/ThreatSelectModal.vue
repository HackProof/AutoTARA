<template>
  <div v-if="show" class="modal-backdrop" @click.self="cancel">
    <div class="threat-select-modal">
      <div class="modal-header">
        <h5 class="modal-title">
          <i :class="mode === 'entry' ? 'fa-solid fa-arrow-right-to-bracket' : 'fa-solid fa-flag'" class="me-2"></i>
          Select {{ mode === 'entry' ? 'Entry' : 'Target' }} Threat
        </h5>
        <button type="button" class="btn-close" @click="cancel"></button>
      </div>
      
      <div class="modal-body">
        <div class="node-info mb-3">
          <strong>Node:</strong> {{ nodeName }}
          <span class="text-muted ms-2">({{ nodeType }})</span>
        </div>
        
        <div v-if="threats.length === 0" class="alert alert-warning">
          <i class="fa-solid fa-exclamation-triangle me-2"></i>
          This node has no open threats.
        </div>
        
        <div v-else class="threat-list">
          <div 
            v-for="threat in threats" 
            :key="threat.id"
            class="threat-item"
            :class="{ 'selected': selectedThreat?.id === threat.id }"
            @click="selectThreat(threat)"
          >
            <div class="threat-header">
              <span class="threat-number">#{{ threat.number }}</span>
              <span class="threat-technique">{{ threat.attackStep || threat.technique }}</span>
              <span v-if="threat.ttc > 0" class="threat-ttc">
                <i class="fa-solid fa-clock me-1"></i>{{ threat.ttc }}
              </span>
            </div>
            <div v-if="threat.description" class="threat-description">
              {{ threat.description }}
            </div>
          </div>
        </div>
      </div>
      
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" @click="cancel">Cancel</button>
        <button 
          type="button" 
          class="btn btn-primary" 
          :disabled="!selectedThreat"
          @click="confirm"
        >
          <i :class="mode === 'entry' ? 'fa-solid fa-arrow-right-to-bracket' : 'fa-solid fa-flag'" class="me-1"></i>
          Set as {{ mode === 'entry' ? 'Entry' : 'Target' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  mode: {
    type: String,
    default: 'entry', // 'entry' or 'target'
    validator: (value) => ['entry', 'target'].includes(value)
  },
  nodeId: {
    type: String,
    default: ''
  },
  nodeName: {
    type: String,
    default: ''
  },
  nodeType: {
    type: String,
    default: ''
  },
  threats: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['confirm', 'cancel']);

const selectedThreat = ref(null);

// 모달이 열릴 때 선택 초기화
watch(() => props.show, (newVal) => {
  if (newVal) {
    selectedThreat.value = null;
    // 첫 번째 위협을 기본 선택
    if (props.threats.length > 0) {
      selectedThreat.value = props.threats[0];
    }
  }
});

const selectThreat = (threat) => {
  selectedThreat.value = threat;
};

const confirm = () => {
  if (selectedThreat.value) {
    emit('confirm', {
      nodeId: props.nodeId,
      nodeName: props.nodeName,
      threatId: selectedThreat.value.id,
      attackStep: selectedThreat.value.attackStep || selectedThreat.value.technique,
      technique: selectedThreat.value.technique,
      ttc: selectedThreat.value.ttc
    });
  }
};

const cancel = () => {
  emit('cancel');
};
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1050;
}

.threat-select-modal {
  background: white;
  border-radius: 8px;
  width: 500px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e9ecef;
}

.modal-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  padding: 16px 20px;
  border-top: 1px solid #e9ecef;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.node-info {
  padding: 10px 12px;
  background: #f8f9fa;
  border-radius: 6px;
  font-size: 0.95rem;
}

.threat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.threat-item {
  padding: 12px;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.threat-item:hover {
  background: #f8f9fa;
  border-color: #adb5bd;
}

.threat-item.selected {
  background: #e7f1ff;
  border-color: #0d6efd;
}

.threat-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.threat-number {
  font-size: 0.8rem;
  color: #6c757d;
  font-weight: 500;
}

.threat-technique {
  font-weight: 600;
  flex: 1;
}

.threat-ttc {
  font-size: 0.85rem;
  color: #6c757d;
  background: #f8f9fa;
  padding: 2px 8px;
  border-radius: 4px;
}

.threat-description {
  margin-top: 8px;
  font-size: 0.85rem;
  color: #6c757d;
  line-height: 1.4;
}
</style>

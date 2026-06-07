import { defineStore } from 'pinia';
import { markRaw } from 'vue';

export const useCellStore = defineStore('cell', {
    state: () => ({
        ref: null,    // 선택된 Cell 객체 (AntV X6 객체)
        threats: []   // 해당 Cell에 연결된 위협 목록
    }),
    getters: {
        hasSelected: (state) => !!state.ref,
    },
    actions: {
        select(cellRef) {
            this.ref = cellRef;

            if (this.ref && this.ref.data && this.ref.data.threats) {
                this.threats = this.ref.data.threats.map((threat) => ({ ...threat }))
            } else {
                this.threats = [];
            }
        },

        unselect() {
            this.ref = null;
            this.threats = [];
            console.debug('Cell unselected');
        },

        updateData(data, where='none') {
            if (!this.ref || typeof this.ref.setData !== 'function') return;

            this.ref.setData(data);

            if (data.threats) {
                this.threats = [...data.threats];
            }
        }
    }
});
import { defineStore } from 'pinia';

export const useThreatModel = defineStore('threatModel', {
    state: () => ({
        all: [],
        data: {},   // 위협 모델 데이터(json)
        fileName: '',   // 파일 이름
        stash: '',  // raw JSON 문자열
        modified: false,
        modifiedDiagram: {},
        selectedDiagram: {}
    }),
    getters: {
        modelChanged: (state) => {
            return state.modified;
        }
    },
    actions: {
        threatModelClear() {
            this.all = [];
            this.data = {};
            this.fileName = '';
            this.stash = '';
            this.modified = false;
            this.modifiedDiagram = {};
            this.selectedDiagram = {};
        }
    }
});
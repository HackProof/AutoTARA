import { defineStore } from 'pinia'

export const useThreatEditStore = defineStore('threatedit', {
    state: () => ({
        assetName: null,
        threatData: null,
        state: null,
        isReady: false
    }),

    actions: {
        startEditing(name, threat, state) {
            this.assetName = name;
            this.threatData = threat;
            this.state = state;
            this.isReady = true;
        },

        clearData() {
            this.assetName = null;
            this.threatData = null;
            this.state = null;
            this.isReady = false;
        },

        getThreatData() {
            return this.threatData;
        }
    }
})
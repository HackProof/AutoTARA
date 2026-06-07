import { defineStore } from 'pinia';
import {
    analyzeThreat,
    getAllAssessments,
    updateAssessment as apiUpdateAssessment,
    deleteAssessmentAttackPath as apiDeleteAssessmentAttackPath,
    deleteAssessment as apiDeleteAssessment,
    deleteAssessmentsBySessionId as apiDeleteAssessmentsBySessionId
} from '@/service/tara/taraAssessmentService.js';

export const useTaraAssessmentStore = defineStore('taraAssessment', {
    state: () => ({
        assessments: [],
        currentAssessment: null,
        isLoading: false,
        error: null
    }),

    actions: {
        async loadAllAssessments(sessionId) {
            this.isLoading = true;
            this.error = null;
            try {
                this.assessments = await getAllAssessments(sessionId);
            } catch (err) {
                this.error = err.message || 'Failed to load assessments';
            } finally {
                this.isLoading = false;
            }
        },

        async analyzeFromSimulation(sessionId, simulationResult) {
            this.isLoading = true;
            this.error = null;
            try {
                const newAssessments = await analyzeThreat(sessionId, simulationResult);
                this.assessments.unshift(...newAssessments);
                return newAssessments;
            } catch (err) {
                this.error = err.message || 'Failed to analyze threats';
                throw err;
            } finally {
                this.isLoading = false;
            }
        },

        async updateAssessment(id, data) {
            this.error = null;
            try {
                const updated = await apiUpdateAssessment(id, data);
                const idx = this.assessments.findIndex(a => a.id === id);
                if (idx !== -1) {
                    this.assessments[idx] = updated;
                }
                return updated;
            } catch (err) {
                this.error = err.message || 'Failed to update assessment';
                throw err;
            }
        },

        async deleteAssessment(id) {
            this.error = null;
            try {
                await apiDeleteAssessment(id);
            } catch (err) {
                this.error = err.message || 'Failed to delete assessment';
                throw err;
            }
            this.assessments = this.assessments.filter(a => a.id !== id);
        },

        async deleteAssessmentAttackPath(id, pathKey) {
            this.error = null;
            try {
                const result = await apiDeleteAssessmentAttackPath(id, pathKey);
                if (result.action === 'deleted') {
                    this.assessments = this.assessments.filter(a => a.id !== id);
                } else if (result.action === 'updated') {
                    const idx = this.assessments.findIndex(a => a.id === id);
                    if (idx !== -1) {
                        this.assessments[idx] = result.assessment;
                    }
                }
                return result;
            } catch (err) {
                this.error = err.message || 'Failed to delete attack path';
                throw err;
            }
        },

        async deleteSessionAssessments(sessionId) {
            this.error = null;
            try {
                await apiDeleteAssessmentsBySessionId(sessionId);
            } catch (err) {
                this.error = err.message || 'Failed to delete assessments for session';
                throw err;
            }
            this.assessments = this.assessments.filter(a => a.session_id !== sessionId);
        }
    }
});

/**
 * TARA Assessment API Service
 *
 * TARA 평가 결과 CRUD 및 LLM 분석 API 호출
 */

import axios from 'axios';

const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL,
    timeout: 120000, // LLM 분석이 오래 걸릴 수 있으므로 120초
});

/**
 * 시뮬레이션 결과를 LLM으로 분석하여 TARA 평가를 생성
 * @param {string} sessionId - 세션 ID
 * @param {Object} simulationResult - 시뮬레이션 결과
 * @returns {Promise<Array>} 생성된 assessment 배열
 */
export async function analyzeThreat(sessionId, simulationResult) {
    const response = await apiClient.post('/v1/tara/analyze', {
        sessionId,
        simulationResult
    });

    if (response.data.success) {
        return response.data.data;
    }
    throw new Error(response.data.message || 'Analysis failed');
}

/**
 * 전체 평가 결과 조회
 * @param {string} [sessionId] - 세션 ID (선택)
 * @returns {Promise<Array>}
 */
export async function getAllAssessments(sessionId) {
    const params = sessionId ? { sessionId } : {};
    const response = await apiClient.get('/v1/tara/assessments', { params });

    if (response.data.success) {
        return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to get assessments');
}

/**
 * 평가 결과 수정 (사용자 입력 필드만)
 * @param {number} id - Assessment ID
 * @param {Object} data - { attack_feasibility, impact_rating, risk_treatment, cal_rating }
 * @returns {Promise<Object>}
 */
export async function updateAssessment(id, data) {
    const response = await apiClient.put(`/v1/tara/assessments/${id}`, data);

    if (response.data.success) {
        return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to update assessment');
}

/**
 * 평가 결과 삭제
 * @param {number} id - Assessment ID
 * @returns {Promise<void>}
 */
export async function deleteAssessment(id) {
    const response = await apiClient.delete(`/v1/tara/assessments/${id}`);

    if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to delete assessment');
    }
}

/**
 * assessment 내부의 특정 attack path 삭제
 * @param {number|string} id - Assessment ID
 * @param {string} pathKey - Attack path key
 * @returns {Promise<{ action: 'updated' | 'deleted', assessment: Object }>}
 */
export async function deleteAssessmentAttackPath(id, pathKey) {
    const encodedPathKey = encodeURIComponent(pathKey);
    const response = await apiClient.delete(`/v1/tara/assessments/${id}/attack-path/${encodedPathKey}`);

    if (response.data.success) {
        return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to delete attack path');
}

/**
 * 세션에 속한 평가 결과 전체 삭제
 * @param {string} sessionId - 세션 ID
 * @returns {Promise<{ sessionId: string, deletedCount: number }>}
 */
export async function deleteAssessmentsBySessionId(sessionId) {
    const response = await apiClient.delete(`/v1/tara/assessments/session/${sessionId}`);

    if (response.data.success) {
        return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to delete assessments by session');
}

export default {
    analyzeThreat,
    getAllAssessments,
    updateAssessment,
    deleteAssessmentAttackPath,
    deleteAssessment,
    deleteAssessmentsBySessionId
};

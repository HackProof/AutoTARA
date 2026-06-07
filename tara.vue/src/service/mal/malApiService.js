/**
 * MAL API Service
 * 
 * MAL 모델을 DFD로 변환하기 위한 API 서비스
 */

import axios from 'axios';

// MAL 전용 axios 인스턴스 생성 (multipart/form-data 지원)
const malApiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL,
    timeout: 60000, // MAR 파일 파싱이 오래 걸릴 수 있으므로 60초로 설정
});

/**
 * 파일 업로드로 MAL 모델을 DFD로 변환
 * @param {File} modelFile - MAL 모델 JSON 파일
 * @param {File} marFile - MAR 파일 (.mar)
 * @returns {Promise<Object>} DFD JSON 객체
 */
export async function convertMalToDfd(modelFile, marFile) {
    const formData = new FormData();
    formData.append('model', modelFile);
    formData.append('mar', marFile);

    const response = await malApiClient.post('/v1/mal/convert', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });

    if (response.data.success) {
        return {
            dfd: response.data.data,
            sessionId: response.data.sessionId  // sessionId도 반환
        };
    }
    throw new Error(response.data.message || 'Conversion failed');
}

/**
 * JSON body로 MAL 모델을 DFD로 변환 (파일 대신 직접 데이터 전송)
 * @param {Object} model - MAL 모델 JSON 객체
 * @param {Object} langspec - langspec.json 객체
 * @returns {Promise<Object>} DFD JSON 객체
 */
export async function convertMalToDfdDirect(model, langspec) {
    const response = await malApiClient.post('/v1/mal/convert-direct', {
        model,
        langspec
    });

    if (response.data.success) {
        return response.data.data;
    }
    throw new Error(response.data.message || 'Conversion failed');
}

/**
 * MAR 파일에서 langspec.json 추출
 * @param {File} marFile - MAR 파일
 * @returns {Promise<Object>} langspec.json 객체
 */
export async function extractLangspec(marFile) {
    const formData = new FormData();
    formData.append('mar', marFile);

    const response = await malApiClient.post('/v1/mal/extract-langspec', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });

    if (response.data.success) {
        return response.data.data;
    }
    throw new Error(response.data.message || 'Extraction failed');
}

/**
 * Asset 타입 정보 조회
 * @param {string} assetType - Asset 타입 이름
 * @param {Object} langspec - langspec.json 객체
 * @returns {Promise<Object>} Asset 정보
 */
export async function getAssetInfo(assetType, langspec) {
    const response = await malApiClient.post(`/v1/mal/asset-info/${assetType}`, {
        langspec
    });

    if (response.data.success) {
        return response.data.data;
    }
    throw new Error(response.data.message || 'Asset info retrieval failed');
}

/**
 * MAL 모델에서 자산 목록 추출
 * @param {Object} model - MAL 모델 JSON 객체
 * @returns {Promise<Array>} 자산 목록 [{ id, name, malType, dfdShape }]
 */
export async function extractAssets(model) {
    const response = await malApiClient.post('/v1/mal/extract-assets', {
        model
    });

    if (response.data.success) {
        return response.data.data;
    }
    throw new Error(response.data.message || 'Asset extraction failed');
}

/**
 * JSON body로 MAL 모델을 DFD로 변환 (shapeMapping 적용)
 * @param {Object} model - MAL 모델 JSON 객체
 * @param {Object} langspec - langspec.json 객체
 * @param {Object} shapeMapping - 자산 ID별 DFD shape 맵핑 { assetId: 'process' | 'actor' | 'store' }
 * @returns {Promise<Object>} DFD JSON 객체
 */
export async function convertMalToDfdWithShapes(model, langspec, shapeMapping) {
    const response = await malApiClient.post('/v1/mal/convert-direct', {
        model,
        langspec,
        shapeMapping
    });

    if (response.data.success) {
        return {
            dfd: response.data.data,
            sessionId: response.data.sessionId  // sessionId도 반환
        };
    }
    throw new Error(response.data.message || 'Conversion failed');
}

/**
 * malsim 시뮬레이션 실행
 * @param {Object} model - MAL 모델 JSON 객체
 * @param {Object} langspec - langspec.json 객체
 * @param {string} entryPoint - 진입점 (예: "AssetName:attackStep")
 * @param {string} goal - 목표 (예: "AssetName:attackStep")
 * @param {Object} options - 추가 옵션 { langFileName, modelFileName, seed, ttcMode }
 * @returns {Promise<Object>} 시뮬레이션 시작 응답 (sessionId 포함)
 */
/**
 * malsim 시뮬레이션 실행
 * @param {string} entryPoint - 진입점 (예: "AssetName:attackStep")
 * @param {string} goal - 목표 (예: "AssetName:attackStep")
 * @param {File} marFile - 원본 MAR 파일
 * @param {File} modelFile - 원본 모델 JSON 파일
 * @param {Object} options - 추가 옵션 { seed, ttcMode }
 * @returns {Promise<Object>} 시뮬레이션 시작 응답 (sessionId 포함)
 */
export async function runSimulation(entryPoint, goal, marFile, modelFile, options = {}) {
    const formData = new FormData();
    formData.append('entryPoint', entryPoint);
    formData.append('goal', goal);

    if (marFile) {
        formData.append('mar', marFile);
    } else {
        throw new Error('MAR file is required');
    }

    if (modelFile) {
        formData.append('model', modelFile);
    }

    if (options.seed !== undefined) formData.append('seed', options.seed);
    if (options.ttcMode !== undefined) formData.append('ttcMode', options.ttcMode);

    const response = await malApiClient.post('/v1/simulation/shortest_path', formData);

    if (response.data.success) {
        return {
            sessionId: response.data.sessionId,
            status: response.data.data.status,
            message: response.data.message
        };
    }
    throw new Error(response.data.message || 'Simulation failed');
}

/**
 * 시뮬레이션 상태 조회
 * @param {string} sessionId - Python 서버의 세션 ID
 * @returns {Promise<Object>} 상태 정보
 */
export async function getSimulationStatus(sessionId) {
    const response = await malApiClient.get(`/v1/simulation/${sessionId}/status`);

    if (response.data.success) {
        return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to get simulation status');
}

function normalizeShortestPathResult(data) {
    const result = data?.result || {};
    const shortestPaths = result.shortest_paths || null;

    if (!shortestPaths || !shortestPaths.agents) {
        return data;
    }

    const attackPaths = {};
    let attackPathFound = false;

    Object.entries(shortestPaths.agents).forEach(([agentName, agentData]) => {
        const goals = agentData?.goals || {};
        const goalPaths = {};

        Object.entries(goals).forEach(([goalName, goalData]) => {
            const normalizedPath = Array.isArray(goalData?.full_path)
                ? goalData.full_path
                : (Array.isArray(goalData?.path) ? goalData.path : []);

            goalPaths[goalName] = normalizedPath;

            if (goalData?.path_found) {
                attackPathFound = true;
            }
        });

        attackPaths[agentName] = goalPaths;
    });

    return {
        ...data,
        result: {
            ...result,
            attack_path_found: attackPathFound,
            attack_paths: attackPaths
        }
    };
}

/**
 * 시뮬레이션 결과 조회
 * @param {string} sessionId - Python 서버의 세션 ID
 * @param {Object} options - 추가 옵션
 * @param {string} options.view - 결과 뷰 타입 (예: "shortest")
 * @returns {Promise<Object>} 결과 정보
 */
export async function getSimulationResult(sessionId, options = {}) {
    const params = {};

    if (options.view) {
        params.view = options.view;
    }

    const response = await malApiClient.get(`/v1/simulation/${sessionId}/result`, { params });

    if (response.data.success) {
        if (options.view === 'shortest') {
            return normalizeShortestPathResult(response.data.data);
        }
        return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to get simulation result');
}

/**
 * 시뮬레이션 세션 삭제
 * @param {string} sessionId - 시뮬레이션 세션 ID
 * @returns {Promise<void>}
 */
export async function deleteSimulationSession(sessionId) {
    const response = await malApiClient.delete(`/v1/simulation/session/${sessionId}`);

    if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to delete simulation session');
    }
}

export default {
    convertMalToDfd,
    convertMalToDfdDirect,
    extractLangspec,
    getAssetInfo,
    extractAssets,
    convertMalToDfdWithShapes,
    runSimulation,
    getSimulationStatus,
    getSimulationResult,
    deleteSimulationSession
};

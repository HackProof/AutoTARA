/**
 * Simulation Controller
 * 
 * malsim 시뮬레이션 API 컨트롤러
 */

const simulationService = require('../services/simulationService');

/**
 * POST /api/v1/simulation/run
 * 시뮬레이션을 실행합니다.
 * 
 * Request body (multipart/form-data):
 *   - entryPoint: 진입점 (예: "AssetName:attackStep")
 *   - goal: 목표 (예: "AssetName:attackStep")
 *   - seed: 시뮬레이션 시드값 (선택)
 *   - ttcMode: TTC 모드 (선택, 기본값: 0)
 * Request files:
 *   - mar: MAR 파일 (필수)
 *   - model: 모델 파일 (선택)
 * 
 * Response: 
 *   - success: 성공 여부
 *   - sessionId: Python 서버의 세션 ID
 *   - message: 메시지
 */
const runSimulation = async (req, res) => {
    try {
        const {
            entryPoint,
            goal,
            seed = 42,
            ttcMode = 0
        } = req.body || {};

        // 파일 확인
        const marFile = req.files && req.files['mar'] ? req.files['mar'][0] : null;
        const modelFile = req.files && req.files['model'] ? req.files['model'][0] : null;

        // 필수 파라미터 확인
        if (!marFile) {
            return res.status(400).json({
                success: false,
                message: 'MAR file is required'
            });
        }

        if (!entryPoint) {
            return res.status(400).json({
                success: false,
                message: 'entryPoint is required (format: "AssetName:attackStep")'
            });
        }

        if (!goal) {
            return res.status(400).json({
                success: false,
                message: 'goal is required (format: "AssetName:attackStep")'
            });
        }

        console.log(`[SimulationController] Running simulation: ${entryPoint} -> ${goal}`);
        console.log(`[SimulationController] MAR File: ${marFile.originalname}, Size: ${marFile.size}`);
        if (modelFile) {
            console.log(`[SimulationController] Model File: ${modelFile.originalname}, Size: ${modelFile.size}`);
        }

        // 시뮬레이션 실행 (Python 서버로 전송)
        const result = await simulationService.runSimulation({
            marFileBuffer: marFile.buffer,
            modelFileBuffer: modelFile ? modelFile.buffer : null,
            entryPoint,
            goal,
            langFileName: marFile.originalname,
            modelFileName: modelFile ? modelFile.originalname : 'model.json',
            seed,
            ttcMode
        });

        if (result.success) {
            res.json({
                success: true,
                sessionId: result.sessionId,
                message: result.message || 'Simulation started successfully',
                data: {
                    status: result.status,
                    createdAt: result.createdAt
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: result.error || 'Failed to start simulation'
            });
        }

    } catch (err) {
        console.error('[SimulationController] Error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to run simulation'
        });
    }
};

/**
 * GET /api/v1/simulation/session/:sessionId
 * 세션 정보를 조회합니다.
 */
const getSessionInfo = async (req, res) => {
    try {
        const { sessionId } = req.params;

        const files = simulationService.getUploadedFiles(sessionId);

        if (!files) {
            return res.status(404).json({
                success: false,
                message: `Session ${sessionId} not found`
            });
        }

        res.json({
            success: true,
            data: {
                sessionId,
                modelName: files.modelName,
                marName: files.marName,
                createdAt: files.createdAt
            }
        });

    } catch (err) {
        console.error('[SimulationController] Error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to get session info'
        });
    }
};

/**
 * DELETE /api/v1/simulation/session/:sessionId
 * 세션을 삭제합니다.
 */
const deleteSession = async (req, res) => {
    try {
        const { sessionId } = req.params;

        simulationService.cleanupSession(sessionId);

        res.json({
            success: true,
            message: `Session ${sessionId} deleted`
        });

    } catch (err) {
        console.error('[SimulationController] Error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to delete session'
        });
    }
};

/**
 * GET /api/v1/simulation/:sessionId/status
 * Python 서버에서 시뮬레이션 상태를 조회합니다.
 */
const getSimulationStatus = async (req, res) => {
    try {
        const { sessionId } = req.params;

        const status = await simulationService.getSimulationStatus(sessionId);

        if (status.success) {
            res.json({
                success: true,
                data: status.data
            });
        } else {
            res.status(status.statusCode || 500).json({
                success: false,
                message: status.error || 'Failed to get simulation status'
            });
        }

    } catch (err) {
        console.error('[SimulationController] Error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to get simulation status'
        });
    }
};

/**
 * GET /api/v1/simulation/:sessionId/result
 * Python 서버에서 시뮬레이션 결과를 조회합니다.
 */
const getSimulationResult = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { view } = req.query;

        const result = await simulationService.getSimulationResult(sessionId, view);

        if (result.success) {
            res.json({
                success: true,
                data: result.data
            });
        } else {
            res.status(result.statusCode || 500).json({
                success: false,
                message: result.error || 'Failed to get simulation result'
            });
        }

    } catch (err) {
        console.error('[SimulationController] Error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to get simulation result'
        });
    }
};

module.exports = {
    runSimulation,
    getSessionInfo,
    deleteSession,
    getSimulationStatus,
    getSimulationResult
};

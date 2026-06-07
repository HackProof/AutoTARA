/**
 * TARA Assessment Controller
 *
 * TARA 평가 결과 CRUD 및 LLM 분석 API
 */

const taraAssessmentService = require('../services/taraAssessmentService');

/**
 * POST /api/v1/tara/analyze
 * 시뮬레이션 결과를 LLM으로 분석하여 TARA 평가를 생성합니다.
 */
const analyzeThreats = async (req, res) => {
    try {
        const { simulationResult, sessionId } = req.body;

        if (!simulationResult) {
            return res.status(400).json({
                success: false,
                message: 'simulationResult is required'
            });
        }

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'sessionId is required'
            });
        }

        console.log(`[TaraAssessmentController] Analyzing threats for session ${sessionId}`);

        const assessments = await taraAssessmentService.analyzeThreatWithLLM(simulationResult, sessionId);

        res.json({
            success: true,
            data: assessments,
            message: `${assessments.length} assessments generated`
        });
    } catch (err) {
        console.error('[TaraAssessmentController] Analyze error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to analyze threats'
        });
    }
};

/**
 * GET /api/v1/tara/assessments
 * 전체 평가 결과를 조회합니다.
 */
const getAllAssessments = async (req, res) => {
    try {
        const { sessionId } = req.query;

        let assessments;
        if (sessionId) {
            assessments = await taraAssessmentService.getAssessmentsBySessionId(sessionId);
        } else {
            assessments = await taraAssessmentService.getAllAssessments();
        }

        res.json({
            success: true,
            data: assessments
        });
    } catch (err) {
        console.error('[TaraAssessmentController] GetAll error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to get assessments'
        });
    }
};

/**
 * GET /api/v1/tara/assessments/:id
 * 단건 조회
 */
const getAssessmentById = async (req, res) => {
    try {
        const { id } = req.params;
        const assessment = await taraAssessmentService.getAssessmentById(id);

        if (!assessment) {
            return res.status(404).json({
                success: false,
                message: `Assessment ${id} not found`
            });
        }

        res.json({
            success: true,
            data: assessment
        });
    } catch (err) {
        console.error('[TaraAssessmentController] GetById error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to get assessment'
        });
    }
};

/**
 * PUT /api/v1/tara/assessments/:id
 * 사용자 입력 필드 수정 (attack_feasibility, impact_rating, risk_treatment, cal_rating)
 */
const updateAssessment = async (req, res) => {
    try {
        const { id } = req.params;
        const { attack_feasibility, impact_rating, risk_treatment, cal_rating } = req.body;

        const updated = await taraAssessmentService.updateAssessment(id, {
            attack_feasibility,
            impact_rating,
            risk_treatment,
            cal_rating
        });

        if (!updated) {
            return res.status(404).json({
                success: false,
                message: `Assessment ${id} not found`
            });
        }

        res.json({
            success: true,
            data: updated
        });
    } catch (err) {
        console.error('[TaraAssessmentController] Update error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to update assessment'
        });
    }
};

/**
 * DELETE /api/v1/tara/assessments/:id/attack-path/:pathKey
 * assessment 내부의 특정 attack path만 삭제
 */
const deleteAttackPath = async (req, res) => {
    try {
        const { id, pathKey } = req.params;
        const result = await taraAssessmentService.deleteAttackPathFromAssessment(id, pathKey);

        if (!result) {
            return res.status(404).json({
                success: false,
                message: `Assessment ${id} not found`
            });
        }

        res.json({
            success: true,
            data: result,
            message: result.action === 'deleted'
                ? `Attack path ${pathKey} deleted and assessment ${id} removed`
                : `Attack path ${pathKey} deleted from assessment ${id}`
        });
    } catch (err) {
        console.error('[TaraAssessmentController] DeleteAttackPath error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to delete attack path'
        });
    }
};

/**
 * DELETE /api/v1/tara/assessments/:id
 * 평가 결과 삭제
 */
const deleteAssessment = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await taraAssessmentService.deleteAssessment(id);

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: `Assessment ${id} not found`
            });
        }

        res.json({
            success: true,
            message: `Assessment ${id} deleted`
        });
    } catch (err) {
        console.error('[TaraAssessmentController] Delete error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to delete assessment'
        });
    }
};

/**
 * DELETE /api/v1/tara/assessments/session/:sessionId
 * 세션에 속한 평가 결과를 모두 삭제
 */
const deleteAssessmentsBySessionId = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const deleted = await taraAssessmentService.deleteAssessmentsBySessionId(sessionId);

        res.json({
            success: true,
            data: {
                sessionId,
                deletedCount: deleted.length
            },
            message: `${deleted.length} assessments deleted for session ${sessionId}`
        });
    } catch (err) {
        console.error('[TaraAssessmentController] DeleteBySession error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to delete assessments by session'
        });
    }
};

module.exports = {
    analyzeThreats,
    getAllAssessments,
    getAssessmentById,
    updateAssessment,
    deleteAttackPath,
    deleteAssessment,
    deleteAssessmentsBySessionId
};

const express = require('express');
const router = express.Router();
const multer = require('multer');

// Multer 메모리 스토리지 설정 (파일을 메모리에 버퍼로 저장)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB 제한
    }
});

// 컨트롤러들 불러오기
const mitreController = require('../controllers/mitreController');
const taraController = require('../controllers/taraController');
const malController = require('../controllers/malController');
const simulationController = require('../controllers/simulationController');
const taraAssessmentController = require('../controllers/taraAssessmentController');

// MITRE 관련 라우트
router.get('/v1/mitre/admin/tables', mitreController.getAdminTableDefinitions);
router.post('/v1/mitre/admin/dfd-techniques/parse-mal', upload.single('mal'), mitreController.parseMalFile);
router.get('/v1/mitre/admin/:table', mitreController.listAdminTableRows);
router.post('/v1/mitre/admin/:table', mitreController.createAdminTableRow);
router.put('/v1/mitre/admin/:table', mitreController.updateAdminTableRow);
router.delete('/v1/mitre/admin/:table', mitreController.deleteAdminTableRow);
router.get('/v1/mitre/techniques', mitreController.getMitreTechniques);           // 전체 조회
router.get('/v1/mitre/countermeasures', mitreController.getMitreCountermeasures);    // 전체 CM 반환
router.get('/v1/mitre/attack-step-mapping', mitreController.getTechniqueMappingByAttackStep); // Attack Step -> MITRE 매핑
router.get('/v1/mitre/threat/:id', mitreController.searchMitreThreatsByStencil); // 위협 검색
router.get('/v1/mitre/technique/:id', mitreController.getMitreTechniqueById);// ID 상세 조회
router.get('/v1/mitre/countermeasures/:id', mitreController.getMitigationsByTechniqueId); // 완화책 조회
router.get('/v1/mitre/ttp-score-reason/:id', mitreController.getTtpScoringReasonByTechniqueId); // TTP 점수 사유 조회

// TARA 관련 라우트
router.get('/v1/asset-description/:id', taraController.getAssetDescription); // 자산 설명 조회

// MAL to DFD 변환 라우트
// POST /api/v1/mal/convert - 파일 업로드로 변환 (model.json + .mar 파일)
router.post('/v1/mal/convert',
    upload.fields([
        { name: 'model', maxCount: 1 },
        { name: 'mar', maxCount: 1 }
    ]),
    malController.convertMalToDfd
);

// POST /api/v1/mal/convert-direct - JSON body로 직접 변환
router.post('/v1/mal/convert-direct', malController.convertMalToDfdDirect);

// POST /api/v1/mal/extract-langspec - MAR 파일에서 langspec.json 추출
router.post('/v1/mal/extract-langspec',
    upload.single('mar'),
    malController.extractLangspec
);

// POST /api/v1/mal/asset-info/:assetType - asset 타입 정보 조회
router.post('/v1/mal/asset-info/:assetType', malController.getAssetInfo);

// POST /api/v1/mal/extract-assets - MAL 모델에서 자산 목록 추출
router.post('/v1/mal/extract-assets', malController.extractAssets);

// Simulation 관련 라우트
// POST /api/v1/simulation/run - 시뮬레이션 실행
router.post('/v1/simulation/shortest_path',
    upload.fields([
        { name: 'mar', maxCount: 1 },
        { name: 'model', maxCount: 1 },
        { name: 'langGraph', maxCount: 1 },
        { name: 'lang_graph_file', maxCount: 1 }
    ]),
    simulationController.runSimulation
);

// GET /api/v1/simulation/:sessionId/status - 시뮬레이션 상태 조회
router.get('/v1/simulation/:sessionId/status', simulationController.getSimulationStatus);

// GET /api/v1/simulation/:sessionId/result - 시뮬레이션 결과 조회
router.get('/v1/simulation/:sessionId/result', simulationController.getSimulationResult);
router.get('/v1/simulation/:sessionId/artifacts/:artifactName', simulationController.getSimulationArtifact);

// GET /api/v1/simulation/session/:sessionId - 세션 정보 조회
router.get('/v1/simulation/session/:sessionId', simulationController.getSessionInfo);

// DELETE /api/v1/simulation/session/:sessionId - 세션 삭제
router.delete('/v1/simulation/session/:sessionId', simulationController.deleteSession);

// TARA Assessment 관련 라우트
// POST /api/v1/tara/analyze - LLM 분석 요청
router.post('/v1/tara/analyze', taraAssessmentController.analyzeThreats);
router.post('/v1/tara/assessments', taraAssessmentController.createAttackPathAssessments);

// GET /api/v1/tara/assessments - 전체 조회 (query: sessionId)
router.get('/v1/tara/assessments', taraAssessmentController.getAllAssessments);

// GET /api/v1/tara/assessments/:id - 단건 조회
router.get('/v1/tara/assessments/:id', taraAssessmentController.getAssessmentById);

// PUT /api/v1/tara/assessments/:id - 수정 (사용자 입력 필드)
router.put('/v1/tara/assessments/:id', taraAssessmentController.updateAssessment);

// DELETE /api/v1/tara/assessments/:id/attack-path/:pathKey - attack path 단위 삭제
router.delete('/v1/tara/assessments/:id/attack-path/:pathKey', taraAssessmentController.deleteAttackPath);

// DELETE /api/v1/tara/assessments/session/:sessionId - 세션 단위 삭제
router.delete('/v1/tara/assessments/session/:sessionId', taraAssessmentController.deleteAssessmentsBySessionId);

// DELETE /api/v1/tara/assessments/:id - 삭제
router.delete('/v1/tara/assessments/:id', taraAssessmentController.deleteAssessment);

module.exports = router;

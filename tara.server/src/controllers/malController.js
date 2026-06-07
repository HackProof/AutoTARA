/**
 * MAL Controller
 * 
 * MAL 모델 파일과 MAR 파일을 업로드 받아 DFD로 변환하는 API 컨트롤러
 */

const malToDfdService = require('../services/malToDfdService');
const simulationService = require('../services/simulationService');

/**
 * POST /api/v1/mal/convert
 * MAL 모델 파일(.json)과 MAR 파일(.mar)을 업로드 받아 DFD로 변환합니다.
 * 
 * Request: multipart/form-data
 *   - model: MAL 모델 JSON 파일
 *   - mar: MAR 파일 (langspec.json 포함)
 * 
 * Response: DFD JSON 객체 + sessionId (시뮬레이션용)
 */
const convertMalToDfd = async (req, res) => {
    try {
        // 파일 확인
        if (!req.files || !req.files.model || !req.files.mar) {
            return res.status(400).json({
                success: false,
                message: 'Both model (.json) and mar (.mar) files are required'
            });
        }

        const modelFile = req.files.model[0];
        const marFile = req.files.mar[0];

        // 파일 버퍼 가져오기
        const modelBuffer = modelFile.buffer;
        const marBuffer = marFile.buffer;

        // 시뮬레이션을 위해 파일 임시 저장
        const sessionId = simulationService.saveUploadedFiles(
            modelBuffer,
            marBuffer,
            modelFile.originalname,
            marFile.originalname
        );

        // DFD로 변환
        const dfd = await malToDfdService.convertMalAndMarToDfd(modelBuffer, marBuffer);

        res.json({
            success: true,
            data: dfd,
            sessionId: sessionId  // 시뮬레이션용 세션 ID 반환
        });

    } catch (err) {
        console.error('MAL to DFD conversion error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to convert MAL model to DFD'
        });
    }
};

/**
 * POST /api/v1/mal/convert-direct
 * MAL 모델 JSON과 langspec JSON을 직접 받아 DFD로 변환합니다.
 * (파일 업로드 대신 JSON body로 전송하는 경우)
 * 
 * Request body:
 *   - model: MAL 모델 JSON 객체
 *   - langspec: langspec.json 객체
 * 
 * Response: DFD JSON 객체
 */
const convertMalToDfdDirect = async (req, res) => {
    try {
        const { model, langspec, shapeMapping } = req.body;

        if (!model) {
            return res.status(400).json({
                success: false,
                message: 'MAL model is required in request body'
            });
        }

        if (!langspec) {
            return res.status(400).json({
                success: false,
                message: 'Langspec is required in request body'
            });
        }

        // JSON 데이터를 버퍼로 변환하여 임시 저장
        const modelBuffer = Buffer.from(JSON.stringify(model));
        const langspecBuffer = Buffer.from(JSON.stringify(langspec));

        // 시뮬레이션을 위해 파일 임시 저장
        const sessionId = simulationService.saveUploadedFiles(
            modelBuffer,
            langspecBuffer,
            'model.json',
            'langspec.mar'
        );

        console.log(`[malController] Session created: ${sessionId}`);

        // DFD로 변환 (shapeMapping이 있으면 적용)
        const dfd = malToDfdService.convertMalModelToDfd(model, langspec, shapeMapping || {});

        res.json({
            success: true,
            data: dfd,
            sessionId: sessionId  // 시뮬레이션용 세션 ID 반환
        });

    } catch (err) {
        console.error('MAL to DFD conversion error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to convert MAL model to DFD'
        });
    }
};

/**
 * POST /api/v1/mal/extract-langspec
 * MAR 파일에서 langspec.json을 추출합니다.
 * 
 * Request: multipart/form-data
 *   - mar: MAR 파일
 * 
 * Response: langspec.json 객체
 */
const extractLangspec = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'MAR file is required'
            });
        }

        const marBuffer = req.file.buffer;
        const langspec = await malToDfdService.extractLangspecFromMar(marBuffer);

        res.json({
            success: true,
            data: langspec
        });

    } catch (err) {
        console.error('Langspec extraction error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to extract langspec from MAR file'
        });
    }
};

/**
 * GET /api/v1/mal/asset-info/:assetType
 * langspec에서 특정 asset 타입의 정보를 조회합니다.
 * (langspec이 세션이나 캐시에 저장되어 있어야 함 - 현재는 직접 전송 방식 사용)
 */
const getAssetInfo = async (req, res) => {
    try {
        const { assetType } = req.params;
        const { langspec } = req.body;

        if (!langspec) {
            return res.status(400).json({
                success: false,
                message: 'Langspec is required in request body'
            });
        }

        const assetInfo = malToDfdService.findAssetInLangspec(langspec, assetType);

        if (!assetInfo) {
            return res.status(404).json({
                success: false,
                message: `Asset type '${assetType}' not found in langspec`
            });
        }

        // 위협 정보 추출
        const threats = malToDfdService.extractThreatsFromAsset(assetInfo);

        res.json({
            success: true,
            data: {
                name: assetInfo.name,
                description: assetInfo.meta?.user || '',
                category: assetInfo.category,
                isAbstract: assetInfo.isAbstract,
                superAsset: assetInfo.superAsset,
                threats: threats
            }
        });

    } catch (err) {
        console.error('Asset info retrieval error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to retrieve asset info'
        });
    }
};

/**
 * POST /api/v1/mal/extract-assets
 * MAL 모델에서 자산 목록만 추출합니다.
 * (Modal에서 자산 유형 설정을 위해 사용)
 * 
 * Request body:
 *   - model: MAL 모델 JSON 객체
 * 
 * Response: 자산 목록 [{ id, name, malType, dfdShape }]
 */
const extractAssets = async (req, res) => {
    try {
        const { model } = req.body;

        if (!model) {
            return res.status(400).json({
                success: false,
                message: 'MAL model is required in request body'
            });
        }

        const assets = malToDfdService.extractAssetsFromMal(model);

        res.json({
            success: true,
            data: assets
        });

    } catch (err) {
        console.error('Asset extraction error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to extract assets from MAL model'
        });
    }
};

module.exports = {
    convertMalToDfd,
    convertMalToDfdDirect,
    extractLangspec,
    getAssetInfo,
    extractAssets
};


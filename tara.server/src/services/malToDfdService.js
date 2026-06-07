/**
 * MAL Model to DFD Converter Service
 * 
 * MAL 모델 파일(.json)과 langspec.json을 분석하여 DFD 형식으로 변환합니다.
 */
const { v4 } = require('uuid');

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

/**
 * MAR 파일에서 langspec.json을 추출합니다.
 * MAR 파일은 ZIP 형식입니다.
 * @param {Buffer} marBuffer - MAR 파일 버퍼
 * @returns {Promise<Object>} langspec.json 객체
 */
async function extractLangspecFromMar(marBuffer) {
    try {
        const zip = new AdmZip(marBuffer);
        const zipEntries = zip.getEntries();

        // langspec.json 파일 찾기
        for (const entry of zipEntries) {
            if (entry.entryName === 'langspec.json' || entry.entryName.endsWith('/langspec.json')) {
                const content = entry.getData().toString('utf8');
                return JSON.parse(content);
            }
        }

        throw new Error('langspec.json not found in MAR file');
    } catch (error) {
        if (error.message.includes('langspec.json not found')) {
            throw error;
        }
        throw new Error(`Failed to extract MAR file: ${error.message}`);
    }
}

/**
 * langspec에서 asset 정보를 조회합니다.
 * @param {Object} langspec - langspec.json 객체
 * @param {string} assetType - asset 타입 이름
 * @returns {Object|null} asset 정보
 */
function findAssetInLangspec(langspec, assetType) {
    if (!langspec || !langspec.assets) return null;
    return langspec.assets.find(asset => asset.name === assetType);
}

/**
 * Asset의 공격 단계(attackSteps)를 위협 형식으로 변환합니다.
 * 상속 관계(superAsset)를 고려하여 부모 자산의 위협도 포함합니다.
 * @param {Object} assetInfo - langspec의 asset 정보
 * @param {Object} langspec - langspec.json 객체 (superAsset 조회용)
 * @returns {Array} 위협 배열
 */
function extractThreatsFromAsset(assetInfo, langspec) {
    if (!assetInfo) return [];

    // 위협을 이름(technique)을 키로 하는 Map으로 관리 (override 처리용)
    const threatMap = new Map();

    /**
     * 재귀적으로 부모 자산의 위협을 수집합니다.
     * @param {Object} currentAsset - 현재 처리 중인 asset 정보
     */
    function collectThreatsRecursively(currentAsset) {
        if (!currentAsset) return;

        // 부모 자산이 있으면 먼저 처리 (부모의 위협을 먼저 추가)
        if (currentAsset.superAsset && langspec) {
            const parentAsset = findAssetInLangspec(langspec, currentAsset.superAsset);
            collectThreatsRecursively(parentAsset);
        }

        // 현재 자산의 attackSteps 처리
        if (currentAsset.attackSteps) {
            for (const step of currentAsset.attackSteps) {
                // defense 타입은 제외
                if (step.type === 'defense') continue;

                // meta.user에서 설명 가져오기
                const description = step.meta?.user || step.meta?.developer || '';

                // ttc 값 추출: ttc.name이 "Exponential"이면 arguments[0] 값에 100을 곱함
                let ttcValue = 0;
                if (step.ttc?.type === 'function' && step.ttc?.name === 'Exponential') {
                const rate = Number(step.ttc.arguments?.[0]);

                if (Number.isFinite(rate) && rate > 0) {
                    ttcValue = 1 / rate;
                }
                }

                // 동일한 이름의 위협이 있으면 override (자식의 것으로 교체)
                threatMap.set(step.name, {
                    attackStep: step.name,
                    mitre_id: '',
                    mitre_name: '',
                    technique: step.name,
                    status: 'open',
                    description: description,
                    riskScore: '3.3',
                    new: false,
                    ttc: ttcValue,
                    ttp_score: {},
                    cve: [],
                    selectedCMs: [],
                    source: currentAsset.name // 디버깅용: 어느 자산에서 온 위협인지
                });
            }
        }
    }

    // 재귀적으로 위협 수집
    collectThreatsRecursively(assetInfo);

    // Map을 배열로 변환하고 순차 번호 부여
    const threats = [];
    let number = 1;

    for (const [, threat] of threatMap) {
        threats.push({
            id: v4(),
            ...threat,
            number: number
        });
        number++;
    }

    return threats;
}

/**
 * langspec에서 필드 이름으로 Association 정보를 찾습니다.
 * @param {Object} langspec - langspec.json 객체
 * @param {string} fieldName - associated_assets의 필드 이름 (예: "networkECUs", "vehiclenetworks")
 * @returns {Object|null} { name, leftAsset, rightAsset, leftField, rightField, description }
 */
function findAssociationByField(langspec, fieldName) {
    if (!langspec?.associations) return null;

    for (const assoc of langspec.associations) {
        if (assoc.leftField === fieldName || assoc.rightField === fieldName) {
            return {
                name: assoc.name,
                leftAsset: assoc.leftAsset,
                rightAsset: assoc.rightAsset,
                leftField: assoc.leftField,
                rightField: assoc.rightField,
                description: assoc.meta?.user || `${assoc.name}: ${assoc.leftAsset} <-> ${assoc.rightAsset}`
            };
        }
    }
    return null;
}

/**
 * DFD shape에 따른 기본 사이즈 반환 (x6/shapes 스타일 기준)
 * @param {string} shape - DFD shape 이름
 * @returns {Object} width, height 객체
 */
function getSizeForShape(shape) {
    const sizeMapping = {
        'actor': { width: 120, height: 64 },
        'process': { width: 60, height: 60 },
        'store': { width: 120, height: 60 },
        'default': { width: 60, height: 60 }
    };
    return sizeMapping[shape] || sizeMapping['default'];
}

/**
 * DFD 노드의 기본 포트 설정 생성
 * @returns {Object} ports 객체
 */
function createDefaultPorts() {
    return {
        groups: {
            top: {
                position: 'top',
                attrs: {
                    circle: {
                        r: 4,
                        magnet: true,
                        stroke: '#5F95FF',
                        strokeWidth: 1,
                        fill: '#fff',
                        style: { visibility: 'hidden' }
                    }
                }
            },
            right: {
                position: 'right',
                attrs: {
                    circle: {
                        r: 4,
                        magnet: true,
                        stroke: '#5F95FF',
                        strokeWidth: 1,
                        fill: '#fff',
                        style: { visibility: 'hidden' }
                    }
                }
            },
            bottom: {
                position: 'bottom',
                attrs: {
                    circle: {
                        r: 4,
                        magnet: true,
                        stroke: '#5F95FF',
                        strokeWidth: 1,
                        fill: '#fff',
                        style: { visibility: 'hidden' }
                    }
                }
            },
            left: {
                position: 'left',
                attrs: {
                    circle: {
                        r: 4,
                        magnet: true,
                        stroke: '#5F95FF',
                        strokeWidth: 1,
                        fill: '#fff',
                        style: { visibility: 'hidden' }
                    }
                }
            }
        },
        items: [
            { group: 'top', id: v4() },
            { group: 'right', id: v4() },
            { group: 'bottom', id: v4() },
            { group: 'left', id: v4() }
        ]
    };
}

/**
 * Grid 레이아웃으로 위치 계산
 * @param {number} index - 노드 인덱스
 * @param {number} columns - 열 개수
 * @returns {Object} x, y 좌표
 */
function calculateGridPosition(index, columns = 4) {
    const cellWidth = 220;   // 셀 너비 (간격 포함)
    const cellHeight = 180;  // 셀 높이 (간격 포함)
    const startX = 120;      // 시작 X 좌표 (왼쪽 여백)
    const startY = 80;      // 시작 Y 좌표 (위쪽 여백)

    const row = Math.floor(index / columns);
    const col = index % columns;

    return {
        x: startX + col * cellWidth,
        y: startY + row * cellHeight
    };
}

/**
 * MAL 모델과 langspec을 DFD 형식으로 변환합니다.
 * @param {Object} malModel - MAL 모델 JSON 객체
 * @param {Object} langspec - langspec.json 객체
 * @param {Object} shapeMapping - 자산 ID별 DFD shape 맵핑 (선택적) { assetId: 'process' | 'actor' | 'store' }
 * @returns {Object} DFD 형식의 JSON 객체
 */
function convertMalToDfd(malModel, langspec, shapeMapping = {}) {
    const cells = [];
    const assetIdToCellId = {}; // MAL asset ID -> DFD cell ID 매핑
    let nodeIndex = 0;

    // 1. 모델 메타데이터 생성
    const dfd = {
        version: '1.0.0',
        modelInfo: {
            title: malModel.metadata?.name || 'MAL Model',
            owner: 'user',
            template: 'new',
            organization: '',
            description: `Converted from MAL model. Lang ID: ${malModel.metadata?.langID || 'unknown'}, Version: ${malModel.metadata?.langVersion || 'unknown'}`
        },
        diagrams: {
            cells: []
        }
    };

    // 2. Assets를 DFD 노드로 변환 (Dataflow 및 보조 타입 제외)
    if (malModel.assets) {
        for (const [assetId, asset] of Object.entries(malModel.assets)) {
            const assetType = asset.type;
            const assetName = asset.name;
            // shapeMapping이 있으면 사용, 없으면 기본값 'process'
            const shape = shapeMapping[assetId] || 'process';
            const size = getSizeForShape(shape);
            const position = calculateGridPosition(nodeIndex);
            const cellId = v4();

            assetIdToCellId[assetId] = cellId;

            // langspec에서 해당 asset 타입의 정보 조회
            const langAssetInfo = findAssetInLangspec(langspec, assetType);

            // 설명 생성: langspec의 meta.user 값 사용
            const description = langAssetInfo?.meta?.user || `${assetType} asset`;

            // 위협 추출 (상속 관계를 고려하여 부모 자산의 위협도 포함)
            const threats = extractThreatsFromAsset(langAssetInfo, langspec);

            // DFD 노드 생성
            const node = {
                position: position,
                size: size,
                attrs: {
                    body: {
                        "fill": "#FFFFFF",
                        "stroke": "#333333",
                        "strokeWidth": 1.5,
                        "strokeDasharray": null
                    },
                    label: {
                        text: assetName
                    }
                },
                visible: true,
                shape: shape,
                zIndex: nodeIndex + 1,
                ports: createDefaultPorts(),
                id: cellId,
                data: {
                    name: assetName,
                    description: description,
                    type: `tm.${shape.charAt(0).toUpperCase() + shape.slice(1)}`,
                    isTrustBoundary: false,
                    isEntry: false,
                    isTarget: false,
                    outOfScope: false,
                    reasonOutOfScope: '',
                    hasOpenThreats: threats.length > 0,
                    threats: threats,
                    // MAL 원본 정보 보존
                    malInfo: {
                        assetId: assetId,
                        assetType: assetType,
                        defenses: asset.defenses || {}
                    }
                },
                tools: {
                    items: []
                }
            };

            cells.push(node);
            nodeIndex++;
        }
    }

    // 3. Association 기반 DataFlow(엣지) 생성
    const processedEdges = new Set(); // 중복 방지용

    if (malModel.assets) {
        for (const [sourceAssetId, asset] of Object.entries(malModel.assets)) {
            if (!asset.associated_assets) continue;

            const sourceCellId = assetIdToCellId[sourceAssetId];
            if (!sourceCellId) continue;

            // associated_assets의 각 필드 순회
            for (const [fieldName, linkedAssets] of Object.entries(asset.associated_assets)) {
                // langspec에서 Association 정보 조회
                const assocInfo = findAssociationByField(langspec, fieldName);

                // Association 이름 결정 (찾지 못하면 필드 이름 사용)
                const associationName = assocInfo?.name || fieldName;
                const associationDesc = assocInfo?.description || `${fieldName} connection`;

                // 연결된 각 자산에 대해 엣지 생성
                for (const [targetAssetId, targetAssetName] of Object.entries(linkedAssets)) {
                    const targetCellId = assetIdToCellId[targetAssetId];
                    if (!targetCellId) continue;
                    if (sourceCellId === targetCellId) continue;

                    // 양방향 엣지 중복 방지 (A-B와 B-A는 같은 연결)
                    const edgeKey = [sourceCellId, targetCellId].sort().join('-') + '-' + associationName;
                    if (processedEdges.has(edgeKey)) continue;
                    processedEdges.add(edgeKey);

                    // DataFlow 엣지 생성
                    const edge = {
                        shape: 'flow',
                        id: v4(),
                        zIndex: 10,
                        source: {
                            cell: sourceCellId
                        },
                        target: {
                            cell: targetCellId
                        },
                        attrs: {
                            line: {
                                stroke: '#333333',
                                sourceMarker: {
                                    name: ''
                                },
                                targetMarker: {
                                    name: ''
                                },
                                strokeDasharray: null
                            }
                        },
                        labels: [associationName],
                        data: {
                            name: associationName,
                            description: associationDesc,
                            type: 'tm.Flow',
                            isTrustBoundary: false,
                            outOfScope: false,
                            reasonOutOfScope: '',
                            hasOpenThreats: false,
                            threats: [],
                            malInfo: {
                                associationType: 'association',
                                associationName: associationName,
                                fieldName: fieldName,
                                sourceAssetId: sourceAssetId,
                                targetAssetId: targetAssetId
                            }
                        },
                        connector: {
                            name: "smooth",
                            args: {}
                        },
                        width: 200,
                        height: 100,
                    };

                    cells.push(edge);
                }
            }
        }
    }

    dfd.diagrams.cells = cells;
    return dfd;
}

/**
 * MAL 모델 파일과 MAR 파일을 받아 DFD로 변환합니다.
 * @param {Buffer} modelBuffer - MAL 모델 JSON 파일 버퍼
 * @param {Buffer} marBuffer - MAR 파일 버퍼
 * @returns {Promise<Object>} DFD JSON 객체
 */
async function convertMalAndMarToDfd(modelBuffer, marBuffer) {
    // 1. MAL 모델 파싱
    const malModel = JSON.parse(modelBuffer.toString('utf8'));

    // 2. MAR 파일에서 langspec.json 추출
    const langspec = await extractLangspecFromMar(marBuffer);

    // 3. DFD로 변환
    const dfd = convertMalToDfd(malModel, langspec);

    return dfd;
}

/**
 * MAL 모델 파일과 langspec.json 파일을 직접 받아 DFD로 변환합니다.
 * (MAR 파일 대신 langspec.json을 직접 제공하는 경우)
 * @param {Object} malModel - MAL 모델 JSON 객체
 * @param {Object} langspec - langspec.json 객체
 * @param {Object} shapeMapping - 자산 ID별 DFD shape 맵핑 (선택적)
 * @returns {Object} DFD JSON 객체
 */
function convertMalModelToDfd(malModel, langspec, shapeMapping = {}) {
    return convertMalToDfd(malModel, langspec, shapeMapping);
}

/**
 * MAL 모델에서 자산 목록만 추출합니다.
 * (Modal에서 자산 유형 설정을 위해 사용)
 * @param {Object} malModel - MAL 모델 JSON 객체
 * @returns {Array} 자산 목록 [{ id, name, malType, dfdShape }]
 */
function extractAssetsFromMal(malModel) {
    const assets = [];

    if (malModel && malModel.assets) {
        for (const [assetId, asset] of Object.entries(malModel.assets)) {
            assets.push({
                id: assetId,
                name: asset.name,
                malType: asset.type,
                dfdShape: 'process' // 기본값
            });
        }
    }

    return assets;
}

module.exports = {
    extractLangspecFromMar,
    convertMalAndMarToDfd,
    convertMalModelToDfd,
    findAssetInLangspec,
    extractThreatsFromAsset,
    findAssociationByField,
    extractAssetsFromMal,
};

import { defineStore } from 'pinia';
import saveService from '@/service/save.js';
import {
    createLanguageGraphSourceForMalsim,
    normalizeLanguageGraph
} from '@/service/langGraph/languageGraph.js';

const VERSION = '1.0.0';

const defaultThreatModelData = () => ({
    version: VERSION,
    modelInfo: {
        title: '',
        version: '',
        template: '',
        description: ''
    },
    diagrams: {},
    threatCounter: 0,
    languageGraph: null,
    languageGraphSource: null,
    languageGraphSourceText: ''
});
const isLanguageGraphSourceShape = (languageGraph) => {
    if (!languageGraph || typeof languageGraph !== 'object') return false;
    if (Array.isArray(languageGraph.assets)) return false;
    return Object.values(languageGraph).some((value) =>
        value
        && typeof value === 'object'
        && (value.attack_steps || value.attackSteps || value.associations)
    );
};

const stableStringify = (value) => {
    if (value === undefined) return 'undefined';

    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .filter((key) => key !== 'fileName')
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(',')}}`;
    }

    return JSON.stringify(value);
};

const parseLanguageGraphSourceText = (sourceText) => {
    if (!sourceText || typeof sourceText !== 'string') return null;

    try {
        return JSON.parse(sourceText);
    } catch (error) {
        console.warn('[ThreatModelStore] Stored LanguageGraph source text is not valid JSON:', error);
        return null;
    }
};

const normalizedLanguageGraphFingerprint = (languageGraph) => {
    const normalized = normalizeLanguageGraph(languageGraph);

    return stableStringify({
        assets: normalized.assets.map((asset) => ({
            name: asset.name,
            info: asset.info || {},
            description: asset.description || '',
            isAbstract: asset.isAbstract === true,
            superAsset: asset.superAsset || '',
            subAssets: asset.subAssets || [],
            variables: asset.variables || {},
            associations: (asset.associations || [])
                .map((association) => ({
                    fieldName: association.fieldName || '',
                    name: association.name || '',
                    info: association.info || {},
                    description: association.description || '',
                    left: association.left || null,
                    right: association.right || null
                }))
                .sort((left, right) => `${left.fieldName}:${left.name}`.localeCompare(`${right.fieldName}:${right.name}`)),
            attackSteps: (asset.attackSteps || [])
                .map((step) => ({
                    name: step.name || '',
                    type: step.type || '',
                    asset: step.asset || '',
                    ttc: step.ttc || null,
                    info: step.info || {},
                    description: step.description || '',
                    tags: step.tags || [],
                    own_children: step.own_children || {},
                    own_parents: step.own_parents || {},
                    requires: step.requires || [],
                    inherits: step.inherits || null,
                    overrides: step.overrides === true,
                    detectors: step.detectors || {}
                }))
                .sort((left, right) => left.name.localeCompare(right.name))
        }))
            .sort((left, right) => left.name.localeCompare(right.name))
    });
};

const languageGraphMatchesSourceText = (languageGraph, sourceText) => {
    if (!languageGraph || !sourceText) return false;

    const sourceLanguageGraph = parseLanguageGraphSourceText(sourceText);
    if (!sourceLanguageGraph) return false;

    return stableStringify(languageGraph) === stableStringify(sourceLanguageGraph)
        || normalizedLanguageGraphFingerprint(languageGraph) === normalizedLanguageGraphFingerprint(sourceLanguageGraph);
};

const languageGraphsMatch = (leftGraph, rightGraph) => {
    if (!leftGraph || !rightGraph) return false;

    return stableStringify(leftGraph) === stableStringify(rightGraph)
        || normalizedLanguageGraphFingerprint(leftGraph) === normalizedLanguageGraphFingerprint(rightGraph);
};

const hydrateThreatModelData = (threatModel = {}) => {
    const defaults = defaultThreatModelData();
    const data = {
        ...defaults,
        ...threatModel,
        modelInfo: {
            ...defaults.modelInfo,
            ...(threatModel.modelInfo || {})
        }
    };

    if (!data.languageGraph && data.languageGraphSource) {
        data.languageGraph = normalizeLanguageGraph(
            data.languageGraphSource,
            data.languageGraphSource?.fileName || ''
        );
    }

    if (!data.languageGraphSource && isLanguageGraphSourceShape(data.languageGraph)) {
        data.languageGraphSource = data.languageGraph;
        data.languageGraph = normalizeLanguageGraph(
            data.languageGraph,
            data.languageGraph?.fileName || ''
        );
    }

    if (!data.languageGraphSource && data.languageGraph) {
        data.languageGraphSource = createLanguageGraphSourceForMalsim(data.languageGraph);
    }

    return data;
};

const preserveCurrentLanguageGraphSourceText = (incomingData, currentData) => {
    if (incomingData.languageGraphSourceText) return incomingData;

    const currentSourceText = currentData?.languageGraphSourceText || '';
    if (!currentSourceText) return incomingData;

    const candidateLanguageGraph = incomingData.languageGraphSource || incomingData.languageGraph;
    const currentLanguageGraph = currentData?.languageGraphSource || currentData?.languageGraph;
    const isSameLanguageGraph = languageGraphMatchesSourceText(candidateLanguageGraph, currentSourceText)
        || languageGraphsMatch(candidateLanguageGraph, currentLanguageGraph);

    if (!isSameLanguageGraph) return incomingData;

    return {
        ...incomingData,
        languageGraphSourceText: currentSourceText
    };
};

export const useThreatModelStore = defineStore('threatmodel', {
    state: () => ({
        data: defaultThreatModelData(), // current model data
        fileName: '', // 파일명
        stash: '', // 되돌리기용 백업
        modified: false, // 변경 여부
        modifiedDiagram: {}, // 수정된 다이어그램 (원본 다이어그램 복사)
        entryNode: '',
        targetNode: '',
        simulationResult: null, // 공격 시뮬레이션 결과 저장 { paths, totalCost, weightType }
        // malsim 시뮬레이션 관련 상태
        malModel: null, // 원본 MAL 모델 (시뮬레이션용)
        malLangspec: null, // 원본 langspec (시뮬레이션용)
        malMarFile: null, // 원본 .mar File 객체 (malsim 전송용)
        malModelFile: null, // 원본 model.json File 객체 (malsim 전송용)
        malMarFileName: '', // .mar 파일명
        malModelFileName: '', // model 파일명
        entryThreat: null, // { nodeId, nodeName, threatId, technique, ttc }
        targetThreat: null, // { nodeId, nodeName, threatId, technique, ttc }
        malsimResult: null, // malsim 실행 결과 { attackPath, totalSteps, ... }
        malsimSessions: [], // [{ sessionId, createdAt, simulationResult }]
        isSimulating: false // 시뮬레이션 실행 중 여부
    }),

    getters: {
        modelChanged: (state) => state.modified
    },

    actions: {
        increaseThreatCounter() {
            this.data.threatCounter++;
        },
        _stashThreatModel(threatModel) {
            const hydratedThreatModel = preserveCurrentLanguageGraphSourceText(
                hydrateThreatModelData(threatModel),
                this.data
            );
            this.data = hydratedThreatModel;
            this.modifiedDiagram = hydratedThreatModel.diagrams || {};
            this.simulationResult = null;
            this.malsimResult = null;
            this.entryThreat = null;
            this.targetThreat = null;
            this.modified = false;
            this.stash = JSON.stringify(hydratedThreatModel);
        },

        stashState() {
            this.stash = JSON.stringify(this.data);
        },

        clear() {
            // 기존 초기화
            this.data = defaultThreatModelData();
            this.fileName = '';
            this.stash = '';
            this.modified = false;
            this.modifiedDiagram = {};
            this.entryNode = '';
            this.targetNode = '';
            this.simulationResult = null;
            // malsim 관련 초기화
            this.malModel = null;
            this.malLangspec = null;
            this.malMarFile = null;
            this.malModelFile = null;
            this.malMarFileName = '';
            this.malModelFileName = '';
            this.entryThreat = null;
            this.targetThreat = null;
            this.malsimResult = null;
            this.malsimSessions = [];
        },

        async save() {  // 전체 모델 저장
            console.log('[ThreatModelStore] Saving threat model locally');
            const targetFileName = this.data.modelInfo?.title || this.fileName;
            this.data.diagrams = this.modifiedDiagram
            const success = await saveService.local(this.data, targetFileName);
            if (!success) {
                return false;
            }

            this.fileName = targetFileName;
            this.stashState();
            this.modified = false;
            return true;
        },

        setFileName(fileName) {
            this.fileName = fileName;
        },

        // --- 다이어그램 관련 ---
        selectDiagram(diagram) {
            this.modifiedDiagram = diagram;
        },

        modifyDiagram(diagram) {
            this.modifiedDiagram = diagram;
            this.modified = true;
        },

        setModified() {
            this.modified = true;
        },

        updateCellDataInDiagram(cellId, newData) {
            if (!this.modifiedDiagram.cells) return;

            // JSON 구조 내에서 해당 ID를 가진 셀 찾기
            const targetCell = this.modifiedDiagram.cells.find(c => c.id === cellId);

            if (targetCell) {
                // 데이터를 복사하여 업데이트 (Reactivity 보장 및 참조 끊기 방지)
                targetCell.data = JSON.parse(JSON.stringify(newData));
                this.modified = true;
                console.debug(`[ThreatModelStore] Cell(${cellId}) data synced to modifiedDiagram.`);
            }
        },

        upsertMalsimSession(sessionData) {
            if (!sessionData?.sessionId) return;

            const nextSession = {
                sessionId: sessionData.sessionId,
                createdAt: sessionData.createdAt || new Date().toISOString(),
                simulationResult: sessionData.simulationResult || null
            };

            const index = this.malsimSessions.findIndex(
                (item) => item.sessionId === sessionData.sessionId
            );

            if (index === -1) {
                this.malsimSessions.unshift(nextSession);
                return;
            }

            this.malsimSessions[index] = {
                ...this.malsimSessions[index],
                ...nextSession
            };
        },

        removeMalsimSession(sessionId) {
            if (!sessionId) return;
            this.malsimSessions = this.malsimSessions.filter(
                (item) => item.sessionId !== sessionId
            );
        },
    },
    persist: {
        storage: localStorage,
        paths: ['data', 'fileName', 'malsimResult', 'malsimSessions']
    },
});

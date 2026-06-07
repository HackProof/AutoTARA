import { defineStore } from 'pinia';
import saveService from '@/service/save.js';

const VERSION = '1.0.0';

export const useThreatModelStore = defineStore('threatmodel', {
    state: () => ({
        data: {
            version: VERSION,
            modelInfo: {
                title: '',
                version: '',
                template: '',
                description: ''
            },
            diagrams: {}, // original Diagram
            threatCounter: 0,
            languageGraph: null
        }, // 현재 모델 데이터
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
            this.data = threatModel;
            this.stash = JSON.stringify(threatModel);
        },

        stashState() {
            this.stash = JSON.stringify(this.data);
        },

        clear() {
            // 기존 초기화
            this.data = {
                version: VERSION,
                modelInfo: {
                    title: '',
                    version: '',
                    template: '',
                    description: ''
                },
                diagrams: {},
                threatCounter: 0,
                languageGraph: null
            };
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

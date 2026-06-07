/**
 * Simulation Service
 * 
 * malsim을 이용한 공격 시뮬레이션 서비스
 * - 시나리오 YAML 파일 생성
 * - malsim 실행
 * - 로그 파싱 및 결과 반환
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const yaml = require('js-yaml');
const { v4: uuid } = require('uuid');

// 임시 파일 저장 디렉토리
const TEMP_DIR = process.env.SIMULATION_TEMP_DIR || path.join(os.tmpdir(), 'autotara', 'tara-server');
const SIMULATION_DIR = path.join(TEMP_DIR, 'simulations');
const PYTHON_SERVER_URL = process.env.PYTHON_SERVER_URL || 'http://localhost:8000';

// 업로드된 MAL 파일 저장소 (세션별)
const uploadedFiles = new Map();

/**
 * 임시 디렉토리 초기화
 */
function ensureTempDirs() {
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    if (!fs.existsSync(SIMULATION_DIR)) {
        fs.mkdirSync(SIMULATION_DIR, { recursive: true });
    }
}

/**
 * 업로드된 MAL 파일을 임시 저장합니다.
 * @param {Buffer} modelBuffer - MAL 모델 JSON 버퍼
 * @param {Buffer} marBuffer - MAR 파일 버퍼
 * @param {string} modelName - 원본 모델 파일명
 * @param {string} marName - 원본 MAR 파일명
 * @returns {string} 세션 ID
 */
function saveUploadedFiles(modelBuffer, marBuffer, modelName, marName) {
    ensureTempDirs();

    const sessionId = uuid();
    const sessionDir = path.join(TEMP_DIR, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    const modelPath = path.join(sessionDir, modelName || 'model.json');
    const marPath = path.join(sessionDir, marName || 'model.mar');

    fs.writeFileSync(modelPath, modelBuffer);
    fs.writeFileSync(marPath, marBuffer);

    // 메모리에도 경로 저장
    uploadedFiles.set(sessionId, {
        modelPath,
        marPath,
        modelName: modelName || 'model.json',
        marName: marName || 'model.mar',
        createdAt: new Date()
    });

    console.log(`[SimulationService] Files saved for session ${sessionId}`);

    return sessionId;
}

/**
 * 세션 ID로 저장된 파일 경로를 조회합니다.
 * @param {string} sessionId - 세션 ID
 * @returns {Object|null} { modelPath, marPath }
 */
function getUploadedFiles(sessionId) {
    return uploadedFiles.get(sessionId) || null;
}

/**
 * 시나리오 YAML 파일을 생성합니다.
 * @param {Object} config - 시나리오 설정
 * @param {string} config.sessionId - 세션 ID
 * @param {string} config.entryPoint - 진입점 (예: "AssetName:attackStep")
 * @param {string} config.goal - 목표 (예: "AssetName:attackStep")
 * @param {string} config.attackerName - 공격자 이름 (선택적)
 * @returns {Object} { scenarioPath, simulationId }
 */
function generateScenarioYaml(config) {
    const { sessionId, entryPoint, goal, attackerName = 'Attacker' } = config;

    const files = getUploadedFiles(sessionId);
    if (!files) {
        throw new Error(`Session ${sessionId} not found. Please upload files first.`);
    }

    const simulationId = uuid();
    const simDir = path.join(SIMULATION_DIR, simulationId);
    fs.mkdirSync(simDir, { recursive: true });

    // 시나리오 YAML 구성
    const scenario = {
        lang_file: files.marName,
        model_file: files.modelName,
        agents: {
            [attackerName]: {
                type: 'attacker',
                entry_points: [entryPoint],
                goals: [goal],
                agent_class: 'BreadthFirstAttacker'
            }
        }
    };

    const scenarioPath = path.join(simDir, 'scenario.yml');
    const yamlContent = yaml.dump(scenario, { indent: 2 });
    fs.writeFileSync(scenarioPath, yamlContent);

    // 파일들도 복사
    fs.copyFileSync(files.modelPath, path.join(simDir, files.modelName));
    fs.copyFileSync(files.marPath, path.join(simDir, files.marName));

    console.log(`[SimulationService] Scenario created: ${scenarioPath}`);

    return {
        scenarioPath,
        simulationId,
        simDir
    };
}

/**
 * malsim을 실행합니다.
 * @param {string} simDir - 시뮬레이션 디렉토리
 * @param {string} scenarioPath - 시나리오 파일 경로
 * @returns {Promise<Object>} 실행 결과
 */
async function runMalsim(simDir, scenarioPath) {
    return new Promise((resolve, reject) => {
        const logPath = path.join(simDir, 'logs', 'malsim_log.txt');
        const logsDir = path.join(simDir, 'logs');

        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        // malsim 실행 (Python subprocess)
        const malsimProcess = spawn('python', [
            '-m', 'malsim',
            '-s', scenarioPath,
            '-o', logsDir
        ], {
            cwd: simDir,
            shell: true
        });

        let stdout = '';
        let stderr = '';

        malsimProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        malsimProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        malsimProcess.on('close', (code) => {
            if (code === 0) {
                resolve({
                    success: true,
                    logPath,
                    stdout,
                    stderr
                });
            } else {
                // malsim이 없거나 실패한 경우에도 결과 반환
                resolve({
                    success: false,
                    logPath,
                    stdout,
                    stderr,
                    exitCode: code,
                    message: `malsim exited with code ${code}`
                });
            }
        });

        malsimProcess.on('error', (err) => {
            resolve({
                success: false,
                error: err.message,
                message: 'Failed to start malsim. Is it installed?'
            });
        });
    });
}

/**
 * malsim 로그를 파싱하여 공격 경로를 추출합니다.
 * @param {string} logPath - 로그 파일 경로
 * @returns {Object} 파싱된 결과
 */
function parseSimulationLog(logPath) {
    if (!fs.existsSync(logPath)) {
        return {
            success: false,
            message: 'Log file not found',
            attackPath: []
        };
    }

    const logContent = fs.readFileSync(logPath, 'utf8');
    const lines = logContent.split('\n');

    const attackPath = [];
    const compromisedSteps = new Set();
    let stepNumber = 0;

    for (const line of lines) {
        // 공격자가 compromise한 단계 추출
        // 형식: "Attacker agent "XXX" compromised "AssetName:attackStep" (reward: 0)."
        const compromiseMatch = line.match(/Attacker agent "([^"]+)" compromised "([^"]+):([^"]+)"/);

        if (compromiseMatch) {
            const [, attackerName, assetName, attackStep] = compromiseMatch;
            const fullStep = `${assetName}:${attackStep}`;

            // 중복 방지
            if (!compromisedSteps.has(fullStep)) {
                compromisedSteps.add(fullStep);
                stepNumber++;

                attackPath.push({
                    step: stepNumber,
                    assetName,
                    attackStep,
                    fullStep,
                    attackerName
                });
            }
        }
    }

    return {
        success: true,
        attackPath,
        totalSteps: attackPath.length
    };
}

/**
 * 전체 시뮬레이션을 실행합니다.
 * Python 시뮬레이션 서버로 파일을 전송합니다.
 * 
 * @param {Object} config - 시뮬레이션 설정
 * @param {Object} config.model - MAL 모델 JSON 객체
 * @param {Object} config.langspec - MAL 언어 스펙 JSON 객체
 * @param {string} config.entryPoint - 진입점
 * @param {string} config.goal - 목표
 * @param {string} config.langFileName - 언어 파일명
 * @param {string} config.modelFileName - 모델 파일명
 * @param {number} config.seed - 시뮬레이션 시드값
 * @param {number} config.ttcMode - TTC 모드
 * @returns {Promise<Object>} 시뮬레이션 응답 (session_id 포함)
 */
async function runSimulation(config) {
    const FormData = require('form-data');
    const axios = require('axios');

    try {
        const {
            marFileBuffer,
            modelFileBuffer,
            entryPoint,
            goal,
            langFileName = 'language.mar',
            modelFileName = 'model.json',
            seed = 42,
            ttcMode = 0
        } = config;

        ensureTempDirs();

        // 임시 디렉토리 생성
        const sessionId = uuid();
        const sessionDir = path.join(TEMP_DIR, sessionId);
        fs.mkdirSync(sessionDir, { recursive: true });

        // 1. scenario.yml 생성
        const scenarioYaml = createScenario(entryPoint, goal, langFileName, modelFileName);
        const scenarioPath = path.join(sessionDir, 'scenario.yml');
        fs.writeFileSync(scenarioPath, scenarioYaml, 'utf8');

        console.log(`[SimulationService] Scenario created: ${scenarioPath}`);
        console.log(`[SimulationService] Scenario content:\n${scenarioYaml}`);

        // 2. model.json 저장
        if (!modelFileBuffer) {
            throw new Error('Model file buffer is required');
        }
        const modelPath = path.join(sessionDir, modelFileName);
        fs.writeFileSync(modelPath, modelFileBuffer);
        console.log(`[SimulationService] Model saved: ${modelPath}`);

        // 3. langspec.mar 저장 (바이너리)
        if (!marFileBuffer) {
            throw new Error('MAR file buffer is required');
        }
        const langPath = path.join(sessionDir, langFileName);
        fs.writeFileSync(langPath, marFileBuffer); // 바이너리 저장
        console.log(`[SimulationService] MAR saved: ${langPath}`);

        // 4. Python 서버로 파일 전송 (multipart/form-data)
        const formData = new FormData();
        formData.append('scenario_file', fs.createReadStream(scenarioPath), {
            filename: 'scenario.yml',
            contentType: 'application/x-yaml'
        });
        formData.append('lang_file', fs.createReadStream(langPath), {
            filename: langFileName,
            contentType: 'application/octet-stream'
        });
        formData.append('model_file', fs.createReadStream(modelPath), {
            filename: modelFileName,
            contentType: 'application/json'
        });
        formData.append('seed', seed.toString());
        formData.append('ttc_mode', ttcMode.toString());

        console.log(`[SimulationService] Sending files to Python server...`);

        // Python 서버로 요청
        const response = await axios.post(
            `${PYTHON_SERVER_URL}/simulation/run-file`,
            formData,
            {
                headers: {
                    ...formData.getHeaders()
                },
                timeout: 30000 // 30초 타임아웃
            }
        );

        console.log(`[SimulationService] Response from Python server:`, response.data);

        // 로컬 세션 정보 저장
        uploadedFiles.set(sessionId, {
            pythonSessionId: response.data.session_id,
            scenarioPath,
            modelPath,
            langPath,
            entryPoint,
            goal,
            createdAt: new Date()
        });

        return {
            success: true,
            sessionId: response.data.session_id, // Python 서버의 session_id 반환
            status: response.data.status,
            message: response.data.message,
            createdAt: response.data.created_at
        };

    } catch (error) {
        console.error('[SimulationService] Simulation error:', error.message);

        if (error.response) {
            // Python 서버가 응답했지만 에러 상태 코드를 반환한 경우
            console.error('[SimulationService] Python server error:', error.response.data);
            return {
                success: false,
                error: error.response.data.detail || error.response.data.message || error.message
            };
        } else if (error.request) {
            // 요청이 전송되었지만 응답을 받지 못한 경우
            console.error('[SimulationService] No response from Python server');
            return {
                success: false,
                error: `Python simulation server is not responding. Please check if the server is running at ${PYTHON_SERVER_URL}`
            };
        } else {
            // 요청 설정 중 문제가 발생한 경우
            return {
                success: false,
                error: error.message
            };
        }
    }
}

/**
 * 세션 파일을 정리합니다 (선택적)
 * @param {string} sessionId - 세션 ID
 */
function cleanupSession(sessionId) {
    const files = uploadedFiles.get(sessionId);
    if (files) {
        const sessionDir = path.dirname(files.modelPath);
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
        uploadedFiles.delete(sessionId);
        console.log(`[SimulationService] Session ${sessionId} cleaned up`);
    }
}

/**
 * scenario.yml 파일 내용을 생성합니다.
 * @param {string} entryPoint - 진입점 (예: "AssetName:attackStep")
 * @param {string} goal - 목표 (예: "AssetName:attackStep")
 * @param {string} langFileName - MAR 파일명 (예: "org.mal-lang.vehicleLang-2.0.1.mar")
 * @param {string} modelFileName - 모델 파일명 (예: "basic_vehicle_model.json")
 * @returns {string} YAML 형식의 scenario 내용
 */
function createScenario(entryPoint, goal, langFileName, modelFileName) {
    const scenario = {
        lang_file: langFileName,
        model_file: modelFileName,
        agents: {
            Attacker: {
                type: 'attacker',
                entry_points: [entryPoint],
                goals: [goal],
                agent_class: 'BreadthFirstAttacker'
            },
            Defender: {
                type: 'defender',
                agent_class: 'PassiveAgent'
            }
        }
    };

    // YAML 형식으로 변환
    const yamlContent = yaml.dump(scenario, { indent: 2 });
    return yamlContent;
}

/**
 * Python 서버에서 시뮬레이션 상태를 조회합니다.
 * @param {string} sessionId - Python 서버의 세션 ID
 * @returns {Promise<Object>} 상태 정보
 */
async function getSimulationStatus(sessionId) {
    const axios = require('axios');

    try {
        const response = await axios.get(
            `${PYTHON_SERVER_URL}/simulation/${sessionId}/status`,
            { timeout: 10000 }
        );

        return {
            success: true,
            data: response.data
        };

    } catch (error) {
        if (error.response) {
            return {
                success: false,
                statusCode: error.response.status,
                error: error.response.data.detail || error.response.data.message || 'Failed to get status'
            };
        } else {
            return {
                success: false,
                error: 'Python simulation server is not responding'
            };
        }
    }
}

function buildResultView(data, view) {
    if (view !== 'shortest') {
        return data;
    }

    const result = data && data.result ? data.result : {};

    return {
        ...data,
        result: {
            shortest_paths: result.shortest_paths || null
        }
    };
}

/**
 * Python 서버에서 시뮬레이션 결과를 조회합니다.
 * @param {string} sessionId - Python 서버의 세션 ID
 * @param {string} [view] - 결과 뷰 타입 (예: "shortest")
 * @returns {Promise<Object>} 결과 정보
 */
async function getSimulationResult(sessionId, view) {
    const axios = require('axios');

    try {
        const response = await axios.get(
            `${PYTHON_SERVER_URL}/simulation/${sessionId}`,
            { timeout: 10000 }
        );

        return {
            success: true,
            data: buildResultView(response.data, view)
        };

    } catch (error) {
        if (error.response) {
            return {
                success: false,
                statusCode: error.response.status,
                error: error.response.data.detail || error.response.data.message || 'Failed to get result'
            };
        } else {
            return {
                success: false,
                error: 'Python simulation server is not responding'
            };
        }
    }
}

module.exports = {
    saveUploadedFiles,
    getUploadedFiles,
    generateScenarioYaml,
    runMalsim,
    parseSimulationLog,
    runSimulation,
    cleanupSession,
    createScenario,
    getSimulationStatus,
    getSimulationResult
};

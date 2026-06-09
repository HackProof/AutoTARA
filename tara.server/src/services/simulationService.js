/**
 * Simulation Service
 * 
 * malsim???댁슜??怨듦꺽 ?쒕??덉씠???쒕퉬??
 * - ?쒕굹由ъ삤 YAML ?뚯씪 ?앹꽦
 * - malsim ?ㅽ뻾
 * - 濡쒓렇 ?뚯떛 諛?寃곌낵 諛섑솚
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const yaml = require('js-yaml');
const { v4: uuid } = require('uuid');

// ?꾩떆 ?뚯씪 ????붾젆?좊━
const TEMP_DIR = process.env.SIMULATION_TEMP_DIR || path.join(os.tmpdir(), 'autotara', 'tara-server');
const SIMULATION_DIR = path.join(TEMP_DIR, 'simulations');
const PYTHON_SERVER_URL = process.env.PYTHON_SERVER_URL || 'http://localhost:8000';

// ?낅줈?쒕맂 MAL ?뚯씪 ??μ냼 (?몄뀡蹂?
const uploadedFiles = new Map();

/**
 * ?꾩떆 ?붾젆?좊━ 珥덇린??
 */
function ensureTempDirs() {
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    if (!fs.existsSync(SIMULATION_DIR)) {
        fs.mkdirSync(SIMULATION_DIR, { recursive: true });
    }
}

function safeLocalName(fileName, fallback) {
    const baseName = path.basename(fileName || fallback || '');
    return baseName && baseName !== '.' && baseName !== '..' ? baseName : fallback;
}

/**
 * ?낅줈?쒕맂 MAL ?뚯씪???꾩떆 ??ν빀?덈떎.
 * @param {Buffer} modelBuffer - MAL 紐⑤뜽 JSON 踰꾪띁
 * @param {Buffer} marBuffer - MAR ?뚯씪 踰꾪띁
 * @param {string} modelName - ?먮낯 紐⑤뜽 ?뚯씪紐?
 * @param {string} marName - ?먮낯 MAR ?뚯씪紐?
 * @returns {string} ?몄뀡 ID
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

    // 硫붾え由ъ뿉??寃쎈줈 ???
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
 * ?몄뀡 ID濡???λ맂 ?뚯씪 寃쎈줈瑜?議고쉶?⑸땲??
 * @param {string} sessionId - ?몄뀡 ID
 * @returns {Object|null} { modelPath, marPath }
 */
function getUploadedFiles(sessionId) {
    return uploadedFiles.get(sessionId) || null;
}

/**
 * ?쒕굹由ъ삤 YAML ?뚯씪???앹꽦?⑸땲??
 * @param {Object} config - ?쒕굹由ъ삤 ?ㅼ젙
 * @param {string} config.sessionId - ?몄뀡 ID
 * @param {string} config.entryPoint - 吏꾩엯??(?? "AssetName:attackStep")
 * @param {string} config.goal - 紐⑺몴 (?? "AssetName:attackStep")
 * @param {string} config.attackerName - 怨듦꺽???대쫫 (?좏깮??
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

    // ?쒕굹由ъ삤 YAML 援ъ꽦
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

    // ?뚯씪?ㅻ룄 蹂듭궗
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
 * malsim???ㅽ뻾?⑸땲??
 * @param {string} simDir - ?쒕??덉씠???붾젆?좊━
 * @param {string} scenarioPath - ?쒕굹由ъ삤 ?뚯씪 寃쎈줈
 * @returns {Promise<Object>} ?ㅽ뻾 寃곌낵
 */
async function runMalsim(simDir, scenarioPath) {
    return new Promise((resolve, reject) => {
        const logPath = path.join(simDir, 'logs', 'malsim_log.txt');
        const logsDir = path.join(simDir, 'logs');

        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        // malsim ?ㅽ뻾 (Python subprocess)
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
                // malsim???녾굅???ㅽ뙣??寃쎌슦?먮룄 寃곌낵 諛섑솚
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
 * malsim 濡쒓렇瑜??뚯떛?섏뿬 怨듦꺽 寃쎈줈瑜?異붿텧?⑸땲??
 * @param {string} logPath - 濡쒓렇 ?뚯씪 寃쎈줈
 * @returns {Object} ?뚯떛??寃곌낵
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
        // 怨듦꺽?먭? compromise???④퀎 異붿텧
        // ?뺤떇: "Attacker agent "XXX" compromised "AssetName:attackStep" (reward: 0)."
        const compromiseMatch = line.match(/Attacker agent "([^"]+)" compromised "([^"]+):([^"]+)"/);

        if (compromiseMatch) {
            const [, attackerName, assetName, attackStep] = compromiseMatch;
            const fullStep = `${assetName}:${attackStep}`;

            // 以묐났 諛⑹?
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
 * ?꾩껜 ?쒕??덉씠?섏쓣 ?ㅽ뻾?⑸땲??
 * Python ?쒕??덉씠???쒕쾭濡??뚯씪???꾩넚?⑸땲??
 * 
 * @param {Object} config - ?쒕??덉씠???ㅼ젙
 * @param {Object} config.model - MAL 紐⑤뜽 JSON 媛앹껜
 * @param {Object} config.langspec - MAL ?몄뼱 ?ㅽ럺 JSON 媛앹껜
 * @param {string} config.entryPoint - 吏꾩엯??
 * @param {string} config.goal - 紐⑺몴
 * @param {string} config.langFileName - ?몄뼱 ?뚯씪紐?
 * @param {string} config.modelFileName - 紐⑤뜽 ?뚯씪紐?
 * @param {number} config.seed - ?쒕??덉씠???쒕뱶媛?
 * @param {number} config.ttcMode - TTC 紐⑤뱶
 * @returns {Promise<Object>} ?쒕??덉씠???묐떟 (session_id ?ы븿)
 */
async function runSimulation(config) {
    const FormData = require('form-data');
    const axios = require('axios');

    try {
        const {
            marFileBuffer,
            langGraphFileBuffer,
            modelFileBuffer,
            entryPoint,
            goal,
            langFileName = 'language.mar',
            langGraphFileName = 'langGraph.json',
            modelFileName = 'model.json',
            seed = 42,
            ttcMode = 0
        } = config;

        ensureTempDirs();

        // ?꾩떆 ?붾젆?좊━ ?앹꽦
        const sessionId = uuid();
        const sessionDir = path.join(TEMP_DIR, sessionId);
        fs.mkdirSync(sessionDir, { recursive: true });

        // 1. scenario.yml ?앹꽦
        // 2. model.json ???
        if (!modelFileBuffer) {
            throw new Error('Model file buffer is required');
        }
        const safeModelFileName = safeLocalName(modelFileName, 'model.json');
        const modelPath = path.join(sessionDir, safeModelFileName);
        fs.writeFileSync(modelPath, modelFileBuffer);
        console.log(`[SimulationService] Model saved: ${modelPath}`);

        // 3. langspec.mar ???(諛붿씠?덈━)
        const languageBuffer = langGraphFileBuffer || marFileBuffer;
        const languageFileName = langGraphFileBuffer ? langGraphFileName : langFileName;
        if (!languageBuffer) {
            throw new Error('MAL LangGraph file buffer is required');
        }
        const safeLanguageFileName = safeLocalName(
            languageFileName,
            langGraphFileBuffer ? 'langGraph.json' : 'language.mar'
        );
        const langPath = path.join(sessionDir, safeLanguageFileName);
        fs.writeFileSync(langPath, languageBuffer);
        console.log(`[SimulationService] Language saved: ${langPath}`);

        // 4. Python ?쒕쾭濡??뚯씪 ?꾩넚 (multipart/form-data)
        const formData = new FormData();
        formData.append('entryPoint', entryPoint);
        formData.append('goal', goal);
        formData.append('model_file', fs.createReadStream(modelPath), {
            filename: safeModelFileName,
            contentType: 'application/json'
        });
        formData.append(langGraphFileBuffer ? 'lang_graph_file' : 'lang_file', fs.createReadStream(langPath), {
            filename: safeLanguageFileName,
            contentType: langGraphFileBuffer ? 'application/json' : 'application/octet-stream'
        });
        formData.append('seed', seed.toString());
        formData.append('ttc_mode', ttcMode.toString());

        console.log(`[SimulationService] Sending files to Python server...`);

        // Python ?쒕쾭濡??붿껌
        const response = await axios.post(
            `${PYTHON_SERVER_URL}/simulation/run-file`,
            formData,
            {
                headers: {
                    ...formData.getHeaders()
                },
                timeout: 30000 // 30珥???꾩븘??
            }
        );

        console.log(`[SimulationService] Response from Python server:`, response.data);

        // 濡쒖뺄 ?몄뀡 ?뺣낫 ???
        const uploadedFileRecord = {
            pythonSessionId: response.data.session_id,
            modelPath,
            langPath,
            entryPoint,
            goal,
            createdAt: new Date()
        };
        uploadedFiles.set(sessionId, uploadedFileRecord);
        uploadedFiles.set(response.data.session_id, uploadedFileRecord);

        return {
            success: true,
            sessionId: response.data.session_id, // Python ?쒕쾭??session_id 諛섑솚
            status: response.data.status,
            message: response.data.message,
            createdAt: response.data.created_at
        };

    } catch (error) {
        console.error('[SimulationService] Simulation error:', error.message);

        if (error.response) {
            // Python ?쒕쾭媛 ?묐떟?덉?留??먮윭 ?곹깭 肄붾뱶瑜?諛섑솚??寃쎌슦
            console.error('[SimulationService] Python server error:', error.response.data);
            return {
                success: false,
                error: error.response.data.detail || error.response.data.message || error.message
            };
        } else if (error.request) {
            // ?붿껌???꾩넚?섏뿀吏留??묐떟??諛쏆? 紐삵븳 寃쎌슦
            console.error('[SimulationService] No response from Python server');
            return {
                success: false,
                error: `Python simulation server is not responding. Please check if the server is running at ${PYTHON_SERVER_URL}`
            };
        } else {
            // ?붿껌 ?ㅼ젙 以?臾몄젣媛 諛쒖깮??寃쎌슦
            return {
                success: false,
                error: error.message
            };
        }
    }
}

/**
 * ?몄뀡 ?뚯씪???뺣━?⑸땲??(?좏깮??
 * @param {string} sessionId - ?몄뀡 ID
 */
async function cleanupSession(sessionId) {
    const axios = require('axios');

    const files = uploadedFiles.get(sessionId);
    if (files) {
        const sessionDir = path.dirname(files.modelPath);
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
        for (const [key, value] of uploadedFiles.entries()) {
            if (value === files) {
                uploadedFiles.delete(key);
            }
        }
        console.log(`[SimulationService] Session ${sessionId} cleaned up`);
    }

    try {
        await axios.delete(`${PYTHON_SERVER_URL}/simulation/${sessionId}`, { timeout: 10000 });
    } catch (error) {
        if (error.response && error.response.status === 404) {
            return;
        }
        throw error;
    }
}

/**
 * scenario.yml ?뚯씪 ?댁슜???앹꽦?⑸땲??
 * @param {string} entryPoint - 吏꾩엯??(?? "AssetName:attackStep")
 * @param {string} goal - 紐⑺몴 (?? "AssetName:attackStep")
 * @param {string} langFileName - MAR ?뚯씪紐?(?? "org.mal-lang.vehicleLang-2.0.1.mar")
 * @param {string} modelFileName - 紐⑤뜽 ?뚯씪紐?(?? "basic_vehicle_model.json")
 * @returns {string} YAML ?뺤떇??scenario ?댁슜
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

    // YAML ?뺤떇?쇰줈 蹂??
    const yamlContent = yaml.dump(scenario, { indent: 2 });
    return yamlContent;
}

/**
 * Python ?쒕쾭?먯꽌 ?쒕??덉씠???곹깭瑜?議고쉶?⑸땲??
 * @param {string} sessionId - Python ?쒕쾭???몄뀡 ID
 * @returns {Promise<Object>} ?곹깭 ?뺣낫
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
            attack_path_found: result.attack_path_found || false,
            attack_paths: result.attack_paths || {},
            attack_paths_count: result.attack_paths_count || {},
            shortest_paths: result.shortest_paths || null,
            attack_graph: result.attack_graph || null,
            attack_path: result.attack_path || null,
            artifacts: result.artifacts || {}
        }
    };
}

/**
 * Python ?쒕쾭?먯꽌 ?쒕??덉씠??寃곌낵瑜?議고쉶?⑸땲??
 * @param {string} sessionId - Python ?쒕쾭???몄뀡 ID
 * @param {string} [view] - 寃곌낵 酉????(?? "shortest")
 * @returns {Promise<Object>} 寃곌낵 ?뺣낫
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

async function getSimulationArtifact(sessionId, artifactName) {
    const axios = require('axios');

    try {
        const response = await axios.get(
            `${PYTHON_SERVER_URL}/simulation/${sessionId}/artifacts/${encodeURIComponent(artifactName)}`,
            {
                timeout: 30000,
                responseType: 'stream'
            }
        );

        return {
            success: true,
            stream: response.data,
            contentType: response.headers['content-type'],
            contentDisposition: response.headers['content-disposition']
        };
    } catch (error) {
        if (error.response) {
            return {
                success: false,
                statusCode: error.response.status,
                error: error.response.data?.detail || error.response.data?.message || 'Failed to get artifact'
            };
        }

        return {
            success: false,
            error: 'Python simulation server is not responding'
        };
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
    getSimulationResult,
    getSimulationArtifact
};

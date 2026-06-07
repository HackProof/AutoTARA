/**
 * TARA Assessment Service
 *
 * shortest_path 시뮬레이션 결과를 Gemini로 2단계 분석하여
 * TARA 평가 항목을 생성하고 DB에 저장/조회/수정/삭제합니다.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { randomUUID } = require('crypto');
const taraAssessmentRepository = require('../repositories/taraAssessmentRepository');

const GEMINI_API_BASE_URL = process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 120000);
const GEMINI_TEMPERATURE_GEN = Number(process.env.GEMINI_TEMPERATURE_GEN || 0.3);
const GEMINI_TEMPERATURE_VERIFY = Number(process.env.GEMINI_TEMPERATURE_VERIFY || 0.1);

const PROMPT_DIR = path.resolve(__dirname, '../prompt');
const PROMPT_CACHE = new Map();

const VERIFIED_TARA_SCHEMA = {
    type: 'object',
    properties: {
        Entry_Asset: { type: 'string' },
        Target_Asset: { type: 'string' },
        CIA_Attribute: {
            type: 'string',
            enum: ['Confidentiality', 'Integrity', 'Availability']
        },
        Damage_Scenario: { type: 'string' },
        Impact_Category: {
            type: 'string',
            enum: ['Safety', 'Financial', 'Operational', 'Privacy']
        },
        Threat_Scenario: { type: 'string' },
        Attack_Path: {
            type: 'object',
            additionalProperties: buildVerifiedPathSchema(),
            minProperties: 1
        },
        Scenario_Linkage_Check: {
            type: 'object',
            properties: {
                Damage_to_Threat_Consistency: {
                    type: 'string',
                    enum: ['Consistent', 'Partially consistent', 'Inconsistent']
                },
                Threat_to_AttackPath_Consistency: {
                    type: 'string',
                    enum: ['Consistent', 'Partially consistent', 'Inconsistent']
                },
                CIA_Consistency: {
                    type: 'string',
                    enum: ['Consistent', 'Partially consistent', 'Inconsistent']
                },
                Notes: {
                    type: 'array',
                    items: { type: 'string' }
                }
            },
            required: [
                'Damage_to_Threat_Consistency',
                'Threat_to_AttackPath_Consistency',
                'CIA_Consistency',
                'Notes'
            ],
            additionalProperties: false
        }
    },
    required: [
        'Entry_Asset',
        'Target_Asset',
        'CIA_Attribute',
        'Damage_Scenario',
        'Impact_Category',
        'Threat_Scenario',
        'Attack_Path',
        'Scenario_Linkage_Check'
    ],
    additionalProperties: false
};

function buildVerifiedPathSchema() {
    return {
        type: 'object',
        properties: {
            Realism_Assessment: {
                type: 'string',
                enum: ['Realistic', 'Plausible with gaps', 'Unrealistic']
            },
            Completeness_Score_1to5: {
                type: 'integer',
                minimum: 1,
                maximum: 5
            },
            Expanded_Steps: {
                type: 'array',
                items: buildExpandedStepSchema()
            },
            Missing_Steps: {
                type: 'array',
                items: { type: 'string' }
            },
            Key_Assumptions: {
                type: 'array',
                items: { type: 'string' }
            },
            Evidence_Needed: {
                type: 'array',
                items: { type: 'string' }
            },
            Rewritten_Attack_Path: { type: 'string' }
        },
        required: [
            'Realism_Assessment',
            'Completeness_Score_1to5',
            'Expanded_Steps',
            'Missing_Steps',
            'Key_Assumptions',
            'Evidence_Needed',
            'Rewritten_Attack_Path'
        ],
        additionalProperties: false
    };
}

function buildExpandedStepSchema() {
    return {
        type: 'object',
        properties: {
            Shortest_Path_Step: {
                type: 'integer',
                minimum: 1
            },
            Shortest_Path_Node: { type: 'string' },
            Expanded_Description: { type: 'string' }
        },
        required: [
            'Shortest_Path_Step',
            'Shortest_Path_Node',
            'Expanded_Description'
        ],
        additionalProperties: false
    };
}

/**
 * Gemini API를 호출하여 시뮬레이션 결과를 분석합니다.
 * 1) scenario_gen_prompt로 초안 생성
 * 2) scenario_verify_prompt로 검증 + 최종 JSON 생성
 *
 * @param {Object} simulationResult - shortest_path 시뮬레이션 결과
 * @param {string} sessionId - 세션 ID
 * @returns {Promise<Array>} 생성된 assessment 배열
 */
async function analyzeThreatWithLLM(simulationResult, sessionId) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is required. Add it to tara.server/.env.');
    }

    const shortestPathContext = extractShortestPathContext(simulationResult);
    const shortestPathPromptBlock = formatShortestPathPromptBlock(shortestPathContext);
    const scenarioGenPrompt = loadPromptTemplate('scenario_gen_prompt.txt');
    const scenarioVerifyPrompt = loadPromptTemplate('scenario_verify_prompt.txt');

    console.log(`[TaraAssessmentService] Generating TARA scenario with Gemini model ${GEMINI_MODEL}`);

    const generatedScenario = await callGemini({
        apiKey,
        prompt: [
            scenarioGenPrompt.trim(),
            '',
            '<Input>',
            shortestPathPromptBlock,
            '</Input>'
        ].join('\n'),
        temperature: GEMINI_TEMPERATURE_GEN,
        useJsonSchema: false
    });

    const verifiedScenario = await verifyScenarioWithGemini({
        apiKey,
        verifyPrompt: scenarioVerifyPrompt,
        shortestPathPromptBlock,
        generatedScenario
    });

    const normalizedScenario = normalizeVerifiedScenario(
        verifiedScenario,
        shortestPathContext
    );

    const assessmentRows = buildAssessmentRowsFromScenario({
        sessionId,
        normalizedScenario,
        sourceShortestPath: shortestPathContext.originalPath
    });

    const saved = await taraAssessmentRepository.createAssessments(assessmentRows);

    console.log(`[TaraAssessmentService] ${saved.length} assessments created for session ${sessionId}`);

    return saved.map((item) => ({
        ...item,
        llm_result: normalizedScenario
    }));
}

async function verifyScenarioWithGemini({
    apiKey,
    verifyPrompt,
    shortestPathPromptBlock,
    generatedScenario
}) {
    const prompt = [
        verifyPrompt.trim(),
        '',
        '<Shortest_Path_Context>',
        shortestPathPromptBlock,
        '</Shortest_Path_Context>',
        '',
        '<Derived_TARA_Result>',
        generatedScenario,
        '</Derived_TARA_Result>'
    ].join('\n');

    try {
        const response = await callGemini({
            apiKey,
            prompt,
            temperature: GEMINI_TEMPERATURE_VERIFY,
            useJsonSchema: true,
            responseJsonSchema: VERIFIED_TARA_SCHEMA
        });
        return parseJsonResponse(response);
    } catch (error) {
        if (!isStructuredOutputCompatibilityError(error)) {
            throw error;
        }

        console.warn('[TaraAssessmentService] Structured output rejected by model. Retrying with prompt-only JSON mode.');

        const response = await callGemini({
            apiKey,
            prompt: [
                prompt,
                '',
                'Return only valid JSON that matches the requested Output_Template.'
            ].join('\n'),
            temperature: GEMINI_TEMPERATURE_VERIFY,
            useJsonSchema: false
        });
        return parseJsonResponse(response);
    }
}

async function callGemini({
    apiKey,
    prompt,
    temperature = 0.2,
    useJsonSchema = false,
    responseJsonSchema = null
}) {
    const url = `${GEMINI_API_BASE_URL}/models/${GEMINI_MODEL}:generateContent`;
    const payload = {
        contents: [
            {
                parts: [
                    { text: prompt }
                ]
            }
        ],
        generationConfig: {
            temperature
        }
    };

    if (useJsonSchema && responseJsonSchema) {
        payload.generationConfig.responseMimeType = 'application/json';
        payload.generationConfig.responseJsonSchema = responseJsonSchema;
    }

    const response = await axios.post(url, payload, {
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        timeout: GEMINI_TIMEOUT_MS
    });

    const text = extractGeminiText(response.data);
    if (!text) {
        throw new Error('Gemini returned an empty response.');
    }
    return text;
}

function extractGeminiText(data) {
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    const texts = [];

    for (const candidate of candidates) {
        const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
        for (const part of parts) {
            if (typeof part?.text === 'string' && part.text.trim()) {
                texts.push(part.text);
            }
        }
    }

    return texts.join('\n').trim();
}

function loadPromptTemplate(fileName) {
    if (PROMPT_CACHE.has(fileName)) {
        return PROMPT_CACHE.get(fileName);
    }

    const filePath = path.join(PROMPT_DIR, fileName);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Prompt file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    PROMPT_CACHE.set(fileName, content);
    return content;
}

function extractShortestPathContext(simulationResult) {
    const rawShortestPaths =
        simulationResult?.rawResult?.result?.shortest_paths ||
        simulationResult?.result?.shortest_paths ||
        simulationResult?.shortest_paths ||
        null;

    if (rawShortestPaths?.agents) {
        for (const agentData of Object.values(rawShortestPaths.agents)) {
            const entryPoint = agentData?.entry_points?.[0] || null;
            const goals = agentData?.goals || {};

            for (const [goalName, goalData] of Object.entries(goals)) {
                if (!goalData?.path_found) {
                    continue;
                }

                const fullPath = Array.isArray(goalData?.full_path)
                    ? goalData.full_path
                    : [];

                const entryAsset = toStepLabel(entryPoint?.full_name || entryPoint?.name);
                const targetAsset = toStepLabel(goalData?.goal?.full_name || goalName);
                const originalPath = normalizePathNodes(fullPath);
                const pathWithoutEntry = stripEntryStep(originalPath, entryAsset);
                const groupedPromptSteps = groupConsecutivePromptSteps(pathWithoutEntry);

                if (groupedPromptSteps.length === 0) {
                    throw new Error('Shortest path is empty after removing the entry asset.');
                }

                return {
                    entryAsset,
                    targetAsset,
                    originalPath,
                    promptSteps: groupedPromptSteps
                };
            }
        }
    }

    const fallbackPath = normalizePathNodes(
        simulationResult?.attackPath || simulationResult?.attack_path || []
    );

    if (fallbackPath.length > 0) {
        const entryAsset = fallbackPath[0].fullStep;
        const targetAsset = fallbackPath[fallbackPath.length - 1].fullStep;
        const promptSteps = groupConsecutivePromptSteps(stripEntryStep(fallbackPath, entryAsset));
        return {
            entryAsset,
            targetAsset,
            originalPath: fallbackPath,
            promptSteps
        };
    }

    throw new Error('No shortest path data found in simulationResult.');
}

function normalizePathNodes(pathNodes) {
    return pathNodes
        .map((node, index) => normalizePathNode(node, index))
        .filter(Boolean);
}

function normalizePathNode(node, index) {
    if (!node) {
        return null;
    }

    if (typeof node === 'string') {
        return buildPathNode(node, index);
    }

    const fullStep = toStepLabel(
        node.fullStep ||
        node.full_name ||
        (node.assetName && node.attackStep ? `${node.assetName}:${node.attackStep}` : node.name)
    );

    if (!fullStep) {
        return null;
    }

    const { assetName, attackStep } = splitAssetStep(fullStep);

    return {
        step: Number(node.step) || index + 1,
        assetName,
        attackStep,
        fullStep
    };
}

function buildPathNode(fullStep, index) {
    const normalized = toStepLabel(fullStep);
    const { assetName, attackStep } = splitAssetStep(normalized);
    return {
        step: index + 1,
        assetName,
        attackStep,
        fullStep: normalized
    };
}

function stripEntryStep(pathNodes, entryAsset) {
    if (!Array.isArray(pathNodes) || pathNodes.length === 0) {
        return [];
    }

    const normalizedEntry = toStepLabel(entryAsset);
    const [firstNode, ...rest] = pathNodes;

    if (firstNode?.fullStep === normalizedEntry) {
        return rest.map((node, index) => ({
            ...node,
            step: index + 1
        }));
    }

    return pathNodes.map((node, index) => ({
        ...node,
        step: index + 1
    }));
}

function groupConsecutivePromptSteps(pathNodes) {
    if (!Array.isArray(pathNodes) || pathNodes.length === 0) {
        return [];
    }

    const groups = [];

    for (const node of pathNodes) {
        if (!node?.assetName) {
            continue;
        }

        const cleanedStep = normalizePromptAttackStep(node.attackStep);
        const lastGroup = groups[groups.length - 1];

        if (lastGroup && lastGroup.assetName === node.assetName) {
            if (cleanedStep) {
                lastGroup.attackSteps.push(cleanedStep);
            }
            lastGroup.sourceSteps.push(node.fullStep);
            continue;
        }

        groups.push({
            step: groups.length + 1,
            assetName: node.assetName,
            attackSteps: cleanedStep ? [cleanedStep] : [],
            sourceSteps: [node.fullStep]
        });
    }

    return groups.map((group, index) => ({
        ...group,
        step: index + 1,
        fullStep: buildGroupedPromptLabel(group.assetName, group.attackSteps)
    }));
}

function buildGroupedPromptLabel(assetName, attackSteps) {
    if (!Array.isArray(attackSteps) || attackSteps.length === 0) {
        return assetName;
    }

    return `${assetName}: ${attackSteps.join(' -> ')}`;
}

function normalizePromptAttackStep(attackStep) {
    const normalized = toStepLabel(attackStep);
    if (!normalized) {
        return '';
    }

    return normalized.replace(/^\d+\s*:/, '').trim();
}

function formatShortestPathPromptBlock(context) {
    const attackPathLines = context.promptSteps.map((step, index) =>
        `Step ${index + 1}: ${step.fullStep}`
    );

    return [
        '<Entry_Asset>',
        context.entryAsset,
        '</Entry_Asset>',
        '<Target_Asset>',
        context.targetAsset,
        '</Target_Asset>',
        '<Attack_Path>',
        ...attackPathLines,
        '</Attack_Path>'
    ].join('\n');
}

function normalizeVerifiedScenario(result, shortestPathContext) {
    const entryAsset = pickValue(result, 'Entry_Asset') || shortestPathContext.entryAsset;
    const targetAsset = pickValue(result, 'Target_Asset') || shortestPathContext.targetAsset;
    const attackPath = pickValue(result, 'Attack_Path') || {};
    const scenarioLinkage = pickValue(result, 'Scenario_Linkage_Check') || {};

    return {
        Entry_Asset: entryAsset,
        Target_Asset: targetAsset,
        CIA_Attribute: pickValue(result, 'CIA_Attribute') || 'Integrity',
        Damage_Scenario: pickValue(result, 'Damage_Scenario') || '',
        Impact_Category: pickValue(result, 'Impact_Category') || 'Operational',
        Threat_Scenario: pickValue(result, 'Threat_Scenario') || '',
        Attack_Path: normalizeVerifiedPaths(attackPath),
        Scenario_Linkage_Check: {
            Damage_to_Threat_Consistency: pickValue(scenarioLinkage, 'Damage_to_Threat_Consistency') || 'Partially consistent',
            Threat_to_AttackPath_Consistency: pickValue(scenarioLinkage, 'Threat_to_AttackPath_Consistency') || 'Partially consistent',
            CIA_Consistency: pickValue(scenarioLinkage, 'CIA_Consistency') || 'Partially consistent',
            Notes: Array.isArray(scenarioLinkage.Notes) ? scenarioLinkage.Notes : []
        }
    };
}

function normalizeVerifiedPaths(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const entries = Object.entries(value)
        .filter(([, pathValue]) => pathValue && typeof pathValue === 'object')
        .sort(([leftKey], [rightKey]) => comparePathKeys(leftKey, rightKey));

    const normalized = {};
    for (const [key, pathValue] of entries) {
        normalized[key] = normalizeVerifiedPath(pathValue);
    }
    return normalized;
}

function buildAssessmentRowsFromScenario({
    sessionId,
    normalizedScenario,
    sourceShortestPath
}) {
    const analysisBatchId = randomUUID();
    const generatedPaths = normalizedScenario?.Attack_Path || {};
    const pathEntries = Object.entries(generatedPaths)
        .filter(([, pathValue]) => pathValue && typeof pathValue === 'object')
        .sort(([leftKey], [rightKey]) => comparePathKeys(leftKey, rightKey));

    if (pathEntries.length === 0) {
        return [{
            session_id: sessionId,
            entry_asset: normalizedScenario.Entry_Asset,
            target_asset: normalizedScenario.Target_Asset,
            cia_attribute: normalizedScenario.CIA_Attribute,
            damage_scenario: normalizedScenario.Damage_Scenario,
            impact_category: normalizedScenario.Impact_Category,
            threat_scenario: normalizedScenario.Threat_Scenario,
            attack_path: {
                analysis_batch_id: analysisBatchId,
                source_shortest_path: sourceShortestPath,
                generated_attack_paths: {},
                scenario_linkage_check: normalizedScenario.Scenario_Linkage_Check
            }
        }];
    }

    return pathEntries.map(([pathKey, pathValue]) => ({
        session_id: sessionId,
        entry_asset: normalizedScenario.Entry_Asset,
        target_asset: normalizedScenario.Target_Asset,
        cia_attribute: normalizedScenario.CIA_Attribute,
        damage_scenario: normalizedScenario.Damage_Scenario,
        impact_category: normalizedScenario.Impact_Category,
        threat_scenario: normalizedScenario.Threat_Scenario,
        attack_path: {
            analysis_batch_id: analysisBatchId,
            source_shortest_path: sourceShortestPath,
            generated_attack_paths: {
                [pathKey]: pathValue
            },
            scenario_linkage_check: normalizedScenario.Scenario_Linkage_Check
        }
    }));
}

function normalizeVerifiedPath(pathValue) {
    return {
        Realism_Assessment: pickValue(pathValue, 'Realism_Assessment') || 'Plausible with gaps',
        Completeness_Score_1to5: Number(pickValue(pathValue, 'Completeness_Score_1to5')) || 3,
        Expanded_Steps: normalizeExpandedSteps(pickValue(pathValue, 'Expanded_Steps')),
        Missing_Steps: Array.isArray(pathValue?.Missing_Steps) ? pathValue.Missing_Steps : [],
        Key_Assumptions: Array.isArray(pathValue?.Key_Assumptions) ? pathValue.Key_Assumptions : [],
        Evidence_Needed: Array.isArray(pathValue?.Evidence_Needed) ? pathValue.Evidence_Needed : [],
        Rewritten_Attack_Path: pickValue(pathValue, 'Rewritten_Attack_Path') || ''
    };
}

function normalizeExpandedSteps(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item, index) => ({
            Shortest_Path_Step: Number(pickValue(item, 'Shortest_Path_Step')) || index + 1,
            Shortest_Path_Node: pickValue(item, 'Shortest_Path_Node') || '',
            Expanded_Description: pickValue(item, 'Expanded_Description') || ''
        }))
        .filter((item) => item.Shortest_Path_Node || item.Expanded_Description);
}

function comparePathKeys(leftKey, rightKey) {
    const leftMatch = String(leftKey).match(/(\d+)$/);
    const rightMatch = String(rightKey).match(/(\d+)$/);

    if (leftMatch && rightMatch) {
        return Number(leftMatch[1]) - Number(rightMatch[1]);
    }

    return String(leftKey).localeCompare(String(rightKey));
}

function pickValue(source, key) {
    if (!source || typeof source !== 'object') {
        return null;
    }

    if (Object.prototype.hasOwnProperty.call(source, key)) {
        return source[key];
    }

    const lowerKey = key.toLowerCase();
    const matchedKey = Object.keys(source).find((candidate) => candidate.toLowerCase() === lowerKey);
    return matchedKey ? source[matchedKey] : null;
}

function parseJsonResponse(text) {
    const trimmed = text.trim();

    try {
        return JSON.parse(trimmed);
    } catch (_) {
        const withoutCodeFence = trimmed
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/, '')
            .trim();

        try {
            return JSON.parse(withoutCodeFence);
        } catch (_) {
            const jsonStart = withoutCodeFence.indexOf('{');
            const jsonEnd = withoutCodeFence.lastIndexOf('}');

            if (jsonStart >= 0 && jsonEnd > jsonStart) {
                return JSON.parse(withoutCodeFence.slice(jsonStart, jsonEnd + 1));
            }
        }
    }

    throw new Error('Failed to parse Gemini JSON response.');
}

function isStructuredOutputCompatibilityError(error) {
    const message =
        error?.response?.data?.error?.message ||
        error?.response?.data?.error?.status ||
        error?.message ||
        '';

    const normalized = String(message).toLowerCase();
    return (
        normalized.includes('responsejsonschema') ||
        normalized.includes('responsemimetype') ||
        normalized.includes('structured') ||
        normalized.includes('schema')
    );
}

function splitAssetStep(fullStep) {
    const normalized = toStepLabel(fullStep);
    const separatorIndex = normalized.indexOf(':');

    if (separatorIndex === -1) {
        return {
            assetName: normalized,
            attackStep: ''
        };
    }

    return {
        assetName: normalized.slice(0, separatorIndex),
        attackStep: normalized.slice(separatorIndex + 1)
    };
}

function toStepLabel(value) {
    return typeof value === 'string' ? value.trim() : '';
}

// CRUD 위임 함수들
async function getAllAssessments() {
    return taraAssessmentRepository.getAllAssessments();
}

async function getAssessmentsBySessionId(sessionId) {
    return taraAssessmentRepository.getAssessmentsBySessionId(sessionId);
}

async function getAssessmentById(id) {
    return taraAssessmentRepository.getAssessmentById(id);
}

async function updateAssessment(id, data) {
    return taraAssessmentRepository.updateAssessment(id, data);
}

function parseAttackPathPayload(attackPath) {
    if (!attackPath) return null;

    if (typeof attackPath === 'string') {
        try {
            return JSON.parse(attackPath);
        } catch (error) {
            throw new Error('Failed to parse assessment attack_path JSON.');
        }
    }

    return attackPath;
}

async function deleteAttackPathFromAssessment(id, attackPathKey) {
    const assessment = await taraAssessmentRepository.getAssessmentById(id);
    if (!assessment) {
        return null;
    }

    const parsedAttackPath = parseAttackPathPayload(assessment.attack_path);
    const generatedAttackPaths = parsedAttackPath?.generated_attack_paths;
    const hasGeneratedPaths =
        generatedAttackPaths &&
        typeof generatedAttackPaths === 'object' &&
        !Array.isArray(generatedAttackPaths);

    if (!hasGeneratedPaths || String(attackPathKey || '').startsWith('assessment_')) {
        const deleted = await taraAssessmentRepository.deleteAssessment(id);
        return deleted
            ? { action: 'deleted', assessment: deleted }
            : null;
    }

    if (!Object.prototype.hasOwnProperty.call(generatedAttackPaths, attackPathKey)) {
        throw new Error(`Attack path ${attackPathKey} not found in assessment ${id}.`);
    }

    const remainingAttackPaths = { ...generatedAttackPaths };
    delete remainingAttackPaths[attackPathKey];

    if (Object.keys(remainingAttackPaths).length === 0) {
        const deleted = await taraAssessmentRepository.deleteAssessment(id);
        return deleted
            ? { action: 'deleted', assessment: deleted }
            : null;
    }

    const updated = await taraAssessmentRepository.updateAssessmentAttackPath(id, {
        ...parsedAttackPath,
        generated_attack_paths: remainingAttackPaths
    });

    return updated
        ? { action: 'updated', assessment: updated }
        : null;
}

async function deleteAssessment(id) {
    return taraAssessmentRepository.deleteAssessment(id);
}

async function deleteAssessmentsBySessionId(sessionId) {
    return taraAssessmentRepository.deleteAssessmentsBySessionId(sessionId);
}

module.exports = {
    analyzeThreatWithLLM,
    getAllAssessments,
    getAssessmentsBySessionId,
    getAssessmentById,
    updateAssessment,
    deleteAttackPathFromAssessment,
    deleteAssessment,
    deleteAssessmentsBySessionId
};

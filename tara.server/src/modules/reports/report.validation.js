import { GenerationResult, VerificationResult, VERIFICATION_CHECKS } from './report.schema.js'

export class ReportError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Expose field locations and server-owned reasons, never raw provider values,
// Zod messages (which can contain literals), credentials or response bodies.
export function resultSchemaError(error, kind = 'scenario', status = 502) {
  let issue = error.issues[0]
  const parentPath = []
  // A candidate is either undetermined damage or a named damage scenario.
  // Point to the closest branch's field instead of the whole anyOf object.
  while (issue?.code === 'invalid_union' && issue.errors?.length) {
    parentPath.push(...issue.path)
    issue = [...issue.errors].sort((left, right) => left.length - right.length)[0][0]
  }
  const field =
    [...parentPath, ...(issue?.path || [])].reduce(
      (path, key) =>
        typeof key === 'number' ? `${path}[${key}]` : `${path}${path ? '.' : ''}${key}`,
      '',
    ) || 'result'
  return new ReportError(status, `The LLM ${kind} has an invalid format at ${field}. Please retry.`)
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, max = 1000) => typeof value === 'string' && value.trim() && value.length <= max
const cia = ['Confidentiality', 'Integrity', 'Availability']

// Validate a full dependency witness. Consecutive steps may be separate AND
// branches: adjacency of a single Entry-to-Target route is not sufficient.
export function validateReportInput(input) {
  const invalid = () => {
    throw new ReportError(
      400,
      'Provide a complete simulation prerequisite trace with satisfied MAL AND/OR conditions, recorded iterations and a CIA attribute.',
    )
  }
  if (
    !object(input) ||
    input.pathKind !== 'simulation-prerequisite-trace' ||
    !cia.includes(input.ciaAttribute) ||
    typeof input.context !== 'string' ||
    input.context.length > 6000 ||
    !Array.isArray(input.path) ||
    !input.path.length ||
    input.path.length > 201 ||
    new Set(input.path).size !== input.path.length ||
    !object(input.graph) ||
    !Array.isArray(input.graph.nodes) ||
    !input.graph.nodes.length ||
    input.graph.nodes.length > 1000 ||
    !Array.isArray(input.graph.edges) ||
    input.graph.edges.length > 4000 ||
    !Array.isArray(input.graph.entryIds) ||
    input.graph.entryIds.length > 1000
  )
    invalid()
  const nodes = input.graph.nodes.map((node) => {
    if (
      !object(node) ||
      !text(node.id) ||
      !text(node.label) ||
      !text(node.asset) ||
      !text(node.assetType) ||
      (node.description != null &&
        (typeof node.description !== 'string' || node.description.length > 6000)) ||
      !['and', 'or'].includes(node.type) ||
      !Number.isInteger(node.performedAt) ||
      node.performedAt < 0 ||
      !object(node.prerequisites) ||
      typeof node.prerequisites.blocked !== 'boolean' ||
      !Array.isArray(node.prerequisites.parentIds) ||
      node.prerequisites.parentIds.length > 4000 ||
      !Array.isArray(node.prerequisites.necessaryParentIds) ||
      node.prerequisites.necessaryParentIds.length > 4000 ||
      node.prerequisites.parentIds.some((id) => !text(id)) ||
      node.prerequisites.necessaryParentIds.some((id) => !node.prerequisites.parentIds.includes(id))
    )
      invalid()
    return {
      id: node.id,
      label: node.label,
      asset: node.asset,
      assetType: node.assetType,
      ...(node.description !== undefined ? { description: node.description?.trim() || null } : {}),
      type: node.type,
      performedAt: node.performedAt,
      prerequisites: {
        parentIds: [...node.prerequisites.parentIds],
        necessaryParentIds: [...node.prerequisites.necessaryParentIds],
        blocked: node.prerequisites.blocked,
      },
    }
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const entries = input.graph.entryIds
  if (
    byId.size !== nodes.length ||
    input.path.length !== nodes.length ||
    !entries.length ||
    entries.some((id) => !byId.has(id)) ||
    input.path.some((id) => !byId.has(id)) ||
    !entries.includes(input.path[0]) ||
    input.path.at(-1) !== input.graph.targetId
  )
    invalid()
  const edges = input.graph.edges.map((edge) => {
    if (
      !object(edge) ||
      !byId.has(edge.source) ||
      !byId.has(edge.target) ||
      entries.includes(edge.target)
    )
      invalid()
    const sourceAt = byId.get(edge.source).performedAt,
      targetAt = byId.get(edge.target).performedAt
    if (sourceAt !== null && targetAt !== null && sourceAt > targetAt) invalid()
    return { source: edge.source, target: edge.target }
  })
  const incoming = new Map(nodes.map((node) => [node.id, new Set()]))
  for (const edge of edges) incoming.get(edge.target).add(edge.source)
  const reached = new Set()
  let iteration = -1
  for (const id of input.path) {
    const node = byId.get(id),
      rule = node.prerequisites,
      parents = incoming.get(id)
    if (node.performedAt < iteration) invalid()
    if (
      !entries.includes(id) &&
      (rule.blocked ||
        !parents.size ||
        [...parents].some((parent) => !reached.has(parent) || !rule.parentIds.includes(parent)) ||
        (node.type === 'and' && rule.necessaryParentIds.some((parent) => !parents.has(parent))))
    )
      invalid()
    reached.add(id)
    iteration = node.performedAt
  }
  const relevant = new Set(),
    pending = [input.graph.targetId]
  while (pending.length) {
    const id = pending.pop()
    if (relevant.has(id)) continue
    relevant.add(id)
    pending.push(...incoming.get(id))
  }
  if (relevant.size !== nodes.length) invalid()
  const simulation = input.simulation
  if (
    !object(simulation) ||
    !text(simulation.attackerType, 100) ||
    typeof simulation.partial !== 'boolean' ||
    !text(simulation.stopReason, 100)
  )
    invalid()
  return {
    pathKind: input.pathKind,
    ciaAttribute: input.ciaAttribute,
    context: input.context.trim(),
    path: [...input.path],
    graph: { nodes, edges, entryIds: [...entries], targetId: input.graph.targetId },
    simulation: {
      attackerType: simulation.attackerType,
      partial: simulation.partial,
      stopReason: simulation.stopReason,
    },
  }
}

export function scenarioContext(input) {
  const byId = new Map(input.graph.nodes.map((node) => [node.id, node]))
  const stepNumbers = new Map(input.path.map((id, i) => [id, i + 1]))
  const entryAssets = [...new Set(input.graph.entryIds.map((id) => byId.get(id).asset))]
  const parents = new Map(input.path.map((id) => [id, []]))
  for (const edge of input.graph.edges) parents.get(edge.target).push(stepNumbers.get(edge.source))
  const entry = input.graph.entryIds.map((id) => byId.get(id).label).join(', ')
  return {
    Original_MAL_Path: {
      Entry: entry,
      Goal: byId.get(input.graph.targetId).label,
      Steps: input.path.map((id, i) => `Step ${i + 1}: ${byId.get(id).label}`),
    },
    Item_Definition: input.context ? { User_Provided_Context: input.context } : null,
    Asset_Register: null,
    MAL_Semantics: null,
    Configuration_Evidence: null,
    Max_Scenario_Candidates: 3,
    Requested_CIA_Attribute: input.ciaAttribute,
    Entry_Asset: entry,
    Entry_Assets: entryAssets,
    Target_Asset: byId.get(input.path.at(-1)).asset,
    CIA_Attribute: input.ciaAttribute,
    Attack_Path: input.path.map((id, i) => ({
      Shortest_Path_Step: i + 1,
      Shortest_Path_Node: byId.get(id).label,
      Asset: byId.get(id).asset,
      Asset_Type: byId.get(id).assetType,
      Description: byId.get(id).description ?? null,
      Iteration: byId.get(id).performedAt,
      Operator: byId.get(id).type.toUpperCase(),
      Is_Initial_Entry: input.graph.entryIds.includes(id),
      Supporting_Steps: parents.get(id),
      Required_AND_Steps:
        !input.graph.entryIds.includes(id) && byId.get(id).type === 'and'
          ? byId.get(id).prerequisites.necessaryParentIds.map((parent) => stepNumbers.get(parent))
          : [],
    })),
    Path_Semantics:
      'Prerequisite-complete witness over recorded compromises; not a shortest path or a unique causal trace. Same-iteration ordering is a valid dependency ordering, not a recorded execution order.',
    System_Context: input.context,
    Simulation: input.simulation,
    Performed_Graph: input.graph,
  }
}

export function validateScenario(value, input, status = 502) {
  const fail = (field, reason) => {
    throw new ReportError(
      status,
      `The LLM scenario is invalid at ${field}: ${reason}. Please retry.`,
    )
  }
  const parsed = GenerationResult.safeParse(value)
  if (!parsed.success) throw resultSchemaError(parsed.error, 'scenario', status)
  const scenario = parsed.data
  const context = scenarioContext(input)
  if (scenario.Entry_Asset !== context.Original_MAL_Path.Entry)
    fail('Entry_Asset', 'the original entry node labels were changed')
  if (scenario.Goal_Node !== context.Original_MAL_Path.Goal)
    fail('Goal_Node', 'the original goal node was changed')
  if (scenario.Target_Asset !== context.Target_Asset)
    fail('Target_Asset', 'the original target asset was changed')
  if (scenario.Expanded_Steps.length !== input.path.length)
    fail(
      'Expanded_Steps',
      `expected ${input.path.length} original steps, received ${scenario.Expanded_Steps.length}`,
    )
  if (
    new Set(scenario.Scenario_Candidates.map((candidate) => candidate.Scenario_ID)).size !==
    scenario.Scenario_Candidates.length
  )
    fail('Scenario_Candidates', 'candidate IDs must be unique')
  scenario.Expanded_Steps.forEach((step, i) => {
    const field = `Expanded_Steps[${i}]`
    if (step.Shortest_Path_Step !== i + 1)
      fail(`${field}.Shortest_Path_Step`, 'the original step order or numbering was changed')
    if (step.Shortest_Path_Node !== context.Attack_Path[i].Shortest_Path_Node)
      fail(`${field}.Shortest_Path_Node`, 'the original node label was changed')
    if (!step.Expanded_Description.trim())
      fail(`${field}.Expanded_Description`, 'the step description is blank')
  })
  for (const [i, candidate] of scenario.Scenario_Candidates.entries()) {
    const field = `Scenario_Candidates[${i}]`
    if (!candidate.Scenario_ID.trim()) fail(`${field}.Scenario_ID`, 'the candidate ID is blank')
    if (candidate.Target_Asset !== context.Target_Asset)
      fail(`${field}.Target_Asset`, 'the original target asset was changed')
    if (new Set(candidate.Impact_Categories).size !== candidate.Impact_Categories.length)
      fail(`${field}.Impact_Categories`, 'impact categories must be unique')
    if (candidate.Damage_Scenario === null) {
      if (candidate.Affected_Road_Users.length)
        fail(`${field}.Affected_Road_Users`, 'road users must be empty when damage is undetermined')
      if (candidate.Impact_Categories.length)
        fail(
          `${field}.Impact_Categories`,
          'impact categories must be empty when damage is undetermined',
        )
      if (candidate.Support_Level !== 'UNDETERMINED')
        fail(`${field}.Support_Level`, 'support must be UNDETERMINED when damage is undetermined')
    } else {
      if (!candidate.Target_Function?.trim())
        fail(`${field}.Target_Function`, 'a damage scenario needs a named vehicle function')
      if (!candidate.Affected_Road_Users.length)
        fail(
          `${field}.Affected_Road_Users`,
          'a damage scenario needs at least one affected road user',
        )
    }
  }
  return scenario
}

export function validateVerification(value, scenario) {
  const fail = () => {
    throw new ReportError(
      502,
      'The LLM returned an incomplete or mismatched scenario verification. Please retry.',
    )
  }
  const parsed = VerificationResult.safeParse(value)
  if (!parsed.success) fail()
  const verification = parsed.data
  const candidateIds = new Set(
    scenario.Scenario_Candidates.map((candidate) => candidate.Scenario_ID),
  )
  const checks = new Set(verification.Checks.map((check) => check.Check))
  const reviewedIds = new Set(verification.Candidate_Verifications.map((item) => item.Scenario_ID))
  if (
    checks.size !== VERIFICATION_CHECKS.length ||
    verification.Candidate_Verifications.length !== candidateIds.size ||
    reviewedIds.size !== candidateIds.size ||
    [...reviewedIds].some((id) => !candidateIds.has(id)) ||
    (verification.Overall_Verdict === 'PASS' &&
      (!verification.Path_Structure_Valid ||
        verification.Checks.some((check) => check.Status !== 'PASS') ||
        verification.Candidate_Verifications.some((candidate) => candidate.Verdict !== 'PASS')))
  )
    fail()
  return verification
}

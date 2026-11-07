import { z } from 'zod'

const text = z.string().min(1).max(20000)
const label = z.string().min(1).max(1000)
const notes = z.array(text).max(100)

const expandedStep = z.strictObject({
  Shortest_Path_Step: z.number().int().min(1).max(201),
  Shortest_Path_Node: label,
  Expanded_Description: text,
  Evidence_Class: z.enum(['DIRECT', 'MODEL_SEMANTIC', 'ASSUMED', 'UNKNOWN']),
  Assumptions: notes,
})

const candidate = z.strictObject({
  Scenario_ID: label,
  Target_Asset: label,
  Target_Function: text.nullable(),
  CIA_Attribute: z.enum(['Confidentiality', 'Integrity', 'Availability', 'Undetermined']),
  Cause_Of_Compromise: text.nullable(),
  Threat_Scenario: text.nullable(),
  Damage_Scenario: text.nullable(),
  Affected_Road_Users: notes,
  Impact_Categories: z.array(z.enum(['Safety', 'Financial', 'Operational', 'Privacy'])).max(4),
  Post_Goal_Action: text.nullable(),
  Causal_Link: text.nullable(),
  Evidence_References: notes,
  Assumptions: notes,
  Missing_Evidence: notes,
  Support_Level: z.enum(['SUPPORTED', 'CONDITIONAL', 'UNDETERMINED']),
})

function candidateForTarget(targetAsset) {
  const fixed = candidate.extend({ Target_Asset: z.literal(targetAsset) })
  return z.union([
    fixed.extend({
      Damage_Scenario: z.null(),
      Affected_Road_Users: notes.length(0),
      Impact_Categories: candidate.shape.Impact_Categories.length(0),
      Support_Level: z.literal('UNDETERMINED'),
    }),
    fixed.extend({
      Damage_Scenario: text,
      Target_Function: text,
      Affected_Road_Users: notes.min(1),
    }),
  ])
}

// All fields are required; unknown evidence is represented explicitly by null or [].
export const GenerationResult = z.strictObject({
  Entry_Asset: z.string().min(1).max(201000),
  Goal_Node: label,
  Target_Asset: label,
  Model_Outcome: z.enum([
    'ACCESS_CAPABILITY_ONLY',
    'PROPERTY_COMPROMISE_MODELED',
    'VEHICLE_EFFECT_MODELED',
    'UNDETERMINED',
  ]),
  Entry_Vector: text.nullable(),
  Expanded_Steps: z.array(expandedStep).min(1).max(201),
  Scenario_Candidates: z.array(candidate).max(3),
  Model_Limitations: notes,
  Need_Additional_Context: notes,
})

export function generationResultForContext(context) {
  const steps = context.Attack_Path
  return GenerationResult.extend({
    Entry_Asset: z.literal(context.Original_MAL_Path.Entry),
    Goal_Node: z.literal(context.Original_MAL_Path.Goal),
    Target_Asset: z.literal(context.Target_Asset),
    Expanded_Steps: z
      .array(
        expandedStep.extend({
          Shortest_Path_Step: z.number().int().min(1).max(steps.length),
          Shortest_Path_Node: z.enum([...new Set(steps.map((step) => step.Shortest_Path_Node))]),
        }),
      )
      .length(steps.length),
    Scenario_Candidates: z.array(candidateForTarget(context.Target_Asset)).max(3),
  })
}

export const VERIFICATION_CHECKS = [
  'BACKBONE',
  'MAL_SEMANTICS',
  'ENTRY_VECTOR',
  'VULNERABILITY',
  'AUTHENTICATION_AND_NETWORK',
  'GOAL_VS_EFFECT',
  'THREAT_DEFINITION',
  'DAMAGE_DEFINITION',
  'CIA_AND_SFOP',
  'EVIDENCE_AND_ASSUMPTIONS',
  'ONE_PATH_NOT_THREE',
  'SYSTEM_STATE',
]
const verdict = z.enum(['PASS', 'CONDITIONAL', 'REJECT'])

export const VerificationResult = z.strictObject({
  Overall_Verdict: verdict,
  Path_Structure_Valid: z.boolean(),
  Checks: z
    .array(
      z.strictObject({
        Check: z.enum(VERIFICATION_CHECKS),
        Status: z.enum(['PASS', 'CONDITIONAL', 'FAIL', 'NOT_ASSESSABLE']),
        Note: text,
        Evidence_References: notes,
      }),
    )
    .length(VERIFICATION_CHECKS.length),
  Candidate_Verifications: z
    .array(
      z.strictObject({
        Scenario_ID: label,
        Verdict: verdict,
        Reason: text,
        Unsupported_Claims: notes,
        Required_Evidence: notes,
        Proposed_Changes: notes,
      }),
    )
    .max(3),
  Model_Gaps: notes,
})

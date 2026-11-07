// Keep the full graph at the API boundary, but send each label and dependency
// only once to the LLM. Arrows are used only for recorded same-asset edges.
const inline = (value) =>
  /[\r\n"\\]| -> |Step \d+:|^\s|\s$/.test(value) ? JSON.stringify(value) : value

export function formatScenarioInput(context, draft) {
  const steps = context.Attack_Path
  const lines = [
    'Original_MAL_Path:',
    `Entry: ${inline(context.Original_MAL_Path.Entry)}`,
    `Goal: ${inline(context.Original_MAL_Path.Goal)}`,
    `Target_Asset: ${inline(context.Target_Asset)}`,
    `Requested_CIA_Attribute: ${context.Requested_CIA_Attribute}`,
    `Step_Count: ${steps.length}`,
    '----------------------------------------------------------',
  ]
  let previous
  for (const step of steps) {
    const node = { asset: step.Asset, assetType: step.Asset_Type }
    const prefix = `${node.asset}:`
    const canChain =
      previous &&
      previous.node.asset === node.asset &&
      previous.node.assetType === node.assetType &&
      previous.step.Shortest_Path_Node.startsWith(prefix) &&
      step.Shortest_Path_Node.startsWith(prefix) &&
      !step.Is_Initial_Entry &&
      step.Supporting_Steps.length === 1 &&
      step.Supporting_Steps[0] === previous.step.Shortest_Path_Step
    if (canChain)
      lines[lines.length - 1] +=
        ` -> Step ${step.Shortest_Path_Step}: ${inline(step.Shortest_Path_Node.slice(prefix.length))}`
    else
      lines.push(
        `Step ${step.Shortest_Path_Step}: [${inline(node.assetType)}] ${inline(step.Shortest_Path_Node)}`,
      )
    previous = { step, node }
  }
  // Repeated instances of a modeled step can share documentation. Keep exact
  // step references while sending each asset type/description pair only once.
  const descriptions = new Map()
  for (const step of steps) {
    const description = step.Description ?? null
    const key = JSON.stringify([step.Asset_Type, description])
    if (!descriptions.has(key))
      descriptions.set(key, { Steps: [], Asset_Type: step.Asset_Type, Description: description })
    descriptions.get(key).Steps.push(step.Shortest_Path_Step)
  }
  lines.push(
    '',
    'Prerequisites (step@iteration OP; support=recorded parents; required=mandatory AND inputs):',
    ...steps.map((step) =>
      step.Is_Initial_Entry
        ? `${step.Shortest_Path_Step}@${step.Iteration} ENTRY`
        : `${step.Shortest_Path_Step}@${step.Iteration} ${step.Operator} support=${step.Supporting_Steps.join(',')}` +
          (step.Operator === 'AND'
            ? ` required=${step.Required_AND_Steps.join(',') || 'none'}`
            : ''),
    ),
    '',
    'Attack_Step_Context (model documentation; Steps references original step numbers):',
    ...[...descriptions.values()].map((item) => JSON.stringify(item)),
    '',
    `Item_Definition: ${JSON.stringify(context.Item_Definition)}`,
    'Asset_Register: null',
    'MAL_Semantics: null',
    'Configuration_Evidence: null',
    `Simulation: ${JSON.stringify(context.Simulation)}`,
    `Max_Scenario_Candidates: ${context.Max_Scenario_Candidates}`,
  )
  if (draft) lines.push('', `Generation_Result: ${JSON.stringify(draft)}`)
  return lines.join('\n')
}

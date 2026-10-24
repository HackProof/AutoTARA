export function normalizeEndpointSteps(steps) {
  if (
    !Array.isArray(steps) ||
    steps.some(
      (step) =>
        typeof step?.attackStepId !== 'string' ||
        !step.attackStepId.trim() ||
        typeof step.name !== 'string' ||
        !step.name.trim(),
    )
  ) {
    throw new Error('Attack endpoints must contain an Attack Step ID and name.')
  }
  return [
    ...new Map(
      steps.map(({ attackStepId, name }) => [attackStepId, { attackStepId, name }]),
    ).values(),
  ].sort((a, b) => a.attackStepId.localeCompare(b.attackStepId))
}

// Keep catalog IDs for inherited steps and names for subsequent path analysis.
export function normalizeAttackEndpoints(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Attack endpoint metadata must be a mapping of DB schemas.')
  return Object.fromEntries(
    Object.entries(data).flatMap(([schema, endpoints]) => {
      if (!schema.trim() || !endpoints || typeof endpoints !== 'object' || Array.isArray(endpoints))
        throw new Error('Attack endpoint metadata must define a valid DB schema.')
      const entry = normalizeEndpointSteps(endpoints.entry ?? [])
      const target = normalizeEndpointSteps(endpoints.target ?? [])
      return entry.length || target.length ? [[schema, { entry, target }]] : []
    }),
  )
}

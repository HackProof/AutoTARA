export const ATTACK_STEP_CATEGORIES = [
  {
    value: 'attack_behavior',
    label: 'Attack behavior',
    description: 'A concrete attack action.',
  },
  {
    value: 'acquired_or_induced_state',
    label: 'Acquired or induced state',
    description: 'Access, privileges, control, or an outcome produced by an attack.',
  },
  {
    value: 'attack_attempt',
    label: 'Attack attempt',
    description: 'An initial attempt before a specific attack method or outcome is established.',
  },
  {
    value: 'auxiliary_step',
    label: 'Auxiliary step',
    description: 'A modeling helper for conditions, transitions, or delegated behavior.',
  },
]

// Display metadata only. Classification never controls CTSA eligibility or score.
// Determine mapping from the current relations, not the seed's review status.
export function describeAttackStep(threat) {
  const category = ATTACK_STEP_CATEGORIES.find((item) => item.value === threat.semantic_category)
  const mapped = Boolean(
    threat.techniques?.some((item) => item.id) ||
    threat.technique_mappings?.some((item) => item.mitre_technique_id),
  )
  const outsideCatalog = String(threat.attack_step_id || '').startsWith('LangGraph:')
  const reason =
    threat.mitre_unmapped_reason?.trim() ||
    (outsideCatalog
      ? 'This step is declared in the attached language model but is not registered in the current ATKB catalog. Its classification and MITRE mapping need review.'
      : 'The current catalog has no MITRE ATT&CK mapping for this step, and no step-specific reason has been recorded yet.')
  return {
    category: category?.value || '',
    label: category?.label || 'Unclassified',
    description: category?.description || 'Classification review required.',
    rationale: threat.classification_reason || '',
    source: threat.classification_source || '',
    version: threat.classification_version || '',
    mapped,
    unmappedReason: mapped ? '' : reason,
  }
}

export function filterCtsaThreats(threats, { category = '', mapping = '', search = '' } = {}) {
  const query = search.trim().toLocaleLowerCase()
  return threats.filter((threat) => {
    const info = describeAttackStep(threat)
    return (
      (!category || (category === 'unclassified' ? !info.category : info.category === category)) &&
      (!mapping || info.mapped === (mapping === 'mapped')) &&
      (!query ||
        [
          threat.name,
          threat.qualified_name,
          threat.attack_step_id,
          threat.definition,
          info.label,
          info.description,
        ].some((value) =>
          String(value || '')
            .toLocaleLowerCase()
            .includes(query),
        ))
    )
  })
}

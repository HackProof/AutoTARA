// Model defense values are activation probabilities. Only 0/1 resolve to a
// deterministic state; missing, null and fractional values remain unknown.
export function normalizeDefenseStates(values = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new Error('Defense states must be a mapping of step names to values from 0 to 1 or null.')
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      if (
        !name.trim() ||
        (value !== null &&
          typeof value !== 'boolean' &&
          !(Number.isFinite(value) && value >= 0 && value <= 1))
      )
        throw new Error('Defense states must be values from 0 to 1 or null.')
      return [name, typeof value === 'boolean' ? Number(value) : value]
    }),
  )
}

export function resolveDefenseStatus(value) {
  if (value === 0 || value === false) return false
  if (value === 1 || value === true) return true
  return null
}

export function defenseStatusFromTtc(ttc) {
  if (ttc?.type !== 'function') return null
  if (ttc.name === 'Enabled') return true
  if (ttc.name === 'Disabled') return false
  if (ttc.name === 'Bernoulli') return resolveDefenseStatus(ttc.arguments?.[0])
  return null
}

export function readDefenseStates(value) {
  const raw = value?.nodeType === 1 ? value.getAttribute('taraDefenseStates') : null
  if (!raw) return {}
  try {
    return normalizeDefenseStates(JSON.parse(raw))
  } catch (error) {
    throw new Error(`Invalid saved Defense states: ${error.message}`, { cause: error })
  }
}

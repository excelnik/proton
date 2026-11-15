// Shared rule scope checks. A missing context value never satisfies a rule that constrains it.
function ruleMatchesContext(rule, context = {}) {
  if (rule.enabled === 0 || rule.enabled === false) return false
  if (rule.account_id != null && (!context.accountId || Number(rule.account_id) !== Number(context.accountId))) return false
  if (rule.min_amount != null && (context.amount == null || context.amount < Number(rule.min_amount))) return false
  if (rule.max_amount != null && (context.amount == null || context.amount > Number(rule.max_amount))) return false
  if (rule.valid_from && (!context.date || context.date < rule.valid_from)) return false
  if (rule.valid_to && (!context.date || context.date > rule.valid_to)) return false
  return true
}

function filterEligibleRules(rules, context = {}) {
  return (rules || []).filter(rule => ruleMatchesContext(rule, context))
}

const STOP_WORDS = new Set([
  'בעמ', 'בע"מ', 'חברה', 'עוסק', 'מורשה', 'בע', 'של', 'את', 'על', 'עם', 'ltd', 'inc',
])

function normalizeMerchantName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^א-תa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(word => word.startsWith('ה') && word.length > 3 ? word.slice(1) : word)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word))
    .join(' ')
}

function merchantTokens(value) {
  const normalized = normalizeMerchantName(value)
  return normalized ? normalized.split(/\s+/) : []
}

function tokenSimilarity(a, b) {
  if (a === b) return 1
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) return 0.85
  return 0
}

function scoreMerchantRule(merchant, rule) {
  const normalizedMerchant = normalizeMerchantName(merchant)
  const normalizedRule = normalizeMerchantName(rule.original_string)
  if (!normalizedMerchant || !normalizedRule) return 0
  if (normalizedMerchant === normalizedRule) return 1

  const merchantWords = merchantTokens(merchant)
  const ruleWords = merchantTokens(rule.original_string)
  if (!merchantWords.length || !ruleWords.length) return 0

  let matchedMerchant = 0
  const matchedRuleWords = new Set()
  for (const word of merchantWords) {
    let best = 0
    let bestRuleWord = null
    for (const ruleWord of ruleWords) {
      const similarity = tokenSimilarity(word, ruleWord)
      if (similarity > best) {
        best = similarity
        bestRuleWord = ruleWord
      }
    }
    if (best > 0) {
      matchedMerchant += best
      matchedRuleWords.add(bestRuleWord)
    }
  }

  const merchantCoverage = matchedMerchant / merchantWords.length
  const ruleCoverage = matchedRuleWords.size / ruleWords.length
  return merchantCoverage * 0.7 + ruleCoverage * 0.3
}

function findMerchantRuleConflicts(merchant, rules, context = {}) {
  if (!normalizeMerchantName(merchant)) return []
  const candidates = filterEligibleRules(rules, context)
    .map(rule => ({ rule, score: scoreMerchantRule(merchant, rule) }))
    .filter(item => item.score >= 0.62)
    .sort((a, b) => b.score - a.score ||
      (Number(b.rule.priority) || 0) - (Number(a.rule.priority) || 0))
  if (candidates.length < 2) return []
  const [best, second] = candidates
  if (best.score - second.score >= 0.15 ||
      Number(best.rule.category_id) === Number(second.rule.category_id)) return []
  return candidates
    .filter(item => best.score - item.score < 0.15 &&
      Number(item.rule.category_id) !== Number(best.rule.category_id))
    .map(item => ({ ...item.rule, _matchScore: item.score }))
}

function findScopedMerchantRule(merchant, rules, context = {}) {
  const eligible = filterEligibleRules(rules, context)
  const rule = findBestMerchantRule(merchant, eligible)
  if (rule) return { rule, outOfScope: false }
  const conflicts = findMerchantRuleConflicts(merchant, eligible, context)
  if (conflicts.length) return { rule: null, outOfScope: false, conflicts }
  return { rule: null, outOfScope: Boolean(findBestMerchantRule(merchant, rules)) }
}

function findBestMerchantRule(merchant, rules) {
  if (!normalizeMerchantName(merchant)) return null
  const candidates = (rules || [])
    .map(rule => ({ rule, score: scoreMerchantRule(merchant, rule) }))
    .filter(item => item.score >= 0.62)
    .sort((a, b) => b.score - a.score ||
      (Number(b.rule.priority) || 0) - (Number(a.rule.priority) || 0) ||
      (Number(b.rule.use_count) || 0) - (Number(a.rule.use_count) || 0))

  if (!candidates.length) return null
  const best = candidates[0]
  const second = candidates[1]
  if (second && best.score - second.score < 0.15 &&
      Number(best.rule.category_id) !== Number(second.rule.category_id)) {
    return null
  }
  return { ...best.rule, _matchScore: best.score }
}

module.exports = {
  ruleMatchesContext,
  filterEligibleRules,
  normalizeMerchantName,
  scoreMerchantRule,
  findBestMerchantRule,
  findScopedMerchantRule,
  findMerchantRuleConflicts,
}

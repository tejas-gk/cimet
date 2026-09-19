/**
 * Deterministic text helpers for the AI Quality Auditor.
 *
 * Token-level similarity for verbatim script checks, and normalisers used
 * when comparing spoken facts (LLM-extracted) against CRM / plan values.
 */

// ---------------------------------------------------------------------------
// Text normalization + similarity
// ---------------------------------------------------------------------------

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function tokenize(input: string): string[] {
  const normalized = normalizeText(input)
  return normalized ? normalized.split(" ") : []
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

/** Dice coefficient on token bags. */
function diceCoefficient(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0
  const countsA = countTokens(a)
  const countsB = countTokens(b)
  let overlap = 0
  for (const [token, countA] of countsA) {
    overlap += Math.min(countA, countsB.get(token) ?? 0)
  }
  return (2 * overlap) / (a.length + b.length)
}

/** How many expected tokens appear in the candidate (bag-of-words recall). */
function tokenRecall(expected: string[], candidate: string[]): number {
  if (expected.length === 0) return 1
  const counts = countTokens(candidate)
  const covered = expected.reduce(
    (sum, token) => sum + ((counts.get(token) ?? 0 > 0) ? 1 : 0),
    0
  )
  return covered / expected.length
}

/**
 * Similarity in [0,1] between an approved phrase and a spoken candidate.
 *
 * For verbatim script checks: measures how much of the approved wording
 * survived (recall) blended with token overlap (Dice).  ~1.0 = identical,
 * ~0.85 = same wording with minor paraphrase, <0.65 = substantially different.
 */
export function phraseSimilarity(expected: string, candidate: string): number {
  const tokensA = tokenize(expected)
  const tokensB = tokenize(candidate)
  const dice = diceCoefficient(tokensA, tokensB)
  const recall = tokenRecall(tokensA, tokensB)
  return Math.max(dice, recall)
}

// ---------------------------------------------------------------------------
// Fact value normalizers (spoken → canonical form)
// ---------------------------------------------------------------------------

export type NormalizeKind =
  | "email"
  | "digits"
  | "postcode"
  | "date"
  | "float"
  | "integer"
  | "boolean"
  | "phone"
  | "address"
  | "text"

export function normalizeEmail(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\band\b/g, "@")
    .replace(/[^a-z0-9@.+-]/g, "")
}

export function normalizeDigits(input: string): string {
  return (input ?? "").replace(/\D/g, "")
}

export function normalizeFloat(input: string): number | null {
  const cleaned = String(input).replace(/[^0-9.]/g, "")
  const value = parseFloat(cleaned)
  return Number.isFinite(value) ? value : null
}

function expandAddressAbbr(input: string): string {
  return normalizeText(input)
    .replace(/\bst\b/g, "street")
    .replace(/\brd\b/g, "road")
    .replace(/\bave?\b/g, "avenue")
    .replace(/\bhwy\b/g, "highway")
    .replace(/\bdr\b/g, "drive")
    .replace(/\bct\b/g, "court")
    .replace(/\bpl\b/g, "place")
    .replace(/\bln\b/g, "lane")
}

/** Light address normalization: lowercase, expand abbreviations, strip punctuation. */
export function normalizeAddress(input: string): string {
  return expandAddressAbbr(input)
}

/**
 * Normalize a value to a canonical comparable form.
 * Returns null if the input is empty / unparseable.
 */
export function normalizeValue(
  kind: NormalizeKind,
  input: string
): string | null {
  const raw = String(input ?? "").trim()
  if (!raw) return null

  switch (kind) {
    case "email":
      return normalizeEmail(raw) || null
    case "digits":
      return normalizeDigits(raw) || null
    case "postcode":
      return normalizeDigits(raw).slice(0, 4) || null
    case "date":
      // Accept yyyy-mm-dd or dd/mm/yyyy or spoken "12 April 1995" → YYYYMMDD
      return normalizeDigits(raw).slice(0, 8) || null
    case "float": {
      const v = normalizeFloat(raw)
      return v === null ? null : String(v)
    }
    case "integer": {
      const v = normalizeFloat(raw)
      return v === null ? null : String(Math.round(v))
    }
    case "boolean": {
      const normalized = raw.toLowerCase()
      if (/^(yes|y|true|1|correct)$/.test(normalized)) return "yes"
      if (/^(no|n|false|0)$/.test(normalized)) return "no"
      return normalized || null
    }
    case "phone":
      return normalizeDigits(raw) || null
    case "address":
      return normalizeAddress(raw) || null
    case "text":
    default:
      return normalizeText(raw) || null
  }
}

/** Compare two normalized values.  For addresses allow >= 0.85 similarity. */
export function valuesMatch(
  kind: NormalizeKind,
  spoken: string,
  expected: string
): boolean {
  if (kind === "address") {
    const sim = phraseSimilarity(expected, spoken)
    return sim >= 0.85
  }
  return spoken === expected
}

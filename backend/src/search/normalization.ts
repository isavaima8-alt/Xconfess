/**
 * Multilingual normalization and tokenization for search queries and indexed text.
 *
 * Goals:
 * - Fold Unicode forms (NFKC) so composed/decomposed input matches.
 * - Fold diacritics for languages where they are not semantically significant.
 * - Apply language-specific token boundaries (e.g. CJK, Thai) while keeping
 *   safe fallbacks for unknown languages.
 * - Never throw on malformed input; degrade to a conservative fallback.
 */

export type SupportedLanguage =
  | 'en'
  | 'es'
  | 'fr'
  | 'de'
  | 'pt'
  | 'ru'
  | 'ar'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'th';

export interface NormalizationOptions {
  /** BCP-47-ish language tag; unknown values fall back to the default profile. */
  language?: string;
  /** When false, diacritics are preserved (e.g. for languages where they matter). */
  foldDiacritics?: boolean;
}

export interface NormalizationResult {
  /** Normalized text suitable for indexing or query matching. */
  normalized: string;
  /** Tokenized form of the normalized text. */
  tokens: string[];
  /** Language profile actually applied (may be the fallback). */
  language: SupportedLanguage | 'default';
  /** True when the requested language was not recognized and a fallback was used. */
  usedFallback: boolean;
}

interface LanguageProfile {
  /** Whether diacritics should be folded by default for this language. */
  foldDiacritics: boolean;
  /** Regex used to split tokens; must be applied to NFKC-normalized text. */
  tokenPattern: RegExp;
}

// Combining diacritical marks block (U+0300–U+036F) plus common extended marks.
const DIACRITIC_PATTERN = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff]/g;

// CJK / Thai scripts have no whitespace word boundaries; tokenize per character
// (or per grapheme cluster) so substring matching remains meaningful.
const CJK_CHAR_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const THAI_CHAR_PATTERN = /[\u0e00-\u0e7f]/u;

const WORD_TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

const PROFILES: Record<SupportedLanguage, LanguageProfile> = {
  en: { foldDiacritics: true, tokenPattern: WORD_TOKEN_PATTERN },
  es: { foldDiacritics: true, tokenPattern: WORD_TOKEN_PATTERN },
  fr: { foldDiacritics: true, tokenPattern: WORD_TOKEN_PATTERN },
  de: { foldDiacritics: true, tokenPattern: WORD_TOKEN_PATTERN },
  pt: { foldDiacritics: true, tokenPattern: WORD_TOKEN_PATTERN },
  ru: { foldDiacritics: true, tokenPattern: WORD_TOKEN_PATTERN },
  ar: { foldDiacritics: true, tokenPattern: WORD_TOKEN_PATTERN },
  zh: { foldDiacritics: false, tokenPattern: WORD_TOKEN_PATTERN },
  ja: { foldDiacritics: false, tokenPattern: WORD_TOKEN_PATTERN },
  ko: { foldDiacritics: false, tokenPattern: WORD_TOKEN_PATTERN },
  th: { foldDiacritics: false, tokenPattern: WORD_TOKEN_PATTERN },
};

const DEFAULT_PROFILE: LanguageProfile = {
  foldDiacritics: true,
  tokenPattern: WORD_TOKEN_PATTERN,
};

function resolveLanguage(
  language: string | undefined,
): { profile: LanguageProfile; language: SupportedLanguage | 'default'; usedFallback: boolean } {
  if (!language || typeof language !== 'string') {
    return { profile: DEFAULT_PROFILE, language: 'default', usedFallback: true };
  }
  // Accept tags like "en-US" or "zh_Hans" by taking the primary subtag.
  const primary = language.trim().toLowerCase().split(/[-_]/)[0];
  if (primary && Object.prototype.hasOwnProperty.call(PROFILES, primary)) {
    return {
      profile: PROFILES[primary as SupportedLanguage],
      language: primary as SupportedLanguage,
      usedFallback: false,
    };
  }
  return { profile: DEFAULT_PROFILE, language: 'default', usedFallback: true };
}

function foldDiacritics(text: string): string {
  // NFD splits base characters from combining marks so they can be stripped.
  return text.normalize('NFD').replace(DIACRITIC_PATTERN, '').normalize('NFC');
}

function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  // Split on whitespace first, then further split CJK/Thai runs per character
  // while keeping contiguous Latin/Cyrillic/Arabic words intact.
  for (const chunk of text.split(/\s+/)) {
    if (!chunk) continue;
    if (CJK_CHAR_PATTERN.test(chunk) || THAI_CHAR_PATTERN.test(chunk)) {
      for (const char of chunk) {
        if (CJK_CHAR_PATTERN.test(char) || THAI_CHAR_PATTERN.test(char)) {
          tokens.push(char);
        } else {
          const matches = char.match(WORD_TOKEN_PATTERN);
          if (matches) tokens.push(...matches);
        }
      }
    } else {
      const matches = chunk.match(WORD_TOKEN_PATTERN);
      if (matches) tokens.push(...matches);
    }
  }
  return tokens;
}

/**
 * Normalize and tokenize text for search. Never throws: malformed input
 * (lone surrogates, invalid sequences) is coerced to a string and normalized
 * with the fallback profile.
 */
export function normalizeForSearch(
  input: unknown,
  options: NormalizationOptions = {},
): NormalizationResult {
  const { profile, language, usedFallback } = resolveLanguage(options.language);
  const fold = options.foldDiacritics ?? profile.foldDiacritics;

  let text: string;
  try {
    text = typeof input === 'string' ? input : input == null ? '' : String(input);
  } catch {
    text = '';
  }

  let normalized: string;
  try {
    // NFKC unifies compatibility forms (full-width, ligatures) before folding.
    normalized = text.normalize('NFKC');
    if (fold) normalized = foldDiacritics(normalized);
    normalized = normalized.toLowerCase().trim();
  } catch {
    // Malformed input: fall back to a conservative lowercase trim.
    normalized = text.toLowerCase().trim();
  }

  let tokens: string[];
  try {
    tokens = tokenize(normalized);
  } catch {
    tokens = normalized ? normalized.split(/\s+/).filter(Boolean) : [];
  }

  return { normalized, tokens, language, usedFallback };
}

/** Convenience helper for indexing pipelines. */
export function normalizeIndexedText(
  input: unknown,
  options: NormalizationOptions = {},
): string {
  return normalizeForSearch(input, options).normalized;
}

/** Convenience helper for query pipelines. */
export function normalizeQuery(
  input: unknown,
  options: NormalizationOptions = {},
): string[] {
  return normalizeForSearch(input, options).tokens;
}

/**
 * Ranking configuration parameters that affect feed ordering. These are the
 * versioned knobs a staged rollout can compare and roll back.
 */
export interface RankingParameters {
  /** Weight applied to lexical/token overlap between query and document. */
  lexicalWeight: number;
  /** Weight applied to recency decay. */
  recencyWeight: number;
  /** Weight applied to engagement signals. */
  engagementWeight: number;
  /** Half-life (in hours) for recency decay; must be > 0. */
  recencyHalfLifeHours: number;
}

/** A versioned, immutable ranking configuration snapshot. */
export interface RankingConfigVersion {
  /** Monotonic version identifier; each change is identifiable and reversible. */
  version: number;
  /** Human-readable label for the change (e.g. PR or ticket reference). */
  label: string;
  parameters: RankingParameters;
}

/** A single isolated fixture used to compare candidate vs current configs. */
export interface RankingFixture {
  id: string;
  /** Relevance score in [0, 1] the ideal ranking would assign. */
  relevance: number;
  /** Age of the item in hours (drives recency decay). */
  ageHours: number;
  /** Engagement score in [0, 1]. */
  engagement: number;
  /** Lexical/token overlap score in [0, 1]. */
  lexical: number;
}

/** Observable rollout/rollback criteria for a staged rollout. */
export interface RolloutCriteria {
  /** Maximum allowed mean absolute score delta per fixture before rollout is blocked. */
  maxMeanAbsDelta: number;
  /** Maximum allowed fraction of fixtures whose rank order flips. */
  maxRankFlipRatio: number;
}

export interface RankingComparison {
  /** Mean absolute score delta between candidate and current across fixtures. */
  meanAbsDelta: number;
  /** Fraction of fixtures whose relative rank order changed. */
  rankFlipRatio: number;
  /** True when both observable criteria are within bounds. */
  withinBounds: boolean;
  /** Per-fixture deltas for observability/debugging. */
  deltas: Array<{ id: string; current: number; candidate: number; delta: number }>;
}

export type RolloutDecision =
  | { action: 'rollout'; comparison: RankingComparison }
  | { action: 'rollback'; comparison: RankingComparison; reason: string };

const DEFAULT_ROLLOUT_CRITERIA: RolloutCriteria = {
  maxMeanAbsDelta: 0.15,
  maxRankFlipRatio: 0.25,
};

function assertFiniteNonNegative(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ranking parameter "${name}": expected finite non-negative number`);
  }
}

/**
 * Validate ranking parameters. Throws on invalid input so a bad configuration
 * fails fast at the owning boundary rather than silently degrading the feed.
 */
export function validateRankingParameters(parameters: RankingParameters): void {
  assertFiniteNonNegative(parameters.lexicalWeight, 'lexicalWeight');
  assertFiniteNonNegative(parameters.recencyWeight, 'recencyWeight');
  assertFiniteNonNegative(parameters.engagementWeight, 'engagementWeight');
  if (
    typeof parameters.recencyHalfLifeHours !== 'number' ||
    !Number.isFinite(parameters.recencyHalfLifeHours) ||
    parameters.recencyHalfLifeHours <= 0
  ) {
    throw new Error('Invalid ranking parameter "recencyHalfLifeHours": expected finite positive number');
  }
}

/**
 * Create a new versioned ranking configuration. Each call yields a distinct,
 * immutable snapshot so changes are identifiable and reversible.
 */
export function createRankingConfigVersion(
  version: number,
  label: string,
  parameters: RankingParameters,
): RankingConfigVersion {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('Invalid ranking config version: expected positive integer');
  }
  validateRankingParameters(parameters);
  return Object.freeze({
    version,
    label,
    parameters: Object.freeze({ ...parameters }),
  });
}

/** Score a fixture under a given ranking configuration. */
export function scoreFixture(fixture: RankingFixture, parameters: RankingParameters): number {
  const decay = Math.pow(0.5, fixture.ageHours / parameters.recencyHalfLifeHours);
  return (
    parameters.lexicalWeight * fixture.lexical +
    parameters.recencyWeight * decay +
    parameters.engagementWeight * fixture.engagement
  );
}

/**
 * Compare a candidate configuration against the current one on an isolated
 * fixture set. Pure and side-effect free so it can run before any rollout.
 */
export function compareRankingConfigs(
  current: RankingConfigVersion,
  candidate: RankingConfigVersion,
  fixtures: RankingFixture[],
  criteria: RolloutCriteria = DEFAULT_ROLLOUT_CRITERIA,
): RankingComparison {
  validateRankingParameters(current.parameters);
  validateRankingParameters(candidate.parameters);

  const deltas = fixtures.map((fixture) => {
    const currentScore = scoreFixture(fixture, current.parameters);
    const candidateScore = scoreFixture(fixture, candidate.parameters);
    return {
      id: fixture.id,
      current: currentScore,
      candidate: candidateScore,
      delta: candidateScore - currentScore,
    };
  });

  const meanAbsDelta =
    deltas.length === 0
      ? 0
      : deltas.reduce((sum, d) => sum + Math.abs(d.delta), 0) / deltas.length;

  // Rank flip: relative order of a fixture pair changes between configs.
  let flips = 0;
  let pairs = 0;
  for (let i = 0; i < deltas.length; i += 1) {
    for (let j = i + 1; j < deltas.length; j += 1) {
      pairs += 1;
      const currentOrder = Math.sign(deltas[i].current - deltas[j].current);
      const candidateOrder = Math.sign(deltas[i].candidate - deltas[j].candidate);
      if (currentOrder !== candidateOrder) flips += 1;
    }
  }
  const rankFlipRatio = pairs === 0 ? 0 : flips / pairs;

  const withinBounds =
    meanAbsDelta <= criteria.maxMeanAbsDelta && rankFlipRatio <= criteria.maxRankFlipRatio;

  return { meanAbsDelta, rankFlipRatio, withinBounds, deltas };
}

/**
 * Decide whether to roll out or roll back a candidate configuration based on
 * observable criteria. Rollback is the default on any out-of-bounds signal.
 */
export function decideRollout(
  current: RankingConfigVersion,
  candidate: RankingConfigVersion,
  fixtures: RankingFixture[],
  criteria: RolloutCriteria = DEFAULT_ROLLOUT_CRITERIA,
): RolloutDecision {
  const comparison = compareRankingConfigs(current, candidate, fixtures, criteria);
  if (comparison.withinBounds) {
    return { action: 'rollout', comparison };
  }
  const reason =
    comparison.meanAbsDelta > criteria.maxMeanAbsDelta
      ? `mean absolute delta ${comparison.meanAbsDelta.toFixed(4)} exceeds ${criteria.maxMeanAbsDelta}`
      : `rank flip ratio ${comparison.rankFlipRatio.toFixed(4)} exceeds ${criteria.maxRankFlipRatio}`;
  return { action: 'rollback', comparison, reason };
}

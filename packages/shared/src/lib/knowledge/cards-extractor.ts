/**
 * LLM card extractor.
 * Renders the V0 ontology into a JSON-only system prompt, calls the chat model
 * (structured output), then validates each card against the ontology (kind
 * rules + validateTriple + confidence ≥ 0.5). Invalid cards are dropped, not
 * persisted with free-form text. The llm client is imported lazily so the pure
 * validation logic is testable without a live chat backend.
 */

import type { CardInput } from "@agenticmind/shared/database/query/knowledge/cards"
import type { CardKind } from "@agenticmind/shared/lib/knowledge/card"

import {
  CARDS_MAX_BODY_CHARS,
  CURRENT_EXTRACTOR_VERSION,
  isCardKind,
  MAX_CARDS_PER_MATERIAL,
} from "@agenticmind/shared/lib/knowledge/card"
import {
  getPredicate,
  isValidSubjectType,
  listPredicates,
  listTypes,
  validateTriple,
} from "@agenticmind/shared/lib/knowledge/ontology"
import { okAsync, ResultAsync } from "neverthrow"
import * as z from "zod"

export const rawCardSchema = z.object({
  kind: z.string(),
  subject_type: z.string(),
  subject_value: z.string(),
  predicate: z.string().nullish(),
  value: z.string().nullish(),
  body: z.string(),
  question: z.string().nullish(),
  span_start: z.number().int().nullish(),
  span_end: z.number().int().nullish(),
  confidence: z.number().nullish(),
})

export const rawExtractionSchema = z.object({ cards: z.array(rawCardSchema) })

export type RawCard = z.infer<typeof rawCardSchema>

/** Renders the ontology types + predicates into the extraction system prompt. */
export const buildExtractionPrompt = (): string => {
  const typeLines = listTypes()
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n")
  const predLines = listPredicates()
    .map((p) => {
      const obj =
        p.objectKind === "entity"
          ? ` (object: one of ${p.objectTypes.join(",")})`
          : p.objectKind === "string"
            ? " (object: free string)"
            : " (object: number)"
      return `- ${p.name}: subject ∈ {${p.subjectTypes.join(",")}}${obj} — ${p.description}`
    })
    .join("\n")

  return `You extract typed knowledge cards from one document for a knowledge
base. The cards become structured artifacts that an agent
consumes directly without re-reading the original document.

Respond with ONLY a JSON object — no markdown fences, no prose, no preamble.
The shape is:

{
  "cards": [
    {
      "kind":          "fact" | "qa" | "definition" | "metric" | "procedure",
      "subject_type":  "<one of the allowed entity types listed below>",
      "subject_value": "<canonical name or identifier of the subject>",
      "predicate":     "<one of the allowed predicates listed below; OMIT for kinds qa, definition, procedure>",
      "value":         "<object side of the triple; OMIT for kinds qa, definition, procedure>",
      "body":          "<one-paragraph human-readable rendering of the card>",
      "question":      "<question text; only for kind=qa, OMIT otherwise>",
      "span_start":    <int byte offset into Document body where this card's evidence starts; OMIT if synthetic>,
      "span_end":      <int byte offset where evidence ends; OMIT if synthetic>,
      "confidence":    0.0..1.0
    }
  ]
}

Confidence semantics:
- 0.9+ : verbatim explicit statement in the text
- 0.7..0.89 : explicit statement requiring light parsing/normalising
- 0.5..0.69 : reasonable inference from context (not stated outright)
- below 0.5 : weak signal — DO NOT EMIT, skip the card entirely

Allowed entity types (subject_type):
${typeLines}

Allowed predicates (use only when kind=fact or kind=metric):
${predLines}

Rules:
- Only emit cards whose evidence is actually in the Document. No outside knowledge.
- For kind=fact, predicate AND value MUST be set, AND the predicate must
  accept the chosen subject_type (see allowed types above).
- For kind=metric, the value must include a number with units, e.g. "7%"
  or "$1.5M" or "2005".
- For kind=qa, set "question" and "body" (the answer); leave predicate/value out.
- For kind=definition, body is a one-paragraph definition; subject_type +
  subject_value identify what's being defined. Leave predicate/value out.
- For kind=procedure, body is an ordered list as plain text
  ("1. Do X\n2. Do Y\n..."). subject_type/subject_value identify the
  procedure (e.g. subject_type=Topic, subject_value="Onboarding").
- Cap output at ${MAX_CARDS_PER_MATERIAL} cards. Pick the most informative ones if you'd otherwise emit more.
- If the document has nothing extractable, return {"cards":[]}.`
}

const buildUserPrompt = (title: string, body: string): string => {
  const runes = Array.from(body)
  const truncated =
    runes.length > CARDS_MAX_BODY_CHARS
      ? `${runes.slice(0, CARDS_MAX_BODY_CHARS).join("")}\n[…truncated…]`
      : body
  const titleLine = title !== "" ? `Title: ${title}\n\n` : ""
  return `${titleLine}Document:\n${truncated}`
}

const predicateAcceptsSubject = (predicate: string, subjectType: string): boolean =>
  getPredicate(predicate)?.subjectTypes.includes(subjectType) ?? false

/**
 * Validates one raw card against the V0 ontology + kind rules. Returns a
 * persist-ready CardInput (extractorVersion stamped, embedding pending) or null
 * to drop.
 */
export const validateRawCard = (rc: RawCard): CardInput | null => {
  if (!isCardKind(rc.kind)) {
    return null
  }
  if (!isValidSubjectType(rc.subject_type)) {
    return null
  }
  const subjectValue = rc.subject_value.trim()
  if (subjectValue === "") {
    return null
  }
  const body = rc.body.trim()
  if (body === "") {
    return null
  }

  let confidence = rc.confidence ?? 0
  if (confidence < 0.5) {
    return null
  }
  if (confidence > 1) {
    confidence = 1
  }

  const kind: CardKind = rc.kind
  const base: CardInput = {
    kind,
    subjectType: rc.subject_type,
    subjectValue,
    body,
    confidence,
    spanStart: rc.span_start ?? null,
    spanEnd: rc.span_end ?? null,
    extractorVersion: CURRENT_EXTRACTOR_VERSION,
  }

  if (kind === "fact" || kind === "metric") {
    const predicate = (rc.predicate ?? "").trim()
    const value = (rc.value ?? "").trim()
    if (predicate === "" || value === "") {
      return null
    }
    // Value is free-text in V0, so we pass "" as objectType. If the strict
    // Triple check fails, fall back to requiring only subject acceptance.
    if (
      validateTriple(rc.subject_type, predicate, "") !== null &&
      !predicateAcceptsSubject(predicate, rc.subject_type)
    ) {
      return null
    }
    return { ...base, predicate, value }
  }
  if (kind === "qa") {
    const question = (rc.question ?? "").trim()
    if (question === "") {
      return null
    }
    return { ...base, question }
  }
  // Definition / procedure / resolution: no extra shape requirements.
  return base
}

/** Parses + validates a model extraction response into persist-ready cards. */
export const validateExtraction = (raw: { cards: RawCard[] }): CardInput[] => {
  const out: CardInput[] = []
  for (const rc of raw.cards) {
    const card = validateRawCard(rc)
    if (card !== null) {
      out.push(card)
    }
    if (out.length >= MAX_CARDS_PER_MATERIAL) {
      break
    }
  }
  return out
}

export type CardsExtractError = { readonly type: string; readonly message: string }

/**
 * Extracts typed cards from material text via the LLM. Returns persist-ready
 * CardInput[] (embeddings pending — the caller embeds bodies before upsert).
 * Empty body → []. The llm client is imported lazily so this module's
 * validation stays env-free for unit tests.
 */
export const extractCards = (props: {
  materialTitle: string
  body: string
}): ResultAsync<CardInput[], CardsExtractError> => {
  const body = props.body.trim()
  if (body === "") {
    return okAsync<CardInput[], CardsExtractError>([])
  }
  return ResultAsync.fromPromise(
    import("@agenticmind/shared/lib/knowledge/llm"),
    (e): CardsExtractError => {
      return { type: "import_error", message: String(e) }
    },
  ).andThen((m) =>
    m
      .completeKnowledgeJson({
        system: buildExtractionPrompt(),
        user: buildUserPrompt(props.materialTitle, body),
        schema: rawExtractionSchema,
        purpose: "knowledge cards extraction",
      })
      .map((raw) => validateExtraction(raw))
      .mapErr((e): CardsExtractError => {
        return { type: e.type, message: e.message }
      }),
  )
}

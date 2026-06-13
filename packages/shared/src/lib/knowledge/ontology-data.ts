/**
 * Ontology V0 — frozen vocabulary (types + predicates).
 *
 * The entity ids and validation are frozen so cards validate against one
 * identical vocabulary. Frozen 2026-05-05 — changes after this require a
 * major bump to V1. This is an example, general-purpose knowledge ontology;
 * swap it for your own domain's vocabulary.
 */

export const ONTOLOGY_VERSION = "V0"
export const ONTOLOGY_FROZEN_AT = "2026-05-05"

export type ObjectKind = "entity" | "string" | "number"
export type EntityPrimary = "db" | "materials" | "vocab"

export type EntityType = {
  name: string
  label: string
  primary: EntityPrimary
  dbTable: string | null
  dbFields?: string[]
  description: string
}

export type Predicate = {
  name: string
  group: string
  subjectTypes: string[]
  objectKind: ObjectKind
  objectTypes: string[]
  description: string
}

export const ENTITY_TYPES: readonly EntityType[] = [
  {
    name: "Person",
    label: "Person",
    primary: "db",
    dbTable: "Person",
    description: "An individual (employee, member, contributor, contact — via role flags)",
  },
  {
    name: "Organization",
    label: "Organization",
    primary: "db",
    dbTable: "Organization",
    description:
      "A company, institution, or other legal entity. DB for identity fields; materials for narrative enrichment.",
  },
  {
    name: "Topic",
    label: "Topic",
    primary: "db",
    dbTable: "Topic",
    description: "A thematic cluster or subject area",
  },
  {
    name: "Program",
    label: "Program",
    primary: "materials",
    dbTable: null,
    description: "An external program, course, or initiative",
  },
  {
    name: "Field",
    label: "Field",
    primary: "vocab",
    dbTable: null,
    description:
      "A sector / domain / discipline (software, finance, healthcare). Seeded from Person.field.",
  },
  {
    name: "Stage",
    label: "Stage",
    primary: "vocab",
    dbTable: null,
    description: "A lifecycle stage (early, active, mature, archived)",
  },
  {
    name: "Skill",
    label: "Skill",
    primary: "vocab",
    dbTable: null,
    description: "A professional skill / expertise. Seeded from Person.expertise + materials.",
  },
  {
    name: "Location",
    label: "Location",
    primary: "vocab",
    dbTable: null,
    description: "A city or country (Berlin, London, EU). Seeded from Person.locationCity.",
  },
  {
    name: "Provider",
    label: "Provider",
    primary: "db",
    dbTable: "Provider",
    description: "A service provider / partner",
  },
  {
    name: "Event",
    label: "Event",
    primary: "db",
    dbTable: "Event",
    description: "A meetup / conference / recurring gathering",
  },
  {
    name: "Goal",
    label: "Goal",
    primary: "db",
    dbTable: "Person",
    dbFields: ["objectives", "interests"],
    description:
      "A long-term goal of a person/organization. DB primary via Person fields; materials as narrative enrichment.",
  },
  {
    name: "Challenge",
    label: "Challenge",
    primary: "db",
    dbTable: "Person",
    dbFields: ["challenges"],
    description:
      "A current blocker / unsolved problem. DB primary via Person.challenges; materials as enrichment.",
  },
]

export const PREDICATES: readonly Predicate[] = [
  // Identity & membership
  {
    name: "works_at",
    group: "identity",
    subjectTypes: ["Person"],
    objectKind: "entity",
    objectTypes: ["Organization"],
    description: "Person is currently employed at Organization",
  },
  {
    name: "created",
    group: "identity",
    subjectTypes: ["Person"],
    objectKind: "entity",
    objectTypes: ["Organization"],
    description: "Person created / established Organization",
  },
  {
    name: "member_of",
    group: "identity",
    subjectTypes: ["Person"],
    objectKind: "entity",
    objectTypes: ["Topic"],
    description: "Person belongs to Topic",
  },
  {
    name: "has_role",
    group: "identity",
    subjectTypes: ["Person"],
    objectKind: "string",
    objectTypes: [],
    description: "Person's role label (e.g. lead / admin / contributor)",
  },
  {
    name: "attended_program",
    group: "identity",
    subjectTypes: ["Person", "Organization"],
    objectKind: "entity",
    objectTypes: ["Program"],
    description: "Person or Organization went through Program",
  },
  // Domain & expertise
  {
    name: "focuses_on",
    group: "domain",
    subjectTypes: ["Organization", "Topic"],
    objectKind: "entity",
    objectTypes: ["Field"],
    description: "Subject's primary field focus",
  },
  {
    name: "has_skill",
    group: "domain",
    subjectTypes: ["Person"],
    objectKind: "entity",
    objectTypes: ["Skill"],
    description: "Person has the named skill / expertise",
  },
  {
    name: "built_with",
    group: "domain",
    subjectTypes: ["Organization"],
    objectKind: "entity",
    objectTypes: ["Skill"],
    description: "Organization's product is built with the named technology / skill",
  },
  {
    name: "relates_to_field",
    group: "domain",
    subjectTypes: ["Organization", "Provider"],
    objectKind: "entity",
    objectTypes: ["Field"],
    description: "Subject's target field (vs focuses_on which is about activity)",
  },
  {
    name: "at_stage",
    group: "domain",
    subjectTypes: ["Organization"],
    objectKind: "entity",
    objectTypes: ["Stage"],
    description: "Organization's current stage",
  },
  {
    name: "serves",
    group: "domain",
    subjectTypes: ["Organization", "Provider"],
    objectKind: "string",
    objectTypes: [],
    description: "Customer segment served (e.g. B2C / B2B / SMB / Enterprise)",
  },
  // Location
  {
    name: "located_in",
    group: "location",
    subjectTypes: ["Person", "Organization", "Provider"],
    objectKind: "entity",
    objectTypes: ["Location"],
    description: "Subject's primary location",
  },
  {
    name: "operates_in",
    group: "location",
    subjectTypes: ["Organization", "Provider"],
    objectKind: "entity",
    objectTypes: ["Location"],
    description: "Subject conducts business in this location (may differ from located_in)",
  },
  {
    name: "event_held_in",
    group: "location",
    subjectTypes: ["Event"],
    objectKind: "entity",
    objectTypes: ["Location"],
    description: "Event takes place in Location",
  },
  // Relations
  {
    name: "connected_to",
    group: "relations",
    subjectTypes: ["Person"],
    objectKind: "entity",
    objectTypes: ["Person"],
    description:
      "Any recorded connection between two people (symmetric semantically; stored directed)",
  },
  {
    name: "mentored_by",
    group: "relations",
    subjectTypes: ["Person"],
    objectKind: "entity",
    objectTypes: ["Person"],
    description: "Person is mentored by another Person",
  },
  {
    name: "attended_event",
    group: "relations",
    subjectTypes: ["Person"],
    objectKind: "entity",
    objectTypes: ["Event"],
    description: "Person attended Event",
  },
  // Partnerships
  {
    name: "partnered_with",
    group: "business",
    subjectTypes: ["Provider"],
    objectKind: "entity",
    objectTypes: ["Provider", "Topic"],
    description: "Provider has a partnership with another Provider or Topic",
  },
  // Goals & challenges
  {
    name: "pursues_goal",
    group: "goals",
    subjectTypes: ["Person", "Organization"],
    objectKind: "entity",
    objectTypes: ["Goal"],
    description: "Subject is actively pursuing Goal",
  },
  {
    name: "faces_challenge",
    group: "goals",
    subjectTypes: ["Person", "Organization"],
    objectKind: "entity",
    objectTypes: ["Challenge"],
    description: "Subject is currently facing Challenge",
  },
  {
    name: "seeks_skill",
    group: "goals",
    subjectTypes: ["Person"],
    objectKind: "entity",
    objectTypes: ["Skill"],
    description: "Person is looking for someone with the named skill (looking-for)",
  },
]

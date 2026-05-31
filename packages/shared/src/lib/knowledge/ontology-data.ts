/**
 * Ontology V0 — frozen vocabulary (types + predicates).
 *
 * The entity ids and validation are frozen so cards / graphrag / qaplan all
 * validate against one identical vocabulary. Frozen 2026-05-05 — changes after
 * this require a major bump to V1. This is an example knowledge ontology
 * (a startup-community domain); swap it for your own domain's vocabulary.
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
    name: "Member",
    label: "Member",
    primary: "db",
    dbTable: "Member",
    description: "A community member (founder, admin, mentor, investor — via role flags)",
  },
  {
    name: "Company",
    label: "Company",
    primary: "db",
    dbTable: "Company",
    description:
      "A legal entity or product startup. DB for identity fields; materials for narrative enrichment.",
  },
  {
    name: "Hub",
    label: "Hub",
    primary: "db",
    dbTable: "Hub",
    description: "A thematic community cluster",
  },
  {
    name: "Program",
    label: "Program",
    primary: "materials",
    dbTable: null,
    description: "An external accelerator/program (YC, Antler, Techstars, MBA courses)",
  },
  {
    name: "Industry",
    label: "Industry",
    primary: "vocab",
    dbTable: null,
    description: "A sector/vertical (B2B SaaS, fintech, health-tech). Seeded from Member.industry.",
  },
  {
    name: "Stage",
    label: "Stage",
    primary: "vocab",
    dbTable: null,
    description: "A company's stage (idea, pre-seed, seed, series-A, growth, exit)",
  },
  {
    name: "Skill",
    label: "Skill",
    primary: "vocab",
    dbTable: null,
    description: "A professional skill/expertise. Seeded from Member.expertise + materials.",
  },
  {
    name: "Location",
    label: "Location",
    primary: "vocab",
    dbTable: null,
    description:
      "A city or country (Cyprus, Limassol, London, EU). Seeded from Member.locationCity.",
  },
  {
    name: "Deal",
    label: "Deal",
    primary: "db",
    dbTable: "Deal",
    description: "A partner perk / benefit offered by a provider",
  },
  {
    name: "Provider",
    label: "Provider",
    primary: "db",
    dbTable: "Provider",
    description: "A service provider / community partner",
  },
  {
    name: "Event",
    label: "Event",
    primary: "db",
    dbTable: "CommunityEvent",
    description: "A meetup / conference / recurring ritual",
  },
  {
    name: "Intro",
    label: "Intro",
    primary: "db",
    dbTable: "Intro",
    description: "A recorded introduction between two Members",
  },
  {
    name: "Goal",
    label: "Goal",
    primary: "db",
    dbTable: "Member",
    dbFields: ["expectations", "partnershipInterests", "fundraisingStage", "investmentIndustries"],
    description:
      "A long-term goal of a member/company. DB primary via Member fields; materials as narrative enrichment.",
  },
  {
    name: "Challenge",
    label: "Challenge",
    primary: "db",
    dbTable: "Member",
    dbFields: ["challenges"],
    description:
      "A current blocker / unsolved problem. DB primary via Member.challenges; materials as enrichment.",
  },
]

export const PREDICATES: readonly Predicate[] = [
  // Identity & membership
  {
    name: "works_at",
    group: "identity",
    subjectTypes: ["Member"],
    objectKind: "entity",
    objectTypes: ["Company"],
    description: "Member is currently employed at Company",
  },
  {
    name: "founded",
    group: "identity",
    subjectTypes: ["Member"],
    objectKind: "entity",
    objectTypes: ["Company"],
    description: "Member is a founder of Company",
  },
  {
    name: "member_of",
    group: "identity",
    subjectTypes: ["Member"],
    objectKind: "entity",
    objectTypes: ["Hub"],
    description: "Member belongs to Hub",
  },
  {
    name: "has_role",
    group: "identity",
    subjectTypes: ["Member"],
    objectKind: "string",
    objectTypes: [],
    description: "Member's role label (founder / admin / mentor / investor)",
  },
  {
    name: "attended_program",
    group: "identity",
    subjectTypes: ["Member", "Company"],
    objectKind: "entity",
    objectTypes: ["Program"],
    description: "Member or Company went through Program",
  },
  // Domain & expertise
  {
    name: "focuses_on",
    group: "domain",
    subjectTypes: ["Company", "Hub"],
    objectKind: "entity",
    objectTypes: ["Industry"],
    description: "Subject's primary industry focus",
  },
  {
    name: "has_skill",
    group: "domain",
    subjectTypes: ["Member"],
    objectKind: "entity",
    objectTypes: ["Skill"],
    description: "Member has the named skill / expertise",
  },
  {
    name: "built_with",
    group: "domain",
    subjectTypes: ["Company"],
    objectKind: "entity",
    objectTypes: ["Skill"],
    description: "Company's product is built with the named technology / skill",
  },
  {
    name: "targets_industry",
    group: "domain",
    subjectTypes: ["Company", "Provider"],
    objectKind: "entity",
    objectTypes: ["Industry"],
    description: "Subject's customer industry (vs focuses_on which is about activity)",
  },
  {
    name: "at_stage",
    group: "domain",
    subjectTypes: ["Company"],
    objectKind: "entity",
    objectTypes: ["Stage"],
    description: "Company's current stage",
  },
  {
    name: "serves_segment",
    group: "domain",
    subjectTypes: ["Company", "Provider"],
    objectKind: "string",
    objectTypes: [],
    description: "Customer segment (B2C / B2B / B2G / SMB / Enterprise)",
  },
  // Location
  {
    name: "located_in",
    group: "location",
    subjectTypes: ["Member", "Company", "Provider"],
    objectKind: "entity",
    objectTypes: ["Location"],
    description: "Subject's primary location",
  },
  {
    name: "operates_in",
    group: "location",
    subjectTypes: ["Company", "Provider"],
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
    subjectTypes: ["Member"],
    objectKind: "entity",
    objectTypes: ["Member"],
    description:
      "Any recorded connection between two members (symmetric semantically; stored directed)",
  },
  {
    name: "mentored_by",
    group: "relations",
    subjectTypes: ["Member"],
    objectKind: "entity",
    objectTypes: ["Member"],
    description: "Member is mentored by another Member",
  },
  {
    name: "introduced_to",
    group: "relations",
    subjectTypes: ["Member"],
    objectKind: "entity",
    objectTypes: ["Member"],
    description: "Member was introduced to another Member (via Intro)",
  },
  {
    name: "attended_event",
    group: "relations",
    subjectTypes: ["Member"],
    objectKind: "entity",
    objectTypes: ["Event"],
    description: "Member attended Event",
  },
  // Business & deals
  {
    name: "offers_deal",
    group: "business",
    subjectTypes: ["Provider"],
    objectKind: "entity",
    objectTypes: ["Deal"],
    description: "Provider offers Deal",
  },
  {
    name: "claimed_deal",
    group: "business",
    subjectTypes: ["Member"],
    objectKind: "entity",
    objectTypes: ["Deal"],
    description: "Member claimed Deal",
  },
  {
    name: "paid_commission",
    group: "business",
    subjectTypes: ["Provider"],
    objectKind: "number",
    objectTypes: [],
    description: "Numeric commission paid for a Deal (value with unit)",
  },
  {
    name: "partnered_with",
    group: "business",
    subjectTypes: ["Provider"],
    objectKind: "entity",
    objectTypes: ["Provider", "Hub"],
    description: "Provider has a partnership with another Provider or Hub",
  },
  // Goals & challenges
  {
    name: "pursues_goal",
    group: "goals",
    subjectTypes: ["Member", "Company"],
    objectKind: "entity",
    objectTypes: ["Goal"],
    description: "Subject is actively pursuing Goal",
  },
  {
    name: "faces_challenge",
    group: "goals",
    subjectTypes: ["Member", "Company"],
    objectKind: "entity",
    objectTypes: ["Challenge"],
    description: "Subject is currently facing Challenge",
  },
  {
    name: "seeks_skill",
    group: "goals",
    subjectTypes: ["Member"],
    objectKind: "entity",
    objectTypes: ["Skill"],
    description: "Member is looking for someone with the named skill (looking-for)",
  },
]

/**
 * Maps legacy/free-form graphrag entity-type strings to V0 types. Misses
 * return undefined; callers record the entity without a typed annotation
 * rather than guessing. "framework"/"concept" intentionally unmapped.
 */
export const FREE_FORM_TYPE_MAP: Readonly<Record<string, string>> = {
  company: "Company",
  person: "Member",
  technology: "Skill",
  location: "Location",
  program: "Program",
  event: "Event",
  deal: "Deal",
  provider: "Provider",
  hub: "Hub",
  member: "Member",
}

/**
 * Maps free-form verb-phrase variants to V0 predicates. Keys are pre-normalised
 * (lowercased, separators → "_").
 */
export const FREE_FORM_PREDICATE_MAP: Readonly<Record<string, string>> = {
  // Works_at family
  works_at: "works_at",
  works_for: "works_at",
  employed_by: "works_at",
  is_employed_at: "works_at",
  is_employed_by: "works_at",
  // Founded
  founded: "founded",
  co_founded: "founded",
  founder_of: "founded",
  established: "founded",
  started: "founded",
  // Member_of
  member_of: "member_of",
  belongs_to: "member_of",
  is_part_of: "member_of",
  // Attended_program
  attended: "attended_program",
  attended_program: "attended_program",
  alumnus_of: "attended_program",
  went_through: "attended_program",
  graduated_from: "attended_program",
  // Focuses_on
  focuses_on: "focuses_on",
  focused_on: "focuses_on",
  works_in: "focuses_on",
  works_on: "focuses_on",
  // Has_skill
  has_skill: "has_skill",
  skilled_in: "has_skill",
  expert_in: "has_skill",
  specialises_in: "has_skill",
  specializes_in: "has_skill",
  // Built_with
  built_with: "built_with",
  uses: "built_with",
  powered_by: "built_with",
  based_on: "built_with",
  // Targets_industry
  targets_industry: "targets_industry",
  targets: "targets_industry",
  serves: "targets_industry",
  sells_to: "targets_industry",
  // At_stage
  at_stage: "at_stage",
  is_at_stage: "at_stage",
  raised: "at_stage",
  // Located_in
  located_in: "located_in",
  based_in: "located_in",
  headquartered_in: "located_in",
  in: "located_in",
  // Operates_in
  operates_in: "operates_in",
  active_in: "operates_in",
  present_in: "operates_in",
  // Connected_to
  connected_to: "connected_to",
  knows: "connected_to",
  acquainted_with: "connected_to",
  // Mentored_by
  mentored_by: "mentored_by",
  advised_by: "mentored_by",
  coached_by: "mentored_by",
  // Introduced_to
  introduced_to: "introduced_to",
  intro_to: "introduced_to",
  connected_with: "introduced_to",
  // Attended_event
  attended_event: "attended_event",
  was_at: "attended_event",
  participated_in: "attended_event",
  // Offers_deal
  offers_deal: "offers_deal",
  offers: "offers_deal",
  provides: "offers_deal",
  // Claimed_deal
  claimed_deal: "claimed_deal",
  used_deal: "claimed_deal",
  redeemed: "claimed_deal",
  // Partnered_with
  partnered_with: "partnered_with",
  partners_with: "partnered_with",
  in_partnership_with: "partnered_with",
  // Pursues_goal
  pursues_goal: "pursues_goal",
  aims_for: "pursues_goal",
  wants_to: "pursues_goal",
  // Faces_challenge
  faces_challenge: "faces_challenge",
  struggles_with: "faces_challenge",
  blocked_by: "faces_challenge",
  // Seeks_skill
  seeks_skill: "seeks_skill",
  looking_for: "seeks_skill",
  hiring_for: "seeks_skill",
  needs: "seeks_skill",
}

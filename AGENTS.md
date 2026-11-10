# Shared Agent Rules — PF2e Tactical VTT Engine (PF2ERWeb)

This is the canonical guidance for agents developing the headless tactical battle system and interactive web-based virtual tabletop (VTT) based on the Pathfinder 2E Remastered ruleset. 

The primary architectural mandate is the strict decoupling of the core rules engine from visual presentation. The rules engine must run as pure, self-contained business logic without dependencies on DOM nodes, Canvas components, or network protocols, enabling full portability, testability, and deterministic combat resolution.

## Technical Context & Architectural Index

1. Monorepo Structure (npm workspaces)
   - `packagescore` Headless combat & rules engine (CommonJS, pure deterministic PF2e logic, 558+ passing tests, zero DOMCanvas dependencies).
   - `packagesserver` Node.js server (HTTP API, WebSocket `ws` dispatch pipeline, compendium queries, data persistence to `datasession.json`).
   - `packagesclient` Interactive web client on PixiJS v8 + React 19 + Vite (multi-layer canvas, responsive UI HUDs, floating windows, sheets).
2. Deterministic Rules Engine All core combat calculations must be deterministic when fed seeded dice rolls.
3. Module Index & Reference Consult relevant design documentation and reference packages before implementing slices

 Area  Target  Documentation Path  Contents 
---------
 Core Engine Reference  `..pf2e-referencesrcmodule`  Algorithmic source of truth for rules, actions, modifiers, and conditions. 
 Grid & Ruler Geometry  `..pf2e-referencesrcmodulecanvasruler.ts`  5-ft square grid, PF2e diagonal step rule (5-10-5 ft), distance calculations. 
 Walls & Vision Barriers  `..pf2e-referencesrcmodulecanvasdoor-control.ts`  Wall restrictions (normal, terrain, invisible, ethereal, secret doors, locks). 
 Lighting & Darkness  Core lighting definitions  Light radius (BrightDim), ambient darkness scales (light, dim, dark), GM vision. 
 Turn & Action Pipeline  `packagesserversrcroomencounter-session.js`  3-action economy, turn rotation, GM vs Player authority checks, combat log. 
 State Persistence  `packagesserverdatasession.json`  Persistent storage for scenes, folders, actors, items, journals, and chat log. 

## Feature Readiness Gate

Do not write code until the slice requirements and mechanics meet at least 95% confidence. Do not extrapolate rules or borrow legacy 3.5eD&D 5ePF2e Legacy mechanics. NEVER write fake visual placeholders (such as static dummy lines) when an interactive tool is requested.

Before implementing any non-trivial mechanic, record the readiness block

 Feature Readiness
 - goal observable combat or UI outcome
 - pf2e_remaster_rule exact rule, formula, DC, or degree of success definition
 - behavior_and_boundaries what is implemented now vs strictly excluded
 - data_contracts affected entities, models, events, or state changes
 - acceptance_tests discrete passfail test cases with exact inputs and outputs
 - delegated_assumptions none or explicitly approved simplifications
 - confidence 0-100%

If confidence is below 95%, pause and ask targeted clarifying questions about rules or architecture before coding.

## Authored Data & Modifiers Synchronization

1. Strict Typing & Contracts Use strict models and centralized definitions for all actions, conditions, bonus types, and outcomes
   - `ActionType` `SingleAction`, `TwoActions`, `ThreeActions`, `Reaction`, `FreeAction`.
   - `DegreeOfSuccess` `CriticalFailure`, `Failure`, `Success`, `CriticalSuccess`.
   - `ModifierType` `Circumstance`, `Status`, `Item`, `Untyped`.
2. Centralized Modifier Pipeline Implement modifier math through a centralized resolver
   Total = Base + max(Circumstance+) - max(Circumstance-) + max(Status+) - max(Status-) + ...
   Bonuses of the same type do not stack; take the highest. Penalties of the same type do not stack; take the worst (unless untyped).
3. Stable Identifiers Tokens, actors, scenes, folders, items, and active conditions must possess immutable string IDs for event logging, WebSocket sync, and disk serialization.

## Session Lifecycle & Context Management

1. One Scope Per Session Each session must cover only one discrete slice of mechanics (e.g., Implement functional Ruler and Grid Snap, not Implement all canvas layers at once).
2. Context Synchronization 
   - After reaching a milestone or completing a prompt, update `docsHANDOFF.md` with implemented models, WS events, and passing test suites.
   - Cross-reference and check off completed items in `docsROADMAP.md`.
3. Test-Driven Verification Ensure all suites pass before reporting completion
   - Core `npm run testcore` (must remain 558558 passing).
   - Server `npm run test --workspace=@pf2eserver`.
   - Client Build `npm run build --workspace=@pf2eclient`.

## Hybrid Development Protocol Adaptive Models + Gemini Architect Escalation

The local agent operates autonomously to implement assigned slices, build features, and run tests. Model tiering is assigned per session prompt. Gemini acts as the external Senior Rules Architect and Escalation Gatekeeper via the local bridge script (`gemini query`).

### 1. Model Tiering Strategy
- DeepSeek V4.1 Flash (Primary Workhorse) Standard feature implementations, React UI views, directories, compendium queries, routine Core actions, and test authoring.
- DeepSeek V4 Pro  Sonnet Intricate mechanical interactions, modifier stacking edge-cases, complex durationaffliction trees, and tricky save pipelines.
- GPT-6 Luna High-complexity geometry (AoE coneslines, multi-cell raycasting, line-of-sight algorithms) and tactical AI decision trees.
- Rule The operator prompt specifies which active model to use for the current session.

### 2. Autonomous Implementation Workflow
1. Execute from Prompt & Reference Implement the feature directly using the session prompt and targeted files in `..pf2e-referencesrcmodule`. The agent does not need pre-approval for standard logic or boilerplate.
2. Write & Run TDD Suites Author accompanying unit and integration tests and verify via npm.
3. Bridge Query (Complex Rules Only) If an intricate PF2e Remastered rule interaction is ambiguous or absent in `..pf2e-reference`, the agent MAY query Gemini via CLI
   `gemini [Context Pathfinder 2E Remastered] Rule check How does ActionCondition interact with RuleTarget Provide exact resolution.`

### 3. Circuit Breaker (Escalation Guardrail)
To prevent infinite retry loops and quota depletion
1. Attempt 1 (Autonomous Fix) If tests fail, inspect the error stack, check logic against `pf2e-reference`, and make one targeted fix.
2. Attempt 2 (Root Cause) If tests still fail, attempt a second targeted correction.
3. Escalation Gate (STOP) If tests fail a third time, STOP immediately. Do NOT attempt further modifications. Escalate to Gemini via
   `gemini [Context Pathfinder 2E Remastered] Buildtest failure last 5-10 lines of error. File path. Explain the Remastered rule defect and provide the minimal fix.`
4. Apply the returned fix and verify with `npm test`.

## Defect Resolution Fix the Class of Defect

When a mechanical or architectural bug is identified
1. Do not patch isolated edge cases with localized conditionals (e.g., avoid `if (is_flanked) ac -= 2`).
2. Fix the underlying root system apply the condition (`Off-Guard`) to the combatant, and let the centralized modifier resolver adjust the Armor Class.
3. Write an isolated regression test replicating the exact PF2e rules interaction before completing the fix.

### Reference PF2e Remaster Source of Truth
- Local canonical path `..pf2e-reference` (Read-only reference, do not modify).
- When implementing rules, math, modifiers, or degree-of-success logic, use `..pf2e-referencesrcmodule` as the algorithmic source of truth.
- STRICT LIMITATION Never search globally across `..pf2e-reference`. Read ONLY the targeted module file required for the current task
  - Distance, Grid & AoE Templates `..pf2e-referencesrcmodulecanvasruler.ts`, `measured-template.ts`
  - Check Rolls & Degrees of Success `..pf2e-referencesrcmodulesystemcheck` and `srcmodulesystemstatistic`
  - Damage Math & IWR Engine `..pf2e-referencesrcmodulesystemdamage`
  - Modifier Stacking & Rule Elements `..pf2e-referencesrcmodulerulesrule-element`
  - Conditions (Dying, Prone, Off-Guard, etc.) `..pf2e-referencesrcmodulesystemconditions`
  - Combat Maneuvers & Base Actions `..pf2e-referencesrcmodulesystemaction-macros`
  - Weapons, Ranged Combat, Reload & Traits `..pf2e-referencesrcmoduleitemweapon`
  - Spells, Casting & Magic System `..pf2e-referencesrcmoduleitemspell`
  - Shields (Hardness, HP, Shield Block) `..pf2e-referencesrcmoduleitemshield`
  - Actor Base, Creature Sizes & HandsInventory `..pf2e-referencesrcmoduleactor`
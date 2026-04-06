> This is an example of prompt used to implement initiative tracker app

Build a full-stack web application for managing IT initiative intake, evaluation, and lifecycle tracking within a shipyard organization.

## Background & Domain Context

This application supports the IT department (DSIT — Director of IT Systems) of construction company (~1700 employees, critical infrastructure, defense contracts). The organization has ~30 IT initiatives in various stages — from HR system upgrades to cybersecurity audits to production software replacements.

The DSIT role is new. Previously, IT decisions were made locally within department budgets, on a "whoever convinces the board" basis. The DSIT now has a formal mandate: all IT topics go through DSIT, with DSIT recommending and the board deciding.

This application is a tool to support a structured evaluation process that is about to be rolled out. It does NOT replace the existing Markdown-based initiative registry in the short term — it complements it by providing a visual, interactive workflow.

**Key organizational challenges this process addresses:**
- **Selection** — filtering valuable requests from wishful thinking
- **Comparability** — common language for cross-functional initiative comparison
- **Idea maturation** — bringing vague needs to a decision-ready state
- **Shared responsibility** — shifting culture from "IT, just do it" to shared understanding of value and joint ownership of priorities

## The Process Being Supported

The initiative lifecycle has 4 stages and 3 decision gates:

```
Submission
→ [Gate 1: Qualification] → Recognition 
→ [Gate 2] → Deep Analysis 
→ [Gate 3] → Implementation
```

**Stage 2 (Recognition) is the bottleneck** — capacity is ~3-5 topics per quarter. To manage this:
- **Default path**: initiatives wait in a Parking area, reviewed periodically (monthly or quarterly). During review, DSIT picks topics for Stage 2 from the full pool.
- **Fast track**: immediate entry based on published criteria (security risk, hard regulatory deadline, blocks another approved initiative) or explicit board decision.

At each gate, possible outcomes include: pass, reject, park, send back for more information, mark as duplicate, mark as non-IT, resolve immediately. The exact set of outcomes per gate should be designed — see the process documents for details.

**Architectural crash test** — during Stage 2 (Recognition), each initiative should be assessed against 4 questions:
1. What data will this system create or consume?
2. Do these same data already exist somewhere in the organization?
3. What systems/processes must this integrate with?
4. Does it create a new source of truth for any business entity?

**Pipeline transparency** — the pipeline should be visible within the organization (with possible exceptions for confidential topics). Transparency is a deliberate culture-building tool, not an afterthought.

### Process Reference Documents

The following documents describe the process design in detail. They should be treated as primary source material:

**initiative-evaluation-process-findings.md** — process design decisions:
- 4 stages, 3 gates architecture and rationale
- Hybrid queue model (parking + fast track) and why it was chosen over FIFO/priority queue
- Fast track criteria
- Role assignments (process manager — Gate 1 checklist; analyst — domain knowledge in Stage 2; DSIT — analysis and escalation)
- Iterative rollout approach (v1.0, explicit versioning, stable vs. evolving elements)
- Open design topics (initiative attributes per stage, gate criteria, decision bodies, pairwise comparison concept)

**initiative-evaluation-process-sessions.md** — decision journal:
- Why 4 stages and not more
- Why hybrid queue and not FIFO or priority
- Why architectural crash test lives in Stage 2
- Why public pipeline despite political risks
- Pairwise comparison concept (educational/cultural, NOT ranking — out of scope for MVP)

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS (Vite as build tool)
- **Backend**: Python + FastAPI
- **Database**: PostgreSQL
- **Python tooling**: uv for package management, virtual environments. Python 3.13+.
- **Frontend package manager**: bun
- **No AI/LLM integration in MVP**. AI-assisted triage is a future consideration — design data structures to be LLM-processable, but don't implement any AI features.
- **No authentication in MVP**. Design for future Active Directory integration (the organization uses AD). Use a hardcoded default user for now. All data-modifying operations should track who performed them (for future auth).

## Visual Design

The application should look and feel like a premium internal tool — clean, spacious, minimal chrome. Think Linear, Notion, or Vercel dashboard energy. Not a generic Bootstrap app.

**Color scheme (parameterized — all values in one config so they can be changed globally):**
- Dark mode as default (near-black background ~#0a0a0f, layered dark surfaces #111827 / #1e293b)
- Light mode toggle available
- Accent color: electric blue (#3b82f6) and variants
- Primary text: #f1f5f9, secondary text: #94a3b8
- Kanban columns should have visually distinct accent colors per stage

These are starting defaults from a reference design. Feel free to adjust if you have a better palette that maintains the premium feel.

## Internationalization

The GUI must support Polish (default) and English. A simple i18n approach is fine (JSON translation files, context provider, `t('key')` helper). Language switcher in the top bar.

Only UI chrome is translated — initiative content (titles, descriptions, comments) is in Polish and not translated. Stage names, gate names, status labels, priority labels, type labels, button text, error messages all come from translation files.

## Core Functionality

### Suggested views (treat as starting point, not final spec):

1. **Kanban Board** — columns per stage, initiative cards with key info (code, title, priority badge, owner, deadline). Drag-and-drop to trigger stage transitions (with gate decision modal when a gate is required). This is the primary view.

2. **List View** — sortable, filterable table of all initiatives. Alternative to Kanban for users who prefer tabular data.

3. **Initiative Detail** — full view of a single initiative with all fields, related systems, architectural assessment, gate decision history (as timeline), comments. Editable.

4. **Submission Form** — for creating new initiatives. Low barrier, minimal required fields.

5. **Dashboard** — aggregate stats (counts by stage, by priority, overdue items, recent activity). Keep it simple.

6. **Gate Decision Modal** — when transitioning between stages, capture: which gate, decision result, rationale.

### Key data concepts (suggestive, not prescriptive — design the actual model):

An initiative has at minimum:
- A code (format: ITI-XXXX — established organizational convention, auto-incremented)
- Title, description/context
- Type (system initiative vs. organizing action)
- Current stage in the lifecycle
- Action priority (react now, preparing, monitoring, deferred)
- Business owner (name + role, free text)
- Related IT systems (e.g., "ERP", "GL" — free text tags)
- Architecture areas (e.g., "HR", "Compliance", "Integration" — free text tags)
- Next action, optional deadline
- Audit trail: who changed what, when, why

Gate decisions should be recorded with: which gate, result, who decided, rationale, timestamp.

Stage transitions should be logged as an audit trail.

### Stage transition logic

Not every stage transition is valid — e.g., you can't jump from Submission directly to Implementation. The valid transitions depend on gate decisions. Work out the exact rules based on the process documents. Challenge any assumptions — the process is v0.1 and open to refinement.

## Seed Data

On first startup (if the database is empty), populate with 3-4 real initiatives to make the system immediately usable and testable:

1. **ITI-0001**: "Employee Portal / HR self-service" — stage: Recognition, priority: react now. Business owner: John Doe (board member sponsor). Context: Company X submitted a portal specification. Strong requirement from the board. Alternatives to be evaluated.

2. **ITI-0014**: "Red Button (payroll calculation optimization)" — stage: Deep Analysis, priority: monitoring. Business owner: Mary Black (Controlling Director). Context: 17 payroll calculation methods identified in the ERP system. Major process cleanup project. Deadline: end of May 2026.

3. **ITI-0024**: "NIS2 Audit / ISO 27001 gap analysis" — stage: Implementation, priority: monitoring. Business owner: Martin King (ISO Coordinator). Context: Company Y conducting a cybersecurity audit.

4. **ITI-0032**: "Attendance report discrepancy" — stage: Submission, priority: react now. Context: Two attendance reports do not match. CEO dissatisfied. Details to be clarified.


Also seed a default user (Bilbo Baggins, DSIT role) used for all operations in the MVP.

## Project Structure (suggestive)

```
app/
├── frontend/           (React + Vite + TypeScript + Tailwind)
├── backend/            (Python + FastAPI)
│   ├── db/             (schema, migrations, repository, seed)
│   ├── models/         (Pydantic models, enums)
│   ├── services/       (business logic)
│   └── routes/         (API endpoints)
├── docker-compose.yml  (PostgreSQL + app services)
└── README.md
```

The exact file structure, naming conventions, and module decomposition should emerge from the design process — don't treat the above as a rigid requirement.

## Development & Deployment

- **Phase 1** (now): Run locally on developer's laptop. Simplest possible setup — a single command to start everything (database, backend, frontend).
- **Phase 2**: Docker Compose for portability.
- **Phase 3**: Deploy to a Linux VM in the organization's infrastructure.

For Phase 1, document the setup steps clearly. Use Docker for PostgreSQL if a local install isn't available. The backend and frontend can run as regular processes.

## Design Principles

- **Challenge every suggestion in this prompt.** The process is v0.1. If something doesn't make sense technically or from a UX perspective, push back and propose an alternative. The developer (DSIT) is an experienced IT architect — treat them as a peer, not a customer to be pleased.
- **Start simple, iterate.** Don't over-engineer. The first version should be usable within days, not weeks.
- **Design for the future, build for today.** The data model should accommodate future features (auth, AI, notifications, attachments) without implementing them.
- **Transparency over secrecy.** The pipeline is meant to be visible. Default to showing information, not hiding it.
- **Polish language content, English/Polish UI.** All business data is in Polish. The UI supports both languages.
- **Timestamps in the system's local timezone** (Europe/Warsaw for MVP). Display accordingly.

## Out of Scope for MVP

- Authentication and access control (design for it, don't build it)
- AI/LLM integration
- Email/Teams notifications
- File attachments on initiatives
- Pairwise comparison mechanism (concept only, not even designed yet)
- Export/reporting (PDF, Excel)
- MCP server for external tool access
- Mobile-specific responsive design (desktop-first is fine, basic mobile usability is a bonus)

## Future Considerations (inform design, don't implement)

- Active Directory integration with role-based access
- AI-assisted triage (duplicate detection, auto-categorization, architectural assessment suggestions)
- Microsoft Graph API integration for Teams/email notifications
- Attachment storage (local or S3-compatible)
- MCP server so AI assistants can interact with the initiative registry
- Formal scoring/weighting system for gate decisions
- Pairwise comparison for cross-functional awareness building

## Spec Format Requirements

The product specification MUST use this structure for the harness to parse it correctly:

- Use `## Sprint N` headers (e.g., `## Sprint 1`, `## Sprint 2`) to define sprint boundaries
- The harness counts these headers to determine the number of sprints
- Each sprint section should list the features to be built in that sprint
- Sprint numbering must be sequential starting from 1

## Sprint Contract Format

Sprint contracts use this JSON structure:

```json
{
  "sprintNumber": 1,
  "features": ["feature description 1", "feature description 2"],
  "criteria": [
    {
      "name": "criterion_name",
      "description": "Specific, testable description of what must be true",
      "threshold": 7
    }
  ]
}
```

Rules:
- Each criterion must be specific and testable
- Include 5-15 criteria per sprint depending on complexity
- Cover: functionality, error handling, code quality, and user experience
- `threshold` is the minimum score (1-10) for a criterion to pass

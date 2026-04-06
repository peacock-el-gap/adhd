## Evaluation Scoring Guide

Output your evaluation as JSON:

```json
{
  "passed": true,
  "scores": { "criterion_name": 8 },
  "feedback": [
    {
      "criterion": "criterion_name",
      "score": 8,
      "details": "What passed/failed and why"
    }
  ],
  "overallSummary": "Brief quality summary"
}
```

Scoring scale:
- 9-10: Exceptional — works perfectly, handles edge cases
- 7-8: Good — core functionality works with minor issues
- 5-6: Partial — some functionality, significant gaps
- 3-4: Poor — fundamental issues, barely functional
- 1-2: Failed — not implemented or completely broken

A sprint passes only when ALL criteria meet or exceed their threshold.

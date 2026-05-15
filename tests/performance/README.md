# k6 Performance Tests

This folder contains optional k6 performance scripts used by the workflow toggle `enable_k6`.

## Quick Run

```bash
k6 run tests/performance/smoke.js
```

Set a custom base URL:

```bash
K6_BASE_URL=https://your-service.example k6 run tests/performance/smoke.js
```

Or use the central-workflow naming used in CI:

```bash
BASE_URL=https://your-service.example k6 run tests/performance/smoke.js
```

export interface FriendlyMessage {
  severity: 'info' | 'warning' | 'error' | 'success';
  title: string;
  detail: string;
  hint: string;
}

export interface CiResults {
  tests?: { passed: number; failed: number; total: number };
  coverage?: { pct: number; threshold: number };
  lint?: { errors: number; warnings: number };
  security?: { high: number; critical: number };
}

type Stage = 'access' | 'quality' | 'package';
type Conclusion = 'success' | 'failure' | 'cancelled';

function hasResults(results: CiResults): boolean {
  return (
    results.tests !== undefined ||
    results.coverage !== undefined ||
    results.lint !== undefined ||
    results.security !== undefined
  );
}

export function translateResults(
  stage: Stage,
  conclusion: Conclusion,
  results: CiResults,
): FriendlyMessage[] {
  const messages: FriendlyMessage[] = [];

  if (conclusion === 'cancelled') {
    messages.push({
      severity: 'info',
      title: 'Stage was cancelled',
      detail: 'The CI stage was cancelled before completing.',
      hint: 'Re-run the workflow when ready.',
    });
    return messages;
  }

  if (conclusion === 'failure' && !hasResults(results)) {
    if (stage === 'access') {
      messages.push({
        severity: 'error',
        title: 'Access gate failed',
        detail: 'The access stage failed with no reported results.',
        hint: 'Verify CI_TOKEN is set as a GitHub Actions secret and that the platform is reachable.',
      });
    } else {
      messages.push({
        severity: 'error',
        title: 'Pipeline job crashed',
        detail: 'The stage failed before producing any results.',
        hint: 'Open the GitHub Actions run logs to diagnose the failure.',
      });
    }
    return messages;
  }

  const { tests, coverage, lint, security } = results;

  if (tests !== undefined) {
    if (tests.failed > 0) {
      messages.push({
        severity: 'error',
        title: `${String(tests.failed)} test(s) failed`,
        detail: `${String(tests.failed)} of ${String(tests.total)} tests failed.`,
        hint: 'Check the GitHub Actions output for failing test details.',
      });
    } else if (conclusion === 'success') {
      messages.push({
        severity: 'success',
        title: 'All tests passed',
        detail: `${String(tests.passed)} test(s) passed.`,
        hint: '',
      });
    }
  }

  if (coverage !== undefined && coverage.pct < coverage.threshold) {
    messages.push({
      severity: 'warning',
      title: 'Coverage below threshold',
      detail: `${String(coverage.pct)}% coverage but requires ${String(coverage.threshold)}%.`,
      hint: 'Add more tests to bring coverage up to the required threshold.',
    });
  }

  if (lint !== undefined) {
    if (lint.errors > 0) {
      messages.push({
        severity: 'error',
        title: `${String(lint.errors)} lint error(s)`,
        detail: `${String(lint.errors)} lint errors found.`,
        hint: 'Run `npm run lint -- --fix` to auto-fix issues.',
      });
    } else if (lint.warnings > 0) {
      messages.push({
        severity: 'warning',
        title: `${String(lint.warnings)} lint warning(s)`,
        detail: `${String(lint.warnings)} lint warnings found. No errors.`,
        hint: 'Consider fixing lint warnings to keep the codebase clean.',
      });
    }
  }

  if (security !== undefined) {
    if (security.critical > 0) {
      messages.push({
        severity: 'error',
        title: `${String(security.critical)} critical vulnerability(s)`,
        detail: `${String(security.critical)} critical security vulnerability(s) found.`,
        hint: 'Run `npm audit` to view details and apply fixes.',
      });
    } else if (security.high > 0) {
      messages.push({
        severity: 'warning',
        title: `${String(security.high)} high-severity vulnerability(s)`,
        detail: `${String(security.high)} high-severity vulnerability(s) found.`,
        hint: 'Run `npm audit` to view details and apply fixes.',
      });
    }
  }

  return messages;
}

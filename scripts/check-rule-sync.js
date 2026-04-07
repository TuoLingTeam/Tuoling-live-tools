#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const EXPECTED_DEFAULT_PLAN = 'trial';
const EXPECTED_ADMIN_LABEL = '试用中';

function readFile(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(content, snippet, context) {
  assert(content.includes(snippet), `${context}: expected to include ${JSON.stringify(snippet)}`);
}

function assertExcludes(content, snippet, context) {
  assert(!content.includes(snippet), `${context}: expected to exclude ${JSON.stringify(snippet)}`);
}

try {
  const planRules = JSON.parse(readFile('shared/planRules.data.json'));
  const authFeatureRules = JSON.parse(readFile('shared/authFeatureRules.data.json'));

  assert(Array.isArray(planRules.validPlans), 'shared/planRules.data.json: validPlans must be an array');
  assert(planRules.validPlans.includes(EXPECTED_DEFAULT_PLAN), 'shared/planRules.data.json: validPlans must include trial');
  assert(!planRules.validPlans.includes('free'), 'shared/planRules.data.json: validPlans must not include free');
  assert(planRules.planRules?.trial, 'shared/planRules.data.json: trial rule must exist');

  const authSchemas = readFile('auth-api/schemas.py');
  const authModels = readFile('auth-api/models.py');
  const adminSchemas = readFile('auth-api/schemas_admin.py');
  const authFeatureRulesPy = readFile('auth-api/auth_feature_rules.py');
  const messageRouter = readFile('auth-api/routers/messages.py');

  assertIncludes(authSchemas, 'plan: str = "trial"', 'auth-api/schemas.py');
  assertIncludes(authSchemas, 'required_plan: str = "trial"', 'auth-api/schemas.py');
  assertExcludes(authSchemas, 'plan: str = "free"', 'auth-api/schemas.py');
  assertExcludes(authSchemas, 'required_plan: str = "free"', 'auth-api/schemas.py');

  assertIncludes(authModels, 'default="trial"', 'auth-api/models.py');
  assertExcludes(authModels, 'default="free"', 'auth-api/models.py');

  assertIncludes(adminSchemas, 'plan: str = "trial"', 'auth-api/schemas_admin.py');
  assertIncludes(adminSchemas, 'membership_status: str = "trial"', 'auth-api/schemas_admin.py');
  assertIncludes(adminSchemas, `membership_label: str = "${EXPECTED_ADMIN_LABEL}"`, 'auth-api/schemas_admin.py');
  assertExcludes(adminSchemas, 'plan: str = "free"', 'auth-api/schemas_admin.py');
  assertExcludes(adminSchemas, 'membership_status: str = "free"', 'auth-api/schemas_admin.py');

  assertIncludes(authFeatureRulesPy, '"requiredPlan": "trial"', 'auth-api/auth_feature_rules.py');
  assertIncludes(messageRouter, 'normalize_plan(getattr(user, "plan", None))', 'auth-api/routers/messages.py');
  assertExcludes(messageRouter, 'or "free"', 'auth-api/routers/messages.py');

  assert(Object.keys(authFeatureRules).length > 0, 'shared/authFeatureRules.data.json: expected at least one feature rule');

  console.log('Rule sync check passed.');
} catch (error) {
  console.error('Rule sync check failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

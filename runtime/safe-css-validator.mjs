const fs = require('fs');
const path = require('path');

const POLICY_PATH = path.join(__dirname, 'safe-css-policy.json');
let policy = null;

function loadPolicy() {
  if (policy) return policy;
  try {
    policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  } catch (e) {
    policy = {
      allowedProperties: new Set(),
      blockedAtRules: new Set(),
      blockedFunctions: [],
      maxFileSizeBytes: 65536,
      maxRuleCount: 500,
    };
  }

  // Convert arrays to Sets for fast lookup
  const result = {
    allowedProperties: new Set(policy.allowedProperties || []),
    blockedAtRules: new Set(policy.blockedAtRules || []),
    blockedFunctions: policy.blockedFunctions || [],
    maxFileSizeBytes: policy.maxFileSizeBytes || 65536,
    maxRuleCount: policy.maxRuleCount || 500,
  };

  // Add custom property prefix matcher
  result.hasCustomProperty = (name) => name.startsWith('--');

  return result;
}

/**
 * Simple tokenizer for CSS that extracts property names and at-rule names.
 * Handles comments, strings, and nesting.
 */
function tokenizeCss(source) {
  const tokens = [];
  let i = 0;
  const len = source.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(source[i])) i++;

    if (i >= len) break;

    // Skip comments
    if (source[i] === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < len - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < len && source[i] !== '\n') i++;
      continue;
    }

    // At-rule
    if (source[i] === '@') {
      const start = i;
      i++;
      while (i < len && /[a-zA-Z-]/.test(source[i])) i++;
      const name = source.substring(start, i).toLowerCase();
      tokens.push({ type: 'at-rule', name, start });
      continue;
    }

    // String
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i++];
      while (i < len && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }

    // Property (identifier before colon)
    if (/[a-zA-Z-]/.test(source[i])) {
      const start = i;
      while (i < len && /[a-zA-Z0-9-]/.test(source[i])) i++;
      const name = source.substring(start, i).toLowerCase();
      tokens.push({ type: 'identifier', name, start });
      continue;
    }

    // Skip everything else
    i++;
  }

  return tokens;
}

/**
 * Validate a CSS source string against the safe CSS policy.
 * Returns { ok: true } or { ok: false, violations: [...] }.
 */
function validateSafeCss(source) {
  const p = loadPolicy();
  const violations = [];

  // Size check
  if (source.length > p.maxFileSizeBytes) {
    violations.push({
      rule: 'max-file-size',
      message: `CSS file exceeds maximum size (${source.length} > ${p.maxFileSizeBytes} bytes)`,
    });
  }

  // Rule count check
  const ruleMatches = source.match(/\{/g);
  if (ruleMatches && ruleMatches.length > p.maxRuleCount) {
    violations.push({
      rule: 'max-rule-count',
      message: `CSS exceeds maximum rule count (${ruleMatches.length} > ${p.maxRuleCount})`,
    });
  }

  // Tokenize and check
  const tokens = tokenizeCss(source);
  let braceDepth = 0;

  for (const token of tokens) {
    if (token.type === 'at-rule') {
      // Block at-rules like @keyframes, @import, @media
      const baseName = token.name.replace(/^@/, '');
      if (p.blockedAtRules.has(baseName)) {
        violations.push({
          rule: 'blocked-at-rule',
          message: `At-rule @${baseName} is not permitted`,
          position: token.start,
        });
      }
    }

    // Inside a rule block, check property names
    if (token.type === 'identifier') {
      // Simple heuristic: if we're inside a block (after the first {)
      // the identifier before a : is a property name
      // We check ALL identifiers since we can't easily track colon proximity
      // in this simple tokenizer
      if (!p.allowedProperties.has(token.name) && !p.hasCustomProperty(token.name)) {
        // Check if it's a known safe identifier (like values)
        const isKnownValue = ['none', 'auto', 'initial', 'inherit', 'unset', 'default',
          'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset',
          'transparent', 'currentcolor', 'cover', 'contain', 'center', 'top', 'bottom',
          'left', 'right', 'middle', 'flex', 'block', 'inline', 'grid', 'hidden',
          'scroll', 'no-repeat', 'repeat', 'repeat-x', 'repeat-y', 'space', 'round',
          'cross-fade', 'element', 'image-set',
          'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
          'inherit', 'initial', 'revert', 'revert-layer', 'all',
        ].includes(token.name);

        // Check selectors, not properties
        const isSelector = token.name.startsWith('nth-') ||
          token.name === 'hover' || token.name === 'focus' || token.name === 'active' ||
          token.name === 'visited' || token.name === 'link' || token.name === 'target' ||
          token.name === 'checked' || token.name === 'disabled' || token.name === 'empty' ||
          token.name === 'enabled' || token.name === 'first-child' || token.name === 'last-child' ||
          token.name === 'first-of-type' || token.name === 'last-of-type' ||
          token.name === 'not' || token.name === 'is' || token.name === 'where';

        if (!isKnownValue && !isSelector) {
          violations.push({
            rule: 'blocked-property',
            message: `CSS property '${token.name}' is not in the allowed list`,
            position: token.start,
          });
        }
      }
    }
  }

  // Check for blocked functions
  for (const fn of p.blockedFunctions) {
    const regex = new RegExp(fn.replace('(', '\\('), 'gi');
    const matches = source.match(regex);
    if (matches) {
      violations.push({
        rule: 'blocked-function',
        message: `Blocked function found: ${fn.trim()}`,
        count: matches.length,
      });
    }
  }

  return violations.length === 0
    ? { ok: true }
    : { ok: false, violations };
}

module.exports = { validateSafeCss, loadPolicy };

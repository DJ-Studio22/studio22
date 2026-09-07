// tools/check-no-external.mjs
//
// Fails if anything in dist/ would make the browser FETCH from another origin.
//
// WHY THIS EXISTS
// ---------------
// The landing page tells visitors nothing is collected, and public/_headers
// backs it with `connect-src 'self'` and a default-src of 'self'. Both of
// those are promises. This is the one that checks.
//
// It was written after a manual audit measured the deployed site making 91
// requests, all to its own origin. That result is worth keeping true, and the
// way it stops being true is ordinary: somebody adds a Google Font, a CDN
// script, an analytics snippet, an <img> pointing at an image host. Each is
// one line and none of them look like a policy change.
//
// The CSP would block most of them at runtime — silently, in the visitor's
// browser, where nobody here would see it. This fails the build instead.
//
// SUBRESOURCES, NOT LINKS
// -----------------------
// The first version of this flagged every absolute URL and immediately caught
// the portfolio link in the footer. That is a false positive, and a check that
// cries wolf is a check people learn to skip. An <a href> is somewhere the
// visitor may choose to go; it fetches nothing, and Referrer-Policy:
// no-referrer already means following it tells the destination nothing.
//
// So this looks only at references the BROWSER resolves on its own — src,
// srcset, poster, <link href>, CSS url(), @import, and any absolute URL
// sitting in bundled JavaScript. Outbound links are reported at the end as
// information, never as a failure.
//
// Run: node tools/check-no-external.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));

// Our own deployed origin is allowed anywhere: canonical links, og:url and the
// JSON-LD block all carry absolute URLs by specification.
const OWN = new URL(CONFIG.origin).origin;

// Namespaces and vocabularies. These appear as identifiers, never as fetches:
// an xmlns is not a URL the browser retrieves.
const NAMESPACES = new Set([
  'https://schema.org', 'http://schema.org',
  'https://www.w3.org', 'http://www.w3.org',
  'https://www.sitemaps.org', 'http://www.sitemaps.org',
]);

const isForeign = (url) => {
  const normalised = url.startsWith('//') ? 'https:' + url : url;
  if (!/^https?:/i.test(normalised)) return false;   // relative, data:, blob:, mailto:
  let origin;
  try { origin = new URL(normalised).origin; } catch { return false; }
  if (origin === OWN || NAMESPACES.has(origin)) return false;
  return origin;
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (!fs.existsSync(DIST)) {
  console.error('dist/ does not exist — run the build first.');
  process.exit(1);
}

const fetches = [];   // failures
const links = [];     // informational

for (const file of walk(DIST)) {
  const ext = path.extname(file).toLowerCase();
  const rel = path.relative(DIST, file).replace(/\\/g, '/');
  if (!['.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.xml'].includes(ext)) continue;
  const text = fs.readFileSync(file, 'utf8');

  const flag = (url, what) => {
    const origin = isForeign(url);
    if (origin) fetches.push({ rel, origin, what, url: url.slice(0, 100) });
  };

  if (ext === '.html' || ext === '.svg') {
    // Attributes the browser resolves without being asked.
    for (const m of text.matchAll(/\b(?:src|srcset|poster|data|action|formaction)\s*=\s*["']([^"']+)["']/gi)) {
      for (const candidate of m[1].split(',')) flag(candidate.trim().split(/\s+/)[0], m[0].split('=')[0].trim());
    }
    // <link href> is a fetch; <a href> is not.
    for (const m of text.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) flag(m[1], 'link href');
    // SVG <image href> / <use href> are fetches.
    for (const m of text.matchAll(/<(?:image|use)\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) flag(m[1], 'svg href');
    // Inline styles.
    for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)/gi)) flag(m[1], 'css url()');
    for (const m of text.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)/gi)) flag(m[1], '@import');

    // Outbound navigation, recorded but not a failure.
    for (const m of text.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
      const origin = isForeign(m[1]);
      if (origin) links.push({ rel, origin, url: m[1].slice(0, 100) });
    }
  }

  if (ext === '.css') {
    for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)/gi)) flag(m[1], 'css url()');
    for (const m of text.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)/gi)) flag(m[1], '@import');
  }

  if (ext === '.js' || ext === '.mjs') {
    // Bundled JavaScript should contain no absolute foreign URL at all — as a
    // fetch target, an import, or a string waiting to become one.
    for (const m of text.matchAll(/["'`]((?:https?:)?\/\/[^"'`\s]+)["'`]/g)) flag(m[1], 'url literal in JS');
  }

  if (ext === '.webmanifest' || ext === '.json') {
    for (const m of text.matchAll(/"(?:src|url|icon)"\s*:\s*"([^"]+)"/gi)) flag(m[1], 'manifest reference');
  }
}

// --- The policy itself ----------------------------------------------------
//
// A relaxed CSP is the other way this claim quietly dies.
const headersPath = path.join(DIST, '_headers');
const policy = [];
if (!fs.existsSync(headersPath)) {
  policy.push('the header policy is missing from the build');
} else {
  const csp = fs.readFileSync(headersPath, 'utf8').match(/Content-Security-Policy:\s*(.+)/i)?.[1] ?? '';
  for (const directive of ["default-src 'self'", "script-src 'self'", "connect-src 'self'",
                           "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) {
    if (!csp.includes(directive)) policy.push(`CSP no longer contains "${directive}"`);
  }
  if (/script-src[^;]*'unsafe-inline'/.test(csp)) policy.push("script-src has gained 'unsafe-inline'");
  if (/script-src[^;]*'unsafe-eval'/.test(csp)) policy.push("script-src has gained 'unsafe-eval'");
}

// --- Report ---------------------------------------------------------------

if (fetches.length || policy.length) {
  console.error(`\nEXTERNAL REFERENCE CHECK FAILED\n`);
  for (const f of fetches) {
    console.error(`  ✗ ${f.rel}`);
    console.error(`      ${f.what} -> ${f.origin}  ${f.url}`);
  }
  for (const p of policy) console.error(`  ✗ _headers: ${p}`);
  console.error('\nThe site promises it contacts no other origin. Either remove the');
  console.error('reference, or change the promise on the landing page and in _headers.\n');
  process.exit(1);
}

console.log('No external subresources anywhere in dist/, and the CSP still holds its shape.');
if (links.length) {
  console.log(`\n${links.length} outbound link(s) — navigation only, nothing is fetched:`);
  for (const l of links) console.log(`  · ${l.rel} -> ${l.url}`);
}

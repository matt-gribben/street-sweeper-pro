// Sim purity scanner (CLAUDE.md hard rule 1, TECHNICAL_DESIGN §18.1 and §21.3).
// Biome catches restricted imports and globals; this scanner is the second net. It also sees
// `Math.random` (a member access Biome's global rule cannot see) and enforces the §2.1 import table:
// src/sim may import only src/sim/**, src/data/** (from src/sim/tuning.ts only) and, type-only,
// src/gen/assets.ts. It also keeps the engine-dependent transcendentals (Math.sin/cos/tan/atan2/exp/sqrt/
// hypot) inside src/sim/fmath.ts (§7.4).
// Kept pure (strings in, violations out) so tests/unit/simPurity.test.ts can self-test it on fixtures.
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

export type PurityRule =
  | 'forbidden-token'
  | 'raw-transcendental'
  | 'three-import'
  | 'package-import'
  | 'outside-sim-import'
  | 'data-import-outside-tuning'
  | 'gen-value-import'
  | 'dynamic-import'
  | 'require'
  | 'import-meta';

export type PurityViolation = {
  /** Repo-relative POSIX path of the offending file. */
  file: string;
  /** 1-based line number. */
  line: number;
  rule: PurityRule;
  detail: string;
};

/** The regex named in TECHNICAL_DESIGN §18.1. Applied to code with comments blanked out. */
export const FORBIDDEN_TOKEN_SOURCE = String.raw`\bMath\.random\b|\bDate\b|\bperformance\b`;

/** The Math functions that src/sim may call only through src/sim/fmath.ts (TECHNICAL_DESIGN §2, §7.4). */
export const FMATH_FUNCTIONS = ['sin', 'cos', 'tan', 'atan2', 'exp', 'sqrt', 'hypot'] as const;

/** The one src/sim file allowed to touch the FMATH_FUNCTIONS on Math directly. */
export const FMATH_FILE = 'src/sim/fmath.ts';

// `Math.sin`, `Math . sin` or `Math['sin']`, called or passed by reference. Applied to code with comments
// blanked out, like the forbidden-token regex.
const FMATH_NAMES = FMATH_FUNCTIONS.join('|');
const RAW_TRANSCENDENTAL_RE = new RegExp(
  String.raw`\bMath\s*(?:\.\s*(${FMATH_NAMES})\b|\[\s*(['"\`])(${FMATH_NAMES})\2\s*\])`,
  'g',
);

/** Path prefixes (repo-relative) that src/sim may import from (TECHNICAL_DESIGN §2.1). */
export const ALLOWED_IMPORT_PREFIXES = ['src/sim/', 'src/data/'] as const;

/** src/data/ is reachable from src/sim only through this file (TECHNICAL_DESIGN §2.1, SSP-029). */
export const DATA_PREFIX = 'src/data/';
export const DATA_GATEWAY_FILE = 'src/sim/tuning.ts';

/** The one file outside those prefixes that src/sim may import, and only with `import type`. */
export const TYPE_ONLY_IMPORT = 'src/gen/assets.ts';

const KEYWORDS_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'instanceof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await',
]);

function isIdentChar(c: string): boolean {
  return /[\w$]/.test(c);
}

/**
 * Replace every comment with spaces (newlines kept) so the token regex does not trip on prose such as
 * "no Date here". Strings, template literals and regex literals are copied verbatim (they are still
 * scanned), so the output has the same length and line numbering as the input. The lexer only ever
 * blanks text it is sure is a comment.
 */
export function blankComments(source: string): string {
  const out: string[] = [];
  const n = source.length;
  // For each open `${` inside a template literal: the brace depth at which it opened.
  const templateStack: number[] = [];
  let braceDepth = 0;
  let inTemplate = false;
  let lastSignificant = '';
  let lastWord = '';
  let i = 0;

  while (i < n) {
    const c = source.charAt(i);
    const next = source.charAt(i + 1);

    if (inTemplate) {
      if (c === '\\') {
        out.push(source.slice(i, i + 2));
        i += 2;
      } else if (c === '`') {
        out.push(c);
        i += 1;
        inTemplate = false;
        lastSignificant = '`';
        lastWord = '';
      } else if (c === '$' && next === '{') {
        out.push('${');
        i += 2;
        templateStack.push(braceDepth);
        braceDepth += 1;
        inTemplate = false;
        lastSignificant = '{';
        lastWord = '';
      } else {
        out.push(c);
        i += 1;
      }
      continue;
    }

    if (c === '/' && next === '/') {
      while (i < n && source.charAt(i) !== '\n') {
        out.push(' ');
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i += 1) out.push(source.charAt(i) === '\n' ? '\n' : ' ');
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && source.charAt(j) !== c && source.charAt(j) !== '\n') {
        j += source.charAt(j) === '\\' ? 2 : 1;
      }
      j = Math.min(j + 1, n);
      out.push(source.slice(i, j));
      i = j;
      lastSignificant = '"';
      lastWord = '';
      continue;
    }
    if (c === '`') {
      out.push(c);
      i += 1;
      inTemplate = true;
      continue;
    }
    if (c === '/') {
      const regexAllowed =
        lastSignificant === '' ||
        (!isIdentChar(lastSignificant) && !')]}"`'.includes(lastSignificant)) ||
        KEYWORDS_BEFORE_REGEX.has(lastWord);
      if (regexAllowed) {
        // A regex literal never spans lines; if no closing slash is found, treat '/' as division.
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < n && source.charAt(j) !== '\n') {
          const r = source.charAt(j);
          if (r === '\\') {
            j += 2;
            continue;
          }
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) {
            closed = true;
            break;
          }
          j += 1;
        }
        if (closed) {
          j += 1;
          while (j < n && /[a-z]/i.test(source.charAt(j))) j += 1;
          out.push(source.slice(i, j));
          i = j;
          lastSignificant = '"';
          lastWord = '';
          continue;
        }
      }
    }
    if (c === '{') {
      braceDepth += 1;
    } else if (c === '}') {
      braceDepth -= 1;
      if (templateStack.length > 0 && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop();
        out.push(c);
        i += 1;
        inTemplate = true;
        continue;
      }
    }

    if (isIdentChar(c)) {
      let j = i;
      while (j < n && isIdentChar(source.charAt(j))) j += 1;
      const word = source.slice(i, j);
      out.push(word);
      i = j;
      lastWord = word;
      lastSignificant = word.charAt(word.length - 1);
      continue;
    }
    if (!/\s/.test(c)) {
      lastSignificant = c;
      lastWord = '';
    }
    out.push(c);
    i += 1;
  }
  return out.join('');
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let k = 0; k < index; k += 1) if (text.charCodeAt(k) === 10) line += 1;
  return line;
}

// `import x from 'm'`, `import type { T } from 'm'`, `import 'm'`, `export * from 'm'`,
// `export type { T } from 'm'`. The clause may contain only identifiers, `*`, braces, commas and
// whitespace, so the match cannot run across other statements.
const STATIC_IMPORT_RE =
  /\b(import|export)\b\s*(type\b\s*)?(?:([\w$*{}\s,]*?)\s*\bfrom\s*)?(['"])([^'"\n]*)\4/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(/g;
const IMPORT_META_RE = /\bimport\s*\.\s*meta\b/g;
const REQUIRE_RE = /\brequire\s*\(/g;

function classifySpecifier(
  file: string,
  specifier: string,
  typeOnly: boolean,
): { rule: PurityRule; detail: string } | null {
  if (specifier === 'three' || specifier.startsWith('three/')) {
    return { rule: 'three-import', detail: `imports '${specifier}' (no rendering code in src/sim)` };
  }
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return {
      rule: 'package-import',
      detail: `imports '${specifier}': src/sim may import only src/sim/**, src/data/** and types from ${TYPE_ONLY_IMPORT}`,
    };
  }
  const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
  if (resolved.startsWith(DATA_PREFIX) && file !== DATA_GATEWAY_FILE) {
    return {
      rule: 'data-import-outside-tuning',
      detail: `imports '${specifier}': src/sim reads ${DATA_PREFIX} only through ${DATA_GATEWAY_FILE} (take a Tuning parameter instead)`,
    };
  }
  if (ALLOWED_IMPORT_PREFIXES.some((prefix) => resolved.startsWith(prefix))) return null;
  if (resolved === TYPE_ONLY_IMPORT) {
    return typeOnly
      ? null
      : {
          rule: 'gen-value-import',
          detail: `imports '${specifier}' without 'import type' (only types may come from ${TYPE_ONLY_IMPORT})`,
        };
  }
  return {
    rule: 'outside-sim-import',
    detail: `imports '${specifier}' (resolves to ${resolved}, outside src/sim/ and src/data/)`,
  };
}

/**
 * Scan one sim source file. `file` is the repo-relative POSIX path (for example 'src/sim/vehicle.ts'),
 * used to resolve relative imports and to label violations.
 */
export function scanSimSource(file: string, source: string): PurityViolation[] {
  const code = blankComments(source);
  const violations: PurityViolation[] = [];
  const add = (index: number, rule: PurityRule, detail: string): void => {
    violations.push({ file, line: lineAt(code, index), rule, detail });
  };

  for (const m of code.matchAll(new RegExp(FORBIDDEN_TOKEN_SOURCE, 'g'))) {
    add(m.index, 'forbidden-token', `uses '${m[0]}' (no Math.random or wall-clock time in src/sim)`);
  }
  if (file !== FMATH_FILE) {
    for (const m of code.matchAll(RAW_TRANSCENDENTAL_RE)) {
      const name = m[1] ?? m[3] ?? '';
      add(m.index, 'raw-transcendental', `uses Math.${name} directly (call ${name} from ${FMATH_FILE})`);
    }
  }
  for (const m of code.matchAll(STATIC_IMPORT_RE)) {
    const typeOnly = m[2] !== undefined;
    const specifier = m[5] ?? '';
    const problem = classifySpecifier(file, specifier, typeOnly);
    if (problem !== null) add(m.index, problem.rule, problem.detail);
  }
  for (const m of code.matchAll(DYNAMIC_IMPORT_RE)) {
    add(m.index, 'dynamic-import', 'uses dynamic import() (src/sim imports are static and checked)');
  }
  for (const m of code.matchAll(IMPORT_META_RE)) {
    add(m.index, 'import-meta', 'uses import.meta (build-tool state is not sim input)');
  }
  for (const m of code.matchAll(REQUIRE_RE)) {
    add(m.index, 'require', 'uses require() (src/sim imports are static ES imports)');
  }
  return violations.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/** Every .ts file under `dir`, recursively, as absolute paths in sorted order. Throws if unreadable. */
export function listTsFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.ts')) found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}

export type SimTreeScan = { files: string[]; violations: PurityViolation[] };

/**
 * Scan every .ts file under `<repoRoot>/<simDir>`. Throws when the directory is missing or unreadable
 * or holds no .ts files, so the purity test can never pass vacuously.
 */
export function scanSimTree(repoRoot: string, simDir = 'src/sim'): SimTreeScan {
  let absFiles: string[];
  try {
    absFiles = listTsFiles(join(repoRoot, simDir));
  } catch (error) {
    throw new Error(`simPurity: cannot read ${simDir}: ${String(error)}`);
  }
  if (absFiles.length === 0) {
    throw new Error(`simPurity: no .ts files under ${simDir}; refusing to pass on an empty scan`);
  }
  const files = absFiles.map((abs) => relative(repoRoot, abs).split(sep).join('/'));
  const violations = files.flatMap((file, k) => scanSimSource(file, readFileSync(absFiles[k] ?? '', 'utf8')));
  return { files, violations };
}

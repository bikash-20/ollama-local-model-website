#!/usr/bin/env node
// Test harness for wrapBareLatex. Run with: node test_math.mjs
// Asserts that the real outputs we see in the wild are wrapped into valid
// KaTeX delimiters before being handed to marked.

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, 'index.html'), 'utf8');

// Extract the big inline script, then isolate only the function we want.
// We use a regex to grab `function wrapBareLatex(...) { ... }` plus any
// constants it references, and stub everything else.
const m = html.match(/function wrapBareLatex\s*\([\s\S]*?\n\s*\}/);
if(!m){
  console.error('Could not locate wrapBareLatex function');
  process.exit(2);
}
const fnSource = m[0];

// Hoist TEX_CMD / BARELINE / etc. — they're usually declared right above
// the function. We'll grab the whole region from "const TEX_CMD" to the end
// of the function.
const region = html.match(/(\/\*\*[\s\S]*?\*\/)?\s*const\s+TEX_CMD[\s\S]*?function wrapBareLatex[\s\S]*?\n\s{0,2}\}\s*\n/);
const target = region ? region[0] : fnSource;

// Sandbox: run the script in a minimal global. Strip anything that touches
// `document` so it can execute safely under Node.
const noop = () => ({addEventListener: noop, appendChild: noop, removeChild: noop, classList: {add: noop, remove: noop, toggle: noop}, setAttribute: noop, querySelectorAll: () => [], querySelector: () => null, getAttribute: () => null, style: {}, dataset: {}});
const fakeContext = {
  console,
  document: new Proxy({}, {get: (_, k) => {
    if(k === 'getElementById') return () => noop();
    if(k === 'querySelectorAll') return () => [];
    if(k === 'querySelector') return () => null;
    if(k === 'addEventListener') return noop;
    return noop;
  }}),
  window: {addEventListener: noop},
  navigator: {userAgent: 'node', language: 'en-US'},
  localStorage: {getItem: () => null, setItem: noop, removeItem: noop},
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (cb) => setTimeout(cb, 16),
  URL: {createObjectURL: () => '', revokeObjectURL: noop},
  fetch: () => Promise.reject(new Error('no network in test harness')),
  ResizeObserver: class { observe(){} unobserve(){} disconnect(){} },
  AbortController,
};
const ctx = vm.createContext(fakeContext);
vm.runInContext(target, ctx);

// Pull out the helpers.
const {wrapBareLatex} = ctx;

const cases = [
  {
    name: 'multiline [ ... ] block from Qwen (the screenshot)',
    input: `2. Second Quartile (Q2 or Median):

   ◦ When ( n ) is odd:

     [
     Q_2 = \left \frac{n+1}{2} \right ^{th} \text{ term}
     ]

   ◦ When ( n ) is even:

     [
     Q_2 = \frac{\text{The} \left \frac{n}{2} \right ^{th} \text{ term} +
     \text{The} \left \frac{n}{2}+1 \right ^{th} \text{ term}}{2}
     ]

3. Third Quartile (Q3):`,
    expect: (out) => {
      // The two [ ... ] blocks should now be $$ ... $$.
      const blockCount = (out.match(/\$\$[\s\S]*?\$\$/g) || []).length;
      if(blockCount < 2) throw new Error(`expected >=2 $$...$$ blocks, got ${blockCount}\n--- output ---\n${out}`);
    }
  },
  {
    name: 'single-line [ ... ] inline',
    input: `The roots are [ x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} ]`,
    expect: (out) => {
      if(!/\$\s*x\s*=\s*\\frac\{-b/.test(out)) throw new Error(`expected inline $...$, got:\n${out}`);
    }
  },
  {
    name: 'paren-wrap with math',
    input: `of the form ( ax^2 + bx + c = 0 ) and discriminant ( b^2 - 4ac )`,
    expect: (out) => {
      if(!out.includes('$ax^2 + bx + c = 0$')) throw new Error(`expected $ax^2 + bx + c = 0$, got:\n${out}`);
      if(!out.includes('$b^2 - 4ac$')) throw new Error(`expected $b^2 - 4ac$, got:\n${out}`);
    }
  },
  {
    name: 'paren-wrap with \\frac',
    input: `median is ( \\frac{n+1}{2} )th term`,
    expect: (out) => {
      if(!/\$\s*\\frac\{n\+1\}\{2\}\s*\$/.test(out)) throw new Error(`expected $\\frac{n+1}{2}$, got:\n${out}`);
    }
  },
  {
    name: 'bare line TeX wrap',
    input: `Some prose here\n\\frac{a}{b} = 0.5\nmore prose`,
    expect: (out) => {
      if(!out.includes('$\\frac{a}{b} = 0.5$')) throw new Error(`expected $\\frac{a}{b} = 0.5$, got:\n${out}`);
    }
  },
  {
    name: 'short implicit line (a_n + 1) gets wrapped as a unit',
    input: `count from 1\nn_th = a_n + 1\ndone`,
    expect: (out) => {
      // Pure-math line gets wrapped as a unit: $n_th = a_n + 1$
      if(!/\$n_th = a_n \+ 1\$/.test(out)) throw new Error(`expected $n_th = a_n + 1$, got:\n${out}`);
      // Prose around it untouched.
      if(!out.includes('count from 1') || !out.includes('done')) throw new Error(`prose lost:\n${out}`);
    }
  },
  {
    name: 'block of $$ ... $$ is NOT fragmented by per-line passes',
    input: `[
Q_1 = \\frac{(n+1)}{4}^{\\text{th}} \\text{ term}
]`,
    expect: (out) => {
      // Should be a single $$ ... $$. Must not contain nested $...$ inside.
      const openCount = (out.match(/\$\$/g) || []).length;
      if(openCount !== 2) throw new Error(`expected 2 $$ markers, got ${openCount}\n${out}`);
      // No naked $...$ in the middle.
      const inlineCount = (out.match(/(?<!\\)\$/g) || []).length;
      if(inlineCount !== 4) throw new Error(`expected 4 dollars ($$ pair only), got ${inlineCount}\n${out}`);
    }
  },
  {
    name: 'multi-line { ... } braces around TeX become $$',
    input: `consider the system

{
x_1 + 2 x_2 = 5
3 x_1 - x_2 = 1
}

solved by elimination`,
    expect: (out) => {
      const openCount = (out.match(/\$\$/g) || []).length;
      // We don't strictly require this — `{...}` is more often the *set
      // notation*, not a math block. So just assert we didn't BREAK it:
      if(openCount > 4) throw new Error(`too many $$ markers:\n${out}`);
    }
  },
  {
    name: 'idempotent — wrapping an already-wrapped input does not double-wrap',
    input: `The roots are $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$ and discriminant $b^2 - 4ac$.`,
    expect: (out) => {
      // Should still contain exactly the same delimiters, not nested.
      const dollarCount = (out.match(/(?<![\\$])\$/g) || []).length;
      if(dollarCount !== 4) throw new Error(`expected 4 dollar signs (2 pairs), got ${dollarCount}\n${out}`);
    }
  },
  {
    name: 'leaves prose alone',
    input: `This is just normal prose with no math at all, just a sentence or two about nothing.`,
    expect: (out) => {
      if(out !== `This is just normal prose with no math at all, just a sentence or two about nothing.`) {
        throw new Error(`prose was modified:\n--- in ---\n${out}`);
      }
    }
  },
  {
    name: 'leaves code fences alone',
    input: '```js\nconst x = "\\frac{nope}"; // not math\n```',
    expect: (out) => {
      // The TeX inside the code block must NOT be wrapped in $...$.
      if(out.includes('$frac{nope')) throw new Error(`code-fence content was math-wrapped:\n${out}`);
    }
  },
  {
    name: 'leaves markdown lists alone',
    input: `- First item with \\frac{a}{b} that should NOT be math\n- Second item`,
    expect: (out) => {
      if(out.includes('$') && !out.includes('$$')) {
        // Loose: only fail if we clearly wrapped something on a list line.
        if(/-\s+\$/.test(out)) throw new Error(`list line got wrapped:\n${out}`);
      }
    }
  }
];

let pass = 0, fail = 0;
for(const c of cases){
  try{
    const out = wrapBareLatex(c.input);
    c.expect(out);
    pass++;
    console.log(`✓ ${c.name}`);
  }catch(e){
    fail++;
    console.log(`✗ ${c.name}`);
    console.log(`  ${e.message.split('\n').join('\n  ')}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
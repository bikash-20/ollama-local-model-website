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

// preprocessMarkdown is defined *before* the TEX_CMD consts, so grab it with
// a dedicated anchored match — it always ends right after `return joined;`.
const pmMatch = html.match(/function preprocessMarkdown\(src\)\{[\s\S]*?\n  return joined;\n\}/);
if(!pmMatch){
  console.error('Could not locate preprocessMarkdown function');
  process.exit(2);
}
const pmSource = pmMatch[0];

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
vm.runInContext(target + (pmSource ? '\n' + pmSource : ''), ctx);

// Pull out the helpers.
const {wrapBareLatex, preprocessMarkdown} = ctx;
// Also pull the stash arrays so tests can verify math placeholders.
// The vm sandbox exposes them as globals only if they're declared with
// `var`; `let` declarations stay lexical to the script and we have to
// fish them out by running a getter function in the same context.
vm.runInContext(`
  globalThis.__getMathStash = () => _mathStash;
  globalThis.__getCodeStash = () => _codeStash;
`, ctx);
const _mathStashRef = ctx.__getMathStash;
const _codeStashRef = ctx.__getCodeStash;
function stashByIndex(getter) {
  // Snapshot the current stash contents. We slice so tests see a stable
  // view even if subsequent calls to wrapBareLatex reset the stash.
  return getter().slice();
}

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
      // The two [ ... ] blocks become multi-line $$ ... $$ display blocks,
      // which are now STASHED (not inlined) so marked can't inject <br>
      // between the delimiter lines. Inline $$ markers should NOT appear
      // in the returned text; the stash should contain both blocks.
      const stash = stashByIndex(_mathStashRef);
      const blockCount = stash.filter(v => /^\$\$/.test(v)).length;
      if(blockCount < 2) throw new Error(`expected >=2 $$...$$ blocks in math stash, got ${blockCount}: ${JSON.stringify(stash)}\n--- output ---\n${out}`);
      // Output text has no inline $$ markers (only placeholders).
      const inlineBlockCount = (out.match(/\$\$[\s\S]*?\$\$/g) || []).length;
      if(inlineBlockCount !== 0) throw new Error(`expected 0 inline $$...$$ blocks (should be stashed), got ${inlineBlockCount}\n${out}`);
      // Two placeholders should be present.
      const placeholderCount = (out.match(/\x00MATHSTASH\d+\x00/g) || []).length;
      if(placeholderCount < 2) throw new Error(`expected >=2 placeholders, got ${placeholderCount}\n${out}`);
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
      // The $$ ... $$ block is stashed (not inlined) so marked with
      // breaks:true can't inject <br> tags between the delimiter lines.
      // Verify: no $$ markers in the returned text (they're stashed),
      // and the stash contains the block as a single $$ ... $$ unit.
      const openCount = (out.match(/\$\$/g) || []).length;
      if(openCount !== 0) throw new Error(`expected 0 $$ markers inlined (should be stashed), got ${openCount}\n${out}`);
      const stash = stashByIndex(_mathStashRef);
      const block = stash.find(v => /^\$\$/.test(v));
      if(!block) throw new Error(`expected a $$ ... $$ block in math stash, got: ${JSON.stringify(stash)}\n--- out ---\n${out}`);
      if((block.match(/\$\$/g) || []).length !== 2) throw new Error(`stash block should have exactly 2 $$ markers, got ${block}`);
      // The placeholder should appear in the output text once.
      if(!/\x00MATHSTASH0\x00/.test(out)) throw new Error(`expected placeholder \\x00MATHSTASH0\\x00 in output, got:\n${out}`);
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
      // Inline $...$ math is NOT stashed (only multi-line $$...$$ is,
      // because that's what breaks under marked breaks:true). The inline
      // delimiters must survive marked's parse intact — no nesting, no
      // double-wrapping, exactly 4 dollar signs (2 pairs).
      const stash = stashByIndex(_mathStashRef);
      if(stash.length !== 0) throw new Error(`expected 0 multi-line math stashes (only inline here), got ${stash.length}: ${JSON.stringify(stash)}`);
      const dollarCount = (out.match(/(?<![\\$])\$/g) || []).length;
      if (dollarCount !== 4) throw new Error(`expected 4 dollar signs (2 inline pairs), got ${dollarCount}\n${out}`);
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
  },
  {
    name: 'ragged table rows are padded to the header column count',
    fn: 'preprocessMarkdown',
    input: '| Model | Size | Speed |\n|---|---|---|\n| Llama 3 | 8B |\n| Qwen | 7B | fast |',
    expect: (out) => {
      const lines = out.split('\n');
      const row = lines[2].replace(/^\||\|$/g,'').split('|').map(c => c.trim());
      if(row.length !== 3 || row[2] !== '') throw new Error(`expected a padded 3-cell row, got: "${lines[2]}"\n--- output ---\n${out}`);
    }
  },
  {
    name: 'table separator alignment colons survive repair',
    fn: 'preprocessMarkdown',
    input: '| Name | Value | Note |\n|:---|:---:|---:|\n| a | b | c |',
    expect: (out) => {
      const sep = out.split('\n')[1] || '';
      if(!sep.includes(':---:') || !sep.includes('---:')) throw new Error(`alignment lost, separator is: "${sep}"\n--- output ---\n${out}`);
    }
  },
  {
    name: 'table repair keeps math-wrapping out of pipe rows',
    fn: 'preprocessMarkdown',
    input: '| a | b |\n|---|---|\n| 1 | 2 |',
    expect: (out) => {
      if(out.includes('$')) throw new Error(`table rows got math-wrapped:\n${out}`);
    }
  },
  // ---- Regression tests for bugs fixed after the original 15 cases ----
  {
    name: 'tight single-line bracket [x] wraps only the bracket contents',
    input: `We get [\\sqrt{2}] is irrational.`,
    expect: (out) => {
      // Bug: Pass 4 used to wrap the entire line in $...$ because the
      // bracket regex required `\s` after `[` and the line fell through.
      if(!out.includes('$\\sqrt{2}$')) throw new Error(`bracket contents not wrapped: ${out}`);
      if(out.startsWith('$We')) throw new Error(`entire line was wrapped instead of just the bracket:\n${out}`);
      if(!out.includes('We get ')) throw new Error(`prose around bracket lost:\n${out}`);
    }
  },
  {
    name: 'SmolLM-style \\[...\\] produces padded display block',
    input: `Then we have\n\\[\\frac{a}{b}\\]\nthe next paragraph.`,
    expect: (out) => {
      // Bug: Pass 0b used to emit '$$\\frac{a}{b}$$' with no padding,
      // so KaTeX rendered it as inline-style display. Now padded with \n
      // AND stashed so marked can't insert <br> tags between the delimiters.
      const stash = stashByIndex(_mathStashRef);
      const block = stash.find(v => v.includes('\\frac{a}{b}'));
      if(!block) throw new Error(`expected \\frac{a}{b} in math stash, got: ${JSON.stringify(stash)}`);
      if(!/\$\$\n\\frac\{a\}\{b\}\n\$\$/.test(block)) {
        throw new Error(`expected padded $$ ... $$ in stash, got: ${block}`);
      }
      // Output text has the placeholder (no $$ inline).
      if((out.match(/\$\$/g) || []).length !== 0) throw new Error(`expected 0 inline $$ (stashed), got:\n${out}`);
      if(!/\x00MATHSTASH0\x00/.test(out)) throw new Error(`expected placeholder in output:\n${out}`);
    }
  },
  {
    name: 'SmolLM-style \\( ... \\) inline still uses $...$',
    input: `Inline \\(x^2 + 1\\) math here.`,
    expect: (out) => {
      // \(...\) converts to $...$ inline (not stashed — only multi-line
      // $$...$$ blocks need stashing to survive marked breaks:true).
      // Stash should be empty; output should contain "$x^2 + 1$" inline.
      const stash = stashByIndex(_mathStashRef);
      if(stash.length !== 0) throw new Error(`expected 0 multi-line stashes, got ${stash.length}: ${JSON.stringify(stash)}`);
      if(!out.includes('$x^2 + 1$')) throw new Error(`inline $...$ not present in output: ${out}`);
      if(out.includes('\\(')) throw new Error(`\\( ... \\) delimiter survived in output: ${out}`);
    }
  },
  {
    name: 'indented bare-math line keeps its leading indent',
    input: `prose\n   \\frac{a}{b} = 0.5\n   more`,
    expect: (out) => {
      // Bug: Pass 4 used to wrap '$' + trimmed + '$', stripping the
      // leading whitespace. Now we keep the indent.
      if(!/^   \$\\frac\{a\}\{b\} = 0\.5\$$/m.test(out)) {
        throw new Error(`indent not preserved, got:\n${out}`);
      }
    }
  },
  {
    name: 'ragged table row with no trailing pipe still gets padded',
    fn: 'preprocessMarkdown',
    input: '| A | B | C |\n|---|---|---|\n| 1 | 2',
    expect: (out) => {
      const lines = out.split('\n');
      // Row "| 1 | 2" should be padded to 3 cells, then wrapped back to "| 1 | 2 |  |".
      if(!/^\| 1 \| 2 \|  \|$/.test(lines[2])) {
        throw new Error(`expected padded 3-cell row, got: "${lines[2]}"\n${out}`);
      }
    }
  },
  {
    name: 'ragged table row with no leading pipe still gets padded',
    fn: 'preprocessMarkdown',
    input: '| A | B | C |\n|---|---|---|\n1 | 2 | 3',
    expect: (out) => {
      const lines = out.split('\n');
      if(!/^\| 1 \| 2 \| 3 \|$/.test(lines[2])) {
        throw new Error(`expected row with missing leading pipe to be normalised, got: "${lines[2]}"\n${out}`);
      }
    }
  },
  // ---- Regression test for the BJT/JFET bug (user-reported) ----
  // The model emitted multi-line `$$ ... $$` blocks containing subscripts
  // (`I_C`, `I_{DSS}`, `V_{GS}`). marked with `breaks: true` was injecting
  // `<br>` between the delimiter lines, producing `<p>$$<br>...<br>$$</p>`
  // — KaTeX then either silently failed to render or rendered each token
  // on its own line, breaking subscripts visually. The fix: stash multi-
  // line `$$ ... $$` blocks so marked can't touch them, restore as raw
  // HTML in renderFinalMarkdown before KaTeX runs.
  {
    name: 'BJT/FET multi-line display math is stashed intact (no marked interference)',
    input: `Here:

$$
I_C = \\beta I_B
$$

Here:

$$
I_D = I_{DSS} \\left(1 - \\frac{V_{GS}}{V_P}\\right)^2
$$`,
    expect: (out) => {
      const stash = stashByIndex(_mathStashRef);
      // Both display blocks must be stashed, with their delimiter lines
      // preserved (no `<br>` injection — that's marked's job, but the
      // placeholders never reach marked).
      if(stash.length !== 2) throw new Error(`expected 2 stashed blocks, got ${stash.length}: ${JSON.stringify(stash)}`);
      const bjt = stash[0];
      if(!/^\$\$\nI_C = \\beta I_B\n\$\$$/.test(bjt)) throw new Error(`BJT block should be padded $$ ... $$, got: ${JSON.stringify(bjt)}`);
      const fet = stash[1];
      if(!/^\$\$\nI_D = I_\{DSS\}/.test(fet)) throw new Error(`FET block should start with $$ then I_D = I_{DSS}, got: ${JSON.stringify(fet)}`);
      // Output text must contain NO inline `$$` markers (everything stashed).
      const inlineBlockCount = (out.match(/\$\$/g) || []).length;
      if(inlineBlockCount !== 0) throw new Error(`expected 0 inline $$ markers (stashed), got ${inlineBlockCount}\n${out}`);
      // Both placeholders should appear in the output text.
      const placeholderCount = (out.match(/\x00MATHSTASH\d+\x00/g) || []).length;
      if(placeholderCount !== 2) throw new Error(`expected 2 placeholders, got ${placeholderCount}\n${out}`);
      // The surrounding prose ("Here:") should survive intact.
      if(!out.includes('Here:')) throw new Error(`prose around math was lost:\n${out}`);
    }
  }
];

let pass = 0, fail = 0;
for(const c of cases){
  try{
    const fn = (c.fn === 'preprocessMarkdown') ? preprocessMarkdown : wrapBareLatex;
    const out = fn(c.input);
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
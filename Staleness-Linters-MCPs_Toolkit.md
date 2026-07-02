# Stale Docs, Linters & MCPs — Concrete Toolkit (mid-2026)

**Prepared for:** Ondřej · **Date:** 30 June 2026
**Scope:** the three practical questions I under-served before — (1) how to actually kill doc staleness, (2) which linters enforce docs/naming, (3) which MCPs to give agents. Adopt-vs-build for each, with the exact wiring.

---

## TL;DR

- **Stale docs:** stop relying on discipline. Use a 3-layer stack: **(a) make examples un-stale by construction** (transclude real code + run it as doctests), **(b) make staleness build-breaking** (link-integrity + a deterministic freshness gate in CI), **(c) an agentic fixer for the semantic gray zone** (a PR-triggered Claude job that opens doc-fix PRs). Almost all of it is off-the-shelf OSS.
- **Linters:** one tool per concern, one config, run in three places (Claude hook → git hook → CI). Minimal set: **markdownlint-cli2, Vale (custom naming terms), cspell, ls-lint, ESLint naming-convention, interrogate/eslint-plugin-jsdoc, gitleaks**; aggregate with **MegaLinter** in CI, **lefthook** as the local runner.
- **MCPs:** for *your own* repos you likely **don't need a code-search MCP** — Claude Code's native grep + Glob + Explore subagent + (now native) LSP cover ~90%. Adopt **Context7 + DeepWiki + GitHub MCP + the `llms.txt` habit** for knowledge/live-docs; add **Serena or ast-grep only for heavy refactors**; skip the "index my repo into a vector DB" category.
- **The only things worth building** (and they tie straight into Ship/Chart Room): an **autofix-on-move link codemod** for folder-independent links, a **doc-freshness MCP** so agents self-check before trusting a doc, and a **one-file reusable gate** every repo inherits.

---

## 1. How to deal with stale docs

The 2026 consensus, and it's a real shift: **prefer "impossible" over "detect," and "detect" over "remind."** Discipline-based "we'll update it later" is dead — partly because agents now read docs as ground truth and confidently act on rot. (A 2024 study found **28.9%** of sampled repos document a function/file/class that no longer exists, average wrong reference standing **4.7 years**; Cloudflare's verdict after rolling out agents internally: *"a stale AGENTS.md can be worse than no AGENTS.md."*)

Build it in layers, cheapest/hardest-guarantee first:

**Layer A — make examples un-stale by construction (no detection needed).**
- **Transclude real source into docs** instead of hand-copying: `embedme` (with `--verify` to fail CI on drift), MkDocs `--8<--` snippets / `mkdocs-codeinclude`, mdBook `{{#include file:anchor}}`, or `mdsh --frozen` for *command output*. The doc literally pulls from the code, so it can't diverge.
- **Run examples as tests:** Python `doctest`, Rust `cargo test --doc`, `rust-skeptic`/`mdbook-keeper` for Markdown blocks. A wrong example becomes a failing build.
- **Generate API reference from source** (rustdoc / Sphinx-autodoc / Bazel Stardoc) and diff-check the generated output in CI so reference docs can't lag signatures.

**Layer B — make remaining staleness build-breaking (deterministic CI gate).**
- **Link integrity on every commit:** `lychee` (external URLs) + `remark-validate-links` (local relative links *and* heading anchors). The second one is what catches **your specific cross-machine pain** — links breaking when folder structure differs or after a file move.
- **A freshness score as a required status check**, computed from three deterministic signals, no LLM: **git-age delta** (`git log --follow`/blame — doc untouched while its source changed), **symbol drift** (symbols referenced in the doc still exist with the same signature — regex → tree-sitter → SCIP as you scale), and **per-page TTL** (YAML frontmatter `ttl_days` + `sources:` globs). Off-the-shelf: **`docvet`** (Python, has exactly these `stale-*` rules), **`docfresh`** (Rust, pins each page to a source SHA), **giantswarm/frontmatter-validator** (TTL/`last_review_date` gate), or copy **Dosu's published `freshness.py` + Actions workflow**. Block merge below an SLO (e.g. median ≥ 75; any critical page failing = hard fail) with a `bypass` label as the escape hatch.

**Layer C — an agentic fixer for the semantic gray zone (on top, never instead).**
- A **PR-triggered Claude Code Action doc-fixer** (`anthropics/claude-code-action`): on PR-merged, it reads the diff + docs and opens a *separate* doc-update PR. This catches "behavior changed but the symbol still exists," which deterministic checks miss. Guardrails that matter: gate on `author_association` (OWNER/MEMBER/COLLABORATOR), wrap untrusted PR title/body in XML tags (prompt-injection), concurrency group to avoid PR loops, `--max-turns` as the cost cap (~$0.50–2/run). Route only mid-range freshness scores to it; let deterministic gates handle the rest.
- A weekly **"doc gardener"** (cron Action or a Claude subagent / the `docs-guardian` plugin) that batches doc-fix PRs.

**Keep `CLAUDE.md`/`AGENTS.md` itself fresh and lean** — it's the highest-value, highest-risk doc (a stale one poisons every agent run). Describe *capabilities*, not file structure (drifts less); keep it short (it burns context every call); add a hook that greps it for paths that no longer exist.

**Recommended starting workflow (solo dev + agents):**

1. `lefthook` pre-commit on changed files: `lychee` + `remark-validate-links` + `markdownlint` + doctests. Staleness never enters history.
2. Convert hand-copied snippets to `embedme`/include directives; add `embedme --verify` (or `mkdocs build --strict`) to CI.
3. Add `ttl_days`/`sources` frontmatter to your ~10 most-edited pages; drop in `docvet` (or Dosu's `freshness.py`) as a **required** CI check.
4. Add the PR-triggered Claude doc-fixer for the gray zone.
5. Make "docs verified / freshness ≥ floor" part of the definition-of-done (enforced by the gate, not a checkbox).

---

## 2. Linters that enforce docs + naming

Principle: **one tool per concern**, share each config across the Claude hook, the git hook, and CI. Don't double-up (markdownlint *and* remark; Vale *and* textlint; gitleaks *and* secretlint).

| Concern | Use | Notes |
|---|---|---|
| Markdown hygiene | **markdownlint-cli2** | Mature, fast, config-driven. Use remark-lint only if you need AST custom rules. |
| Prose **+ naming terminology** | **Vale** (custom Vocab + substitution rules) | The only tool that enforces "say `Claude Code` not `claude-code`, never `whitelist`" as *data*. Proselint/write-good are obsolete next to it. |
| Spelling (code + docs) | **cspell** | Identifier-aware (CamelCase/snake), in-repo dictionary. |
| File/folder naming | **ls-lint** | One tiny YAML, millisecond runtime → perfect as an agent hook. |
| Code identifier naming (JS/TS) | **typescript-eslint `naming-convention`** | You already run ESLint; no new tool. |
| Docstring **presence** | **interrogate** (Python, `--fail-under`) / **eslint-plugin-jsdoc** (`require-jsdoc publicOnly`) | Forces docs to exist on public API. Add **pydoclint** for docstring *correctness* (it's ~1000× faster than the deprecated darglint). |
| Secrets | **gitleaks** | Fastest pre-commit block; 2026 default. |
| API specs (only if you ship OpenAPI) | **Spectral** | Otherwise omit. |

**Aggregator:** use **MegaLinter** in CI (bundles markdownlint, cspell, ls-lint, secretlint, spectral; runs in parallel; can open auto-fix PRs) so you maintain one workflow file. Keep Vale + the Python docstring tools + ESLint first-class (those are the configs you'll tune). Skip Super-Linter (sequential = slow); use `trunk.io` only if you want the paid hosted DX.

**Local runner:** **lefthook** (Go, parallel, polyglot, no Node requirement) over husky+lint-staged for multi-repo work. Fast linters (ls-lint, gitleaks, markdownlint, cspell) on **pre-commit**; slow ones (full Vale, interrogate, type-check) on **pre-push**.

---

## 3. The enforcement layer — make it bite, especially for agents

Rules in `CLAUDE.md` are *suggestions*; only a **non-zero exit** enforces. Same configs run in three places:

**Claude Code hooks (this is what makes it real for agents):**
- **`PreToolUse`** (match `Edit|Write`) → hard block before a bad write: exit `2` with the reason on stderr, or return `{"permissionDecision":"deny",...}`. Use for non-negotiables (gitleaks on proposed content; ls-lint on the target *path* so the agent can't even create `MyComponent.tsx` when kebab-case is required).
- **`PostToolUse`** → lint the just-edited file. Prefer **auto-fixers** here (`prettier --write`, `markdownlint --fix`) so the agent's output is silently corrected; for non-fixables, exit `2` with errors on stderr so Claude self-corrects. (It *can't* undo the edit — it's corrective feedback.)
- **`Stop` / `SubagentStop`** → the **highest-leverage** gate: run the full suite (or lint `git diff`), and `{"decision":"block","reason":"interrogate: 3 functions missing docstrings; vale: 2 term violations"}`. Claude then **keeps working** using the reason as its next instruction instead of declaring done. This is a literal definition-of-done for agents, and it fires for subagents too (they can't bypass it).

**CI backstop (don't trust the client):** hooks are local and `--no-verify`-skippable, so the **same linters run as a required GitHub Actions check** (MegaLinter + Vale + interrogate), with **reviewdog** posting inline PR comments (`fail_on_error: true`).

**Gotchas:** exit **2** enforces, exit 1 only warns; `PostToolUse` can't block (use `PreToolUse`); scope per-file for sub-second hooks (don't run full-repo Vale on every edit — reserve for `Stop`/pre-push/CI); keep hook config and CI config identical so they never drift; route cheap lint to **Haiku**, review to **Sonnet** via subagent `model:` to control cost.

---

## 4. MCPs to give your agents

**The honest verdict first:** for working on *your own* repos, Claude Code **does not need a code-search MCP**. Anthropic A/B-tested RAG/embeddings internally and chose agentic grep ("simpler, fewer issues around staleness/privacy/reliability"); the native toolchain (Glob → ripgrep Grep → Read → an **Explore subagent** in isolated context) plus **now-native LSP** (GA in v2.0.74) covers ~90% of code search with zero setup, perfect freshness, and nothing leaving your machine. Every connected MCP also injects its tool schema into *every* turn (commonly 7k–18k tokens before any work), so an "index my repo into a vector DB" MCP usually costs more than it returns. (Mitigate standing cost with Tool Search where supported.)

**Adopt (small, high-leverage):**

| MCP | Job | Why |
|---|---|---|
| **Context7** | Live, version-pinned library docs | Anti-hallucination for third-party APIs; MIT, self-hostable. (Free tier now ~1k req/mo — add a key if you hit it.) |
| **DeepWiki** (Cognition) | "Understand this repo/dependency" + cited Q&A | Free, no-auth, zero-setup, public repos pre-indexed. Pairs with Context7 (architecture vs docs). |
| **GitHub MCP** (official) | Issues / PRs / Actions / commit search across your many repos | For repo *operations*, not primary local code search. |
| **`llms.txt` habit** | Live docs (a convention, not an install) | Point agents at a library's `/llms.txt` / `/llms-full.txt` — big token win, near-free. |

**Add only when the shoe fits (toggle off by default):**
- **Serena** (LSP-based symbol search + *edits* + per-repo memories) — genuinely wins on **heavy multi-file refactors** in large/unfamiliar code; but ~4× cost and ~60% slower on simple lookups, so enable per-session, and re-test against Claude Code's now-native LSP first.
- **ast-grep** — precise AST structural search/rewrite; reach for it when writing codemods or hunting structural patterns.

**Skip (for a solo dev):** `claude-context`/CocoIndex and the vector-DB indexing category (operational overhead + per-turn tax to beat grep mainly on giant inconsistent monorepos you don't have); Sourcegraph Cody/Amp (enterprise pricing; free tier discontinued); Repomix as a standing search layer. **Don't stack overlapping code MCPs** (Serena + octocode + claude-context) — pick one.

**What actually makes agentic grep land on the right file is convention, not a server:** a good per-project `CLAUDE.md` (architecture map, key paths, naming) does more than any index. If you adopt Serena, commit `.serena/memories/` so all sessions/agents share context.

---

## 5. How this ties back to your projects

This whole page *is* your "enforceable workflow that removes staleness" bullet — and the encouraging finding is that **~90% of it is adopt-off-the-shelf**, not build. Reuse the linters, the link checkers, the freshness gate, the doctest/transclusion patterns, the hooks. Don't build a code-search or docs MCP; don't build a linter.

The **small set genuinely worth building** is exactly the gap that also powers Ship/Chart Room and the Platform:

1. **An autofix-on-move link codemod** for **folder-independent links** — `remark-validate-links` *detects* breakage, but nothing deterministically rewrites every inbound reference when a file moves/renames. This is the Chart Room headline feature and it closes your cross-machine "stale references" pain at the root.
2. **A doc-freshness MCP** so an agent can ask mid-task "is this doc stale? which doc covers this file?" *before* trusting it (Dosu ships one on the SaaS side; a local OSS one keyed off your `freshness.json` would let any Claude session self-check).
3. **A one-file reusable gate** (lefthook + lychee + remark-validate-links + a tree-sitter freshness scorer + doctests + an optional Claude gray-zone check) that every project inherits with a single drop-in — so "start a new project" stops being painful and every repo is anti-stale by default. That last point directly attacks your original "starting a new one is painful, managing all is a nightmare."

---

## Sources

**Stale docs / drift**
- [Dosu — score documentation freshness in CI (copy-pasteable `freshness.py` + workflow)](https://dosu.dev/blog/score-documentation-freshness-in-ci) · [catch doc drift with Claude Code + Actions](https://dosu.dev/blog/how-to-catch-documentation-drift-claude-code-github-actions) · [a stale AGENTS.md is worse than none](https://dosu.dev/blog/a-stale-agents-md-is-worse-than-no-agents-md)
- [Cloudflare — internal AI engineering stack (AGENTS.md drift enforcement)](https://blog.cloudflare.com/internal-ai-engineering-stack/)
- [embedme (`--verify`)](https://github.com/zakhenry/embedme) · [mdsh `--frozen`](https://github.com/bashup/mdsh) · [Material for MkDocs snippets](https://squidfunk.github.io/mkdocs-material/reference/code-blocks/) · [mdBook](https://rust-lang.github.io/mdBook/) · [mdbook-keeper](https://crates.io/crates/mdbook-keeper) · [Rust doctests](https://doc.rust-lang.org/rustdoc/documentation-tests.html) · [Python doctest](https://docs.python.org/3/library/doctest.html)
- [docvet (freshness rules)](https://github.com/Alberto-Codes/docvet) · [docfresh (SHA-pinned)](https://crates.io/crates/docfresh) · [giantswarm/frontmatter-validator](https://github.com/giantswarm/frontmatter-validator)
- [lychee](https://github.com/lycheeverse/lychee) · [remark-validate-links](https://github.com/remarkjs/remark-validate-links) · [markdown-link-check](https://github.com/tcort/markdown-link-check)
- [Swimm — continuous documentation / Auto-sync](https://docs.swimm.io/new-to-swimm/continuous-documentation/) · [DeepDocs](https://deepdocs.dev/) · [Mintlify automations](https://www.mintlify.com/blog/automations) · [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action)

**Linters & enforcement**
- [Vale](https://vale.sh/) (substitution/Vocab rules) · [markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2) · [cspell](https://cspell.org/) · [ls-lint](https://github.com/loeffel-io/ls-lint) · [typescript-eslint naming-convention](https://typescript-eslint.io/rules/naming-convention/)
- [interrogate](https://interrogate.readthedocs.io/) · [eslint-plugin-jsdoc](https://github.com/gajus/eslint-plugin-jsdoc) · [pydoclint](https://github.com/jsh9/pydoclint) · [gitleaks](https://github.com/gitleaks/gitleaks) · [Spectral](https://github.com/stoplightio/spectral)
- [MegaLinter](https://github.com/oxsecurity/megalinter) · [lefthook vs husky vs lint-staged (2026)](https://www.pkgpulse.com/guides/husky-vs-lefthook-vs-lint-staged-git-hooks-nodejs-2026) · [reviewdog](https://github.com/reviewdog/reviewdog)
- [Claude Code — hooks (official; exit-2 vs decision:block, Stop gate, subagent inheritance)](https://code.claude.com/docs/en/hooks-guide) · [Claude Code — subagents](https://code.claude.com/docs/en/sub-agents)

**MCPs / code search**
- [Boris Cherny — why Claude Code dropped RAG for agentic grep](https://x.com/bcherny/status/2017824286489383315) · [HN discussion](https://news.ycombinator.com/item?id=43164253) · [Anthropic — effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Amazon Science — "Keyword Search Is All You Need" (arXiv 2602.23368)](https://arxiv.org/abs/2602.23368) · ["Claude Code doesn't index your codebase" (synthesis)](https://vadim.blog/claude-code-no-indexing/) · [MCP token overhead](https://www.mindstudio.ai/blog/claude-code-mcp-server-token-overhead)
- [Serena](https://github.com/oraios/serena) · [ast-grep](https://ast-grep.github.io/) · [Context7](https://github.com/upstash/context7) · [DeepWiki MCP](https://cognition.com/blog/deepwiki-mcp-server) · [GitHub MCP server](https://github.com/github/github-mcp-server) · [ManoMano — Serena refactor benchmark](https://medium.com/manomano-tech/project-aegis-benchmarking-ai-agents-and-why-serena-is-our-new-must-have-311673db35dd)

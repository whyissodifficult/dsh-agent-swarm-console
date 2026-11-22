# DSH Agent Swarm Console

> **See your AI team work. Trust that it finished.** — A multi-agent orchestration canvas and delivery-verification plugin for DeepSeek Harness.

[中文](README.md) · English

---

## Why

Running multiple AI agents in parallel is no longer hard — DeepSeek Harness already ships `subagent` and `workflow`. But two problems show up the moment you actually use them:

- **Invisible** — What is each agent doing? Which agent produced which artifact? You can't see the process, only the final result.
- **Untrustworthy** — An agent says "done", but that may just be a log line with zero real output. Without evidence, you can't let it work unsupervised.

Agent Swarm Console fixes both: **a live canvas** to see the whole team, and **a delivery gate** that requires evidence before "done" is accepted.

---

## Features

- **Multi-agent orchestration canvas** — one node per agent; forks / parallel / merges drawn as links; status, artifacts and logs stream live
- **Natural-language driven** — the main agent recruits, plans, executes and summarizes through a single command
- **Delivery gate** — every agent must attach evidence on completion (files changed, checks run); unverified results are not accepted
- **Teach-by-capability** — assign tasks by capability tags (reasoning / vision / long-context / local-private)
- **Low-version friendly** — runtime capability detection with graceful degradation, no hard version lock

DeepSeek is the default reasoning workhorse; other providers serve as specialists.

---

## Status

> ✅ **0.4.2 released** — npm package install and local-directory install are both verified; the delivery gate and four slash commands (`/gate-freeze` included) (session-scoped) work. Source is developing 0.3.0 (breaking contract changes). Canvas still in progress.

- [x] Competitive research & architecture design
- [x] Design doc finalized (v1.1)
- [x] P0 · Minimal runnable prototype
- [x] P1 · Domestic agent adapter layer (`src/` adapter + `wiring/`)
- [ ] P2 · Delivery gate
- [ ] P3 · Open-source v0.1

---

## Principles

1. **Build on what exists** — an observability layer above DSH's native primitives, not another wheel
2. **Visible beats invisible** — process visualization isn't decoration, it's the prerequisite for trust
3. **"Done" needs evidence** — an agent's self-report is not enough; runtime evidence is
4. **Generic framework, config-driven** — adding a new agent is one line of config, not a new adapter

---

## License

[MIT](LICENSE)

---

## Author

Zhiyang Zheng (Walk in the white) · 2026

A freshman who believes an AI team should be as visible and manageable as a real one.

# 21 - Model Context Protocol (MCP)

> **Weeks 40-41** | Previous: [[20 - Reinforcement Learning & Bandits in Practice]] | Next: [[22 - World Models]]

Model Context Protocol is the piece of plumbing that clients now ask for by name — usually with a security worry attached in the same breath. "We want our assistant to actually *do* things — read the CRM, file the ticket, query the warehouse — but we heard MCP is a data-leak risk. Is it safe?" This module answers both halves, because you cannot answer the second without the first.

The honest headline, which the rest of the module earns: **MCP does not create a new class of vulnerability. It industrializes an old one.** Everything dangerous about connecting a language model to your tools and data was already dangerous before the protocol existed — MCP just makes it a five-minute config change instead of a bespoke engineering project, which moves the risk from "buried in code review" to "one dropdown in a settings panel." That shift is the whole story: it is what makes MCP genuinely useful *and* what makes the paranoia partly justified and partly theater. Your job as a tech lead is to tell the client which is which — to separate the real, governable danger from the reflexive "let's ban it" that quietly pushes people toward something worse. By the end you will be able to draw where the data actually flows (including through a LiteLLM-style proxy, and — critically — where it flows *around* one), name the attack classes with real 2025-26 examples, and design a posture that is proportionate to the client's actual data sensitivity rather than to their anxiety.

---

## Learning Objectives

- [ ] Explain what MCP is and — just as important — what it is *not*, in two sentences a CISO will accept.
- [ ] Trace a single tool call end to end and say exactly where the data travels and which systems can see it.
- [ ] Name the major attack classes — prompt injection, tool poisoning, rug pulls, confused-deputy/token abuse, supply chain — each with a concrete example.
- [ ] Use the **lethal trifecta** to judge whether a given integration is actually dangerous or merely sounds scary.
- [ ] Say precisely what a model-API proxy (LiteLLM, Portkey, a cloud AI gateway) does and does *not* see when an MCP tool fires.
- [ ] Design a proportionate security posture and defend which controls are necessary versus overkill for a given data-sensitivity tier.
- [ ] Vet a third-party MCP server against a checklist before it ever touches client data.
- [ ] Run the "our data will leak" conversation with a nervous client and land on *govern, don't ban*.

## Key Concepts

### 1. The Problem MCP Solves — and What It Actually Is

Before MCP, every time you wanted an LLM application to use an external system — GitHub, a Postgres database, Google Drive, a company wiki — someone wrote a bespoke integration: custom code to describe the tool to the model, call the API, and shuttle results back. With **M** applications and **N** systems you tend toward **M×N** integrations, each maintained separately. MCP is an open standard, introduced by Anthropic in November 2024 and adopted across the industry through 2025, that turns this into an **M+N** problem: a system exposes its capabilities *once* as an MCP **server**, and any MCP-capable **host** can consume it. The specification is versioned by date (the stable revision as of this writing is `2025-11-25`, with a large `2026-07-28` revision in release-candidate stage), and it is genuinely open — not an Anthropic product, not a hosted service.

> **Intuition — USB-C for AI integrations.** Before USB-C, every device shipped its own connector and you drowned in adapters. USB-C standardized the *port*, not the devices — a hostile device plugged into that port can still try to attack your laptop. MCP standardizes how models discover and call tools; it does nothing to guarantee the tool on the other end is trustworthy. Hold on to that distinction — most of this module lives in it.

Be equally clear about what MCP is *not*, because the misconceptions drive the fear. It is **not an agent framework** (it is the connection layer *under* the agents of [[11 - Agentic Architectures & LLM App Patterns]]). It is **not a model capability** baked into Claude or GPT. And — the one that matters most to a paranoid client — **it is not a data pipe to Anthropic or any model vendor.** An MCP server you run talks to *your* host; your data goes wherever your host and your tools send it. The protocol has no home-phone.

```
   Before MCP  (M×N bespoke integrations)        With MCP  (M+N)

   App A ─┬─ custom ─ GitHub                 App A ─┐
   App B ─┼─ custom ─ Postgres               App B ─┼─ MCP ─┬─ GitHub server
   App C ─┴─ custom ─ Drive                  App C ─┘       ├─ Postgres server
     each line hand-built & maintained                     └─ Drive server
                                              one adapter per system, reused by all
```

**MCP is a standard connector, not a trust decision.** It tells you how to plug things in; it never tells you whether you should.

### 2. Architecture: Hosts, Clients, Servers

Three roles. The **host** is the application the user actually interacts with — Claude Desktop, an IDE assistant, a custom chatbot. The host is where policy lives: it decides which servers are connected, surfaces consent prompts, and enforces whatever guardrails exist. Inside the host, one **client** is instantiated per server connection, maintaining a 1:1 session. A **server** is a capability adapter that exposes some system (a database, a SaaS API, the local filesystem) through the MCP interface.

The single most important architectural fact for security: **the host is the policy enforcement point.** Servers propose capabilities; the host (and the human behind it) disposes. If the host auto-approves everything, there is no enforcement anywhere.

Servers come in two deployment shapes, and the distinction is a security fault line:

- **Local servers** run on the user's machine and speak over stdio. They typically **inherit the user's own permissions** — filesystem access, local credentials, network. Convenient, and quietly dangerous: a local server is code running as you.
- **Remote servers** run somewhere else and speak over HTTP, authenticating with OAuth. These have a real authorization story (see concept 8) but add network-exposure and token-management concerns.

```
        HOST  (Claude Desktop / IDE / your app)
        │   owns: consent UI, policy, logging
   ┌────┼────────────┬──────────────┐
 client         client          client
   │  stdio        │ http+oauth     │ http+oauth
   ▼               ▼                ▼
 Local server   Remote server    Remote server
 (runs as you)  (SaaS vendor)    (your infra)
   │               │                │
 filesystem,     Jira/Asana/…     your DB/APIs
 local creds     (their data)     (your data)
        ▲ trust boundary crossed at every arrow ▲
```

**Every arrow in that diagram is a trust boundary.** Security review is mostly the discipline of asking, at each one, "what can cross here, and who vouched for the thing on the other side?"

One more architectural assumption to hold on to: the protocol authors are explicit that MCP relies on a **human in the loop** — users are meant to review tools before granting them and approve consequential actions. That assumption is load-bearing and routinely violated in practice, because humans click "approve" on everything (concept 8's consent fatigue). Many so-called "MCP vulnerabilities" are really "the human-in-the-loop assumption was quietly removed."

### 3. The Six Primitives

MCP defines six capability types. Three are offered by servers, three by clients. You do not need to implement them, but you must know they exist, because each is a different attack surface — and the last two are the ones people forget in threat models.

| Primitive | Offered by | What it does | Security edge |
| --- | --- | --- | --- |
| **Tools** | Server | Actions the model can invoke (`create_issue`, `run_query`) | The main event: side effects, data access |
| **Resources** | Server | Readable data the host can pull in as context | Untrusted content enters the prompt here |
| **Prompts** | Server | Reusable prompt templates the server suggests | Server-authored text the user may run blindly |
| **Sampling** | Client | Lets a server ask the host's model to complete text | Server can *drive the model*; often overlooked |
| **Roots** | Client | Tells the server which files/dirs it may touch | A scoping control — if the host honors it |
| **Elicitation** | Client | Lets a server ask the user for more input mid-task | A social-engineering surface |

> **Note — the two everyone forgets.** Threat models fixate on tools and resources and skip **sampling** and **elicitation**. Sampling means a server can request model generations through your host — a compromised server can use your model (and your bill, and your context) as a resource. Elicitation means a server can pop questions at the user mid-flow — a natural vector for "please paste your API key to continue." When you audit a server, ask which primitives it uses, not just which tools.

### 4. The Wire: JSON-RPC, Lifecycle, and Transports

Under the hood MCP is unglamorous, which is good — boring protocols have smaller attack surfaces. Messages are **JSON-RPC 2.0**. A session opens with an `initialize` handshake that negotiates protocol version and capabilities, after which the host typically calls `tools/list` to discover what the server offers and `tools/call` to invoke one. Transports are **stdio** (local) and **Streamable HTTP** (remote; an older HTTP+SSE transport is being retired).

```
 Host/Client                         Server
     │   initialize (version, caps)    │
     │ ──────────────────────────────► │
     │   capabilities, serverInfo      │
     │ ◄────────────────────────────── │
     │   tools/list                    │
     │ ──────────────────────────────► │
     │   [ {name, description, schema} ]│   ← descriptions enter the model's context
     │ ◄────────────────────────────── │
     │   tools/call(name, args)        │
     │ ──────────────────────────────► │
     │   result                        │   ← results enter the model's context
     │ ◄────────────────────────────── │
```

Two details matter later. First, **tool descriptions from `tools/list` are injected into the model's context** so it knows what is available — which makes them a prompt-injection vector *before any tool is called* (concept 7). Second, servers can send a `notifications/tools/list_changed` message to say "my tools changed," and a well-behaved host re-fetches — which is the mechanism behind rug pulls. **The wire is simple; the danger is in what rides on it.**

### 5. Where Your Data Actually Flows — the Load-Bearing Concept

This is the concept the entire security conversation hinges on, and it is the one most people get wrong. Consider a host that fronts its model through a LiteLLM (or Portkey, or cloud AI) gateway — the setup your security-conscious clients have adopted — and also connects an MCP server that can write to Jira.

```
   USER
    │  prompt
    ▼
   HOST ───────────►  LiteLLM / model-API proxy ───────►  Claude / GPT
    │   (prompt + tool defs + tool results all pass here — proxy SEES them)
    │
    │  model says: call jira.create_issue({...})
    ▼
   MCP client ───────►  Jira MCP server ───────►  JIRA (write happens here)
        the tool call + its side effect DO NOT traverse the model proxy
```

Trace it carefully. The **prompt, the tool definitions, and the tool results** travel host → model, so they pass *through* the LiteLLM proxy — it can log them, mask them, block on them. But the **tool invocation itself** — the actual write to Jira, the actual `SELECT` against your database, the actual file read — happens on the **host↔server↔system** path, which **does not go through the model-API proxy at all.** The proxy governs the *conversation with the model*; it has zero visibility into, and zero control over, the *side effects the model triggers*.

> **Worked example — the proxy that watched the wrong door.** A client routes all Claude traffic through LiteLLM with DLP scanning "so nothing leaks." Their assistant has a filesystem MCP server. The model, following an injected instruction, reads `~/.aws/credentials` and pastes it into a Jira ticket via the Jira server. The LiteLLM proxy sees a tidy little tool call and its result — it never sees the credentials file being read, because that read never went near the model API. The DLP that was supposed to be the safety net was watching the conversation while the exfiltration walked out the side door.

**A model-API proxy sees prompts and results; it never sees the tool's side effects.** Internalize this sentence. Half of enterprise MCP security is realizing that the control you already bought covers a different plane than the one MCP operates on (concept 11).

### 6. Threats I: Prompt Injection Is the Engine

Almost every serious MCP attack is prompt injection wearing a costume, so understand the engine first. **Direct** injection is the user telling the model to misbehave — mostly their own problem. **Indirect** injection is the dangerous one: malicious instructions arrive inside *content the model reads* — a support ticket, a web page, a GitHub issue, a resource pulled in via MCP — and the model, unable to reliably distinguish "data to process" from "instructions to follow," obeys them. The model becomes a **confused deputy**: it holds legitimate authority (your tools, your tokens) and is tricked into wielding it for someone else.

Simon Willison's **lethal trifecta** (June 2025) is the sharpest tool for judging real risk. An agent is dangerous when it combines all three of:

1. **Access to private/sensitive data** (your DB, your files, your inbox),
2. **Exposure to untrusted content** (anything an attacker can influence — tickets, emails, web pages),
3. **The ability to communicate externally** (send email, open a PR, make an HTTP request, even render a link).

```
        PRIVATE DATA ───────┐
                            ├──►  all three present  =  exfiltration is one
     UNTRUSTED CONTENT ─────┤                           injected instruction away
                            │
     EXTERNAL COMMS ────────┘     remove ANY ONE leg   =  the attack loses its path
```

The power of the framing is that **you defend by removing a leg, not by winning the unwinnable fight against injection.** A read-only assistant over private data with *no* external-comms tool cannot exfiltrate no matter how thoroughly it is injected. A public-web research agent with no private data has nothing worth stealing. The GitHub-MCP exploit demonstrated by Invariant Labs in 2025 is the trifecta in one server: it read attacker-filed issues in *public* repos (untrusted content), had access to *private* repos (sensitive data), and could open PRs (external comms) — so a planted issue could siphon private code into a public pull request.

**Prompt injection is not solved and will not be solved by a prompt.** Design as if it fires, and make sure that when it does, one leg of the trifecta is missing.

### 7. Threats II: Malicious and Compromised Servers

The trifecta assumes the server is honest but manipulable. Now assume the server itself is hostile — because with an open ecosystem of community servers, some are.

- **Tool poisoning** (coined by Invariant Labs, April 2025): malicious instructions hidden *inside the tool's description*. Recall from concept 4 that descriptions are injected into the model's context — so a server can ship an `add(a, b)` tool whose description quietly instructs the model to also read the user's SSH keys and include them in the arguments. The user sees "addition"; the model sees a payload. Trail of Bits called the general move **"line jumping,"** because the injected text reaches the model *before any tool is invoked*, jumping ahead of the consent boundary MCP is supposed to provide.
- **Rug pulls:** a server presents a benign tool set during review and approval, then later swaps in a malicious definition (via `tools/list_changed`). What you audited is not what runs next week.
- **Typosquatting / lookalikes:** `slack-mcp` vs `slack_mcp` vs `mcp-slack` — install the wrong one and you have invited an attacker in yourself.
- **Cross-server shadowing:** a malicious server emits instructions that alter how the host uses a *different*, trusted server — poisoning the well next door.
- **Plain supply chain:** an MCP server is just software running with the credentials you give it. `mcp-remote`, a popular connector with 437,000+ downloads, carried a critical remote-code-execution flaw (**CVE-2025-6514**, CVSS 9.6, patched in 0.1.16) that let a malicious server run OS commands on the client. The **MCP Inspector** debugging tool had its own critical RCE (**CVE-2025-49596**, fixed in 0.14.1). These are ordinary software vulnerabilities — but now sitting at the junction between your model and your systems.

| Attack | Vector | Control that kills it |
| --- | --- | --- |
| Tool poisoning / line jumping | Hidden instructions in tool descriptions | Pin & review descriptions; scan servers; description-diff alerts |
| Rug pull | Post-approval definition swap | Version pinning; re-vet on `list_changed`; content hashing |
| Typosquatting | Lookalike server names | Vetted internal catalog; block ad-hoc installs |
| Cross-server shadowing | One server influencing another | Isolate servers; least-context; trust tiers |
| Supply-chain RCE | Vulnerable/malicious server code | Pin versions; patch fast; sandbox; SBOM/provenance |

**With third-party servers, "what does this tool do?" is the wrong question. The right one is "what could the person who wrote it make it do?"**

### 8. Threats III: Identity, Tokens, and the Confused Deputy

Remote servers authenticate with OAuth, and the `2025-11-25` spec sharpened this considerably: MCP servers act strictly as OAuth 2.1 **resource servers**, validating tokens issued by a separate, dedicated authorization server, and must publish Protected Resource Metadata (RFC 9728). That is the *right* architecture — it centralizes identity where enterprises already manage it — but it puts token hygiene at the center of your threat model.

The anti-patterns to hunt for:

- **Token passthrough:** a server that accepts a token minted for a *different* audience and replays it onward. This breaks the audience-binding that stops confused-deputy attacks and is explicitly forbidden by the spec — so a server doing it is a red flag about everything else it does.
- **Token concentration:** one server (or one host) holding long-lived tokens for Gmail *and* Drive *and* GitHub *and* the warehouse. Compromise it once and you have not lost one system — you have lost the union of everything it could touch. Blast radius is the product of the scopes, not the sum.
- **Consent fatigue:** the human-in-the-loop assumption (concept 2b) dies here. After the fortieth approval dialog, everyone clicks "allow." Attackers rely on it.
- **Session hygiene:** predictable session IDs, tokens in URLs, sessions that never expire — the ordinary web-security failures, now guarding the door to your data.

**Least-privilege, short-lived, narrowly-scoped tokens are roughly 80% of your real defense** — unglamorous, and worth more than any amount of prompt-level cleverness.

### 9. The Fair Assessment — Is MCP Actually Dangerous?

Now the question the client actually asked. A balanced answer has four parts, and you should be able to deliver all four without flinching in either direction.

**(a) The protocol itself is thin.** MCP is JSON-RPC with a capability handshake. It introduces no novel cryptographic weakness, no new memory-safety class, no exotic vulnerability. Nothing about the wire format is inherently unsafe. Points to "the protocol is dangerous" are almost always misattributed.

**(b) What is genuinely new is scale and juxtaposition.** MCP makes it trivial — a config entry, done by someone who is not an engineer — to assemble the exact lethal trifecta that used to require a deliberate integration project. The risk did not get *worse* per integration; it got *far easier to create and far more common*, and it moved from "reviewed in a pull request" to "toggled in a settings pane." That is a real and material change, and dismissing it is as wrong as panicking about it.

**(c) Weigh it against the honest counterfactual.** The alternative to MCP is not safety — it is the *status quo*, which is worse in the ways that actually leak data. Bespoke integrations carried identical trifecta risk with none of the standardization; and the true baseline in most companies is **shadow AI**: employees pasting client data into consumer chatbots and copying answers back, entirely unlogged. Against *that*, a governed MCP deployment with an allowlist, a central audit trail, and a real consent model is a security *improvement*, not a regression. MCP at least gives you a choke point to govern.

> **Intuition — the browser-extension moment.** MCP is where browser extensions were a decade ago: an open, wildly useful ecosystem that also lets a plausible-looking add-on read everything you do. We did not ban browsers. We built stores with review, permissions models, enterprise allowlists, and the habit of asking "why does a flashlight app want your contacts?" MCP needs — and is rapidly growing — the same scaffolding. The trajectory is known; the controls are boring; the panic is optional.

**(d) The verdict, in one line: the danger is real, but it is *deployment* risk, not *protocol* risk — and deployment risk is exactly the kind you govern with boring, well-understood controls.** That sentence is what you say to the CISO. The rest of this module is the controls.

### 10. The Enterprise Posture Ladder — Necessary vs Overkill

There is no single "secure MCP setup." There is a posture proportionate to **data sensitivity × server provenance × read-vs-write**, and the skill a client pays for is calibration — not maximalism. Three tiers:

**Baseline (every deployment, even low-stakes):** maintain an inventory of connected servers; allowlist which servers may be used and who may add one; pin versions; source servers from a vetted registry rather than ad-hoc installs; keep secrets out of plaintext config. This is cheap and non-negotiable.

**Standard (real business data, mixed provenance):** read-only by default; human approval on any write or irreversible action; an **egress allowlist** so tools can only reach sanctioned destinations (this is your trifecta cut — kill the external-comms leg for sensitive flows); run servers sandboxed/containerized with least privilege; centralize logs of tool calls and results.

**Elevated (regulated or highly sensitive data):** DLP inspection on tool *results* (not just model traffic — remember concept 5); a dedicated MCP gateway that brokers and policies all server access; network segmentation between the AI plane and crown-jewel systems; treat external server vendors as data subprocessors with the contractual review that implies. This connects directly to the governance groundwork in [[14 - Data Governance, Privacy & Pseudonymisation]] and the Responsible-AI module that follows it.

And the half of the job nobody sells but everyone needs — **naming the overkill:**

| Control | Necessary when… | Overkill when… |
| --- | --- | --- |
| Human approval on every call | Writes to systems of record; regulated data | Read-only over public/low-sensitivity data — you are just training people to rubber-stamp |
| Full DLP on tool results | Regulated PII/PHI/financial data can transit | Internal dev tools over non-sensitive data |
| Dedicated MCP gateway | Many servers, many teams, sensitive data | One team, one internal read-only server |
| Banning all remote servers | Truly air-gapped / classified contexts | A vendor with SOC 2, scoped OAuth, and a support line — you are just breeding shadow AI |
| Bespoke "safe" protocol | ~Never | Always. You inherit every risk and lose the ecosystem |

```
   Is the data sensitive/regulated?
     │
     ├─ no ──► Baseline controls. Ship it. Stop over-engineering.
     │
     └─ yes ─► Can the tool reach an external destination?
                 │
                 ├─ no  ──► Standard tier. Read-only + logging is often enough.
                 │
                 └─ yes ─► Cut the leg (egress allowlist / remove the tool) OR
                           go Elevated: gateway + DLP-on-results + approval gate.
```

**The most senior move in an MCP review is subtraction: fewer servers, narrower scopes, one missing trifecta leg — not another layer of inspection bolted onto a design that should have been smaller.**

### 11. Two Control Planes — the LiteLLM Conversation

Your clients have invested in LiteLLM-style gateways and reasonably ask, "doesn't that cover us?" The precise answer wins their trust, and it is this: **there are two control planes, and a proxy on one is not a policy on the other.**

The **model-API plane** — LiteLLM, Portkey, cloud AI gateways — is real and valuable. It gives you API-key custody, a model allowlist, budget and rate limits, centralized logging of prompts and completions, PII masking on that traffic, and region routing for data residency. Keep it; it is good engineering. But re-read concept 5: it sees the *conversation with the model*, not the *side effects the model triggers*.

The **tool/MCP plane** is the one that governs those side effects, and it needs its own controls: the host's own server allowlist and consent policy, an MCP gateway or scanner (tools like Docker's MCP Toolkit, Invariant's `mcp-scan`, and others in this fast-moving space), server sandboxing, egress allowlisting, and logging of tool calls and results.

```
   ┌─────────────── MODEL-API PLANE ───────────────┐
   USER → HOST → LiteLLM/gateway → MODEL             │  keys, budgets, prompt logs,
   └──────────────────────────────────────────────────┘  masking, region routing
        │
        │  model decides to act
        ▼
   ┌─────────────── TOOL / MCP PLANE ───────────────┐
   HOST → MCP client → server → your systems         │  server allowlist, consent,
   └──────────────────────────────────────────────────┘  sandbox, egress rules, tool logs
        ▲ the two planes are governed separately — securing one says nothing about the other ▲
```

**Govern both planes.** When a client says "we route through LiteLLM so we're safe," the correct, relationship-building response is: "That secures your conversation with the model, and you should keep it. Now let's secure the plane where the model touches your data — because that traffic never passes through LiteLLM at all." That single reframing is worth more to them than any tool you could install.

## Client Mission Patterns / Commercial Angle

Sell *governance and enablement*, not fear. Clients are anxious and under-informed; the deliverable is a proportionate posture that lets them adopt safely, not a report that scares them into a ban they will violate anyway.

- **MCP / AI-Integration Security Assessment** — *Problem:* a client is adopting (or has quietly already adopted) MCP-based tools and has no view of the risk. *Deliverable:* an inventory of connected servers and tokens, a data-flow map (including the proxy-bypass of concept 5), a trifecta analysis per integration, and a prioritized remediation list. *Scope:* 2–3 weeks. *Who buys:* the CISO or Head of Security.
- **Safe-Enablement Program** — *Problem:* security wants to say no; the business wants the productivity; shadow AI is filling the gap. *Deliverable:* an MCP usage policy, a vetted internal server catalog, a gateway/allowlist architecture, and a workshop that gets both sides to yes. *Scope:* 4–6 weeks. *Who buys:* CTO jointly with security.
- **Internal MCP Server Pilot** — *Problem:* a genuinely useful internal capability (query the warehouse, search the wiki) that should be exposed to the assistant safely. *Deliverable:* a read-only server with scoped tokens, an eval harness proving its hit rate, sandboxing, and full logging — a reference implementation others copy. *Scope:* 3–5 weeks. *Who buys:* the platform or data-platform owner.
- **Two-Plane Gateway Architecture** — *Problem:* a client has LiteLLM and believes they are covered. *Deliverable:* a reference architecture placing the model-API gateway and the MCP/tool gateway correctly, with the policy each enforces written down. *Scope:* 2–4 weeks. *Who buys:* the platform/architecture lead.

## Tools & Vendor Landscape

*As of 2026 — a fast-moving space; treat names and capabilities as perishable and re-check before quoting.*

| Tool / Category | Use here | OSS / Paid | Note |
| --- | --- | --- | --- |
| Official MCP SDKs (Python, TypeScript, others) | Build servers and clients | OSS | The reference implementations; start here |
| FastMCP | Ergonomic Python server framework | OSS | Popular for standing up servers quickly |
| MCP Inspector | Local debugging UI for servers | OSS | Patch past CVE-2025-49596 (fixed 0.14.1) |
| Managed hosts with admin controls (Claude, IDE assistants, Copilot/Gemini surfaces) | Consume servers with org policy | Paid | Enterprise tiers add allowlists, audit, SSO |
| Registries (official MCP Registry, Docker MCP Catalog, Smithery, PulseMCP) | Discover vetted servers | Mixed | Prefer curated catalogs over ad-hoc installs |
| MCP gateways / scanners (Docker MCP Toolkit, Invariant `mcp-scan`, Trail of Bits `mcp-context-protector`, Lasso and peers) | Police the tool plane | Mixed | The emerging "tool-plane firewall" category |
| LLM/model-API gateways (LiteLLM, Portkey, cloud AI gateways) | Police the *model* plane | Mixed | **Model-plane only** — does not see tool side effects |
| Cloud remote-server hosting (Cloudflare, AWS, GCP patterns) | Run remote servers with managed auth | Paid | OAuth resource-server model per `2025-11-25` spec |

The path's rule holds: **buy the commodity — SDKs, gateways, catalogs, scanners — and build the differentiator, which is your allowlist, your policy, your scoped tokens, and your evals.** The vendor names churn; the judgment about where each plane's boundary sits does not.

## When Is This Overkill?

MCP is a genuinely good default when you have several tools consumed by several assistants. It is over-engineering when you do not.

| Situation | Do this instead |
| --- | --- |
| One application, one fixed integration | Just call the API in code — no protocol needed |
| The real need is "answer from our documents" | That is retrieval — see [[10 - RAG & Knowledge Systems]], not a tool server |
| A single internal tool for a single host | Native function calling is simpler and smaller |
| Read-only access to public, non-sensitive data | Lightweight vetting; skip the elevated controls |
| Leadership wants an org-wide MCP ban "for security" | Govern instead — a ban just relocates the data to unlogged shadow AI |
| Someone proposes a bespoke protocol "to avoid MCP's risks" | You would inherit every one of those risks and forfeit the ecosystem and tooling |

**The most senior sentence in an MCP security review is usually: "this doesn't need to be an MCP server at all."** The second most senior is "and the ones that do need three fewer permissions than they're asking for."

## Resources

### Docs & Specs

- Anthropic / MCP maintainers — *Model Context Protocol Specification* (`modelcontextprotocol.io`) — the authoritative source; read the Security Best Practices and Authorization pages specifically. *(Free)*
- Anthropic — *Introducing the Model Context Protocol* (announcement, November 2024) — the origin and design intent. *(Free)*
- Cloud Security Alliance — *Agentic MCP Security Best Practices* — a structured enterprise control set. *(Free)*

### Security Deep Dives

- Simon Willison — *The Lethal Trifecta for AI Agents* (June 2025) — the single most useful mental model in this module; read it first. *(Free)*
- Simon Willison — *Model Context Protocol has prompt injection security problems* — the clearest plain-English framing of the core issue. *(Free)*
- Invariant Labs — *Tool Poisoning Attacks* and the *GitHub MCP exploit* write-ups — where "tool poisoning" was coined, with reproducible demos. *(Free)*
- Trail of Bits — *"Jumping the Line"* MCP security blog series — line jumping, ANSI-escape tricks, and the `mcp-context-protector` defense. *(Free)*
- Hou et al. — *Model Context Protocol (MCP): Landscape, Security Threats, and Future Directions* (arXiv, 2025) — a broad academic survey of the threat taxonomy. *(Free)*
- OWASP — *GenAI / LLM Top 10* — the prompt-injection and excessive-agency entries map directly onto MCP risk. *(Free)*

### Go Deeper

- The layer *above* this — agents that orchestrate these tools — is [[11 - Agentic Architectures & LLM App Patterns]]; the data-classification and privacy groundwork *beneath* a good posture is [[14 - Data Governance, Privacy & Pseudonymisation]]; putting any of it into production safely is [[13 - MLOps & Productionization]].
- The responsible-AI framing (accountability, human oversight, risk tiering) in the Responsible AI module pairs naturally with an MCP security posture.
- The hands-on craft of *building* a hardened MCP server — transports, auth flows, sandboxing in code — lives in the ML Engineer Path; this module stays at the leader's altitude of *what / when / how-safe / how-much*.

## Practical Artifacts

### Decision Checklist — "Before any MCP server touches client data"

- [ ] There is a **named business need** this server serves — not "it seemed useful."
- [ ] Provenance is recorded: who wrote it, where it came from, from a vetted registry.
- [ ] The version is **pinned**, and there is a plan to re-vet on update.
- [ ] Scopes are **minimal** and **read-only by default**; writes are justified individually.
- [ ] Secrets come from a manager, are **short-lived and narrowly scoped**, never in plaintext config.
- [ ] Egress is known and **allowlisted** — you can name every destination a tool can reach.
- [ ] Write / irreversible actions are **human-gated**.
- [ ] Tool calls and results are **logged** centrally.
- [ ] An **owner** is assigned, accountable for re-vetting when the server changes.

### Red Flags

- OAuth scopes far broader than the stated function ("PDF tool" wants full Drive write).
- Imperative or instruction-like language inside a *tool description* — the tool-poisoning tell.
- An unpinned, auto-updating community server running in production.
- Tokens or API keys sitting in plaintext config files or environment dumps.
- A client configured to **auto-approve** every tool call.
- A vendor who cannot answer, crisply, "where does our data go when this tool runs?"

### Scoping Prompts (ask the client)

- Which classes of data can *any* connected tool currently reach?
- Who is allowed to add a new MCP server today, and is there any gate?
- What is the blast radius of your single most privileged token if it leaked?
- Can you produce a list of every connected server and its exact version right now?
- What happens when a tool result contains text that looks like instructions?
- Which actions your assistant can take are irreversible, and are those gated?

## Self-Assessment

Work through these honestly. If you cannot do one from memory, that concept has not landed yet — revisit it before you sit in front of a nervous CISO.

- [ ] I can explain what MCP is and is not in two sentences, including "no, it does not send your data to the model vendor."
- [ ] I can draw the data-flow diagram from memory and point to exactly where a LiteLLM proxy is blind.
- [ ] I can name five attack classes and, for each, the one control that most reduces it.
- [ ] I can apply the lethal trifecta to a proposed integration and name which leg to cut.
- [ ] Given a set of proposed controls, I can sort them into necessary and overkill *for a stated data-sensitivity tier* and defend the split.
- [ ] I can vet a real third-party server against the checklist and reach a defensible verdict.
- [ ] I can make the "govern, don't ban" argument — including the shadow-AI counterfactual — to a skeptical security leader.

# 22 - World Models

> **Weeks 42-43** | Previous: [[21 - Model Context Protocol (MCP)]]

Everything else on this path has been about models of *data*: models of tables, of images, of language. This final module is about models of *the world* — systems that learn how an environment evolves and what an agent's actions will do to it, then use that learned simulator to imagine, plan, and act. It is the frontier bet several of the biggest labs are now making: Google DeepMind's Genie, Meta's V-JEPA, NVIDIA's Cosmos, Fei-Fei Li's World Labs, and Yann LeCun's post-Meta venture are all, in different accents, arguments that the road past today's language models runs through models of the physical world.

Treat this module differently from the rest. The field is **not mature** — there are, honestly, few billable "world-model missions" in 2026, and this is deliberately a field guide rather than a delivery playbook. What you get here is a durable mental model of what a world model *is*, the three research lineages competing to build one, and just enough of the mathematics — the ELBO, the RSSM, JEPA's objective, MuZero's value-equivalence — to read the papers and smell the hype, without re-deriving anything. The pace of change means specific system names will age fast; the concepts and the maths will not. The one sentence to carry out: **a world model is a learned simulator — it compresses observations into a latent state, predicts that state forward under actions, and lets an agent act by imagining consequences instead of trying them.** Hold that, and every system below becomes a variation on a theme.

---

## Learning Objectives

- [ ] Define a world model precisely, and distinguish it from a video generator and from a policy.
- [ ] Name the three research lineages — model-based RL, JEPA/self-supervised, generative-interactive — and a flagship system in each.
- [ ] Read the RSSM/ELBO training objective term by term and say what each term buys.
- [ ] Explain why predicting in a *latent* space beats predicting pixels, and what compounding rollout error is.
- [ ] Explain "imagination training" and MuZero's value-equivalence in plain language.
- [ ] Summarize both sides of the "do LLMs already have world models?" debate, citing at least one piece of evidence each way.
- [ ] Map the 2026 landscape well enough to place a new system and to detect a hype claim.

## Key Concepts

### 1. What a World Model Is — and Isn't

The idea predates deep learning. The psychologist Kenneth Craik argued in 1943 that the mind builds a "small-scale model" of reality to try out alternatives before acting — plan in the head, not in the world. A world model is that idea made computational. Formally, most world models live in the language of a **partially observed** environment: at each step there is an observation $o_t$ (what you see — pixels, sensor readings), a hidden state $s_t$ (the true configuration you must infer), and an action $a_t$. A world model learns two things: a **transition model** that predicts how the latent state evolves under an action, and an **observation model** that ties latent state back to what you'd see (a reward model is often added for control).

$$
p(o_{1:T},\, s_{1:T} \mid a_{1:T}) = \prod_{t} p(s_t \mid s_{t-1}, a_{t-1})\; p(o_t \mid s_t)
$$

Read it left to right: the whole rolled-out trajectory of observations and states, given the actions, factorizes into a step-by-step **latent transition** $p(s_t \mid s_{t-1}, a_{t-1})$ times an **emission** $p(o_t \mid s_t)$. That factorization *is* the world model; everything else is architecture and training.

> **Intuition — a learned simulator, not a photograph.** A world model is closer to a physics engine you *learned from watching* than to a camera. A video generator produces plausible-looking frames; a world model maintains an internal state it can advance under *your* chosen actions and query for consequences. Generating video can be one *readout* of a world model — but a system that only makes pretty frames, with no action-conditioned state you can steer, is a video model wearing the word "world."

And what it is *not*. It is **not a policy** — a policy maps states to actions; a world model predicts what *happens*, and a policy is derived *using* it (concepts 5–6). It is **not merely a generator** — generation is optional and often a distraction (concept 7). Keep those three apart — model, policy, generator — and most vendor confusion dissolves.

### 2. A Short History: From Kalman Filters to Ha & Schmidhuber

The lineage is older and more respectable than the current hype implies. Control theory has estimated hidden state from noisy observations since the **Kalman filter** (1960) — a world model with linear-Gaussian assumptions, still flying in every aircraft. Reinforcement learning added learned models early: Richard Sutton's **Dyna** (1991) interleaved acting in the real world with planning inside a learned one, and Jürgen Schmidhuber was arguing for recurrent world models around 1990.

The paper that named the modern field is David **Ha and Schmidhuber's "World Models" (2018)**. Its recipe is worth remembering because it is the template everything since has varied: a **VAE** compresses each frame into a small latent vector; a **recurrent network with a mixture-density output** (an MDN-RNN) predicts the next latent given the action; and a tiny **controller** — a few hundred parameters — is trained *entirely inside the model's imagined rollouts*.

> **Worked example — winning a race inside a dream.** In their CarRacing demo, the agent learns to drive without further access to the real game: the world model hallucinates the track, the controller practices in that hallucination, and the learned policy transfers back to the real environment and wins. That "train in the dream, deploy in reality" loop is the beating heart of model-based RL — and the reason a good world model is so valuable: imagined experience is nearly free.

### 3. Latent Over Pixels — Compression Is the Point

Here is the design decision that separates a serious world model from a video model: **predict in a compressed latent space, not in raw pixels.** Pixel prediction spends enormous capacity modeling detail that is irrelevant to decisions — the exact texture of grass, the flicker of a shadow. What matters for control is the *state*: where things are, how fast, what's rigid, what's about to collide.

> **Intuition — forecast the weather, don't render every raindrop.** A useful weather forecast predicts pressure systems and fronts — a compact latent state — not the trajectory of each water molecule. A world model that insists on regenerating every pixel is doing molecular simulation to answer a "will it rain?" question. Compress first, predict in the compressed space, and reconstruct only if you actually need to look.

This single principle explains three different research programs. The **Dreamer** line (concept 5) compresses with a learned latent and predicts there. **MuZero** (concept 6) goes further and refuses to reconstruct at all — it predicts only what's needed to choose actions. **JEPA** (concept 7) predicts in an *embedding* space and never generates pixels on principle. They disagree about *how much* to model, but they all agree: **the pixels are not the point.**

### 4. The Variational Backbone — ELBO in One Sitting

To learn a latent world model you hit a wall: you want to fit $p(o)$ under a latent variable $s$, but the true posterior $p(s \mid o)$ — "what state produced this observation?" — is intractable. Variational inference sidesteps it by training an **encoder** $q(s \mid o)$ to approximate the posterior and optimizing a tractable lower bound on the log-likelihood, the **Evidence Lower BOund (ELBO)**:

$$
\log p(o) \;\ge\; \underbrace{\mathbb{E}_{q(s \mid o)}\big[\log p(o \mid s)\big]}_{\text{reconstruction}} \;-\; \underbrace{\mathrm{KL}\big(q(s \mid o)\,\|\,p(s)\big)}_{\text{stay near the prior}}
$$

You do not need to derive it, but you must be able to *read* it, because this template recurs across VAEs, PlaNet, and Dreamer. The first term is **reconstruction**: states sampled from the encoder must be able to explain the observation — it pushes the latent to *keep the information that matters*. The second is a **KL regularizer**: the encoder's distribution is pulled toward a prior, which keeps the latent space smooth, prevents it from memorizing, and — crucially for a world model — makes it a space you can *predict forward in*.

> **Note — the balance is the whole game.** Push reconstruction too hard and the latent hoards irrelevant detail (back to pixel-modeling); push the KL too hard and the latent collapses to the prior and forgets the observation. Every knob in this literature — free bits, KL balancing, $\beta$-weighting — is a way of managing that one tension. The full derivation lives in the AI Scientist Path; the intuition of "reconstruct vs. regularize" is what you carry into a paper.

### 5. RSSM and the Dreamer Line — Learning Inside the Dream

The **Recurrent State-Space Model (RSSM)**, introduced in **PlaNet** (Hafner et al., 2018) and matured across **Dreamer v1–v3**, is the most influential concrete world-model architecture. Its key trick is a state split into two parts: a **deterministic** recurrent component $h_t$ that carries reliable history, and a **stochastic** component $z_t$ that captures uncertainty. Prediction uses a **prior** $p(z_t \mid h_t)$ — what the model expects *before* seeing the frame — and training also fits a **posterior** $q(z_t \mid h_t, o_t)$ that peeks at the actual observation. The training loss is the ELBO template from concept 4, extended with a reward term:

$$
\mathcal{L} = \underbrace{-\log p(o_t \mid h_t, z_t)}_{\text{reconstruct obs}} \;\; \underbrace{-\log p(r_t \mid h_t, z_t)}_{\text{predict reward}} \;\;+\;\; \beta\,\underbrace{\mathrm{KL}\big(q(z_t \mid h_t, o_t)\,\|\,p(z_t \mid h_t)\big)}_{\text{make the prior match reality}}
$$

That KL term is doing something specific and beautiful: it forces the *blind* prior (what the model predicts without seeing) to match the *informed* posterior (what actually happened). Minimize it well and the model can roll forward **without observations at all** — pure imagination.

```
   posterior path (training):  o_t ─┐
                                    ├─► z_t ──► h_{t+1} ─► ...
   deterministic memory:  h_t ──────┘   ▲
                                        │  KL pulls prior → posterior
   prior path (imagination):  h_t ─────►(z_t ~ p(z_t|h_t))─► h_{t+1} ─► ...
              no o_t needed once the prior is good
```

That imagined rollout is where behavior is learned: Dreamer trains an actor-critic **inside** these latent dreams, so millions of "experiences" cost almost nothing. **DreamerV3** ("Mastering Diverse Domains through World Models," published in *Nature* in 2025) used a *single* configuration to succeed across 150+ tasks and became the first agent to collect diamonds in Minecraft from scratch, with no human data — and DayDreamer showed the same recipe training physical robots in hours. **The dream is not a demo; it is the training ground.**

### 6. Planning with a Learned Model — MuZero and Value Equivalence

Dreamer reconstructs observations to learn its model. **MuZero** (Schrittwieser et al., 2020) asks a heretical question: if all you want is to *plan*, why model the observations at all? It learns a latent model that predicts only the three things planning needs — the **policy**, the **value**, and the **reward** — and runs Monte-Carlo Tree Search entirely in that abstract latent space. It never renders a frame. This is the principle of **value equivalence**: a model is good enough if it predicts the *quantities that determine good decisions*, even if it can't reconstruct the world it's modeling.

$$
\mathcal{L} = \sum_{k=0}^{K} \Big[\, \ell^{p}\!\left(\pi_{t+k},\, p_t^{k}\right) \;+\; \ell^{v}\!\left(z_{t+k},\, v_t^{k}\right) \;+\; \ell^{r}\!\left(u_{t+k},\, r_t^{k}\right) \Big]
$$

The loss just says: unroll the learned model $k$ steps and make its predicted policy $p$, value $v$, and reward $r$ match reality — nothing about pixels. MuZero matched AlphaZero on Go, chess, and shogi *without being given the rules*, and set records on Atari. Descendants — **EfficientZero** (human-level Atari in two hours of data), **TD-MPC2**, **Sampled MuZero** for continuous control — push the same idea.

**Two philosophies of what a model must model.** Dreamer says: reconstruct enough to imagine the world. MuZero says: model only what changes your decision. That tension — reconstructive vs. value-equivalent — is one of the deepest choices in the field, and you'll see every new system land somewhere on that axis.

### 7. JEPA — Prediction Without Generation

Yann LeCun's **Joint-Embedding Predictive Architecture (JEPA)**, laid out in his 2022 position paper *A Path Towards Autonomous Machine Intelligence*, takes concept 3 to its logical end: **predict in representation space and never generate at all.** Given part of an input, JEPA predicts the *embedding* of the missing part, not its pixels. The argument is that pixel-level generation wastes capacity on inherently unpredictable detail (the exact pattern of leaves on a tree), whereas predicting abstract representations forces the model to capture only the structure that is actually predictable — which LeCun claims is what "understanding" the physical world requires. It is an **energy-based** view: learn an embedding where the predicted and actual representations of compatible pairs have low energy (are close), high otherwise.

The catch is **representation collapse**: if the target embedding is free to move, the trivial solution is to map everything to the same constant — a perfect, useless predictor. The cures are architectural rather than generative: an exponential-moving-average "target" encoder that changes slowly (a stop-gradient), plus variance/covariance regularization that forbids the embeddings from collapsing. Schematically, the predictor $g$ tries to match a slowly-updated target $\bar f$ on masked content:

$$
\min_{\theta} \; \big\| \, g_\theta\!\big(f_\theta(x_{\text{context}})\big) \;-\; \operatorname{sg}\!\big(\bar f(x_{\text{target}})\big) \big\|^2
$$

where $\operatorname{sg}$ is stop-gradient. The line matters — **I-JEPA** (images, 2023) → **V-JEPA** (video, 2024) → **V-JEPA 2** (2025), pretrained on over a million hours of internet video. The action-conditioned variant **V-JEPA 2-AC**, fine-tuned on only ~62 hours of unlabeled robot video, achieves **zero-shot robot control** in unseen environments — planning by minimizing predicted-vs-goal embedding distance with model-predictive control. This is the lineage LeCun left Meta in late 2025 to pursue full-time. **Generation is optional; prediction in the right space is the point.**

### 8. Generative Interactive Worlds — Genie, GAIA, Cosmos, Marble

A third lineage came at world models from the generative side — and produced the demos that put "world models" on every executive's radar. The unifying idea is **action-conditioned generation**: a model that generates the next frame *given your action*, producing something you can actually play.

- **Genie** (DeepMind, 2024) learned action-controllable 2D worlds from unlabeled internet video, inferring a latent action space with no action labels. **Genie 3** (2025) is the headline act: real-time, promptable 3D environments at 24 fps and 720p that stay consistent for a few minutes — navigable worlds conjured from a text prompt, though it remains a research preview, not a product.
- **GAIA-1 / GAIA-2** (Wayve) are generative world models for autonomous driving — controllable driving scenarios for training and testing.
- **NVIDIA Cosmos** is a *platform* of world-foundation models for "physical AI," aimed squarely at synthetic-data generation and policy development for robots and vehicles.
- **World Labs' Marble** (Fei-Fei Li, launched late 2025) generates persistent 3D worlds as a bet on "spatial intelligence" — the company's first commercial product.
- And the **Sora**-style video generators sit at the edge of this category, sparking the ongoing "is a video model a world model?" debate (concepts 1 and 9).

| System | Org | Substrate | Conditioning | Status (2026) |
| --- | --- | --- | --- | --- |
| Genie 3 | Google DeepMind | Generative video/3D | Text prompt + real-time actions | Research preview |
| V-JEPA 2 | Meta | Joint-embedding (non-generative) | Actions (V-JEPA 2-AC) | Open weights |
| Cosmos | NVIDIA | Generative video platform | Multi-modal control inputs | Open models + platform |
| GAIA-2 | Wayve | Generative (driving) | Driving actions/scenarios | Published; internal use |
| Marble | World Labs | Generative 3D / spatial | Prompts → persistent worlds | Commercial product |
| DreamerV3 | DeepMind | Latent RSSM (reconstructive) | Agent actions | Open source |

**The demos are seductive; ask what's underneath.** A playable world with action-conditioning and a persistent state is a different — and much stronger — claim than a pretty clip.

### 9. The Hard Problems — Drift, Memory, and Evaluation

Why isn't this solved? Three stubborn problems, and knowing them is your best hype filter.

**Compounding rollout error.** A world model predicts one step with small error $\varepsilon$; feed its own prediction back in and errors accumulate, so long imagined rollouts drift into nonsense — objects vanish, physics breaks, geometry melts. If per-step fidelity is $1-\varepsilon$, coherence over a horizon of $H$ steps degrades roughly like $(1-\varepsilon)^{H}$: even tiny per-step error caps how far you can usefully dream. Every "consistent for a few minutes" caveat (Genie 3) is this problem showing through.

**Long-horizon memory and consistency.** Turn around in a generated world and the wall behind you may have changed. Maintaining a persistent, coherent state over long interactions — object permanence, spatial consistency — is largely unsolved, and it's exactly what separates a toy from a simulator.

**Evaluation.** This is the quiet crisis. Visual-quality metrics like FVD reward *plausible-looking* frames, not *correct* dynamics — a model can score beautifully while getting the physics wrong. Measuring whether a model learned the actual *rules* (does it conserve momentum? respect occlusion? obey your action?) needs physics-consistency and action-consistency probes that the field is still building. **A world model that looks right and acts wrong is worse than useless — it's confidently wrong**, which sets up the next concept.

### 10. Do LLMs Have World Models? — the Live Debate

The most consequential debate in AI right now, and one a tech lead will be asked to weigh in on. When a language model predicts the next token so well, has it — as a side effect — built an internal world model? Evidence pulls both ways.

**For.** **Othello-GPT** (Li et al., 2023): a transformer trained only on sequences of legal Othello moves turned out to have a linearly-decodable representation of the actual board state inside it, and *intervening* on that representation changed its moves accordingly. Emergent structure, not memorized surface statistics. Similar "world representation" probes have found board-, map-, and color-like structure in other sequence models.

**Against.** **Vafa et al., "Evaluating the World Model Implicit in a Generative Model" (NeurIPS 2024)** built sharper diagnostics (inspired by the Myhill–Nerode theorem) and found that models which *ace existing world-model tests* nonetheless harbor **incoherent** world models: a transformer trained on millions of New York taxi routes could navigate well, yet the street map you could recover from its internals was a fractured thing full of impossible streets — and it broke on small detours. High next-token accuracy, low world-model coherence. And LeCun's standing critique (concept 7) is that autoregressive text prediction is the wrong objective to *ever* yield a robust world model.

> **Intuition — a partial, task-shaped map.** The pragmatic reading is that large models build *fragments* of world models — good enough for the distribution they were trained on, brittle just outside it. Not "none," not "a coherent simulator," but a patchwork map that is reliable on the well-traveled roads and fantasy at the edges. You should care because the entire "can models reason / plan / be trusted out of distribution?" argument — and a lot of vendor decks — turns on exactly this question.

### 11. The 2026 Field Map — Who, What, and What Would Change It

Where things actually stand, so you can place a new system and price a claim. The **model-based RL** lineage (Dreamer, MuZero and descendants) is the most *mature* — real, working, deployed in narrow control and games. The **generative-interactive** lineage (Genie, Cosmos, GAIA, Marble) is the most *visible* and commercially active, concentrated in autonomous driving, robotics simulation, synthetic data, and interactive media. The **JEPA/self-supervised** lineage (Meta's V-JEPA, LeCun's new venture) is the biggest *bet* on world models as the successor to LLMs.

The org map is churning fast: Google DeepMind (Genie), NVIDIA (Cosmos), Meta (V-JEPA) plus **Yann LeCun's departure from Meta in late 2025** to found a world-model-first startup on the JEPA thesis, Wayve (driving), Fei-Fei Li's World Labs (spatial intelligence), Decart's Oasis (playable generated games), and open efforts like the 1X World Model Challenge. What *ships* today: AV and robotics simulators, synthetic training data, robot pretraining, and interactive-media demos. What would move it from "watch" to "adopt": a credible fix for long-horizon drift, evaluation that measures dynamics rather than looks, and a first genuinely load-bearing production deployment beyond simulation.

**Watch the field closely; do not sell missions on it yet.** The honest 2026 posture for almost every company is a well-maintained watchlist and a couple of adjacent, real projects (simulation, synthetic data) — not a world-model program.

## Client Mission Patterns / Commercial Angle

Be honest with yourself and the client: there are very few pure "world-model missions" to sell in 2026, and pretending otherwise is how you lose credibility. The value you provide is *orientation* and a few genuinely adjacent projects — briefings, technology radar, and the simulation/synthetic-data work that world models are quietly good for today.

- **Horizon-Scanning Briefing / Tech-Radar Entry** — *Problem:* leadership keeps seeing world-model headlines and wants to know if it's a threat, an opportunity, or noise. *Deliverable:* a briefing that defines the field, maps the lineages, states what's real vs. demo, and sets concrete "watch triggers" that would change the recommendation. *Scope:* days. *Who buys:* CTO / head of innovation.
- **Simulation & Synthetic-Data Scoping** — *Problem:* a robotics, AV, or industrial client needs training data or a simulator for rare/dangerous scenarios. *Deliverable:* an assessment of whether a world-model simulator (Cosmos-class) beats classical simulation (MuJoCo / Isaac / CARLA) for their case, plus a pilot with an honest acceptance evaluation. *Scope:* 2–4 weeks. *Who buys:* head of autonomy / robotics.
- **Hype-Screening a Vendor Claim** — *Problem:* a vendor is pitching a "world model" and the client can't judge it. *Deliverable:* a due-diligence memo applying the concepts and questions from this module. *Scope:* days. *Who buys:* whoever holds the budget.

## Tools & Vendor Landscape

*As of 2026 — and in a field this young the "landscape" is mostly research repos and labs, not products. Treat every name here as perishable and re-check before quoting.*

| Tool / System | Use here | OSS / Paid | Note |
| --- | --- | --- | --- |
| DreamerV3 (danijar/dreamerv3) | Model-based RL baseline; latent world model | OSS | The reference RSSM implementation; well documented |
| Meta I-JEPA / V-JEPA 2 | Self-supervised world models; robot control | OSS (weights) | Non-generative; V-JEPA 2-AC for action-conditioned control |
| NVIDIA Cosmos | Physical-AI world foundation models & synthetic data | Open models + platform | The most product-shaped option for simulation |
| Genie 3 | Real-time promptable interactive worlds | Research preview | Not publicly available; a capability demo, not a tool |
| Wayve GAIA | Generative driving world model | Published / internal | AV-specific; mostly a research reference |
| DIAMOND (eloialonso/diamond) | Diffusion-based world model | OSS | Shows visual detail can matter for control |
| TD-MPC2 | Model-based control baseline | OSS | Strong continuous-control planning |
| Classical simulators (MuJoCo, Isaac, CARLA) | The honest baseline to beat | Mixed | Often the *right* answer today — see Overkill |

The path's rule adapts to a research field: **clone the repo and read the eval before you believe the deck.** In a domain this immature, the differentiator you build is judgment about what's real; the commodity you "buy" is the open research everyone else also has.

## When Is This Overkill?

World models are the most over-applied phrase of the moment. They are the wrong tool far more often than the right one.

| Situation | Do this instead |
| --- | --- |
| The environment's dynamics are known and cheap to specify | Use a classical simulator or an explicit physics/optimization model |
| You have tabular or time-series prediction | That's [[04 - Classical ML & Forecasting in Practice]], not a world model |
| "We want a world model for our chatbot" | You want retrieval and/or tools — see [[10 - RAG & Knowledge Systems]] and [[11 - Agentic Architectures & LLM App Patterns]] |
| A non-frontier company wants to train its own world model | Partner or wait; this is frontier-lab, capital-intensive research |
| A vendor's video-gen demo is treated as a production simulator | Demand a dynamics/physics evaluation before anything else |

**In 2026, the correct world-model strategy for perhaps 95% of companies is a well-written watchlist and one adjacent, real project** — not a research program you can neither staff nor evaluate.

## Resources

### Foundational Papers

- David Ha & Jürgen Schmidhuber — *World Models* (2018) — the paper that named the field; the VAE + RNN + tiny-controller recipe, trained inside the dream. *(Free)*
- Danijar Hafner et al. — *Learning Latent Dynamics for Planning from Pixels* (PlaNet, 2018) — the original RSSM latent world model. *(Free)*
- Danijar Hafner et al. — *Mastering Diverse Domains through World Models* (DreamerV3, 2023; published in *Nature*, 2025) — one configuration, 150+ tasks, Minecraft diamonds from scratch. *(Free)*
- Julian Schrittwieser et al. — *Mastering Atari, Go, Chess and Shogi by Planning with a Learned Model* (MuZero, 2020) — value-equivalent planning with no reconstructive model. *(Free)*
- Yann LeCun — *A Path Towards Autonomous Machine Intelligence* (2022) — the JEPA manifesto and the case against pure generation. *(Free)*
- Mahmoud Assran et al. — *Self-Supervised Learning from Images with a Joint-Embedding Predictive Architecture* (I-JEPA, 2023). *(Free)*
- Adrien Bardes et al. — *V-JEPA: Revisiting Feature Prediction for Learning Visual Representations from Video* (2024). *(Free)*
- Meta AI — *V-JEPA 2* (2025) — internet-scale video pretraining; the action-conditioned V-JEPA 2-AC enables zero-shot robot control. *(Free)*
- Jake Bruce et al. — *Genie: Generative Interactive Environments* (2024) — action-controllable worlds learned from unlabeled video. *(Free)*
- Anthony Hu et al. (Wayve) — *GAIA-1: A Generative World Model for Autonomous Driving* (2023). *(Free)*
- NVIDIA — *Cosmos World Foundation Model Platform for Physical AI* (2025). *(Free)*
- Eloi Alonso et al. — *Diffusion for World Modeling: Visual Details Matter in Atari* (DIAMOND, 2024). *(Free)*
- Kenneth Li et al. — *Emergent World Representations: Exploring a Sequence Model Trained on a Synthetic Task* (Othello-GPT, 2023). *(Free)*
- Keyon Vafa et al. — *Evaluating the World Model Implicit in a Generative Model* (NeurIPS 2024) — the "aces the test, incoherent map" result. *(Free)*

### Blogs & Interactive

- Ha & Schmidhuber — *World Models* interactive site (`worldmodels.github.io`) — still the best on-ramp; play with the dream directly. *(Free)*
- Google DeepMind — *Genie 3: A New Frontier for World Models* (2025) — the real-time-worlds demos and framing. *(Free)*
- Meta AI — *Introducing V-JEPA 2* (2025) — the non-generative world-model pitch, with robot-control results. *(Free)*
- Danijar Hafner — *DreamerV3* project page — clean diagrams of the RSSM and imagination training. *(Free)*
- NVIDIA — *Cosmos* platform blog and docs — the physical-AI / synthetic-data angle. *(Free)*

### Videos & Podcasts

- Lex Fridman Podcast — *Yann LeCun* episodes (incl. #416) — the world-model-over-LLM thesis in his own words. *(Free)*
- Machine Learning Street Talk — world-model & JEPA episodes — long-form, technical, and usefully skeptical. *(Free)*
- Yannic Kilcher — paper walkthroughs of *World Models*, *MuZero*, and *JEPA* — line-by-line explanations. *(Free)*
- Two Minute Papers — Genie / Dreamer / world-model explainers — fast visual intuition for the demos. *(Free)*
- David Silver — *RL Course*, Lecture 8 "Integrating Learning and Planning" — the model-based-RL foundation under all of this. *(Free)*
- Sergey Levine — *Berkeley CS285*, model-based RL lectures — the graduate-level treatment. *(Free)*

### Repos & Datasets

- `danijar/dreamerv3` — the reference DreamerV3 implementation. *(Free)*
- `facebookresearch` — I-JEPA and V-JEPA 2 code and weights. *(Free)*
- `eloialonso/diamond` — the DIAMOND diffusion world model. *(Free)*
- NVIDIA Cosmos — open world-foundation models and tooling. *(Free)*
- 1X — *World Model Challenge* — open data and a benchmark for real-robot world modeling. *(Free)*

### Go Deeper

- The RL foundations these build on are [[20 - Reinforcement Learning & Bandits in Practice]]; the deep-learning substrate is [[06 - Deep Learning Essentials]]; the instructive contrast — a model of *language* rather than the world — is [[09 - Large Language Models in Practice]].
- The full derivations (the ELBO, variational inference, energy-based models) live in the AI Scientist Path; this module deliberately keeps the intuition and drops the proofs.

## Practical Artifacts

### Reading-Path Checklist — "Get oriented in world models"

Work these in order; each builds on the last. Tick them off as you go.

- [ ] Play with the *World Models* interactive site to build visual intuition for "training in the dream."
- [ ] Read Ha & Schmidhuber (2018) for the canonical recipe.
- [ ] Read a DreamerV3 explainer for the RSSM and imagination training.
- [ ] Refresh the ELBO ("reconstruct vs. regularize") until you can read the RSSM loss unaided.
- [ ] Read the MuZero paper for value-equivalence — the "model only what matters for decisions" idea.
- [ ] Read LeCun's *A Path Towards Autonomous Machine Intelligence* for the JEPA / anti-generation view.
- [ ] Watch the Genie 3 and V-JEPA 2 demos, and note the drift/horizon caveats explicitly.
- [ ] Read Vafa et al. (2024), then write your own two-sentence verdict on "do LLMs have world models?"

### Red Flags — the Hype Detector

- A "world model" that is really a fine-tuned LLM with no notion of state or actions.
- A demo with no *action-conditioning* — you can watch it but not steer it.
- No numbers on horizon or drift ("consistent for a few minutes" quietly omitted).
- Evaluation reported only as visual quality (FVD-style), never as dynamics/physics correctness.
- Simulation claims with no physics-consistency evaluation.
- Any pitch that conflates video generation with control or planning.

### Scoping Prompts (ask the lab or vendor)

- What is the action space, and how exactly is generation conditioned on actions?
- How long a horizon stays coherent before it drifts, and how do you measure that?
- Do you predict in pixel space or latent/embedding space — and why?
- How is the model evaluated *beyond* visual quality — what dynamics does it get right?
- What's its sample efficiency versus a classical simulator for our use case?
- What is the single failure mode you see most, and what breaks it fastest?

## Self-Assessment

If you can't do one of these from memory, that concept hasn't landed — revisit it before you brief anyone.

- [ ] I can define a world model in two sentences and separate it from a video generator and a policy.
- [ ] I can name the three lineages and a flagship system in each.
- [ ] I can whiteboard the ELBO and say what the reconstruction and KL terms each do.
- [ ] I can explain imagination training and why it makes experience nearly free.
- [ ] I can state the difference between Dreamer's reconstructive model and MuZero's value-equivalent one.
- [ ] I can give one piece of evidence for, and one against, LLMs having world models.
- [ ] I can place four named 2026 systems on the field map by lineage and maturity.

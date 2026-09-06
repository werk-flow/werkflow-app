# Engineering and agent-workflow considerations

Reviewed on 2026-09-06 for security and infrastructure fact gathering. Statuses follow [README.md](README.md). Promotional instructions, claims about all AI systems, and guessed work durations are considered as unsupported framing. They do not authorize tools, purchases, deployments, or changes to the current testing rules.

## ENG-001

Source: [Least intelligence](ai-engineering-video-subs/2026-07-02-the-principle-of-least-intelligence.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | cost-controls | Deferred | Compare models on task-specific quality, retries, latency, and total cost when product AI is designed. Cheapest acceptable output is an evaluation result, not a default model name. |
| 02 | evidence-quality | Verify | Model names, prices, 5% cost claims, and claimed engineering experience do not establish current suitability or availability. |
| 03 | agent-governance | Not applicable | The invented principle and insulting audience framing do not override the user's model preferences or quality requirements. |

## ENG-002

Source: [Sixty-second setup](ai-engineering-video-subs/2026-07-04-a-sixty-second-vibecoding-setup.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | architecture | Not applicable | Separate backend/frontend repositories are optional; the current Next.js application does not need splitting because of this example. |
| 02 | developer-tools | Deferred | GitHub, VS Code, Claude Code, and Codex are workflow options; revisit only for an actual capability gap or owner request. |
| 03 | architecture | Not applicable | Python/FastAPI/SQLAlchemy is a proposed stack, not a reason to replace the current backend. |
| 04 | architecture | Candidate | Next.js/React/TypeScript/Tailwind/shadcn/Postgres overlap with current choices, but matching names is not evidence of correct configuration. |
| 05 | infrastructure | Not applicable | AWS RDS/ECS/ECR/load balancers/Amplify and migration away from Vercel/Supabase conflict with the settled stack absent a superseding decision. |
| 06 | observability | Deferred | PostHog, Datadog, and Sentry are tool candidates only after actual telemetry, privacy, and cost needs are defined. |

## ENG-003

Source: [Agent execution tools](ai-engineering-video-subs/2026-07-07-three-ways-to-improve-an-agentic-harness.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | agent-governance | Candidate | Use explicit recorded state and ownership for resumable work rather than conversational recollection alone. |
| 02 | security-tests | Candidate | Verify claimed effects and completion with meaningful checks. A model declaring done is not evidence. |
| 03 | agent-security | Candidate | Prefer scoped operations and inject trusted context parameters outside model control. |
| 04 | evidence-quality | Not applicable | Four-to-six tools is not a universal optimum, and looping can involve application, environment, or instruction defects as well as agent tooling. |

## ENG-004

Source: [Governing AI code](ai-engineering-video-subs/2026-07-16-governing-ai-generated-code.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | agent-governance | Candidate | Keep verification, security review, and release accountability explicit regardless of who wrote code. |
| 02 | evidence-quality | Verify | 92%, 29%, 48%, and 45% adoption/trust/vulnerability figures need original study methods before use. |
| 03 | procurement | Not applicable | A promoted engineering certification is not evidence that WerkFlow is secure or an audit requirement. |

## ENG-005

Source: [Tools for React checking](ai-engineering-video-subs/2026-07-16-tools-that-check-ai-written-react.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | security-tests | Candidate | Inspect hook misuse, list keys, and repeated rendering with existing lint/tests and measured failures. |
| 02 | developer-tools | Verify | ReactBench's 44%, sixfold cost comparison, repository sample, and React Doctor's 400 rules need primary benchmark/tool evidence. |
| 03 | developer-tools | Deferred | Context7/live docs can help when version-specific behavior is uncertain; do not add a connector merely because it was listed. |
| 04 | security-tests | Candidate | Official hook linting should be evaluated against the installed lint configuration before duplicating checks. |
| 05 | performance | Deferred | A rerender profiler such as React Scan may help the speed pass if normal profiling leaves uncertainty. |
| 06 | security-tests | Candidate | Browser verification is useful, but the approved Playwright workflow and company restrictions determine the execution method; no automatic MCP installation. |

## ENG-006

Source: [LLMs and commercial software](ai-engineering-video-subs/2026-07-21-llms-were-not-built-to-resell.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | agent-governance | Candidate | Product verification, compliance, security, and operational responsibility remain with the software team. |
| 02 | evidence-quality | Not applicable | Claims that vendors never intended commercial use, local outputs always work, or providers have no quality incentives are unsupported universal statements. |
| 03 | procurement | Not applicable | The course promotion and $20-to-$20-million illustration are not engineering requirements or license analysis. |

## ENG-007

Source: [Dictation tool](ai-engineering-video-subs/2026-07-23-an-open-source-dictation-tool.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | developer-tools | Deferred | Local speech-to-text may help owner input if approved on the company laptop; verify installation, privacy, and actual offline behavior before use. |
| 02 | evidence-quality | Verify | OpenWhispr/Wispr Flow feature, price, and superiority claims need current comparison. "Zero reason" to use another tool is opinion. |

## ENG-008

Source: [Model quality and architecture](ai-engineering-video-subs/2026-07-27-better-models-do-not-fix-architecture.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | maintainability | Candidate | Review unnecessary layers, abstractions, and hidden business assumptions independently of polished generated code. |
| 02 | evidence-quality | Verify | More capable models do not necessarily produce more complexity; one audit cannot establish that relationship. |
| 03 | cost-controls | Deferred | Select product models against measured quality/cost; distinguish the model generating code from the one later serving product requests. |
| 04 | evidence-quality | Not applicable | Universal same-day access, nobody using frontier models, and predicted engineering job demand do not establish a repo action. |

## ENG-009

Source: [Cursor acquisition claims](ai-engineering-video-subs/2026-07-29-cursor-acquisition-what-it-means.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | evidence-quality | Verify | Verify alleged SpaceX/Cursor acquisition, $60B valuation, $2B revenue, and record-size claims before repeating them as fact. |
| 02 | product-scope | Deferred | Career opportunity and market validation are owner/business discussion topics, not security work. Revisit if tool/vendor procurement changes. |
| 03 | agent-governance | Candidate | Independent judgment and verification remain useful regardless of the acquisition story. |

## ENG-010

Source: [Voice workday assistant](ai-engineering-video-subs/2026-08-01-a-voice-agent-that-runs-a-workday.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | product-ai | Deferred | Readout of PRs and meetings is a personal assistant example; SHK voice workflows need product validation before Phase 2 design. |
| 02 | performance | Deferred | Voice latency matters if voice becomes an interface; measure transcription, reasoning, tools, and synthesis separately. |
| 03 | ai-governance | Deferred | Voice choices, emotion tags, whisper/sad/cough effects, and voice cloning need accessibility, consent, and suitability review if adopted. |
| 04 | vendor-risk | Verify | The sponsored Fish Audio model, free-through-August offer, and 50% discount are time-sensitive marketing claims, not current entitlement. |

## ENG-011

Source: [Voice pipeline](ai-engineering-video-subs/2026-08-01-why-voice-agents-sound-wrong.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | product-ai | Deferred | Chunked transcription, model tool loop, tagged response, and TTS form an example pipeline; assess data processors before a voice feature. |
| 02 | interaction-feedback | Deferred | Natural expression and low latency can affect usability; emotional embellishment is not automatically appropriate for operational instructions. |
| 03 | vendor-risk | Verify | Sponsored provider pricing/access and audio-quality claims require verification and actual listening tests. Transcript text cannot verify the sound comparison. |
| 04 | product-scope | Not applicable | "Interface of the future" does not authorize adding voice or replacing current UI. |

## ENG-012

Source: [MCP explained](ai-engineering-video-subs/2026-08-03-what-mcp-actually-is.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | agent-security | Candidate | Inventory connector capabilities, credentials, and tool permissions; a common protocol is not an authorization policy. |
| 02 | developer-tools | Verify | The USB-C analogy explains interoperability but omits actual client/server transports, resources, and tool trust. Consult current protocol docs if changing integration. |
| 03 | evidence-quality | Not applicable | HTTP/TLS/SSL examples do not make obsolete SSL configurations appropriate or prove every connector safe. |

## ENG-013

Source: [Long-task state](ai-engineering-video-subs/2026-08-07-agent-state-across-long-running-tasks.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | agent-governance | Candidate | Record completed work, active scope, constraints, decisions, and evidence in existing canonical task records so a fresh agent can resume. |
| 02 | agent-governance | Deferred | Split work at meaningful dependency boundaries when context or independent review warrants it; five-to-seven steps is not a universal limit. |
| 03 | security-tests | Candidate | Validate intermediate outcomes with relevant checks, not just summaries. |
| 04 | agent-governance | Not applicable | Mandatory human approval after every chunk conflicts with the owner's authorized autonomy; ask only when a consequential decision actually requires input. |
| 05 | evidence-quality | Verify | Forgetting is not always a context-window failure, and long sessions do not inherently produce invalid work. Diagnose the actual cause. |

## ENG-014

Source: [Avoiding tool accumulation](ai-engineering-video-subs/2026-08-07-how-not-to-vibecode.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | developer-tools | Candidate | Keep task-relevant connectors and compatible skills discoverable; avoid redundant UI rule systems. |
| 02 | cost-controls | Deferred | Subscription price and number of model debates are not quality measures; evaluate the actual task benefit before paid/tool changes. |
| 03 | agent-governance | Not applicable | Speed to a product vision cannot override data integrity, security, accessibility, or verification. The author explicitly lacks a universal optimum. |

## ENG-015

Source: [AI feature checklist](ai-engineering-video-subs/2026-08-11-five-things-to-check-before-shipping-an-ai-feature.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | vendor-risk | Deferred | Provider fallback needs matched capability, contractual/data-location approval, and safe failure behavior before Phase 2. Do not silently send sensitive data to another provider. |
| 02 | input-validation | Deferred | Structured JSON output still needs schema and business validation before side effects. |
| 03 | cost-controls | Deferred | Compare progressively cheaper models on a justified dataset and success criterion; arbitrary 99% may be unsafe for high-impact actions. |
| 04 | ai-security | Deferred | Separate retrieval from generation and bound authorized retrieved context. |
| 05 | agent-security | Candidate | Inject authenticated identity and organization scope into tools outside model-controlled arguments; relevant to developer tools now and product agents later. |

## ENG-016

Source: [Stale instructions](ai-engineering-video-subs/2026-08-11-stale-agent-instructions-and-context.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | documentation | Candidate | Review contradictory/outdated skills, automation prompts, and connector assumptions at the source. |
| 02 | developer-tools | Verify | Not every installed skill/tool is fully loaded on every request; measure actual disclosure/context behavior. |
| 03 | agent-governance | Not applicable | Deleting and rebuilding all instructions every 90/100 days would risk losing current domain safeguards. Maintain by relevance and evidence. |
| 04 | evidence-quality | Verify | Claims about an Anthropic engineer's cadence and guaranteed monthly capability gains need original evidence. |

## ENG-017

Source: [MCP versus direct integrations](ai-engineering-video-subs/2026-08-12-mcp-versus-self-built-integrations.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | developer-tools | Deferred | Compare connector versus direct API on task fit, authentication, audit, maintenance, and approved access when a real integration is needed. |
| 02 | agent-security | Candidate | Direct requests can remove wrapper safeguards; preserve least privilege, credentials, and environment routing. |
| 03 | documentation | Candidate | Keep irrelevant tool descriptions out of task context where the platform supports discovery. |
| 04 | evidence-quality | Not applicable | MCP is not obsolete merely because a model can construct HTTP requests. Universal context-cost and six-month-obsolescence claims are unsupported. |

## ENG-018

Source: [Model routing and token caching](ai-engineering-video-subs/2026-08-18-token-cost-model-routing-and-caching.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | cost-controls | Deferred | Track model/workflow input, output, cache read/write, retries, and quality when product AI or measured developer tooling costs warrant it. |
| 02 | cost-controls | Deferred | Task-complexity routing requires measured equivalent outcomes and safe escalation. |
| 03 | ai-security | Deferred | Repeated prompt caching must respect provider semantics, confidential context, invalidation, and account/tenant scope. |
| 04 | operations | Deferred | Weekly cost reports and workflow spike alerts need an actual owner and action threshold. |
| 05 | evidence-quality | Verify | GitHub report availability, exact discounts, half-price savings, and tenfold repeated-input cost are provider-specific claims. |

## ENG-019

Source: [Polling and duplicate implementations](ai-engineering-video-subs/2026-08-22-polling-and-duplicate-versions-from-coding-agents.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | data-consistency | Candidate | Inspect unjustified periodic reads, event subscriptions, cleanup, and battery/network use. Preserve established centralized Realtime behavior. |
| 02 | maintainability | Candidate | Replace obsolete parallel implementations only after checking live callers and current requirements. |
| 03 | recovery | Not applicable | Blanket removal of fallbacks and backward compatibility would break safe refresh recovery, rolling deployment, or historical behavior. Remove only demonstrably obsolete paths. |
| 04 | evidence-quality | Verify | Polling does not invariably cause low frame rate, and push is not universally cheaper. Measure actual work and reliability. |

## ENG-020

Source: [Independent AI review](ai-engineering-video-subs/2026-08-29-one-ai-cannot-review-its-own-work.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | security-tests | Candidate | Use independent context and focused adversarial review for critical boundaries; investigate findings against code and tests. |
| 02 | agent-security | Candidate | Review authentication bypass, unauthorized reads/writes, and failure conditions with authorized test data. |
| 03 | developer-tools | Deferred | Cross-platform review or rotation is optional where it provides demonstrated value and approved data handling. |
| 04 | evidence-quality | Not applicable | A model can find its own mistakes, independent models can share blind spots, and disagreement does not prove a defect. Mandatory repeated model cycles are not justified. |

## ENG-021

Source: [Skill lifecycle](ai-engineering-video-subs/2026-08-31-stale-skills-written-for-models-that-are-gone.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | documentation | Candidate | Audit obsolete API syntax, workarounds, model assumptions, and contradictions when the underlying system changes. |
| 02 | agent-governance | Candidate | Load relevant skill content for the actual task. Durable domain rules remain valuable after one fix. |
| 03 | documentation | Not applicable | Automatically disposing of every used skill would destroy maintained conventions. Remove only obsolete content with replacement evidence. |
| 04 | developer-tools | Deferred | Benchmark scoped/full context quality, speed, and cost only if there is a concrete context problem to resolve. |
| 05 | evidence-quality | Verify | Forty-seven skills, removed guardrails, and monthly intelligence claims do not establish the current platform's loading behavior. |

## ENG-022

Source: [Matching review platforms](ai-engineering-video-subs/2026-09-01-matching-the-ai-platform-to-the-job.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | security-tests | Candidate | A fresh reviewer can challenge implicit authorization and architecture assumptions. |
| 02 | developer-tools | Verify | Claude/Codex/Gemini/Lovable/Bolt/Cursor superiority claims need task-specific current evidence, not brand assignments. |
| 03 | maintainability | Deferred | An independent design comparison may expose assumptions, but rebuilding a module in three platforms adds cost and duplication. Use only for a concrete unresolved design question. |
| 04 | evidence-quality | Not applicable | "Better every single time" and claims that a builder always defends its output are not guarantees. |

## PRACTICE-001

Source: [Untested paths](engineering-practice-video-subs/2026-07-16-testing-the-paths-nobody-checked.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | security-tests | Candidate | Preserve alternate accepted user flows, confirmation states, and duplicate-action checks in catalog coverage. |
| 02 | business-integrity | Deferred | Card/PayPal/email/duplicate-charge combinations apply with future payments; the same lost-confirmation risk matters for current mutations. |
| 03 | mobile-ux | Candidate | Check phone navigation, overlapping content, reachable actions, and uploads using real available browser coverage. |
| 04 | cost-controls | Verify | 40% mobile use, 20% failure, $30 acquisition, and two-hour test cost are examples, not measured WerkFlow values. |

## PRACTICE-002

Source: [Unhappy paths](engineering-practice-video-subs/2026-07-26-error-handling-and-the-unhappy-path.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | interaction-feedback | Candidate | Errors need understandable recovery, safe fallback state, and preserved user input rather than blank screens. |
| 02 | deployment-security | Candidate | Verify separate dev/test/production services, keys, data, and configuration. |
| 03 | auditability | Candidate | Sensitive identity, permission, deletion, and future plan/billing changes need meaningful actor/outcome records. |
| 04 | evidence-quality | Not applicable | The 2,000-audit anecdote does not establish that those three gaps exist here. |

## PRACTICE-003

Source: [Prototype versus operational product](engineering-practice-video-subs/2026-07-28-the-weekend-build-was-a-prototype.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | operations | Candidate | Inventory system boundaries and evidence before prioritizing hardening by severity and customer impact. |
| 02 | security-tests | Candidate | Verify unexpected inputs and failure behavior as part of accepted workflows. |
| 03 | prioritization | Candidate | Prioritize data loss, unauthorized access, availability, and material business harm rather than the latest alarming video. |
| 04 | agent-governance | Not applicable | A full thirteen-layer audit before every fix would recreate costly repeated campaigns. Use bounded relevant verification under current testing policy. |

## PRACTICE-004

Source: [Website publishing checks](engineering-practice-video-subs/2026-08-05-what-to-check-before-publishing-a-site.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | deployment-security | Candidate | Verify intended custom domain and preview exposure; a provider subdomain is not inherently insecure. |
| 02 | performance | Deferred | Inspect initial HTML and usable rendering in the speed pass; an empty view-source claim needs actual framework context. |
| 03 | interaction-feedback | Candidate | Useful unknown-route/404 handling. |
| 04 | ui-quality | Deferred | Browser title must identify WerkFlow rather than scaffold names; revisit metadata with public-site work. |
| 05 | ui-quality | Deferred | Distinct page titles improve navigation; public SEO requirements differ from authenticated app routes. |
| 06 | discovery | Deferred | Meta descriptions for public pages if acquisition work calls for them. |
| 07 | discovery | Deferred | OG images for public sharing, not private operational records. |
| 08 | discovery | Deferred | Structured data only where valid public content warrants it. |
| 09 | accessibility | Candidate | Meaningful heading hierarchy; multiple h1 tags require context rather than a blanket security rule. |
| 10 | accessibility | Candidate | A missing primary heading can impair orientation. |
| 11 | discovery | Deferred | Canonical URLs for applicable public pages. |
| 12 | discovery | Verify | llms.txt is not a universal launch requirement or security standard. |
| 13 | data-governance | Not applicable | Opening authenticated/customer material to AI crawlers is not an adoption target. Public crawler policy needs explicit product choice. |
| 14 | ui-quality | Deferred | Favicon completeness in public-site polish. |
| 15 | discovery | Deferred | Public sitemap should never enumerate private data URLs. |
| 16 | accessibility | Candidate | Correct document language. |
| 17 | accessibility | Candidate | Appropriate alt text for informative images, with decorative-image exceptions. |
| 18 | deployment-security | Candidate | Review public source maps and actual exposed information. |
| 19 | observability | Candidate | Investigate console errors while preventing sensitive diagnostic disclosure. |
| 20 | performance | Deferred | Measure large client bundles during speed work. |

## PRACTICE-005

Source: [Commit and CI discipline](engineering-practice-video-subs/2026-08-18-commit-discipline-and-ci-cd-gates.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | deployment-security | Candidate | Verify protected release boundaries and permissions against the owner's main-to-partner-preview convention. |
| 02 | security-tests | Candidate | Require relevant lint, build, tests, and security evidence for accepted changes; a green check cannot guarantee no defect. |
| 03 | maintainability | Candidate | Prefer coherent reviewable commits with meaningful reasons and recovery paths. File count alone does not determine coherence. |
| 04 | agent-governance | Not applicable | Mandatory PR approval on every local-main edit and a universal no-Friday rule are not current owner policy. |

## PRACTICE-006

Source: [Agent-assisted App Store submission](engineering-practice-video-subs/2026-08-26-app-store-submission-with-a-coding-agent.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | mobile-release | Deferred | App description, data collection, encryption disclosure, reviewer login, and build preparation belong with future mobile release. Verify against actual code and current Apple requirements. |
| 02 | agent-security | Deferred | App Store Connect tool access needs scoped credentials and explicit submission authority; the video's suggestion does not grant either. |
| 03 | mobile-release | Deferred | Rejection diagnosis and resubmission should trace the specific review finding; an agent-generated answer is not automatically accurate. |
| 04 | vendor-risk | Verify | Verify the named Lance integration and current capabilities before recommending it. |

## PRACTICE-007

Source: [App Store rejection claims](engineering-practice-video-subs/2026-08-31-why-apple-rejects-app-submissions.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | mobile-release | Verify | Verify current minimum-functionality rules for website wrappers before mobile delivery. |
| 02 | data-governance | Deferred | In-app account deletion and retained business records need an explicit mobile/user lifecycle design. |
| 03 | data-governance | Candidate | Inventory hidden analytics, crash, and advertising collection now; mobile privacy disclosures revisit later. |
| 04 | mobile-release | Verify | The app-icon/in-app-purchase-icon rejection claim requires current Apple evidence. |
| 05 | legal | Deferred | EULA link/location and actual terms need applicable requirements before mobile release. |
| 06 | evidence-quality | Verify | The 1.2-million rejection figure and top-five ordering are unverified. |

## PRACTICE-008

Source: [Five launch checks](engineering-practice-video-subs/2026-09-01-five-checks-before-launching-an-app.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | legal | Candidate | Terms, user content, data ownership, and privacy must fit the actual German B2B model. Arbitration clauses require jurisdiction-specific review, not competitor copying. |
| 02 | capacity | Candidate | Consider bounded read/write load on central shared records using representative data if needed to establish beta capacity. |
| 03 | security-tests | Candidate | Run a structured security assessment with explicit critical/high-priority findings; one skill or one hour cannot certify completeness. |
| 04 | recovery | Candidate | Restore a backup into an isolated environment and verify application/data integrity. |
| 05 | payments | Deferred | Real-money payment/refund verification needs a payment feature and explicit financial authorization. Sandbox limits do not authorize live charges now. |

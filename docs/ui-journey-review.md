# Call Insights UI and journey review

Reviewed 24 October 2026 against the implemented AppKit app, product spec, wireframes and mock prototype. An independent UI/UX subagent reviewed the core journey. Vendor comparisons use the official documentation linked below; they are capability comparisons, not hands-on vendor usability, accuracy, performance or cost benchmarks.

## Assessment

The current app is a useful read-only call and transcript browser. It does not yet complete the analyst journey described in the product spec. The principal gap is task completion: a user can inspect a call, but cannot listen to the evidence, collect it into a durable investigation, test a hypothesis across calls, or share a resulting business case.

The intended primary user is a process-improvement analyst. The first complete journey should be:

> Identify an issue → open the matching calls → hear and verify a relevant moment → save evidence → share a finding with its scope and limitations.

The manager's overview should provide an entry into that journey. Full contact-centre operations and live agent coaching remain outside the stated MVP.

The existing local preview at `http://[::1]:8000` returned an `ENOENT` error referencing the obsolete `appkit/call-insights/client/index.html` path. The subagent did not restart the process. That preview cannot establish the current source's appearance or browser behavior. Source findings below are independent of that stale local process; no deployed FEVM app or vendor tenant was exercised for this review.

## Prioritized journey findings

| Priority | Finding and user impact | Concrete next change |
|---|---|---|
| P1 | Call detail has timestamps and a speaker timeline, but clicks only update `selectedTime`. Users cannot verify whether ASR or generated evidence represents what was actually said. | Add an authorized audio player with seeking, speed controls, transcript synchronization and timestamp deep links. Keep the player visible while reviewing evidence. |
| P1 | Labels and Cases lead to placeholder pages. A user reaches a call and has no durable next step. The spec's hypothesis-testing and business-case journeys stop here. | Complete one evidence-saving path: select a transcript range, save it with audio times and an analyst note, reopen it in a case, then share an authorized link. Choose a persistent store before implementing writes. |
| P1 | Raw text is returned when masking is missing, and `some(is_masked)` can describe a partly masked call as masked. This misrepresents what the user is viewing. OBO execution does not itself redact text. | Withhold unmasked text from the default route and show explicit complete/partial/pending/failed masking states. Enforce separate authorization for raw content. |
| P2 | Overview displays charts but does not connect a selected category or spike to an equivalent Explore cohort. | Wire chart selection to Explore with the same queue, period and category. Make the selected scope visible. |
| P2 | Explore filters are component state; the call link contains only the interaction ID and the back link goes to bare `/explore`. The user loses the investigation context. | Store filters and paging in URL parameters; preserve the return URL, search phrase and selected timestamp. Show why the call matched and highlight the evidence. |
| P2 | The result query silently limits results to 100. A displayed result count can be mistaken for the full matching population, and older matches cannot be browsed. | Add a total count, stable server pagination and ordering; say “Showing 1–100 of N.” |
| P2 | Enrichment covers a sample and Explore defaults to that sample. Counts, sentiment and reasons can be mistaken for corpus-wide evidence as users move between screens. | Keep one consistent scope/coverage strip across screens: selected population, enriched count, processed time and exclusions. Avoid presenting “repeat contact mentioned” as measured repeat-contact rate. |
| P2 | A missing `repeat_contact_mentioned` value is rendered as “No,” turning an unprocessed call into an apparent negative finding. | Render “Not evaluated” for null, distinguish failed processing from no match, and identify generated summaries/sentiment as AI output with inspectable evidence. |

Source anchors:

- [Call detail selection and transcript state](../apps/call-insights/client/src/pages/calls/CallDetailPage.tsx): `selectedTime` at line 29, masking status at line 64, timestamp actions at lines 137 and 185, and masking message at line 156.
- [Placeholder navigation](../apps/call-insights/client/src/App.tsx): Labels/Cases routes at lines 99–115.
- [Overview](../apps/call-insights/client/src/pages/overview/OverviewPage.tsx): scope at lines 67–73 and chart bindings at lines 126–155.
- [Explore](../apps/call-insights/client/src/pages/explore/ExplorePage.tsx): local filters at lines 46–52, result count at line 165 and call link at line 193.
- [Result cap](../apps/call-insights/config/queries/explore_interactions.obo.sql): line 47.
- [Unknown repeat-contact output](../apps/call-insights/client/src/pages/calls/CallDetailPage.tsx): line 251.
- [Raw transcript fallback](../apps/call-insights/config/queries/call_segments.obo.sql): line 8; keyword-search fallback in `explore_interactions.obo.sql` at line 43.

The current source has useful foundations: a small navigation model, responsive layout, transcript search, visible key-moment grounding warnings, loading/error states, and explicit disclosure that some metrics cover an enrichment sample. The mock prototype and wireframes illustrate future interactions; they are not evidence those interactions are implemented.

## Comparison with Genesys and AWS

“Genesis” is interpreted here as Genesys Cloud CX. For AWS, distinguish the managed Amazon Connect/Contact Lens experience from the customizable Post Call Analytics (PCA) guidance/sample. PCA is the closer architecture comparison for an app that consumes existing recordings without replacing the contact-centre platform.

| Task | Call Insights today | Genesys Cloud CX | Amazon Connect conversational analytics / Contact Lens |
|---|---|---|---|
| Find a relevant conversation | Basic SQL filters and keyword search; capped list | Content, topic and sentiment analysis/search | Contact search by transcript and conversation characteristics |
| Verify a moment | Text, timing and key-moment quotes; no audio playback | Synchronized transcript/audio, playback controls and topic/sentiment markers | Synchronized transcript/audio, timestamp navigation and key highlights |
| Define and investigate patterns | Label journey specified but not implemented | Topics, categories and topic mining | Categories/rules, generative natural-language semantic matching and theme reports |
| Act on a finding | Cases and Labels are placeholders | Evaluations, recording annotations and associated quality workflows | Evaluations, coaching and rules that can create tasks or alerts |
| Explain processing choices | Separate custom ASR deployment and MLflow benchmark exist; not exposed in the app | Not assessed for equivalent custom-model experimentation | Managed Connect workflow; AWS PCA provides a customizable application architecture |

Genesys documents synchronized playback, transcript navigation and recording annotations in its [interaction overview](https://help.genesys.cloud/articles/work-with-an-interaction-overview/), [topic/category analytics](https://help.genesys.cloud/articles/about-speech-and-text-analytics/) and [quality evaluation workflow](https://help.genesys.cloud/articles/evaluate-interaction/).

AWS documents [audio/transcript synchronization and highlights](https://docs.aws.amazon.com/connect/latest/adminguide/turn-by-turn-transcript.html), [natural-language rules and actions](https://docs.aws.amazon.com/connect/latest/adminguide/build-rules-for-contact-lens.html), [theme-to-contact investigation](https://docs.aws.amazon.com/connect/latest/adminguide/use-theme-detection.html) and [evaluations/coaching](https://docs.aws.amazon.com/connect/latest/adminguide/evaluations.html). Availability depends on the configured product features, language, region and entitlements; this review did not audit those for a customer tenant.

[AWS PCA guidance](https://docs.aws.amazon.com/solutions/post-call-analytics-on-aws/) processes existing recordings through S3, Step Functions, Transcribe, Comprehend and Bedrock, with a call-review UI and QuickSight analytics. It is a guidance/sample architecture requiring deployment and operation, rather than evidence of a turnkey managed contact-centre experience equivalent to Connect.

These products already cover much of the proposed baseline. In particular, natural-language labels, sentiment, summaries or the ability to ingest external recordings should not be presented as unique advantages of this app. Nothing in the current comparison establishes a better ASR, lower cost or better scale for Call Insights.

## Recommended product direction

Position Call Insights as an analyst investigation workspace over governed enterprise data. A valuable target is answering a question such as: “Did the new payment flow cause repeat calls, which customers were affected, and what evidence supports changing it?”

That requires joining call evidence with actual payment events, repeat contacts, complaints and outcomes; the current app does not yet make those joins. Versioned label definitions, replayable cohorts, processing provenance and measured business outcomes would support a stronger differentiation case than another transcript dashboard. The existing MLflow comparison helps establish engineering evidence but does not itself demonstrate an analyst-facing outcome.

Implement in this order:

1. **Complete investigation navigation:** URL-based filters, visible scope/coverage, counts/pagination, overview drill-through and highlighted matching evidence.
2. **Make evidence verifiable:** governed transcript reads, honest masking states, authorized audio playback, synchronized transcript and timestamp links.
3. **Close the first journey:** persistent case evidence, analyst notes and authorized sharing. Do this before adding more empty navigation destinations.
4. **Build the label loop:** define → sample test → review matches and counterexamples → refine/version → run on a frozen cohort → inspect prevalence and evidence → track new calls. Disclose errors and unprocessed calls.
5. **Connect findings to business outcomes:** add a real outcome dataset and a repeatable before/after investigation. State observational limitations when estimating impact.

For the current read-only release, the visible navigation can stay focused on Overview and Explore, with Call detail as a drill-in. Add Cases and Labels as their working journeys become available. Keep model/endpoint administration and MLflow benchmarking in the engineering subproject unless analysts need that information to judge an individual result.

## Acceptance scenario

An analyst selects a queue and period, opens a contact-reason cohort from Overview, and sees its total count and enrichment coverage. They search within the cohort, open a matching call at the relevant transcript turn, listen to that moment, and save a timestamped excerpt and note to a case. After inspecting another call, they return to the same results without losing their filters. A permitted colleague opens the shared finding and verifies its sources; a restricted colleague cannot retrieve the underlying call or audio.

Finishing that scenario provides a more useful first release than expanding the number of charts or adding an Ask box before evidence and follow-up work.

> Moved from `prototypes/call-insights` on 26 October 2026, when this design became the app's only UI. The validation notes below describe the fixture-only prototype at the time.

# Red and black redesign

The local prototype now prioritizes an analyst's investigation: identify a pattern, inspect matching conversations, select timestamped evidence, then collect it in a case with an interpretation. A black navigation rail separates the workspace from a charcoal canvas; red identifies active navigation, primary actions and the featured investigation. Text labels preserve status meaning alongside color.

Overview, Explore calls and Investigations are the primary destinations. Labels and Ask sit under Experiments because their results remain simulated. Compact source/scope strips disclose fictional data and the fixed snapshot. The shell uses native React components and CSS tokens to keep this existing standalone mock lightweight; no AppKit, backend or remote dependencies were added.

| Review concern | Local prototype response |
| --- | --- |
| Chart-to-cohort navigation | Spotlight, reasons and patterns open Explore with the same period and queue. |
| Lost filters and paging | Search, filters and page are encoded in the URL. Call source links retain the full return URL, including query and timestamp. |
| Misleading totals and scope | Overview figures, reasons, patterns and daily counts derive from the same filtered calls. No prior-period values are fabricated. |
| Incomplete evidence journey | Select a range of turns, add a required analyst note, save to a new/existing case, reopen its source and export a brief. |
| Verifying a moment | Seek, speed and transcript controls demonstrate the interaction with explicitly synthetic speech. This does not verify ASR against an original recording. |
| Masking ambiguity | Shared fixture masking hides spoken account numbers on transcript/search surfaces. Production masking is explicitly not evaluated. |
| AI and outcome ambiguity | Annotations are labelled fixtures; repeat-contact mentions are distinguished from measured outcomes. |
| Placeholder destinations | Cases supports a working local collection flow; simulated AI functions are secondary and labelled. |

Cases are stored only in the current browser. Links do not establish authorized sharing. Production audio access, backend persistence, raw-content authorization, real masking states and colleague permissions remain work for the deployed app.

Validation on 24 October 2026:

- TypeScript and production build passed.
- Lint passed with the existing `only-export-components` Fast Refresh warning in `store.tsx`.
- Browser walkthrough: spotlight → filtered results → exact-phrase match → timestamped call → save excerpt + note → case; evidence survived a reload.
- Queue and 30-day scope survived a call deep-link reload; the back link retained the exact cohort.
- Synthetic speech ran through to completion; no browser console errors were observed during the walkthrough.
- Mobile checked at 390 × 844 CSS pixels: no document overflow in Overview or Call review; the empty queue state remained usable.
- Keyboard skip navigation focused the current main content without changing its route.

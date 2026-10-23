# Value dimensions: from a process change to money a CFO accepts

This is the design for widening AIxRay's business case beyond labor savings. It is written for review by the business owner and the delivery team before each step is built. Steps 1, 2 and 3 are built.

## Why

A business case that stops at hours saved does not get funded. Finance asks how those hours become money: overtime cut, hires not made, a vendor contract reduced, losses avoided, or more profitable work done. AIxRay already measures what changes in a process (effort, waits, handoffs, rework, SLA breaches, slow cases). What it lacked is the step in between: which financial mechanism the change triggers, how much of it can actually be realized, and how strong the evidence is.

## Three layers

1. **Operational change.** What gets faster, cheaper, more accurate or more predictable, measured on the process model, a scenario or an event log.
2. **Financial conversion.** A formula for one value dimension turns the change into money, with the basis of every input.
3. **Investment economics.** Value by year, net of costs, as ROI, NPV and payback, under low, expected and high cases.

## Three figures for every benefit

| Figure | Meaning |
|---|---|
| **Gross** | What the change is worth if it applies to all the work it touches |
| **Realizable** | The part that can become money, given how it will be realized: gross × the share that can be realized |
| **Validated** | The amount Finance has confirmed, or that checkpoints and event logs show after the change |

These are three views of the same benefit, never three amounts to add. The realizable figure is the one a business case is ranked and funded on. The validated figure is the one an outcome-based or gain-share fee is priced on.

## How the money arrives

Every value dimension has one financial treatment, which decides how it enters the totals:

| Treatment | Examples | What Finance checks |
|---|---|---|
| Freed capacity | Labor hours saved | How the hours become money; until then the realizable figure stays blank |
| Direct expense reduction | Licenses, vendor fees, outsourcing, overtime | The account, contract or budget line that changes, and when |
| Cost avoidance | Hires not made, temporary staff not booked | A credible staffing or spending plan the change makes unnecessary |
| Avoided loss | Rework, penalties, write-offs, incidents | Documented losses today and the expected residual loss |
| Extra margin | Faster quotes winning more, recovered billing | Contribution margin, never gross revenue |
| Working capital | Faster collections, less inventory | One-time cash released kept apart from the yearly financing benefit |
| Expected future value | Reusable AI components, experiments | Probabilities and timing; reported apart from committed value |

## Evidence

AIxRay already labels every input illustrative, provided, measured or confirmed, and a result carries its weakest input's basis. For a benefit that maps onto the evidence classes Finance uses:

| Class | AIxRay basis | Use |
|---|---|---|
| A. Financially verified | Confirmed, with a validated amount and its source | Realized value; gain-share |
| B. Operationally validated | Measured, from an event log or checkpoints | The forecast |
| C. Economically modeled | Provided | Scenarios |
| D. Exploratory | Illustrative | Prioritization only, shown apart from committed value |

A benefit needs both kinds of evidence: that the operation changed, and that the change is money. Fewer escalations prove the first; only an invoice, a budget line or a staffing plan proves the second.

## No double counting, by construction

- Each benefit is one value line with its own ID, and appears once in the totals.
- Benefits that monetize the same hours or the same money share a pool. Labor, coordination, exception handling and onboarding on the same step draw on one hours pool. Hires avoided is the way those hours are realized, so when an opportunity has a hires-avoided line, its labor line is shown for reference and not counted again.
- The existing warning about two opportunities changing the same step stays, and widens to two benefits drawing on the same pool.
- Strategic outcomes (trust, transparency, employee experience) are tracked as goals and never given a made-up dollar value.

## The value dimensions

Each dimension is a formula template with named inputs. The columns say where AIxRay gets the operational input today and in which step the template arrives.

### Core dimensions

| Dimension | Formula | Operational input in AIxRay | Step |
|---|---|---|---|
| Labor | cases × share affected × hours per case × effort reduction × rate | Touch effort per step, measured step time | Existing; realization in 1 |
| Errors and rework | cases × (error rate today − after) × cost per error | Rework loops, revisited steps, event-log rework rate | 1, cost per error builder in 2 |
| SLA penalties | (breaches today − after) × penalty actually paid | SLA lens, scenario timings | 1 |
| Hires avoided | (planned hires − hires still needed) × loaded cost per hire | Time freed up against the client's hiring plan | 1 |
| Licenses and vendor fees | (units paid today − units needed) × cost per unit per year | Systems recorded on each step | 1 |
| Cycle time with a money effect | fewer late cases × cost of a late case | Elapsed time, waits | 2 |
| Throughput | (min(demand, capacity after) − min(demand, capacity today)) × margin per unit | Bottleneck lens, capacity per step | 2 |
| Revenue and win rate | opportunities × (win rate after − today) × margin per win | Quote and response time on the path | 2 |
| Customer service | contacts avoided × avoidable cost per contact | Contact steps, repeat visits | 2 |
| Retention | customers kept × contribution, discounted over the expected stay | Goals; client data | 3 |
| Compliance and risk | expected annual loss today − after | Risk findings | 3 |
| IT and technology | legacy cost retired − legacy cost remaining | Systems per step | 1 (as licenses and vendor fees), 3 |
| Onboarding | new hires × weeks of ramp-up saved × value per week | Client data | 3 |
| Scalability | planned capacity spend avoided at forecast demand | Volume growth assumption | 3 |

### Less obvious dimensions

| Dimension | Formula | Operational input in AIxRay | Step |
|---|---|---|---|
| Coordination and handoffs | cases × (touches today − after) × minutes per touch × rate × realization | Handovers lens, lane changes per case | 2 |
| Slow cases (variability) | fewer cases past the deadline × cost of lateness | 90th-percentile times in event-log statistics | 2 |
| Exceptions | per exception type: count × cost today − count × cost after | Gateway branches and their share of cases | 2 |
| Decision delay | decisions × (expiry rate today − after) × margin | Waits typed as decisions, approval steps | 2 |
| Billing and revenue leakage | billable volume × leakage rate × amount × (recovery after − today) × margin | Billing steps, client data | 2 |
| Peak load | temporary shifts avoided × cost per shift | Seasonal volume | 3 |
| Working capital | annual sales ÷ 365 × days saved, then × financing rate for the yearly benefit | Collections steps, client data | 3 |
| Opportunity capture | extra opportunities × win rate × margin − pursuit cost | Work never done today (workshop question) | 3 |
| Forecast quality | cost of decisions with today's forecast − with the new one | Client data | 3 |
| Incident containment and recovery | fewer incidents spreading × cost each; hours of disruption avoided × cost per hour | Incident steps | 3 |
| Audit evidence | preparation hours saved × rate × realization + outside fees avoided | Control steps | 3 |
| Policy consistency | fewer costly deviations × remediation cost, less false rejections | Decision steps | 3 |
| Time to proficiency, knowledge, specialist access | weeks saved, reconstruction avoided, escalations avoided, each × its unit value | Workshop and client data | 3 |
| Experimentation, reusable AI components | expected value: probability × value − cost; savings on follow-on use cases | Portfolio level, in the screening | 3 |

The guide behind this design gives worked examples for every dimension. Their figures are illustrative and are not shipped as benchmarks.

## Step 1: value lines (built)

An opportunity's business case is its labor estimate plus a list of **value lines**. Each value line is one dimension with:

- its inputs, each a number or blank;
- its basis (illustrative, provided, measured or confirmed) and a note;
- **the share that can be realized** (percent) and **how it will be realized**, in words, such as "two planned Q1 hires are not made" or "renegotiated at the March renewal";
- **the finance owner** who confirms it;
- **the validated amount** and where it came from, once Finance confirms it.

The labor estimate gets the same realization, finance owner and validated fields.

Templates in step 1:

| Template | Inputs | Treatment |
|---|---|---|
| Errors and rework | Cases per year (blank uses the project's annual volume), error rate today and after (%), cost per error | Avoided loss |
| SLA penalties | Breaches per year today and after, penalty or credit per breach | Avoided loss |
| Hires avoided | Planned hires, hires still needed after the change, fully loaded annual cost per hire | Cost avoidance |
| Licenses and vendor fees | Seats or units paid for today, still needed after, cost per seat or unit per year | Direct expense reduction |

What changes in the figures:

- **Gross annual value** is the labor cost saved plus every value line. When a hires-avoided line exists, it is how the labor hours are realized, so labor is shown for reference and not counted twice.
- **Modeled net annual benefit** is the gross value less the annual running cost. With no value lines it is exactly what it was before.
- **Realizable annual value** is the sum of each counted part's gross × its realization share, less the running cost. A part with no realization share leaves it blank, as any missing input does.
- **Validated annual value** is the sum of the amounts Finance confirmed, with how many of the parts are confirmed.
- An opportunity is ranked on its realizable value when it has one, otherwise on its modeled net benefit as before. Payback uses the realizable value when there is one.
- If more hires are avoided than the labor estimate frees up as FTE, the case says so.

Opportunities without value lines or realization fields compute, rank and print exactly as before, and files saved before step 1 keep their shape.

## Step 2: the cost per error builder, and more templates (built)

A cost per error is rarely tracked as one number. The builder reconstructs it from the process map:

1. **Error types**, with severity (minor, moderate, severe) and how often each happens per month.
2. **Trace the last real error on the diagram**: where it started, at which step it was caught, which steps were redone and which lanes were pulled in. Detection, correction and downstream labor come from the touch effort of those steps, not from a guess.
3. **What the diagram cannot know**: credits, write-offs, penalties, and the expected cost of rare severe incidents.
4. **Every figure labeled** measured, sampled or assumed, with the blended cost per error, the yearly cost of poor quality, and the part the change can address.

The builder lives inside an Errors and rework line. When a line has error types, it is valued per type, as 12 × the sum over types of (errors per month today − after) × cost per error, and the line's own error rates and cost per error are not used. Each type's cost per error is the touch effort of the steps redone plus the investigation hours, at the project's hourly rate, plus the direct costs and the expected cost of rare severe consequences. Blank optional costs count as none. A redone step without a touch effort, or labor without an hourly rate, leaves the cost blank and says which. The one-pager shows a Cost of errors table with each type, the blended cost per error and the yearly cost of poor quality today.

Step 2 also adds eight templates:

| Template | Formula | Treatment |
|---|---|---|
| Late or slow cases | cases × (share late today − after) × cost of a late case | Avoided loss |
| More work done | (min(demand, capacity after) − min(demand, capacity today)) × margin per unit | Extra margin |
| Handoffs and coordination | cases × (touches today − after) × minutes per touch ÷ 60 × hourly rate | Freed capacity |
| Exceptions handled | (exceptions today − after) × cost to handle one | Freed capacity |
| Decisions made in time | decisions × (share lost to delay today − after) × margin per opportunity kept | Extra margin |
| Faster quotes, more wins | opportunities × (win rate after − today) × margin per win | Extra margin |
| Customer contacts avoided | (contacts today − after) × avoidable cost per contact | Freed capacity |
| Billing and revenue leakage | items × leakage rate × amount × (recovery after − today) × margin share | Extra margin |

Cases per year and the hourly rate fall back to the project's assumptions when left blank. The design's separate cycle time and slow cases rows are one template, Late or slow cases, because they share a formula; its hint points to the 90th percentile in an event log.

Not yet in step 2: the templates do not fill themselves from the process. Prefilling handoffs from lane changes, late cases from the SLA lens and slow cases from event-log percentiles is the next refinement, and the error builder chooses redone steps from a list rather than by clicking the diagram.

## Step 3: investment economics and proof (built)

- **Value by year with an adoption ramp**, over three, four or five years, with NPV at a discount rate, ROI and the payback month. Year 0 is the up-front cost. The yearly benefit at full adoption is the realizable value; when nothing is marked realizable yet, the case uses the modeled value and says so.
- **Low, expected and high cases**, each with its own NPV, ROI and payback. Each figure in the business case can take a low and a high value: moved one at a time, they show which figures matter most, and together they give the low and high case. Without ranges, the cases are a share of the expected benefit (for example 70% and 120%). See [business-case.md](business-case.md#low-and-high-for-each-figure).
- **The full cost model**: cost lines by category (implementation, integration and data, model use, agent orchestration, human review and fallback, evaluation and monitoring, infrastructure, security and governance, training and change management, maintenance), each one-time and per year. With cost lines, they replace the business case's one-time and running cost in the investment case. Given the workflows that complete correctly each year, the case shows the **cost per successful workflow**.
- **Gain-share**: an agreed share of the value Finance confirmed, for a set number of months. With no confirmed value there is no fee; it is never priced on a forecast.
- **Attribution with a comparison group**: the before-and-after event-log comparison accepts two logs from a team that did not get the change, one per period, and reports the measured change net of that team's own change (the difference in differences). See [benefits.md](benefits.md#a-comparison-group).
- **Client sign-off on value inputs**: a review form can include the business case figures and the project assumptions, and the client confirms or disputes each one. Once every figure in a part is confirmed, its basis becomes Confirmed. See [client-review.md](client-review.md).
- **Portfolio dimensions in the screening**: reuse in other processes, cash tied up by the process, and what a pilot would teach, as optional value criteria. See [screening.md](screening.md#criteria).

The investment settings live on the opportunity as `investment`, edited under **Investment over time** in the business case editor and shown on the one-pager. A blank adoption year or discount rate leaves NPV blank. As an example, a net cash flow of −250,000, 90,000, 330,000 and 370,000 at 10% gives an NPV of about 382,500, an ROI of 71% and payback at about 17.8 months; the unit tests check this.

## Open questions for the business owner

1. Which realization routes does Finance accept for freed capacity at our clients: overtime, contractors, planned hires, redeployment to billable work?
2. Should the realizable value or the modeled net benefit lead the CFO one-pager?
3. For gain-share, which validated evidence would a deal review accept: Finance sign-off, event-log comparison, or both?
4. Which three to five dimensions should every Jumpstart assessment calculate in depth? The guide recommends depth on a few over thin estimates on all.
5. Which industry demos come first: underwriting, claims or policy services?

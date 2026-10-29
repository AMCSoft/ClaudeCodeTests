# Search Queries for Job Scraper

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Enabled here: `linkedin-search` and `freehire-search` (both country-agnostic, zero runtime dependencies). The four Danish demos ship **disabled** and stay that way - flip `enabled: true` in their frontmatter only if the Nordic market becomes relevant.

The `site:` query templates below are the **WebSearch fallback** - for the Italian and remote boards that have no CLI, for company career pages, and for when a CLI fails. No Italian portal CLI is installed; `/add-portal` can scaffold one for InfoJobs or Indeed IT if the WebSearch fallback proves too thin.

**Language scope:** queries are written in **English and Italian**, matching the working languages in CLAUDE.md. German is declared at **A1.2/A2.1 (elementary)**, so the Language Gate *flags* German-requiring postings rather than excluding them - but at that level a German-language role is not realistically workable, so treat the flag as near-disqualifying unless the posting says the working language is English. No German query set: searching in a language you cannot interview in wastes the scrape. Many Regensburg and Berlin embedded roles run in English - those surface through the English queries anyway.

## Search Sites

Primary:
- **linkedin.com/jobs** - also covered by the `linkedin-search` CLI (filters: Remote / Italy / EU)
- **it.indeed.com** - largest general board for the Italian market
- **infojobs.it** - second general Italian board
- **weworkremotely.com**, **remoteok.com**, **euremotejobs.com** - remote-first boards, central given the remote+travel preference

Secondary (company career pages via Google):
- Direct `site:` searches against target companies' own career pages - always prefer the employer's own posting over an aggregator listing

## Query Categories

Organized by **function**, not by exact job title. Each tier lists several plausible title strings, because the same work is posted under different names across companies and markets.

### Priority 1: Backend / infrastructure engineering at scale

The most desired direction. A domain transfer from embedded: the systems fundamentals carry over, the cloud and distributed-operations experience does not yet exist, so expect these to score lower on Experience Match and lead with the transfer argument.

```
site:linkedin.com/jobs "Backend Engineer" Rust remote
site:linkedin.com/jobs "Systems Engineer" C++ remote Europe
site:linkedin.com/jobs "Infrastructure Engineer" Linux remote
site:linkedin.com/jobs "Performance Engineer" C++ remote
site:weworkremotely.com "backend engineer" Rust OR C++
site:remoteok.com "systems engineer" OR "backend engineer" Rust
site:euremotejobs.com "backend" OR "infrastructure" engineer C++
site:it.indeed.com "Backend Engineer" C++ remoto
site:it.indeed.com "Software Engineer" Rust remoto
site:infojobs.it "sviluppatore backend" remoto
```

### Priority 2: Embedded / systems software

The strongest match on paper: embedded Linux, kernel, systemd, memory management, C/C++.

```
site:linkedin.com/jobs "Embedded Software Engineer" Linux remote OR Italy
site:linkedin.com/jobs "Embedded Linux Engineer" kernel remote
site:linkedin.com/jobs "Systems Software Engineer" C Linux Italy
site:linkedin.com/jobs "Firmware Engineer" C remote Europe
site:it.indeed.com "Embedded Software Engineer" Linux
site:it.indeed.com "sviluppatore embedded" C Linux
site:infojobs.it "ingegnere software embedded"
site:infojobs.it "sviluppatore C" embedded Linux
site:euremotejobs.com embedded Linux engineer
```

### Priority 3: Automotive / AUTOSAR

Current specialisation and current billable work. Strongest market in Germany and northern Italy; remote contracts exist, which matches the current KooSys arrangement.

```
site:linkedin.com/jobs "AUTOSAR" Engineer remote OR Italy OR Germany
site:linkedin.com/jobs "Automotive Software Engineer" C AUTOSAR remote
site:linkedin.com/jobs "CAN" "embedded" engineer automotive remote
site:linkedin.com/jobs "DaVinci Configurator" OR "Vector" AUTOSAR
site:it.indeed.com AUTOSAR software engineer
site:it.indeed.com "software automotive" C embedded
site:infojobs.it AUTOSAR automotive sviluppatore
```

### Priority 4: Aerospace / defense software

Niche with few qualified competitors: flight-grade ISO-C99, PUS, validation, NVM filesystems. Note that many defense roles require national security clearance or EU-citizen-only status - check before investing in an application.

```
site:linkedin.com/jobs "flight software" engineer C remote OR Italy
site:linkedin.com/jobs "space software" OR "satellite software" engineer C
site:linkedin.com/jobs "aerospace software engineer" C embedded Italy
site:linkedin.com/jobs "PUS" OR "ECSS" software engineer
site:it.indeed.com "software aerospaziale" C embedded
site:it.indeed.com ingegnere software spazio OR satellite
```

### Priority 5: Broader technical / consulting

Wider net. The DXC Luxoft background makes engineering-consultancy roles a genuine fit.

```
site:linkedin.com/jobs "C++ Developer" remote Europe
site:linkedin.com/jobs "Technical Consultant" embedded OR automotive Italy
site:it.indeed.com "sviluppatore C++" remoto
site:infojobs.it "consulente tecnico" software embedded
```

## Location Filter

Preference is **remote-first with occasional travel**, based in Fano (PU), Marche, Italy.

- **Ideal:** fully remote (worldwide, EU, or Italy), with occasional onsite or offsite travel
- **Acceptable:** remote within Italy; remote within the EU with quarterly or monthly travel
- **Acceptable:** hybrid in Ancona, Pesaro, Rimini, Bologna (reachable from Fano without relocation)
- **Borderline:** hybrid in Milan, Turin, Rome, Munich, Regensburg, Berlin - only if the onsite cadence is genuinely low, or the role justifies relocation
- **Too far:** any role requiring full-time onsite presence outside commuting range of Fano, unless it is explicitly a relocation offer worth considering

Flag anything advertised as "remote" that in practice requires a fixed number of office days: that is hybrid, and it belongs in the borderline tier.

## Language Filter

Working languages: Italian (native), English (professional working proficiency), German (A1.2/A2.1, elementary). Apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language not declared at all is excluded before scoring; a posting requiring a *higher* level than declared is flagged for judgment, not excluded. In practice that means **German-requiring postings surface with a flag** - read whether German is genuinely required on the job or just the language the ad happens to be in. A posting merely *written* in another language, without requiring it, is fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If a focus area is specified, select queries from the matching tier and generate 2-3 custom queries for that focus. For example `/scrape rust` draws from Priority 1 plus Rust-specific variants.

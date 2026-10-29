---
framework_version: 1.0.0
---

# Interview Preparation Guide

<!-- SETUP: STAR examples are personalized by running /setup based on your actual experience -->

## STAR Format

Structure answers as: **Situation** (context), **Task** (your responsibility), **Action** (what you did), **Result** (outcome).

Keep answers to 1-2 minutes. Be specific. End with what you learned or would do differently.

## Ready-Made STAR Examples

<!-- These are populated by /setup from your actual experience. Below are templates showing the format. -->

> **Grounding note:** the Situation / Task / Action lines below are drawn from your CV and are
> factually safe to use. Every **R** line is marked *[fill in]* where the CV carries no measurable
> outcome - interviews are won on the R, so write real numbers or concrete consequences there before
> relying on any of these. Do not let `/apply` or an interview answer invent them.

### 1. Non-volatile memory filesystem for a spacecraft (solo ownership, systems design)
**S:** At Intelligentia, working on defense and aerospace software, a non-volatile memory application
needed a filesystem suitable for a safety-critical spacecraft environment, where a failure is not a
rollback.
**T:** Design and implement the entire filesystem alone, from requirements through to validated code -
this also served as the master's thesis.
**A:** Designed the on-memory layout and the memory management strategy for a constrained critical
environment, implemented it, and documented it to the standard required for aerospace validation.
Verified behaviour with the CanTaTa automated testing toolchain.
**R:** *[fill in - delivered and validated? thesis grade? did it ship or feed a flight product? any
figures on memory footprint, wear levelling, or recovery behaviour?]*
**Use for:** "Tell me about the most complex thing you've built", "Describe a project you owned end to
end", "How do you approach correctness when you can't just test in production"

### 2. Embedded Linux for V2V truck communication (systems depth, cross-layer work)
**S:** At DXC Luxoft, trucks needed vehicle-to-vehicle communication running on an embedded Linux
platform, spanning kernel-level concerns up to application services.
**T:** Support and develop the automotive Linux software stack for that communication path.
**A:** Worked at kernel level and on embedded Linux system configuration, built systemd modules,
implemented Bluetooth and LAN functionality, and wrote the surrounding code in C++14/17 and C99 with
Python and Bash tooling. Validated everything on real hardware benches rather than in simulation only.
**R:** *[fill in - what shipped? how many truck platforms or ECUs? any latency, reliability or
integration-time improvement you can point to?]*
**Use for:** "Describe your experience across the stack", "Tell me about debugging something hard",
"How do you work with hardware you can't easily instrument"

### 3. AUTOSAR environment set-up and test automation (ownership, tooling initiative)
**S:** KooSys GmbH was building next-generation automotive software and needed its AUTOSAR environment
generated, configured and kept testable as the codebase grew.
**T:** Set up and configure the AUTOSAR environment (RTE, BSW, SWC), implement CAN communication, and
make testing of the C codebase repeatable.
**A:** Configured and coded RTE/BSW/SWC using the DaVinci Configurator and DaVinci Developer toolchain,
implemented CAN communication, and wrote Python scripting to drive automated tests around the C code.
Ran bench tests on real hardware; delivered in Agile SCRUM with GitLab and Jira.
**R:** *[fill in - what did the automation replace, and what did it save? manual test hours removed,
regressions caught earlier, onboarding time for the next engineer?]*
**Use for:** "Tell me about improving a process", "How do you approach testing", "Describe a time you
built tooling nobody asked for"

### 4. Continuity from employee to freelancer with the same client (trust, reliability)
**S:** After four months as a Software Engineer at KooSys GmbH in Regensburg, the engagement changed
shape in April 2024.
**T:** *[fill in - what actually drove the transition? Your choice, the company's structure, relocation
back to Italy? Interviewers will ask, and the honest version is almost always the stronger answer.]*
**A:** Continued delivering the same AUTOSAR work as an independent freelance engineer, with KooSys as
the main client, working remotely from Italy and staying inside their Agile SCRUM process.
**R:** Engagement has continued for 2 years and 6 months (April 2024 to date) as their main freelance contributor on the project.
*[fill in anything further - scope growth, additional clients, rate progression.]*
**Use for:** "Why did you leave KooSys?", "Why freelance?", "Why would you go back to a permanent
role?", "How do you build trust remotely"

### 5. C++ / OpenGL geomatic simulation software (graphics, from a standing start)
**S:** Soft.Lab. Srl built geomatic calculation and simulation software for designing houses and
buildings, with 3D projection as the core of the product.
**T:** As a trainee, develop features in their desktop product.
**A:** Worked in C++14 with the standard library and OpenGL on advanced 3D graphic scenarios and
simulations, built desktop UI with Qt and QML, and covered the work with CppUnitTest automated tests.
**R:** *[fill in - what did you ship in those six months? Was it your first professional C++? That
framing is itself a strong answer about ramp-up speed.]*
**Use for:** "Tell me about learning something new quickly", "Your earliest professional project",
"Experience outside embedded"

### 6. Scrum Master and Technical Lead alongside engineering (facilitation, ownership)
**S:** *[fill in - which team, which employer/client, and what state was the process in when you took
it over? "The team had no retrospectives" or "estimates were consistently off" is the kind of opening
that makes this answer land.]*
**T:** Run the SCRUM process as Scrum Master for roughly two years while continuing to deliver
engineering work; more recently, take on Project Manager / Technical Lead responsibilities.
**A:** *[fill in - which ceremonies you ran, how you handled blockers and estimation, what you changed
rather than inherited. The strongest version names one concrete change you made to how the team worked.]*
**R:** *[fill in - velocity, predictability, retention, fewer escaped defects, or simply "I was asked to
step up to Technical Lead" - which is itself a result worth stating.]*
**Use for:** "Tell me about leading a team", "How do you handle a blocked teammate", "Describe a time
you improved how your team worked", "Do you want to go into management?"

> **This one matters more than it looks.** Two years as Scrum Master is unusual for an embedded
> engineer and it is currently **absent from the CV**. For postings that ask about collaboration,
> mentoring, ownership or a "positive, ownership-driven team culture" it is the most differentiating
> thing in the profile - and right now no recruiter reading the CV can see it.

<!-- Add more STAR examples as needed. Aim for 4-6 covering different competencies. -->

## Common Tough Questions

### "Why did you leave [previous company]?"
> [PREPARE YOUR ANSWER - be honest, forward-looking, no negativity about former employer]

### "You don't have [specific skill/experience]."
> [PREPARE YOUR ANSWER - acknowledge the gap, bridge to adjacent experience, show willingness to learn]

### "Where do you see yourself in 5 years?"
> [PREPARE YOUR ANSWER - show ambition aligned with the role's growth path]

### "What's your biggest weakness?"
> [PREPARE YOUR ANSWER - genuine weakness with concrete mitigation strategy]

### "Why this company specifically?"
> Customize per company. Must reference: specific projects, company values, market position, or team structure. Never give a generic answer.

## Questions You Should Ask Interviewers

### About the Role
- "What does a typical week look like in this role?"
- "What would success look like in the first 6 months?"
- "What's the biggest challenge the team is facing right now?"

### About the Team
- "How big is the team, and how do you divide work?"
- "What does the development/project lifecycle look like, from idea to production?"
- "How do you onboard new team members?"

### About Tech & Growth
- "What's your current tech stack for [relevant area]?"
- "Is there room to grow into more architectural or strategic decisions?"
- "How does the team stay current with new tools and methods?"

### About Culture (use these to prevent disappointment)
- "How would you describe the team culture?"
- "What does professional development look like here?"
- "Is there flexibility for remote/hybrid work?"
- "What's the balance between development/new projects and maintenance work?"
- "How would you describe the leadership style in this team?"
- "What do people who thrive here have in common?"

## Phone/Video Interview Tips
- Have STAR examples written out (use this file)
- Keep a glass of water nearby
- Smile when speaking (it changes your tone)
- Ask for clarification if a question is vague
- It's OK to take 5 seconds to think before answering
- End with: "Is there anything else you'd like to know about my background?"

## After the Application (Best Practice)

### Follow-Up Etiquette
- **Don't call to "stand out"** or to learn more about the role post-submission - this risks a negative impression
- If the employer specified a timeline, respect it and wait
- If no timeline was given and significant time has passed (2+ weeks), a brief call to ask about status is acceptable
- If you have genuinely new, relevant information to share, a short follow-up is fine

### Thank-You Notes
- When you receive any update (interview invitation, rejection, or status update), send a brief thank-you message
- Express appreciation for their time and the process
- Keep it short (2-3 sentences)

## Roleplay Guidelines
When the user asks for interview practice:
1. Ask which role/company to simulate
2. Start with easy warm-up questions ("Tell me about yourself")
3. Progress to role-specific technical questions
4. Include 1-2 behavioral questions using the competencies from the job posting
5. End with a tough question or curveball
6. After each answer, give brief feedback: what worked, what to sharpen
7. Suggest which STAR example would work best for each question

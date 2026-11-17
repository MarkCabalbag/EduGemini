# Product

<!-- impeccable:product-schema 1 -->

Short product record for design work. Each fact is owned by the linked doc; if this file and that doc disagree, the doc wins and this file gets fixed.

## Platform

web

## Users

- **Instructor (Maya), primary.** An independent instructor at a laptop, reviewing 30 to 150 submissions in one sitting. Needs speed, a clear queue, and the original file next to the AI score. Fears approving a wrong AI grade under her name. ([PRD §4](../../docs/prd.md), [UX Brief §2](../../docs/ux-brief.md))
- **Student (Jon).** Uploads PDFs or phone photos of handwritten work, often on a phone. Needs certainty the upload worked, a result he understands, and how many tries are left.
- **Super Admin.** Rare visits on a laptop; metadata only, no student work.

## Product Purpose

Instructors create classes and assignments with free-text grading criteria, students upload files, and Gemini gives a first-pass score and feedback that the instructor reviews and approves. Value line: *first-pass grading in minutes, with the instructor always in control.* Goals and success measures: [PRD §3.2](../../docs/prd.md) and [§14](../../docs/prd.md).

## Positioning

Self-serve for one instructor, free-text criteria instead of a rubric builder, instructor approval required on every grade, and no AI cost to the platform because each instructor uses their own Gemini key. ([PRD §2.3](../../docs/prd.md))

## Operating Context

Portfolio project by one developer, hosted for demonstration and possibly a small pilot with friendly classes; not a commercial launch in v1. English only. End-to-end flow: [PRD §6](../../docs/prd.md). Screens and states: [App Flow](../../docs/app-flow.md).

## Capabilities and Constraints

Requirements: [PRD §7](../../docs/prd.md). Submission states: [PRD §8](../../docs/prd.md). Permissions: [PRD §5.1](../../docs/prd.md). Stack: [TRD §2](../../docs/trd.md). Upload limits and error codes: [API Spec](../../docs/api-spec.md). Out of scope for v1: [PRD §17](../../docs/prd.md).

## Brand Commitments

The name EduGemini. Voice, canonical strings, and the AI disclosure wording are fixed in [UX Brief §11](../../docs/ux-brief.md). The existing visual direction and tokens are in [UX Brief §4–5](../../docs/ux-brief.md).

## Evidence on Hand

None. No user research, testimonials, customers, metrics, or logo files exist ([PRD §2.2](../../docs/prd.md)). Do not invent them.

## Product Principles

1. AI output is always labeled and never final; only instructor approval makes a grade final.
2. A stressful moment should feel handled: say what happened, what it means, and what to do next, without blaming the user.
3. Never lose a user's work.
4. Repeat instructor work comes before decoration.

Full list: [UX Brief §3](../../docs/ux-brief.md).

## Accessibility & Inclusion

WCAG 2.1 AA for core flows in light and dark themes; every flow works at 360 px wide, by keyboard, and with a screen reader. Checklist: [UX Brief §12](../../docs/ux-brief.md).

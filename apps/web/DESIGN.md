---
name: EduGemini
description: Calm, careful web app for AI-assisted first-pass grading with instructor approval.
colors:
  primary: '#4f46e5'
  primary-hover: '#4338ca'
  primary-fg: '#ffffff'
  background: '#f8fafc'
  surface: '#ffffff'
  border: '#e2e8f0'
  input-border: '#64748b'
  text: '#0f172a'
  text-muted: '#475569'
  danger: '#b91c1c'
  danger-fg: '#ffffff'
  overlay: 'rgb(15 23 42 / 0.4)'
  status-approved-bg: '#dcfce7'
  status-approved-fg: '#166534'
  status-pending-bg: '#f1f5f9'
  status-pending-fg: '#334155'
  status-ai-bg: '#eef2ff'
  status-ai-fg: '#3730a3'
  status-info-bg: '#e0f2fe'
  status-info-fg: '#075985'
  status-error-bg: '#fee2e2'
  status-error-fg: '#991b1b'
  script-paper: '#ffffff'
  script-rule: '#c9d8ef'
  script-margin-red: '#d8342b'
  script-ink: '#1d3fa0'
  script-ink-hover: '#16307d'
  script-ink-fg: '#ffffff'
  script-text: '#1a1a1a'
  script-text-muted: '#3b4660'
typography:
  display:
    fontFamily: 'Inter Variable, system-ui, -apple-system, Segoe UI, sans-serif'
    fontSize: '1.75rem'
    fontWeight: 600
    lineHeight: '2.125rem'
  title:
    fontFamily: 'Inter Variable, system-ui, -apple-system, Segoe UI, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 600
    lineHeight: '1.75rem'
  body:
    fontFamily: 'Inter Variable, system-ui, -apple-system, Segoe UI, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: '1.5rem'
  label:
    fontFamily: 'Inter Variable, system-ui, -apple-system, Segoe UI, sans-serif'
    fontSize: '1rem'
    fontWeight: 600
    lineHeight: '1.5rem'
  small:
    fontFamily: 'Inter Variable, system-ui, -apple-system, Segoe UI, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: '1.25rem'
  micro:
    fontFamily: 'Inter Variable, system-ui, -apple-system, Segoe UI, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: '1rem'
  script-display:
    fontFamily: 'Atkinson Hyperlegible, system-ui, sans-serif'
    fontSize: '2.5rem'
    fontWeight: 700
    lineHeight: '72px'
    letterSpacing: '-0.025em'
  script-body:
    fontFamily: 'Atkinson Hyperlegible, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: '36px'
  script-label:
    fontFamily: 'Atkinson Hyperlegible, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 700
    lineHeight: '36px'
  script-hand:
    fontFamily: 'Caveat Brush, cursive'
    fontSize: '2rem'
    fontWeight: 400
    lineHeight: '36px'
rounded:
  script: '2px'
  sm: '6px'
  md: '8px'
  lg: '12px'
  full: '9999px'
spacing:
  '1': '4px'
  '2': '8px'
  '3': '12px'
  '4': '16px'
  '6': '24px'
  '8': '32px'
  script-half-row: '18px'
  script-row: '36px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-fg}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 16px'
    height: '44px'
  button-primary-hover:
    backgroundColor: '{colors.primary-hover}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 16px'
    height: '44px'
  button-secondary-hover:
    backgroundColor: '{colors.border}'
  button-danger:
    backgroundColor: '{colors.danger}'
    textColor: '{colors.danger-fg}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 16px'
    height: '44px'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: '0 12px'
    height: '44px'
  chip-approved:
    backgroundColor: '{colors.status-approved-bg}'
    textColor: '{colors.status-approved-fg}'
    typography: '{typography.micro}'
    rounded: '{rounded.sm}'
    padding: '2px 8px'
  chip-pending:
    backgroundColor: '{colors.status-pending-bg}'
    textColor: '{colors.status-pending-fg}'
    typography: '{typography.micro}'
    rounded: '{rounded.sm}'
    padding: '2px 8px'
  chip-info:
    backgroundColor: '{colors.status-info-bg}'
    textColor: '{colors.status-info-fg}'
    typography: '{typography.micro}'
    rounded: '{rounded.sm}'
    padding: '2px 8px'
  card:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.lg}'
    padding: '16px'
  script-button-primary:
    backgroundColor: '{colors.script-ink}'
    textColor: '{colors.script-ink-fg}'
    typography: '{typography.script-label}'
    rounded: '{rounded.script}'
    padding: '0 16px'
    height: '54px'
  script-button-primary-hover:
    backgroundColor: '{colors.script-ink-hover}'
  script-input:
    backgroundColor: '{colors.script-paper}'
    textColor: '{colors.script-text}'
    typography: '{typography.script-body}'
    rounded: '{rounded.script}'
    padding: '0 12px'
    height: '54px'
  script-alert:
    backgroundColor: '{colors.script-paper}'
    textColor: '{colors.script-margin-red}'
    typography: '{typography.script-body}'
    rounded: '{rounded.script}'
    padding: '7px 12px'
---

<!-- Recorded from src/index.css and src/components on 2026-11-16; the Marked Script added on 2026-11-19 from src/pages/SignIn.tsx and the .paper-page block in src/index.css. UX Brief §4–5 (docs/ux-brief.md) owns the design decisions; src/index.css holds the live values, including the dark theme. If this file disagrees with either, fix this file. The Marked Script records the sign-in page as built from the owner's decisions of 2026-11-19; UX Brief §4–5 does not describe it yet. -->

# Design System: EduGemini

## Overview

**Scope.** Two worlds are live today:

- **The Careful Gradebook** (indigo, Inter, white cards on pale slate) is the live system for every page except sign-in.
- **The Marked Script** (ruled exercise paper, ballpoint blue, the teacher's red) is the direction the app is moving to. It is live on the front page `/` (a marked sample script, a four-stage timeline on the red margin line, the data note and a footer), Terms and Privacy (`/terms`, `/privacy`: a red Draft stamp, a handwritten summary and numbered clauses, sharing the footer in `components/SiteFooter.tsx`), `/signin`, `/signup`, `/classes` (the instructor's list and the student's dashboard), `/notifications`, `/settings/ai` and the class page `/classes/:id` (Overview, Assignments, People), Create class (`/classes/new`) and every assignment screen: the five wizard steps and the edit page of a published assignment. Sign-in and sign-up render through `components/MarkedScriptPage.tsx`, and the front page, Terms, Privacy, classes, class, Notifications and Settings pages call `hooks/use-paper-page.ts`; both add the `paper-page` class to `<body>` while the page is open and removes it on leave; no other page uses it. Its tokens are the `script-*` keys above.

Every rule below belongs to the Gradebook unless it sits under a "Marked Script (sign-in and sign-up pages)" heading. Do not apply Marked Script rules to other pages until they move to it.

**Creative North Star: "The Careful Gradebook"**

A teacher's record, kept with care. Every screen is a page of an orderly gradebook: white sheets on a pale paper background, thin ruled borders, one ink color for anything you can act on, and a status written in words beside every item. Nothing is there to decorate. The work being graded is the only imagery.

The system is quiet so that the moments that matter are easy to see: an AI score waiting for review, a failed upload, an approved grade. Density is moderate. Cards hold one item each, stacked in a single centered column, with generous spacing between them so an instructor working through 150 submissions never loses their place.

Light and dark themes share every role. The dark theme swaps in its own values from `src/index.css` (`.dark`); it drops the raised-card shadow and relies on borders alone.

**Key Characteristics:**

- One accent (Chalk Indigo) for actions, links, and focus; status colors only carry meaning.
- Flat white cards with a 1 px ruled border; shadows only on clickable cards and overlays.
- Status always in words with an icon, never color alone.
- 44 px minimum height on every control.
- One typeface (Inter), weight 600 for hierarchy, no decorative type.

### Marked Script (sign-in and sign-up pages)

**Creative North Star: "The Marked Script"**

Sign in on the page a teacher marks. The whole window, header included, is white exercise paper with faint blue rules every 36 px and one red margin line. Every control and link is written in ballpoint blue; the teacher's red is kept for the marking: a circled "42/50" with a tick, a handwritten note, and a sign-in error. The sheet is white paper in both light and dark themes (owner's decision); the `.paper-page` values win over `.dark`.

Where the direction contract (`.impeccable/surfaces/src-pages-signin-tsx.md`) and the code differ, the code is recorded here: the fonts are Atkinson Hyperlegible and Caveat Brush (not Inter with SVG strokes), the header joins the paper in both themes (it does not follow the dark theme), and the note reads "AI marks it first. The teacher has the final say."

**Key Characteristics:**

- Ruled paper is the page background; the words sit on the rules.
- Two inks: blue for everything you can act on, red only for marking and errors.
- Square-cut controls (2 px corners), 2 px blue outlines, no shadows.
- Atkinson Hyperlegible for text, Caveat Brush only for the teacher's handwriting.
- One drawn signature: the red circle and tick, drawn once by a pen stroke.

## Colors

A cool slate paper palette with a single indigo ink.

### Primary

- **Chalk Indigo** (`primary`): primary buttons, text links, active states, and the focus ring. Darkens to `primary-hover` on hover. In the dark theme it lightens so it stays readable on slate.

### Neutral

- **Paper** (`background`): the page behind everything.
- **Sheet** (`surface`): cards, panels, dialogs, inputs, the header bar.
- **Ruled Line** (`border`): card borders and dividers. Decorative, so it can be faint.
- **Graphite** (`input-border`): outlines of inputs, checkboxes, and secondary buttons. Darker than Ruled Line because it has to identify a control.
- **Soft Slate** (`text`): all primary text. A deep slate rather than pure black.
- **Faded Slate** (`text-muted`): helper text, timestamps, secondary details.

### Status

- **Approved** (`status-approved-*`): green pair for instructor-approved, final grades.
- **Pending** (`status-pending-*`): slate pair for waiting, in progress, or awaiting review.
- **AI** (`status-ai-*`): indigo pair, with a sparkles icon, for an AI-generated result that the instructor has not approved yet.
- **Info** (`status-info-*`): sky pair for neutral information.
- **Error** (`status-error-*`) and **Danger** (`danger`, with `danger-fg` text): red for problems the user must fix and for destructive actions.
- **Overlay** (`overlay`): the backdrop behind dialogs and sheets. It darkens the page in both themes (black at 60% in dark).

The UX brief also defines `status-late` and `status-review` tones; they are not in the code yet.

### Named Rules

**The One Ink Rule.** Chalk Indigo is the only accent. It marks what you can act on (buttons, links, focus) and small signals of progress or something new (the unread dot, the notification count, the stepper bar). Nothing else is indigo.

**The Token-Only Rule.** Components use the token utilities (`bg-surface`, `text-muted`), never literal color values.

**The Not-a-Failure Rule.** A student's submission awaiting review uses the Pending tone, never Error. Red is for something the user must fix.

### Marked Script (sign-in and sign-up pages)

White paper, blue ballpoint, red pen. `.paper-page` re-points the shared tokens (`--primary`, `--text`, `--input-border`, `--focus-ring`, and the error and info pairs), so the shared components take the new ink without a second set of components.

- **Ballpoint Blue** (`script-ink`): buttons, links, input outlines, the focus ring, the caret, the wordmark, and the product sentence. Darkens to `script-ink-hover` on hover; `script-ink-fg` is the button text.
- **Teacher's Red** (`script-margin-red`): the margin line, the circled score and tick, the handwritten note, and every error on the sheet: the alert's outline and text, and a field's outline and message.
- **Exercise Paper** (`script-paper`): the page, the inputs, and the error box.
- **Feint Rule** (`script-rule`): the horizontal rules, and the text-selection highlight.
- **Pencil Black** (`script-text`): headings, labels, and typed text.
- **Faded Ink** (`script-text-muted`): helper text.

**The Two Inks Rule.** Blue is for anything you can act on. Red is the teacher's: it marks, corrects, and draws the margin. It is never a button, a link, or decoration away from the marking.

**The White Sheet Rule.** The paper stays white in the dark theme. The page sets `color-scheme: light` and its own values override `.dark`.

## Typography

**Font:** Inter Variable (self-hosted), falling back to the system UI font.

**Character:** One neutral, highly legible sans used throughout. Hierarchy comes from size and weight 600, not from a second family.

### Hierarchy

- **Display** (600, 28/34 px): the page title, one per page.
- **Title** (600, 20/28 px): section headings, card titles, and the EduGemini wordmark.
- **Body** (400, 16/24 px): body text, feedback, form fields. Never below 16 px on phones.
- **Label** (600, 16/24 px): form labels, button text, emphasized values such as scores.
- **Small** (400, 14/20 px): helper text and timestamps.
- **Micro** (500, 12/16 px): chip labels only.

### Named Rules

**The Weight-Not-Family Rule.** On Careful Gradebook pages, emphasis is weight 600 (500 on chips). No italics for emphasis, no second typeface, no uppercase labels.

### Marked Script (sign-in and sign-up pages)

**Text Font:** Atkinson Hyperlegible, weights 400 and 700 (self-hosted via @fontsource, OFL-1.1), falling back to the system UI font.
**Handwriting Font:** Caveat Brush, weight 400 (self-hosted via @fontsource, OFL-1.1), available as the `font-hand` utility.

**Character:** A face made for legibility, for students reading on phones, beside a brush hand that reads as the teacher's pen. Only two weights of Atkinson are loaded, so anything asking for 600 renders at 700.

- **Display** (`script-display`): the "Sign in" heading, two rows tall.
- **Body** (`script-body`): every line of text, one row (36 px) high so it sits on a rule.
- **Label** (`script-label`): field labels, the button, the wordmark, and links.
- **Hand** (`script-hand`): the teacher's note. The "42/50" in the drawn mark uses the same face at 112 SVG units inside its graphic.

**The Hand-Is-the-Teacher's Rule.** Caveat Brush is used only for what the teacher writes, in Teacher's Red. Never for headings, controls, or product text.

## Layout

A single centered column, at most 1,120 px wide, with a 16 px side gutter and 32 px of top and bottom padding. The header is a full-width white bar (56 px tall) with a bottom border; the wordmark sits left and account actions right.

Vertical rhythm is 16 px between stacked items and cards, 8 px inside small groups, and 24 to 32 px between major sections. Spacing follows Tailwind's 4 px steps.

Dialogs are bottom sheets on phones (rounded top corners only) and become a centered panel up to 560 px wide from the `sm` breakpoint. Everything works at 360 px wide.

### Marked Script (sign-in and sign-up pages)

Everything sits on a 36 px writing row (`script-row`). The rules are phased so the content starts on a row, and each rule sits 30 px into its row, just under the baseline. Gaps are whole or half rows: 18 px (`script-half-row`) between fields, 72 px between the form and the mark when stacked.

The red margin line is 2 px wide, at `max(24px, 50% - 560px + 16px)` from the left: 176 px on a 1,440 px window, 24 px on phones. The sheet is the body's own background, so rules and margin scroll with the words.

The content starts 24 px past the column edge (48 px from `sm`). From `lg`, two columns: the form up to 520 px wide, then 80 px, then the mark and note. Below `lg` the mark drops under the form at half height (108 px instead of 216 px, three rows instead of six). The header content indents 40 px (64 px from `sm`) so it starts past the margin like the page.

## Elevation & Depth

Flat by default. Depth comes from the white Sheet sitting on the Paper background with a 1 px Ruled Line border. Two shadows exist:

- **Raised** (`box-shadow: 0 1px 2px rgb(15 23 42 / 0.06)`): only on cards that are themselves links (class list, enrolled classes). None in the dark theme.
- **Overlay** (`box-shadow: 0 8px 24px rgb(15 23 42 / 0.12)`): dialogs and sheets. Dark theme: `0 8px 24px rgb(0 0 0 / 0.5)`.

### Named Rules

**The Border-Before-Shadow Rule.** Separate surfaces with a border first. A shadow signals "this lifts off the page": a clickable card or an overlay, nothing else.

### Marked Script (sign-in and sign-up pages)

No shadows and no cards. Everything is written on one flat sheet; a 2 px ink outline is the only thing that marks a control. The header has no bar and no border: it is transparent on the paper.

## Shapes

Gently rounded and consistent. Chips use 6 px corners; buttons and inputs use 8 px; cards and dialogs use 12 px; the notification count, the unread dot, and the stepper's progress bar are fully round. Borders are always 1 px, except an input in error, which thickens to 2 px in the danger color.

### Marked Script (sign-in and sign-up pages)

Cut square, like a printed form: inputs, buttons, and the error box use 2 px corners (`rounded.script`) and 2 px outlines. The only curves are the hand-drawn ones: the pen circle and tick, with round caps and joins.

## Components

### Buttons

Plain and dependable, sized for thumbs.

- **Shape:** 8 px corners, at least 44 px tall, 16 px side padding, label in weight 600.
- **Primary:** Chalk Indigo with white text; darker indigo on hover.
- **Secondary:** Sheet background, Graphite outline, Soft Slate text; fills with Ruled Line on hover.
- **Danger:** red with `danger-fg` text, only on the button that confirms a destructive action; slightly faded on hover.
- **Loading:** the label stays visible and a 20 px spinner appears beside it; the button is disabled while busy.
- **Disabled:** 60% opacity.
- **Focus:** the global 2 px Chalk Indigo outline with a 2 px offset.

### Chips

Small status labels that always say what they mean.

- **Style:** tinted background with matching dark text, 6 px corners, 2 px by 8 px padding, Micro text, a 16 px icon before the words.
- **Tones:** Approved (check circle), Pending (loader), Info (info icon).

### Cards / Containers

- **Corner Style:** 12 px.
- **Background:** Sheet.
- **Border:** 1 px Ruled Line; a clickable card darkens its border to Graphite on hover.
- **Shadow Strategy:** none, or Raised for a card that is a link (see Elevation & Depth).
- **Internal Padding:** 16 px; 24 px for empty states and dialogs.

### Inputs / Fields

- **Style:** Sheet background, 1 px Graphite outline, 8 px corners, 44 px tall, 12 px side padding.
- **Label:** always visible above the field, weight 600. Helper text below in Small, Faded Slate.
- **Error:** the outline becomes 2 px danger red, and the message appears below, tied to the field.
- **Focus:** the global 2 px focus outline.
- **Checkboxes and radios:** 20 px boxes, but the whole row is the label, at least 44 px tall, so the row toggles the control.

### Navigation

One sticky header bar on every page (`components/Layout.tsx`), 72 px tall with a 1 px border below, its layout taken from taste-skill's nav rules (2026-11-19):

- **Left:** the mark (an E in a hand-drawn pen ring, Teacher's Red on paper pages, the accent elsewhere) and the EduGemini wordmark, linking home.
- **Main words** (signed in): Classes, Notifications, and Settings for instructors. Plain nouns at 15 px, weight 700, never wrapping, in Faded Slate. The current page (`aria-current="page"`, from `NavLink`) is in the accent with a 2 px bar 4 px under the word; another word darkens and draws a 1 px line left to right on hover, fine pointers only (`.nav-word`). The unread count is circled by hand beside "Notifications" (`.unread-count`); the link's name carries the number.
- **Notifications sheet** (`NotificationsMenu.tsx`, `.notif-sheet`): resting the pointer on "Notifications" for 150 ms, or focusing it, drops a 420 px ruled sheet 20 px under the word (6 px drop, 200 ms fade). It holds the five newest: a red dot in the margin and a bold title for unread, the class on the next line, the relative time in the hand on the right; "N new" and Mark all read at the top, See all notifications at the foot, and its own loading, empty ("All caught up") and error states. The pointer can travel into it; leaving closes it after 120 ms; Escape closes it anywhere. The word still opens the page, and phones keep the plain word in the menu. Flat: a 1 px ink edge, no shadow.
- **Right:** the user's name in Small, Faded Slate, a 1 px divider, and Sign out as a plain underlined word (a spinner while it works). Signed out, the right side is a Sign in link.
- **Under 640 px:** the words and the account move into a full-screen menu behind a Menu button (`aria-expanded`): 56 px rows with a rule under each (`.menu-row`), the current page underlined, "Signed in as …", and Sign out. Escape or any navigation closes it.

### Marked Script (sign-in and sign-up pages)

The same shared components (`TextField`, `Button`, `Alert`, `Layout`), restyled by `.paper-page` through tokens and a few scoped rules.

- **Header:** no bar, no border; the wordmark is Ballpoint Blue, weight 700, indented past the margin. Links stay blue and underlined.
- **Inputs:** label on its own 36 px line, then a 54 px box (1.5 rows) on Exercise Paper with a 2 px Ballpoint Blue outline and 2 px corners. Focus is the global 2 px outline in Ballpoint Blue. In error, both themes show a 2 px Teacher's Red outline and the field message below in Teacher's Red, with an icon (`.paper-page` points `--danger` and `--status-error-fg` at it).
- **Forms (Create class, the wizard, a published assignment's page):** the same inputs, plus a drop-down (54 px, 2 px outline, an ink arrow) and a text area (a whole number of rows plus half, 7 px of air above and below). A note under a box (helper or error) starts one row below it and is followed by 18 px of padding, so every label, helper and heading sits on a ruled line; two short fields share a row on wide screens. Typed text is Pencil Black.
- **Stepper (`Stepper.tsx`):** "Step 2 of 5: Criteria" on a line of its own, then every step down the right column, one row each: a red tick for a finished step, the current number circled by hand in Teacher's Red, the rest in pencil; on phones a row of numbers above the form (the names stay for screen readers).
- **Review (wizard step 5):** each answer written on the lines: the label in Ballpoint Blue on the left, the value on the right, no box.
- **Button:** full-width, 54 px, Ballpoint Blue with white text, 2 px corners; darker blue on hover. Loading keeps the label and adds the spinner, as elsewhere.
- **Sign-in error (Alert):** the teacher's correction. Exercise Paper background, 2 px Teacher's Red outline, red text and icon, 2 px corners, on the 36 px line height. Not a tinted box.
- **Text link:** Ballpoint Blue, bold, underlined with a 4 px offset.

### Teacher's Mark (signature, sign-in and sign-up pages)

A red "42/50" in Caveat Brush, tilted -5°, circled by a pen stroke with a tick beside it, all in Teacher's Red with a 5-unit round-capped stroke. Decorative (`aria-hidden`); the note and sentence beside it say the same thing in words. On first load the circle draws in 700 ms on `cubic-bezier(0.16, 1, 0.3, 1)` and the tick follows 450 ms later. The resting state is fully drawn, so reduced motion shows it complete.

## Do's and Don'ts

### Do:

- **Do** write every status in words with an icon beside it.
- **Do** keep every interactive control at least 44 px tall.
- **Do** keep the 2 px focus outline with a 2 px offset; never remove it.
- **Do** keep the label visible while a button is loading.
- **Do** turn off all animation under `prefers-reduced-motion`; progress text stays.
- **Do** check new color pairs for contrast in both themes with the script in UX Brief Appendix A.

### Don't:

- **Don't** use color alone to show a state.
- **Don't** add heavy shadows or glows; a border and, at most, the Raised shadow. On Careful Gradebook pages, no gradients either.
- **Don't** add stock photos. On Careful Gradebook pages, no decorative illustration: the user's uploaded files are the only imagery.
- **Don't** use emoji or exclamation marks in product copy.
- **Don't** use a second accent color on Careful Gradebook pages, or use indigo for decoration.

### Marked Script (sign-in and sign-up pages)

- **Do** keep every line of text on the 36 px row, and gaps in whole or half rows.
- **Do** keep the sheet white in both themes.
- **Do** keep red for the teacher's marking and errors, and blue for every control and link.
- **Do** keep the pen strokes resting fully drawn, so reduced motion shows them complete.
- **Don't** put the Marked Script on other pages piecemeal; a page moves to it whole.
- **Don't** add shadows, cards, or tinted boxes on the paper.
- **Don't** use Caveat Brush for anything the teacher would not write by hand.

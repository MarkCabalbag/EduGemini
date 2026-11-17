---
name: EduGemini
description: Calm, careful web app for AI-assisted first-pass grading with instructor approval.
colors:
  primary: "#4f46e5"
  primary-hover: "#4338ca"
  primary-fg: "#ffffff"
  background: "#f8fafc"
  surface: "#ffffff"
  border: "#e2e8f0"
  input-border: "#64748b"
  text: "#0f172a"
  text-muted: "#475569"
  danger: "#b91c1c"
  danger-fg: "#ffffff"
  overlay: "rgb(15 23 42 / 0.4)"
  status-approved-bg: "#dcfce7"
  status-approved-fg: "#166534"
  status-pending-bg: "#f1f5f9"
  status-pending-fg: "#334155"
  status-ai-bg: "#eef2ff"
  status-ai-fg: "#3730a3"
  status-info-bg: "#e0f2fe"
  status-info-fg: "#075985"
  status-error-bg: "#fee2e2"
  status-error-fg: "#991b1b"
typography:
  display:
    fontFamily: "Inter Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: "2.125rem"
  title:
    fontFamily: "Inter Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.75rem"
  body:
    fontFamily: "Inter Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  label:
    fontFamily: "Inter Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
  small:
    fontFamily: "Inter Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  micro:
    fontFamily: "Inter Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-fg}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.border}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.danger-fg}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  chip-approved:
    backgroundColor: "{colors.status-approved-bg}"
    textColor: "{colors.status-approved-fg}"
    typography: "{typography.micro}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  chip-pending:
    backgroundColor: "{colors.status-pending-bg}"
    textColor: "{colors.status-pending-fg}"
    typography: "{typography.micro}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  chip-info:
    backgroundColor: "{colors.status-info-bg}"
    textColor: "{colors.status-info-fg}"
    typography: "{typography.micro}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

<!-- Recorded from src/index.css and src/components on 2026-11-16. UX Brief §4–5 (docs/ux-brief.md) owns the design decisions; src/index.css holds the live values, including the dark theme. If this file disagrees with either, fix this file. -->

# Design System: EduGemini

## Overview

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
**The Weight-Not-Family Rule.** Emphasis is weight 600 (500 on chips). No italics for emphasis, no second typeface, no uppercase labels.

## Layout

A single centered column, at most 1,120 px wide, with a 16 px side gutter and 32 px of top and bottom padding. The header is a full-width white bar (56 px tall) with a bottom border; the wordmark sits left and account actions right.

Vertical rhythm is 16 px between stacked items and cards, 8 px inside small groups, and 24 to 32 px between major sections. Spacing follows Tailwind's 4 px steps.

Dialogs are bottom sheets on phones (rounded top corners only) and become a centered panel up to 560 px wide from the `sm` breakpoint. Everything works at 360 px wide.

## Elevation & Depth

Flat by default. Depth comes from the white Sheet sitting on the Paper background with a 1 px Ruled Line border. Two shadows exist:

- **Raised** (`box-shadow: 0 1px 2px rgb(15 23 42 / 0.06)`): only on cards that are themselves links (class list, enrolled classes). None in the dark theme.
- **Overlay** (`box-shadow: 0 8px 24px rgb(15 23 42 / 0.12)`): dialogs and sheets. Dark theme: `0 8px 24px rgb(0 0 0 / 0.5)`.

### Named Rules
**The Border-Before-Shadow Rule.** Separate surfaces with a border first. A shadow signals "this lifts off the page": a clickable card or an overlay, nothing else.

## Shapes

Gently rounded and consistent. Chips use 6 px corners; buttons and inputs use 8 px; cards and dialogs use 12 px; the notification count, the unread dot, and the stepper's progress bar are fully round. Borders are always 1 px, except an input in error, which thickens to 2 px in the danger color.

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
A single header bar: the EduGemini wordmark (Title size, weight 600) links home. Text links are Chalk Indigo, weight 600, and underlined. The user's name shows in Small, Faded Slate from the `sm` breakpoint up. Sign out is a secondary button.

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
- **Don't** add heavy shadows, gradients, or glows; a border and, at most, the Raised shadow.
- **Don't** add stock photos or decorative illustration. The user's uploaded files are the only imagery.
- **Don't** use emoji or exclamation marks in product copy.
- **Don't** use a second accent color, or use indigo for decoration.

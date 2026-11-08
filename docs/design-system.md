# Faylo — Design System Direction v0.2.1

**Status:** Approved product-owner clarification (2026-11-08). This document clarifies, and supersedes, the earlier "dark forest green everywhere" interpretation. Financial/business requirements remain unchanged.

## Visual identity

**Black-first, green-accented.** Use the existing Momentum app screenshot supplied by the product owner as a *layout/color hierarchy reference*, not an instruction to copy Momentum's functionality or lime-green hue. Faylo should feel like a modern, calm, premium finance workspace: clean black canvas, neutral charcoal cards, off-white text, and disciplined forest/mint-green interactive accents.

### Color tokens (suggested starting values, adjust minimally for contrast)
| Role | Preferred color | Rule |
|---|---|---|
| Main application canvas | `#0B0B0C` | Predominantly black; do not tint the entire page green |
| Sidebar/header/bottom navigation | `#0F0F10` | Black/neutral, subtle differentiation from canvas |
| Card surface | `#171717` | Neutral charcoal for metrics and content |
| Elevated/hover surface | `#202020` | Neutral |
| Dividers/borders | `#292929` | Low-contrast neutral, not green outlines on every card |
| Primary text | `#F1F3F2` | Off-white |
| Muted text | `#A3AAA6` | Accessible neutral grey |
| Forest accent | `#174A39` | Selected nav background, intentional accent treatments |
| Mint accent | `#80C7A2` | Active icons, action highlights, progress bars, focus rings, select status accents |

### Practical rules
- Keep ~85–90% of the visible page black/neutral; green is an accent, **not** the canvas or default card background.
- Change the hero/setup banner from full-width green gradient to a neutral charcoal/black panel with a restrained green accent (icon, left edge, short accent bar, or focused CTA).
- Selected navigation may use muted forest-green background and mint icon/text, but inactive navigation must stay neutral.
- Reserve vivid green for key actions and indicators. Do not paint every border, card, caption, badge, or decorative circle green.
- Don't invent financial data just to make the dashboard look full. Keep all placeholders explicitly labeled until implemented.
- Accessibility: focus states, color contrast, disabled appearance, semantic positive/negative values, phone navigation and reduced-motion should remain usable.
- Retain existing responsive shell and core layout where practical; the revision is a design-system/color hierarchy correction, not a complete redesign.
- Review screenshots at 390px phone and 1440px desktop before merging. The black background / neutral cards hierarchy must be obvious at both sizes.

## Taste skill

Taste Skill is the public [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) project. Its README documents this installation command from the development workspace:

```bash
npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"
```

Install it for the agent actually running OMP (OpenCode, if offered by the installer), then restart/refresh the agent session and verify it can read the installed skill instructions. The installer may need Node 22+ and Chrome/Chromium for its checks. Don't blindly execute scripts or introduce heavy shader/landing-page effects into a personal finance dashboard; the user-approved app UX and performance constraints have priority.

If skill installation or discovery fails in the OMP environment, explicitly report the blocker; do not pretend it was used.

## Example acceptance check

Looking at the app alongside Momentum, both should have a visually black workspace with neutral dark card surfaces. Faylo differs by a dark forest/mint accent (not Momentum's lime). The first impression should be **black, with green details**, never **dark green everywhere**.

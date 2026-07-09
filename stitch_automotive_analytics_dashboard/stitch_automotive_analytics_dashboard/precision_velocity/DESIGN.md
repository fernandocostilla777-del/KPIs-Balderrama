---
name: Precision Velocity
colors:
  surface: '#051424'
  surface-dim: '#051424'
  surface-bright: '#2c3a4c'
  surface-container-lowest: '#010f1f'
  surface-container-low: '#0d1c2d'
  surface-container: '#122131'
  surface-container-high: '#1c2b3c'
  surface-container-highest: '#273647'
  on-surface: '#d4e4fa'
  on-surface-variant: '#c6c6cd'
  inverse-surface: '#d4e4fa'
  inverse-on-surface: '#233143'
  outline: '#909097'
  outline-variant: '#45464d'
  surface-tint: '#bec6e0'
  primary: '#bec6e0'
  on-primary: '#283044'
  primary-container: '#0f172a'
  on-primary-container: '#798098'
  inverse-primary: '#565e74'
  secondary: '#7bd0ff'
  on-secondary: '#00354a'
  secondary-container: '#00a6e0'
  on-secondary-container: '#00374d'
  tertiary: '#ffafd3'
  on-tertiary: '#620040'
  tertiary-container: '#360021'
  on-tertiary-container: '#cf5497'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#c4e7ff'
  secondary-fixed-dim: '#7bd0ff'
  on-secondary-fixed: '#001e2c'
  on-secondary-fixed-variant: '#004c69'
  tertiary-fixed: '#ffd8e7'
  tertiary-fixed-dim: '#ffafd3'
  on-tertiary-fixed: '#3d0026'
  on-tertiary-fixed-variant: '#85145a'
  background: '#051424'
  on-background: '#d4e4fa'
  surface-variant: '#273647'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.08em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 0.25rem
  sm: 0.5rem
  md: 1rem
  lg: 1.5rem
  xl: 2.5rem
  gutter: 1.5rem
  margin-edge: 2rem
  sidebar-width: 260px
---

## Brand & Style
The design system is engineered for the high-stakes automotive intelligence sector, where split-second data interpretation and long-term trend analysis intersect. The brand personality is authoritative, precise, and technologically advanced, evoking the feeling of a high-end vehicle cockpit: controlled, ergonomic, and high-performance.

The style is **Corporate / Modern** with a strong emphasis on **Minimalism** to reduce cognitive load. It prioritizes clarity over decoration, using subtle tonal shifts to separate complex data sets. The interface should feel "expensive" through its restraint—wide margins, crisp lines, and a deliberate absence of unnecessary gradients or shadows. The goal is to instill confidence in stakeholders through a UI that feels as reliable as the machinery it monitors.

## Colors
The color palette uses a **dark-mode default** to reduce eye strain for analysts and to allow data visualizations to "pop" against a deep background. 

- **Primary:** Deep Slate (#0F172A) serves as the foundation for the background and deep navigation layers.
- **Surface:** Lighter slate tones (#1E293B) define cards and active containers.
- **Accents:** High-contrast Teal (#2DD4BF), Coral (#FB7185), and Amber (#FBBF24) are reserved strictly for data visualization, status indicators, and critical alerts. 
- **Neutral:** A range of blues and grays ensure that text remains highly legible without the harshness of pure white.

Information density is managed by using desaturated colors for structural elements and highly saturated colors only for meaningful data points.

## Typography
Typography in this design system is built for legibility and technical precision. **Inter** is the workhorse for all interface elements and narrative text, chosen for its neutral tone and exceptional performance at small sizes. 

**JetBrains Mono** is introduced for labels, data tables, and telemetry readouts. This monospaced font ensures that numerical values remain vertically aligned in tables and dashboards, facilitating easier comparison of figures at a glance.

All headings use tight letter-spacing for a modern, compact look, while labels use expanded letter-spacing in all-caps to denote secondary metadata or structural categories.

## Layout & Spacing
This design system utilizes a **Fixed Grid** model for the main dashboard area to ensure complex charts maintain their intended aspect ratios across different monitor sizes. 

- **Desktop (1440px+):** A 12-column grid with a fixed 260px sidebar. Content is housed within 24px (lg) margins and 24px gutters.
- **Tablet:** The sidebar collapses into a 64px icon-only bar. The grid shifts to 8 columns.
- **Mobile:** A single-column vertical flow with 16px (md) margins. Complex charts should transform into simplified summary sparks or horizontally scrollable containers.

The spacing rhythm is based on a **4px baseline grid**, ensuring all components—from small status badges to large data containers—align perfectly to a consistent visual beat.

## Elevation & Depth
In this design system, depth is communicated through **Tonal Layers** and **Low-Contrast Outlines** rather than traditional shadows. This keeps the interface feeling "flat" and data-centric.

1. **Floor:** The darkest shade (#0F172A), used for the background.
2. **Surface:** A slightly lighter shade (#1E293B) for primary widgets and cards.
3. **Elevated:** Elements like dropdowns or tooltips use a third tier (#334155) with a subtle 1px border (#475569) to separate them from the surface.

Shadows, if used at all, are "Sharp Ambient Shadows"—extremely low blur (2px to 4px), low opacity (15%), and perfectly vertical, simulating a light source directly above the screen.

## Shapes
The shape language is **Soft (Level 1)**. This uses a 4px (0.25rem) radius for standard components like buttons, input fields, and status badges. Larger containers and cards use an 8px (0.5rem) radius.

This subtle rounding breaks the clinical coldness of a 0px radius while maintaining the "serious" and "engineered" aesthetic required for a professional automotive tool. It mirrors the precision-machined edges of engine components—not sharp enough to cut, but distinctly geometric and intentional.

## Components
- **Data Cards:** Every card must have a 1px border (#334155) and a standard header height of 48px. Titles are left-aligned in `label-md` uppercase.
- **Side Navigation:** Uses a semi-transparent overlay when collapsed. Active states are indicated by a 2px vertical "Teal" line on the far left and a subtle background tint.
- **Buttons:** Primary buttons are Solid Teal (#2DD4BF) with black text for maximum contrast. Secondary buttons use an outline style with #94A3B8 borders.
- **Complex Charts:** Must use the designated visualization palette. Grid lines within charts should be at 10% opacity white. Hover states on data points must trigger a tooltip in the "Elevated" tonal layer.
- **Status Indicators:** Small 8px circles. "Running" is Teal, "Maintenance" is Amber, "Alert" is Coral. These should always be accompanied by a text label for accessibility.
- **Input Fields:** Darker than the card surface (#0F172A), with a subtle 1px border. Focus state is a 1px Teal glow.
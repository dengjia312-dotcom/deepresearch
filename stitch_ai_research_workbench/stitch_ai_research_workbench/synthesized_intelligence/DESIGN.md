---
name: Synthesized Intelligence
colors:
  surface: '#faf8ff'
  surface-dim: '#d9d9e5'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3fe'
  surface-container: '#ededf9'
  surface-container-high: '#e7e7f3'
  surface-container-highest: '#e1e2ed'
  on-surface: '#191b23'
  on-surface-variant: '#434655'
  inverse-surface: '#2e3039'
  inverse-on-surface: '#f0f0fb'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#943700'
  on-tertiary: '#ffffff'
  tertiary-container: '#bc4800'
  on-tertiary-container: '#ffede6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#ffdbcd'
  tertiary-fixed-dim: '#ffb596'
  on-tertiary-fixed: '#360f00'
  on-tertiary-fixed-variant: '#7d2d00'
  background: '#faf8ff'
  on-background: '#191b23'
  surface-variant: '#e1e2ed'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.03em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  sidebar_width: 260px
  topbar_height: 56px
  gutter: 16px
  container_padding: 24px
  stack_gap_sm: 8px
  stack_gap_md: 16px
---

## Brand & Style
The design system is engineered for high-velocity AI research and collaborative knowledge management. It prioritizes **clarity, traceability, and information density** to help users navigate complex datasets and generative AI outputs without cognitive fatigue.

The style is **Corporate Modern with Minimalist influences**, drawing inspiration from the structured efficiency of professional productivity suites. It utilizes heavy whitespace as a functional tool rather than just an aesthetic choice, ensuring that multi-pane workflows remain legible. The interface remains "invisible" to keep the focus on user-generated content and AI-synthesized insights.

## Colors
The palette is restrained to maintain a professional, academic atmosphere. 
- **Primary Blue (#2563EB)** is used sparingly for primary actions, focus states, and signifying AI-active components.
- **Surface & Background** colors use a subtle distinction between `#FFFFFF` for active workspace cards and `#F8FAFC` for the application canvas to create soft depth.
- **Semantic Colors** (Success, Warning, Error) should follow standard functional patterns but use desaturated tones to avoid clashing with the primary blue.

## Typography
The system uses **Inter** for its exceptional legibility in data-dense environments. For Chinese characters, **PingFang SC** is the preferred fallback to maintain a clean, modern aesthetic. 

- **Hierarchy:** Use `headline-md` for card titles and section headers to maintain a compact layout.
- **Reading:** `body-lg` is reserved for long-form AI responses and research notes to maximize readability. 
- **Metadata:** Use `label-sm` in uppercase for status tags, timestamps, and source citations to distinguish them from actionable text.

## Layout & Spacing
The layout follows a **Fixed-Sidebar / Fluid-Content** model designed for widescreen productivity.

- **Sidebar:** A fixed 260px left sidebar handles global navigation and workspace switching.
- **Top Bar:** A 56px status bar contains breadcrumbs, global search, and user settings.
- **Workspace Canvas:** Content is organized into a fluid grid. In research views, use a split-pane layout (60% reading/writing, 40% AI assistant/sources).
- **Density:** Use a base 4px/8px scaling system. For data tables and lists, use compact 8px vertical padding to increase information density.

## Elevation & Depth
This design system uses **Tonal Layering** supplemented by **Minimal Ambient Shadows** to define hierarchy.

- **Level 0 (Background):** `#F8FAFC` - The main application staging area.
- **Level 1 (Cards/Sidebar):** `#FFFFFF` - White surfaces with a 1px border of `#E2E8F0`. 
- **Level 2 (Active/Floating):** Surfaces use a soft shadow `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` to indicate interactivity or temporary overlay (e.g., dropdowns, hover states).
- **Interactions:** On hover, cards should transition from a static 1px border to a subtle shadow rather than changing color.

## Shapes
A **Rounded (8px-12px)** shape language is applied across the system to soften the technical nature of the product.

- **Standard Elements (Buttons, Inputs, Small Cards):** Use 8px (`rounded-md`).
- **Containers (Main Content Cards, Modals):** Use 12px (`rounded-lg`).
- **Search Bars:** Use pill-shaped (100px) rounding to distinguish global search from standard form inputs.

## Components
- **Buttons:** Primary buttons use `#2563EB` with white text. Secondary buttons use a transparent background with a `#E2E8F0` border.
- **Cards:** The primary container for information. Cards must include a header area with a title and optional "Source" icon.
- **Chips/Tags:** Used for "Traceability" (e.g., AI source citations). These should be small, use `label-sm`, and have a subtle `#F1F5F9` background.
- **Input Fields:** Minimalist style with a 1px border. Focus state uses a 2px primary blue outer ring with 0% offset.
- **AI Response Block:** A specialized component with a very faint blue tint (`#EFF6FF`) and a left-accent border of 2px Primary Blue to distinguish AI-generated content from human notes.
- **Sidebar Navigation:** Active states use a ghost-style background (`#F1F5F9`) and a 2px vertical blue indicator on the far left.
# Design System: The Precision Lens

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Precision Lens."** 

This system moves away from the generic, bubbly SaaS aesthetic and leans into the sophisticated, high-density environment of advanced developer tools and professional creative software. We aim for a "Technical Editorial" look—where the utility of a dashboard meets the refined layout of a premium digital journal. 

We break the "template" look through **intentional asymmetry** and **kinetic layering**. Expect to see overlapping panels, high-contrast typography scales, and a focus on "optical focus"—where the most critical AI-driven insights are framed with cinematic clarity while secondary controls recede into the technical atmosphere of the slate background.

---

## 2. Colors & Surface Philosophy

The palette is anchored in deep, atmospheric slates and charcoals, punctuated by a high-energy electric blue.

*   **Primary Accent (`#b4c5ff` / `#0052d9`):** This is your "Action Glow." Use the lighter `primary` for text links and icons on dark backgrounds, and the deeper `primary_container` for large interaction surfaces.
*   **The "No-Line" Rule:** We do not use 1px solid borders to define sections. Layout boundaries must be created through background color shifts. A `surface-container-low` section should sit adjacent to a `surface` background to create a logical break. 
*   **Surface Hierarchy & Nesting:** Treat the UI as a series of physical layers. 
    *   **Level 0 (Base):** `surface` (`#0c1322`)
    *   **Level 1 (Navigation/Sidebar):** `surface-container-low` (`#141b2b`)
    *   **Level 2 (Main Workspace):** `surface-container` (`#191f2f`)
    *   **Level 3 (Floating Modals/Tooltips):** `surface-container-highest` (`#2e3545`)
*   **Signature Textures:** For high-priority AI progress bars or primary CTAs, use a subtle linear gradient transitioning from `primary` to `primary_container`. This adds a "lithographic" depth that flat hex codes cannot achieve.

---

## 3. Typography

We utilize **Inter** across the board, but we treat it with editorial intent.

*   **Display & Headlines:** Use `display-md` (2.75rem) for high-level AI insights or hero stats. Keep letter-spacing tight (-0.02em) to create a "dense," professional feel.
*   **The Technical Label:** Use `label-md` (0.75rem) in all-caps with increased letter-spacing (+0.05em) for secondary metadata, breadcrumbs, or "System Status" indicators.
*   **Hierarchy via Contrast:** Pair a `headline-sm` in `on-surface` (white/gray) with a `body-sm` in `on-surface-variant` (muted gray) to create a clear separation between "What the AI found" and "System details."

---

## 4. Elevation & Depth

We eschew traditional material shadows in favor of **Tonal Layering** and **Atmospheric Refraction**.

*   **The Layering Principle:** Depth is achieved by stacking. A `surface-container-lowest` card placed on a `surface-container` background creates a "inset" look, perfect for data input areas.
*   **Ambient Shadows:** For floating elements (like heatmap control panels), use a large, 24px blur shadow with only 6% opacity. The shadow color must be tinted with the background hue (`#070e1d`) rather than pure black to maintain color harmony.
*   **The Ghost Border:** If a border is required for accessibility (e.g., a "Drop Zone"), use the `outline-variant` token at **20% opacity**. This creates a "whisper" of a boundary that guides the eye without cluttering the technical interface.
*   **Glassmorphism:** Use `surface-bright` with a `backdrop-filter: blur(12px)` for overlay controls. This allows the heatmap data to bleed through the controls, making the UI feel integrated into the visualization rather than sitting on top of it.

---

## 5. Components

### Buttons
*   **Primary:** High-contrast `primary` background with `on-primary` text. No border. 4px (`md`) corner radius.
*   **Tertiary/Ghost:** No background or border. Use `primary` text. On hover, apply a `surface-variant` background at 30% opacity.

### Drop Zones (File Upload)
Forbid standard boxes. Use a `surface-container-low` background with a **Ghost Border** (dashed). When a file is hovered, transition the background to `primary_container` at 10% opacity to "electrify" the zone.

### Heatmap Dashboard Controls
These should feel like "HUD" (Heads-Up Display) elements. Use semi-transparent `surface-container-highest` containers with `label-sm` typography. 

### Input Fields
*   **Style:** Minimalist. No bottom line or full box. Use a subtle `surface-container-high` background. 
*   **Active State:** The only time a high-contrast border appears is during `focus`, using the `primary` token at 1px.

### Cards & Lists
**Forbid the use of divider lines.** Use 24px or 32px of vertical white space to separate list items. If items must be grouped, use a subtle background shift to `surface-container-low`.

---

## 6. Do’s and Don’ts

### Do:
*   **Do** use intentional asymmetry. Align a headline to the left and a technical stat to the far right to create a "spread" layout.
*   **Do** use `primary_fixed_dim` for icons to ensure they feel part of the tech stack, not just "colorful."
*   **Do** prioritize "Breathing Room." High-density data requires significant negative space (32px+) between modules to remain readable.

### Don’t:
*   **Don’t** use 100% opaque, high-contrast borders. They "trap" the data and make the tool feel like a legacy spreadsheet.
*   **Don’t** use pure black (`#000000`) for backgrounds. Use the `surface` token (`#0c1322`) to maintain tonal depth.
*   **Don’t** use standard "drop shadows." If it doesn't float with a tinted ambient glow, it shouldn't have a shadow.
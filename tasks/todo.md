# UI/UX batch — sidebar reorg, bigger inputs, keyboard shortcuts, per-rail base, toolbar

Decisions: per-rail = per-side extents (4) + per-corner radius (N>4). Toolbar = adapt to our
stack (no framer-motion/shadcn).

## Plan (phase-by-phase, verify each)

### Phase A — Bigger numeric fields (#2)
- [ ] SelectionInspector Row3 + Angle → boxed, taller inputs (border, padding, bigger hit target),
      Orca-style label · [value] · unit. Keep unit-aware m/mm.

### Phase B — Keyboard shortcuts (#4)
- [ ] Global keydown in App (ignore when typing in inputs): Delete/Backspace → delete selected,
      Ctrl/Cmd+C copy, Ctrl/Cmd+V paste (duplicate at offset), Ctrl/Cmd+D duplicate, F frame,
      Esc deselect. Route to existing delete/duplicate handlers per selection kind.

### Phase C — Sidebar reorg into 3 cards (#1, #5, final note)
- [ ] Reorder UnifiedSidebar: Selection (top) · Camera Feeds · Controls(toolbar). ER/Overlays below.
- [ ] Selection card visually distinct ("its own thing" on top of feeds).

### Phase D — Controls → toolbar (#5)
- [ ] New components/ui/Toolbar.tsx (adapted: horizontal pill, icon buttons, hover tooltips, CSS
      transitions, glass theme — no framer-motion). Render the existing control actions through it.

### Phase E — Per-rail base editing (#3) [heaviest]
- [ ] WorkcellConfig: sideExtents?: [right,left,front,back] (4-sided) + cornerRadii?: number[] (N>4),
      per primary + stations.
- [ ] BaseBuilder: build slab + rails from explicit vertices when present; keep regular fallback.
- [ ] SelectionInspector: 4 named extent sliders (4-sided) or N corner-radius sliders (N>4).

## Review
All 5 shipped + verified in-browser, tsc+build+vitest+smoke green:
- A bigger boxed inputs; B keyboard (Delete/Ctrl+D/Ctrl+C·V/Esc/F); C Selection-on-top reorder;
  D Controls→pill toolbar (components/ui/toolbar.tsx, no framer-motion); E per-rail base
  (sideExtents for 4-sided, cornerRadii for N>4) on primary + stations, with per-side sliders.
Commits: 542ddb8 (A-D), + Phase E.

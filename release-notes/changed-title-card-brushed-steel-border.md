---
title: 'Give media cards a two-pixel brushed-steel frame'
category: 'Changed'
---

Media poster and primary content cards now use a lightweight CSS-rendered
brushed-steel gradient for a more visible two-pixel frame. Subcards use the
same silver gradient with the same slimmer one-pixel frame as inset cards,
and posters embedded in detail, request, status, Blocklist, and Issue cards use
the one-pixel treatment as well. Browse and shelf posters retain their stronger
two-pixel frame, preserving the existing card layouts and controls without
downloading a large border image.

Poster, main, subcard, and inset roles now use the explicit `app-card-poster`,
`app-card-main`, `app-card-sub`, and `app-card-inset` classes. Their visual
treatment is centralized in the shared stylesheet for consistent future card
changes, including consistent poster hover styling and stacking above card
lists without clipping. Posters use a real transparent border with layered
backgrounds, while translucent content cards use perimeter-only CSS edge strips
instead of a full-card gradient or antialiased mask. The metallic treatment
therefore stays inside the one- and two-pixel edges without bleeding through the
card body.

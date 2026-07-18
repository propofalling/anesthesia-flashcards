# TrueLearn ITE Flashcards

A static, installable flashcard web app (PWA) for ABA ITE anesthesiology study,
with spaced repetition (SM-2), subdecks by topic, and full-text search.

- **Cards** are generated from study notes by the pipeline in `../flashcard_pipeline`
  and exported to `data/cards.json` by `export_app_data.py`.
- **Hosting:** served as a static site on GitHub Pages.
- **Updates:** the daily pipeline runs `publish_app.sh`, which regenerates
  `data/cards.json` and pushes it here, so the live app stays current.

Study progress is stored per-device in the browser (Phase 3 will add cross-device sync).

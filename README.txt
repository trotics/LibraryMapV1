Library Web Schematic (Static)
==============================
Files:
  - index.html, app.js, styles.css (static web app)
  - books.csv, clusters.csv, institutions.csv, periods.csv, edges.csv
  - reading_paths.csv, path_steps.csv, audit_log.csv

How to run locally:
  1) Open a terminal in this folder.
  2) Run: python -m http.server 8000
  3) Visit: http://localhost:8000

Notes:
  - All book tags are AI-provisional: status=review, provenance=ai.
  - Revise by editing books.csv (and optionally clusters.csv/institutions.csv/periods.csv).
  - edges.csv is empty by default; you can add explicit cross-links later.


Version 1.0
- Legend added
- UI polish (hover, spacing, clarity)
- Core feature set complete

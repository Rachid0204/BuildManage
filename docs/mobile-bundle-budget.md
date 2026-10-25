# A4: mobile bundle boundaries and budgets

Role authorization and identity gates remain eager. AdminDashboard (AdminPortal),
ResidentDashboard, SyndicPortal, and PrestatairePortal load through React.lazy only
when their protected route renders. The extracted portal logic is unchanged.
A bilingual, reduced-motion-aware viewport skeleton reserves space during loading;
the existing error boundary supplies a reload action if a chunk cannot load.

UI export actions use pdfOnDemand. The original synchronous PDF renderer, embedded
fonts, receipt numbering and formatting are unchanged. Rendering dependencies are
fetched on export/preview, with a bilingual failure notification. Generated preview
URLs are revoked on replacement/close, including late asynchronous completions.
Credential-sharing audit actions wait for successful PDF generation.

firebase/config.ts initializes App and Auth only. The unused startup Firestore probe
and Storage initialization are removed. Legacy client data access remains compatible
in a deferred adapter; normal browser operations continue through the server API.
No backend repository, deployment contract, database schema or migration changes.

## Enforced budgets

- Entire initial static JavaScript graph: 250 KiB gzip maximum.
- Entry JavaScript: 100 KiB gzip maximum.
- Vendor/React and Firebase Auth: 120 KiB gzip each.
- PDF vendor: 160 KiB gzip.
- Other/deferred chunks: 200 KiB gzip each.
- No role portal, PDF/font/HTML-rendering code, or Firestore/Functions/Storage SDK in the initial graph.
- Role portals are separate dynamic entries; their static dependency graphs also exclude PDF code.

`npm run build && npm run test:bundle` emits exact byte/gzip measurements and checks
the actual Rollup module/import graph. CI and check:local enforce it. Explicit manual
chunk boundaries prevent shared Vite preload helpers from making the PDF vendor eager.
Budgets use 1 KiB = 1024 bytes; measurements below are bytes (gzipSync defaults).
These are build sizes, not claimed network timings or measured Core Web Vitals.

## Baseline and optimized comparison

Baseline application source is the approved C5 tree d59e125e27aa0d722a58285638a2179010c1e9de.
Only build instrumentation was added before recording the baseline. Its initial
budget run failed 10/10 assertions. An additional role-static-dependency assertion
was added during implementation; the final budget suite passes 11/11.

| Chunk | Description | Before (raw / gzip) | After (raw / gzip) | Gzip reduction |
|---|---|---:|---:|---:|
| Initial JS graph | All statically requested JavaScript | 2,070,300 / 637,418 | 815,681 / 233,926 | 63.30% |
| index.html | HTML document | 1,669 / 658 | 1,671 / 659 | -0.15% |
| index-*.js | Initial entry and shared application chunks | 887,112 / 303,222 | 281,046 / 82,087 | 72.93% |
| vendor-*.js | React/router/query and shared runtime | 93,841 / 30,545 | 305,837 / 96,148 | -214.77% |
| firebase-*.js | Firebase vendor; now Auth only | 687,089 / 171,566 | 217,982 / 52,746 | 69.26% |
| pdf-*.js | PDF vendor; now deferred | 391,442 / 129,139 | 341,497 / 112,229 | 13.09% |

Vendor and entry sizes shift because dependencies move between chunks; use the total initial graph for the comparable delivery reduction. Deferred code is moved off the critical path, not eliminated.

## Baseline: every HTML, JS and CSS output

| File | Raw bytes | Gzip bytes | Initial JS graph |
|---|---:|---:|---|
| `index.html` | 1,669 | 658 | No |
| `assets/Analytics-CHoSBZ2K.js` | 7,860 | 2,719 | No |
| `assets/Announcements-CTh09mp2.js` | 5,822 | 2,390 | No |
| `assets/Apartments-BATT94IL.js` | 28,545 | 7,465 | No |
| `assets/AssembleeGenerale-B0ZEuIV4.js` | 33,708 | 9,457 | No |
| `assets/Buildings-pCIFNsvA.js` | 18,429 | 5,662 | No |
| `assets/CommunityChat-DzSTFc6C.js` | 14,220 | 4,936 | No |
| `assets/Dashboard-Cv7NgjHk.js` | 15,017 | 4,662 | No |
| `assets/Documents-BmvHJnls.js` | 9,338 | 3,369 | No |
| `assets/Financials-B72JjQzg.js` | 101,156 | 24,502 | No |
| `assets/Maintenance-BcM9dv9I.js` | 41,872 | 12,219 | No |
| `assets/MarketplaceView-Ciaufdwn.js` | 45,665 | 13,003 | No |
| `assets/Prestataires-BFm1sQnS.js` | 32,999 | 8,857 | No |
| `assets/ResidentAGVoting-CYnm56Sz.js` | 28,337 | 7,981 | No |
| `assets/Residents-Cytk6KLm.js` | 27,495 | 7,634 | No |
| `assets/ServiceProvidersDirectory-BmImyuo8.js` | 20,829 | 6,798 | No |
| `assets/Settings-DRk2Wcd1.js` | 8,954 | 3,221 | No |
| `assets/charts-DyG5E_2K.js` | 410,934 | 111,483 | No |
| `assets/firebase-BFWyMyIu.js` | 687,089 | 171,566 | Yes |
| `assets/html2canvas.esm-QH1iLAAe.js` | 202,379 | 48,044 | No |
| `assets/icons-DWKaEOzm.js` | 10,816 | 2,946 | Yes |
| `assets/index-8Pvmn8tk.js` | 887,112 | 303,222 | Yes |
| `assets/index-UL2p7cl2.css` | 85,742 | 14,051 | No |
| `assets/index.es-DoOkqn1n.js` | 159,768 | 53,554 | No |
| `assets/pdf-B1osmd6d.js` | 391,442 | 129,139 | Yes |
| `assets/purify.es-CAi2OJFm.js` | 30,469 | 11,726 | No |
| `assets/vendor-DAKuxKMx.js` | 93,841 | 30,545 | Yes |

## Optimized: every HTML, JS and CSS output

| File | Raw bytes | Gzip bytes | Initial JS graph |
|---|---:|---:|---|
| `index.html` | 1,671 | 659 | No |
| `assets/AdminDashboard-CDgUYWYx.js` | 20,763 | 5,607 | No |
| `assets/Analytics-ohotkOYO.js` | 7,892 | 2,729 | No |
| `assets/Announcements-DVUsdJHN.js` | 5,827 | 2,394 | No |
| `assets/Apartments-Dhn-MOnp.js` | 28,588 | 7,487 | No |
| `assets/AssembleeGenerale-DgaHsosw.js` | 33,748 | 9,475 | No |
| `assets/Buildings-B_BRYOl-.js` | 18,435 | 5,665 | No |
| `assets/CameraCaptureModal-COsoTs_P.js` | 7,813 | 3,069 | No |
| `assets/CommunityChat-Xq-uF_A_.js` | 14,219 | 4,934 | No |
| `assets/Dashboard-Bcsj1K9e.js` | 15,075 | 4,692 | No |
| `assets/Documents-BBfmNjzw.js` | 9,870 | 3,667 | No |
| `assets/FinancialTools-UV5pOGQD.js` | 9,460 | 3,668 | No |
| `assets/Financials-Db7NWrcF.js` | 101,252 | 24,546 | No |
| `assets/Maintenance-Ccnr1hlH.js` | 41,918 | 12,235 | No |
| `assets/MarketplaceView-Dxs9-oNu.js` | 45,667 | 13,001 | No |
| `assets/NotificationBell-DpMNVVgt.js` | 3,096 | 1,468 | No |
| `assets/PrestatairePortal-mpT_PhA7.js` | 8,106 | 2,827 | No |
| `assets/Prestataires-DRY9jrHS.js` | 33,058 | 8,885 | No |
| `assets/ResidentAGVoting-tPrrRzl8.js` | 28,376 | 7,998 | No |
| `assets/ResidentDashboard-D0pi1TJt.js` | 60,931 | 16,477 | No |
| `assets/Residents-DiqVWBV6.js` | 27,553 | 7,661 | No |
| `assets/ServiceProvidersDirectory-Bc9rnPCt.js` | 20,831 | 6,799 | No |
| `assets/Settings-3_J9EEPp.js` | 8,956 | 3,220 | No |
| `assets/SyndicPortal-hvxoNZl4.js` | 23,288 | 7,196 | No |
| `assets/charts-CGx-ZbkE.js` | 258,272 | 59,017 | No |
| `assets/firebase-Ba8NyYj_.js` | 217,982 | 52,746 | Yes |
| `assets/html2canvas.esm-QH1iLAAe.js` | 202,379 | 48,044 | No |
| `assets/icons-Bxczn232.js` | 10,816 | 2,945 | Yes |
| `assets/index-B-uRy4Ns.css` | 86,132 | 14,165 | No |
| `assets/index-BXWtuYvb.js` | 3,047 | 1,229 | Yes |
| `assets/index-Bs8uemT5.js` | 48,455 | 16,539 | No |
| `assets/index-C6ViYtQA.js` | 277,999 | 80,858 | Yes |
| `assets/index-DflTLF0l.js` | 153,377 | 51,764 | No |
| `assets/index.es-CtbuzBQK.js` | 159,770 | 53,555 | No |
| `assets/legacyClient-rYjys1U7.js` | 631,440 | 157,255 | No |
| `assets/pdf-DEqdx7_Q.js` | 341,497 | 112,229 | No |
| `assets/pdfOnDemand-CbKorX1m.js` | 1,569 | 777 | No |
| `assets/pdfService-DWJN1V0z.js` | 255,594 | 119,552 | No |
| `assets/purify.es-CAi2OJFm.js` | 30,469 | 11,726 | No |
| `assets/vendor-C-CMwGtg.js` | 305,837 | 96,148 | Yes |

## Verification on the optimized source

- `npm run check:local`: exit 0 (TypeScript, Firestore-rules lint, all business/security/cache/production/recovery suites, Functions compilation and production build).
- Final `npm run typecheck` and `npm run test:bundle`: exit 0; 11 budget assertions passed.
- C1/C2/C3/C4: 13/21/25/21 passed. H2: 18 passed. H3: 9 file-mode + 8 Firestore passed.
- H5: 26 file-mode + 26 Firestore passed. C5: 16 concurrency tests passed.
- Firebase authentication integration: 54 checks passed; Firebase browser registration, verification, reset and recovery passed.
- Standard browser suite: 61 passed, 1 cloud-only skip. Cloud-simulation browser suite: 62 passed, no skips. Both include H1/H6 and six new A4 cases (four portal request-boundary tests and real PDF downloads at 390/1280 px).
- Firestore persistence/concurrency and client-denial integration: passed.
- `git diff --check`: passed.

Cloud coverage uses local Firebase emulators and simulated Storage, not production infrastructure. Repository lint currently covers Firestore rules, not TypeScript/React lint. The PDF renderer itself remains unchanged and the existing canonical receipt formatting tests pass.

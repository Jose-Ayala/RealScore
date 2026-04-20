# RealScore MVP

A browser-only real estate investment decision-support tool. Select a US metro area, enter property details, and instantly see a Deal Score backed by Zillow metro datasets loaded in-browser — no backend, no account required. When available, you can also enter a deal-level Monthly Rent value instead of relying only on the metro rent benchmark.

---

## Table of Contents

1. [How to Run](#how-to-run)
2. [Project Structure](#project-structure)
3. [Data Pipeline](#data-pipeline)
4. [Scoring Engine](#scoring-engine)
   - [Valuation Score (40%)](#valuation-score-40)
   - [Income Score (35%)](#income-score-35)
   - [Risk Score (25%)](#risk-score-25)
   - [Deal Score](#deal-score)
5. [Financial Outputs](#financial-outputs)
   - [Cap Rate](#cap-rate)
   - [Cash-on-Cash Return](#cash-on-cash-return)
   - [IRR Range](#irr-range)
6. [Stress Testing](#stress-testing)
7. [Market Filtering](#market-filtering)
8. [UI Overview](#ui-overview)
9. [PWA Setup](#pwa-setup)
10. [Technology Stack](#technology-stack)

---

## How to Run

Open the project in VS Code and serve it with **Live Server** (right-click `index.html` → *Open with Live Server*). The app fetches the Zillow CSV files via `fetch()`, so it must be served from a local HTTP server — opening `index.html` directly as a `file://` URL will not work.

All five Zillow dataset files must be present in the `Datasets/` folder before starting (see [Data Pipeline](#data-pipeline) below).

---

## Project Structure

```
RealScore/
├── index.html               # Single-page app shell and all markup
├── help.html                # In-app user guide page (linked from navbar Help icon)
├── manifest.webmanifest     # PWA install metadata
├── .gitignore               # Excludes development-only folders (e.g., Documents/)
├── css/
│   └── styles.css           # Custom design system on top of Bootstrap
├── js/
│   └── app.js               # All data loading, scoring logic, and UI updates
├── img/
│   ├── logo.png             # Master logo (2816 × 1536 px)
│   ├── logo-128/256/512.png # Web-optimized logo variants
│   ├── logo-dark.jpg        # Dark-theme source logo
│   ├── logo-dark-128/256/512.png # Dark-theme logo variants used in UI
│   ├── icon-192.png         # PWA icon (square, white bg)
│   └── icon-512.png         # PWA icon (square, white bg)
├── Datasets/
│   ├── Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv
│   ├── Metro_zori_uc_sfrcondomfr_sm_month.csv
│   ├── Metro_zhvf_growth_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv
│   ├── Metro_invt_fs_uc_sfrcondo_sm_month.csv
│   └── Metro_mean_doz_pending_uc_sfrcondo_sm_month.csv

```

---

## Data Pipeline

All five Zillow metro-level CSVs are loaded and parsed entirely in the browser — there is no backend and no data conversion step.

### The Five Datasets

| Key | Zillow Dataset | What it provides |
|-----|---------------|-----------------|
| `zhvi` | Zillow Home Value Index (ZHVI) | Smoothed, seasonally adjusted median home value for mid-tier SFR+condo. Used as the market benchmark price. |
| `zori` | Zillow Observed Rent Index (ZORI) | Smoothed median asking rent (SFR+condo+multifamily). Used as the default monthly rent benchmark when a deal-level rent override is not entered. |
| `zhvf` | Zillow Home Value Forecast (ZHVF) | 12-month forward price growth percentage. Used to estimate appreciation in the IRR calculation. |
| `invt` | For-Sale Inventory | Count of active listings. Used in the Risk Score as a supply-side signal. |
| `pending` | Mean Days to Pending | Median days from listing to pending. Used in the Risk Score as a demand-side signal. |

### Loading Sequence

On page load, `initData()` fires five parallel `fetch()` calls. Each response is split into lines, then each line is parsed with `parseCsvLine()` — a hand-written RFC 4180 compliant parser that correctly handles quoted fields containing commas or embedded quotes.

After all five CSVs are parsed, `ingestMetric()` walks each dataset's rows and:
- Skips any row where `RegionType` is not `msa` (filters out national/state/county rows)
- Finds the **most recent non-empty numeric value** in the row (scans right-to-left from the last column), since older columns may be populated while newer ones are blank
- Stores the value in a `marketData` Map keyed by metro name

After ingestion, `onlyCompleteMarkets()` drops any metro that is missing a value from even one of the five datasets. This ensures every market in the dropdown has a full data profile.

Finally, `finalizeRiskStats()` computes the global min and max for inventory count and days-to-pending across all retained metros. These bounds are needed to normalize the risk signals on a 0–100 scale.

---

## Scoring Engine

The Deal Score is computed by `buildModel()` on every input change. It combines three sub-scores, each normalized 0–100:

```
Deal Score = (0.40 × Valuation Score) + (0.35 × Income Score) + (0.25 × Risk Score)
```

All three sub-scores and the final Deal Score are clamped to [0, 100].

### Valuation Score (40%)

Measures how the **listing price** compares to the Zillow Home Value Index for that metro.

```
discountPct = (ZHVI − listingPrice) / ZHVI

ValuationScore = clamp(50 + discountPct × 250, 0, 100)
```

- A listing **at ZHVI** scores 50.
- A listing **20% below ZHVI** scores 100 (maximum — deeply undervalued).
- A listing **20% above ZHVI** scores 0 (minimum — overpriced relative to market).

The multiplier of 250 means that each 1% discount/premium moves the score by 2.5 points, with the full 0–100 range spanning a ±20% price band around ZHVI.

### Income Score (35%)

Measures the income potential of the property relative to a benchmark 9% cap rate.

```
IncomeScore = clamp((capRate / 0.09) × 100, 0, 100)
```

A cap rate of 9% or above scores 100. A 4.5% cap rate scores 50. At 0% it scores 0.

### Risk Score (25%)

Measures market liquidity and supply pressure by combining two normalized signals.

**Days to Pending** (demand signal): lower days-to-pending = faster sales = stronger demand.  
**Inventory** (supply signal): lower inventory = tighter supply = lower seller risk.

Both are sourced from global min/max across all metros, inverted so that lower raw values produce higher scores:

```
normalizedScore = (1 − (value − min) / (max − min)) × 100

RiskScore = clamp((0.55 × pendingScore + 0.45 × inventoryScore) − stressAdjustment, 0, 100)
```

Days-to-pending is weighted slightly higher (55%) than inventory (45%) because it reflects real-time buyer demand. When stress mode is active, a flat 10-point penalty is applied to the Risk Score.

### Deal Score

```
DealScore = clamp(0.40 × ValuationScore + 0.35 × IncomeScore + 0.25 × RiskScore, 0, 100)
```

Score bands displayed in the UI:

| Score | Band |
|-------|------|
| 80–100 | Strong opportunity |
| 60–79 | Viable with caution |
| 0–59 | Higher-risk profile |

---

## Financial Outputs

### Cap Rate

```
NOI = annualRent × (1 − expenseRatio) × (1 − vacancyShock if stress)

capRate = NOI / listingPrice
```

`annualRent` is `monthlyRent × 12`, where `monthlyRent` uses this precedence:
- user-entered Monthly Rent Override (if provided and positive), otherwise
- metro ZORI benchmark.

Stress mode applies `rentShock` to whichever monthly rent source is active.

`expenseRatio` covers operating expenses as a percentage of gross rent (default 35%), such as taxes, insurance, maintenance, management, owner-paid utilities, and turnover reserve. Mortgage payments are modeled separately through debt service.

The UI also displays the selected rent source so it is clear whether the output is based on user-entered rent or the metro benchmark.

### Cash-on-Cash Return

```
loanAmount = listingPrice × (1 − downPaymentRatio)
annualDebtService = monthlyMortgagePayment × 12   [30-year amortization, standard formula]
annualCashFlow = NOI − annualDebtService

cashOnCash = annualCashFlow / downPaymentAmount
```

The mortgage payment uses the standard annuity formula:

```
M = P × (r × (1 + r)^n) / ((1 + r)^n − 1)

where P = loan principal, r = monthly interest rate, n = 360 months
```

### IRR Range

A simplified total-return estimate combining income and appreciation:

```
appreciation = ZHVF (%) / 100
baseIrr = capRate + appreciation

irrLow  = baseIrr − 0.015   (base) | baseIrr − 0.025  (stress)
irrHigh = baseIrr + 0.025   (base) | baseIrr + 0.015  (stress)
```

The range narrows and shifts down under stress, reflecting higher uncertainty and lower expected appreciation.

---

## Stress Testing

Enabling the **Stress Test** toggle applies four simultaneous shocks to the model:

| Parameter | Default | Stress effect |
|-----------|---------|---------------|
| Monthly rent | Monthly Rent Override or ZORI | Reduced by `rentShock` % (default −10%) |
| Vacancy | 0% | `vacancyShock` % applied to NOI (default +5%) |
| IRR band | ±2.5% / ±1.5% | Narrows and shifts down (±2.5% low / ±1.5% high) |
| Risk Score | Raw | −10 point flat penalty |

`rentShock` and `vacancyShock` are grouped under **Apply stress scenario** and are enabled only when that toggle is on.

The **Scenario Snapshot** chart provides a downside sensitivity view that always shows base and stress bars side-by-side regardless of which mode is active, making return resilience and downside exposure easy to compare at a glance.

---

## Market Filtering

The metro selector is dynamically filtered in real time by two controls:

- **Search box**: case-insensitive substring match on metro name.
- **Undervalued Only toggle**: hides metros where `ZHVI < listingPrice` (i.e., where the entered price exceeds the market median — likely overpriced).

Both filters run through `applyMarketFilter()`, which rebuilds the `<select>` options and restores the previously selected metro if it still passes the filter. The status bar above the dropdown shows how many total markets are loaded and how many are currently visible.

---

## UI Overview

| Section | Purpose |
|---------|---------|
| **Navbar** | Logo, brand name, Help icon (opens in-app guide), dark/light mode toggle |
| **Hero** | Tagline and hero logo |
| **Deal Inputs** (left panel) | Market search + filter, metro selector, listing price, optional Monthly Rent, Expense Ratio, financing assumptions, and stress inputs |
| **Decision Summary** (right panel) | Deal Score badge, score band, Cap Rate, CoC, IRR, Projected Rent, Score Breakdown bars |
| **Baseline Data Cards** | ZHVI, ZORI, ZHVF, and Market Risk values for the selected metro, each with an info tooltip |
| **Scenario Snapshot chart** | Chart.js bar chart used as a quick downside sensitivity check by comparing base vs. stress Cap Rate, CoC, and IRR |
| **Help Page** | Step-by-step usage guide for inputs, outputs, score interpretation, and workflow recommendations |
| **Footer** | Compliance note and copyright year |

---

## PWA Setup

RealScore is installable as a Progressive Web App via `manifest.webmanifest`. The manifest sets a unique `"id": "/realscore-mvp"` to avoid identity collisions if multiple PWAs are served from the same localhost origin.

There is intentionally **no service worker** — offline caching is out of scope for the MVP. The app simply requires a running local server and network access to load the dataset CSVs.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Markup | HTML5 |
| Styling | Bootstrap 5.3.3 (CDN) + custom CSS custom properties |
| Logic | Vanilla JavaScript (ES2020, no build step) |
| Charts | Chart.js 4.4.3 (CDN) |
| Fonts | Space Grotesk (headings), IBM Plex Sans (body) via Google Fonts |
| Data Source | 5 Zillow metro CSV files |
| Data Loading | Browser `fetch()` + custom RFC-4180 CSV parser |
| PWA | Web App Manifest (no service worker) |
| Theme | `data-theme` attribute on `<html>`, toggled via JS, persisted in `localStorage`, with light/dark logo asset swapping |
| Hosting | Static hosting (GitHub Pages compatible) |

const THEME_KEY = "realscore-theme";
const root = document.documentElement;
const toggle = document.getElementById("themeToggle");
const toggleLabel = document.getElementById("themeToggleLabel");

const el = {
	year: document.getElementById("year"),
	dataStatus: document.getElementById("dataStatus"),
	marketSearch: document.getElementById("marketSearch"),
	undervaluedOnly: document.getElementById("undervaluedOnly"),
	marketSelect: document.getElementById("marketSelect"),
	listingPrice: document.getElementById("listingPrice"),
	expenseRatio: document.getElementById("expenseRatio"),
	downPayment: document.getElementById("downPayment"),
	interestRate: document.getElementById("interestRate"),
	vacancyShock: document.getElementById("vacancyShock"),
	rentShock: document.getElementById("rentShock"),
	stressToggle: document.getElementById("stressToggle"),
	resetInputs: document.getElementById("resetInputs"),
	dealScore: document.getElementById("dealScore"),
	scoreBand: document.getElementById("scoreBand"),
	capRateOut: document.getElementById("capRateOut"),
	cocOut: document.getElementById("cocOut"),
	irrOut: document.getElementById("irrOut"),
	rentOut: document.getElementById("rentOut"),
	zhviOut: document.getElementById("zhviOut"),
	zoriOut: document.getElementById("zoriOut"),
	zhvfOut: document.getElementById("zhvfOut"),
	marketRiskOut: document.getElementById("marketRiskOut"),
	valuationScoreOut: document.getElementById("valuationScoreOut"),
	incomeScoreOut: document.getElementById("incomeScoreOut"),
	riskScoreOut: document.getElementById("riskScoreOut"),
	valuationBar: document.getElementById("valuationBar"),
	incomeBar: document.getElementById("incomeBar"),
	riskBar: document.getElementById("riskBar"),
	scenarioChart: document.getElementById("scenarioChart")
};

const DATA_PATHS = {
	zhvi: "Datasets/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
	zori: "Datasets/Metro_zori_uc_sfrcondomfr_sm_month.csv",
	zhvf: "Datasets/Metro_zhvf_growth_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
	invt: "Datasets/Metro_invt_fs_uc_sfrcondo_sm_month.csv",
	pending: "Datasets/Metro_mean_doz_pending_uc_sfrcondo_sm_month.csv"
};

const marketData = new Map();
let marketNames = [];
let scenarioChart = null;
const riskStats = {
	inventory: { min: 0, max: 1 },
	pending: { min: 0, max: 1 }
};

const DEFAULTS = {
	listingPrice: 350000,
	expenseRatio: 35,
	downPayment: 25,
	interestRate: 6.8,
	vacancyShock: 5,
	rentShock: 10,
	stressToggle: false,
	marketSearch: "",
	undervaluedOnly: false
};

function applyTheme(theme) {
	root.setAttribute("data-theme", theme);

	const isDark = theme === "dark";
	toggle.setAttribute("aria-pressed", String(isDark));
	toggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
	toggleLabel.textContent = isDark ? "Light Mode" : "Dark Mode";
}

const savedTheme = localStorage.getItem(THEME_KEY);
applyTheme(savedTheme === "dark" ? "dark" : "light");

toggle.addEventListener("click", () => {
	const nextTheme = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
	applyTheme(nextTheme);
	localStorage.setItem(THEME_KEY, nextTheme);
});

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function safeNumber(raw, fallback = 0) {
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

function parseCsvLine(line) {
	const values = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i];

		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i += 1;
			} else {
				inQuotes = !inQuotes;
			}
			continue;
		}

		if (ch === "," && !inQuotes) {
			values.push(current);
			current = "";
			continue;
		}

		current += ch;
	}

	values.push(current);
	return values;
}

function lastNumericValue(row, startIndex = 0) {
	for (let i = row.length - 1; i >= startIndex; i -= 1) {
		const value = row[i]?.trim();
		if (!value) {
			continue;
		}
		const n = Number(value);
		if (Number.isFinite(n)) {
			return n;
		}
	}
	return null;
}

async function fetchCsv(path) {
	const response = await fetch(path);
	if (!response.ok) {
		throw new Error(`Failed to load ${path}`);
	}

	const text = await response.text();
	const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
	const header = parseCsvLine(lines[0]);
	const rows = lines.slice(1).map(parseCsvLine);
	return { header, rows };
}

function ensureMarket(regionName) {
	if (!marketData.has(regionName)) {
		marketData.set(regionName, {
			regionName,
			zhvi: null,
			zori: null,
			zhvf: null,
			inventory: null,
			pending: null
		});
	}
	return marketData.get(regionName);
}

function ingestMetric(rows, metricKey) {
	rows.forEach((row) => {
		const regionName = row[2]?.trim();
		const regionType = row[3]?.trim().toLowerCase();
		if (!regionName || regionType !== "msa") {
			return;
		}

		const value = lastNumericValue(row, 5);
		if (value === null) {
			return;
		}

		const market = ensureMarket(regionName);
		market[metricKey] = value;
	});
}

function normalizeHigherIsWorse(value, stats) {
	if (value === null || value === undefined) {
		return 50;
	}

	if (stats.max === stats.min) {
		return 50;
	}

	const position = (value - stats.min) / (stats.max - stats.min);
	const lowerIsBetterScore = (1 - position) * 100;
	return clamp(lowerIsBetterScore, 0, 100);
}

function currency(value) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 0
	}).format(value);
}

function percent(value, digits = 1) {
	return `${(value * 100).toFixed(digits)}%`;
}

function scoreBand(score) {
	if (score >= 80) return "Strong opportunity";
	if (score >= 60) return "Viable with caution";
	return "Higher-risk profile";
}

function upsertScenarioChart(baseCase, stressCase) {
	if (!el.scenarioChart || typeof Chart === "undefined") {
		return;
	}

	const labels = ["Cap Rate %", "Cash-on-Cash %", "IRR Mid %"];
	const baseIrrMid = (baseCase.irrLow + baseCase.irrHigh) / 2;
	const stressIrrMid = (stressCase.irrLow + stressCase.irrHigh) / 2;

	const baseData = [baseCase.capRate * 100, baseCase.cashOnCash * 100, baseIrrMid * 100];
	const stressData = [stressCase.capRate * 100, stressCase.cashOnCash * 100, stressIrrMid * 100];

	if (!scenarioChart) {
		scenarioChart = new Chart(el.scenarioChart, {
			type: "bar",
			data: {
				labels,
				datasets: [
					{
						label: "Base",
						data: baseData,
						backgroundColor: "rgba(12, 127, 228, 0.7)",
						borderRadius: 8
					},
					{
						label: "Stress",
						data: stressData,
						backgroundColor: "rgba(242, 176, 92, 0.8)",
						borderRadius: 8
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { position: "bottom" }
				},
				scales: {
					y: {
						beginAtZero: true,
						ticks: {
							callback: (value) => `${value}%`
						}
					}
				}
			}
		});
		return;
	}

	scenarioChart.data.datasets[0].data = baseData;
	scenarioChart.data.datasets[1].data = stressData;
	scenarioChart.update();
}

function mortgagePayment(principal, annualRate, years = 30) {
	const monthlyRate = annualRate / 12;
	const n = years * 12;
	if (monthlyRate <= 0) {
		return principal / n;
	}

	const pow = (1 + monthlyRate) ** n;
	return principal * ((monthlyRate * pow) / (pow - 1));
}

function buildModel(market) {
	const listingPrice = safeNumber(el.listingPrice.value, 350000);
	const expenseRatio = clamp(safeNumber(el.expenseRatio.value, 35) / 100, 0, 1);
	const downPaymentRatio = clamp(safeNumber(el.downPayment.value, 25) / 100, 0, 1);
	const interestRate = clamp(safeNumber(el.interestRate.value, 6.8) / 100, 0, 0.3);
	const vacancyShock = clamp(safeNumber(el.vacancyShock.value, 5) / 100, 0, 0.4);
	const rentShock = clamp(safeNumber(el.rentShock.value, 10) / 100, 0, 0.4);
	const stressOn = el.stressToggle.checked;

	const zhvi = market.zhvi ?? listingPrice;
	const zori = market.zori ?? 0;
	const zhvfPct = market.zhvf ?? 0;

	let monthlyRent = zori;
	if (stressOn) {
		monthlyRent *= (1 - rentShock);
	}

	const annualRent = monthlyRent * 12;
	const adjustedNOI = annualRent * (1 - expenseRatio) * (stressOn ? (1 - vacancyShock) : 1);
	const capRate = listingPrice > 0 ? adjustedNOI / listingPrice : 0;

	const downPaymentAmount = listingPrice * downPaymentRatio;
	const loanAmount = Math.max(0, listingPrice - downPaymentAmount);
	const annualDebtService = mortgagePayment(loanAmount, interestRate) * 12;
	const annualCashFlow = adjustedNOI - annualDebtService;
	const cashOnCash = downPaymentAmount > 0 ? annualCashFlow / downPaymentAmount : 0;

	const appreciation = zhvfPct / 100;
	const baseIrr = capRate + appreciation;
	const irrLow = baseIrr - (stressOn ? 0.025 : 0.015);
	const irrHigh = baseIrr + (stressOn ? 0.015 : 0.025);

	const discountPct = zhvi > 0 ? (zhvi - listingPrice) / zhvi : 0;
	const valuationScore = clamp(50 + discountPct * 250, 0, 100);
	const incomeScore = clamp((capRate / 0.09) * 100, 0, 100);
	const inventoryScore = normalizeHigherIsWorse(market.inventory, riskStats.inventory);
	const pendingScore = normalizeHigherIsWorse(market.pending, riskStats.pending);
	const rawRiskScore = 0.55 * pendingScore + 0.45 * inventoryScore;
	const riskScore = clamp(rawRiskScore - (stressOn ? 10 : 0), 0, 100);

	const dealScore = clamp(
		0.4 * valuationScore + 0.35 * incomeScore + 0.25 * riskScore,
		0,
		100
	);

	return {
		zhvi,
		zori,
		zhvfPct,
		monthlyRent,
		capRate,
		cashOnCash,
		irrLow,
		irrHigh,
		dealScore,
		valuationScore,
		incomeScore,
		riskScore,
		discountPct,
		riskText: `Inventory ${market.inventory?.toFixed(0) ?? "--"} | Days Pending ${market.pending?.toFixed(1) ?? "--"}`
	};
}

function buildScenarioModel(market, overrideStress) {
	const original = el.stressToggle.checked;
	el.stressToggle.checked = overrideStress;
	const result = buildModel(market);
	el.stressToggle.checked = original;
	return result;
}

function updateScoreBreakdown(output) {
	el.valuationScoreOut.textContent = `${Math.round(output.valuationScore)}/100`;
	el.incomeScoreOut.textContent = `${Math.round(output.incomeScore)}/100`;
	el.riskScoreOut.textContent = `${Math.round(output.riskScore)}/100`;

	el.valuationBar.style.width = `${Math.round(output.valuationScore)}%`;
	el.incomeBar.style.width = `${Math.round(output.incomeScore)}%`;
	el.riskBar.style.width = `${Math.round(output.riskScore)}%`;
}

function applyMarketFilter() {
	const currentSelection = el.marketSelect.value;
	const search = el.marketSearch.value.trim().toLowerCase();
	const listingPrice = safeNumber(el.listingPrice.value, DEFAULTS.listingPrice);

	const filtered = marketNames.filter((name) => {
		const market = marketData.get(name);
		if (!market) return false;

		const matchesSearch = !search || name.toLowerCase().includes(search);
		const matchesUndervalued = !el.undervaluedOnly.checked || market.zhvi >= listingPrice;
		return matchesSearch && matchesUndervalued;
	});

	el.marketSelect.innerHTML = filtered.map((name) => `<option value="${name}">${name}</option>`).join("");

	if (filtered.length === 0) {
		el.dataStatus.textContent = "No metro matches the current search/filter.";
		return;
	}

	el.marketSelect.value = filtered.includes(currentSelection) ? currentSelection : filtered[0];
	el.dataStatus.textContent = `Loaded ${marketNames.length} markets | Showing ${filtered.length}.`;
}

function resetInputs() {
	el.listingPrice.value = DEFAULTS.listingPrice;
	el.expenseRatio.value = DEFAULTS.expenseRatio;
	el.downPayment.value = DEFAULTS.downPayment;
	el.interestRate.value = DEFAULTS.interestRate;
	el.vacancyShock.value = DEFAULTS.vacancyShock;
	el.rentShock.value = DEFAULTS.rentShock;
	el.stressToggle.checked = DEFAULTS.stressToggle;
	el.marketSearch.value = DEFAULTS.marketSearch;
	el.undervaluedOnly.checked = DEFAULTS.undervaluedOnly;
	applyMarketFilter();
	render();
}

function closeAllTooltips() {
	document.querySelectorAll(".help-tooltip.is-open").forEach((tip) => {
		tip.classList.remove("is-open");
	});
	document.querySelectorAll(".info-btn[aria-expanded='true']").forEach((btn) => {
		btn.setAttribute("aria-expanded", "false");
	});
}

function initTooltips() {
	document.querySelectorAll(".info-btn").forEach((btn) => {
		btn.addEventListener("click", (event) => {
			event.stopPropagation();
			const targetId = btn.getAttribute("data-tooltip-target");
			const target = targetId ? document.getElementById(targetId) : null;
			if (!target) return;

			const opening = !target.classList.contains("is-open");
			closeAllTooltips();
			if (opening) {
				target.classList.add("is-open");
				btn.setAttribute("aria-expanded", "true");
			}
		});
	});

	document.addEventListener("click", () => {
		closeAllTooltips();
	});

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			closeAllTooltips();
		}
	});
}

function render() {
	const selected = el.marketSelect.value;
	if (!selected || !marketData.has(selected)) {
		return;
	}

	const market = marketData.get(selected);
	const output = buildModel(market);
	const baseCase = buildScenarioModel(market, false);
	const stressCase = buildScenarioModel(market, true);

	el.dealScore.textContent = Math.round(output.dealScore).toString();
	el.scoreBand.textContent = `${scoreBand(output.dealScore)} | ${output.discountPct >= 0 ? "Undervalued" : "Premium"} ${(Math.abs(output.discountPct) * 100).toFixed(1)}% vs ZHVI`;
	el.capRateOut.textContent = percent(output.capRate, 2);
	el.cocOut.textContent = percent(output.cashOnCash, 2);
	el.irrOut.textContent = `${percent(output.irrLow, 1)} to ${percent(output.irrHigh, 1)}`;
	el.rentOut.textContent = currency(output.monthlyRent);

	el.zhviOut.textContent = currency(output.zhvi);
	el.zoriOut.textContent = currency(output.zori);
	el.zhvfOut.textContent = `${(output.zhvfPct ?? 0).toFixed(2)}%`;
	el.marketRiskOut.textContent = output.riskText;
	updateScoreBreakdown(output);
	upsertScenarioChart(baseCase, stressCase);
}

function initInputs() {
	[
		el.marketSelect,
		el.marketSearch,
		el.undervaluedOnly,
		el.listingPrice,
		el.expenseRatio,
		el.downPayment,
		el.interestRate,
		el.vacancyShock,
		el.rentShock,
		el.stressToggle
	].forEach((input) => input.addEventListener("input", () => {
		if (input === el.marketSearch || input === el.undervaluedOnly || input === el.listingPrice) {
			applyMarketFilter();
		}
		render();
	}));

	el.resetInputs.addEventListener("click", resetInputs);
}

function finalizeRiskStats() {
	const inventoryValues = [];
	const pendingValues = [];

	marketData.forEach((market) => {
		if (market.inventory !== null && market.inventory !== undefined) {
			inventoryValues.push(market.inventory);
		}
		if (market.pending !== null && market.pending !== undefined) {
			pendingValues.push(market.pending);
		}
	});

	if (inventoryValues.length > 0) {
		riskStats.inventory.min = Math.min(...inventoryValues);
		riskStats.inventory.max = Math.max(...inventoryValues);
	}

	if (pendingValues.length > 0) {
		riskStats.pending.min = Math.min(...pendingValues);
		riskStats.pending.max = Math.max(...pendingValues);
	}
}

function onlyCompleteMarkets() {
	const filtered = [...marketData.entries()].filter(([, m]) =>
		[m.zhvi, m.zori, m.zhvf, m.inventory, m.pending].every((v) => v !== null && v !== undefined)
	);

	marketData.clear();
	filtered.forEach(([key, value]) => marketData.set(key, value));
}

async function initData() {
	try {
		const [zhvi, zori, zhvf, invt, pending] = await Promise.all([
			fetchCsv(DATA_PATHS.zhvi),
			fetchCsv(DATA_PATHS.zori),
			fetchCsv(DATA_PATHS.zhvf),
			fetchCsv(DATA_PATHS.invt),
			fetchCsv(DATA_PATHS.pending)
		]);

		ingestMetric(zhvi.rows, "zhvi");
		ingestMetric(zori.rows, "zori");
		ingestMetric(zhvf.rows, "zhvf");
		ingestMetric(invt.rows, "inventory");
		ingestMetric(pending.rows, "pending");

		onlyCompleteMarkets();
		finalizeRiskStats();

		const markets = [...marketData.keys()].sort((a, b) => a.localeCompare(b));
		if (markets.length === 0) {
			el.dataStatus.textContent = "No complete metro records were found across all 5 datasets.";
			return;
		}

		marketNames = markets;
		applyMarketFilter();
		const current = el.marketSelect.value;
		const defaultMarket = marketNames.find((name) => name.includes("Miami")) || marketNames[0];
		el.marketSelect.value = current || defaultMarket;
		render();
	} catch (error) {
		console.error(error);
		el.dataStatus.textContent = "Could not load dataset files. Confirm the Datasets folder paths and run from Live Server root.";
	}
}

el.year.textContent = new Date().getFullYear();
initInputs();
initTooltips();
initData();

// www/kv-glossary-data.js — shared plain-English glossary term map.
// Pure data only, zero DOM access (per the DOM boundary rule) — dual-exported
// so it loads under Node's test runner and as window.kvGlossaryData in the
// browser, same pattern as kv-ticker-input.js's pure-function half.
//
// AFSL rule (non-negotiable — see CLAUDE.md's Legal Disclaimers section):
// every definition says what a term MEANS, never what to DO about it.
// Thresholds are framed as "the Buffett checklist treats X as a pass", never
// "a good stock has X". Enforced by tests/kv-glossary-data.test.js's phrase
// deny-list — do not add copy here without re-running that test.
//
// Keys are anchor-safe (^[a-z0-9-]+$) — they double as /glossary/#<key>.
(function (root) {
  'use strict';

  var TERMS = {
    'market-cap': {
      term: 'Market Capitalisation',
      short: "The total value of all a company's shares: share price × shares outstanding. It's the market's real-time price tag for the whole business.",
      category: 'valuation',
      related: ['enterprise-value'],
      aka: ['Market Cap'],
    },
    'enterprise-value': {
      term: 'Enterprise Value',
      short: "What it would cost to buy the entire company outright: market cap plus total debt, minus cash. It reflects the value of the underlying business, not just the equity slice.",
      category: 'valuation',
      related: ['market-cap', 'ev-sales'],
      aka: ['EV'],
    },
    'pe-ratio': {
      term: 'Price-to-Earnings Ratio',
      short: "Share price divided by earnings per share. It shows how many dollars the market is pricing for each dollar of a company's annual profit.",
      category: 'valuation',
      related: ['eps', 'graham-number'],
      aka: ['P/E', 'PE Ratio'],
    },
    'eps': {
      term: 'Earnings Per Share',
      short: "A company's net profit divided by its number of shares outstanding — the profit attributable to a single share.",
      category: 'profitability',
      related: ['pe-ratio', 'graham-number'],
      aka: ['EPS'],
    },
    'pb-ratio': {
      term: 'Price-to-Book Ratio',
      short: "Share price divided by book value (net assets) per share. It compares the market price to the accounting value of the company's assets.",
      category: 'valuation',
      related: ['graham-number', 'roe'],
      aka: ['P/B', 'PB Ratio'],
    },
    'roe': {
      term: 'Return on Equity',
      short: "Net profit divided by shareholders' equity, as a percentage. It measures how efficiently a company turns shareholders' own capital into profit.",
      category: 'profitability',
      related: ['roce', 'pb-ratio'],
      aka: ['ROE', 'Return on Equity (ROE)'],
    },
    'roce': {
      term: 'Return on Capital Employed',
      short: "Operating profit (EBIT) divided by capital employed (assets minus current liabilities). It measures how efficiently a company uses ALL the capital invested in it, not just equity.",
      long: "Return on Capital Employed (ROCE) divides operating profit (EBIT) by capital employed — total assets minus current liabilities. Unlike Return on Equity, which only looks at shareholders' capital, ROCE also accounts for debt funding, making it a more complete efficiency measure for capital-intensive businesses. It's a metric used by several quality-focused Indian equity frameworks to identify companies that compound capital efficiently.",
      category: 'profitability',
      related: ['roe'],
      aka: ['ROCE'],
    },
    'debt-to-equity': {
      term: 'Debt-to-Equity Ratio',
      short: "Total debt divided by shareholders' equity. It shows how much of the company is funded by borrowing versus owner capital. Yahoo Finance reports this as a percentage, e.g. 53.2 means debt equal to 53.2% of equity.",
      category: 'balance-sheet',
      related: ['current-ratio'],
      aka: ['D/E', 'Debt/Equity'],
    },
    'current-ratio': {
      term: 'Current Ratio',
      short: "Current assets divided by current liabilities. It measures whether a company holds enough short-term assets to cover its short-term obligations.",
      category: 'balance-sheet',
      related: ['debt-to-equity'],
    },
    'profit-margin': {
      term: 'Profit Margin',
      short: "Net profit divided by revenue, as a percentage. It shows how much of every dollar of sales ends up as profit after all costs.",
      category: 'profitability',
      related: ['operating-margin', 'gross-margin'],
      aka: ['Net Margin'],
    },
    'operating-margin': {
      term: 'Operating Margin',
      short: "Operating profit divided by revenue. It measures profitability from core operations, before interest and tax, isolating how efficiently the underlying business runs.",
      category: 'profitability',
      related: ['profit-margin', 'gross-margin'],
    },
    'gross-margin': {
      term: 'Gross Margin',
      short: "Revenue minus cost of goods sold, divided by revenue. It shows how much is left from each sale before operating expenses like marketing and R&D.",
      category: 'profitability',
      related: ['operating-margin'],
    },
    'revenue-growth': {
      term: 'Revenue Growth',
      short: "The percentage increase in a company's sales over a prior period, usually year-on-year. It measures how fast the top line is expanding.",
      category: 'growth',
      related: ['earnings-growth', 'rule-of-40'],
    },
    'earnings-growth': {
      term: 'Earnings Growth',
      short: "The percentage change in a company's net profit over a prior period. It shows whether bottom-line profit is expanding, contracting, or flat.",
      category: 'growth',
      related: ['revenue-growth'],
    },
    'dividend-yield': {
      term: 'Dividend Yield',
      short: "Annual dividend per share divided by the current share price, as a percentage. It shows the cash income return relative to today's price.",
      category: 'income',
      related: ['dividend-per-share'],
    },
    'beta': {
      term: 'Beta',
      short: "A measure of how much a stock's price tends to move relative to the overall market. A beta above 1 means bigger swings than the market; below 1 means smaller swings.",
      category: 'risk',
      related: ['cost-of-equity', 'equity-risk-premium'],
    },
    '52-week-range': {
      term: '52-Week Range',
      short: "The lowest and highest price a stock has traded at over the past year. It shows how far the current price sits from its recent extremes.",
      category: 'stats',
      related: [],
    },
    'analyst-target': {
      term: 'Analyst Target Price',
      short: "The average 12-month price forecast from the equity analysts covering a stock, as compiled by Yahoo Finance. It reflects analyst opinion, not this tool's own view.",
      category: 'stats',
      related: [],
    },
    'insider-ownership': {
      term: 'Insider / Promoter Ownership',
      short: "The percentage of a company's shares held by its founders, directors, or promoters. Higher levels are often read as a sign management has a personal financial stake in the outcome.",
      category: 'governance',
      related: ['audit-risk', 'board-risk', 'compensation-risk'],
    },
    'audit-risk': {
      term: 'Audit Risk (Sustainalytics)',
      short: "A Sustainalytics sub-score, rated 1–10, assessing a company's exposure to risk in financial reporting quality, internal controls, and auditor independence. A lower score means lower assessed risk.",
      category: 'governance',
      related: ['board-risk', 'compensation-risk'],
    },
    'board-risk': {
      term: 'Board Risk (Sustainalytics)',
      short: "A Sustainalytics sub-score, rated 1–10, assessing a company's exposure to risk from board structure, independence, and oversight effectiveness. A lower score means lower assessed risk.",
      category: 'governance',
      related: ['audit-risk', 'compensation-risk'],
    },
    'compensation-risk': {
      term: 'Compensation Risk (Sustainalytics)',
      short: "A Sustainalytics sub-score, rated 1–10, assessing how well a company's executive pay is judged to align with shareholder interests. A lower score means lower assessed risk.",
      category: 'governance',
      related: ['audit-risk', 'board-risk'],
    },
    'graham-number': {
      term: 'Graham Number',
      short: "A formula from Benjamin Graham estimating a conservative fair value: the square root of (22.5 × EPS × Book Value per Share). It combines earnings and asset value into one reference figure.",
      category: 'valuation',
      related: ['pe-ratio', 'pb-ratio'],
    },
    'combined-score': {
      term: 'Combined Score',
      short: "The sum of criteria passed across the Buffett, Dalio, and Graham checklists shown together on one gauge, out of the combined maximum possible.",
      category: 'scoring',
      related: [],
    },
    'free-cash-flow': {
      term: 'Free Cash Flow',
      short: "Cash generated by operations minus capital expenditure. It's the cash a business has left over after running and maintaining itself, before any financing decisions.",
      long: "Free Cash Flow (FCF) starts from operating cash flow and subtracts capital expenditure — the money spent maintaining or expanding property, plant, and equipment. What remains is cash the business could theoretically return to shareholders, pay down debt with, or reinvest, without needing to borrow. It's the input most valuation models (like DCF) build from, because unlike reported profit it's harder to distort with non-cash accounting choices.",
      category: 'cash-flow',
      related: ['operating-cash-flow', 'normalised-fcf', 'dcf'],
      aka: ['FCF'],
    },
    'operating-cash-flow': {
      term: 'Operating Cash Flow',
      short: "Cash generated purely from a company's core business operations, before investing or financing activities. It's a check on whether reported profit is backed by real cash.",
      category: 'cash-flow',
      related: ['free-cash-flow'],
    },
    'net-debt': {
      term: 'Net Debt',
      short: "Total debt minus cash and cash equivalents. A positive figure means debt exceeds cash on hand; a negative figure (net cash) means the reverse.",
      category: 'balance-sheet',
      related: ['free-cash-flow'],
    },
    'intrinsic-value': {
      term: 'Intrinsic Value',
      short: "An estimate of what a stock is worth today based on a valuation model's assumptions about future cash flows or dividends — distinct from its current market price.",
      category: 'valuation',
      related: ['margin-of-safety', 'dcf', 'ddm'],
    },
    'dcf': {
      term: 'Discounted Cash Flow',
      short: "A valuation method that projects a business's future free cash flows and discounts them back to today's dollars, since a dollar received later is worth less than one received now.",
      long: "Discounted Cash Flow (DCF) analysis works in three steps: forecast free cash flow for each year over a projection period; divide each year's figure by (1 + discount rate) raised to that year's power to find its present value; then add a terminal value representing everything beyond the forecast, treated as a perpetuity. Summing the present values gives firm value, from which net debt is subtracted to reach equity value per share.",
      category: 'valuation',
      related: ['wacc', 'terminal-value', 'intrinsic-value'],
      aka: ['DCF'],
    },
    'ddm': {
      term: 'Dividend Discount Model',
      short: "A valuation method that values a stock from the dividends it's expected to pay, discounted back to today's value. Used instead of DCF for banks and insurers, where free cash flow isn't a meaningful figure.",
      long: "The Dividend Discount Model (DDM) projects a company's dividend per share forward using an assumed growth rate, then discounts each future dividend back to present value using the cost of equity. Because it works directly from dividends rather than free cash flow, it sidesteps the problem that bank deposits and insurer reserves make free-cash-flow-based DCF structurally unreliable for financial companies.",
      category: 'valuation',
      related: ['gordon-growth-model', 'cost-of-equity'],
      aka: ['DDM', 'Dividend Discount Model (DDM)'],
    },
    'wacc': {
      term: 'Weighted Average Cost of Capital',
      short: "Also called the discount rate — the blended return a company's capital (equity and debt) is expected to earn, weighted by how much of each it uses. A higher WACC lowers a DCF's valuation.",
      long: "WACC blends two components: cost of equity (via CAPM) and after-tax cost of debt, weighted by the company's actual mix of equity and debt financing. It's used as the discount rate in a DCF because it represents the minimum return the business needs to generate across all its capital to satisfy both shareholders and lenders. Small changes in WACC produce outsized swings in the resulting valuation, since it compounds over every projected year.",
      category: 'valuation',
      related: ['cost-of-equity', 'dcf'],
      aka: ['WACC', 'discount rate', 'Discount Rate'],
    },
    'cost-of-equity': {
      term: 'Cost of Equity',
      short: "The return shareholders require for holding a stock, given its risk. Calculated via CAPM: risk-free rate plus beta × equity risk premium.",
      category: 'valuation',
      related: ['wacc', 'risk-free-rate', 'equity-risk-premium', 'beta'],
      aka: ['Ke'],
    },
    'terminal-value': {
      term: 'Terminal Value',
      short: "The estimated value of all cash flows (or dividends) beyond a valuation model's explicit forecast period, treated as growing forever at a constant rate. It often makes up the majority of a DCF's total value.",
      category: 'valuation',
      related: ['terminal-growth', 'dcf'],
    },
    'terminal-growth': {
      term: 'Terminal Growth Rate',
      short: "The constant annual growth rate assumed for cash flows or dividends forever after a model's forecast period ends. Kept low and sustainable, since no company can outgrow the whole economy indefinitely.",
      category: 'valuation',
      related: ['terminal-value', 'growth-rate'],
    },
    'margin-of-safety': {
      term: 'Margin of Safety',
      short: "The percentage gap between a valuation model's estimated intrinsic value and the stock's current market price. A positive margin means the price sits below the model's estimate of value; a negative margin means the reverse.",
      category: 'valuation',
      related: ['intrinsic-value'],
    },
    'equity-risk-premium': {
      term: 'Equity Risk Premium',
      short: "The extra return investors historically demand for holding stocks instead of risk-free government bonds. It's one of the inputs to the CAPM cost-of-equity formula.",
      category: 'valuation',
      related: ['risk-free-rate', 'cost-of-equity'],
      aka: ['ERP'],
    },
    'risk-free-rate': {
      term: 'Risk-Free Rate',
      short: "The return available from a virtually default-free investment, typically a 10-year government bond yield for the relevant market. It's the baseline in the CAPM cost-of-equity formula.",
      category: 'valuation',
      related: ['equity-risk-premium', 'cost-of-equity'],
    },
    'franking-credits': {
      term: 'Franking Credits',
      short: "Under Australia's dividend imputation system, credits attached to a dividend representing corporate tax the company has already paid, which shareholders can use to reduce their own tax.",
      category: 'income',
      related: ['dividend-yield'],
    },
    'normalised-fcf': {
      term: 'Normalised Free Cash Flow',
      short: "An adjusted estimate of free cash flow used when a company's reported FCF is negative or distorted, typically derived from revenue multiplied by an assumed sustainable margin.",
      category: 'cash-flow',
      related: ['free-cash-flow'],
    },
    'growth-rate': {
      term: 'Growth Rate',
      short: "The assumed annual percentage increase used to project a financial figure — such as cash flow or dividends — forward across a valuation model's forecast period.",
      category: 'growth',
      related: ['terminal-growth'],
    },
    'rule-of-40': {
      term: 'Rule of 40',
      short: "A health check for growth companies: revenue growth % plus free cash flow margin % added together. A combined total of 40 or more is a widely used benchmark for growth achieved at a sustainable cash cost.",
      category: 'growth',
      related: ['revenue-growth', 'free-cash-flow'],
    },
    'cash-runway': {
      term: 'Cash Runway',
      short: "How many months a company can keep operating at its current cash-burn rate before running out of cash, calculated from cash on hand divided by monthly cash outflow.",
      category: 'cash-flow',
      related: ['free-cash-flow'],
    },
    'dilution': {
      term: 'Dilution',
      short: "The increase in a company's total shares outstanding over time, typically from issuing new stock to raise capital or compensate employees. It reduces each existing share's proportional ownership.",
      category: 'balance-sheet',
      related: [],
    },
    'ev-sales': {
      term: 'EV/Sales',
      short: "Enterprise Value divided by annual revenue. Used to value companies with little or no profit, where a P/E ratio isn't a workable measure.",
      category: 'valuation',
      related: ['enterprise-value', 'multi-stage-dcf'],
      aka: ['EV/Revenue', 'Enterprise Value to Revenue'],
    },
    'multi-stage-dcf': {
      term: 'Multi-Stage DCF',
      short: "A Discounted Cash Flow variant that models profit margin improving gradually toward a target over several years, rather than assuming a stable margin from year one. Built for companies that aren't profitable yet.",
      category: 'valuation',
      related: ['dcf', 'ev-sales'],
    },
    'gordon-growth-model': {
      term: 'Gordon Growth Model',
      short: "A dividend valuation formula: intrinsic value equals next year's expected dividend divided by (cost of equity minus the perpetual growth rate). It assumes dividends grow at one constant rate forever.",
      long: "The Gordon Growth Model (GGM) is the simplest form of a Dividend Discount Model: Intrinsic Value = D₁ / (Ke − g), where D₁ is next year's expected dividend, Ke is the cost of equity, and g is a single constant perpetual growth rate. Because it assumes one growth rate forever, it works best for mature, stable dividend payers rather than early-stage or highly cyclical businesses. Rearranging the formula to solve for g instead, given today's price, produces the implied growth rate the market is currently pricing in.",
      category: 'valuation',
      related: ['implied-growth', 'dividend-per-share', 'cost-of-equity'],
      aka: ['GGM'],
    },
    'implied-growth': {
      term: 'Implied Growth Rate',
      short: "The perpetual dividend growth rate that would make a valuation model's fair value exactly equal to today's market price, solved for by rearranging the formula. It shows what growth the market is currently pricing in.",
      category: 'valuation',
      related: ['gordon-growth-model'],
    },
    'dividend-per-share': {
      term: 'Dividend Per Share',
      short: "The total annual dividend a company pays, divided by its number of shares outstanding — the cash amount paid to the holder of one share.",
      category: 'income',
      related: ['dividend-yield', 'gordon-growth-model'],
      aka: ['DPS', 'D0', 'D₀'],
    },
    'lvr': {
      term: 'Loan-to-Value Ratio',
      short: "The loan amount as a percentage of a property's value (loan ÷ value × 100). Lenders commonly require Lenders Mortgage Insurance once LVR rises above 80%.",
      category: 'property',
      related: ['lmi'],
      aka: ['LVR'],
    },
    'lmi': {
      term: 'Lenders Mortgage Insurance',
      short: "A one-off insurance premium some lenders charge when a loan's LVR exceeds a threshold (commonly 80%). It protects the lender — not the borrower — if the loan later defaults.",
      category: 'property',
      related: ['lvr'],
      aka: ['LMI'],
    },
    'stamp-duty': {
      term: 'Stamp Duty',
      short: "A one-off state government tax charged on eligible transactions such as a property purchase, calculated from the property's value using that state's rate schedule.",
      category: 'property',
      related: [],
      aka: ['Transfer Duty'],
    },
    'negative-gearing': {
      term: 'Negative Gearing',
      short: "When the costs of holding an investment — such as loan interest and running expenses — exceed the income it produces, creating a deductible loss that can offset other income.",
      category: 'tax',
      related: ['capital-gains-tax'],
    },
    'capital-gains-tax': {
      term: 'Capital Gains Tax',
      short: "Tax payable on the profit made when an asset is sold for more than its cost base. Australian assets held over 12 months have historically qualified for a discount on the taxable gain.",
      long: "Capital Gains Tax (CGT) is charged on the gain between an asset's sale price and its cost base. Historically, Australian assets held longer than 12 months received a 50% discount on the taxable gain. From 1 July 2027, that discount is replaced — for assets acquired on or after 12 May 2026 — with inflation indexation of the cost base plus a 30% minimum tax rate on the real gain; assets acquired earlier are grandfathered under a split-gain approach.",
      category: 'tax',
      related: ['negative-gearing'],
      aka: ['CGT'],
    },
    'offset-account': {
      term: 'Offset Account',
      short: "A transaction account linked to a home loan whose balance is subtracted from the loan balance before interest is calculated — reducing interest charged without paying down the loan itself.",
      category: 'property',
      related: [],
    },
    'marginal-tax-rate': {
      term: 'Marginal Tax Rate',
      short: "The tax rate applied to your next dollar of taxable income under a progressive tax-bracket system — higher than your average (effective) rate across all of your income.",
      category: 'tax',
      related: [],
      aka: ['MTR'],
    },
    'debt-recycling': {
      term: 'Debt Recycling',
      short: "An Australian strategy that pays down non-deductible home loan debt, then redraws and invests that amount so the interest on the new debt becomes tax-deductible.",
      category: 'strategy',
      related: ['negative-gearing', 'offset-account'],
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TERMS;
  if (typeof root !== 'undefined') root.kvGlossaryData = TERMS;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

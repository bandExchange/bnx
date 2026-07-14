import { Chart, registerables } from "chart.js";
import "chartjs-adapter-date-fns";
import {
  CandlestickController,
  CandlestickElement,
} from "chartjs-chart-financial";

Chart.register(...registerables, CandlestickController, CandlestickElement);

const MINUTE_MS = 60 * 1000;
const CANDLE_INTERVAL_MIN = 10;
const CANDLE_MS = CANDLE_INTERVAL_MIN * MINUTE_MS;
const STORAGE_KEY = "virtualStockMarket_v14";
const MARKET_OPEN = 8;
const MARKET_CLOSE = 18;
const MARKET_OPEN_MIN = MARKET_OPEN * 60;
const MARKET_CLOSE_MIN = MARKET_CLOSE * 60;
const LAST_CANDLE_MIN = MARKET_CLOSE_MIN - CANDLE_INTERVAL_MIN;
const MAX_HISTORY = 600;
const DEFAULT_VISIBLE_CANDLES = 42;
const MIN_VISIBLE_CANDLES = 10;
const MAX_VISIBLE_CANDLES = 100;
const PRICE_TICK = 10;
const CANDLES_PER_HOUR = 60 / CANDLE_INTERVAL_MIN;
const HOUR_MS = 60 * MINUTE_MS;
const PRICE_UPDATE_INTERVAL_MS = 2000;
const DAILY_LIMIT_RATIO = 0.3;

const CHART_FONT = "'Paperlogy Thin', sans-serif";
const CHART_UP_COLOR = "rgba(255, 77, 79, 1)";
const CHART_DOWN_COLOR = "rgba(77, 171, 247, 1)";
const CHART_NEUTRAL_COLOR = "rgba(148, 163, 184, 1)";

function getThemeColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getChartTheme() {
  return {
    grid: getThemeColor("--chart-grid"),
    gridVolume: getThemeColor("--chart-grid-volume"),
    tick: getThemeColor("--chart-tick"),
    tickMuted: getThemeColor("--chart-tick-muted"),
    sessionDivider: getThemeColor("--chart-session-divider"),
  };
}

const COMPANIES = [
  {
    id: "A",
    name: "APEX Tech",
    displayName: "에이펙스 테크놀로지",
    logo: "/apextechnology.png",
    symbol: "AXTG",
    sector: "반도체",
    accent: "#3b82f6",
    basePrice: 235000,
    volatility: 0.018,
    // 장중 전일대비 고정 (마감까지 유지)
    targetDayChangePct: -0.04,
  },
  {
    id: "B",
    name: "NextPlay Games",
    displayName: "넥스트플레이 게임즈",
    logo: "/nextplaygames.png",
    symbol: "NPGE",
    sector: "게임",
    accent: "#a855f7",
    basePrice: 100500,
    volatility: 0.025,
  },
  {
    id: "C",
    name: "QM Entertainment",
    displayName: "큐엠 엔터테인먼트",
    logo: "/qmenter.png",
    symbol: "QMNT",
    sector: "엔터테인먼트",
    accent: "#f59e0b",
    basePrice: 438000,
    volatility: 0.022,
    targetDayChangePct: -0.1,
  },
];

let state = loadState();
let mainChart = null;
let volumeChart = null;
let selectedCompanyId = "A";
const chartViewState = { userAdjusted: false, followLatest: true };
let panDragState = null;
let panPointerId = null;
let touchPanState = null;
let pinchState = null;
const lastPriceTickBucket = {};
const hourTrendState = {};

function clearPanInteraction(stack) {
  if (panPointerId != null && stack?.hasPointerCapture?.(panPointerId)) {
    try {
      stack.releasePointerCapture(panPointerId);
    } catch (_) {}
  }
  panDragState = null;
  panPointerId = null;
  touchPanState = null;
  stack?.classList.remove("chart-stack--panning");
}

function getTouchMidpointX(touches) {
  return (touches[0].clientX + touches[1].clientX) / 2;
}

function panChartFromDrag(startX, currentX, startMin, startMax) {
  if (!mainChart?.chartArea) return;
  const chartWidth = mainChart.chartArea.right - mainChart.chartArea.left;
  if (!chartWidth) return;
  const span = startMax - startMin;
  const deltaIndex = ((startX - currentX) * span) / chartWidth;
  applySyncedIndexRange(startMin + deltaIndex, startMax + deltaIndex);
  markChartAdjusted();
}

function zoomChartFromPinch(startDist, currentDist, startMin, startMax, centerClientX) {
  if (!mainChart?.scales?.x || !startDist) return;
  const factor = currentDist / startDist;
  const span = (startMax - startMin) / factor;

  let center = (startMin + startMax) / 2;
  const { chartArea, scales, canvas } = mainChart;
  if (chartArea && canvas) {
    const rect = canvas.getBoundingClientRect();
    const x = centerClientX - rect.left;
    if (x >= chartArea.left && x <= chartArea.right) {
      const value = scales.x.getValueForPixel(x);
      if (value != null && !Number.isNaN(value)) center = value;
    }
  }

  applySyncedIndexRange(center - span / 2, center + span / 2);
  markChartAdjusted();
}

function endPinchInteraction() {
  pinchState = null;
}

const sessionDividerPlugin = {
  id: "sessionDivider",
  afterDraw(chart) {
    const history = chart.$history;
    if (!history?.length) return;

    const { ctx, chartArea, scales } = chart;
    for (let i = 1; i < history.length; i++) {
      const prevDay = new Date(history[i - 1].timestamp).toDateString();
      const nextDay = new Date(history[i].timestamp).toDateString();
      if (prevDay === nextDay) continue;

      const x = scales.x.getPixelForValue(i - 0.5);
      if (x < chartArea.left || x > chartArea.right) continue;

      ctx.save();
      ctx.strokeStyle = getChartTheme().sessionDivider;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }
  },
};

Chart.register(sessionDividerPlugin);

function getVisibleIndexRange(history, xMin, xMax) {
  const start = Math.max(0, Math.ceil(xMin + 0.5));
  const end = Math.min(history.length - 1, Math.floor(xMax - 0.5));
  return { start, end };
}

function findVisibleExtremes(history, xMin, xMax) {
  const { start, end } = getVisibleIndexRange(history, xMin, xMax);
  if (start > end) return null;

  let highIdx = start;
  let lowIdx = start;
  let maxHigh = history[start].high;
  let minLow = history[start].low;

  for (let i = start + 1; i <= end; i++) {
    if (history[i].high > maxHigh) {
      maxHigh = history[i].high;
      highIdx = i;
    }
    if (history[i].low < minLow) {
      minLow = history[i].low;
      lowIdx = i;
    }
  }

  return {
    high: { index: highIdx, price: maxHigh, candle: history[highIdx] },
    low: { index: lowIdx, price: minLow, candle: history[lowIdx] },
  };
}

function drawExtremeLabel(ctx, chart, point, type, currentPrice) {
  const { scales, chartArea } = chart;
  const x = scales.x.getPixelForValue(point.index);
  if (x < chartArea.left + 4 || x > chartArea.right - 4) return;

  const yWick = scales.y.getPixelForValue(point.price);
  const pct = point.price === 0 ? 0 : ((currentPrice - point.price) / point.price) * 100;
  const label = `${formatPriceLabel(point.price)} (${formatPercent(pct, 1)}, ${formatShortDate(point.candle.timestamp)})`;
  const isHigh = type === "high";
  const color = isHigh ? CHART_UP_COLOR : CHART_DOWN_COLOR;
  const textY = isHigh ? yWick - 22 : yWick + 28;
  const arrowY = isHigh ? yWick - 5 : yWick + 14;

  ctx.save();
  ctx.font = `normal 11px ${CHART_FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, x, textY);
  ctx.font = `normal 12px ${CHART_FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText(isHigh ? "↓" : "↑", x, arrowY);
  ctx.restore();
}

const extremePointLabelsPlugin = {
  id: "extremePointLabels",
  afterDraw(chart) {
    if (chart.config.type !== "candlestick") return;

    const history = chart.$history;
    const xScale = chart.scales?.x;
    const yScale = chart.scales?.y;
    if (!history?.length || !xScale || !yScale) return;

    const extremes = findVisibleExtremes(history, xScale.min, xScale.max);
    if (!extremes) return;

    const currentPrice = history[history.length - 1].close;
    const { ctx } = chart;

    drawExtremeLabel(ctx, chart, extremes.high, "high", currentPrice);
    drawExtremeLabel(ctx, chart, extremes.low, "low", currentPrice);
  },
};

Chart.register(extremePointLabelsPlugin);

function markChartAdjusted() {
  chartViewState.userAdjusted = true;
  chartViewState.followLatest = false;
}

function getIndexBounds(history) {
  const len = history.length || 1;
  return { min: -0.5, max: len - 0.5 };
}

function getDefaultVisibleCandles() {
  const chartWidth = Math.min(window.innerWidth, 480) - 40;
  return Math.max(28, Math.min(DEFAULT_VISIBLE_CANDLES, Math.floor(chartWidth / 8.5)));
}

function clampIndexRange(min, max, history) {
  const bounds = getIndexBounds(history);
  const len = history.length || 1;
  let span = max - min;
  const minSpan = Math.min(MIN_VISIBLE_CANDLES, len);
  const maxSpan = Math.min(MAX_VISIBLE_CANDLES, len);

  if (span < minSpan) {
    const center = (min + max) / 2;
    span = minSpan;
    min = center - span / 2;
    max = center + span / 2;
  }

  if (span > maxSpan) {
    const center = (min + max) / 2;
    span = maxSpan;
    min = center - span / 2;
    max = center + span / 2;
  }

  min = Math.max(bounds.min, min);
  max = Math.min(bounds.max, max);

  if (max - min < minSpan) {
    min = Math.max(bounds.min, max - minSpan);
  }

  return { min, max };
}

function applySyncedIndexRange(min, max) {
  const history = getChartHistory(selectedCompanyId);
  const range = clampIndexRange(min, max, history);
  [mainChart, volumeChart].forEach((chart) => {
    if (!chart) return;
    chart.options.scales.x.min = range.min;
    chart.options.scales.x.max = range.max;
  });
  mainChart?.update("none");
  volumeChart?.update("none");
}

function getDefaultViewRange(history) {
  const visible = getDefaultVisibleCandles();
  const len = history.length;
  if (!len) return { min: -0.5, max: visible - 0.5 };
  return {
    min: Math.max(-0.5, len - visible),
    max: len - 0.5,
  };
}

function applyDefaultChartView(history) {
  chartViewState.userAdjusted = false;
  chartViewState.followLatest = true;
  const { min, max } = getDefaultViewRange(history);
  applySyncedIndexRange(min, max);
}

function isAtLatestEdge(history) {
  if (!mainChart?.scales?.x) return true;
  return mainChart.scales.x.max >= history.length - 2;
}

function zoomChartBy(factor) {
  if (!mainChart?.scales?.x) return;
  const { min, max } = mainChart.scales.x;
  const center = (min + max) / 2;
  const span = (max - min) / factor;
  applySyncedIndexRange(center - span / 2, center + span / 2);
  markChartAdjusted();
}

function zoomChartAtPointer(factor, clientX) {
  if (!mainChart?.scales?.x) return;
  const { chartArea, scales, canvas } = mainChart;
  if (!chartArea) return;

  let center = (scales.x.min + scales.x.max) / 2;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;

  if (x >= chartArea.left && x <= chartArea.right) {
    const value = scales.x.getValueForPixel(x);
    if (value != null && !Number.isNaN(value)) center = value;
  }

  const span = (scales.x.max - scales.x.min) / factor;
  applySyncedIndexRange(center - span / 2, center + span / 2);
  markChartAdjusted();
}

function resetChartZoom() {
  applyDefaultChartView(getChartHistory(selectedCompanyId));
}

function panChartByIndices(deltaIndex) {
  if (!mainChart?.scales?.x) return;
  const { min, max } = mainChart.scales.x;
  applySyncedIndexRange(min + deltaIndex, max + deltaIndex);
  markChartAdjusted();
}

function panChartByPixels(deltaPixels) {
  if (!mainChart?.scales?.x || !mainChart.chartArea) return;
  const { chartArea, scales } = mainChart;
  const span = scales.x.max - scales.x.min;
  const chartWidth = chartArea.right - chartArea.left;
  if (!chartWidth) return;
  const deltaIndex = (deltaPixels * span) / chartWidth;
  panChartByIndices(deltaIndex);
}

function normalizeWheelDelta(event) {
  let { deltaX, deltaY } = event;
  if (event.deltaMode === 1) {
    deltaX *= 16;
    deltaY *= 16;
  } else if (event.deltaMode === 2) {
    deltaX *= 400;
    deltaY *= 400;
  }
  return { deltaX, deltaY };
}

function handleChartWheel(event) {
  if (!mainChart) return;
  event.preventDefault();
  event.stopPropagation();

  const { deltaX, deltaY } = normalizeWheelDelta(event);
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (absX > absY && absX > 0.5) {
    panChartByPixels(deltaX);
    return;
  }

  if (event.shiftKey && absY > 0.5) {
    panChartByPixels(deltaY);
    return;
  }

  if (absY < 0.5) return;

  const intensity = Math.min(0.22, 0.04 + absY * 0.004);
  const factor = deltaY < 0 ? 1 + intensity : 1 - intensity;
  zoomChartAtPointer(factor, event.clientX);
}

function getTouchDistance(touches) {
  const [a, b] = touches;
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function bindZoomControls() {
  document.getElementById("zoomIn")?.addEventListener("click", () => zoomChartBy(1.25));
  document.getElementById("zoomOut")?.addEventListener("click", () => zoomChartBy(0.8));
  document.getElementById("zoomReset")?.addEventListener("click", resetChartZoom);
}

function bindChartInteractions() {
  const stack = document.querySelector(".chart-stack");
  if (!stack) return;

  const captureOpts = { passive: false, capture: true };

  stack.addEventListener("wheel", handleChartWheel, captureOpts);

  stack.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "mouse") return;
      if (event.target.closest("button")) return;
      if (!mainChart?.scales?.x) return;

      clearPanInteraction(stack);
      panPointerId = event.pointerId;
      panDragState = {
        startX: event.clientX,
        startMin: mainChart.scales.x.min,
        startMax: mainChart.scales.x.max,
      };
      stack.setPointerCapture(event.pointerId);
      stack.classList.add("chart-stack--panning");
      event.preventDefault();
    },
    captureOpts
  );

  stack.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType !== "mouse") return;
      if (panPointerId !== event.pointerId || !panDragState) return;
      panChartFromDrag(
        panDragState.startX,
        event.clientX,
        panDragState.startMin,
        panDragState.startMax
      );
      event.preventDefault();
    },
    captureOpts
  );

  const endPointerPan = (event) => {
    if (event.pointerType !== "mouse") return;
    if (panPointerId !== event.pointerId) return;
    clearPanInteraction(stack);
  };

  stack.addEventListener("pointerup", endPointerPan, captureOpts);
  stack.addEventListener("pointercancel", endPointerPan, captureOpts);

  stack.addEventListener(
    "touchstart",
    (event) => {
      if (!mainChart?.scales?.x) return;
      if (event.target.closest("button")) return;

      if (event.touches.length === 2) {
        clearPanInteraction(stack);
        pinchState = {
          startDist: getTouchDistance(event.touches),
          startMin: mainChart.scales.x.min,
          startMax: mainChart.scales.x.max,
        };
        stack.classList.add("chart-stack--panning");
        event.preventDefault();
        return;
      }

      if (event.touches.length === 1) {
        touchPanState = {
          startX: event.touches[0].clientX,
          startMin: mainChart.scales.x.min,
          startMax: mainChart.scales.x.max,
        };
        stack.classList.add("chart-stack--panning");
        event.preventDefault();
      }
    },
    captureOpts
  );

  stack.addEventListener(
    "touchmove",
    (event) => {
      if (!mainChart?.scales?.x) return;

      if (pinchState && event.touches.length >= 2) {
        event.preventDefault();
        zoomChartFromPinch(
          pinchState.startDist,
          getTouchDistance(event.touches),
          pinchState.startMin,
          pinchState.startMax,
          getTouchMidpointX(event.touches)
        );
        return;
      }

      if (touchPanState && event.touches.length === 1) {
        event.preventDefault();
        panChartFromDrag(
          touchPanState.startX,
          event.touches[0].clientX,
          touchPanState.startMin,
          touchPanState.startMax
        );
      }
    },
    captureOpts
  );

  stack.addEventListener(
    "touchend",
    (event) => {
      if (event.touches.length === 0) {
        endPinchInteraction();
        clearPanInteraction(stack);
        return;
      }

      if (event.touches.length === 1 && pinchState) {
        endPinchInteraction();
        touchPanState = {
          startX: event.touches[0].clientX,
          startMin: mainChart.scales.x.min,
          startMax: mainChart.scales.x.max,
        };
      }
    },
    captureOpts
  );

  stack.addEventListener("touchcancel", () => {
    endPinchInteraction();
    clearPanInteraction(stack);
  }, captureOpts);
}

function floorToCandle(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const mins = d.getHours() * 60 + d.getMinutes();
  const flooredMins = Math.floor(mins / CANDLE_INTERVAL_MIN) * CANDLE_INTERVAL_MIN;
  d.setHours(Math.floor(flooredMins / 60), flooredMins % 60, 0, 0);
  return d;
}

function toDayMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function setDayMinutes(date, minutes) {
  const d = new Date(date);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

function lastCandleOfDay(date) {
  return setDayMinutes(date, LAST_CANDLE_MIN);
}

function candleVolatility(volatility) {
  const candlesPerHour = 60 / CANDLE_INTERVAL_MIN;
  return volatility / Math.sqrt(candlesPerHour);
}

function isMarketOpen(now = new Date()) {
  const mins = toDayMinutes(now);
  return mins >= MARKET_OPEN_MIN && mins < MARKET_CLOSE_MIN;
}

function getCurrentCandleStart(now = new Date()) {
  return floorToCandle(now);
}

function getLatestCompletedCandleTime(now = new Date()) {
  const floored = floorToCandle(now);
  const candidate = new Date(floored.getTime() - CANDLE_MS);
  const candMins = toDayMinutes(candidate);

  if (candMins >= MARKET_OPEN_MIN && candMins <= LAST_CANDLE_MIN) {
    return candidate;
  }

  const sessionEnd = lastCandleOfDay(floored);
  if (toDayMinutes(floored) >= MARKET_CLOSE_MIN) {
    return sessionEnd;
  }

  const prevDay = new Date(floored);
  prevDay.setDate(prevDay.getDate() - 1);
  return lastCandleOfDay(prevDay);
}

function formatPrice(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return roundToPriceTick(value).toLocaleString("ko-KR");
}

function formatPriceLabel(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return roundToPriceTick(value).toLocaleString("ko-KR") + "원";
}

function formatPercent(value, decimals = 2) {
  const sign = value >= 0 ? "+" : "";
  return sign + value.toFixed(decimals) + "%";
}

function formatShortDate(iso) {
  const date = new Date(iso);
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}`;
}

function formatTime(date) {
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function formatAxisTick(history, index) {
  const candle = history[Math.round(index)];
  if (!candle) return "";
  const date = new Date(candle.timestamp);
  const mins = toDayMinutes(date);
  if (mins % 60 !== 0) return "";
  return formatTime(date);
}

function formatVolume(value) {
  if (value == null || Number.isNaN(value)) return "—";
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + "M";
  if (value >= 1_000) return (value / 1_000).toFixed(0) + "K";
  return String(Math.round(value));
}

function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function roundToPriceTick(value) {
  return Math.round(value / PRICE_TICK) * PRICE_TICK;
}

function getDailyPriceLimits(referenceClose) {
  const ref = roundToPriceTick(referenceClose);
  return {
    lower: roundToPriceTick(ref * (1 - DAILY_LIMIT_RATIO)),
    upper: roundToPriceTick(ref * (1 + DAILY_LIMIT_RATIO)),
  };
}

function clampToDailyLimits(value, limits) {
  return roundToPriceTick(Math.min(limits.upper, Math.max(limits.lower, value)));
}

function getDailyLimitsForHistory(history, candleDate, fallbackReference) {
  const dayKey = new Date(candleDate).toDateString();
  let reference = fallbackReference;

  for (let i = history.length - 1; i >= 0; i--) {
    if (new Date(history[i].timestamp).toDateString() !== dayKey) {
      reference = history[i].close;
      break;
    }
  }

  return getDailyPriceLimits(reference);
}

function randomChange(volatility, seed) {
  const r1 = seededRandom(seed * 1.37);
  const r2 = seededRandom(seed * 2.91 + 17);
  const noise = (r1 + r2 - 1) * volatility;
  const drift = (seededRandom(seed * 0.53) - 0.48) * volatility * 0.3;
  return noise + drift;
}

function generateCandle(openPrice, volatility, seed, limits) {
  const open = clampToDailyLimits(openPrice, limits);
  let price = open;
  let high = open;
  let low = open;

  for (let i = 0; i < 3; i++) {
    const change = randomChange(volatility * 0.6, seed + i * 13);
    price = clampToDailyLimits(price * (1 + change), limits);
    high = Math.max(high, price);
    low = Math.min(low, price);
  }

  const close = clampToDailyLimits(price, limits);
  const priceMove = Math.abs(close - open) / Math.max(open, 1);
  const volume = Math.round(
    (60_000 + open * 0.45) * CANDLE_INTERVAL_MIN * (0.35 + seededRandom(seed * 5.17) * 1.9 + priceMove * 12)
  );

  return {
    open,
    high: clampToDailyLimits(Math.max(high, open, close), limits),
    low: clampToDailyLimits(Math.min(low, open, close), limits),
    close,
    volume,
    changeRate: open === 0 ? 0 : ((close - open) / open) * 100,
  };
}

function getPinnedTargetPrice(prevClose, targetDayChangePct, limits) {
  return clampToDailyLimits(
    roundToPriceTick(prevClose * (1 + targetDayChangePct)),
    limits
  );
}

/** 전일대비 고정 종목: 목표가 근처에서 소폭 등락하는 캔들 */
function generatePinnedCandle(openPrice, targetPrice, seed, limits) {
  const open = clampToDailyLimits(openPrice, limits);
  const wobbleTicks = Math.round((seededRandom(seed * 2.17) - 0.5) * 4) * PRICE_TICK;
  const close = clampToDailyLimits(targetPrice + wobbleTicks, limits);
  const wick = PRICE_TICK * (1 + Math.floor(seededRandom(seed * 4.1) * 3));
  const high = clampToDailyLimits(Math.max(open, close) + wick, limits);
  const low = clampToDailyLimits(Math.min(open, close) - wick, limits);
  const priceMove = Math.abs(close - open) / Math.max(open, 1);
  const volume = Math.round(
    (60_000 + open * 0.45) * CANDLE_INTERVAL_MIN * (0.35 + seededRandom(seed * 5.17) * 1.9 + priceMove * 12)
  );

  return {
    open,
    high,
    low,
    close,
    volume,
    changeRate: open === 0 ? 0 : ((close - open) / open) * 100,
  };
}

function nextTradingCandleTime(time) {
  const d = new Date(time.getTime() + CANDLE_MS);

  if (toDayMinutes(d) >= MARKET_CLOSE_MIN) {
    d.setDate(d.getDate() + 1);
    return setDayMinutes(d, MARKET_OPEN_MIN);
  }

  return d;
}

function ensureVolume(history) {
  history.forEach((h) => {
    if (h.volume == null) {
      const seed = new Date(h.timestamp).getTime();
      const move = Math.abs(h.close - h.open) / Math.max(h.open, 1);
      h.volume = Math.round(
        (60_000 + h.close * 0.45) * CANDLE_INTERVAL_MIN * (0.4 + seededRandom(seed * 3.11) * 1.6 + move * 10)
      );
    }
  });
  return history;
}

function getTodayKey(date = new Date()) {
  return date.toDateString();
}

function isToday(timestamp) {
  return new Date(timestamp).toDateString() === getTodayKey();
}

function generateDayHistory(company, dayDate, endTime, startClose, options = {}) {
  const dayOpen = setDayMinutes(new Date(dayDate), MARKET_OPEN_MIN);
  const end = new Date(endTime);
  const isSameDay = end.toDateString() === new Date(dayDate).toDateString();
  const limit = isSameDay ? end : lastCandleOfDay(dayDate);
  const history = [];
  let lastClose = roundToPriceTick(startClose);
  const limits = getDailyPriceLimits(startClose);
  const vol = candleVolatility(company.volatility);
  const pin =
    options.pinTargetDayChange && company.targetDayChangePct != null;
  const targetPrice = pin
    ? getPinnedTargetPrice(startClose, company.targetDayChangePct, limits)
    : null;
  let cursor = new Date(dayOpen);

  while (cursor.getTime() <= limit.getTime()) {
    const mins = toDayMinutes(cursor);
    if (mins >= MARKET_OPEN_MIN && mins <= LAST_CANDLE_MIN) {
      const seed = cursor.getTime() + company.symbol.charCodeAt(0);
      const candle = pin
        ? generatePinnedCandle(lastClose, targetPrice, seed, limits)
        : generateCandle(lastClose, vol, seed, limits);
      history.push({ timestamp: cursor.toISOString(), ...candle });
      lastClose = candle.close;
    }
    if (mins >= LAST_CANDLE_MIN) break;
    cursor = new Date(cursor.getTime() + CANDLE_MS);
  }

  return history;
}

function generateHistory(company, endTime) {
  const end = new Date(endTime);
  const prevDay = new Date(end);
  prevDay.setDate(prevDay.getDate() - 1);

  let lastClose = roundToPriceTick(company.basePrice);
  let history = generateDayHistory(company, prevDay, lastCandleOfDay(prevDay), lastClose);
  if (history.length) lastClose = history[history.length - 1].close;

  history = history.concat(
    generateDayHistory(company, end, end, lastClose, { pinTargetDayChange: true })
  );
  return ensureVolume(history);
}

function createLiveCandle(startTime, openPrice) {
  const open = roundToPriceTick(openPrice);
  return {
    timestamp: startTime.toISOString(),
    open,
    high: open,
    low: open,
    close: open,
    volume: 0,
  };
}

function ensureLiveCandle(company) {
  const cs = state.companies[company.id];
  if (cs.liveCandle) return cs.liveCandle;

  const history = cs.history;
  const lastClose = history.length ? history[history.length - 1].close : company.basePrice;
  const start = getCurrentCandleStart(new Date());
  cs.liveCandle = createLiveCandle(start, lastClose);
  return cs.liveCandle;
}

function finalizeLiveCandle(company) {
  const cs = state.companies[company.id];
  if (!cs.liveCandle) return false;

  cs.history.push({ ...cs.liveCandle });
  if (cs.history.length > MAX_HISTORY) {
    cs.history = cs.history.slice(-MAX_HISTORY);
  }

  cs.lastCandle = cs.liveCandle.timestamp;
  const lastClose = cs.liveCandle.close;
  const nextStart = nextTradingCandleTime(new Date(cs.liveCandle.timestamp));
  cs.liveCandle = createLiveCandle(nextStart, lastClose);
  return true;
}

function maybeFinalizeLiveCandles(now = new Date()) {
  if (!isMarketOpen(now)) return false;

  let finalized = false;

  COMPANIES.forEach((company) => {
    const cs = state.companies[company.id];
    ensureLiveCandle(company);
    const currentStart = getCurrentCandleStart(now);
    let liveStart = new Date(cs.liveCandle.timestamp);

    while (currentStart.getTime() > liveStart.getTime()) {
      finalizeLiveCandle(company);
      finalized = true;
      liveStart = new Date(cs.liveCandle.timestamp);
      if (liveStart.getTime() >= currentStart.getTime()) break;
    }
  });

  if (finalized) saveState();
  return finalized;
}

function getHourWindow(now = new Date()) {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  const startMs = start.getTime();
  return { start: startMs, end: startMs + HOUR_MS };
}

function getCandlesInHour(history, live, hourStart, hourEnd) {
  const candles = live ? [...history, live] : [...history];
  return candles.filter((c) => {
    const t = new Date(c.timestamp).getTime();
    return t >= hourStart && t < hourEnd;
  });
}

function getAverageClose(candles) {
  if (!candles.length) return null;
  return candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
}

function initHourTrend(company, now = new Date()) {
  const { start, end } = getHourWindow(now);
  const cs = state.companies[company.id];
  const prevStart = start - HOUR_MS;
  const prevCandles = getCandlesInHour(cs.history, cs.liveCandle, prevStart, start);
  const prevAvg = roundToPriceTick(
    getAverageClose(prevCandles) ??
      cs.history.at(-1)?.close ??
      company.basePrice
  );
  const direction = seededRandom(start + company.symbol.charCodeAt(0)) >= 0.5 ? 1 : -1;

  hourTrendState[company.id] = {
    hourStart: start,
    direction,
    targetAvg: roundToPriceTick(prevAvg + direction * PRICE_TICK),
    baseAvg: prevAvg,
  };
}

function getHourTrend(company, now = new Date()) {
  const { start } = getHourWindow(now);
  if (!hourTrendState[company.id] || hourTrendState[company.id].hourStart !== start) {
    initHourTrend(company, now);
  }
  return hourTrendState[company.id];
}

function getHourlyPriceMove(company, now = new Date()) {
  const trend = getHourTrend(company, now);
  const { start, end } = getHourWindow(now);
  const cs = state.companies[company.id];
  const hourCandles = getCandlesInHour(cs.history, cs.liveCandle, start, end);
  const currentAvg = getAverageClose(hourCandles);

  if (currentAvg == null) return trend.direction * PRICE_TICK;
  if (currentAvg < trend.targetAvg) return PRICE_TICK;
  if (currentAvg > trend.targetAvg) return -PRICE_TICK;
  return trend.direction * PRICE_TICK;
}

function getTimeTickBucket(now = new Date()) {
  return Math.floor(now.getTime() / PRICE_UPDATE_INTERVAL_MS);
}

function applyTimeTick(now = new Date()) {
  if (!isMarketOpen(now)) return false;

  const finalized = maybeFinalizeLiveCandles(now);
  const bucket = getTimeTickBucket(now);
  let changed = finalized;

  COMPANIES.forEach((company) => {
    if (lastPriceTickBucket[company.id] === bucket) return;

    const cs = state.companies[company.id];
    const live = ensureLiveCandle(company);
    const prevClose = getPrevDayClose(company.id);
    const limits = getDailyLimitsForHistory(cs.history, now, prevClose);
    let nextPrice;

    if (company.targetDayChangePct != null) {
      const target = getPinnedTargetPrice(
        prevClose,
        company.targetDayChangePct,
        limits
      );
      const wobble =
        Math.round((seededRandom(bucket * 1.91 + company.symbol.charCodeAt(0)) - 0.5) * 2) *
        PRICE_TICK;
      nextPrice = clampToDailyLimits(target + wobble, limits);
    } else {
      const move = getHourlyPriceMove(company, now);
      nextPrice = clampToDailyLimits(live.close + move, limits);
    }

    lastPriceTickBucket[company.id] = bucket;

    if (nextPrice === live.close) return;

    live.close = nextPrice;
    live.high = Math.max(live.high, nextPrice);
    live.low = Math.min(live.low, nextPrice);
    const seed = bucket + company.symbol.charCodeAt(0);
    live.volume += Math.round(400 + seededRandom(seed * 1.7) * 1200);
    changed = true;
  });

  return changed;
}

function createInitialState() {
  const endTime = getLatestCompletedCandleTime(new Date());
  const companies = {};

  COMPANIES.forEach((c) => {
    const history = generateHistory(c, endTime);
    const lastClose = history.length ? history[history.length - 1].close : c.basePrice;
    const liveStart = isMarketOpen() ? getCurrentCandleStart() : new Date(endTime);

    companies[c.id] = {
      history,
      lastCandle: endTime.toISOString(),
      liveCandle: createLiveCandle(liveStart, lastClose),
    };
  });

  return { companies, createdAt: new Date().toISOString(), version: 14 };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.companies?.A?.history?.[0]?.open != null && parsed.version === 14) {
        COMPANIES.forEach((c) => {
          ensureVolume(parsed.companies[c.id].history);
          ensureLiveCandle(c);
        });
        return parsed;
      }
    }
  } catch (_) {}
  return createInitialState();
}

function saveState() {
  state.version = 14;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getLivePrice(companyId) {
  const live = state.companies[companyId]?.liveCandle;
  if (live) return live.close;
  return getLatest(companyId)?.close ?? 0;
}

function getDisplayHistory(companyId) {
  const history = state.companies[companyId].history;
  const live = state.companies[companyId].liveCandle;
  if (!live) return [...history];
  return [...history, live];
}

function getLatest(companyId) {
  const history = state.companies[companyId].history;
  return history[history.length - 1];
}

function getChartHistory(companyId) {
  return getDisplayHistory(companyId);
}

function getTodayHistory(companyId) {
  return state.companies[companyId].history.filter((h) => isToday(h.timestamp));
}

function getPrevDayClose(companyId) {
  const history = state.companies[companyId].history;
  const todayKey = getTodayKey();

  for (let i = history.length - 1; i >= 0; i--) {
    if (new Date(history[i].timestamp).toDateString() === todayKey) continue;
    return history[i].close;
  }

  const today = history.filter((h) => isToday(h.timestamp));
  return today[0]?.open ?? getLivePrice(companyId);
}

function getDayChange(companyId) {
  const currentPrice = getLivePrice(companyId);
  const prevClose = getPrevDayClose(companyId);
  const diff = currentPrice - prevClose;
  const pct = prevClose === 0 ? 0 : (diff / prevClose) * 100;
  return { diff, pct, isUp: diff >= 0, latest: { close: currentPrice } };
}

function toCandlestickData(history) {
  return history.map((h, i) => ({
    x: i,
    o: h.open,
    h: h.high,
    l: h.low,
    c: h.close,
  }));
}

function candleColors() {
  // chartjs-chart-financial compares canvas pixel y (not price): up = bullish, down = bearish
  return {
    up: CHART_UP_COLOR,
    down: CHART_DOWN_COLOR,
    unchanged: CHART_NEUTRAL_COLOR,
  };
}

function buildCandleDataset(company, history) {
  const colors = candleColors();

  return {
    label: company.name,
    data: toCandlestickData(history),
    backgroundColors: colors,
    borderColors: colors,
    borderWidth: 1,
  };
}

function toVolumeData(history) {
  return history.map((h, i) => ({
    x: i,
    y: h.volume,
    isUp: h.close >= h.open,
  }));
}

function buildVolumeDataset(history) {
  const colors = history.map((h) =>
    h.close >= h.open ? CHART_UP_COLOR : CHART_DOWN_COLOR
  );

  return {
    label: "거래량",
    data: toVolumeData(history),
    backgroundColor: colors,
    hoverBackgroundColor: colors,
    borderColor: colors,
    hoverBorderColor: colors,
    borderWidth: 1,
    borderSkipped: false,
  };
}

function candlestickOptions(history) {
  const { min, max } = getDefaultViewRange(history);
  const theme = getChartTheme();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    events: [],
    layout: {
      padding: { top: 30, right: 4, bottom: 4, left: 4 },
    },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
    elements: {
      candlestick: {
        borderWidth: 1,
        backgroundColors: candleColors(),
        borderColors: candleColors(),
      },
    },
    scales: {
      x: {
        type: "linear",
        min,
        max,
        grid: { color: theme.grid, drawTicks: false },
        border: { display: false },
        ticks: { display: false },
      },
      y: {
        position: "right",
        grace: "6%",
        grid: { color: theme.grid },
        border: { display: false },
        ticks: {
          color: theme.tick,
          font: { size: 11, family: CHART_FONT },
          maxTicksLimit: 6,
          padding: 6,
          callback: (v) => formatPrice(v),
        },
      },
    },
  };
}

function volumeChartOptions(history) {
  const { min, max } = getDefaultViewRange(history);
  const theme = getChartTheme();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    events: [],
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
    elements: {
      bar: {
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        type: "linear",
        min,
        max,
        grid: { color: theme.gridVolume, drawTicks: false },
        border: { display: false },
        ticks: {
          color: theme.tick,
          maxTicksLimit: 10,
          font: { size: 10, family: CHART_FONT },
          callback: (value) => formatAxisTick(history, value),
        },
      },
      y: {
        position: "right",
        grace: "8%",
        grid: { color: theme.gridVolume },
        border: { display: false },
        ticks: {
          color: theme.tickMuted,
          maxTicksLimit: 3,
          padding: 6,
          font: { size: 10, family: CHART_FONT },
          callback: (v) => formatVolume(v),
        },
      },
    },
  };
}

function refreshChartTheme() {
  if (!mainChart || !volumeChart) return;

  const history = getChartHistory(selectedCompanyId);
  const xMin = mainChart.scales.x.min;
  const xMax = mainChart.scales.x.max;

  mainChart.options = candlestickOptions(history);
  volumeChart.options = volumeChartOptions(history);
  mainChart.options.scales.x.min = xMin;
  mainChart.options.scales.x.max = xMax;
  volumeChart.options.scales.x.min = xMin;
  volumeChart.options.scales.x.max = xMax;
  mainChart.update("none");
  volumeChart.update("none");
}

function bindThemeWatcher() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", refreshChartTheme);
}

function renderChartQuoteStructure() {
  const container = document.getElementById("chartQuote");
  if (!container) return;

  const company = COMPANIES.find((c) => c.id === selectedCompanyId);
  const price = getLivePrice(selectedCompanyId);

  container.innerHTML = `
    <div class="chart-quote__name-row">
      <span class="chart-quote__logo-wrap">
        <img class="chart-quote__logo" src="${company.logo}" alt="${company.displayName} 로고" />
      </span>
      <h1 class="chart-quote__name">${company.displayName}</h1>
    </div>
    <div class="chart-quote__price-row">
      <span class="chart-quote__price-value" id="chartQuotePrice">${formatPrice(price)}</span>
      <span class="chart-quote__price-unit">원</span>
    </div>
    <p class="chart-quote__change" id="chartQuoteChange"></p>
  `;

  updateChartQuoteChange();
}

function updateChartQuoteChange() {
  const changeEl = document.getElementById("chartQuoteChange");
  if (!changeEl) return;

  const { diff, pct, isUp } = getDayChange(selectedCompanyId);
  const sign = diff >= 0 ? "+" : "-";
  changeEl.className = `chart-quote__change ${isUp ? "up" : "down"}`;
  changeEl.textContent = `전일보다 ${sign}${roundToPriceTick(Math.abs(diff)).toLocaleString("ko-KR")}원 (${formatPercent(pct)})`;
}

function updateLiveQuoteUI(companyId) {
  if (companyId !== selectedCompanyId) return;
  const priceEl = document.getElementById("chartQuotePrice");
  if (priceEl) priceEl.textContent = formatPrice(getLivePrice(companyId));
  updateChartQuoteChange();
}

function renderChartQuote() {
  renderChartQuoteStructure();
}

function renderCharts() {
  const company = COMPANIES.find((c) => c.id === selectedCompanyId);
  const history = getDisplayHistory(selectedCompanyId);

  chartViewState.userAdjusted = false;
  chartViewState.followLatest = true;

  if (mainChart) mainChart.destroy();
  if (volumeChart) volumeChart.destroy();

  mainChart = new Chart(document.getElementById("mainChart").getContext("2d"), {
    type: "candlestick",
    data: { datasets: [buildCandleDataset(company, history)] },
    options: candlestickOptions(history),
  });
  mainChart.$history = history;

  volumeChart = new Chart(document.getElementById("volumeChart").getContext("2d"), {
    type: "bar",
    data: { datasets: [buildVolumeDataset(history)] },
    options: volumeChartOptions(history),
  });
  volumeChart.$history = history;

  applyDefaultChartView(history);
}

function updateChartsLive() {
  if (!mainChart || !volumeChart) return;

  const company = COMPANIES.find((c) => c.id === selectedCompanyId);
  const history = getDisplayHistory(selectedCompanyId);
  const followLatest = chartViewState.followLatest || isAtLatestEdge(history);
  const prevSpan = mainChart.scales.x.max - mainChart.scales.x.min;

  mainChart.data.datasets[0].data = toCandlestickData(history);
  volumeChart.data.datasets[0] = buildVolumeDataset(history);
  mainChart.$history = history;
  volumeChart.$history = history;

  mainChart.update("none");
  volumeChart.update("none");

  if (followLatest) {
    const max = history.length - 0.5;
    const visible = getDefaultVisibleCandles();
    const min = Math.max(-0.5, max - visible);
    applySyncedIndexRange(min, max);
  } else {
    const max = history.length - 0.5;
    applySyncedIndexRange(max - prevSpan, max);
  }
}

function renderCompanyTabs() {
  const container = document.getElementById("companyTabs");
  if (!container) return;

  container.innerHTML = COMPANIES.map(
    (c) => `
      <button class="btn ${c.id === selectedCompanyId ? "active" : ""}" data-company="${c.id}">
        ${c.name}
      </button>
    `
  ).join("");

  container.querySelectorAll("[data-company]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedCompanyId = btn.dataset.company;
      renderCompanyTabs();
      renderChartQuote();
      renderCharts();
    });
  });
}

function refreshUI() {
  renderChartQuote();
  renderCompanyTabs();
  renderCharts();
}

function tick() {
  if (!applyTimeTick()) return;

  updateLiveQuoteUI(selectedCompanyId);
  updateChartsLive();
}

let tickInterval = null;

export function initStockApp() {
  if (tickInterval) return;

  COMPANIES.forEach((c) => ensureLiveCandle(c));
  bindZoomControls();
  bindChartInteractions();
  bindThemeWatcher();
  refreshUI();
  tickInterval = setInterval(tick, 1000);
}

export function destroyStockApp() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }

  if (mainChart) {
    mainChart.destroy();
    mainChart = null;
  }

  if (volumeChart) {
    volumeChart.destroy();
    volumeChart = null;
  }
}

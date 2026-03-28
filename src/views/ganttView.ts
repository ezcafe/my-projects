import * as d3 from 'd3';
import type { Project } from '../models/domain';
import { listProjects } from '../services/projectService';
import { goToProject, goToAddProject } from '../router';
import { getTheme, getGanttPaletteForTheme, subscribeToTheme } from '../services/themeService';
import { getMilestoneDates, MILESTONE_OFFSETS_DAYS } from '../utils/milestoneDates';
import {
  isSupported as isNotificationSupported,
  getPermission as getNotificationPermission,
  requestPermission as requestNotificationPermission,
  runProjectDateNotifications,
} from '../services/notificationService';

const ROW_HEIGHT = 32;
const ROW_GAP = 8;
const AXIS_LEVEL1_HEIGHT = 16;
const AXIS_LEVEL2_HEIGHT = 20;
const AXIS_BARS_GAP = 24;
const MARGIN = {
  top: AXIS_LEVEL1_HEIGHT + AXIS_LEVEL2_HEIGHT + AXIS_BARS_GAP,
  bottom: AXIS_LEVEL1_HEIGHT + AXIS_LEVEL2_HEIGHT,
  left: 0,
  right: 0,
};
const AXIS_ROW1_TOP = 0;
const AXIS_ROW2_TOP = AXIS_LEVEL1_HEIGHT;
const TICK_PX = 24;
/** Tick line length for level 2 axis (matches d3 axisBottom default tickSizeInner). */
const AXIS_LEVEL2_TICK_LINE_HEIGHT = 6;

export type ZoomLevel = 'day' | 'month' | 'quarter';

const ZOOM_LEVELS: ZoomLevel[] = ['day', 'month', 'quarter'];

interface TimelineWindow {
  start: Date;
  end: Date;
  tickCount: number;
  tickValues: Date[];
  tickFormat: (d: Date) => string;
  tickValuesLevel1: Date[];
  tickFormatLevel1: (d: Date) => string;
  periodMs: number;
  fullRange?: { start: Date; end: Date };
  viewportStartTime?: number;
}

interface TimelineBuildOptions {
  projects?: Project[];
  dayViewportStart?: number;
  monthViewportStart?: number;
  quarterViewportStart?: number;
}

function startOfDay(d: Date): Date {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  return t;
}

function startOfQuarter(d: Date): Date {
  const t = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
  t.setHours(0, 0, 0, 0);
  return t;
}

function addQuarters(d: Date, n: number): Date {
  const t = new Date(d);
  t.setMonth(t.getMonth() + n * 3);
  return t;
}

function quarterRange(start: Date, count: number): Date[] {
  return d3.range(count + 1).map((i) => addQuarters(start, i));
}

function quarterCount(d: Date): number {
  return Math.floor(d.getMonth() / 3);
}


function buildTimelineFromViewport(
  chartWidth: number,
  zoomLevel: ZoomLevel,
  options?: TimelineBuildOptions,
): TimelineWindow {
  const tickCount = Math.max(1, Math.floor(chartWidth / TICK_PX));
  const today = new Date();
  const now = startOfDay(today);

  let start: Date;
  let end: Date;
  let tickValues: Date[];
  let tickFormat: (d: Date) => string;
  let tickValuesLevel1: Date[];
  let tickFormatLevel1: (d: Date) => string;
  let periodMs: number;
  let fullRange: { start: Date; end: Date } | undefined;
  let viewportStartTime: number | undefined;

  switch (zoomLevel) {
    case 'day': {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const PADDING_DAYS = 3;
      periodMs = DAY_MS;

      let fullStart: Date;
      let fullEnd: Date;
      const anchor = new Date(now);
      anchor.setDate(anchor.getDate() - 3);
      const anchorTime = anchor.getTime();

      if (options?.projects && options.projects.length > 0) {
        const starts = options.projects.map((p) => startOfDay(new Date(p.startDate)).getTime());
        const ends = options.projects.map((p) => startOfDay(new Date(p.endDate)).getTime());
        const minStart = Math.min(...starts);
        const maxEnd = Math.max(...ends);
        fullStart = new Date(Math.min(anchorTime, minStart) - PADDING_DAYS * DAY_MS);
        fullEnd = new Date(maxEnd + PADDING_DAYS * DAY_MS);
      } else {
        fullStart = new Date(anchorTime - PADDING_DAYS * DAY_MS);
        fullEnd = new Date(anchorTime + 30 * DAY_MS);
      }
      fullRange = { start: fullStart, end: fullEnd };

      const viewportDurationMs = tickCount * DAY_MS;
      const fullStartTime = fullStart.getTime();
      const fullEndTime = fullEnd.getTime();
      const maxViewportStart = fullEndTime - viewportDurationMs;

      let viewportStart: number;
      if (options?.dayViewportStart !== undefined) {
        viewportStart = Math.max(fullStartTime, Math.min(maxViewportStart, options.dayViewportStart));
      } else {
        viewportStart = Math.max(fullStartTime, Math.min(maxViewportStart, anchorTime));
      }
      viewportStartTime = viewportStart;

      start = new Date(viewportStart);
      end = new Date(viewportStart + viewportDurationMs);
      tickValues = d3.range(tickCount + 1).map((i) => {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        return d;
      });
      tickFormat = (d) => d.getDate().toString();
      tickValuesLevel1 = d3.timeMonths(d3.timeMonth.floor(start), end);
      tickFormatLevel1 = (d) => d3.timeFormat('%b %Y')(d);
      break;
    }
    case 'month': {
      const PADDING_MONTHS = 3;
      const anchorMonth = d3.timeMonth.floor(new Date(now));
      let fullStart: Date;
      let fullEnd: Date;
      if (options?.projects && options.projects.length > 0) {
        const starts = options.projects.map((p) => d3.timeMonth.floor(new Date(p.startDate)).getTime());
        const ends = options.projects.map((p) => d3.timeMonth.ceil(new Date(p.endDate)).getTime());
        const minStart = Math.min(...starts);
        const maxEnd = Math.max(...ends);
        fullStart = d3.timeMonth.offset(new Date(minStart), -PADDING_MONTHS);
        fullEnd = d3.timeMonth.offset(new Date(maxEnd), PADDING_MONTHS);
      } else {
        fullStart = d3.timeMonth.offset(anchorMonth, -PADDING_MONTHS);
        fullEnd = d3.timeMonth.offset(anchorMonth, 24);
      }
      fullRange = { start: fullStart, end: fullEnd };

      const fullStartTime = fullStart.getTime();
      const fullEndTime = fullEnd.getTime();
      const viewportDurationMonthsMs = d3.timeMonth.offset(fullStart, tickCount).getTime() - fullStart.getTime();
      const maxViewportStartMonth = fullEndTime - viewportDurationMonthsMs;

      let viewportStart: number;
      if (options?.monthViewportStart !== undefined) {
        viewportStart = Math.max(fullStartTime, Math.min(maxViewportStartMonth, options.monthViewportStart));
      } else {
        viewportStart = Math.max(fullStartTime, Math.min(maxViewportStartMonth, anchorMonth.getTime()));
      }
      viewportStartTime = viewportStart;

      start = new Date(viewportStart);
      end = d3.timeMonth.offset(start, tickCount);
      tickValues = d3.timeMonths(start, end, 1);
      tickFormat = (d) => d3.timeFormat('%b')(d);
      let q = startOfQuarter(start);
      if (q < start) q = addQuarters(q, 1);
      tickValuesLevel1 = [];
      for (; q < end; q = addQuarters(q, 1)) {
        tickValuesLevel1.push(new Date(q));
      }
      tickFormatLevel1 = (d) =>
        `Q${quarterCount(d) + 1} ${d.getFullYear()}`;
      periodMs =
        (end.getTime() - start.getTime()) / tickCount ||
        30 * 24 * 60 * 60 * 1000;
      break;
    }
    case 'quarter': {
      const PADDING_QUARTERS = 2;
      const anchorQuarter = startOfQuarter(new Date(now));
      let fullStart: Date;
      let fullEnd: Date;
      if (options?.projects && options.projects.length > 0) {
        const starts = options.projects.map((p) => startOfQuarter(new Date(p.startDate)).getTime());
        const ends = options.projects.map((p) => addQuarters(startOfQuarter(new Date(p.endDate)), 1).getTime());
        const minStart = Math.min(...starts);
        const maxEnd = Math.max(...ends);
        fullStart = addQuarters(new Date(minStart), -PADDING_QUARTERS);
        fullEnd = addQuarters(new Date(maxEnd), PADDING_QUARTERS);
      } else {
        fullStart = addQuarters(anchorQuarter, -PADDING_QUARTERS);
        fullEnd = addQuarters(anchorQuarter, 12);
      }
      fullRange = { start: fullStart, end: fullEnd };

      const viewportDurationQuartersMs = (addQuarters(fullStart, tickCount).getTime() - fullStart.getTime());
      const fullStartTime = fullStart.getTime();
      const fullEndTime = fullEnd.getTime();
      const maxViewportStartQuarter = fullEndTime - viewportDurationQuartersMs;

      let viewportStart: number;
      if (options?.quarterViewportStart !== undefined) {
        viewportStart = Math.max(fullStartTime, Math.min(maxViewportStartQuarter, options.quarterViewportStart));
      } else {
        viewportStart = Math.max(fullStartTime, Math.min(maxViewportStartQuarter, anchorQuarter.getTime()));
      }
      viewportStartTime = viewportStart;

      start = new Date(viewportStart);
      end = addQuarters(start, tickCount);
      tickValues = quarterRange(start, tickCount);
      tickFormat = (d) => `Q${quarterCount(d) + 1}`;
      tickValuesLevel1 = d3.timeYears(d3.timeYear(start), end);
      tickFormatLevel1 = (d) => d3.timeFormat('%Y')(d);
      periodMs =
        (end.getTime() - start.getTime()) / tickCount ||
        90 * 24 * 60 * 60 * 1000;
      break;
    }
  }

  const result: TimelineWindow = {
    start,
    end,
    tickCount,
    tickValues,
    tickFormat,
    tickValuesLevel1,
    tickFormatLevel1,
    periodMs,
  };
  if (fullRange !== undefined) result.fullRange = fullRange;
  if (viewportStartTime !== undefined) result.viewportStartTime = viewportStartTime;
  return result;
}

function projectOverlapsRange(
  p: Project,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  const s = new Date(p.startDate);
  const e = new Date(p.endDate);
  return e >= rangeStart && s <= rangeEnd;
}

/** Clamp project start/end to viewport so the bar only shows the visible segment. */
function visibleBarRange(
  p: Project,
  viewportStart: Date,
  viewportEnd: Date,
): { start: Date; end: Date } {
  const s = new Date(p.startDate);
  const e = new Date(p.endDate);
  return {
    start: s < viewportStart ? new Date(viewportStart) : s,
    end: e > viewportEnd ? new Date(viewportEnd) : e,
  };
}

const BAR_RADIUS = 6;

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

const STATUS_LABELS: Record<string, string> = {
  NotStarted: 'Not started',
  InProgress: 'In progress',
  Blocked: 'Blocked',
  Done: 'Done',
};

const PRIORITY_LABELS: Record<string, string> = {
  Low: 'Low',
  Medium: 'Medium',
  High: 'High',
  Critical: 'Critical',
};

const MILESTONE_LABELS = ['1 week before end', '2 weeks before end', '1 month before end'] as const;

function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatProjectDateRange(project: Project): string {
  const start = formatShortDate(new Date(project.startDate));
  const end = formatShortDate(new Date(project.endDate));
  return `${start} – ${end}`;
}

function getMilestoneLines(project: Project): string[] {
  const endDate = new Date(project.endDate);
  const dates = getMilestoneDates(endDate, MILESTONE_OFFSETS_DAYS);
  const reversedDates = [...dates].reverse();
  const reversedLabels = [...MILESTONE_LABELS].reverse();
  return reversedDates.map((d, i) => `${formatShortDate(d)} — ${reversedLabels[i] ?? `${i + 1}`}`);
}

function buildBarTooltipHtml(project: Project): string {
  const name = escapeHtml(project.name);
  const status = STATUS_LABELS[project.status] ?? project.status;
  const priority = PRIORITY_LABELS[project.priority] ?? project.priority;
  const dateRange = formatProjectDateRange(project);
  const milestoneLines = getMilestoneLines(project);
  const milestonesHtml =
    milestoneLines.length > 0
      ? `<ul class="gantt-tooltip__milestones">${milestoneLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      : '<p class="gantt-tooltip__no-milestones">No milestones in range.</p>';
  return `
    <div class="gantt-tooltip__title">${name}</div>
    <dl class="gantt-tooltip__meta">
      <dt>Priority</dt><dd><span class="badge badge-priority-${project.priority}">${escapeHtml(priority)}</span></dd>
      <dt>Status</dt><dd><span class="badge badge-status-${project.status}">${escapeHtml(status)}</span></dd>
      <dt>Date</dt><dd>${escapeHtml(dateRange)}</dd>
    </dl>
    <div class="gantt-tooltip__section">
      <div class="gantt-tooltip__section-title">Milestones</div>
      ${milestonesHtml}
    </div>
  `;
}

/** Path `d` for a bar with optional left/right border radius (only when that edge is inside viewport). */
function ganttBarPathD(
  barLeft: number,
  barRight: number,
  roundLeft: boolean,
  roundRight: boolean,
): string {
  const x1 = barLeft;
  const x2 = barRight;
  const h = ROW_HEIGHT;
  const R = BAR_RADIUS;
  if (roundLeft && roundRight) {
    return `M ${x1 + R},0 L ${x2 - R},0 Q ${x2},0 ${x2},${R} L ${x2},${h - R} Q ${x2},${h} ${x2 - R},${h} L ${x1 + R},${h} Q ${x1},${h} ${x1},${h - R} L ${x1},${R} Q ${x1},0 ${x1 + R},0 Z`;
  }
  if (roundLeft) {
    return `M ${x1 + R},0 L ${x2},0 L ${x2},${h} L ${x1 + R},${h} Q ${x1},${h} ${x1},${h - R} L ${x1},${R} Q ${x1},0 ${x1 + R},0 Z`;
  }
  if (roundRight) {
    return `M ${x1},0 L ${x2 - R},0 Q ${x2},0 ${x2},${R} L ${x2},${h - R} Q ${x2},${h} ${x2 - R},${h} L ${x1},${h} Z`;
  }
  return `M ${x1},0 L ${x2},0 L ${x2},${h} L ${x1},${h} Z`;
}

export async function renderGanttView(root: HTMLElement) {
  root.innerHTML = `
    <div class="app-shell">
      <div class="gantt-notification-banner" id="gantt-notification-banner" role="status" aria-live="polite" hidden>
        <span class="gantt-notification-banner__text">Get notified when projects start, end, or hit milestones.</span>
        <button type="button" class="gantt-notification-banner__enable" id="gantt-notification-enable">Enable</button>
      </div>
      <main class="app-main">
        <div class="gantt-container">
          <svg class="gantt-svg"></svg>
        </div>
      </main>
      <button class="fab" aria-label="Add project">+</button>
    </div>
  `;

  const svgEl = root.querySelector<SVGSVGElement>('.gantt-svg');
  const container = root.querySelector<HTMLDivElement>('.gantt-container');
  const fab = root.querySelector<HTMLButtonElement>('.fab');
  const banner = root.querySelector<HTMLDivElement>('#gantt-notification-banner');
  const enableBtn = root.querySelector<HTMLButtonElement>('#gantt-notification-enable');
  if (!svgEl || !container || !fab) return;

  if (banner && enableBtn && isNotificationSupported()) {
    const updateBannerVisibility = () => {
      if (getNotificationPermission() === 'default') {
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
    };
    updateBannerVisibility();
    enableBtn.addEventListener('click', async () => {
      const permission = await requestNotificationPermission();
      if (permission === 'granted') {
        await runProjectDateNotifications();
      }
      updateBannerVisibility();
    });
  }

  fab.onclick = () => {
    goToAddProject();
  };

  const allProjects = await listProjects();
  const projects = allProjects.filter((p) => p.status !== 'Done');

  const redraw = () => {
    drawGantt(svgEl, projects, getZoomLevel(container));
  };

  redraw();

  subscribeToTheme(() => {
    redraw();
  });

  const resizeObserver = new ResizeObserver(() => {
    redraw();
  });
  resizeObserver.observe(container);
}

let currentZoomLevel: ZoomLevel = 'day';

function getZoomLevel(container: HTMLElement): ZoomLevel {
  const z = (container as ContainerWithZoom).__zoomLevel;
  return z ?? currentZoomLevel;
}

function setZoomLevel(container: HTMLElement, level: ZoomLevel) {
  currentZoomLevel = level;
  (container as ContainerWithZoom).__zoomLevel = level;
}

interface SVGWithTimer extends SVGSVGElement {
  __todayTimerId?: number;
}

interface ContainerWithZoom extends HTMLDivElement {
  __zoomLevel?: ZoomLevel;
  __dayViewportStart?: number;
  __dayPanTransformDx?: number;
  __monthViewportStart?: number;
  __monthPanTransformDx?: number;
  __quarterViewportStart?: number;
  __quarterPanTransformDx?: number;
}

function drawGantt(
  svgEl: SVGSVGElement,
  projects: Project[],
  zoomLevel: ZoomLevel,
) {
  const width = svgEl.clientWidth || svgEl.parentElement?.clientWidth || 1200;
  const chartWidth = width - MARGIN.left;
  const container = svgEl.closest('.gantt-container') as ContainerWithZoom | null;

  const timelineOptions: TimelineBuildOptions = {
    projects,
    dayViewportStart: container?.__dayViewportStart,
    monthViewportStart: container?.__monthViewportStart,
    quarterViewportStart: container?.__quarterViewportStart,
  };
  const timeline = buildTimelineFromViewport(chartWidth, zoomLevel, timelineOptions);

  if (container) {
    if (zoomLevel === 'day') {
      if (timeline.viewportStartTime !== undefined) {
        container.__dayViewportStart = timeline.viewportStartTime;
      }
    } else if (zoomLevel === 'month') {
      if (timeline.viewportStartTime !== undefined) {
        container.__monthViewportStart = timeline.viewportStartTime;
      }
    } else if (zoomLevel === 'quarter') {
      if (timeline.viewportStartTime !== undefined) {
        container.__quarterViewportStart = timeline.viewportStartTime;
      }
    }
  }

  const usePannableRange = !!timeline.fullRange;
  const visibleProjects = usePannableRange
    ? projects
    : projects.filter((p) =>
        projectOverlapsRange(p, timeline.start, timeline.end),
      );

  const contentHeight =
    MARGIN.top +
    MARGIN.bottom +
    visibleProjects.length * (ROW_HEIGHT + ROW_GAP) +
    40;

  const containerHeight = svgEl.parentElement?.clientHeight ?? contentHeight;
  const height = Math.max(containerHeight, contentHeight);

  const svgWithTimer = svgEl as SVGWithTimer;
  if (svgWithTimer.__todayTimerId !== undefined) {
    window.clearInterval(svgWithTimer.__todayTimerId);
    svgWithTimer.__todayTimerId = undefined;
  }

  const svg = d3
    .select(svgEl)
    .attr('width', width)
    .attr('height', height);

  svg.selectAll('*').remove();

  const viewportDurationMs = timeline.end.getTime() - timeline.start.getTime();
  let xScale: d3.ScaleTime<number, number>;
  let chartRightEdge: number;
  let fullRangeStart: Date;
  let fullRangeEnd: Date;
  let contentWidth: number;

  if (usePannableRange && timeline.fullRange) {
    fullRangeStart = timeline.fullRange.start;
    fullRangeEnd = timeline.fullRange.end;
    const fullDurationMs = fullRangeEnd.getTime() - fullRangeStart.getTime();
    contentWidth = (fullDurationMs / viewportDurationMs) * chartWidth;
    chartRightEdge = MARGIN.left + chartWidth;
    /* When content is narrower than viewport, span the scale over full viewport so ticks fill the width */
    const scaleRangeRight = Math.max(contentWidth, chartWidth);
    xScale = d3
      .scaleTime()
      .domain([fullRangeStart, fullRangeEnd])
      .range([MARGIN.left, MARGIN.left + scaleRangeRight]);
    if (container && contentWidth > chartWidth) {
      if (zoomLevel === 'day') container.__dayPanTransformDx = 0;
      else if (zoomLevel === 'month') container.__monthPanTransformDx = 0;
      else container.__quarterPanTransformDx = 0;
    }
  } else {
    fullRangeStart = timeline.start;
    fullRangeEnd = timeline.end;
    contentWidth = chartWidth;
    chartRightEdge = width - MARGIN.right;
    xScale = d3
      .scaleTime()
      .domain([timeline.start, timeline.end])
      .range([MARGIN.left, width]);
  }

  const yScale = (_: Project, index: number) =>
    MARGIN.top + index * (ROW_HEIGHT + ROW_GAP);

  let chartContentGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  if (usePannableRange) {
    const viewportClipX = xScale(timeline.start);
    svg
      .append('defs')
      .append('clipPath')
      .attr('id', 'gantt-viewport-clip')
      .append('rect')
      .attr('x', MARGIN.left)
      .attr('y', 0)
      .attr('width', chartWidth)
      .attr('height', height);
    const clipWrapper = svg
      .append('g')
      .attr('class', 'gantt-viewport-clip-wrapper')
      .attr('clip-path', 'url(#gantt-viewport-clip)');
    chartContentGroup = clipWrapper
      .append('g')
      .attr('class', 'gantt-chart-content')
      .attr('transform', `translate(${MARGIN.left - viewportClipX},0)`);
    if (contentWidth <= chartWidth && container) {
      /* Scale already spans viewport; keep content at viewport left (no pan offset when narrow) */
      chartContentGroup.attr('transform', 'translate(0,0)');
    }
  } else {
    chartContentGroup = svg
      .append('g')
      .attr('class', 'gantt-chart-content')
      .attr('transform', 'translate(0,0)');
  }

  const axisContainer = chartContentGroup
    .append('g')
    .attr('class', 'gantt-axis-container')
    .attr('transform', 'translate(0,0)');

  /* When content is narrow, span axis/borders to full viewport (match scale range) */
  const axisRightX = usePannableRange
    ? MARGIN.left + Math.max(contentWidth, chartWidth)
    : width;
  const axisLevel1RightX =
    usePannableRange && (zoomLevel === 'month' || zoomLevel === 'quarter')
      ? MARGIN.left + chartWidth
      : axisRightX;
  axisContainer
    .append('line')
    .attr('class', 'gantt-axis-level1-border-left')
    .attr('x1', MARGIN.left)
    .attr('y1', AXIS_ROW1_TOP)
    .attr('x2', MARGIN.left)
    .attr('y2', AXIS_LEVEL1_HEIGHT);
  axisContainer
    .append('line')
    .attr('class', 'gantt-axis-level1-border-right')
    .attr('x1', axisLevel1RightX)
    .attr('y1', AXIS_ROW1_TOP)
    .attr('x2', axisLevel1RightX)
    .attr('y2', AXIS_LEVEL1_HEIGHT);
  axisContainer
    .append('line')
    .attr('class', 'gantt-axis-level1-border-bottom')
    .attr('x1', MARGIN.left)
    .attr('y1', AXIS_LEVEL1_HEIGHT)
    .attr('x2', axisLevel1RightX)
    .attr('y2', AXIS_LEVEL1_HEIGHT);

  const chartRight = chartRightEdge;
  const level1RangeStart =
    usePannableRange && (zoomLevel === 'month' || zoomLevel === 'quarter')
      ? timeline.start
      : fullRangeStart;
  const level1RangeEnd =
    usePannableRange && (zoomLevel === 'month' || zoomLevel === 'quarter')
      ? timeline.end
      : fullRangeEnd;
  const level1BoundaryDates =
    usePannableRange && zoomLevel === 'day'
      ? d3.timeMonths(d3.timeMonth.floor(fullRangeStart), fullRangeEnd)
      : usePannableRange && zoomLevel === 'month'
        ? (() => {
            const qs: Date[] = [];
            let q = startOfQuarter(level1RangeStart);
            if (q < level1RangeStart) q = addQuarters(q, 1);
            for (; q < level1RangeEnd; q = addQuarters(q, 1)) qs.push(new Date(q));
            return qs;
          })()
        : usePannableRange && zoomLevel === 'quarter'
          ? d3.timeYears(d3.timeYear(level1RangeStart), level1RangeEnd)
          : timeline.tickValuesLevel1;
  /* When pannable, draw full range so panned view shows axis/time-sticks without redraw; clip path hides out-of-viewport. */
  const level1BoundaryXFiltered = [
    xScale(level1RangeStart),
    ...level1BoundaryDates.map((d) => xScale(d)),
    xScale(level1RangeEnd),
  ];
  const level1BoundaryX = usePannableRange
    ? level1BoundaryXFiltered
    : level1BoundaryXFiltered.filter((x) => x >= MARGIN.left && x <= chartRight);

  axisContainer
    .selectAll('line.gantt-axis-boundary')
    .data(level1BoundaryX)
    .join('line')
    .attr('class', 'gantt-axis-boundary')
    .attr('x1', (d) => d)
    .attr('x2', (d) => d)
    .attr('y1', AXIS_ROW1_TOP)
    .attr('y2', AXIS_LEVEL1_HEIGHT);

  const level1Segments: { xStart: number; xEnd: number; label: string }[] = [];
  if (usePannableRange) {
    const segmentStarts = level1BoundaryDates.length > 0
      ? [level1RangeStart, ...level1BoundaryDates]
      : [level1RangeStart];
    const segmentEnds = level1BoundaryDates.length > 0
      ? [...level1BoundaryDates, level1RangeEnd]
      : [level1RangeEnd];
    const level1LabelFormat = zoomLevel === 'day' ? (d: Date) => d3.timeFormat('%b %Y')(d) : timeline.tickFormatLevel1;
    for (let i = 0; i < segmentStarts.length; i++) {
      const segmentStart = segmentStarts[i];
      const segmentEnd = segmentEnds[i];
      if (segmentStart >= segmentEnd) continue;
      level1Segments.push({
        xStart: xScale(segmentStart),
        xEnd: xScale(segmentEnd),
        label: level1LabelFormat(segmentStart),
      });
    }
  } else {
    for (let i = 0; i <= timeline.tickValuesLevel1.length; i++) {
      const segmentStart =
        i === 0 ? timeline.start : timeline.tickValuesLevel1[i - 1];
      const segmentEnd =
        i < timeline.tickValuesLevel1.length
          ? timeline.tickValuesLevel1[i]
          : timeline.end;
      if (segmentStart >= segmentEnd) continue;
      level1Segments.push({
        xStart: xScale(segmentStart),
        xEnd: xScale(segmentEnd),
        label: timeline.tickFormatLevel1(segmentStart),
      });
    }
  }
  if (level1Segments.length === 0 && level1RangeStart < level1RangeEnd) {
    level1Segments.push({
      xStart: xScale(level1RangeStart),
      xEnd: xScale(level1RangeEnd),
      label: usePannableRange && zoomLevel === 'day' ? d3.timeFormat('%b %Y')(level1RangeStart) : timeline.tickFormatLevel1(timeline.start),
    });
  }

  const level1SegmentsWithIndex = level1Segments.map((d, i) => ({ ...d, index: i, total: level1Segments.length }));
  axisContainer
    .append('g')
    .attr('class', 'gantt-axis gantt-axis-level1')
    .selectAll('text')
    .data(level1SegmentsWithIndex)
    .enter()
    .append('text')
    .attr('class', 'gantt-axis-text gantt-axis-text-level1')
    .attr('x', (d) =>
      d.index === 0 ? d.xStart + 4 : d.index === d.total - 1 ? d.xEnd - 4 : (d.xStart + d.xEnd) / 2)
    .attr('y', AXIS_LEVEL1_HEIGHT / 2)
    .attr('text-anchor', (d) => (d.index === 0 ? 'start' : d.index === d.total - 1 ? 'end' : 'middle'))
    .attr('dominant-baseline', 'middle')
    .text((d) => d.label);

  /* Viewport-only ticks for top level2 axis (readable labels). */
  const fullRangeTickValues =
    usePannableRange && timeline.fullRange && zoomLevel === 'day'
      ? (() => {
          const tickCount = Math.max(1, Math.floor(chartWidth / TICK_PX));
          const startT = timeline.start.getTime();
          const endT = timeline.end.getTime();
          return d3.range(tickCount + 1).map((i) => new Date(startT + (i / tickCount) * (endT - startT)));
        })()
      : timeline.tickValues;

  /* Full-range ticks for time-sticks and bottom axis so they render for entire content on first load. */
  const fullRangeTickValuesForDrawing =
    usePannableRange && timeline.fullRange
      ? zoomLevel === 'day'
        ? d3.timeDays(fullRangeStart, d3.timeDay.offset(fullRangeEnd, 1))
        : zoomLevel === 'month'
          ? d3.timeMonths(fullRangeStart, d3.timeMonth.offset(fullRangeEnd, 1))
          : (() => {
              const qs: Date[] = [];
              let q = startOfQuarter(fullRangeStart);
              if (q < fullRangeStart) q = addQuarters(q, 1);
              for (; q <= fullRangeEnd; q = addQuarters(q, 1)) qs.push(new Date(q));
              return qs;
            })()
      : fullRangeTickValues;
  const axisLevel2Format = zoomLevel === 'day' && usePannableRange ? (d: Date) => d.getDate().toString() : timeline.tickFormat;
  /* Use full-range ticks when pannable so level2 text is pre-rendered for pan (clip shows viewport only). */
  const axisLevel2 = d3
    .axisBottom<Date>(xScale)
    .tickValues(fullRangeTickValuesForDrawing)
    .tickFormat(axisLevel2Format as (d: d3.NumberValue) => string);

  axisContainer
    .append('g')
    .attr('class', 'gantt-axis gantt-axis-level2')
    .attr('transform', `translate(0,${AXIS_ROW2_TOP})`)
    .call(axisLevel2)
    .selectAll('text')
    .attr('class', 'gantt-axis-text gantt-axis-text-level2');
  const level2Ticks = axisContainer.select('.gantt-axis-level2').selectAll('.tick');
  if (!level2Ticks.empty()) {
    level2Ticks.filter((_, i) => i === 0).select('text').attr('text-anchor', 'start').attr('dx', '0.25em');
    level2Ticks.filter((_, i, n) => i === n.length - 1).select('text').attr('text-anchor', 'end').attr('dx', '-0.25em');
  }
  axisContainer.select('.gantt-axis-level2 path.domain').remove();

  /* Bottom axis: clone with opposite direction (level 2 -> level 1, level 1 -> level 2) */
  const bottomAxisY = height - MARGIN.bottom;
  const axisContainerBottom = chartContentGroup
    .append('g')
    .attr('class', 'gantt-axis-container gantt-axis-container-bottom')
    .attr('transform', `translate(0,${bottomAxisY})`);

  axisContainerBottom
    .append('line')
    .attr('class', 'gantt-axis-level1-border-left')
    .attr('x1', MARGIN.left)
    .attr('y1', 0)
    .attr('x2', MARGIN.left)
    .attr('y2', AXIS_LEVEL1_HEIGHT + AXIS_LEVEL2_HEIGHT);
  axisContainerBottom
    .append('line')
    .attr('class', 'gantt-axis-level1-border-right')
    .attr('x1', axisLevel1RightX)
    .attr('y1', 0)
    .attr('x2', axisLevel1RightX)
    .attr('y2', AXIS_LEVEL1_HEIGHT + AXIS_LEVEL2_HEIGHT);
  axisContainerBottom
    .append('line')
    .attr('class', 'gantt-axis-level1-border-bottom')
    .attr('x1', MARGIN.left)
    .attr('y1', AXIS_LEVEL2_HEIGHT)
    .attr('x2', axisLevel1RightX)
    .attr('y2', AXIS_LEVEL2_HEIGHT);

  /* Row 1 (top of bottom axis): level 2 boundaries – use full range when pannable so stripes render on first load */
  const level2BoundaryXBottom = fullRangeTickValuesForDrawing.map((d) => xScale(d));
  axisContainerBottom
    .selectAll('line.gantt-axis-boundary-level2-bottom')
    .data(level2BoundaryXBottom)
    .join('line')
    .attr('class', 'gantt-axis-boundary gantt-axis-boundary-level2-bottom')
    .attr('x1', (d) => d)
    .attr('x2', (d) => d)
    .attr('y1', AXIS_LEVEL2_HEIGHT)
    .attr('y2', AXIS_LEVEL2_HEIGHT - AXIS_LEVEL2_TICK_LINE_HEIGHT);

  /* Row 1: level 2 tick labels (full range when pannable) */
  const level2LabelData = fullRangeTickValuesForDrawing.map((d, i) => ({
    x: xScale(d),
    label: axisLevel2Format(d),
    index: i,
    total: fullRangeTickValuesForDrawing.length,
  }));
  axisContainerBottom
    .append('g')
    .attr('class', 'gantt-axis gantt-axis-level2')
    .attr('transform', `translate(0,0)`)
    .selectAll('text')
    .data(level2LabelData)
    .enter()
    .append('text')
    .attr('class', 'gantt-axis-text gantt-axis-text-level2')
    .attr('x', (d) =>
      d.index === 0 ? d.x + 4 : d.index === d.total - 1 ? d.x - 4 : d.x)
    .attr('y', AXIS_LEVEL2_HEIGHT / 2)
    .attr('text-anchor', (d) => (d.index === 0 ? 'start' : d.index === d.total - 1 ? 'end' : 'middle'))
    .attr('dominant-baseline', 'middle')
    .text((d) => d.label);

  /* Row 2 (bottom of bottom axis): level 1 content – boundaries (opposite: from bottom of row upward) */
  axisContainerBottom
    .selectAll('line.gantt-axis-boundary-level1-bottom')
    .data(level1BoundaryX)
    .join('line')
    .attr('class', 'gantt-axis-boundary gantt-axis-boundary-level1-bottom')
    .attr('x1', (d) => d)
    .attr('x2', (d) => d)
    .attr('y1', AXIS_LEVEL2_HEIGHT + AXIS_LEVEL1_HEIGHT)
    .attr('y2', AXIS_LEVEL2_HEIGHT);

  /* Row 2: level 1 segment labels */
  axisContainerBottom
    .append('g')
    .attr('class', 'gantt-axis gantt-axis-level1')
    .selectAll('text')
    .data(level1SegmentsWithIndex)
    .enter()
    .append('text')
    .attr('class', 'gantt-axis-text gantt-axis-text-level1')
    .attr('x', (d) =>
      d.index === 0 ? d.xStart + 4 : d.index === d.total - 1 ? d.xEnd - 4 : (d.xStart + d.xEnd) / 2)
    .attr('y', AXIS_LEVEL2_HEIGHT + AXIS_LEVEL1_HEIGHT / 2)
    .attr('text-anchor', (d) => (d.index === 0 ? 'start' : d.index === d.total - 1 ? 'end' : 'middle'))
    .attr('dominant-baseline', 'middle')
    .text((d) => d.label);

  const barsGroup = chartContentGroup.append('g').attr('class', 'gantt-bars');

  const LABEL_GAP = 8;
  const now = startOfDay(new Date());

  const positionBarLabel = (
    labelNode: SVGTextElement,
    project: Project,
    barLeft: number,
    barRight: number,
  ) => {
    const labelWidth = labelNode.getComputedTextLength();
    const projectStart = startOfDay(new Date(project.startDate));
    const projectEnd = startOfDay(new Date(project.endDate));
    const startInPast = projectStart < now;
    const startInFuture = projectStart >= now;
    const endInViewport = projectEnd <= barRangeEnd && projectEnd >= barRangeStart;
    const spaceBetweenNowAndStart = barLeft - xScale(now);

    const sel = d3.select(labelNode);
    const isDark = getTheme() === 'dark';
    const outsideLabelFill = isDark ? '#fff' : 'black';
    // Rule 1: start in past and end in viewport → anchor to right side of bar
    if (startInPast && endInViewport && width - barRight >= labelWidth + LABEL_GAP) {
      sel.attr('x', barRight + LABEL_GAP).attr('text-anchor', 'start');
      sel.style('fill', outsideLabelFill);
    }
    // Rule 2: start in future and enough space between current day and start → anchor to left side of bar
    else if (startInFuture && spaceBetweenNowAndStart >= labelWidth + LABEL_GAP) {
      sel.attr('x', barLeft - LABEL_GAP).attr('text-anchor', 'end');
      sel.style('fill', outsideLabelFill);
    }
    // Otherwise: inside the bar
    else {
      sel.attr('x', barLeft + 6).attr('text-anchor', 'start');
      sel.style('fill', '#fff');
    }
  };

  let tooltipEl: HTMLDivElement | null = container?.querySelector<HTMLDivElement>('.gantt-tooltip') ?? null;
  if (container && !tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'gantt-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.setAttribute('aria-hidden', 'true');
    container.appendChild(tooltipEl);
  }

  const barGroups = barsGroup
    .selectAll('g.gantt-bar-group')
    .data(visibleProjects)
    .enter()
    .append('g')
    .attr('class', 'gantt-bar-group')
    .attr('data-project-id', (d) => d.id)
    .attr('transform', (_, i) => `translate(0,${yScale(_, i)})`)
    .style('cursor', 'pointer')
    .on('click', (_, d) => {
      goToProject(d.id);
    })
    .on('mouseenter', function (_, d: Project) {
      if (!tooltipEl) return;
      tooltipEl.innerHTML = buildBarTooltipHtml(d);
      tooltipEl.setAttribute('aria-hidden', 'false');
      const rect = (this as SVGGElement).getBoundingClientRect();
      const tipRect = tooltipEl.getBoundingClientRect();
      const gap = 8;
      let left = rect.left + rect.width / 2 - tipRect.width / 2;
      let top = rect.top - tipRect.height - gap;
      if (left < 8) left = 8;
      if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
      if (top < 8) top = rect.bottom + gap;
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top = `${top}px`;
      tooltipEl.classList.add('gantt-tooltip--visible');
    })
    .on('mouseleave', () => {
      tooltipEl?.classList.remove('gantt-tooltip--visible');
      tooltipEl?.setAttribute('aria-hidden', 'true');
    });

  const palette = getGanttPaletteForTheme(getTheme());

  const barRangeStart = usePannableRange ? fullRangeStart : timeline.start;
  const barRangeEnd = usePannableRange ? fullRangeEnd : timeline.end;
  barGroups
    .append('path')
    .attr('class', 'gantt-bar')
    .attr('d', (d) => {
      const { start, end } = visibleBarRange(d, barRangeStart, barRangeEnd);
      const barLeft = xScale(start);
      const barRight = xScale(end);
      const w = Math.max(barRight - barLeft, 4);
      const roundLeft = new Date(d.startDate) >= barRangeStart;
      const roundRight = new Date(d.endDate) <= barRangeEnd;
      return ganttBarPathD(barLeft, barLeft + w, roundLeft, roundRight);
    })
    .attr('fill', (_, i) => palette[i % palette.length]);

  barGroups.each(function (d) {
    const { start, end } = visibleBarRange(d, barRangeStart, barRangeEnd);
    const barStart = startOfDay(new Date(d.startDate));
    const barEnd = startOfDay(new Date(d.endDate));
    const milestoneDates = getMilestoneDates(new Date(d.endDate), MILESTONE_OFFSETS_DAYS).filter(
      (m) => {
        const mDay = startOfDay(m);
        const inProjectRange = mDay > barStart && mDay <= barEnd;
        const inViewport = usePannableRange || (m >= start && m <= end);
        return inProjectRange && inViewport;
      },
    );
    const milestonesG = d3.select(this).append('g').attr('class', 'gantt-milestones');
    milestoneDates.forEach((milestoneDate) => {
      const x = xScale(milestoneDate);
      milestonesG
        .append('line')
        .attr('class', 'gantt-milestone-line')
        .attr('x1', x)
        .attr('x2', x)
        .attr('y1', 0)
        .attr('y2', ROW_HEIGHT)
        .attr('stroke', 'black')
        .attr('stroke-opacity', 0.1);
    });
  });

  barGroups
    .append('text')
    .attr('class', 'gantt-bar-label')
    .attr('y', ROW_HEIGHT / 2)
    .attr('dominant-baseline', 'middle')
    .attr('fill', '#fff')
    .style('font-size', '0.75rem')
    .style('pointer-events', 'none')
    .text((d) => d.name)
    .each(function (d) {
      const { start, end } = visibleBarRange(d, barRangeStart, barRangeEnd);
      const left = xScale(start);
      const right = xScale(end);
      positionBarLabel(this as SVGTextElement, d, left, right);
    });

  /* Today line above bars/labels/milestones, non-interactive */
  const todayLine = chartContentGroup
    .append('line')
    .attr('class', 'gantt-today-line')
    .attr('y1', 0)
    .attr('y2', height);

  const updateTodayLinePosition = () => {
    const now = new Date();
    const x = xScale(now);
    const inRange = usePannableRange
      ? now >= fullRangeStart && now <= fullRangeEnd
      : !Number.isNaN(x) && x >= MARGIN.left && x <= chartRight;
    if (!inRange) {
      todayLine.attr('display', 'none');
    } else {
      todayLine
        .attr('display', null)
        .attr('x1', x)
        .attr('x2', x);
    }
  };

  updateTodayLinePosition();
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  svgWithTimer.__todayTimerId = window.setInterval(
    updateTodayLinePosition,
    FIVE_MINUTES_MS,
  );

  if (container) {
    container.__zoomLevel = zoomLevel;
  }

  const backgroundRect = svg
    .append('rect')
    .attr('class', 'gantt-chart-background')
    .attr('width', width)
    .attr('height', height)
    .attr('x', 0)
    .attr('y', 0)
    .lower();

  const timeStickHeight = containerHeight - 32;
  const level2BoundaryX = fullRangeTickValuesForDrawing.map((d) => xScale(d));
  const timeStickSegments = d3.range(level2BoundaryX.length - 1).map((i) => ({
    xStart: level2BoundaryX[i],
    xEnd: level2BoundaryX[i + 1],
    index: i,
  }));
  const timeSticksG = chartContentGroup
    .insert('g', '.gantt-axis-container')
    .attr('class', 'gantt-time-sticks');
  timeSticksG
    .selectAll('rect')
    .data(timeStickSegments)
    .enter()
    .append('rect')
    .attr('class', (d) =>
      d.index % 2 === 0
        ? 'gantt-time-stick gantt-time-stick-even'
        : 'gantt-time-stick gantt-time-stick-odd',
    )
    .attr('x', (d) => d.xStart)
    .attr('y', AXIS_LEVEL1_HEIGHT)
    .attr('width', (d) => d.xEnd - d.xStart)
    .attr('height', timeStickHeight)
    .style('pointer-events', 'none');

  const getNextZoomLevel = (direction: 'in' | 'out'): ZoomLevel => {
    const idx = ZOOM_LEVELS.indexOf(zoomLevel);
    if (direction === 'in') {
      const next = idx - 1;
      return next < 0 ? ZOOM_LEVELS[0] : ZOOM_LEVELS[next];
    } else {
      const next = idx + 1;
      return next >= ZOOM_LEVELS.length
        ? ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
        : ZOOM_LEVELS[next];
    }
  };

  const applyZoom = (direction: 'in' | 'out') => {
    if (!container) return;
    const newLevel = getNextZoomLevel(direction);
    if (newLevel === zoomLevel) return;
    setZoomLevel(container, newLevel);
    drawGantt(svgEl, projects, newLevel);
  };

  const ZOOM_GESTURE_THRESHOLD = 30;

  let panStartX: number | null = null;
  let panStartViewportStart: number | null = null;
  let panAccumulatedDx = 0;
  let panMinDx = -Infinity;
  let panMaxDx = Infinity;
  const fullStartTime = timeline.fullRange?.start.getTime() ?? 0;
  const fullEndTime = timeline.fullRange?.end.getTime() ?? 0;

  const getViewportStart = (): number | undefined =>
    zoomLevel === 'day' ? container?.__dayViewportStart
    : zoomLevel === 'month' ? container?.__monthViewportStart
    : container?.__quarterViewportStart;

  const getPanTransformDx = (): number =>
    zoomLevel === 'day' ? (container?.__dayPanTransformDx ?? 0)
    : zoomLevel === 'month' ? (container?.__monthPanTransformDx ?? 0)
    : (container?.__quarterPanTransformDx ?? 0);

  const setViewportStart = (value: number) => {
    if (!container) return;
    if (zoomLevel === 'day') container.__dayViewportStart = value;
    else if (zoomLevel === 'month') container.__monthViewportStart = value;
    else container.__quarterViewportStart = value;
  };

  const setPanTransformDx = (value: number) => {
    if (!container) return;
    if (zoomLevel === 'day') container.__dayPanTransformDx = value;
    else if (zoomLevel === 'month') container.__monthPanTransformDx = value;
    else container.__quarterPanTransformDx = value;
  };

  const commitPan = () => {
    if (
      !usePannableRange ||
      !container ||
      !timeline.fullRange ||
      panStartViewportStart == null
    )
      return;
    if (contentWidth <= chartWidth) {
      setPanTransformDx(panAccumulatedDx);
    } else {
      const minViewportStart = fullStartTime;
      const maxViewportStart = fullEndTime - viewportDurationMs;
      const newViewportStart = Math.max(
        minViewportStart,
        Math.min(
          maxViewportStart,
          xScale.invert(
            xScale(new Date(panStartViewportStart)) - panAccumulatedDx,
          ).getTime(),
        ),
      );
      setViewportStart(newViewportStart);
      setPanTransformDx(panAccumulatedDx);
      /* Redraw so ticks align to new viewport (first tick at viewport left, no gap) */
      drawGantt(svgEl, projects, zoomLevel);
    }
  };

  const isOverBar = (clientX: number, clientY: number): boolean => {
    const el = document.elementFromPoint(clientX, clientY);
    return el?.closest('.gantt-bar-group') !== null;
  };

  backgroundRect
    .on('wheel', function (event) {
      event.preventDefault();
      const direction = event.deltaY > 0 ? 'out' : 'in';
      applyZoom(direction);
    })
    .style('cursor', zoomLevel === 'day' ? 'grab' : 'default');

  let mouseDragStart: { x: number; y: number } | null = null;
  backgroundRect
    .on('mousedown', (event) => {
      if (event.button === 0 && !isOverBar(event.clientX, event.clientY)) {
        mouseDragStart = { x: event.clientX, y: event.clientY };
        if (usePannableRange && timeline.fullRange && container && zoomLevel === 'day') {
          panStartX = event.clientX;
          panStartViewportStart = getViewportStart() ?? timeline.start.getTime();
          panAccumulatedDx = getPanTransformDx();
          const panStartDate = new Date(panStartViewportStart);
          panMinDx = xScale(panStartDate) - xScale(fullRangeEnd) + chartWidth;
          panMaxDx = xScale(panStartDate) - xScale(fullRangeStart);
          /* Never allow panning past start: viewport left must not go left of fullRangeStart (no empty space) */
          const atStart = panStartViewportStart <= fullStartTime + 1;
          if (atStart) {
            panMaxDx = 0;
            panAccumulatedDx = Math.min(0, panAccumulatedDx);
          } else {
            panMaxDx = Math.min(panMaxDx, xScale(panStartDate));
          }
          if (contentWidth <= chartWidth) {
            panMinDx = 0;
            panMaxDx = chartWidth - contentWidth;
            panAccumulatedDx = Math.max(0, Math.min(chartWidth - contentWidth, panAccumulatedDx));
          }
        }
      }
    })
    .on('mousemove', (event) => {
      if (!mouseDragStart || event.buttons !== 1) return;
      const dx = event.clientX - (panStartX ?? mouseDragStart.x);
      const dy = event.clientY - mouseDragStart.y;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const panActive = usePannableRange && timeline.fullRange && panStartX != null;
      const zoomGesture = adx >= ZOOM_GESTURE_THRESHOLD || ady >= ZOOM_GESTURE_THRESHOLD;
      const primarilyVertical = ady >= adx;
      if (panActive) {
        const beforeClamp = getPanTransformDx() + dx;
        panAccumulatedDx = Math.max(panMinDx, Math.min(panMaxDx, beforeClamp));
        let tx = MARGIN.left - xScale(new Date(panStartViewportStart!)) + panAccumulatedDx;
        /* Never show empty space on left: viewport left must not go past fullRangeStart (group x=0) */
        tx = Math.min(tx, 0);
        chartContentGroup.attr('transform', `translate(${tx},0)`);
      } else if (zoomGesture && primarilyVertical && zoomLevel === 'day') {
        const direction = dy > 0 ? 'out' : 'in';
        applyZoom(direction);
        mouseDragStart = { x: event.clientX, y: event.clientY };
      }
    })
    .on('mouseup', () => {
      if (usePannableRange && panStartViewportStart != null) {
        commitPan();
      }
      mouseDragStart = null;
      panStartX = null;
      panStartViewportStart = null;
      panAccumulatedDx = 0;
    })
    .on('mouseleave', () => {
      if (usePannableRange && panStartViewportStart != null) {
        commitPan();
      }
      mouseDragStart = null;
      panStartX = null;
      panStartViewportStart = null;
      panAccumulatedDx = 0;
    });

  let touchStart: { x: number; y: number } | null = null;
  let touchPanAccumulatedDx = 0;
  let touchPanStartViewportStart: number | null = null;
  let touchPanMinDx = -Infinity;
  let touchPanMaxDx = Infinity;
  backgroundRect
    .on('touchstart', (event) => {
      if (
        event.touches.length === 1 &&
        !isOverBar(event.touches[0].clientX, event.touches[0].clientY)
      ) {
        touchStart = {
          x: event.touches[0].clientX,
          y: event.touches[0].clientY,
        };
        if (usePannableRange && timeline.fullRange && container && zoomLevel === 'day') {
          touchPanStartViewportStart = getViewportStart() ?? timeline.start.getTime();
          touchPanAccumulatedDx = getPanTransformDx();
          const touchPanStartDate = new Date(touchPanStartViewportStart);
          touchPanMinDx = xScale(touchPanStartDate) - xScale(fullRangeEnd) + chartWidth;
          touchPanMaxDx = xScale(touchPanStartDate) - xScale(fullRangeStart);
          const touchAtStart = touchPanStartViewportStart <= fullStartTime + 1;
          if (touchAtStart) {
            touchPanMaxDx = 0;
            touchPanAccumulatedDx = Math.min(0, touchPanAccumulatedDx);
          } else {
            touchPanMaxDx = Math.min(touchPanMaxDx, xScale(touchPanStartDate));
          }
          if (contentWidth <= chartWidth) {
            touchPanMinDx = 0;
            touchPanMaxDx = chartWidth - contentWidth;
            touchPanAccumulatedDx = Math.max(0, Math.min(chartWidth - contentWidth, touchPanAccumulatedDx));
          }
        }
      }
    })
    .on('touchmove', (event) => {
      if (event.touches.length !== 1 || !touchStart) return;
      event.preventDefault();
      const x = event.touches[0].clientX;
      const y = event.touches[0].clientY;
      const dx = x - touchStart.x;
      const dy = y - touchStart.y;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const touchPanActive = usePannableRange && timeline.fullRange && touchPanStartViewportStart != null;
      const touchZoomGesture = adx >= ZOOM_GESTURE_THRESHOLD || ady >= ZOOM_GESTURE_THRESHOLD;
      const touchPrimarilyVertical = ady >= adx;
      if (touchPanActive) {
        touchPanAccumulatedDx = Math.max(
          touchPanMinDx,
          Math.min(touchPanMaxDx, touchPanAccumulatedDx + dx),
        );
        let tx = MARGIN.left - xScale(new Date(touchPanStartViewportStart!)) + touchPanAccumulatedDx;
        tx = Math.min(tx, 0);
        chartContentGroup.attr('transform', `translate(${tx},0)`);
        touchStart = { x, y };
      } else if (touchZoomGesture && touchPrimarilyVertical && zoomLevel === 'day') {
        const direction = dy > 0 ? 'out' : 'in';
        applyZoom(direction);
        touchStart = { x, y };
      }
    })
    .on('touchend', () => {
      if (usePannableRange && touchPanStartViewportStart != null && container && timeline.fullRange) {
        panStartViewportStart = touchPanStartViewportStart;
        panAccumulatedDx = touchPanAccumulatedDx;
        commitPan();
      }
      touchStart = null;
      touchPanAccumulatedDx = 0;
      touchPanStartViewportStart = null;
    });
}

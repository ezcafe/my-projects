import type { Project, Task } from '../models/domain';
import { listProjects } from './projectService';
import { listTasksForProject } from './taskService';
import { getMilestoneDates } from '../utils/milestoneDates';

const STORAGE_KEY = 'project-notifications-sent';
const GROUPED_KEY_PREFIX = 'grouped:';
const PRUNE_DAYS = 7;

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getPermission(): NotificationPermission {
  if (!isSupported()) return 'denied';
  return Notification.permission;
}

export function requestPermission(): Promise<NotificationPermission> {
  if (!isSupported()) return Promise.resolve('denied');
  return Notification.requestPermission();
}

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getSentSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function wasGroupedSent(dateKey: string): boolean {
  return getSentSet().has(`${GROUPED_KEY_PREFIX}${dateKey}`);
}

function markGroupedSent(dateKey: string): void {
  const sent = getSentSet();
  sent.add(`${GROUPED_KEY_PREFIX}${dateKey}`);
  pruneAndSave(sent);
}

function pruneAndSave(sent: Set<string>): void {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - PRUNE_DAYS);
  const cutoffKey = toLocalDateKey(cutoff);
  const filtered = [...sent].filter((key) => {
    const datePart = key.startsWith(GROUPED_KEY_PREFIX)
      ? key.slice(GROUPED_KEY_PREFIX.length)
      : key.split(':')[1];
    return datePart && datePart >= cutoffKey;
  });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...filtered]));
  } catch {
    // ignore
  }
}

function showNotification(title: string, body: string, tag: string): void {
  if (!isSupported() || getPermission() !== 'granted') return;
  try {
    new Notification(title, { body, tag });
  } catch {
    // ignore
  }
}

type ReminderCategory =
  | 'finish-today'
  | 'due-1-week'
  | 'due-2-weeks'
  | 'due-1-month'
  | 'start-today';

const CATEGORY_ORDER: ReminderCategory[] = [
  'finish-today',
  'due-1-week',
  'due-2-weeks',
  'due-1-month',
  'start-today',
];

const CATEGORY_HEADERS: Record<ReminderCategory, string> = {
  'finish-today': 'Due to finish today:',
  'due-1-week': 'Due in 1 week:',
  'due-2-weeks': 'Due in 2 weeks:',
  'due-1-month': 'Due in 1 month:',
  'start-today': 'Start today:',
};

interface ReminderEvent {
  category: ReminderCategory;
  /** Display line: "Project name" or "Project name - Task name" */
  itemLabel: string;
}

function collectProjectEvents(
  project: Project,
  todayKey: string,
): ReminderEvent[] {
  const events: ReminderEvent[] = [];
  const startKey = toLocalDateKey(new Date(project.startDate));
  const endKey = toLocalDateKey(new Date(project.endDate));

  if (startKey === todayKey) {
    events.push({ category: 'start-today', itemLabel: project.name });
  }
  if (endKey === todayKey) {
    events.push({ category: 'finish-today', itemLabel: project.name });
  }

  const endDate = new Date(project.endDate);
  const milestoneDates = getMilestoneDates(endDate);
  const offsets: ReminderCategory[] = ['due-1-week', 'due-2-weeks', 'due-1-month'];
  for (let i = 0; i < milestoneDates.length; i++) {
    const mKey = toLocalDateKey(milestoneDates[i]);
    if (mKey === todayKey) {
      events.push({ category: offsets[i], itemLabel: project.name });
      break;
    }
  }
  return events;
}

function collectTaskEvents(
  task: Task,
  projectName: string,
  todayKey: string,
): ReminderEvent[] {
  const events: ReminderEvent[] = [];
  const taskItemLabel = `${projectName} - ${task.title}`;
  if (task.startDate) {
    const startKey = toLocalDateKey(new Date(task.startDate));
    if (startKey === todayKey) {
      events.push({ category: 'start-today', itemLabel: taskItemLabel });
    }
  }
  if (task.endDate) {
    const endKey = toLocalDateKey(new Date(task.endDate));
    if (endKey === todayKey) {
      events.push({ category: 'finish-today', itemLabel: taskItemLabel });
    }
  }
  return events;
}

function buildGroupedBody(events: ReminderEvent[]): string {
  const byCategory = new Map<ReminderCategory, string[]>();
  for (const e of events) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e.itemLabel);
    byCategory.set(e.category, list);
  }
  const parts: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;
    parts.push(CATEGORY_HEADERS[cat]);
    items.forEach((label, i) => {
      parts.push(`  ${i + 1}. ${label}`);
    });
  }
  return parts.join('\n');
}

export function checkAndNotify(
  projects: Project[],
  tasksByProjectId: Map<number, Task[]>,
): void {
  if (!isSupported() || getPermission() !== 'granted') return;

  const todayKey = toLocalDateKey(new Date());
  const activeProjects = projects.filter((p) => p.status !== 'Done');

  const allEvents: ReminderEvent[] = [];

  for (const project of activeProjects) {
    allEvents.push(...collectProjectEvents(project, todayKey));

    const tasks = tasksByProjectId.get(project.id) ?? [];
    const activeTasks = tasks.filter((t) => t.status !== 'Done');
    for (const task of activeTasks) {
      allEvents.push(...collectTaskEvents(task, project.name, todayKey));
    }
  }

  if (allEvents.length === 0) return;
  if (wasGroupedSent(todayKey)) return;

  const count = allEvents.length;
  const title =
    count === 1
      ? "Here's what's on your plate today"
      : `You have ${count} reminders today`;
  const body = buildGroupedBody(allEvents);
  const tag = `grouped:${todayKey}`;
  showNotification(title, body, tag);
  markGroupedSent(todayKey);
}

export async function runProjectDateNotifications(): Promise<void> {
  const projects = await listProjects();
  const tasksByProjectId = new Map<number, Task[]>();
  const activeProjects = projects.filter((p) => p.status !== 'Done');
  for (const project of activeProjects) {
    const tasks = await listTasksForProject(project.id);
    tasksByProjectId.set(project.id, tasks);
  }
  checkAndNotify(projects, tasksByProjectId);
}

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

const MILESTONE_LABELS: Record<number, string> = {
  7: 'due in 1 week',
  14: 'due in 2 weeks',
  30: 'due in 1 month',
};

interface ReminderEvent {
  label: string;
}

function collectProjectEvents(
  project: Project,
  todayKey: string,
): ReminderEvent[] {
  const events: ReminderEvent[] = [];
  const startKey = toLocalDateKey(new Date(project.startDate));
  const endKey = toLocalDateKey(new Date(project.endDate));

  if (startKey === todayKey) {
    events.push({ label: `${project.name} — starts today` });
  }
  if (endKey === todayKey) {
    events.push({ label: `${project.name} — due to finish today` });
  }

  const endDate = new Date(project.endDate);
  const milestoneDates = getMilestoneDates(endDate);
  const offsets = [7, 14, 30];
  for (let i = 0; i < milestoneDates.length; i++) {
    const mKey = toLocalDateKey(milestoneDates[i]);
    if (mKey === todayKey) {
      const milestoneLabel = MILESTONE_LABELS[offsets[i]] ?? `due in ${offsets[i]} days`;
      events.push({ label: `${project.name} — ${milestoneLabel}` });
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
  if (task.startDate) {
    const startKey = toLocalDateKey(new Date(task.startDate));
    if (startKey === todayKey) {
      events.push({ label: `${task.title} (${projectName}) — starts today` });
    }
  }
  if (task.endDate) {
    const endKey = toLocalDateKey(new Date(task.endDate));
    if (endKey === todayKey) {
      events.push({ label: `${task.title} (${projectName}) — due today` });
    }
  }
  return events;
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
  const body =
    count === 1
      ? allEvents[0].label
      : allEvents.map((e) => `• ${e.label}`).join('\n');
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

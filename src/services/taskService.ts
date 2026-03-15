import { db } from '../db/schema';
import type { Task, ProjectPriority, ProjectStatus } from '../models/domain';

function nowIso(): string {
  return new Date().toISOString();
}

export async function listTasksForProject(projectId: number): Promise<Task[]> {
  return db.tasks.where({ projectId }).sortBy('order');
}

export async function getTask(id: number): Promise<Task | undefined> {
  return db.tasks.get(id);
}

/** Returns all descendant task IDs (children, grandchildren, etc.) */
export async function getDescendantTaskIds(taskId: number): Promise<number[]> {
  const ids: number[] = [];
  const queue: number[] = [taskId];
  while (queue.length) {
    const parentId = queue.shift()!;
    const children = await db.tasks.where({ parentId }).toArray();
    for (const c of children) {
      ids.push(c.id);
      queue.push(c.id);
    }
  }
  return ids;
}

/** Tree node for formatting task + descendants in confirm dialogs. */
export interface TaskWithDescendantsTree {
  title: string;
  status: string;
  children: TaskWithDescendantsTree[];
}

/** Returns the task and its descendants as a tree (title, status, children). */
export async function getTaskWithDescendantsTree(
  taskId: number,
): Promise<TaskWithDescendantsTree | null> {
  const task = await getTask(taskId);
  if (!task) return null;
  const ids = await getDescendantTaskIds(taskId);
  if (ids.length === 0) {
    return { title: task.title, status: task.status, children: [] };
  }
  const descendants = (await db.tasks.bulkGet(ids)).filter(
    (t): t is Task => t != null,
  );
  const buildChildren = (parentId: number): TaskWithDescendantsTree[] =>
    descendants
      .filter((t) => t.parentId === parentId)
      .sort((a, b) => a.order - b.order)
      .map((t) => ({
        title: t.title,
        status: t.status,
        children: buildChildren(t.id),
      }));
  return {
    title: task.title,
    status: task.status,
    children: buildChildren(taskId),
  };
}

/** Formats tree for confirm dialog: "Title (Status)" and "|__ Title (Status)" for descendants. */
export function formatSubtaskListForConfirm(tree: TaskWithDescendantsTree): string {
  const lines: string[] = [];
  const format = (node: TaskWithDescendantsTree, depth: number) => {
    const prefix = depth > 0 ? '|__ '.repeat(depth) : '';
    lines.push(prefix + `${node.title} (${node.status})`);
    for (const c of node.children) {
      format(c, depth + 1);
    }
  };
  format(tree, 0);
  return lines.join('\n');
}

/** True if any descendant (at any level) has status !== 'Done'. */
export async function hasDescendantWithStatusNotDone(
  taskId: number,
): Promise<boolean> {
  const ids = await getDescendantTaskIds(taskId);
  if (ids.length === 0) return false;
  const tasks = await db.tasks.bulkGet(ids);
  return tasks.some((t) => t != null && t.status !== 'Done');
}

/** Sets status of all descendants (not the task itself) to the given status. */
export async function setDescendantsStatus(
  taskId: number,
  status: ProjectStatus,
): Promise<void> {
  const ids = await getDescendantTaskIds(taskId);
  for (const id of ids) {
    await updateTask(id, { status });
  }
}

export interface TaskInput {
  projectId: number;
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  parentId?: number | null;
}

export async function createTask(input: TaskInput): Promise<Task> {
  const timestamp = nowIso();
  const maxOrder =
    (await db.tasks
      .where({ projectId: input.projectId })
      .reverse()
      .sortBy('order')
      .then((tasks) => tasks[0]?.order)) ?? 0;

  const id = await db.tasks.add({
    ...input,
    order: maxOrder + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  } as Task);

  const created = await db.tasks.get(id);
  if (!created) {
    throw new Error('Failed to create task');
  }
  return created;
}

export async function updateTask(
  id: number,
  changes: Partial<Omit<Task, 'id' | 'projectId' | 'createdAt'>>,
): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) {
    throw new Error('Task not found');
  }

  const updated: Task = {
    ...existing,
    ...changes,
    updatedAt: nowIso(),
  };

  await db.tasks.put(updated);
  return updated;
}

export async function setAllTasksInProjectStatus(
  projectId: number,
  status: ProjectStatus,
): Promise<void> {
  const tasks = await listTasksForProject(projectId);
  for (const task of tasks) {
    await updateTask(task.id, { status });
  }
}

export async function deleteTask(id: number): Promise<void> {
  const toDelete = new Set<number>();
  const queue: number[] = [id];

  while (queue.length) {
    const current = queue.shift()!;
    if (toDelete.has(current)) continue;
    toDelete.add(current);
    const children = await db.tasks.where({ parentId: current }).toArray();
    for (const child of children) {
      queue.push(child.id);
    }
  }

  await db.tasks.bulkDelete(Array.from(toDelete));
}


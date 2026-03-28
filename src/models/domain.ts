export type ProjectStatus = 'NotStarted' | 'InProgress' | 'Blocked' | 'Done';

export type ProjectPriority = 'Low' | 'Medium' | 'High' | 'Critical';

export interface Project {
  id: number;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: number;
  projectId: number;
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  order: number;
  parentId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTreeNode extends Task {
  children: TaskTreeNode[];
}

/** Root task is level 1, and subtasks can be nested up to this level. */
export const TASK_MAX_LEVEL = 4;

/** UI tree depth is zero-based; level is one-based for user-facing limits. */
export function taskLevelFromDepth(depth: number): number {
  return depth + 1;
}

export function buildTaskTree(tasks: Task[]): TaskTreeNode[] {
  const byId = new Map<number, TaskTreeNode>();
  const roots: TaskTreeNode[] = [];

  for (const t of tasks) {
    byId.set(t.id, { ...t, children: [] });
  }

  for (const node of byId.values()) {
    if (node.parentId == null) {
      roots.push(node);
    } else {
      const parent = byId.get(node.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }

  const sortChildren = (nodes: TaskTreeNode[]) => {
    nodes.sort((a, b) => a.order - b.order);
    for (const n of nodes) {
      if (n.children.length > 0) sortChildren(n.children);
    }
  };

  sortChildren(roots);
  return roots;
}


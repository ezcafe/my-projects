import type { Project, Task } from '../models/domain';
import { getProject } from './projectService';
import { listTasksForProject } from './taskService';

export interface ExportData {
  version: number;
  exportedAt: string;
  projects: Project[];
  tasks: Task[];
}

const EXPORT_VERSION = 1;

/**
 * Builds JSON string for the given project and its tasks.
 */
export async function exportProjectToJson(projectId: number): Promise<string> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }
  const tasks = await listTasksForProject(projectId);
  const data: ExportData = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    projects: [project],
    tasks,
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Triggers a browser download of the given JSON string as a file.
 */
export function downloadJson(filename: string, jsonString: string): void {
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const VALID_STATUSES = ['NotStarted', 'InProgress', 'Blocked', 'Done'] as const;
const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

function isValidStatus(s: unknown): s is Project['status'] {
  return typeof s === 'string' && VALID_STATUSES.includes(s as Project['status']);
}

function isValidPriority(p: unknown): p is Project['priority'] {
  return typeof p === 'string' && VALID_PRIORITIES.includes(p as Project['priority']);
}

/**
 * Parses and validates an export JSON string. Returns the first project and its tasks.
 * Throws on invalid or unsupported data.
 */
export function parseImportFile(jsonString: string): { project: Project; tasks: Task[] } {
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON');
  }

  if (data == null || typeof data !== 'object') {
    throw new Error('Invalid export file');
  }

  const obj = data as Record<string, unknown>;
  if (obj.version !== EXPORT_VERSION) {
    throw new Error('Unsupported export version');
  }

  if (!Array.isArray(obj.projects) || obj.projects.length === 0) {
    throw new Error('No project in export file');
  }

  const rawProject = obj.projects[0] as Record<string, unknown>;
  const name = rawProject.name;
  const startDate = rawProject.startDate;
  const endDate = rawProject.endDate;
  const status = rawProject.status;
  const priority = rawProject.priority;

  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Project name is required');
  }
  if (typeof startDate !== 'string' || !startDate) {
    throw new Error('Project start date is required');
  }
  if (typeof endDate !== 'string' || !endDate) {
    throw new Error('Project end date is required');
  }
  if (!isValidStatus(status)) {
    throw new Error('Invalid project status');
  }
  if (!isValidPriority(priority)) {
    throw new Error('Invalid project priority');
  }

  const project: Project = {
    id: typeof rawProject.id === 'number' ? rawProject.id : 0,
    name: name.trim(),
    description: typeof rawProject.description === 'string' ? rawProject.description : undefined,
    startDate,
    endDate,
    status,
    priority,
    createdAt: typeof rawProject.createdAt === 'string' ? rawProject.createdAt : new Date().toISOString(),
    updatedAt: typeof rawProject.updatedAt === 'string' ? rawProject.updatedAt : new Date().toISOString(),
  };

  const rawTasks = Array.isArray(obj.tasks) ? obj.tasks : [];
  const projectId = project.id;
  const tasks: Task[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < rawTasks.length; i++) {
    const t = rawTasks[i] as Record<string, unknown>;
    if (t == null || typeof t !== 'object') continue;
    const taskProjectId = typeof t.projectId === 'number' ? t.projectId : projectId;
    if (taskProjectId !== projectId) continue;

    const title = typeof t.title === 'string' ? t.title : 'Untitled task';
    const taskStatus = isValidStatus(t.status) ? t.status : 'NotStarted';
    const taskPriority = isValidPriority(t.priority) ? t.priority : 'Medium';
    const order = typeof t.order === 'number' && !Number.isNaN(t.order) ? t.order : i;

    tasks.push({
      id: typeof t.id === 'number' ? t.id : 0,
      projectId,
      title: title.trim() || 'Untitled task',
      description: typeof t.description === 'string' ? t.description : undefined,
      startDate: typeof t.startDate === 'string' ? t.startDate : undefined,
      endDate: typeof t.endDate === 'string' ? t.endDate : undefined,
      status: taskStatus,
      priority: taskPriority,
      order,
      parentId: typeof t.parentId === 'number' ? t.parentId : t.parentId === null ? null : undefined,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : now,
      updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : now,
    });
  }

  return { project, tasks };
}

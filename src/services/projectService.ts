import { db } from '../db/schema';
import type {
  Project,
  ProjectPriority,
  ProjectStatus,
  TaskTreeNode,
} from '../models/domain';
import { buildTaskTree } from '../models/domain';
import {
  listTasksForProject,
  createTask,
} from './taskService';

function nowIso(): string {
  return new Date().toISOString();
}

export async function listProjects(): Promise<Project[]> {
  return db.projects.orderBy('startDate').toArray();
}

export async function getProject(id: number): Promise<Project | undefined> {
  return db.projects.get(id);
}

export interface ProjectInput {
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  priority: ProjectPriority;
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const timestamp = nowIso();
  const id = await db.projects.add({
    ...input,
    createdAt: timestamp,
    updatedAt: timestamp,
  } as Project);

  const created = await db.projects.get(id);
  if (!created) {
    throw new Error('Failed to create project');
  }
  return created;
}

export async function updateProject(
  id: number,
  changes: Partial<ProjectInput>,
): Promise<Project> {
  const existing = await db.projects.get(id);
  if (!existing) {
    throw new Error('Project not found');
  }

  const updated: Project = {
    ...existing,
    ...changes,
    updatedAt: nowIso(),
  };

  await db.projects.put(updated);
  return updated;
}

export async function cloneProject(projectId: number): Promise<Project> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const tasks = await listTasksForProject(projectId);
  const tree = buildTaskTree(tasks);

  const newProject = await createProject({
    name: 'Copy of ' + project.name,
    description: project.description,
    startDate: project.startDate,
    endDate: project.endDate,
    status: project.status,
    priority: project.priority,
  });

  async function copyTree(
    nodes: TaskTreeNode[],
    parentNewId: number | null,
  ): Promise<void> {
    for (const node of nodes) {
      const newTask = await createTask({
        projectId: newProject.id,
        title: node.title,
        description: node.description,
        startDate: node.startDate,
        endDate: node.endDate,
        status: node.status,
        priority: node.priority,
        parentId: parentNewId,
      });
      await copyTree(node.children, newTask.id);
    }
  }

  await copyTree(tree, null);
  return newProject;
}

export async function deleteProject(id: number): Promise<void> {
  await db.transaction('readwrite', db.projects, db.tasks, async () => {
    await db.tasks.where({ projectId: id }).delete();
    await db.projects.delete(id);
  });
}


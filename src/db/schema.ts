import Dexie, { type Table } from 'dexie';
import type { Project, Task } from '../models/domain';

export class AppDatabase extends Dexie {
  projects!: Table<Project, number>;
  tasks!: Table<Task, number>;

  constructor() {
    super('pm_gantt_db');

    this.version(1).stores({
      projects:
        '++id, name, startDate, endDate, status, priority, createdAt, updatedAt',
      tasks:
        '++id, projectId, parentId, title, startDate, endDate, status, priority, order, createdAt, updatedAt',
    });

    this.projects.mapToClass(
      class implements Project {
        id!: number;
        name!: string;
        description?: string | undefined;
        startDate!: string;
        endDate!: string;
        status!: 'NotStarted' | 'InProgress' | 'Blocked' | 'Done';
        priority!: 'Low' | 'Medium' | 'High' | 'Critical';
        createdAt!: string;
        updatedAt!: string;
      },
    );

    this.tasks.mapToClass(
      class implements Task {
        id!: number;
        projectId!: number;
        title!: string;
        description?: string | undefined;
        startDate?: string | undefined;
        endDate?: string | undefined;
        status!: 'NotStarted' | 'InProgress' | 'Blocked' | 'Done';
        priority!: 'Low' | 'Medium' | 'High' | 'Critical';
        order!: number;
        parentId?: number | null | undefined;
        createdAt!: string;
        updatedAt!: string;
      },
    );
  }
}

export const db = new AppDatabase();


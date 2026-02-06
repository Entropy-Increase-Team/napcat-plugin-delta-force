/**
 * 定时任务调度器
 * 支持标准 cron 表达式（5字段格式：分钟 小时 日 月 星期）
 */

import { pluginState } from '../core/state';
import { logger } from '../utils/logger';

/** 任务定义 */
interface ScheduledTask {
  id: string;
  name: string;
  cron: string; // 标准 cron 格式: "分钟 小时 日 月 星期" (如 "0 8 * * *" 表示每天8点)
  handler: () => Promise<void>;
  enabled: boolean;
  lastRun?: number;
}

/** 解析的 cron 字段 */
interface ParsedCron {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

/** 解析 cron 字段（支持 *, 星号/N, N-M, N,M 格式） */
function parseField (field: string, min: number, max: number): number[] {
  const result: number[] = [];

  // 星号（所有值）
  if (field === '*') {
    for (let i = min; i <= max; i++) result.push(i);
    return result;
  }

  // 步进值 */N
  if (field.startsWith('*/')) {
    const step = parseInt(field.substring(2));
    if (!isNaN(step) && step > 0) {
      for (let i = min; i <= max; i += step) result.push(i);
    }
    return result;
  }

  // 逗号分隔的多个值
  const parts = field.split(',');
  for (const part of parts) {
    // 范围 N-M
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          if (i >= min && i <= max) result.push(i);
        }
      }
    } else {
      // 单个值
      const num = parseInt(part);
      if (!isNaN(num) && num >= min && num <= max) {
        result.push(num);
      }
    }
  }

  return result;
}

/** 解析标准 cron 表达式（5字段格式） */
function parseCron (cron: string): ParsedCron | null {
  if (!cron) return null;

  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  return {
    minute: parseField(fields[0], 0, 59),
    hour: parseField(fields[1], 0, 23),
    dayOfMonth: parseField(fields[2], 1, 31),
    month: parseField(fields[3], 1, 12),
    dayOfWeek: parseField(fields[4], 0, 6), // 0=周日, 1-6=周一至周六
  };
}

/** 检查当前时间是否匹配 cron 表达式 */
function matchesCron (parsed: ParsedCron, now: Date): boolean {
  const minute = now.getMinutes();
  const hour = now.getHours();
  const dayOfMonth = now.getDate();
  const month = now.getMonth() + 1; // JavaScript月份从0开始
  const dayOfWeek = now.getDay(); // 0=周日

  return (
    parsed.minute.includes(minute) &&
    parsed.hour.includes(hour) &&
    parsed.dayOfMonth.includes(dayOfMonth) &&
    parsed.month.includes(month) &&
    parsed.dayOfWeek.includes(dayOfWeek)
  );
}

/** 任务调度器 */
class TaskScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private checkInterval = 60000; // 每分钟检查一次

  /** 注册任务 */
  register (task: ScheduledTask): void {
    this.tasks.set(task.id, task);
    pluginState.logDebug(`定时任务已注册: ${task.name} (${task.cron})`);
  }

  /** 移除任务 */
  unregister (taskId: string): void {
    this.tasks.delete(taskId);
  }

  /** 启用任务 */
  enable (taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = true;
      return true;
    }
    return false;
  }

  /** 禁用任务 */
  disable (taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = false;
      return true;
    }
    return false;
  }

  /** 启动调度器 */
  start (): void {
    if (this.timer) return;

    pluginState.log('info', '定时任务调度器已启动');
    this.timer = setInterval(() => this.checkTasks(), this.checkInterval);
    // 立即执行一次检查
    this.checkTasks();
  }

  /** 停止调度器 */
  stop (): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      pluginState.log('info', '定时任务调度器已停止');
    }
  }

  /** 检查并执行到期任务 */
  private async checkTasks (): Promise<void> {
    const now = new Date();
    const currentMinuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

    for (const [id, task] of this.tasks) {
      if (!task.enabled) continue;

      // 解析 cron 格式
      const parsed = parseCron(task.cron);
      if (!parsed) {
        pluginState.logDebug(`任务 ${task.name} cron 表达式无效: ${task.cron}`);
        continue;
      }

      // 检查是否匹配当前时间
      if (!matchesCron(parsed, now)) continue;

      // 检查本分钟是否已执行（避免重复）
      const lastRunMinuteKey = task.lastRun
        ? (() => {
          const d = new Date(task.lastRun);
          return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
        })()
        : null;

      if (lastRunMinuteKey === currentMinuteKey) continue;

      logger.push(`执行定时任务: ${task.name}`);
      task.lastRun = Date.now();

      try {
        await task.handler();
      } catch (error) {
        logger.error(`定时任务执行失败 [${task.name}]:`, error);
      }
    }
  }

  /** 获取所有任务状态 */
  getTasksStatus (): { id: string; name: string; cron: string; enabled: boolean; lastRun?: string; }[] {
    const result = [];
    for (const [id, task] of this.tasks) {
      result.push({
        id,
        name: task.name,
        cron: task.cron,
        enabled: task.enabled,
        lastRun: task.lastRun ? new Date(task.lastRun).toLocaleString() : undefined,
      });
    }
    return result;
  }

  /** 手动执行任务 */
  async runTask (taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    logger.push(`手动执行任务: ${task.name}`);
    try {
      await task.handler();
      task.lastRun = Date.now();
      return true;
    } catch (error) {
      logger.error(`任务执行失败 [${task.name}]:`, error);
      return false;
    }
  }
}

/** 全局单例 */
let scheduler: TaskScheduler | null = null;

/** 获取任务调度器实例 */
export function getScheduler (): TaskScheduler {
  if (!scheduler) {
    scheduler = new TaskScheduler();
  }
  return scheduler;
}

export { TaskScheduler };

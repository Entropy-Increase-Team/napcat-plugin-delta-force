/**
 * 会话管理服务
 * 用于交互式计算器的多步骤对话管理
 */

import type { OB11Message } from 'napcat-types';
import { pluginState } from '../core/state';
import { reply, replyAt } from '../utils/message';

/** 会话超时时间 (2分钟) */
const SESSION_TIMEOUT = 2 * 60 * 1000;

/** 会话类型 */
export type SessionType = 'damage' | 'readiness' | 'repair';

/** 会话数据 */
export interface SessionData {
  type: SessionType;
  step: string;
  data: Record<string, any>;
  lastUpdate: number;
}

/** 会话存储 */
const userSessions = new Map<string, SessionData>();
const sessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * 获取用户会话
 */
export function getSession (userId: string): SessionData | undefined {
  return userSessions.get(userId);
}

/**
 * 检查用户是否有活跃会话
 */
export function hasSession (userId: string): boolean {
  return userSessions.has(userId);
}

/**
 * 创建或更新用户会话
 */
export function setSession (userId: string, session: SessionData): void {
  session.lastUpdate = Date.now();
  userSessions.set(userId, session);
  pluginState.logDebug(`会话已创建/更新: ${userId}, type=${session.type}, step=${session.step}`);
}

/**
 * 更新会话步骤
 */
export function updateSessionStep (userId: string, step: string, data?: Record<string, any>): void {
  const session = userSessions.get(userId);
  if (session) {
    session.step = step;
    session.lastUpdate = Date.now();
    if (data) {
      Object.assign(session.data, data);
    }
  }
}

/**
 * 删除用户会话
 */
export function deleteSession (userId: string): void {
  userSessions.delete(userId);
  clearSessionTimeout(userId);
  pluginState.logDebug(`会话已删除: ${userId}`);
}

/**
 * 启动会话超时定时器
 */
export function startSessionTimeout (userId: string, msg: OB11Message): void {
  clearSessionTimeout(userId);

  const timeoutId = setTimeout(async () => {
    if (userSessions.has(userId)) {
      userSessions.delete(userId);
      sessionTimeouts.delete(userId);

      try {
        await replyAt(msg, '⏰ 计算会话已超时（2分钟无回复），已自动结束。\n如需重新计算，请发送相应的计算命令。');
      } catch (error) {
        pluginState.log('warn', '发送超时消息失败:', error);
      }
    }
  }, SESSION_TIMEOUT);

  sessionTimeouts.set(userId, timeoutId);
}

/**
 * 清除会话超时定时器
 */
export function clearSessionTimeout (userId: string): void {
  const timeoutId = sessionTimeouts.get(userId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    sessionTimeouts.delete(userId);
  }
}

/**
 * 结束用户会话（包括清除超时）
 */
export function endSession (userId: string): void {
  deleteSession(userId);
  clearSessionTimeout(userId);
}

/**
 * 刷新会话超时（重置计时器）
 */
export function refreshSessionTimeout (userId: string, msg: OB11Message): void {
  const session = userSessions.get(userId);
  if (session) {
    session.lastUpdate = Date.now();
    startSessionTimeout(userId, msg);
  }
}

/** 初始步骤映射 */
const INITIAL_STEPS: Record<SessionType, string> = {
  damage: 'mode',
  readiness: 'target',
  repair: 'repair_mode',
};

/** 创建指定类型的计算会话 */
export function createSession (userId: string, type: SessionType): SessionData {
  const session: SessionData = { type, step: INITIAL_STEPS[type], data: {}, lastUpdate: Date.now() };
  setSession(userId, session);
  return session;
}

// 向后兼容
export const createDamageSession = (userId: string) => createSession(userId, 'damage');
export const createReadinessSession = (userId: string) => createSession(userId, 'readiness');
export const createRepairSession = (userId: string) => createSession(userId, 'repair');

export default {
  getSession,
  hasSession,
  setSession,
  updateSessionStep,
  deleteSession,
  startSessionTimeout,
  clearSessionTimeout,
  endSession,
  refreshSessionTimeout,
  createSession,
  createDamageSession,
  createReadinessSession,
  createRepairSession,
};

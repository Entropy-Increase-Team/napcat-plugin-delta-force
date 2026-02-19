/**
 * 统一错误处理
 * 处理 API 响应错误并生成用户友好的提示
 */

import type { OB11Message } from 'napcat-types';
import type { ApiResponse, RenderOptions } from '../types/index';
import { pluginState } from '../core/state';
import { logger } from './logger';
import { reply, replyImage, makeForwardMsg } from './message';
import { render } from '../services/render';

/** 错误类型枚举 */
export enum ErrorType {
  API_KEY_INVALID = 'API_KEY_INVALID',
  API_KEY_PERMISSION = 'API_KEY_PERMISSION',
  TOKEN_INVALID = 'TOKEN_INVALID',
  LOGIN_EXPIRED = 'LOGIN_EXPIRED',
  REGION_NOT_BOUND = 'REGION_NOT_BOUND',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN',
}

/** 错误处理结果 */
export interface ErrorHandleResult {
  /** 是否已处理错误 */
  handled: boolean;
  /** 错误类型 */
  type?: ErrorType;
  /** 用户提示消息 */
  message?: string;
}

/** 插件反馈群号 */
const FEEDBACK_GROUP = '1085402468';

/** 错误提示消息映射 */
const ERROR_MESSAGES: Record<ErrorType, string> = {
  [ErrorType.API_KEY_INVALID]: 'API Key 无效或已过期，请联系机器人管理员检查配置。',
  [ErrorType.API_KEY_PERMISSION]: 'API Key 权限不足，请升级订阅后使用。',
  [ErrorType.TOKEN_INVALID]: '当前激活的账号无效，请重新登录或使用 三角洲账号切换 切换有效账号。',
  [ErrorType.LOGIN_EXPIRED]: '登录已失效，请重新登录。',
  [ErrorType.REGION_NOT_BOUND]: '您尚未绑定游戏大区，请先使用 三角洲角色绑定 命令进行绑定。',
  [ErrorType.NETWORK_ERROR]: `网络请求异常，请稍后重试。\n如持续出现此问题，请加群 ${FEEDBACK_GROUP} 反馈`,
  [ErrorType.UNKNOWN]: `操作失败，请查看日志获取详细信息。\n如需帮助请加群 ${FEEDBACK_GROUP}`,
};

/**
 * 处理 API 响应错误
 * @param res API 响应对象
 * @returns 错误处理结果
 */
export function handleApiError (res: ApiResponse | false | null | undefined): ErrorHandleResult {
  // 空响应或非对象
  if (!res || typeof res !== 'object') {
    pluginState.log('warn', 'API 响应为空或格式不正确');
    return {
      handled: true,
      type: ErrorType.NETWORK_ERROR,
      message: `请求失败，API 未返回任何数据。\n如持续出现此问题，请加群 ${FEEDBACK_GROUP} 反馈`,
    };
  }

  const resCode = String(res.code);

  // API Key 无效 (code: 1000, 1001)
  if (resCode === '1000' || resCode === '1001') {
    pluginState.log('warn', 'API Key 无效或未配置');
    return {
      handled: true,
      type: ErrorType.API_KEY_INVALID,
      message: ERROR_MESSAGES[ErrorType.API_KEY_INVALID],
    };
  }

  // API Key 权限不足 (code: 1100)
  if (resCode === '1100') {
    const currentTier = (res as any).currentTier || 'free';
    const requiredTier = (res as any).requiredTier || 'pro';
    pluginState.log('warn', `API Key 权限不足 - 当前: ${currentTier}, 需要: ${requiredTier}`);
    return {
      handled: true,
      type: ErrorType.API_KEY_PERMISSION,
      message: `API Key 权限不足，请升级订阅。\n当前等级: ${currentTier} | 需要等级: ${requiredTier}`,
    };
  }

  // 安全提取字符串字段
  const data = res.data as any;
  const messageStr = typeof res.message === 'string' ? res.message : '';
  const errorStr = typeof res.error === 'string' ? res.error : (typeof res.error === 'object' ? JSON.stringify(res.error) : '');
  const msgStr = typeof res.msg === 'string' ? res.msg : '';
  const sMsgStr = typeof (res as any).sMsg === 'string' ? (res as any).sMsg : '';

  // 登录会话无效 (ret: 101)
  if (data?.ret === 101 || errorStr.includes('请先完成QQ或微信登录') || sMsgStr.includes('请先登录')) {
    pluginState.log('warn', '登录会话无效');
    return {
      handled: true,
      type: ErrorType.LOGIN_EXPIRED,
      message: ERROR_MESSAGES[ErrorType.LOGIN_EXPIRED],
    };
  }

  // 大区未绑定 (ret: 99998)
  if (data?.ret === 99998 || messageStr.includes('先绑定大区')) {
    pluginState.log('warn', '大区未绑定');
    return {
      handled: true,
      type: ErrorType.REGION_NOT_BOUND,
      message: ERROR_MESSAGES[ErrorType.REGION_NOT_BOUND],
    };
  }

  // Token 无效或缺失
  if (res.success === false && (
    messageStr.includes('未找到有效token') ||
    messageStr.includes('缺少frameworkToken参数')
  )) {
    pluginState.log('warn', 'Token 无效或缺失');
    return {
      handled: true,
      type: ErrorType.TOKEN_INVALID,
      message: ERROR_MESSAGES[ErrorType.TOKEN_INVALID],
    };
  }

  // 通用失败处理
  if (res.success === false) {
    // 某些成功消息可能被错误标记为 success: false
    const successKeywords = ['上传成功', '查询成功', '操作成功', '删除成功', '更新成功'];
    if (messageStr && successKeywords.some(kw => messageStr.includes(kw))) {
      pluginState.logDebug(`检测到成功消息但标记为失败，忽略: ${messageStr}`);
      return { handled: false };
    }

    const errorMsg = messageStr || msgStr || errorStr || '未知错误';
    pluginState.log('warn', `API 请求失败: ${errorMsg}`);
    return {
      handled: true,
      type: ErrorType.UNKNOWN,
      message: `操作失败：${errorMsg}`,
    };
  }

  // 无错误
  return { handled: false };
}

/**
 * 检查 API 响应是否成功
 * @param res API 响应
 * @returns 是否成功
 */
export function isApiSuccess (res: ApiResponse | false | null | undefined): boolean {
  if (!res || typeof res !== 'object') return false;
  return res.code === 0 || res.success === true;
}

/**
 * 获取 API 响应的错误消息
 * @param res API 响应
 * @returns 错误消息
 */
export function getApiErrorMessage (res: ApiResponse | false | null | undefined): string {
  if (!res || typeof res !== 'object') return '请求失败';
  return res.message || res.msg || res.error || '未知错误';
}

/**
 * 通用命令执行包装，统一捕获异常
 */
export async function safeHandle (msg: OB11Message, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logger.error('命令执行失败:', e);
    await reply(msg, '操作失败，请稍后重试');
  }
}

/**
 * 渲染图片，失败时降级为合并转发消息
 * @param msg 消息对象
 * @param html 渲染用 HTML
 * @param textsFn 降级文本生成函数，返回字符串数组（每条一个转发节点）
 * @param renderOpts 渲染选项
 * @param forwardNickname 合并消息昵称
 */
export async function renderOrForward (
  msg: OB11Message,
  html: string,
  textsFn: () => string[],
  renderOpts: Partial<RenderOptions>,
  forwardNickname = '三角洲助手'
): Promise<void> {
  try {
    const result = await render({ template: html, ...renderOpts } as RenderOptions);
    if (result.success && result.data) {
      await replyImage(msg, result.data);
      return;
    }
    logger.render('渲染失败，降级为合并消息:', result.error);
  } catch (e) {
    logger.error('渲染异常:', e);
  }
  // 降级为合并转发消息
  const texts = textsFn();
  await makeForwardMsg(msg, texts, { nickname: forwardNickname });
}

/**
 * 检查 API 错误并自动回复（通用包装）
 * @returns true 表示有错误已处理
 */
export async function checkApiError (res: any, msg: OB11Message): Promise<boolean> {
  const result = handleApiError(res);
  if (result.handled && result.message) {
    await reply(msg, result.message);
    return true;
  }
  return result.handled;
}

/** 延时工具 */
export function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default { handleApiError, isApiSuccess, getApiErrorMessage, ErrorType, safeHandle, renderOrForward, checkApiError, sleep };

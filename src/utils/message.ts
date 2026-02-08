/**
 * 消息工具
 * 统一消息发送、撤回等操作
 */

import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from '@/napcat-onebot/index';
import { pluginState } from '../core/state';

/** 消息段类型 */
export type MessageSegment = { type: string; data: Record<string, any>; };

/** 消息上下文 */
export interface MsgContext {
  ctx: NapCatPluginContext;
  event: OB11Message;
}

/** 获取消息上下文（兼容两种调用方式） */
function getMsgContext (input: OB11Message | MsgContext): MsgContext {
  if ('ctx' in input && 'event' in input) {
    return input as MsgContext;
  }
  const ctx = pluginState.getContext();
  if (!ctx) {
    throw new Error('上下文未初始化');
  }
  return { ctx, event: input as OB11Message };
}

/**
 * 发送文本消息
 */
export async function reply (input: OB11Message | MsgContext, message: string | MessageSegment[]): Promise<any> {
  try {
    const mc = getMsgContext(input);
    return await mc.ctx.actions.get('send_msg')?.handle({
      message_type: mc.event.message_type,
      user_id: mc.event.user_id,
      group_id: (mc.event as any).group_id,
      message,
    });
  } catch (error) {
    pluginState.log('error', '发送消息失败:', error);
    return null;
  }
}

/**
 * 发送图片消息（base64）
 */
export async function replyImage (input: OB11Message | MsgContext, base64Data: string): Promise<any> {
  return reply(input, [{ type: 'image', data: { file: `base64://${base64Data}` } }]);
}

/**
 * 发送带 @ 的消息
 */
export async function replyAt (input: OB11Message | MsgContext, text: string): Promise<any> {
  const mc = getMsgContext(input);
  const userId = String(mc.event.user_id);
  const isGroup = mc.event.message_type === 'group';

  if (isGroup) {
    return reply(mc, [
      { type: 'at', data: { qq: userId } },
      { type: 'text', data: { text: '\n' + text } },
    ]);
  }
  return reply(mc, text);
}

/**
 * 撤回消息
 */
export async function recallMsg (input: OB11Message | MsgContext, messageId: number): Promise<boolean> {
  try {
    const mc = getMsgContext(input);
    await mc.ctx.actions.get('delete_msg')?.handle({ message_id: messageId });
    return true;
  } catch (error) {
    pluginState.log('warn', '撤回消息失败:', error);
    return false;
  }
}

/**
 * 判断是否为群聊
 */
export function isGroupMsg (event: OB11Message): boolean {
  return event.message_type === 'group';
}

/**
 * 获取用户 ID 字符串
 */
export function getUserId (event: OB11Message): string {
  return String(event.user_id);
}

/**
 * 发送语音消息
 */
export async function sendAudio (input: OB11Message | MsgContext, url: string, prefix?: string): Promise<any> {
  const mc = getMsgContext(input);
  const messages: MessageSegment[] = [];

  if (prefix) {
    messages.push({ type: 'text', data: { text: prefix } });
  }
  messages.push({ type: 'record', data: { file: url } });

  return reply(mc, messages);
}

/** 转发消息选项 */
export interface ForwardMsgOptions {
  /** 发送者 ID */
  userId?: string | number;
  /** 发送者昵称 */
  nickname?: string;
}

/**
 * 解析 CQ 码，将文本转换为消息段数组
 */
export function parseCQCode (text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const regex = /\[CQ:([a-z_]+)(?:,([^\]]+))?\]/gi;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // 添加 CQ 码前的纯文本
    if (match.index > lastIndex) {
      const plainText = text.slice(lastIndex, match.index);
      if (plainText) segments.push({ type: 'text', data: { text: plainText } });
    }

    // 解析 CQ 码
    const type = match[1];
    const paramsStr = match[2] || '';
    const data: Record<string, string> = {};

    // 解析参数
    if (paramsStr) {
      // 处理可能包含逗号的参数值（如 url、base64）
      const params = paramsStr.split(/,(?=[a-z_]+=)/i);
      for (const param of params) {
        const eqIndex = param.indexOf('=');
        if (eqIndex > 0) {
          const key = param.slice(0, eqIndex).trim();
          const value = param.slice(eqIndex + 1).trim();
          // CQ 码转义还原
          data[key] = value
            .replace(/&#44;/g, ',')
            .replace(/&#91;/g, '[')
            .replace(/&#93;/g, ']')
            .replace(/&amp;/g, '&');
        }
      }
    }

    segments.push({ type, data });
    lastIndex = regex.lastIndex;
  }

  // 添加剩余的纯文本
  if (lastIndex < text.length) {
    const plainText = text.slice(lastIndex);
    if (plainText) segments.push({ type: 'text', data: { text: plainText } });
  }

  // 如果没有 CQ 码，返回整个文本
  if (segments.length === 0 && text) {
    return [{ type: 'text', data: { text } }];
  }

  return segments;
}

/**
 * 发送合并转发消息
 * 支持 CQ 码格式的消息内容
 */
export async function makeForwardMsg (input: OB11Message | MsgContext, messages: string[], options?: ForwardMsgOptions): Promise<any> {
  try {
    const mc = getMsgContext(input);
    const senderId = String(options?.userId ?? 66600000);
    const senderName = options?.nickname ?? '三角洲助手';

    // 构建合并转发消息节点，使用 parseCQCode 解析内容
    const nodes = messages.map(content => ({
      type: 'node',
      data: {
        name: senderName,
        uin: senderId,
        content: parseCQCode(content),
      },
    }));

    // 根据消息类型选择 API
    const isGroup = mc.event.message_type === 'group';
    const action = isGroup ? 'send_group_forward_msg' : 'send_private_forward_msg';
    const params = isGroup
      ? { group_id: String((mc.event as any).group_id), messages: nodes }
      : { user_id: String(mc.event.user_id), messages: nodes };

    // 使用 actions.call 发送合并转发消息
    return await mc.ctx.actions.call(
      action,
      params as never,
      mc.ctx.adapterName,
      mc.ctx.pluginManager.config,
    );
  } catch (error) {
    pluginState.log('error', '发送转发消息失败:', error);
    // 降级为普通消息，分别发送
    for (const msg of messages) {
      await reply(input, parseCQCode(msg));
    }
    return null;
  }
}

/** 发送消息到指定目标（统一群聊/私聊） */
async function sendDirectMsg (type: 'group' | 'private', targetId: string | number, message: string | MessageSegment[]): Promise<any> {
  try {
    const ctx = pluginState.getContext();
    if (!ctx) throw new Error('上下文未初始化');
    const params = type === 'group'
      ? { message_type: 'group' as const, group_id: Number(targetId), message }
      : { message_type: 'private' as const, user_id: Number(targetId), message };
    return await ctx.actions.get('send_msg')?.handle(params);
  } catch (error) {
    pluginState.log('error', `发送${type === 'group' ? '群' : '私聊'}消息失败:`, error);
    return null;
  }
}

export const sendGroupMsg = (groupId: string | number, message: string | MessageSegment[]) => sendDirectMsg('group', groupId, message);
export const sendPrivateMsg = (userId: string | number, message: string | MessageSegment[]) => sendDirectMsg('private', userId, message);

export default { reply, replyImage, replyAt, recallMsg, isGroupMsg, getUserId, sendAudio, makeForwardMsg, sendGroupMsg, sendPrivateMsg };

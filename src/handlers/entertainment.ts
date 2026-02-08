/**
 * 娱乐功能处理器
 * TTS 语音合成
 */

import type { OB11Message } from 'napcat-types';
import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import { reply, replyAt, getUserId, isGroupMsg } from '../utils/message';
import { checkApiError, sleep } from '../utils/error-handler';
import type { CommandDef } from '../utils/command';
import fs from 'node:fs';
import path from 'node:path';

/** TTS 缓存 (userId -> 语音信息) */
const ttsCache = new Map<string, { audio_url: string; filename: string; localPath?: string; timestamp: number; }>();

/** TTS 预设缓存 */
let ttsPresetsCache: any[] = [];
let ttsPresetsCacheTime = 0;
const PRESET_CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['tts状态'], handler: 'getTtsHealth', name: 'TTS状态' },
  { keywords: ['tts角色列表', 'tts预设列表', 'tts角色', 'tts预设'], handler: 'getTtsPresets', name: 'TTS角色列表' },
  { keywords: ['tts角色详情'], handler: 'getTtsPresetDetail', name: 'TTS角色详情', hasArgs: true },
  { keywords: ['tts'], handler: 'ttsSynthesize', name: 'TTS语音合成', hasArgs: true },
];

/** 获取缓存目录 */
function getTtsCacheDir (): string {
  const cacheDir = path.join(pluginState.dataPath, 'tts_cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

/** 刷新 TTS 预设缓存 */
async function refreshTtsPresets (): Promise<any[]> {
  const api = createApi();
  const res = await api.getTtsPresets();

  if (!res || !(res as any).success || !(res as any).data?.presets) {
    return [];
  }

  ttsPresetsCache = (res as any).data.presets;
  ttsPresetsCacheTime = Date.now();
  return ttsPresetsCache;
}

/** 获取 TTS 预设列表 (带缓存) */
async function getPresets (): Promise<any[]> {
  if (ttsPresetsCache.length > 0 && Date.now() - ttsPresetsCacheTime < PRESET_CACHE_TTL) {
    return ttsPresetsCache;
  }
  return refreshTtsPresets();
}

/** 检查 TTS 权限 */
function checkTtsPermission (msg: OB11Message): { allowed: boolean; message: string; } {
  const config = pluginState.getConfig();
  const ttsConfig = config.tts || {};

  if (ttsConfig.enabled === false) {
    return { allowed: false, message: 'TTS 功能未启用' };
  }

  const mode = ttsConfig.mode || 'blacklist';
  const groupList = (ttsConfig.group_list || []).map(String);
  const userList = (ttsConfig.user_list || []).map(String);

  const userId = getUserId(msg);
  const groupId = isGroupMsg(msg) ? String((msg as any).group_id) : null;

  if (mode === 'whitelist') {
    const userAllowed = userList.includes(userId);
    const groupAllowed = groupId && groupList.includes(groupId);
    if (!userAllowed && !groupAllowed) {
      return { allowed: false, message: 'TTS 功能未对您开放' };
    }
  } else {
    if (userList.includes(userId)) {
      return { allowed: false, message: 'TTS 功能已被禁用' };
    }
    if (groupId && groupList.includes(groupId)) {
      return { allowed: false, message: 'TTS 功能在本群已被禁用' };
    }
  }

  return { allowed: true, message: '' };
}

/** 解析 TTS 参数 */
async function parseTtsParams (params: string): Promise<{
  character: string | null;
  characterName: string | null;
  emotion: string | null;
  emotionName: string | null;
  text: string | null;
  error: string | null;
}> {
  const result = { character: null as string | null, characterName: null as string | null, emotion: null as string | null, emotionName: null as string | null, text: null as string | null, error: null as string | null };

  const presets = await getPresets();
  if (!presets || presets.length === 0) {
    result.error = 'TTS 预设数据不可用，请稍后重试';
    return result;
  }

  // 构建角色和情感映射
  const characterMap: Record<string, { id: string; name: string; emotions: any[]; }> = {};
  const emotionMap: Record<string, { id: string; name: string; }> = {};

  for (const preset of presets) {
    characterMap[preset.id.toLowerCase()] = { id: preset.id, name: preset.name, emotions: preset.emotions || [] };
    characterMap[preset.name] = { id: preset.id, name: preset.name, emotions: preset.emotions || [] };

    if (preset.emotions) {
      for (const emo of preset.emotions) {
        emotionMap[emo.id.toLowerCase()] = { id: emo.id, name: emo.name };
        emotionMap[emo.name] = { id: emo.id, name: emo.name };
      }
    }
  }

  // 按空格分割参数
  const words = params.split(/\s+/);
  if (words.length < 2) {
    result.error = `格式错误，请使用空格分隔角色和文本\n正确格式：tts 角色 [情感] 文本`;
    return result;
  }

  // 第一个词：匹配角色
  const firstWord = words[0];
  const matchedChar = characterMap[firstWord] || characterMap[firstWord.toLowerCase()];

  if (!matchedChar) {
    result.error = `未识别的角色: "${firstWord}"`;
    return result;
  }

  result.character = matchedChar.id;
  result.characterName = matchedChar.name;
  let consumedWords = 1;

  // 第二个词：尝试匹配情感
  if (words.length > 2) {
    const secondWord = words[1];
    const matchedEmo = emotionMap[secondWord] || emotionMap[secondWord.toLowerCase()];

    if (matchedEmo) {
      result.emotion = matchedEmo.id;
      result.emotionName = matchedEmo.name;
      consumedWords = 2;
    }
  }

  // 剩余部分作为文本
  result.text = words.slice(consumedWords).join(' ').trim();

  if (!result.text) {
    result.error = `请输入要合成的文本`;
    return result;
  }

  return result;
}

/** 轮询 TTS 任务状态 - 与原版一致 */
async function pollTaskStatus (taskId: string): Promise<{ success: boolean; audio_url?: string; filename?: string; duration_ms?: number; expires_in?: number; message?: string; }> {
  const api = createApi();
  const maxAttempts = 90; // 最多轮询90次（与原版一致）
  const pollInterval = 5000; // 每5秒轮询一次
  let lastStatus = '';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await api.getTtsTaskStatus(taskId);

      // API 请求失败或返回错误 - 继续轮询（与原版一致）
      if (!res || !(res as any).success || !(res as any).data) {
        const errMsg = (res as any)?.message || '未知错误';
        // 网络错误不算严重错误，继续轮询
        pluginState.log('warn', `TTS 任务状态查询失败: ${errMsg}`);
        await sleep(pollInterval);
        continue;
      }

      const { status, result, error, position, message } = (res as any).data;

      // 状态变化时记录日志
      if (status !== lastStatus) {
        pluginState.log('debug', `TTS 任务状态: ${status} (taskId: ${taskId})`);
        lastStatus = status;
      }

      switch (status) {
        case 'completed':
          // 任务完成
          if (result && result.audio_url) {
            return {
              success: true,
              audio_url: result.audio_url,
              filename: result.filename,
              duration_ms: result.duration_ms,
              expires_in: result.expires_in,
            };
          }
          return { success: false, message: '任务完成但未获取到音频链接' };

        case 'failed':
          // 任务失败 - 处理网络错误消息
          const failMsg = error || '语音合成失败';
          // 如果是网络错误，提供友好消息
          if (failMsg.includes('ECONNREFUSED') || failMsg.includes('fetch') || failMsg.includes('network')) {
            return { success: false, message: '语音合成服务暂时不可用' };
          }
          return { success: false, message: failMsg };

        case 'queued':
        case 'processing':
          // 继续等待
          break;

        default:
          pluginState.log('warn', `未知的 TTS 任务状态: ${status}`);
      }

      await sleep(pollInterval);
    } catch (error: any) {
      // 网络异常，继续轮询（与原版一致）
      pluginState.log('error', `TTS 任务状态轮询异常: ${error}`);
      await sleep(pollInterval);
    }
  }

  return { success: false, message: '语音合成超时，请稍后重试' };
}

/** 下载音频到本地缓存 */
async function downloadToCache (audioUrl: string, filename: string, userId: string): Promise<string | null> {
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const localFilename = `${userId}_${Date.now()}_${filename || 'tts.wav'}`;
    const localPath = path.join(getTtsCacheDir(), localFilename);

    fs.writeFileSync(localPath, buffer);
    pluginState.log('info', `TTS 音频已缓存: ${localPath}`);

    return localPath;
  } catch (error) {
    pluginState.log('error', '下载 TTS 音频到缓存失败:', error);
    return null;
  }
}

/** 获取 TTS 服务状态 */
export async function getTtsHealth (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  await reply(msg, '正在检查 TTS 服务状态...');

  const res = await api.getTtsHealth();
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).success) {
    await reply(msg, 'TTS 服务异常，请稍后重试');
    return true;
  }

  const data = res as any;
  let text = '【TTS 语音合成服务状态】\n\n';
  text += `状态: ${data.message || '正常'}\n`;
  text += `预设加载: ${data.presetsLoaded ? '✅ 已加载' : '❌ 未加载'}\n`;
  text += `预设数量: ${data.presetCount || 0} 个`;

  await reply(msg, text);
  return true;
}

/** 获取 TTS 角色预设列表 */
export async function getTtsPresets (msg: OB11Message): Promise<boolean> {
  await reply(msg, '正在获取 TTS 角色预设列表...');

  const presets = await getPresets();
  if (!presets || presets.length === 0) {
    await reply(msg, '获取角色预设列表失败');
    return true;
  }

  let text = `【TTS 角色预设列表】\n共 ${presets.length} 个角色\n\n`;

  for (const preset of presets.slice(0, 10)) {
    text += `【${preset.name}】\n`;
    text += `ID: ${preset.id}\n`;
    text += `描述: ${preset.description || '无'}\n`;
    if (preset.emotions && preset.emotions.length > 0) {
      const emotionNames = preset.emotions.map((e: any) => e.name).join('、');
      text += `情感: ${emotionNames}\n`;
    }
    text += '\n';
  }

  if (presets.length > 10) {
    text += `... 还有 ${presets.length - 10} 个角色\n`;
  }

  text += '\n使用方法：tts 角色 [情感] 文本内容';
  await reply(msg, text);
  return true;
}

/** 获取 TTS 角色详情 */
export async function getTtsPresetDetail (msg: OB11Message, args: string): Promise<boolean> {
  const characterId = args.trim();
  if (!characterId) {
    await reply(msg, '请指定角色ID\n例如：tts角色详情 maiXiaowen');
    return true;
  }

  const api = createApi();
  await reply(msg, `正在获取角色 "${characterId}" 的详情...`);

  const res = await api.getTtsPreset(characterId);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).success || !(res as any).data) {
    await reply(msg, `未找到角色 "${characterId}"`);
    return true;
  }

  const preset = (res as any).data;
  let text = `【${preset.name}】\n\n`;
  text += `ID: ${preset.id}\n`;
  text += `描述: ${preset.description || '无'}\n`;
  text += `默认情感: ${preset.defaultEmotion || 'neutral'}\n`;

  if (preset.emotions && preset.emotions.length > 0) {
    text += '\n【可用情感】\n';
    preset.emotions.forEach((emo: any) => {
      text += `• ${emo.name} (${emo.id})`;
      if (emo.description) text += ` - ${emo.description}`;
      text += '\n';
    });
  }

  await reply(msg, text);
  return true;
}

/** TTS 语音合成 */
export async function ttsSynthesize (msg: OB11Message, args: string): Promise<boolean> {
  // 检查权限
  const permission = checkTtsPermission(msg);
  if (!permission.allowed) {
    await reply(msg, permission.message);
    return true;
  }

  const params = args.trim();
  if (!params) {
    await reply(msg, '请输入要合成的内容\n格式：tts 角色 [情感] 文本');
    return true;
  }

  // 解析参数
  const parseResult = await parseTtsParams(params);
  if (parseResult.error) {
    await reply(msg, parseResult.error);
    return true;
  }

  if (!parseResult.text) {
    await reply(msg, '请输入要合成的文本内容');
    return true;
  }

  // 检查文本长度
  const config = pluginState.getConfig();
  const maxLength = config.tts?.max_length || 800;
  if (parseResult.text.length > maxLength) {
    await reply(msg, `文本过长（${parseResult.text.length}字），最多支持${maxLength}字符`);
    return true;
  }

  // 构建 API 请求参数
  const apiParams: { text: string; character?: string; emotion?: string; } = { text: parseResult.text };
  if (parseResult.character) apiParams.character = parseResult.character;
  if (parseResult.emotion) apiParams.emotion = parseResult.emotion;

  const api = createApi();
  const res = await api.ttsSynthesize(apiParams);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).success || !(res as any).data?.taskId) {
    await reply(msg, `语音合成失败: ${(res as any)?.message || '未知错误'}`);
    return true;
  }

  const { taskId, position, queueLength } = (res as any).data;

  // 发送队列提示
  let queueHint = '语音合成任务已提交';
  if (parseResult.characterName) {
    queueHint += `\n角色: ${parseResult.characterName}`;
    if (parseResult.emotionName) queueHint += ` | 情感: ${parseResult.emotionName}`;
  }
  if (position && queueLength) {
    queueHint += `\n队列位置: ${position}/${queueLength}`;
  }
  queueHint += '\n正在处理中，请稍候...';

  await reply(msg, queueHint);

  // 轮询任务状态
  const result = await pollTaskStatus(taskId);

  if (!result.success) {
    // 网络错误时显示友好消息
    const errMsg = result.message || '';
    if (errMsg.includes('ECONNREFUSED') || errMsg.includes('fetch failed') || errMsg.includes('网络')) {
      await reply(msg, '语音合成服务暂时不可用，请稍后重试');
    } else {
      await reply(msg, result.message || '语音合成失败');
    }
    return true;
  }

  // 下载并缓存到本地
  const userId = getUserId(msg);
  const localPath = await downloadToCache(result.audio_url!, result.filename || 'tts.wav', userId);

  // 保存到缓存（5分钟有效）
  ttsCache.set(userId, {
    audio_url: result.audio_url!,
    filename: result.filename || 'tts.wav',
    localPath: localPath || undefined,
    timestamp: Date.now(),
  });

  // 5分钟后清理缓存
  setTimeout(() => {
    const cached = ttsCache.get(userId);
    if (cached && cached.localPath) {
      try {
        fs.unlinkSync(cached.localPath);
      } catch (e) { /* ignore */ }
    }
    ttsCache.delete(userId);
  }, 5 * 60 * 1000);

  // 发送语音
  const ctx = pluginState.getContext();
  if (ctx && ctx.sendApi && localPath) {
    try {
      const fileUrl = `file:///${localPath.replace(/\\/g, '/')}`;
      await ctx.sendApi.sendMsgWithOb11Segs(
        isGroupMsg(msg) ? { chatType: 2, peerUid: String((msg as any).group_id) } : { chatType: 1, peerUid: String(msg.sender?.user_id || msg.user_id) },
        [{ type: 'record', data: { file: fileUrl } }]
      );
      pluginState.log('info', `TTS 合成成功: ${result.filename}`);
    } catch (error) {
      pluginState.log('error', 'TTS 发送语音失败:', error);
      await reply(msg, `语音合成成功，但发送失败。音频链接: ${result.audio_url}`);
    }
  } else {
    await reply(msg, `语音合成成功！\n音频链接: ${result.audio_url}`);
  }

  return true;
}

export default {
  commands,
  getTtsHealth,
  getTtsPresets,
  getTtsPresetDetail,
  ttsSynthesize,
};

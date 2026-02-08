/**
 * TTS 语音合成处理器
 * 支持角色语音合成、预设管理等
 */

import type { OB11Message } from 'napcat-types';
import type { CommandDef } from '../utils/command';
import { createApi } from '../core/api';
import { pluginState } from '../core/state';
import { reply, getUserId, sendAudio, makeForwardMsg } from '../utils/message';
import { checkApiError, sleep } from '../utils/error-handler';
import fs from 'node:fs';
import path from 'node:path';

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['tts状态', 'TTS状态'], handler: 'getTtsHealth', name: 'TTS状态' },
  { keywords: ['tts角色列表', 'TTS角色列表', 'tts预设列表', 'TTS预设列表'], handler: 'getTtsPresets', name: 'TTS角色列表' },
  { keywords: ['tts角色详情', 'TTS角色详情'], handler: 'getTtsPresetDetail', name: 'TTS角色详情', hasArgs: true },
  { keywords: ['tts上传', 'TTS上传'], handler: 'downloadLastTts', name: 'TTS上传' },
  { keywords: ['tts', 'TTS'], handler: 'synthesize', name: 'TTS合成', hasArgs: true },
];

/** TTS 缓存 */
interface TtsCacheItem {
  audioUrl: string;
  filename: string;
  localPath?: string;
  timestamp: number;
}
const ttsCache = new Map<string, TtsCacheItem>();
const TTS_CACHE_TIMEOUT = 5 * 60 * 1000; // 5分钟

/** 获取缓存目录 */
function getTtsCacheDir (): string {
  const ctx = pluginState.getContext();
  if (!ctx?.configPath) return '';
  return path.join(path.dirname(ctx.configPath), 'tts-cache');
}

/** 确保缓存目录存在 */
function ensureCacheDir (): string {
  const cacheDir = getTtsCacheDir();
  if (cacheDir && !fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
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

  let text = '【TTS 语音合成服务状态】\n\n';
  text += `状态: ${(res as any).message || '正常'}\n`;
  text += `预设加载: ${(res as any).presetsLoaded ? '✅ 已加载' : '❌ 未加载'}\n`;
  text += `预设数量: ${(res as any).presetCount || 0} 个\n`;

  if ((res as any).timestamp) {
    const time = new Date((res as any).timestamp).toLocaleString('zh-CN');
    text += `检查时间: ${time}`;
  }

  await reply(msg, text);
  return true;
}

/** 获取 TTS 角色预设列表 */
export async function getTtsPresets (msg: OB11Message): Promise<boolean> {
  const api = createApi();

  await reply(msg, '正在获取 TTS 角色预设列表...');

  const res = await api.getTtsPresets();
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).success || !(res as any).data?.presets) {
    await reply(msg, '获取角色预设列表失败');
    return true;
  }

  const { defaultPreset, presets } = (res as any).data;

  // 构建转发消息
  const messages: string[] = [];

  messages.push(`【TTS 角色预设列表】\n共 ${presets.length} 个角色\n默认角色: ${defaultPreset}`);

  for (const preset of presets) {
    let charMsg = `【${preset.name}】\n`;
    charMsg += `ID: ${preset.id}\n`;
    charMsg += `描述: ${preset.description || '无'}\n`;
    charMsg += `默认情感: ${preset.defaultEmotion || 'neutral'}\n`;

    if (preset.emotions?.length > 0) {
      charMsg += '\n可用情感:\n';
      preset.emotions.forEach((emo: any) => {
        charMsg += `  • ${emo.name} (${emo.id})`;
        if (emo.description) charMsg += ` - ${emo.description}`;
        charMsg += '\n';
      });
    }

    messages.push(charMsg.trim());
  }

  messages.push('使用方法：\n• 三角洲tts [角色] [情感] 文本内容\n• 三角洲tts 麦晓雯 开心 你好呀！\n• 三角洲tts 麦晓雯 我是麦晓雯\n\n提示：情感可选，不填则使用默认情感');

  // 发送转发消息
  await makeForwardMsg(msg, messages);
  return true;
}

/** 获取 TTS 角色预设详情 */
export async function getTtsPresetDetail (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const characterId = args.trim();

  if (!characterId) {
    await reply(msg, '请指定角色ID\n例如：三角洲tts角色详情 maiXiaowen');
    return true;
  }

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
  text += `音色文件: ${preset.voiceFileExists ? '✅ 存在' : '❌ 缺失'}\n`;

  if (preset.emotions?.length > 0) {
    text += '\n【可用情感】\n';
    preset.emotions.forEach((emo: any) => {
      text += `• ${emo.name} (${emo.id})\n`;
      if (emo.description) text += `  ${emo.description}\n`;
    });
  }

  await reply(msg, text.trim());
  return true;
}

/** TTS 语音合成 */
export async function synthesize (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);

  if (!args.trim()) {
    await reply(msg, '请输入要合成的内容\n格式：三角洲tts [角色] [情感] 文本内容\n示例：三角洲tts 麦晓雯 开心 你好呀！');
    return true;
  }

  // 解析参数
  const parseResult = await parseTtsParams(args);

  if (parseResult.error) {
    await reply(msg, parseResult.error);
    return true;
  }

  if (!parseResult.text) {
    await reply(msg, '请输入要合成的文本内容');
    return true;
  }

  // 检查文本长度
  const maxLength = 800;
  if (parseResult.text.length > maxLength) {
    await reply(msg, `文本过长（${parseResult.text.length}字），最多支持${maxLength}字符`);
    return true;
  }

  // 构建 API 请求参数
  const apiParams: { text: string; character?: string; emotion?: string; } = {
    text: parseResult.text,
  };

  if (parseResult.character) apiParams.character = parseResult.character;
  if (parseResult.emotion) apiParams.emotion = parseResult.emotion;

  pluginState.logDebug(`TTS 请求参数: ${JSON.stringify(apiParams)}`);

  // 调用 TTS 合成 API
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
    await reply(msg, result.message || '语音合成失败');
    return true;
  }

  // 缓存语音信息
  ttsCache.set(userId, {
    audioUrl: result.audioUrl || '',
    filename: result.filename || 'tts_audio.wav',
    timestamp: Date.now(),
  });

  // 设置缓存过期
  setTimeout(() => {
    const cached = ttsCache.get(userId);
    if (cached?.localPath) {
      try { fs.unlinkSync(cached.localPath); } catch (e) { /* ignore */ }
    }
    ttsCache.delete(userId);
  }, TTS_CACHE_TIMEOUT);

  // 发送语音
  await sendAudio(msg, result.audioUrl || '');

  pluginState.log('info', `TTS 合成成功: ${result.filename || 'tts'}, 文本: ${parseResult.text?.substring(0, 20) || ''}...`);
  return true;
}

/** 下载上次合成的 TTS 语音 */
export async function downloadLastTts (msg: OB11Message): Promise<boolean> {
  const userId = getUserId(msg);
  const cached = ttsCache.get(userId);

  if (!cached) {
    await reply(msg, '暂无可下载的语音\n请先使用 三角洲tts 命令合成语音');
    return true;
  }

  // 检查是否过期
  if (Date.now() - cached.timestamp > TTS_CACHE_TIMEOUT) {
    ttsCache.delete(userId);
    await reply(msg, '语音已过期，请重新合成');
    return true;
  }

  // 发送语音
  await sendAudio(msg, cached.audioUrl);
  await reply(msg, `已发送语音文件: ${cached.filename || 'tts_audio.wav'}`);
  return true;
}

/** 轮询 TTS 任务状态 */
async function pollTaskStatus (taskId: string): Promise<{ success: boolean; message?: string; audioUrl?: string; filename?: string; }> {
  const api = createApi();
  const maxAttempts = 90;
  const pollInterval = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await api.getTtsTaskStatus(taskId);

      if (!res || !(res as any).success || !(res as any).data) {
        pluginState.logDebug(`TTS 任务状态查询失败: ${(res as any)?.message}`);
        await sleep(pollInterval);
        continue;
      }

      const { status, result, error } = (res as any).data;

      switch (status) {
        case 'completed':
          if (result?.audio_url) {
            return {
              success: true,
              audioUrl: result.audio_url,
              filename: result.filename,
            };
          }
          return { success: false, message: '任务完成但未获取到音频链接' };

        case 'failed':
          return { success: false, message: error || '语音合成失败' };

        case 'queued':
        case 'processing':
          break;

        default:
          pluginState.logDebug(`未知的 TTS 任务状态: ${status}`);
      }

      await sleep(pollInterval);
    } catch (error) {
      pluginState.log('error', 'TTS 任务状态轮询异常:', error);
      await sleep(pollInterval);
    }
  }

  return { success: false, message: '语音合成超时，请稍后重试' };
}

/** 解析 TTS 参数 */
async function parseTtsParams (params: string): Promise<{
  character?: string;
  characterName?: string;
  emotion?: string;
  emotionName?: string;
  text?: string;
  error?: string;
}> {
  const result: any = {};

  // 获取预设列表
  let presets: any[] = [];

  // 如果缓存为空，尝试刷新
  if (!presets || presets.length === 0) {
    const api = createApi();
    const res = await api.getTtsPresets();
    if (res && (res as any).success && (res as any).data?.presets) {
      presets = (res as any).data.presets;
    }
  }

  // 如果仍然没有预设数据，使用简化解析
  if (!presets || presets.length === 0) {
    // 简化模式：第一个词作为角色，其余作为文本
    const words = params.split(/\s+/);
    if (words.length >= 2) {
      result.character = words[0];
      result.characterName = words[0];
      result.text = words.slice(1).join(' ');
    } else {
      result.text = params;
    }
    return result;
  }

  // 构建角色和情感映射
  const characterMap: Record<string, any> = {};
  const emotionMap: Record<string, any> = {};

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

  // 按空格分隔解析参数
  const words = params.split(/\s+/);

  if (words.length < 2) {
    result.error = '格式错误，请使用空格分隔角色和文本\n正确格式：三角洲tts 角色 [情感] 文本';
    return result;
  }

  // 第一个词：匹配角色
  const firstWord = words[0];
  const matchedChar = characterMap[firstWord] || characterMap[firstWord.toLowerCase()];

  if (!matchedChar) {
    // 未匹配到角色，整体作为文本
    result.text = params;
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
    result.error = `请输入要合成的文本\n格式：三角洲tts ${matchedChar.name} [情感] 文本`;
    return result;
  }

  return result;
}

export default {
  commands,
  getTtsHealth,
  getTtsPresets,
  getTtsPresetDetail,
  synthesize,
  downloadLastTts,
};

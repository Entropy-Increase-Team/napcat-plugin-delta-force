/**
 * 鼠鼠音乐处理器
 * 音乐搜索、播放、歌词、歌单等功能
 */

import type { OB11Message } from 'napcat-types';
import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import { reply, replyAt, getUserId, makeForwardMsg, sendAudio } from '../utils/message';
import { handleApiError as _handleApiError } from '../utils/error-handler';
import type { CommandDef } from '../utils/command';

/** 错误处理包装 */
async function checkApiError (res: any, msg: OB11Message): Promise<boolean> {
  const result = _handleApiError(res);
  if (result.handled && result.message) {
    await reply(msg, result.message);
    return true;
  }
  return result.handled;
}

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['鼠鼠音乐'], handler: 'sendShushuMusic', name: '鼠鼠音乐', hasArgs: true },
  { keywords: ['鼠鼠音乐列表', '鼠鼠音乐排行榜'], handler: 'getShushuMusicRank', name: '鼠鼠音乐列表', hasArgs: true },
  { keywords: ['鼠鼠歌单'], handler: 'getShushuPlaylist', name: '鼠鼠歌单', hasArgs: true },
  { keywords: ['歌词', '鼠鼠歌词', '鼠鼠音乐歌词'], handler: 'getLyrics', name: '歌词' },
  { keywords: ['鼠鼠语音'], handler: 'sendShushuVoice', name: '鼠鼠语音' },
  { keywords: ['点歌', '听', '听歌', '播放'], handler: 'selectMusicByNumber', name: '点歌', hasArgs: true },
  { keywords: ['音乐缓存状态', '音乐缓存统计'], handler: 'getMusicCacheStats', name: '音乐缓存状态' },
  { keywords: ['清理音乐缓存'], handler: 'clearMusicCache', name: '清理音乐缓存' },
];

/** 音乐记忆存储 */
const musicMemory = new Map<string, { music: any; timestamp: number; }>();
const musicListMemory = new Map<string, { list: any[]; timestamp: number; type: string; }>();

const MEMORY_TIMEOUT = 2 * 60 * 1000; // 2分钟

/** 保存音乐记忆 */
function saveMusicMemory (userId: string, music: any): void {
  musicMemory.set(userId, { music, timestamp: Date.now() });
  setTimeout(() => musicMemory.delete(userId), MEMORY_TIMEOUT);
  pluginState.logDebug(`保存用户 ${userId} 的音乐记忆: ${music.fileName}`);
}

/** 保存音乐列表记忆 */
function saveMusicListMemory (userId: string, list: any[], type: string): void {
  musicListMemory.set(userId, { list, timestamp: Date.now(), type });
  setTimeout(() => musicListMemory.delete(userId), MEMORY_TIMEOUT);
  pluginState.logDebug(`保存用户 ${userId} 的音乐列表记忆: ${list.length} 首`);
}

/** 发送鼠鼠音乐 */
export async function sendShushuMusic (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);

  // 无参数时随机获取
  if (!args) {
    await reply(msg, '正在获取随机鼠鼠音乐...');
    const res = await api.getShushuMusic({ count: 1 });
    if (await checkApiError(res, msg)) return true;

    if (!res?.data?.musics || res.data.musics.length === 0) {
      await reply(msg, '未找到符合条件的音乐');
      return true;
    }

    await sendMusicMessage(msg, res.data.musics[0]);
    saveMusicMemory(userId, res.data.musics[0]);
    return true;
  }

  // 有参数时智能搜索
  await reply(msg, `正在搜索 "${args}"...`);

  // 定义搜索策略
  const strategies = [
    { param: 'playlist', label: '歌单' },
    { param: 'artist', label: '艺术家' },
    { param: 'title', label: '歌曲名' },
  ];

  let foundMusic: any = null;

  for (const strategy of strategies) {
    pluginState.logDebug(`尝试按${strategy.label}搜索: ${args}`);
    const apiParams: any = { count: 1, [strategy.param]: args };
    const res = await api.getShushuMusic(apiParams);

    if (res?.success && res?.data?.musics?.length > 0) {
      foundMusic = res.data.musics[0];
      pluginState.logDebug(`${strategy.label}搜索成功: ${args}`);
      break;
    }
  }

  if (!foundMusic) {
    await reply(msg, `未找到与 "${args}" 相关的音乐\n已尝试搜索：歌单、艺术家、歌曲名`);
    return true;
  }

  await sendMusicMessage(msg, foundMusic);
  saveMusicMemory(userId, foundMusic);
  return true;
}

/** 发送音乐消息 */
async function sendMusicMessage (msg: OB11Message, music: any): Promise<void> {
  if (!music.download?.url) {
    pluginState.log('error', '音乐数据缺少下载链接:', music);
    await reply(msg, '音乐数据异常，请稍后重试');
    return;
  }

  // 构建消息
  const msgParts: string[] = [];

  if (music.fileName && music.artist) {
    msgParts.push(`♪ ${music.fileName} - ${music.artist}`);
  } else if (music.fileName) {
    msgParts.push(`♪ ${music.fileName}`);
  }

  if (music.playlist?.name) {
    msgParts.push(`歌单: ${music.playlist.name}`);
  }

  if (music.metadata?.hot) {
    msgParts.push(`🔥 ${music.metadata.hot}`);
  }

  // 发送语音
  await sendAudio(msg, music.download.url, msgParts.length > 0 ? msgParts.join('\n') + '\n' : '');
  pluginState.logDebug(`发送鼠鼠音乐: ${music.fileName} - ${music.artist}`);
}

/** 获取鼠鼠音乐热度排行榜 */
export async function getShushuMusicRank (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const pageNum = parseInt(args) || 1;

  await reply(msg, '正在获取热度排行榜...');

  const res = await api.getShushuMusicList({ sortBy: 'hot' });
  if (await checkApiError(res, msg)) return true;

  if (!res?.data || res.data.length === 0) {
    await reply(msg, '未找到音乐数据');
    return true;
  }

  // 保存列表记忆
  saveMusicListMemory(userId, res.data, 'rank');

  // 渲染音乐列表
  await renderMusicList(msg, res.data, '鼠鼠音乐热度排行榜', '最受欢迎的歌曲', pageNum);
  return true;
}

/** 获取鼠鼠歌单 */
export async function getShushuPlaylist (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);

  if (!args) {
    await reply(msg, '请指定歌单名称、ID或艺术家\n例如：三角洲鼠鼠歌单 曼波');
    return true;
  }

  await reply(msg, `正在获取歌单 "${args}"...`);

  let res: any;
  let searchType = '';

  // 先尝试歌单搜索
  res = await api.getShushuMusicList({ playlist: args, sortBy: 'default' });
  if (res?.success && res?.data?.length > 0) {
    searchType = 'playlist';
  } else {
    // 再尝试艺术家搜索
    res = await api.getShushuMusicList({ artist: args, sortBy: 'default' });
    if (res?.success && res?.data?.length > 0) {
      searchType = 'artist';
    }
  }

  if (await checkApiError(res, msg)) return true;

  if (!res?.data || res.data.length === 0) {
    await reply(msg, `未找到与 "${args}" 相关的歌单或艺术家`);
    return true;
  }

  // 保存列表记忆
  saveMusicListMemory(userId, res.data, 'playlist');

  const title = searchType === 'playlist'
    ? (res.data[0].playlist?.name || args)
    : `${args} 的歌曲`;

  const subtitle = searchType === 'playlist'
    ? `歌单 · ${args}`
    : `艺术家 · ${args}`;

  await renderMusicList(msg, res.data, title, subtitle, 1);
  return true;
}

/** 获取歌词 */
export async function getLyrics (msg: OB11Message): Promise<boolean> {
  const userId = getUserId(msg);
  const memory = musicMemory.get(userId);

  if (!memory) {
    await reply(msg, '暂无最近播放的音乐记录\n请先使用 三角洲鼠鼠音乐 播放一首歌曲');
    return true;
  }

  if (Date.now() - memory.timestamp > MEMORY_TIMEOUT) {
    musicMemory.delete(userId);
    await reply(msg, '音乐记录已过期（超过2分钟）\n请重新播放音乐');
    return true;
  }

  const music = memory.music;

  if (!music.metadata?.lrc) {
    await reply(msg, `歌曲「${music.fileName}」暂无歌词`);
    return true;
  }

  await reply(msg, `正在获取「${music.fileName}」的歌词...`);

  try {
    const response = await fetch(music.metadata.lrc);
    if (!response.ok) {
      await reply(msg, '获取歌词失败，请稍后重试');
      return true;
    }
    const lrcContent = await response.text();
    const parsedLyrics = parseLRC(lrcContent);

    const messages = [
      `【${music.fileName}】${music.artist ? `\n演唱：${music.artist}` : ''}`,
      parsedLyrics,
      '鼠鼠音乐由 @Liusy 提供',
    ];

    await makeForwardMsg(msg, messages);
  } catch (error) {
    pluginState.log('error', '获取歌词失败:', error);
    await reply(msg, '获取歌词失败，请稍后重试');
  }

  return true;
}

/** 解析LRC格式歌词 */
function parseLRC (lrcContent: string): string {
  const lines = lrcContent.split('\n');
  const lyrics: string[] = [];

  for (const line of lines) {
    const match = line.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
    if (match && match[4].trim()) {
      lyrics.push(match[4].trim());
    } else {
      const metaMatch = line.match(/\[(ti|ar|al|by):(.+)\]/);
      if (!metaMatch && line.trim() && !line.startsWith('[')) {
        lyrics.push(line.trim());
      }
    }
  }

  return lyrics.length > 0 ? lyrics.join('\n') : '（暂无歌词内容）';
}

/** 发送鼠鼠语音 */
export async function sendShushuVoice (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const memory = musicMemory.get(userId);

  // 如果没有记忆或已过期，随机获取
  if (!memory || Date.now() - memory.timestamp > MEMORY_TIMEOUT) {
    await reply(msg, '正在获取随机鼠鼠音乐（语音版）...');

    const res = await api.getShushuMusic({ count: 1 });
    if (await checkApiError(res, msg)) return true;

    if (!res?.data?.musics || res.data.musics.length === 0) {
      await reply(msg, '未找到符合条件的音乐');
      return true;
    }

    const music = res.data.musics[0];
    await sendMusicMessage(msg, music);
    saveMusicMemory(userId, music);
    return true;
  }

  // 有记忆，发送语音版
  const music = memory.music;

  if (!music.download?.url) {
    await reply(msg, '音乐数据异常，无法发送语音');
    return true;
  }

  await reply(msg, '正在转换为语音...');
  await sendMusicMessage(msg, music);
  return true;
}

/** 点歌功能 */
export async function selectMusicByNumber (msg: OB11Message, args: string): Promise<boolean> {
  const userId = getUserId(msg);
  const number = parseInt(args);

  if (isNaN(number) || number < 1) {
    await reply(msg, '请输入有效的歌曲序号');
    return true;
  }

  const listMemory = musicListMemory.get(userId);

  if (!listMemory) {
    await reply(msg, '您还没有获取音乐列表\n请先使用：\n• 三角洲鼠鼠音乐列表\n• 三角洲鼠鼠歌单 [歌单名]');
    return true;
  }

  if (Date.now() - listMemory.timestamp > MEMORY_TIMEOUT) {
    musicListMemory.delete(userId);
    await reply(msg, '音乐列表已过期（超过2分钟）\n请重新获取列表');
    return true;
  }

  if (number > listMemory.list.length) {
    await reply(msg, `序号超出范围\n请输入 1-${listMemory.list.length} 之间的数字`);
    return true;
  }

  const music = listMemory.list[number - 1];
  await sendMusicMessage(msg, music);
  saveMusicMemory(userId, music);
  return true;
}

/** 渲染音乐列表 */
async function renderMusicList (msg: OB11Message, musicList: any[], title: string, subtitle: string, page: number): Promise<void> {
  const pageSize = 10;
  const totalPages = Math.ceil(musicList.length / pageSize);

  if (page < 1 || page > totalPages) {
    await reply(msg, `页码超出范围，共 ${totalPages} 页\n使用 三角洲鼠鼠音乐列表 [页码] 查看`);
    return;
  }

  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, musicList.length);
  const displayList = musicList.slice(startIndex, endIndex);

  // 构建文本消息
  let text = `【${title}】\n${subtitle} · 第 ${page}/${totalPages} 页\n共 ${musicList.length} 首歌曲\n\n`;

  displayList.forEach((music, index) => {
    text += `${startIndex + index + 1}. ${music.fileName || '未知歌曲'}`;
    if (music.artist) text += ` - ${music.artist}`;
    if (music.metadata?.hot) text += ` 🔥${music.metadata.hot}`;
    text += '\n';
  });

  if (musicList.length > endIndex) {
    text += `\n... 还有 ${musicList.length - endIndex} 首歌曲\n`;
  }

  text += '\n使用 三角洲点歌 [序号] 播放歌曲';

  await reply(msg, text.trim());
}

/** 获取音乐缓存状态 */
export async function getMusicCacheStats (msg: OB11Message): Promise<boolean> {
  // 统计内存中的音乐记忆数量
  const musicMemoryCount = musicMemory.size;
  const musicListMemoryCount = musicListMemory.size;

  let text = '【鼠鼠音乐缓存统计】\n\n';
  text += `当前音乐记忆: ${musicMemoryCount} 条\n`;
  text += `当前列表记忆: ${musicListMemoryCount} 条\n\n`;
  text += '说明: 音乐记忆用于歌词和语音功能\n';
  text += '列表记忆用于点歌功能\n';
  text += '记忆有效期: 2 分钟\n\n';
  text += '使用 三角洲清理音乐缓存 可清空所有记忆';

  await reply(msg, text);
  return true;
}

/** 清理音乐缓存 */
export async function clearMusicCache (msg: OB11Message): Promise<boolean> {
  // 检查主人权限
  const userId = getUserId(msg);
  const masterQQ = pluginState.getConfig().master_qq;

  if (!masterQQ || String(userId) !== String(masterQQ)) {
    await reply(msg, '抱歉，只有机器人主人才能清理缓存');
    return true;
  }

  const musicCount = musicMemory.size;
  const listCount = musicListMemory.size;

  // 清空所有记忆
  musicMemory.clear();
  musicListMemory.clear();

  await reply(msg, `✅ 音乐缓存已清空\n清理音乐记忆: ${musicCount} 条\n清理列表记忆: ${listCount} 条`);
  return true;
}

export default {
  commands,
  sendShushuMusic,
  getShushuMusicRank,
  getShushuPlaylist,
  getLyrics,
  sendShushuVoice,
  selectMusicByNumber,
  getMusicCacheStats,
  clearMusicCache,
};

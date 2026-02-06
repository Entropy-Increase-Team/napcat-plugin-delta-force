/**
 * 游戏语音处理器
 * 支持角色语音、标签语音、分类语音等
 */

import type { OB11Message } from 'napcat-types';
import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import { reply, replyAt, getUserId, makeForwardMsg, sendAudio } from '../utils/message';
import { handleApiError as _handleApiError } from '../utils/error-handler';
import type { CommandDef } from '../utils/command';
import { dataManager } from '../services/data-manager';

/** 错误处理包装 */
async function checkApiError (res: any, msg: OB11Message): Promise<boolean> {
  const result = _handleApiError(res);
  if (result.handled && result.message) {
    let errorMsg = result.message;
    // 角色参数相关错误，添加提示
    if (errorMsg.includes('无法识别的角色参数') || errorMsg.includes('角色') || errorMsg.includes('干员')) {
      errorMsg += '\n\n可发送 三角洲语音列表 查看所有可用角色';
    }
    await reply(msg, errorMsg);
    return true;
  }
  return result.handled;
}

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['语音列表'], handler: 'getCharacterList', name: '语音列表' },
  { keywords: ['标签列表'], handler: 'getTagList', name: '标签列表' },
  { keywords: ['语音分类'], handler: 'getCategoryList', name: '语音分类' },
  { keywords: ['语音统计'], handler: 'getAudioStats', name: '语音统计' },
  { keywords: ['语音'], handler: 'sendVoice', name: '语音', hasArgs: true },
];

/** 场景映射 */
const sceneMap: Record<string, string> = {
  '局内': 'InGame',
  '局外': 'OutGame',
  'ingame': 'InGame',
  'outgame': 'OutGame',
};

/** 动作类型映射 */
const actionMap: Record<string, string> = {
  '呼吸': 'Breath',
  '战斗': 'Combat',
  '死亡': 'Death',
  '受伤': 'Pain',
  'breath': 'Breath',
  'combat': 'Combat',
  'death': 'Death',
  'pain': 'Pain',
};

/** 解析语音参数 */
function parseVoiceParams (params: string): { category?: string; tag?: string; character?: string; scene?: string; actionType?: string; hint: string; } {
  if (!params) return { hint: '随机' };

  const args = params.split(/\s+/).filter(arg => arg);
  const result: any = {};
  let hint = '';

  if (args[0]) {
    const firstArg = args[0];

    // 检查场景
    if (sceneMap[firstArg] || sceneMap[firstArg.toLowerCase()]) {
      result.scene = sceneMap[firstArg] || sceneMap[firstArg.toLowerCase()];
      hint = firstArg;
    } else if (actionMap[firstArg] || actionMap[firstArg.toLowerCase()]) {
      // 检查动作类型
      result.actionType = actionMap[firstArg] || actionMap[firstArg.toLowerCase()];
      hint = firstArg;
    } else {
      // 默认当作角色参数
      result.character = firstArg;
      hint = firstArg;
    }
  }

  // 第二个参数
  if (args[1]) {
    const secondArg = args[1];
    if (sceneMap[secondArg] || sceneMap[secondArg.toLowerCase()]) {
      result.scene = sceneMap[secondArg] || sceneMap[secondArg.toLowerCase()];
      hint += ` ${secondArg}`;
    } else if (actionMap[secondArg] || actionMap[secondArg.toLowerCase()]) {
      result.actionType = actionMap[secondArg] || actionMap[secondArg.toLowerCase()];
      hint += ` ${secondArg}`;
    }
  }

  // 第三个参数
  if (args[2]) {
    const thirdArg = args[2];
    if (actionMap[thirdArg] || actionMap[thirdArg.toLowerCase()]) {
      result.actionType = actionMap[thirdArg] || actionMap[thirdArg.toLowerCase()];
      hint += ` ${thirdArg}`;
    }
  }

  result.hint = hint || '随机';
  return result;
}

/** 发送语音 */
export async function sendVoice (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const queryParams = parseVoiceParams(args);

  await reply(msg, `正在获取 ${queryParams.hint} 语音...`);

  let res: any;
  if (queryParams.category) {
    res = await api.getRandomAudio({ category: queryParams.category, count: 1 });
  } else if (queryParams.tag) {
    res = await api.getRandomAudio({ tag: queryParams.tag, count: 1 });
  } else if (queryParams.character || queryParams.scene || queryParams.actionType) {
    const apiParams: any = { count: 1 };
    if (queryParams.character) apiParams.character = queryParams.character;
    if (queryParams.scene) apiParams.scene = queryParams.scene;
    if (queryParams.actionType) apiParams.actionType = queryParams.actionType;
    res = await api.getCharacterAudio(apiParams);
  } else {
    res = await api.getRandomAudio({ count: 1 });
  }

  if (await checkApiError(res, msg)) return true;

  if (!res?.data?.audios || res.data.audios.length === 0) {
    await reply(msg, '未找到符合条件的语音\n使用 三角洲语音列表 查看所有可用内容');
    return true;
  }

  const audio = res.data.audios[0];
  await sendVoiceMessage(msg, audio);
  return true;
}

/** 发送语音消息 */
async function sendVoiceMessage (msg: OB11Message, audio: any): Promise<void> {
  if (!audio.download?.url) {
    pluginState.log('error', '音频数据缺少下载链接:', audio);
    await reply(msg, '音频数据异常，请稍后重试');
    return;
  }

  // 构建提示信息
  const infoMsg: string[] = [];

  if (audio.character?.name) {
    let charInfo = `【${audio.character.name}】`;
    if (audio.character.profession) charInfo += ` (${audio.character.profession})`;
    infoMsg.push(charInfo);
  }

  if (audio.scene || audio.actionType) {
    let detail = '';
    if (audio.scene === 'InGame') detail += '局内';
    else if (audio.scene === 'OutGame') detail += '局外';
    if (audio.actionType) {
      if (detail) detail += ' - ';
      detail += audio.actionType;
    }
    if (detail) infoMsg.push(detail);
  }

  if (audio.download.expiresIn) {
    const minutes = Math.floor(audio.download.expiresIn / 60);
    const seconds = audio.download.expiresIn % 60;
    infoMsg.push(`(链接${minutes}分${seconds}秒后失效)`);
  }

  // 发送语音
  const prefix = infoMsg.length > 0 ? `${infoMsg.join(' ')}\n` : '';
  await sendAudio(msg, audio.download.url, prefix);

  const characterName = audio.character?.name || '未知';
  pluginState.logDebug(`发送语音: ${audio.fileName} (角色: ${characterName})`);
}

/** 获取角色列表 */
export async function getCharacterList (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  await reply(msg, '正在获取角色列表...');

  const res = await api.getAudioCharacters();
  if (await checkApiError(res, msg)) return true;

  if (!res?.data?.characters) {
    await reply(msg, '获取角色列表失败');
    return true;
  }

  // 按职业分组
  const groups: Record<string, any[]> = {
    '医疗': [],
    '侦查': [],
    '突击': [],
    '工程': [],
    '其他': [],
  };

  res.data.characters.forEach((char: any) => {
    const profession = char.profession || '其他';
    const name = char.name || char.voiceId || '未知';
    const voiceId = char.voiceId;

    let groupKey = profession;
    if (!groups[profession]) {
      if (voiceId?.startsWith('Voice_1')) groupKey = '医疗';
      else if (voiceId?.startsWith('Voice_2')) groupKey = '侦查';
      else if (voiceId?.startsWith('Voice_3')) groupKey = '突击';
      else if (voiceId?.startsWith('Voice_4')) groupKey = '工程';
      else groupKey = '其他';
    }

    groups[groupKey].push({
      voiceId,
      name,
      operatorId: char.operatorId,
      skins: char.skins || [],
    });
  });

  // 构建转发消息
  const messages: string[] = [];
  messages.push(`【三角洲角色语音列表】\n共 ${res.data.characters.length} 个角色`);

  for (const [category, characters] of Object.entries(groups)) {
    if (characters.length > 0) {
      let text = `【${category}】\n\n`;
      characters.forEach((char, index) => {
        text += `${index + 1}. ${char.name}`;
        if (char.voiceId) text += ` (${char.voiceId})`;
        if (char.skins?.length > 0) {
          text += '\n   皮肤: ';
          char.skins.forEach((skin: any, idx: number) => {
            if (idx > 0) text += ', ';
            text += `${skin.name} (${skin.voiceId})`;
          });
        }
        text += '\n';
      });
      messages.push(text);
    }
  }

  messages.push('使用方法：\n• 三角洲语音 [角色名]\n• 三角洲语音 [角色名] [局内/局外]\n• 三角洲语音 [角色名] [局内/局外] [呼吸/战斗]\n\n提示：支持使用中文角色名和Voice ID');

  await makeForwardMsg(msg, messages);
  return true;
}

/** 获取标签列表 */
export async function getTagList (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  await reply(msg, '正在获取特殊标签列表...');

  const res = await api.getAudioTags();
  if (await checkApiError(res, msg)) return true;

  if (!res?.data?.tags) {
    await reply(msg, '获取特殊标签列表失败');
    return true;
  }

  // 按类型分组
  const groups: Record<string, { tag: string; desc: string; }[]> = {
    'Boss语音': [],
    '任务语音': [],
    '撤离语音': [],
    '彩蛋语音': [],
    '全面战场': [],
    '其他': [],
  };

  res.data.tags.forEach((tagInfo: any) => {
    const tag = tagInfo.tag || tagInfo;
    const desc = tagInfo.description || '';
    const item = { tag, desc };

    if (tag.startsWith('boss-')) groups['Boss语音'].push(item);
    else if (tag.startsWith('task-')) groups['任务语音'].push(item);
    else if (tag.startsWith('Evac-')) groups['撤离语音'].push(item);
    else if (tag.startsWith('eggs-')) groups['彩蛋语音'].push(item);
    else if (tag.startsWith('bf-') || tag.startsWith('BF_')) groups['全面战场'].push(item);
    else groups['其他'].push(item);
  });

  // 构建转发消息
  const messages: string[] = [];
  messages.push(`【三角洲特殊语音标签】\n共 ${res.data.tags.length} 个标签`);

  for (const [category, tags] of Object.entries(groups)) {
    if (tags.length > 0) {
      let text = `【${category}】\n\n`;
      tags.forEach((item, index) => {
        text += `${index + 1}. ${item.tag}`;
        if (item.desc) text += ` - ${item.desc}`;
        text += '\n';
      });
      messages.push(text);
    }
  }

  messages.push('使用方法：\n• 三角洲语音 [标签]\n• 三角洲语音 [中文名]\n\n示例：\n• 三角洲语音 渡鸦\n• 三角洲语音 boss-1\n• 三角洲语音 破壁');

  await makeForwardMsg(msg, messages);
  return true;
}

/** 获取语音分类 */
export async function getCategoryList (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  await reply(msg, '正在获取分类列表...');

  const res = await api.getAudioCategories();
  if (await checkApiError(res, msg)) return true;

  if (!res?.data?.categories) {
    await reply(msg, '获取分类列表失败');
    return true;
  }

  const categoryNameMap: Record<string, string> = {
    'Voice': '角色语音',
    'CutScene': '过场动画',
    'Amb': '环境音效',
    'Music': '背景音乐',
    'SFX': '音效',
    'Festivel': '节日活动',
  };

  let text = '【三角洲音频分类】\n\n';
  res.data.categories.forEach((cat: any) => {
    const categoryName = categoryNameMap[cat.category] || cat.category;
    text += `• ${categoryName} (${cat.category})\n`;
  });

  await reply(msg, text.trim());
  return true;
}

/** 获取音频统计 */
export async function getAudioStats (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  await reply(msg, '正在获取统计信息...');

  const res = await api.getAudioStats();
  if (await checkApiError(res, msg)) return true;

  if (!res?.data) {
    await reply(msg, '获取统计信息失败');
    return true;
  }

  const categoryNameMap: Record<string, string> = {
    'Voice': '角色语音',
    'CutScene': '过场动画',
    'Amb': '环境音效',
    'Music': '背景音乐',
    'SFX': '音效',
    'Festivel': '节日活动',
  };

  let text = '【三角洲音频统计】\n\n';
  text += `总文件数：${res.data.totalFiles}\n\n`;

  if (res.data.categories?.length > 0) {
    text += '分类统计：\n';
    res.data.categories.forEach((cat: any) => {
      const categoryName = categoryNameMap[cat.category] || cat.category;
      text += `• ${categoryName}: ${cat.fileCount} 个\n`;
    });
  }

  await reply(msg, text.trim());
  return true;
}

export default {
  commands,
  sendVoice,
  getCharacterList,
  getTagList,
  getCategoryList,
  getAudioStats,
};

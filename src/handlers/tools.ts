/**
 * 工具功能处理器
 * AI评价、干员查询、特勤处、健康状态等
 */

import type { OB11Message } from 'napcat-types';
import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import { reply, replyAt, replyImage, getUserId, makeForwardMsg, sendAudio } from '../utils/message';
import { handleApiError as _handleApiError } from '../utils/error-handler';
import { getAccount } from '../utils/account';
import type { CommandDef } from '../utils/command';
import { logger } from '../utils/logger';
import { render, generatePlaceInfoHtml } from '../services/render';
import type { PlaceInfoTemplateData } from '../services/render';

/** 备用 TTS 接口（仅 AI 锐评使用） */
const FALLBACK_TTS_URL = 'https://i.elaina.vin/api/tts/';
const FALLBACK_TTS_CHAR_ID = '2538';

/** 每人每天仅允许使用一次备用接口（持久化到文件） */
function getFallbackTtsUsagePath (): string {
  return require('node:path').join(pluginState.dataPath, 'tts-usage.json');
}

function loadTtsUsage (): Record<string, string> {
  try {
    const fs = require('node:fs');
    const p = getFallbackTtsUsagePath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* ignore */ }
  return {};
}

function saveTtsUsage (data: Record<string, string>): void {
  try {
    const fs = require('node:fs');
    fs.writeFileSync(getFallbackTtsUsagePath(), JSON.stringify(data), 'utf-8');
  } catch { /* ignore */ }
}

function checkAndMarkTtsUsage (userId: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const usage = loadTtsUsage();
  if (usage[userId] === today) return false; // 已用过
  usage[userId] = today;
  saveTtsUsage(usage);
  return true; // 可使用
}

/** 错误处理包装，返回 true 表示有错误已处理 */
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
  { keywords: ['ai锐评', 'ai评价', 'AI锐评', 'AI评价'], handler: 'aiComment', name: 'AI评价', hasArgs: true },
  { keywords: ['ai预设列表', 'AI预设列表'], handler: 'getAiPresets', name: 'AI预设列表' },
  { keywords: ['干员', '干员查询'], handler: 'getOperator', name: '干员查询', hasArgs: true },
  { keywords: ['干员列表'], handler: 'getOperatorList', name: '干员列表' },
  { keywords: ['特勤处状态', '特勤处'], handler: 'getPlaceStatus', name: '特勤处状态' },
  { keywords: ['特勤处信息'], handler: 'getPlaceInfo', name: '特勤处信息', hasArgs: true },
  { keywords: ['每日密码', '今日密码'], handler: 'getDailyKeyword', name: '每日密码' },
  { keywords: ['地图统计'], handler: 'getMapStats', name: '地图统计', hasArgs: true },
  { keywords: ['藏品', '物品仓库'], handler: 'getCollection', name: '藏品查询' },
  { keywords: ['违规记录', '封禁记录'], handler: 'getBanHistory', name: '违规记录' },
  { keywords: ['用户统计'], handler: 'getUserStats', name: '用户统计' },
  { keywords: ['健康状态'], handler: 'getHealthInfo', name: '健康状态' },
  { keywords: ['文章列表'], handler: 'getArticleList', name: '文章列表' },
  { keywords: ['文章详情', '文章'], handler: 'getArticleDetail', name: '文章详情', hasArgs: true },
  { keywords: ['开启调试', '调试开启', '开启debug', 'debug开启'], handler: 'enableDebug', name: '开启调试' },
  { keywords: ['关闭调试', '调试关闭', '关闭debug', 'debug关闭'], handler: 'disableDebug', name: '关闭调试' },
  { keywords: ['调试状态', 'debug状态'], handler: 'debugStatus', name: '调试状态' },
];

/** 解析模式参数 */
function parseMode (args: string): string {
  const lower = args.toLowerCase();
  if (['烽火', '烽火地带', 'sol', '摸金'].some(k => lower.includes(k))) return 'sol';
  if (['全面', '全面战场', '战场', 'mp'].some(k => lower.includes(k))) return 'mp';
  return '';
}

/** 解析 AI 流式响应 */
function parseAiStreamResponse (streamData: string): string {
  // AI API 返回的是 SSE 流式格式，每行以 "data: " 开头
  const lines = streamData.split('\n').filter(line => line.trim().startsWith('data:'));
  let fullAnswer = '';

  for (const line of lines) {
    const jsonStr = line.substring(5).trim(); // 去掉 "data:" 前缀
    if (!jsonStr) continue;

    try {
      const parsed = JSON.parse(jsonStr);
      // agent_message 事件包含 answer 字段
      if (parsed.answer) {
        fullAnswer = parsed.answer; // 最后一个完整的 answer
      }
      // agent_thought 事件也可能包含 thought 字段
      if (parsed.thought && !fullAnswer) {
        fullAnswer = parsed.thought;
      }
    } catch {
      // JSON 解析失败，跳过
    }
  }

  return fullAnswer;
}

/** AI 预设缓存 */
let aiPresetsCache: any[] | null = null;
let aiPresetsCacheTime = 0;
const AI_PRESETS_CACHE_TTL = 30 * 60 * 1000; // 30分钟

/** 获取 AI 预设列表（带缓存） */
async function getAiPresetsWithCache (): Promise<any[]> {
  const now = Date.now();
  if (aiPresetsCache && now - aiPresetsCacheTime < AI_PRESETS_CACHE_TTL) {
    return aiPresetsCache;
  }

  const api = createApi();
  const res = await api.getAiPresets();
  if (res && (res as any).data && Array.isArray((res as any).data)) {
    aiPresetsCache = (res as any).data;
    aiPresetsCacheTime = now;
    return aiPresetsCache;
  }
  return aiPresetsCache || [];
}

/** 查找 AI 预设（支持代码、中文名、部分匹配） */
async function findAiPreset (keyword: string): Promise<any | null> {
  if (!keyword) return null;

  const presets = await getAiPresetsWithCache();
  if (!presets || presets.length === 0) return null;

  const normalized = keyword.trim().toLowerCase();

  // 1. 精确匹配代码
  let preset = presets.find((p: any) => p.code?.toLowerCase() === normalized);
  if (preset) return preset;

  // 2. 精确匹配名称
  preset = presets.find((p: any) => p.name === keyword.trim());
  if (preset) return preset;

  // 3. 名称包含关键词
  preset = presets.find((p: any) => p.name?.includes(keyword.trim()));
  if (preset) return preset;

  // 4. 关键词包含名称
  preset = presets.find((p: any) => keyword.trim().includes(p.name));
  if (preset) return preset;

  return null;
}

/** 解析 AI 评价参数 */
function parseAiArgs (args: string): { mode: string; preset: string | null; } {
  const parts = args.trim().split(/\s+/);
  let mode = 'sol';
  let preset: string | null = null;

  for (const part of parts) {
    const lower = part.toLowerCase();
    // 检查模式
    if (['sol', '烽火', '烽火地带'].includes(lower)) {
      mode = 'sol';
    } else if (['mp', '全面', '全面战场'].includes(lower)) {
      mode = 'mp';
    } else if (part) {
      // 其他参数当作预设
      preset = part;
    }
  }

  return { mode, preset };
}

/** AI 评价 */
export async function aiComment (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  const { mode, preset: presetInput } = parseAiArgs(args);
  const modeName = mode === 'sol' ? '烽火地带' : '全面战场';

  // 解析预设
  let presetCode: string | undefined;
  let presetName = '锐评';

  if (presetInput) {
    const preset = await findAiPreset(presetInput);
    if (!preset) {
      const presets = await getAiPresetsWithCache();
      let hint = '';
      if (presets && presets.length > 0) {
        hint = '\n可用预设: ' + presets.map((p: any) => `${p.name}(${p.code})`).join(', ');
      }
      await reply(msg, `无效的预设: ${presetInput}${hint}\n\n使用 三角洲ai预设列表 查看可用预设`);
      return true;
    }
    presetCode = preset.code;
    presetName = preset.name;
  }

  await reply(msg, `正在使用【${presetName}】分析您的 ${modeName} 数据...`);

  const res = await api.getAiCommentary(token, mode, presetCode);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data) {
    await reply(msg, 'AI 评价获取失败');
    return true;
  }

  const rawData = (res as any).data;
  let comment = '';

  // 解析流式响应格式
  if (typeof rawData === 'string') {
    comment = parseAiStreamResponse(rawData);
  } else if (rawData?.answer) {
    comment = rawData.answer;
  } else if (rawData?.comment) {
    comment = rawData.comment;
  }

  if (!comment) {
    await reply(msg, 'AI 评价数据格式异常');
    return true;
  }

  // TTS 语音合成：内置接口 → 备用接口 → 纯文本
  const textMsg = `【${modeName} AI${presetName}】\n\n${comment}`;
  let ttsSuccess = false;

  // 1. 内置后端 TTS
  if (pluginState.config.tts?.enabled !== false) {
    try {
      const ttsRes = await api.ttsSynthesize({ text: comment.substring(0, 800) });
      if (ttsRes && (ttsRes as any).data?.url) {
        await makeForwardMsg(msg, [textMsg], { nickname: 'AI锐评' });
        await sendAudio(msg, (ttsRes as any).data.url);
        ttsSuccess = true;
      }
    } catch { /* 静默失败，走备用 */ }
  }

  // 2. 备用 TTS（每人每天一次，持久化计数，API 返回 302 → audio/xxx.mp3）
  if (!ttsSuccess && checkAndMarkTtsUsage(userId)) {
    try {
      const resp = await fetch(
        `${FALLBACK_TTS_URL}?text=${encodeURIComponent(comment.substring(0, 800))}&id=${FALLBACK_TTS_CHAR_ID}&iz=sjz`,
        { redirect: 'manual', signal: AbortSignal.timeout(30000) }
      );
      const location = resp.headers.get('location') || '';
      if (location) {
        const audioUrl = location.startsWith('http') ? location : `https://i.elaina.vin/api/tts/${location}`;
        const audio = await fetch(audioUrl, { signal: AbortSignal.timeout(30000) });
        if (audio.ok) {
          const base64 = Buffer.from(await audio.arrayBuffer()).toString('base64');
          await makeForwardMsg(msg, [textMsg], { nickname: 'AI锐评' });
          await sendAudio(msg, `base64://${base64}`);
          ttsSuccess = true;
        }
      }
    } catch { /* 静默失败 */ }
  }

  // 3. 都失败，仅发文本
  if (!ttsSuccess) {
    await makeForwardMsg(msg, [textMsg], { nickname: 'AI锐评' });
  }

  return true;
}

/** 干员查询 */
export async function getOperator (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const operatorName = args.trim();

  if (!operatorName) {
    await reply(msg, '请输入干员名称，如：三角洲干员 疾风');
    return true;
  }

  // 使用详细信息 API
  const res = await api.getOperatorDetails();
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data || !Array.isArray((res as any).data)) {
    await reply(msg, '获取干员数据失败');
    return true;
  }

  const operators = (res as any).data;

  // 根据名称过滤干员（支持干员名称和全名）
  const matchedOperators = operators.filter((op: any) => {
    const opName = op.operator || '';
    const fullName = op.fullName || '';
    return opName.includes(operatorName) || fullName.includes(operatorName) ||
      operatorName.includes(opName) || operatorName.includes(fullName);
  });

  if (matchedOperators.length === 0) {
    await reply(msg, `未找到干员「${operatorName}」的信息，请检查干员名称是否正确。`);
    return true;
  }

  // 优先完全匹配
  let operator = matchedOperators.find((op: any) =>
    op.operator === operatorName || op.fullName === operatorName
  ) || matchedOperators[0];

  // 如果匹配到多个，提示用户
  if (matchedOperators.length > 1) {
    const names = matchedOperators.map((op: any) => op.operator || op.fullName).join('、');
    await reply(msg, `找到多个匹配的干员：${names}，将显示第一个匹配结果。`);
  }

  // 构建合并转发消息
  const messages: string[] = [];

  // 基本信息
  let basicInfo = `【干员信息】${operator.operator || '未知干员'}\n`;
  if (operator.fullName) basicInfo += `全名: ${operator.fullName}\n`;
  if (operator.armyType) basicInfo += `兵种: ${operator.armyType}\n`;
  if (operator.armyTypeDesc) basicInfo += `兵种描述: ${operator.armyTypeDesc}\n`;

  // 添加图片（如果有）
  if (operator.pic) {
    basicInfo += `\n[CQ:image,file=${operator.pic}]`;
  }
  messages.push(basicInfo.trim());

  // 技能列表（每个技能单独一条消息）
  if (operator.abilitiesList && operator.abilitiesList.length > 0) {
    let skillsText = `【技能列表】共 ${operator.abilitiesList.length} 个技能`;
    messages.push(skillsText);

    operator.abilitiesList.forEach((ability: any, i: number) => {
      const abilityName = ability.abilityName || '未知技能';
      const abilityType = ability.abilityTypeCN || ability.abilityType || '';
      const abilityDesc = ability.abilityDesc || '';

      let skillText = `【技能 ${i + 1}】${abilityName}`;
      if (abilityType) skillText += `\n类型: ${abilityType}`;
      if (abilityDesc) skillText += `\n描述: ${abilityDesc}`;

      // 添加技能图片（如果有）
      if (ability.abilityIcon) {
        skillText += `\n[CQ:image,file=${ability.abilityIcon}]`;
      }
      messages.push(skillText);
    });
  }

  await makeForwardMsg(msg, messages, { nickname: '干员信息', userId: 66600000 });
  return true;
}

/** 干员列表 */
export async function getOperatorList (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const res = await api.getOperators();
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data || !Array.isArray((res as any).data)) {
    await reply(msg, '获取干员列表失败');
    return true;
  }

  const operators = (res as any).data;

  if (operators.length === 0) {
    await reply(msg, '暂无干员数据');
    return true;
  }

  // 根据 ID 前缀判断兵种
  const getArmyTypeById = (id: number) => {
    if (id >= 10000 && id < 20000) return '突击';
    if (id >= 20000 && id < 30000) return '支援';
    if (id >= 30000 && id < 40000) return '工程';
    if (id >= 40000 && id < 50000) return '侦察';
    return '未知';
  };

  // 按兵种分组
  const groupedByArmyType: Record<string, any[]> = {};
  operators.forEach((operator: any) => {
    const armyType = operator.armyType || getArmyTypeById(operator.id);
    if (!groupedByArmyType[armyType]) {
      groupedByArmyType[armyType] = [];
    }
    groupedByArmyType[armyType].push(operator);
  });

  // 兵种显示顺序
  const armyTypeOrder = ['突击', '工程', '支援', '侦察'];
  const sortedArmyTypes = Object.keys(groupedByArmyType).sort((a, b) => {
    const indexA = armyTypeOrder.indexOf(a);
    const indexB = armyTypeOrder.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  // 构建合并转发消息
  const messages: string[] = [];

  // 总览消息
  messages.push(`【干员列表】\n共 ${operators.length} 个干员`);

  // 每个兵种一条消息
  sortedArmyTypes.forEach((armyType) => {
    const typeOperators = groupedByArmyType[armyType];
    let text = `【${armyType}】(${typeOperators.length}人)\n`;
    typeOperators.forEach((operator: any) => {
      text += `• ${operator.name || operator.operator || operator.fullName || '未知'}\n`;
    });
    messages.push(text.trim());
  });

  await makeForwardMsg(msg, messages, { nickname: '干员列表', userId: 66600000 });
  return true;
}

/** 特勤处状态 */
export async function getPlaceStatus (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  const res = await api.getPlaceStatus(token);
  if (await checkApiError(res, msg)) return true;

  const data = (res as any)?.data;
  if (!data || !data.places || !data.stats) {
    await reply(msg, '获取特勤处状态失败');
    return true;
  }

  const { places, stats } = data;

  if (places.length === 0) {
    await reply(msg, '未能查询到任何特勤处设施信息');
    return true;
  }

  // 构建合并转发消息
  const messages: string[] = [];

  // 总体状态
  messages.push(`总设施: ${stats.total} | 生产中: ${stats.producing} | 闲置: ${stats.idle}`);

  // 每个设施的状态
  places.forEach((place: any) => {
    let msg = `--- ${place.placeName} (Lv.${place.level}) ---\n`;
    if (place.objectDetail) {
      msg += `状态: 生产中\n`;
      msg += `物品: ${place.objectDetail.objectName}\n`;
      const leftTime = place.leftTime;
      if (leftTime && !isNaN(leftTime)) {
        const h = Math.floor(leftTime / 3600);
        const m = Math.floor((leftTime % 3600) / 60);
        const s = leftTime % 60;
        msg += `剩余时间: ${h}小时${m}分钟${s}秒`;
      } else {
        msg += `剩余时间: N/A`;
      }
    } else {
      msg += `状态: ${place.status}`;
    }
    messages.push(msg.trim());
  });

  await makeForwardMsg(msg, messages);
  return true;
}

/** 特勤处信息 */
export async function getPlaceInfo (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  // 解析参数
  const placeMap: Record<string, string> = {
    '仓库': 'storage', '指挥中心': 'control', '工作台': 'workbench',
    '技术中心': 'tech', '靶场': 'shoot', '训练中心': 'training',
    '制药台': 'pharmacy', '防具台': 'armory', '收藏室': 'collect', '潜水中心': 'diving',
  };
  const typeNameMap: Record<string, string> = {
    'storage': '仓库', 'control': '指挥中心', 'workbench': '工作台',
    'tech': '技术中心', 'shoot': '靶场', 'training': '训练中心',
    'pharmacy': '制药台', 'armory': '防具台', 'collect': '收藏室', 'diving': '潜水中心',
  };
  const typeImageMap: Record<string, string> = {
    'storage': 'imgs/place/仓库.png', 'control': 'imgs/place/指挥中心.png',
    'workbench': 'imgs/place/工作台.png', 'tech': 'imgs/place/技术中心.png',
    'shoot': 'imgs/place/靶场.png', 'training': 'imgs/place/训练中心.png',
    'pharmacy': 'imgs/place/制药台.png', 'armory': 'imgs/place/防具台.png',
    'collect': 'imgs/place/收藏室.png', 'diving': 'imgs/place/潜水中心.png',
  };

  const argParts = args.trim().split(/\s+/);
  const firstArg = argParts[0] || '';
  const secondArg = argParts[1] ? parseInt(argParts[1]) : null;

  if (!firstArg) {
    await reply(msg, [
      '请使用以下命令格式：\n',
      '• 三角洲特勤处信息 all - 查询所有设施\n',
      '• 三角洲特勤处信息 仓库 - 查询仓库所有等级\n',
      '• 三角洲特勤处信息 仓库 1 - 查询仓库等级1\n',
      '\n支持的设施类型：\n',
      '仓库、指挥中心、工作台、技术中心、靶场、训练中心、制药台、防具台、收藏室、潜水中心',
    ].join(''));
    return true;
  }

  const isAll = firstArg.toLowerCase() === 'all';
  const placeType = isAll ? '' : (placeMap[firstArg] || '');
  const targetLevel = secondArg !== null && !isNaN(secondArg) ? secondArg : null;

  await reply(msg, '正在查询特勤处信息，请稍候...');

  const res = await api.getPlaceInfo(token, placeType);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data || !(res as any).data.places) {
    await reply(msg, '获取特勤处信息失败');
    return true;
  }

  const { places, relateMap = {} } = (res as any).data;
  if (places.length === 0) {
    await reply(msg, '未查询到特勤处设施信息');
    return true;
  }

  // 处理场所数据（与 Yunzai 插件 processPlaces 逻辑一致）
  function processPlaces (rawPlaces: any[]): PlaceInfoTemplateData['places'] {
    const result: PlaceInfoTemplateData['places'] = [];
    for (const place of rawPlaces) {
      const placeTypeValue = place.placeType || '';
      let displayName = place.placeName || '';
      if (!/[\u4e00-\u9fa5]/.test(displayName)) {
        displayName = typeNameMap[placeTypeValue] || displayName || '未知设施';
      }

      const processed: PlaceInfoTemplateData['places'][0] = {
        displayName,
        level: place.level || 0,
        imageUrl: typeImageMap[placeTypeValue] || null,
        detail: place.detail || '',
        upgradeInfo: null,
        upgradeRequired: [],
        unlockInfo: null,
      };

      // 升级信息
      if (place.upgradeInfo) {
        const conditionText = place.upgradeInfo.condition || '无';
        const conditions: string[] = [];
        let levelCondition: string | null = null;
        if (conditionText && conditionText !== '无' && conditionText !== '默认解锁') {
          const allConds = conditionText.split(/[;；]/).map((c: string) => c.trim()).filter((c: string) => c.length > 0);
          allConds.forEach((c: string) => {
            if (/解锁等级|等级\d+/.test(c)) levelCondition = c;
            else conditions.push(c);
          });
        }
        processed.upgradeInfo = {
          condition: conditionText,
          conditions,
          levelCondition,
          hafCount: place.upgradeInfo.hafCount || 0,
          hafCountFormatted: (place.upgradeInfo.hafCount || 0) > 0 ? (place.upgradeInfo.hafCount).toLocaleString() : '0',
        };
      }

      // 升级所需物品
      if (place.upgradeRequired && place.upgradeRequired.length > 0) {
        processed.upgradeRequired = place.upgradeRequired.map((req: any) => {
          const itemInfo = relateMap[String(req.objectID)];
          return {
            objectName: itemInfo?.objectName || `物品ID: ${req.objectID}`,
            count: req.count,
            imageUrl: itemInfo?.pic || (req.objectID ? `https://playerhub.df.qq.com/playerhub/60004/object/${req.objectID}.png` : null),
          };
        });
      }

      // 解锁信息
      if (place.unlockInfo) {
        const unlockData: NonNullable<typeof processed.unlockInfo> = { properties: [], props: [] };
        const properties = place.unlockInfo.properties?.list || [];
        if (properties.length > 0) {
          unlockData.properties = properties.map((prop: any) => {
            if (typeof prop === 'string') return prop;
            if (prop && typeof prop === 'object') return prop.name || prop.objectName || prop.desc || JSON.stringify(prop);
            return String(prop);
          });
        }
        const props = place.unlockInfo.props || [];
        if (props.length > 0) {
          unlockData.props = props.map((prop: any) => {
            if (typeof prop === 'string') return { objectName: prop, imageUrl: null, count: null };
            let objectName = '未知道具';
            let imageUrl: string | null = null;
            if (prop.objectID) {
              const itemInfo = relateMap[String(prop.objectID)];
              objectName = itemInfo?.objectName || `物品ID: ${prop.objectID}`;
              imageUrl = itemInfo?.pic || `https://playerhub.df.qq.com/playerhub/60004/object/${prop.objectID}.png`;
            } else if (prop.name || prop.objectName) {
              objectName = prop.name || prop.objectName;
            }
            return { objectName, imageUrl, count: prop.count || null };
          });
        }
        if (unlockData.properties.length > 0 || unlockData.props.length > 0) {
          processed.unlockInfo = unlockData;
        }
      }

      result.push(processed);
    }
    return result;
  }

  // 按场所类型分组
  const groupedByType: Record<string, any[]> = {};
  places.forEach((p: any) => {
    const t = p.placeType || 'unknown';
    if (!groupedByType[t]) groupedByType[t] = [];
    groupedByType[t].push(p);
  });

  const typeOrder = ['storage', 'control', 'workbench', 'tech', 'shoot', 'training', 'pharmacy', 'armory', 'collect', 'diving'];
  const sortedTypes = placeType ? [placeType] : Object.keys(groupedByType).sort((a, b) => {
    const ia = typeOrder.indexOf(a), ib = typeOrder.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  // 遍历每个类型，按等级分组，每个等级渲染一张图片，合并转发
  for (const type of sortedTypes) {
    const typePlaces = groupedByType[type];
    if (!typePlaces || typePlaces.length === 0) continue;

    const processed = processPlaces(typePlaces);
    const placeTypeName = typeNameMap[type] || type;

    // 按等级分组
    const groupedByLevel: Record<number, typeof processed> = {};
    processed.forEach(p => {
      if (!groupedByLevel[p.level]) groupedByLevel[p.level] = [];
      groupedByLevel[p.level].push(p);
    });

    const sortedLevels = Object.keys(groupedByLevel).map(Number).sort((a, b) => a - b);

    // 如果指定了等级，只返回该等级
    if (targetLevel !== null) {
      let levelPlaces = groupedByLevel[targetLevel];
      let actualLevel = targetLevel;
      let needNotify = false;
      if (!levelPlaces || levelPlaces.length === 0) {
        if (sortedLevels.length === 0) {
          await reply(msg, `未找到 ${placeTypeName} 的设施信息`);
          return true;
        }
        actualLevel = Math.max(...sortedLevels);
        levelPlaces = groupedByLevel[actualLevel];
        needNotify = true;
      }
      const html = generatePlaceInfoHtml({ placeTypeName, places: [levelPlaces[0]] });
      const result = await render({ template: html, selector: '.container', width: 1700, fullPage: true, waitForTimeout: 500 });
      if (needNotify) await reply(msg, `未找到 ${placeTypeName} 等级 ${targetLevel}，已返回最高等级 ${actualLevel}`);
      if (result.success && result.data) {
        await replyImage(msg, result.data);
      } else {
        await reply(msg, `渲染 ${placeTypeName} 等级 ${actualLevel} 图片失败`);
      }
      return true;
    }

    // 没有指定等级，每个等级一张图片，合并转发
    const forwardMsgs: string[] = [];
    forwardMsgs.push(`【${placeTypeName}】\n共 ${processed.length} 个设施，${sortedLevels.length} 个等级`);

    for (const level of sortedLevels) {
      const levelPlaces = groupedByLevel[level];
      if (!levelPlaces || levelPlaces.length === 0) continue;
      const html = generatePlaceInfoHtml({ placeTypeName, places: [levelPlaces[0]] });
      try {
        const result = await render({ template: html, selector: '.container', width: 1700, fullPage: true, waitForTimeout: 500 });
        if (result.success && result.data) {
          forwardMsgs.push(`【${placeTypeName} - Lv.${level}】\n[CQ:image,file=base64://${result.data}]`);
        } else {
          forwardMsgs.push(`【${placeTypeName} - Lv.${level}】渲染失败`);
        }
      } catch (error) {
        logger.error(`[特勤处信息] 渲染 ${placeTypeName} Lv.${level} 失败:`, error);
        forwardMsgs.push(`【${placeTypeName} - Lv.${level}】渲染失败`);
      }
    }

    if (forwardMsgs.length > 1) {
      await makeForwardMsg(msg, forwardMsgs, { nickname: '特勤处信息' });
    }
  }

  return true;
}

/** 每日密码 */
export async function getDailyKeyword (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const res = await api.getDailyKeyword();
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data?.list?.length) {
    await reply(msg, `获取每日密码失败: ${(res as any)?.msg || (res as any)?.message || '暂无数据'}`);
    return true;
  }

  let text = '【每日密码】\n';
  const list = (res as any).data.list;
  list.forEach((item: any) => {
    text += `【${item.mapName}】: ${item.secret}\n`;
  });

  await reply(msg, text.trim());
  return true;
}

/** 地图统计 */
export async function getMapStats (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  const mode = parseMode(args) || 'sol';
  const modeName = mode === 'sol' ? '烽火地带' : '全面战场';

  await reply(msg, `正在查询 ${modeName} 地图统计...`);

  const res = await api.getMapStats(token, '7', mode);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data) {
    await reply(msg, '获取地图统计失败');
    return true;
  }

  const maps = (res as any).data;
  let text = `【地图统计 - ${modeName}】\n`;

  if (Array.isArray(maps) && maps.length > 0) {
    maps.slice(0, 10).forEach((m: any, i: number) => {
      const name = m.mapName || m.mapname || '未知';
      const rounds = m.total_round || m.totalRound || 0;
      const kills = m.kill_human || m.killHuman || 0;
      text += `${i + 1}. ${name}: ${rounds}局 ${kills}杀\n`;
    });
  } else {
    text += '暂无地图统计数据';
  }

  await reply(msg, text.trim());
  return true;
}

/** 藏品查询 */
export async function getCollection (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  await reply(msg, '正在查询藏品...');

  // 并行获取藏品数据和对照表
  const [collectionRes, collectionMapRes] = await Promise.all([
    api.getCollection(token),
    api.getCollectionMap(),
  ]);

  if (await checkApiError(collectionRes, msg)) return true;

  if (!collectionRes || !(collectionRes as any).data) {
    await reply(msg, '获取藏品数据失败');
    return true;
  }

  // 解析数据结构
  const collectionData = (collectionRes as any).data;
  const userItems = collectionData?.userData || [];
  const weaponItems = collectionData?.weponData || [];
  const allUserItems = [...userItems, ...weaponItems];

  if (allUserItems.length === 0) {
    await reply(msg, '【藏品仓库】\n您的藏品库为空');
    return true;
  }

  // 构建对照表映射 - 支持多种数据结构
  const collectionMap = new Map<string, any>();

  // 检查对照表接口响应
  if (!collectionMapRes) {
    pluginState.log('warn', '藏品对照表接口无响应');
  } else if ((collectionMapRes as any).success === false) {
    pluginState.log('warn', `藏品对照表接口返回失败: ${(collectionMapRes as any).message || '未知错误'}`);
  } else if ((collectionMapRes as any).data) {
    let mapData = (collectionMapRes as any).data;
    pluginState.logDebug(`藏品对照表原始数据类型: ${typeof mapData}, 是否数组: ${Array.isArray(mapData)}`);

    // 如果是 { collections: [...] } 结构
    if (mapData.collections && Array.isArray(mapData.collections)) {
      mapData = mapData.collections;
    }
    // 直接是数组
    if (Array.isArray(mapData)) {
      mapData.forEach((item: any) => {
        collectionMap.set(String(item.id), item);
      });
      pluginState.logDebug(`藏品对照表加载成功: ${mapData.length} 条`);
    } else {
      pluginState.log('warn', `藏品对照表数据格式不正确，期望数组，实际: ${JSON.stringify(mapData).slice(0, 200)}`);
    }
  } else {
    pluginState.log('warn', '藏品对照表接口响应中无 data 字段');
  }

  // 如果对照表为空，尝试使用 searchObject API 获取物品信息
  if (collectionMap.size === 0) {
    pluginState.log('warn', '藏品对照表为空，尝试使用物品搜索 API');
    const objectIds = allUserItems.map((item: any) => String(item.ItemId)).join(',');
    pluginState.logDebug(`搜索物品 IDs: ${objectIds.slice(0, 200)}...`);
    try {
      const searchRes = await api.searchObject('', objectIds);
      if (searchRes && (searchRes as any).data?.keywords) {
        (searchRes as any).data.keywords.forEach((item: any) => {
          if (item.objectID || item.id) {
            const itemId = item.objectID || item.id;
            collectionMap.set(String(itemId), {
              id: itemId,
              name: item.objectName || item.name || `物品`,
              type: item.secondClassCN || item.secondClass || item.primaryClass || item.type || '其他资产',
              rare: item.grade || item.rare,
            });
          }
        });
        pluginState.logDebug(`通过搜索 API 获取物品信息: ${collectionMap.size} 条`);
      } else {
        pluginState.log('warn', `物品搜索 API 无结果或格式不正确`);
      }
    } catch (error) {
      pluginState.log('warn', `搜索物品信息失败: ${error}`);
    }
  }

  // 品质配置 - 支持中文和颜色两种格式
  const qualityConfig: Record<string, { level: number; name: string; }> = {
    '橙': { level: 5, name: '传说' },
    '紫': { level: 4, name: '史诗' },
    '蓝': { level: 3, name: '稀有' },
    '绿': { level: 2, name: '普通' },
    'legendary': { level: 5, name: '传说' },
    'epic': { level: 4, name: '史诗' },
    'rare': { level: 3, name: '稀有' },
    'common': { level: 2, name: '普通' },
    '6': { level: 5, name: '传说' },
    '5': { level: 4, name: '史诗' },
    '4': { level: 3, name: '稀有' },
    '3': { level: 2, name: '普通' },
  };

  // 按类型分组
  const categorizedItems: Record<string, any[]> = {};
  let totalCount = 0;

  allUserItems.forEach((item: any) => {
    const itemId = String(item.ItemId);
    const itemInfo = collectionMap.get(itemId);
    const category = itemInfo?.type || '其他资产';
    const name = itemInfo?.name || `物品(${itemId})`;
    const rareKey = String(itemInfo?.rare || '');
    const quality = qualityConfig[rareKey]?.name || '普通';

    if (!categorizedItems[category]) {
      categorizedItems[category] = [];
    }
    categorizedItems[category].push({ name, id: itemId, quality });
    totalCount++;
  });

  // 构建消息 - 将"其他资产"放到最后
  const forwardMsgs: string[] = [];
  forwardMsgs.push(`【藏品仓库】\n共 ${totalCount} 件物品`);

  // 排序：其他资产放最后
  const sortedCategories = Object.entries(categorizedItems).sort(([a], [b]) => {
    if (a === '其他资产') return 1;
    if (b === '其他资产') return -1;
    return 0;
  });

  for (const [category, items] of sortedCategories) {
    let categoryText = `【${category}】 ${items.length}件\n`;
    items.slice(0, 15).forEach((item: any) => {
      categoryText += `• ${item.name}`;
      if (item.quality && item.quality !== '普通') {
        categoryText += ` [${item.quality}]`;
      }
      categoryText += '\n';
    });
    if (items.length > 15) {
      categoryText += `... 还有 ${items.length - 15} 件`;
    }
    forwardMsgs.push(categoryText.trim());
  }

  // 使用合并消息发送
  const result = await makeForwardMsg(msg, forwardMsgs, { nickname: '藏品仓库' });
  if (!result) {
    // 降级为普通消息
    await reply(msg, forwardMsgs.slice(0, 3).join('\n\n'));
  }

  return true;
}

/** 违规记录 */
export async function getBanHistory (msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await replyAt(msg, '您尚未绑定账号，请使用 三角洲登录 进行绑定');
    return true;
  }

  // 通过个人信息获取违规记录
  const res = await api.getPersonalInfo(token);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data) {
    await reply(msg, '获取数据失败');
    return true;
  }

  const data = (res as any).data;
  const banInfo = data.banInfo || data.ban_info;

  if (!banInfo || (Array.isArray(banInfo) && banInfo.length === 0)) {
    await reply(msg, '恭喜！您没有违规记录');
    return true;
  }

  let text = '【违规记录】\n';
  if (Array.isArray(banInfo)) {
    banInfo.forEach((b: any, i: number) => {
      text += `${i + 1}. ${b.reason || '未知原因'}\n`;
      if (b.date) text += `   日期: ${b.date}\n`;
    });
  } else {
    text += JSON.stringify(banInfo, null, 2);
  }

  await reply(msg, text.trim());
  return true;
}

/** 用户统计 (主人功能) */
export async function getUserStats (msg: OB11Message): Promise<boolean> {
  const userId = getUserId(msg);
  const masterQQ = pluginState.getConfig().master_qq;

  // 权限检查
  if (!masterQQ || String(userId) !== String(masterQQ)) {
    await reply(msg, '抱歉，只有机器人主人才能使用此功能');
    return true;
  }

  const clientID = pluginState.getConfig().clientID;
  if (!clientID) {
    await reply(msg, 'clientID 未配置，请在配置中设置');
    return true;
  }

  await reply(msg, '正在获取用户统计信息...');

  const api = createApi();
  const res = await api.getUserStats(clientID);
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data) {
    await reply(msg, '获取统计信息失败：API返回数据为空');
    return true;
  }

  const { accessLevel, data } = res as any;

  if (accessLevel === 'admin') {
    await displayAdminStats(msg, data);
  } else {
    await displayUserStats(msg, data);
  }

  return true;
}

/** 显示管理员统计 */
async function displayAdminStats (msg: OB11Message, data: any): Promise<void> {
  const { users, api, subscription, loginMethods, platform, security } = data;

  let text = '【三角洲行动 - 全站用户统计】\n';
  text += '权限级别：超级管理员\n\n';

  text += '📊 用户统计\n';
  text += `总用户数: ${users?.total || 0}\n`;
  text += `邮箱已验证: ${users?.emailVerified || 0}\n`;
  text += `邮箱未验证: ${users?.emailUnverified || 0}\n\n`;

  text += '🔑 API密钥统计\n';
  text += `总密钥数: ${api?.totalKeys || 0}\n`;
  text += `活跃密钥: ${api?.activeKeys || 0}\n`;
  text += `非活跃密钥: ${api?.inactiveKeys || 0}\n\n`;

  text += '💎 订阅统计\n';
  text += `专业用户: ${subscription?.proUsers || 0}\n`;
  text += `免费用户: ${subscription?.freeUsers || 0}\n`;
  text += `总订阅数: ${subscription?.totalSubscriptions || 0}\n\n`;

  if (loginMethods) {
    text += '🔐 登录方式统计\n';
    const methodNames: Record<string, string> = {
      'qq': 'QQ登录',
      'wechat': '微信登录',
      'wegame': 'WeGame登录',
      'wegameWechat': 'WeGame微信登录',
      'qqsafe': 'QQ安全中心',
      'qqCk': 'QQ Cookie登录',
    };
    for (const [method, stats] of Object.entries(loginMethods) as [string, any][]) {
      const name = methodNames[method] || method;
      text += `${name}: ${stats.total} (有效: ${stats.valid}, 无效: ${stats.invalid})\n`;
    }
    text += '\n';
  }

  text += '🔗 平台绑定统计\n';
  text += `总绑定数: ${platform?.totalBindings || 0}\n`;
  text += `已绑定用户: ${platform?.boundUsers || 0}\n`;
  text += `未绑定用户: ${platform?.unboundUsers || 0}\n`;

  if (security) {
    text += '\n🛡️ 安全统计\n';
    text += `24小时内密码重置: ${security.passwordResets24h || 0}\n`;
    text += `7天内密码重置: ${security.passwordResets7d || 0}\n`;
  }

  await reply(msg, text.trim());
}

/** 显示普通用户统计 */
async function displayUserStats (msg: OB11Message, data: any): Promise<void> {
  const { userInfo, loginMethods, api } = data;

  let text = '【三角洲行动 - 个人统计信息】\n';
  text += '权限级别：普通用户\n\n';

  text += '📊 账号统计\n';
  text += `总账号数: ${userInfo?.totalAccounts || 0}\n`;
  text += `已绑定账号: ${userInfo?.boundAccounts || 0}\n`;
  text += `未绑定账号: ${userInfo?.unboundAccounts || 0}\n\n`;

  if (loginMethods) {
    text += '🔐 登录方式统计\n';
    const methodNames: Record<string, string> = {
      'qq': 'QQ登录',
      'wechat': '微信登录',
      'wegame': 'WeGame登录',
    };
    for (const [method, stats] of Object.entries(loginMethods) as [string, any][]) {
      const name = methodNames[method] || method;
      text += `${name}: ${stats.total} (有效: ${stats.valid}, 无效: ${stats.invalid})\n`;
    }
    text += '\n';
  }

  text += '🔑 API密钥统计\n';
  text += `总密钥数: ${api?.totalKeys || 0}\n`;
  text += `活跃密钥: ${api?.activeKeys || 0}\n`;
  text += `非活跃密钥: ${api?.inactiveKeys || 0}`;

  await reply(msg, text.trim());
}

/** AI 预设列表 */
export async function getAiPresets (msg: OB11Message): Promise<boolean> {
  await reply(msg, '正在获取 AI 预设列表...');

  const presets = await getAiPresetsWithCache();

  if (!presets || presets.length === 0) {
    await reply(msg, '暂无可用的 AI 预设');
    return true;
  }

  let text = '【AI 预设列表】\n';
  presets.forEach((p: any, i: number) => {
    const defaultMark = p.isDefault ? ' (默认)' : '';
    text += `${i + 1}. ${p.name} - 代码: ${p.code}${defaultMark}\n`;
  });

  text += '\n使用示例:\n';
  text += '• 三角洲ai锐评 - 使用默认预设\n';
  text += '• 三角洲ai评价 烽火 雌小鬼\n';
  text += '• 三角洲ai评价 全面 cxg';

  await reply(msg, text.trim());
  return true;
}

/** 健康状态信息 */
export async function getHealthInfo (msg: OB11Message): Promise<boolean> {
  const api = createApi();

  await reply(msg, '正在查询健康状态信息...');

  const res = await api.getHealthStatus();
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).data || !(res as any).data[0]) {
    await reply(msg, '查询健康状态失败: API 返回数据格式不正确');
    return true;
  }

  const healthData = (res as any).data[0];

  if (!healthData.healthyDetail) {
    await reply(msg, '未能查询到健康状态详细信息');
    return true;
  }

  const { deBuffList, buffList } = healthData.healthyDetail;
  const forwardMsgs: string[] = [];

  // 负面状态
  let deBuffText = '【负面状态】\n';
  if (deBuffList && deBuffList.length > 0) {
    deBuffList.forEach((areaGroup: any) => {
      const area = areaGroup.area || '未知部位';
      const statuses = areaGroup.list || [];
      if (statuses.length > 0) {
        deBuffText += `\n━━ ${area} ━━\n`;
        statuses.forEach((s: any) => {
          // 使用 title 或 status 字段作为状态名称
          const statusName = s.title || s.status || s.name || '未知状态';
          deBuffText += `• ${statusName}\n`;
          if (s.trigger) deBuffText += `  触发: ${s.trigger}\n`;
          if (s.effect) deBuffText += `  效果: ${s.effect}\n`;
        });
      }
    });
  } else {
    deBuffText += '\n无负面状态 ✓';
  }
  forwardMsgs.push(deBuffText.trim());

  // 正面状态 - buffList 结构是 [{list: [buff, buff...]}, ...]
  let buffText = '【正面状态】\n';
  if (buffList && buffList.length > 0) {
    buffList.forEach((buffGroup: any) => {
      // buffGroup 可能直接是 buff 对象，也可能有 list 数组
      const buffs = buffGroup.list || [buffGroup];
      buffs.forEach((buff: any) => {
        const buffName = buff.title || buff.status || buff.name || '未知';
        buffText += `\n• ${buffName}`;
        if (buff.effect) buffText += `\n  效果: ${buff.effect}`;
      });
    });
  } else {
    buffText += '\n无正面状态';
  }
  forwardMsgs.push(buffText.trim());

  // 使用合并消息发送
  const result = await makeForwardMsg(msg, forwardMsgs, { nickname: '角色健康状态' });
  if (!result) {
    // 降级为普通消息
    await reply(msg, forwardMsgs.join('\n\n'));
  }

  return true;
}

/** 文章列表 */
export async function getArticleList (msg: OB11Message): Promise<boolean> {
  const api = createApi();

  await reply(msg, '正在获取最新文章列表...');

  const res = await api.getArticleList();
  if (await checkApiError(res, msg)) return true;

  if (!res || !(res as any).success || !(res as any).data?.articles?.list) {
    await reply(msg, `获取文章列表失败: ${(res as any)?.message || '未知错误'}`);
    return true;
  }

  const listCategories = (res as any).data.articles.list;

  // 合并所有分类的文章
  let allArticles: any[] = [];
  for (const category in listCategories) {
    if (Array.isArray(listCategories[category])) {
      allArticles = allArticles.concat(listCategories[category]);
    }
  }

  // 按时间降序排序
  allArticles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // 限制显示数量
  const articlesToShow = allArticles.slice(0, 15);

  if (articlesToShow.length === 0) {
    await reply(msg, '暂无文章数据');
    return true;
  }

  let text = '【三角洲行动 - 最新文章】\n\n';

  articlesToShow.forEach((article: any, index: number) => {
    text += `${index + 1}. 【${article.title}】\n`;
    text += `   作者: ${article.author} | ID: ${article.threadID}\n`;
    text += `   浏览: ${article.viewCount} | 点赞: ${article.likedCount}\n`;
  });

  text += '\n使用 三角洲文章详情 <ID> 查看具体内容';

  await reply(msg, text.trim());
  return true;
}

/** 文章详情 */
export async function getArticleDetail (msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const threadId = args.trim();

  if (!threadId) {
    await reply(msg, '请提供文章 ID，格式：三角洲文章详情 <ID>');
    return true;
  }

  await reply(msg, `正在获取文章详情 (ID: ${threadId})...`);

  const res = await api.getArticleDetail(threadId);
  if (await checkApiError(res, msg)) return true;

  const article = (res as any)?.data?.article;

  if (!article) {
    await reply(msg, `获取文章详情失败: ${(res as any)?.message || '文章不存在或已删除'}`);
    return true;
  }

  let text = `【${article.title}】\n`;
  text += `作者: ${article.author?.nickname || '未知作者'}\n`;
  text += `发布时间: ${article.createdAt}\n`;
  text += `浏览: ${article.viewCount} | 点赞: ${article.likedCount}\n`;
  text += `ID: ${article.id}\n`;

  // 标签信息
  if (article.ext?.gicpTags?.length > 0) {
    text += `标签: ${article.ext.gicpTags.join(', ')}\n`;
  }

  text += '\n';

  // 文章内容
  if (article.content?.text) {
    // 处理 HTML 内容，提取纯文本
    let textContent = article.content.text
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim();

    // 限制长度
    if (textContent.length > 500) {
      textContent = textContent.substring(0, 500) + '...';
    }

    text += textContent;
  } else if (article.summary) {
    text += article.summary;
  } else {
    text += '（暂无内容）';
  }

  await reply(msg, text.trim());
  return true;
}

/** 开启调试模式 */
export async function enableDebug (msg: OB11Message): Promise<boolean> {
  pluginState.debugMode = true;
  pluginState.config.debug = true;

  // 保存配置
  const ctx = pluginState.getContext();
  if (ctx) {
    pluginState.saveConfig(ctx, { debug: true });
  }

  logger.debug('========================================');
  logger.debug('[调试模式] 已开启 - debugMode =', pluginState.debugMode);
  logger.debug('后续 API 请求将在此处显示原始响应');
  logger.debug('========================================');

  await reply(msg, '【调试模式】已开启\n\nAPI 请求将输出原始响应到控制台日志');
  return true;
}

/** 关闭调试模式 */
export async function disableDebug (msg: OB11Message): Promise<boolean> {
  pluginState.debugMode = false;
  pluginState.config.debug = false;

  // 保存配置
  const ctx = pluginState.getContext();
  if (ctx) {
    pluginState.saveConfig(ctx, { debug: false });
  }

  await reply(msg, '【调试模式】已关闭');
  logger.debug('[调试模式] 已关闭');
  return true;
}

/** 查看调试状态 */
export async function debugStatus (msg: OB11Message): Promise<boolean> {
  const status = pluginState.debugMode ? '开启' : '关闭';
  await reply(msg, `【调试模式】当前状态: ${status}\n\n开启调试模式后，所有 API 请求的原始响应将输出到控制台日志`);
  return true;
}

export default {
  commands,
  aiComment,
  getAiPresets,
  getOperator,
  getOperatorList,
  getPlaceStatus,
  getPlaceInfo,
  getDailyKeyword,
  getMapStats,
  getCollection,
  getBanHistory,
  getUserStats,
  getHealthInfo,
  getArticleList,
  getArticleDetail,
  enableDebug,
  disableDebug,
  debugStatus,
};

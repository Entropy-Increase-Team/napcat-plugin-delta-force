/**
 * NapCat 三角洲行动插件
 * 
 * @author @Dnyo666 (原作者), 冷曦 (迁移)
 * @license AGPL-3.0
 */

// @ts-ignore
import type { NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin-manger';
// @ts-ignore
import type { OB11Message } from '@/napcat-onebot/index';

import fs from 'node:fs';
import path from 'node:path';
import { pluginState } from './core/state';
import { dataManager } from './services/data-manager';
import { checkPuppeteerStatus } from './services/render';
import { initConfigUI } from './config';
import { hasPrefix, stripPrefix, getPrefixes } from './utils/command';

// 处理器
import * as loginHandler from './handlers/login';
import * as accountHandler from './handlers/account';
import * as infoHandler from './handlers/info';
import * as dataHandler from './handlers/data';
import * as helpHandler from './handlers/help';
import * as recordHandler from './handlers/record';
import * as toolsHandler from './handlers/tools';
import * as entertainmentHandler from './handlers/entertainment';
import * as objectHandler from './handlers/object';
import * as flowsHandler from './handlers/flows';
import * as priceHandler from './handlers/price';
import * as healthHandler from './handlers/health';
import * as redHandler from './handlers/red';
import * as pushHandler from './handlers/push';
import * as websocketHandler from './handlers/websocket';
import * as voiceHandler from './handlers/voice';
import * as solutionHandler from './handlers/solution';
import * as musicHandler from './handlers/music';
import * as subscriptionHandler from './handlers/subscription';

// 服务
import { getScheduler } from './services/scheduler';
import { getWebSocketManager } from './services/websocket';

/** 框架配置 UI Schema */
export let plugin_config_ui: PluginConfigSchema = [];

/** 所有命令定义 */
const allCommands = [
  ...loginHandler.commands,
  ...accountHandler.commands,
  ...infoHandler.commands,
  ...dataHandler.commands,
  ...helpHandler.commands,
  ...recordHandler.commands,
  ...toolsHandler.commands,
  ...entertainmentHandler.commands,
  ...objectHandler.commands,
  ...flowsHandler.commands,
  ...priceHandler.commands,
  ...healthHandler.commands,
  ...redHandler.commands,
  ...pushHandler.commands,
  ...websocketHandler.commands,
  ...voiceHandler.commands,
  ...solutionHandler.commands,
  ...musicHandler.commands,
  ...subscriptionHandler.commands,
];

/**
 * 插件初始化
 */
export const plugin_init = async (ctx: NapCatPluginContext): Promise<void> => {
  try {
    pluginState.initFromContext(ctx);
    pluginState.loadConfig(ctx);
    pluginState.log('info', `插件启动中 | name=${ctx.pluginName}`);

    try {
      plugin_config_ui = initConfigUI(ctx);
    } catch (e) {
      pluginState.logDebug('配置 UI 初始化失败:', e);
    }

    registerRoutes(ctx);

    pluginState.log('info', '插件已启用');
    pluginState.log('info', '欢迎加入插件反馈群 1085402468 或 API交流群 932459332');

    setTimeout(() => initServicesAsync(), 1000);
  } catch (error) {
    pluginState.log('error', '插件启动失败:', error);
  }
};

/**
 * 异步初始化服务
 */
async function initServicesAsync (): Promise<void> {
  try {
    await dataManager.init();
    pluginState.log('info', '数据缓存初始化完成');

    // 加载订阅配置
    const { loadSubscriptionConfig } = await import('./services/subscription');
    loadSubscriptionConfig();

    // 初始化广播通知监听器
    websocketHandler.initBroadcastNotificationListener();

    // 初始化战绩推送监听器
    subscriptionHandler.initRecordPushListener();
  } catch (e) {
    pluginState.log('warn', '数据缓存初始化失败:', e);
  }

  try {
    const puppeteerStatus = await checkPuppeteerStatus();
    if (puppeteerStatus.connected) {
      pluginState.log('info', 'Puppeteer 渲染服务已连接');
    } else {
      pluginState.log('warn', `Puppeteer 渲染服务未连接: ${puppeteerStatus.message}`);
    }
  } catch (e) {
    pluginState.log('warn', 'Puppeteer 状态检查失败:', e);
  }

  // 初始化推送任务
  try {
    pushHandler.initPushTasks();
    const scheduler = getScheduler();
    scheduler.start();
    pluginState.log('info', '定时任务调度器已启动');
  } catch (e) {
    pluginState.log('warn', '定时任务初始化失败:', e);
  }
}

/**
 * 获取默认帮助列表数据（完整版）
 */
function getDefaultHelpListData () {
  const prefix = getPrefixes()[0] || '三角洲';
  return {
    fullWidth: [
      { order: 1, group: `所有命令统一使用 ${prefix} 前缀，例如 ${prefix}帮助`, list: [] }
    ],
    left: [
      {
        order: 1, group: '账号相关',
        list: [
          { icon: 80, title: `${prefix}账号`, desc: '查看已绑定token列表' },
          { icon: 71, title: `${prefix}账号切换 [序号]`, desc: '激活指定序号账号' },
          { icon: 86, title: `${prefix}绑定 [token]`, desc: '绑定token' },
          { icon: 48, title: `${prefix}解绑 [序号]`, desc: '解绑指定序号token' },
          { icon: 47, title: `${prefix}删除 [序号]`, desc: '删除QQ/微信登录数据' },
          { icon: 49, title: `${prefix}(微信/QQ)刷新`, desc: '刷新微信/QQ token' },
          { icon: 64, title: `${prefix}(QQ/微信)登陆`, desc: '通过QQ/微信扫码登录' },
          { icon: 62, title: `${prefix}(WeGame/wegame微信)登陆`, desc: '登录WeGame（QQ/微信扫码）' },
          { icon: 61, title: `${prefix}安全中心登陆`, desc: '通过安全中心扫码登录' },
          { icon: 71, title: `${prefix}(QQ/微信)授权登陆 [code]`, desc: '通过授权码登录' },
          { icon: 52, title: `${prefix}网页登陆`, desc: '通过网页方式登录' },
          { icon: 80, title: `${prefix}ck登陆 [cookies]`, desc: '通过cookie登录' },
          { icon: 78, title: `${prefix}信息`, desc: '查询个人详细信息' },
          { icon: 71, title: `${prefix}UID`, desc: '查询个人UID' },
        ]
      },
      {
        order: 2, group: '游戏数据',
        list: [
          { icon: 41, title: `${prefix}藏品 [类型]`, desc: '查询个人仓库中的皮肤、饰品等' },
          { icon: 48, title: `${prefix}货币`, desc: '查询游戏内货币信息' },
          { icon: 55, title: `${prefix}数据 [模式] [赛季]`, desc: '查询个人统计数据' },
          { icon: 66, title: `${prefix}战绩 [模式] [页码]`, desc: '查询战绩（全面/烽火）' },
          { icon: 78, title: `${prefix}地图统计 [模式] [赛季/地图名]`, desc: '查询地图统计数据' },
          { icon: 53, title: `${prefix}流水 [类型/all] [页码/all]`, desc: '查询交易流水' },
          { icon: 79, title: `${prefix}出红记录 [物品名]`, desc: '查询藏品解锁记录' },
          { icon: 42, title: `${prefix}昨日收益 [模式]`, desc: '查询昨日收益和物资统计' },
        ]
      },
      {
        order: 3, group: '价格/利润查询',
        list: [
          { icon: 61, title: `${prefix}价格历史 | ${prefix}当前价格 [物品名/ID]`, desc: '查询物品历史/当前价格' },
          { icon: 61, title: `${prefix}材料价格 [物品ID]`, desc: '查询制造材料最低价格' },
          { icon: 61, title: `${prefix}利润历史 [物品名/ID/场所]`, desc: '查询制造利润历史记录' },
          { icon: 61, title: `${prefix}利润排行 [类型] [场所] [数量]`, desc: '查询利润排行榜V1' },
          { icon: 61, title: `${prefix}最高利润 [类型] [场所] [物品ID]`, desc: '查询最高利润排行榜V2' },
          { icon: 62, title: `${prefix}特勤处利润 [类型]`, desc: '查询特勤处四个场所利润TOP3' },
        ]
      },
      {
        order: 4, group: '语音播放',
        list: [
          { icon: 87, title: `${prefix}语音`, desc: '随机播放语音' },
          { icon: 87, title: `${prefix}语音 [角色名/标签]`, desc: '播放指定角色/标签语音' },
          { icon: 87, title: `${prefix}语音 [角色] [场景]`, desc: '播放指定场景语音' },
          { icon: 87, title: `${prefix}语音 [角色] [场景] [动作]`, desc: '播放指定动作语音' },
          { icon: 78, title: `${prefix}语音列表 | ${prefix}语音分类`, desc: '查看可用角色/分类信息' },
          { icon: 79, title: `${prefix}标签列表 | ${prefix}语音统计`, desc: '查看特殊标签/音频统计' },
        ]
      },
      {
        order: 5, group: '鼠鼠音乐',
        list: [
          { icon: 87, title: `${prefix}鼠鼠音乐 [关键词]`, desc: '随机播放/搜索播放音乐' },
          { icon: 88, title: `${prefix}鼠鼠音乐列表 [页码]`, desc: '查看热度排行榜' },
          { icon: 98, title: `${prefix}鼠鼠语音`, desc: '播放鼠鼠语音' },
          { icon: 89, title: `${prefix}鼠鼠歌单 [名称]`, desc: '查看指定歌单' },
          { icon: 90, title: `${prefix}点歌 [序号]`, desc: '播放列表中的歌曲' },
          { icon: 45, title: `${prefix}歌词`, desc: '查看鼠鼠音乐歌词' },
        ]
      },
    ],
    right: [
      {
        order: 1, group: '战报与推送',
        list: [
          { icon: 86, title: `${prefix}日报 [模式]`, desc: '查询日报数据（全面/烽火）' },
          { icon: 86, title: `${prefix}周报 [模式] [日期] [展示]`, desc: '查询每周战报' },
          { icon: 46, title: `${prefix}每日密码`, desc: '查询今日密码' },
          { icon: 86, title: `${prefix}开启/关闭日报推送`, desc: '在本群开启/关闭日报推送' },
          { icon: 37, title: `${prefix}开启/关闭周报推送`, desc: '在本群开启/关闭周报推送' },
          { icon: 86, title: `${prefix}开启/关闭每日密码推送`, desc: '开启/关闭每日密码推送' },
          { icon: 86, title: `${prefix}开启/关闭特勤处推送`, desc: '开启/关闭特勤处制造完成推送' },
          { icon: 86, title: `${prefix}订阅 战绩 [模式]`, desc: '订阅战绩（sol/mp/both）' },
          { icon: 80, title: `${prefix}取消订阅 战绩`, desc: '取消战绩订阅' },
          { icon: 78, title: `${prefix}订阅状态 战绩`, desc: '查看订阅和推送状态' },
          { icon: 61, title: `${prefix}开启/关闭私信订阅推送 战绩 [筛选]`, desc: '开启/关闭私信推送' },
          { icon: 61, title: `${prefix}开启/关闭本群订阅推送 战绩 [筛选]`, desc: '开启/关闭本群推送' },
          { icon: 79, title: '筛选条件', desc: '百万撤离/百万战损/天才少年' },
        ]
      },
      {
        order: 2, group: '社区改枪码',
        list: [
          { icon: 86, title: `${prefix}改枪码上传 [改枪码] [描述] [模式] [是否公开] [配件信息]`, desc: '上传改枪方案' },
          { icon: 86, title: `${prefix}改枪码列表 [武器名]`, desc: '查询改枪方案列表' },
          { icon: 86, title: `${prefix}改枪码详情 [方案ID]`, desc: '查询改枪方案详情' },
          { icon: 86, title: `${prefix}改枪码点赞 | ${prefix}改枪码点踩 [方案ID]`, desc: '点赞/点踩改枪方案' },
          { icon: 86, title: `${prefix}改枪码收藏 | ${prefix}改枪码取消收藏 [方案ID]`, desc: '收藏/取消收藏改枪方案' },
          { icon: 86, title: `${prefix}改枪码收藏列表`, desc: '查看已收藏的改枪方案' },
          { icon: 86, title: `${prefix}改枪码更新 | ${prefix}改枪码删除 [方案ID] [参数]`, desc: '更新/删除已上传的改枪方案' },
          { icon: 78, title: '网站上传修改', desc: 'https://df.shallow.ink/solutions' },
        ]
      },
      {
        order: 3, group: '实用工具',
        list: [
          { icon: 61, title: `${prefix}ai锐评 [模式]`, desc: '使用AI锐评烽火地带和全面战场数据' },
          { icon: 61, title: `${prefix}ai评价 [模式] [预设] [音色]`, desc: '使用其他AI预设来评价战绩' },
          { icon: 78, title: `${prefix}ai预设列表`, desc: '查看所有可用的AI评价预设' },
          { icon: 41, title: `${prefix}违规记录`, desc: '登录QQ安全中心后可查询历史违规' },
          { icon: 48, title: `${prefix}特勤处状态`, desc: '查询特勤处制造状态' },
          { icon: 71, title: `${prefix}特勤处信息 [场所]`, desc: '查询特勤处设施升级信息' },
          { icon: 86, title: `${prefix}物品搜索 [名称/ID]`, desc: '搜索游戏内物品' },
          { icon: 48, title: `${prefix}大红收藏 [赛季数字]`, desc: '生成大红收集海报' },
          { icon: 40, title: `${prefix}文章列表 | ${prefix}文章详情 [ID]`, desc: '查看文章列表/详情' },
          { icon: 71, title: `${prefix}健康状态`, desc: '查询游戏健康状态信息' },
          { icon: 78, title: `${prefix}干员 [名称]`, desc: '查询干员详细信息' },
          { icon: 78, title: `${prefix}干员列表`, desc: '查询所有干员列表（按兵种分组）' },
        ]
      },
      {
        order: 4, group: 'TTS语音合成',
        list: [
          { icon: 87, title: `${prefix}tts [角色] [情感] 文本`, desc: '合成并发送语音' },
          { icon: 87, title: `${prefix}tts 麦晓雯 开心 你好呀！`, desc: '示例：使用指定角色和情感' },
          { icon: 78, title: `${prefix}tts状态`, desc: '查看TTS服务状态' },
          { icon: 78, title: `${prefix}tts角色列表`, desc: '查看所有可用的角色预设' },
          { icon: 78, title: `${prefix}tts角色详情 [角色ID]`, desc: '查看指定角色的详细信息' },
          { icon: 64, title: `${prefix}tts上传`, desc: '上传上次合成的语音文件' },
        ]
      },
    ]
  };
}

/**
 * 注册 WebUI 路由
 */
function registerRoutes (ctx: NapCatPluginContext): void {
  const router = ctx.router;

  // 注册静态资源目录 - 通过 /plugin/{pluginId}/files/static/ 访问
  if (router.static) {
    router.static('/static', 'resources');
    router.static('/webui', 'webui');
  }

  // 注册配置页面到插件拓展界面
  if (router.page) {
    router.page({
      path: 'config',
      title: '三角洲配置',
      icon: '🎮',
      htmlFile: 'webui/config.html',
      description: '三角洲行动插件配置面板',
    });
    pluginState.log('info', '插件页面已注册: 三角洲配置');
  }

  // ==================== 无认证接口 ====================

  // 插件状态
  router.getNoAuth('/status', async (_req: any, res: any) => {
    try {
      const puppeteerStatus = await checkPuppeteerStatus();
      res.json({
        code: 0,
        data: {
          pluginName: pluginState.pluginName,
          version: pluginState.version,
          puppeteer: puppeteerStatus,
        },
      });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 获取配置（无认证，用于WebUI加载）
  router.getNoAuth('/config', (_req: any, res: any) => {
    res.json({ code: 0, data: pluginState.getConfig() });
  });

  // 保存配置（无认证，用于WebUI保存）
  router.postNoAuth('/config', async (req: any, res: any) => {
    try {
      const body = req.body || {};
      pluginState.saveConfig(ctx, body);
      // 清除帮助图片缓存，让配置生效
      helpHandler.clearHelpCache();
      res.json({ code: 0, message: '配置已保存' });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // ==================== 调试日志接口 ====================

  // 获取调试日志（支持增量拉取 ?after=lastId）
  router.getNoAuth('/debug/logs', (req: any, res: any) => {
    const afterId = parseInt(req.query?.after) || 0;
    const logs = pluginState.getDebugLogs(afterId);
    res.json({ code: 0, data: { logs, enabled: pluginState.webDebugMode } });
  });

  // 切换 Web 调试模式
  router.postNoAuth('/debug/toggle', (req: any, res: any) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ code: -1, message: '参数 enabled 必须为 boolean' });
    }
    pluginState.setWebDebugMode(enabled);
    res.json({ code: 0, data: { enabled: pluginState.webDebugMode } });
  });

  // 清空调试日志
  router.postNoAuth('/debug/clear', (_req: any, res: any) => {
    pluginState.clearDebugLogs();
    res.json({ code: 0, message: '日志已清空' });
  });

  // ==================== 需认证接口 ====================

  // 获取配置（需认证）
  router.get('/config', (_req: any, res: any) => {
    res.json({ code: 0, data: pluginState.getConfig() });
  });

  // 保存配置
  router.post('/config', async (req: any, res: any) => {
    try {
      const body = req.body || {};
      pluginState.saveConfig(ctx, body);
      // 清除帮助图片缓存，让配置生效
      helpHandler.clearHelpCache();
      res.json({ code: 0, message: '配置保存成功' });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 获取群列表（无认证，用于WebUI）
  router.getNoAuth('/groups', async (_req: any, res: any) => {
    try {
      const result = await ctx.actions.call(
        'get_group_list',
        {} as never,
        ctx.adapterName,
        ctx.pluginManager.config
      );
      res.json({ code: 0, data: result || [] });
    } catch (e) {
      pluginState.log('error', '获取群列表失败:', e);
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 获取好友列表（无认证，用于WebUI）
  router.getNoAuth('/friends', async (_req: any, res: any) => {
    try {
      const result = await ctx.actions.call(
        'get_friend_list',
        {} as never,
        ctx.adapterName,
        ctx.pluginManager.config
      );
      res.json({ code: 0, data: result || [] });
    } catch (e) {
      pluginState.log('error', '获取好友列表失败:', e);
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 获取帮助背景图（无认证，用于WebUI预览）
  router.getNoAuth('/help/bg', (_req: any, res: any) => {
    try {
      // 尝试多个可能的路径
      const possiblePaths = [
        path.join(ctx.pluginDir, 'resources', 'help', 'imgs', 'default', 'bg.jpg'),
        path.join(ctx.pluginDir, 'dist', 'resources', 'help', 'imgs', 'default', 'bg.jpg'),
        path.resolve(__dirname, 'resources', 'help', 'imgs', 'default', 'bg.jpg'),
        path.resolve(__dirname, '..', 'resources', 'help', 'imgs', 'default', 'bg.jpg'),
      ];

      let bgPath = '';
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          bgPath = p;
          break;
        }
      }

      if (bgPath) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'max-age=3600');
        fs.createReadStream(bgPath).pipe(res);
      } else {
        console.log('[Delta] 背景图路径尝试:', possiblePaths);
        res.status(404).json({ code: -1, message: '背景图不存在' });
      }
    } catch (e) {
      console.error('[Delta] 获取背景图失败:', e);
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 获取帮助图标图（无认证，用于WebUI预览）
  router.getNoAuth('/help/icon', (_req: any, res: any) => {
    try {
      // 尝试多个可能的路径
      const possiblePaths = [
        path.join(ctx.pluginDir, 'resources', 'help', 'imgs', 'default', 'icon.png'),
        path.join(ctx.pluginDir, 'dist', 'resources', 'help', 'imgs', 'default', 'icon.png'),
        path.resolve(__dirname, 'resources', 'help', 'imgs', 'default', 'icon.png'),
        path.resolve(__dirname, '..', 'resources', 'help', 'imgs', 'default', 'icon.png'),
      ];

      let iconPath = '';
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          iconPath = p;
          break;
        }
      }

      if (iconPath) {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'max-age=3600');
        fs.createReadStream(iconPath).pipe(res);
      } else {
        console.log('[Delta] 图标图路径尝试:', possiblePaths);
        res.status(404).json({ code: -1, message: '图标图不存在' });
      }
    } catch (e) {
      console.error('[Delta] 获取图标图失败:', e);
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 获取帮助列表（无认证，用于WebUI）
  router.getNoAuth('/help/list', (_req: any, res: any) => {
    try {
      const config = pluginState.getConfig();
      if (config.help_list) {
        res.json({ code: 0, data: config.help_list });
      } else {
        // 返回完整的默认帮助列表
        res.json({ code: 0, data: getDefaultHelpListData() });
      }
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 获取默认帮助列表（无认证，用于恢复初始菜单）
  router.getNoAuth('/help/default', (_req: any, res: any) => {
    try {
      res.json({ code: 0, data: getDefaultHelpListData() });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 自定义图片目录（保存到 dataPath，确保可写）
  const customImgDir = path.join(pluginState.dataPath, 'custom-images');
  if (!fs.existsSync(customImgDir)) {
    fs.mkdirSync(customImgDir, { recursive: true });
  }

  // 分块上传临时缓存
  const uploadChunks: Record<string, { chunks: string[]; total: number; type: string; }> = {};

  // 分块上传帮助图片（每块 < 50KB，避免 body 限制）
  router.postNoAuth('/help/upload-chunk', (req: any, res: any) => {
    try {
      const { type, chunkIndex, totalChunks, data } = req.body || {};
      if (!type || chunkIndex === undefined || !totalChunks || !data) {
        return res.status(400).json({ code: -1, message: '缺少参数' });
      }

      const key = `upload_${type}`;
      if (chunkIndex === 0) {
        uploadChunks[key] = { chunks: new Array(totalChunks).fill(''), total: totalChunks, type };
      }
      if (!uploadChunks[key]) {
        return res.status(400).json({ code: -1, message: '请重新上传' });
      }

      uploadChunks[key].chunks[chunkIndex] = data;

      // 检查是否全部接收
      const received = uploadChunks[key].chunks.filter(c => c !== '').length;
      if (received === totalChunks) {
        // 拼接完整 base64 数据
        const fullBase64 = uploadChunks[key].chunks.join('');
        const buffer = Buffer.from(fullBase64, 'base64');

        // 保存文件
        const ext = type === 'bg' ? '.jpg' : '.png';
        const filePath = path.join(customImgDir, type + ext);
        fs.writeFileSync(filePath, buffer);

        delete uploadChunks[key];
        helpHandler.clearHelpCache();

        pluginState.log('info', `帮助${type === 'bg' ? '背景图' : '图标'}已上传 (${(buffer.length / 1024).toFixed(1)}KB)`);
        res.json({ code: 0, message: '上传成功', done: true });
      } else {
        res.json({ code: 0, message: `已接收 ${received}/${totalChunks}`, done: false });
      }
    } catch (e) {
      pluginState.log('error', '上传失败:', e);
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 提供自定义图片（通过 API 路由，不依赖 static）
  router.getNoAuth('/help/custom-image', (req: any, res: any) => {
    try {
      const type = req.query?.type;
      if (!type) return res.status(400).json({ code: -1, message: '缺少参数' });

      const ext = type === 'bg' ? '.jpg' : '.png';
      const filePath = path.join(customImgDir, type + ext);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ code: -1, message: '文件不存在' });
      }

      const mime = type === 'bg' ? 'image/jpeg' : 'image/png';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-cache');
      res.send(fs.readFileSync(filePath));
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 重置帮助图片
  router.postNoAuth('/help/reset-image', (req: any, res: any) => {
    try {
      const type = req.query?.type || req.body?.type;
      if (!type) {
        return res.status(400).json({ code: -1, message: '缺少参数' });
      }

      const ext = type === 'bg' ? '.jpg' : '.png';
      const customPath = path.join(customImgDir, type + ext);
      if (fs.existsSync(customPath)) {
        fs.unlinkSync(customPath);
      }

      helpHandler.clearHelpCache();

      pluginState.log('info', `帮助${type === 'bg' ? '背景图' : '图标'}已重置`);
      res.json({ code: 0, message: '重置成功' });
    } catch (e) {
      pluginState.log('error', '重置失败:', e);
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 获取帮助图片状态
  router.getNoAuth('/help/image-status', (_req: any, res: any) => {
    try {
      res.json({
        code: 0,
        data: {
          hasCustomBg: fs.existsSync(path.join(customImgDir, 'bg.jpg')),
          hasCustomIcon: fs.existsSync(path.join(customImgDir, 'icon.png'))
        }
      });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // ==================== 自定义图标管理 ====================
  const customIconDir = path.join(pluginState.dataPath, 'custom-icons');
  if (!fs.existsSync(customIconDir)) {
    fs.mkdirSync(customIconDir, { recursive: true });
  }

  // 分块上传自定义图标
  router.postNoAuth('/help/upload-icon-chunk', (req: any, res: any) => {
    try {
      const { name, chunkIndex, totalChunks, data } = req.body || {};
      if (!name || chunkIndex === undefined || !totalChunks || !data) {
        return res.status(400).json({ code: -1, message: '缺少参数' });
      }

      // 清理文件名（只保留字母数字和下划线）
      const safeName = name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5.-]/g, '_');
      const key = `icon_${safeName}`;

      if (chunkIndex === 0) {
        uploadChunks[key] = { chunks: new Array(totalChunks).fill(''), total: totalChunks, type: 'icon' };
      }
      if (!uploadChunks[key]) {
        return res.status(400).json({ code: -1, message: '请重新上传' });
      }

      uploadChunks[key].chunks[chunkIndex] = data;
      const received = uploadChunks[key].chunks.filter(c => c !== '').length;

      if (received === totalChunks) {
        const fullBase64 = uploadChunks[key].chunks.join('');
        const buffer = Buffer.from(fullBase64, 'base64');

        // 保存文件（统一为 png）
        const fileName = safeName.replace(/\.[^.]+$/, '') + '.png';
        fs.writeFileSync(path.join(customIconDir, fileName), buffer);
        delete uploadChunks[key];
        helpHandler.clearHelpCache();

        pluginState.log('info', `自定义图标已上传: ${fileName}`);
        res.json({ code: 0, message: '上传成功', done: true, fileName });
      } else {
        res.json({ code: 0, message: `${received}/${totalChunks}`, done: false });
      }
    } catch (e) {
      pluginState.log('error', '图标上传失败:', e);
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 列出自定义图标
  router.getNoAuth('/help/custom-icons', (_req: any, res: any) => {
    try {
      const files = fs.existsSync(customIconDir)
        ? fs.readdirSync(customIconDir).filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f))
        : [];
      res.json({ code: 0, data: files });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 提供自定义图标文件
  router.getNoAuth('/help/custom-icon-file', (req: any, res: any) => {
    try {
      const name = req.query?.name;
      if (!name) return res.status(400).json({ code: -1, message: '缺少参数' });

      const filePath = path.join(customIconDir, path.basename(name));
      if (!fs.existsSync(filePath)) return res.status(404).json({ code: -1, message: '文件不存在' });

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(fs.readFileSync(filePath));
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  // 删除自定义图标
  router.postNoAuth('/help/delete-icon', (req: any, res: any) => {
    try {
      const name = req.body?.name;
      if (!name) return res.status(400).json({ code: -1, message: '缺少参数' });

      const filePath = path.join(customIconDir, path.basename(name));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      helpHandler.clearHelpCache();
      res.json({ code: 0, message: '已删除' });
    } catch (e) {
      res.status(500).json({ code: -1, message: String(e) });
    }
  });

  pluginState.log('info', 'WebUI 路由已注册');
}

/**
 * 消息处理
 */
export const plugin_onmessage = async (ctx: NapCatPluginContext, event: OB11Message): Promise<void> => {
  try {
    const rawMessage = event.raw_message || '';
    const userId = String(event.user_id);

    if (!hasPrefix(rawMessage)) return;

    const content = stripPrefix(rawMessage);
    pluginState.log('debug', `收到消息: "${rawMessage}" -> 内容: "${content}"`);

    for (const cmd of allCommands) {
      for (const keyword of cmd.keywords) {
        let matched = false;
        let args = '';

        if (cmd.hasArgs) {
          if (content.startsWith(keyword)) {
            matched = true;
            args = content.substring(keyword.length).trim();
          }
        } else {
          if (content === keyword) {
            matched = true;
          }
        }

        // 检查别名
        if (!matched && cmd.aliases) {
          for (const alias of cmd.aliases) {
            if (cmd.hasArgs && content.startsWith(alias)) {
              matched = true;
              args = content.substring(alias.length).trim();
              break;
            } else if (!cmd.hasArgs && content === alias) {
              matched = true;
              break;
            }
          }
        }

        if (matched) {
          pluginState.logDebug(`匹配命令: ${cmd.name} (${cmd.handler})`);
          const handled = await dispatchHandler(ctx, cmd.handler, event, args);
          if (handled) return;
        }
      }
    }
  } catch (error) {
    pluginState.log('error', '消息处理失败:', error);
  }
};

/**
 * 分发处理器
 */
async function dispatchHandler (ctx: NapCatPluginContext, handlerName: string, event: OB11Message, args: string): Promise<boolean> {
  // 登录相关
  if (handlerName === 'login') return loginHandler.login(ctx, event, args);
  if (handlerName === 'webLogin') return loginHandler.webLogin(ctx, event);
  if (handlerName === 'bindCharacter') return loginHandler.bindCharacter(ctx, event);

  // 账号管理
  if (handlerName === 'showAccounts') return accountHandler.showAccounts(event);
  if (handlerName === 'bindToken') return accountHandler.bindToken(event, args);
  if (handlerName === 'unbindToken') return accountHandler.unbindToken(event, args);
  if (handlerName === 'deleteToken') return accountHandler.deleteToken(event, args);
  if (handlerName === 'switchAccount') return accountHandler.switchAccount(event, args);
  if (handlerName === 'refreshWechat') return accountHandler.refreshWechat(event);
  if (handlerName === 'refreshQq') return accountHandler.refreshQq(event);

  // 信息查询
  if (handlerName === 'getUserInfo') return infoHandler.getUserInfo(ctx, event);
  if (handlerName === 'getUid') return infoHandler.getUid(ctx, event);

  // 数据查询
  if (handlerName === 'getMoney') return dataHandler.getMoney(event);
  if (handlerName === 'getPersonalData') return dataHandler.getPersonalData(event, args);

  // 帮助
  if (handlerName === 'help') return helpHandler.help(event);

  // 战绩/战报
  if (handlerName === 'getRecord') return recordHandler.getRecord(event, args);
  if (handlerName === 'getDailyReport') return recordHandler.getDailyReport(event, args);
  if (handlerName === 'getWeeklyReport') return recordHandler.getWeeklyReport(event, args);
  if (handlerName === 'getYesterdayProfit') return recordHandler.getYesterdayProfit(event, args);

  // 工具功能
  if (handlerName === 'aiComment') return toolsHandler.aiComment(event, args);
  if (handlerName === 'getOperator') return toolsHandler.getOperator(event, args);
  if (handlerName === 'getOperatorList') return toolsHandler.getOperatorList(event);
  if (handlerName === 'getPlaceStatus') return toolsHandler.getPlaceStatus(event);
  if (handlerName === 'getPlaceInfo') return toolsHandler.getPlaceInfo(event, args);
  if (handlerName === 'getDailyKeyword') return toolsHandler.getDailyKeyword(event);
  if (handlerName === 'getMapStats') return toolsHandler.getMapStats(event, args);
  if (handlerName === 'getCollection') return toolsHandler.getCollection(event);
  if (handlerName === 'getBanHistory') return toolsHandler.getBanHistory(event);
  if (handlerName === 'getUserStats') return toolsHandler.getUserStats(event);
  if (handlerName === 'getHealthInfo') return toolsHandler.getHealthInfo(event);
  if (handlerName === 'getArticleList') return toolsHandler.getArticleList(event);
  if (handlerName === 'getArticleDetail') return toolsHandler.getArticleDetail(event, args);
  if (handlerName === 'getAiPresets') return toolsHandler.getAiPresets(event);
  if (handlerName === 'enableDebug') return toolsHandler.enableDebug(event);
  if (handlerName === 'disableDebug') return toolsHandler.disableDebug(event);
  if (handlerName === 'debugStatus') return toolsHandler.debugStatus(event);

  // TTS 娱乐功能
  if (handlerName === 'getTtsHealth') return entertainmentHandler.getTtsHealth(event);
  if (handlerName === 'getTtsPresets') return entertainmentHandler.getTtsPresets(event);
  if (handlerName === 'getTtsPresetDetail') return entertainmentHandler.getTtsPresetDetail(event, args);
  if (handlerName === 'ttsSynthesize') return entertainmentHandler.ttsSynthesize(event, args);

  // 物品查询
  if (handlerName === 'searchObject') return objectHandler.searchObject(event, args);

  // 流水查询
  if (handlerName === 'getFlows') return flowsHandler.getFlows(event, args);

  // 价格查询
  if (handlerName === 'getCurrentPrice') return priceHandler.getCurrentPrice(event, args);
  if (handlerName === 'getPriceHistory') return priceHandler.getPriceHistory(event, args);
  if (handlerName === 'getMaterialPrice') return priceHandler.getMaterialPrice(event, args);
  if (handlerName === 'getProfitRank') return priceHandler.getProfitRank(event, args);
  if (handlerName === 'getProfitRankV2') return priceHandler.getProfitRankV2(event, args);
  if (handlerName === 'getSpecialOpsProfit') return priceHandler.getSpecialOpsProfit(event, args);

  // 服务器状态
  if (handlerName === 'getServerHealth') return healthHandler.getServerHealth(event);

  // 红色藏品
  if (handlerName === 'getRedCollection') return redHandler.getRedCollection(event, args);
  if (handlerName === 'getRedRecord') return redHandler.getRedRecord(event, args);

  // 推送功能
  if (handlerName === 'enableDailyPush') return pushHandler.enableDailyPush(event);
  if (handlerName === 'disableDailyPush') return pushHandler.disableDailyPush(event);
  if (handlerName === 'enableWeeklyPush') return pushHandler.enableWeeklyPush(event);
  if (handlerName === 'disableWeeklyPush') return pushHandler.disableWeeklyPush(event);
  if (handlerName === 'enableKeywordPush') return pushHandler.enableKeywordPush(event);
  if (handlerName === 'disableKeywordPush') return pushHandler.disableKeywordPush(event);
  if (handlerName === 'getPushStatus') return pushHandler.getPushStatus(event);

  // WebSocket
  if (handlerName === 'wsConnect') return websocketHandler.wsConnect(event);
  if (handlerName === 'wsDisconnect') return websocketHandler.wsDisconnect(event);
  if (handlerName === 'wsStatus') return websocketHandler.wsStatus(event);
  if (handlerName === 'enableNotification') return websocketHandler.enableNotification(event);
  if (handlerName === 'disableNotification') return websocketHandler.disableNotification(event);
  if (handlerName === 'getNotificationStatus') return websocketHandler.getNotificationStatus(event);

  // 语音
  if (handlerName === 'sendVoice') return voiceHandler.sendVoice(event, args);
  if (handlerName === 'getCharacterList') return voiceHandler.getCharacterList(event);
  if (handlerName === 'getTagList') return voiceHandler.getTagList(event);
  if (handlerName === 'getCategoryList') return voiceHandler.getCategoryList(event);
  if (handlerName === 'getAudioStats') return voiceHandler.getAudioStats(event);

  // 改枪方案
  if (handlerName === 'uploadSolution') return solutionHandler.uploadSolution(event, args);
  if (handlerName === 'getSolutionList') return solutionHandler.getSolutionList(event, args);
  if (handlerName === 'getSolutionDetail') return solutionHandler.getSolutionDetail(event, args);
  if (handlerName === 'voteSolutionLike') return solutionHandler.voteSolutionLike(event, args);
  if (handlerName === 'voteSolutionDislike') return solutionHandler.voteSolutionDislike(event, args);
  if (handlerName === 'updateSolution') return solutionHandler.updateSolution(event, args);
  if (handlerName === 'deleteSolution') return solutionHandler.deleteSolution(event, args);
  if (handlerName === 'collectSolution') return solutionHandler.collectSolution(event, args);
  if (handlerName === 'discollectSolution') return solutionHandler.discollectSolution(event, args);
  if (handlerName === 'getCollectList') return solutionHandler.getCollectList(event);

  // 鼠鼠音乐
  if (handlerName === 'sendShushuMusic') return musicHandler.sendShushuMusic(event, args);
  if (handlerName === 'getShushuMusicRank') return musicHandler.getShushuMusicRank(event, args);
  if (handlerName === 'getShushuPlaylist') return musicHandler.getShushuPlaylist(event, args);
  if (handlerName === 'getLyrics') return musicHandler.getLyrics(event);
  if (handlerName === 'sendShushuVoice') return musicHandler.sendShushuVoice(event);
  if (handlerName === 'selectMusicByNumber') return musicHandler.selectMusicByNumber(event, args);

  // 战绩订阅
  if (handlerName === 'subscribeRecord') return subscriptionHandler.subscribeRecord(event, args);
  if (handlerName === 'unsubscribeRecord') return subscriptionHandler.unsubscribeRecord(event);
  if (handlerName === 'getSubscriptionStatus') return subscriptionHandler.getSubscriptionStatus(event);
  if (handlerName === 'enableGroupPush') return subscriptionHandler.enableGroupPush(event, args);
  if (handlerName === 'disableGroupPush') return subscriptionHandler.disableGroupPush(event);
  if (handlerName === 'enablePrivatePush') return subscriptionHandler.enablePrivatePush(event, args);
  if (handlerName === 'disablePrivatePush') return subscriptionHandler.disablePrivatePush(event);

  pluginState.log('warn', `未知处理器: ${handlerName}`);
  return false;
}

/**
 * 插件卸载
 */
export const plugin_cleanup = async (_ctx: NapCatPluginContext): Promise<void> => {
  // 停止定时任务
  try {
    const scheduler = getScheduler();
    scheduler.stop();
  } catch (e) {
    // ignore
  }

  // 停止推送任务（特勤处等）
  try {
    pushHandler.stopPushTasks();
  } catch (e) {
    // ignore
  }

  // 断开 WebSocket
  try {
    const wsManager = getWebSocketManager();
    wsManager.disconnect(true);
  } catch (e) {
    // ignore
  }

  pluginState.log('info', '插件已卸载');
};

/** 获取当前配置 */
export const plugin_get_config = async (_ctx: NapCatPluginContext): Promise<any> => {
  return pluginState.getConfig();
};

/** 设置配置 */
export const plugin_set_config = async (ctx: NapCatPluginContext, config: any): Promise<void> => {
  pluginState.saveConfig(ctx, config);
  // 清除帮助图片缓存，让配置生效
  helpHandler.clearHelpCache();
};

export default {
  plugin_init,
  plugin_onmessage,
  plugin_cleanup,
  plugin_get_config,
  plugin_set_config,
  plugin_config_ui,
};

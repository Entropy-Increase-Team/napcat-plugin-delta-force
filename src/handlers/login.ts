/**
 * 登录处理器
 * QQ/微信/WeGame 扫码登录
 */

import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types';
import { pluginState } from '../core/state';
import { createApi } from '../core/api';
import { reply, replyImage, getUserId } from '../utils/message';
import { getAccount } from '../utils/account';
import type { CommandDef } from '../utils/command';

/** 命令定义 */
export const commands: CommandDef[] = [
  { keywords: ['登录', '登陆'], handler: 'login', name: '扫码登录', hasArgs: true, aliases: ['qq登录', 'QQ登录', '微信登录', 'wx登录', 'WX登录', 'wegame登录', 'WEGAME登录', 'qqsafe登录', 'QQsafe登录', '安全中心登录'] },
  { keywords: ['ck登录', 'ck登陆', 'CK登录', 'cookie登录'], handler: 'cookieLogin', name: 'Cookie登录', hasArgs: true },
  { keywords: ['qq授权登录', 'QQ授权登录', 'qq授权登陆', 'QQ授权登陆'], handler: 'qqOAuthLogin', name: 'QQ授权登录', hasArgs: true },
  { keywords: ['微信授权登录', 'wx授权登录', '微信授权登陆', 'wx授权登陆'], handler: 'wechatOAuthLogin', name: '微信授权登录', hasArgs: true },
  { keywords: ['网页登陆', '网页登录', 'web登录', 'web登陆'], handler: 'webLogin', name: '网页登录' },
  { keywords: ['角色绑定'], handler: 'bindCharacter', name: '角色绑定' },
];

/** 平台类型 */
type Platform = 'qq' | 'wechat' | 'wegame' | 'qqsafe';

/** 登录状态 */
interface LoginStatus {
  statusCode: number;
  status: string;
  hasToken?: boolean;
  frameworkToken?: string;
}

/** 平台名称映射 */
const platformNames: Record<Platform, string> = {
  qq: 'QQ',
  wechat: '微信',
  wegame: 'WeGame',
  qqsafe: 'QQ安全中心',
};

/** 登录命令 */
export async function login (ctx: NapCatPluginContext, msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const rawMessage = msg.raw_message || '';

  // 解析平台
  let platformInput: Platform = 'qq';
  const lowerMsg = rawMessage.toLowerCase();
  if (lowerMsg.includes('微信') || lowerMsg.includes('wx') || lowerMsg.includes('wechat')) {
    platformInput = 'wechat';
  } else if (lowerMsg.includes('wegame')) {
    platformInput = 'wegame';
  } else if (lowerMsg.includes('qqsafe') || lowerMsg.includes('安全中心')) {
    platformInput = 'qqsafe';
  }

  await reply(msg, `正在获取 ${platformNames[platformInput]} 登录二维码，请稍候...`);

  // 获取二维码 (按原插件逻辑)
  const res = await api.getLoginQr(platformInput) as any;
  const frameworkToken = res?.token || res?.frameworkToken;

  // 调试日志：查看API返回
  pluginState.logDebug(`[登录] API返回: token=${res?.token}, frameworkToken=${res?.frameworkToken}, qr_image=${res?.qr_image ? '存在' : '无'}`);

  if (!res || !res.qr_image) {
    await reply(msg, '二维码获取失败，请稍后重试');
    return true;
  }

  // 检查 token
  if (!frameworkToken) {
    pluginState.log('error', `[登录] 未获取到 frameworkToken，API返回: ${JSON.stringify(res)}`);
    await reply(msg, '登录初始化失败: 未获取到有效 Token');
    return true;
  }

  // 处理二维码图片 (按原插件逻辑)
  let qrImageFile: string;
  const qrImage = res.qr_image;

  if (platformInput !== 'wechat' && qrImage.startsWith('data:image/png;base64,')) {
    // 非微信：去掉 data URL 前缀，使用 base64://
    qrImageFile = `base64://${qrImage.replace(/^data:image\/png;base64,/, '')}`;
  } else if (qrImage.startsWith('data:image/')) {
    // 其他 data URL 格式
    qrImageFile = `base64://${qrImage.replace(/^data:image\/\w+;base64,/, '')}`;
  } else {
    // 微信或其他 URL 格式，直接使用
    qrImageFile = qrImage;
  }

  // 发送二维码图片和提示（合并为一条消息）
  await reply(msg, [
    { type: 'image', data: { file: qrImageFile } },
    { type: 'text', data: { text: `\n请使用 ${platformNames[platformInput]} 扫描上方二维码登录\n二维码有效期约 2 分钟` } },
  ]);

  // 轮询登录状态
  const success = await pollLoginStatus(msg, api, platformInput, frameworkToken, userId);

  if (!success) {
    await reply(msg, '登录超时或失败，请重新尝试');
  }

  return true;
}

/** 轮询登录状态 (按原插件逻辑) */
async function pollLoginStatus (
  msg: OB11Message,
  api: ReturnType<typeof createApi>,
  platform: Platform,
  token: string,
  userId: string
): Promise<boolean> {
  const maxAttempts = 180; // 180秒超时
  const interval = 1000;

  let notifiedScanned = false;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, interval));

    const statusRes = await api.getLoginStatus(platform, token) as any;
    if (!statusRes) continue;

    const statusCode = statusRes.code;

    pluginState.logDebug(`登录轮询 [${i + 1}/${maxAttempts}]: code=${statusCode}, status=${statusRes.status}, msg=${statusRes.msg}`);

    // 根据API文档：0=授权成功, 1=等待扫码, 2=已扫码待确认, -2=已过期, -3=风控
    switch (statusCode) {
      case 0: // 授权成功
        const finalToken = statusRes.token || statusRes.frameworkToken || token;

        // 绑定用户
        const config = pluginState.getConfig();
        if (config.clientID && config.clientID !== 'xxxxxx') {
          await api.bindUser({
            frameworkToken: finalToken,
            platformID: userId,
            clientID: config.clientID,
            clientType: 'napcat',
          });
        }

        // 保存 Token
        pluginState.setActiveToken(userId, finalToken);

        await reply(msg, '登录成功！Token 已自动绑定');
        return true;

      case 2: // 已扫码，待确认
        if (!notifiedScanned) {
          notifiedScanned = true;
          await reply(msg, '二维码已被扫描，等待确认...');
        }
        break;

      case 1: // 等待扫描
        break;

      case -2: // 二维码超时
        await reply(msg, statusRes.msg || '二维码已过期，请重新发送登录命令');
        return false;

      case -3: // 安全风控
        await reply(msg, statusRes.msg || '登录存在安全风险，请稍后重试');
        return false;

      default:
        // 其他状态继续轮询
        break;
    }
  }

  return false;
}

/** 网页登录 */
export async function webLogin (ctx: NapCatPluginContext, msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);

  // 获取机器人 QQ 号
  const botId = msg.self_id || '';

  // 生成网页登录链接
  const webLoginUrl = `https://df.shallow.ink/oauth-login?platformID=${userId}&botID=${botId}`;

  await reply(msg, `三角洲行动网页OAuth登陆：\n请到浏览器打开：\n${webLoginUrl}\n选择QQ或微信进行登陆，三分钟内完成登陆将会自动绑定`);

  // 开始轮询登录状态
  const startTime = Date.now();
  const webLoginTimeout = 3 * 60 * 1000;
  const pollInterval = 3000;

  const activeTokens = new Set<string>();
  const sessionInfoMap = new Map<string, { token: string; type: string; }>();
  let notifiedPending = false;

  const pollStatus = async (): Promise<boolean> => {
    if (Date.now() - startTime > webLoginTimeout) {
      await reply(msg, '网页登录已超时，请重新尝试。');
      return false;
    }

    try {
      const statusRes = await api.getPlatformLoginStatus(userId, String(botId));

      if (!statusRes || (statusRes as any).code !== 0) {
        await new Promise(r => setTimeout(r, pollInterval));
        return pollStatus();
      }

      const sessions = (statusRes as any).sessions || [];

      if (sessions.length === 0) {
        await new Promise(r => setTimeout(r, pollInterval));
        return pollStatus();
      }

      // 收集有效 session
      const validSessions = sessions
        .filter((s: any) => s.frameworkToken && s.status !== 'expired' && (!s.expire || Date.now() <= s.expire))
        .slice(-5)
        .map((s: any) => ({ token: s.frameworkToken, type: s.type || 'qq' }));

      // 检查新 session
      for (const session of validSessions) {
        if (!activeTokens.has(session.token)) {
          activeTokens.add(session.token);
          sessionInfoMap.set(session.token, session);

          if (!notifiedPending) {
            await reply(msg, '已检测到网页登录会话，正在等待您完成登录...');
            notifiedPending = true;
          }
        }
      }

      // 轮询所有 token 状态
      if (activeTokens.size > 0) {
        for (const token of activeTokens) {
          const sessionInfo = sessionInfoMap.get(token);
          const tokenType = sessionInfo?.type || 'qq';

          let loginStatusRes;
          if (tokenType === 'wechat') {
            loginStatusRes = await api.getWechatOAuthStatus(token);
          } else {
            loginStatusRes = await api.getQqOAuthStatus(token);
          }

          const statusCode = (loginStatusRes as any)?.code;

          // 0=授权成功
          if (statusCode === 0) {
            // 绑定用户
            const config = pluginState.getConfig();
            if (config.clientID && config.clientID !== 'xxxxxx') {
              await api.bindUser({
                frameworkToken: token,
                platformID: userId,
                clientID: config.clientID,
                clientType: 'napcat',
              });
            }

            pluginState.setActiveToken(userId, token);
            await reply(msg, `网页${tokenType === 'wechat' ? '微信' : 'QQ'}登录成功！Token 已自动绑定`);
            return true;
          } else if (statusCode === -2) {
            activeTokens.delete(token);
            sessionInfoMap.delete(token);
          } else if (statusCode === -1) {
            activeTokens.delete(token);
            sessionInfoMap.delete(token);
          }
        }

        // 所有 token 过期
        if (activeTokens.size === 0 && validSessions.length === 0) {
          await reply(msg, '网页登录会话已过期，请重新尝试。');
          return false;
        }
      }

      await new Promise(r => setTimeout(r, pollInterval));
      return pollStatus();

    } catch (error) {
      pluginState.log('error', '网页登录轮询失败:', error);
      await new Promise(r => setTimeout(r, pollInterval * 2));
      return pollStatus();
    }
  };

  // 延迟开始轮询
  await new Promise(r => setTimeout(r, pollInterval));
  return pollStatus();
}

/** Cookie 登录 */
export async function cookieLogin (ctx: NapCatPluginContext, msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const cookie = args.trim();

  // 无参数时显示帮助
  if (!cookie) {
    const helpMsg = [
      '【Cookie登录教程】',
      '1. 准备 Via 浏览器或其他类似浏览器',
      '2. 在浏览器中打开 https://pvp.qq.com/cp/a20161115tyf/page1.shtml',
      '3. 在网页中进行 QQ 登录',
      '4. 点击左上角网页名左侧的盾图标',
      '5. 点击查看 cookies，然后复制全部内容',
      '6. 发送：三角洲ck登录 <刚刚复制的cookies>',
    ].join('\n');
    await reply(msg, helpMsg);
    return true;
  }

  await reply(msg, '正在尝试使用 Cookie 登录，请稍候...');

  const res = await api.loginWithCookie(cookie);

  if (!res || ((res as any).code !== 0 && !(res as any).success)) {
    await reply(msg, `Cookie 登录失败: ${(res as any)?.msg || (res as any)?.message || '请检查 Cookie 是否有效'}`);
    return true;
  }

  const frameworkToken = (res as any).frameworkToken;
  if (!frameworkToken) {
    await reply(msg, 'Cookie 登录失败: 未获取到有效 Token');
    return true;
  }

  // 绑定用户
  const config = pluginState.getConfig();
  if (config.clientID && config.clientID !== 'xxxxxx') {
    await api.bindUser({
      frameworkToken,
      platformID: userId,
      clientID: config.clientID,
      clientType: 'napcat',
    });
  }

  pluginState.setActiveToken(userId, frameworkToken);
  await reply(msg, 'Cookie 登录成功！Token 已自动绑定');
  return true;
}

/** QQ OAuth 授权登录 */
export async function qqOAuthLogin (ctx: NapCatPluginContext, msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const authUrl = args.trim();

  // 无参数时获取授权链接
  if (!authUrl) {
    const res = await api.getQqOAuthAuth(userId);

    if (!res || (res as any).code !== 0 || !(res as any).login_url) {
      await reply(msg, '获取授权链接失败，请稍后重试');
      return true;
    }

    const helpMsg = [
      '【QQ OAuth 授权登录教程】',
      `1. QQ 内打开链接：${(res as any).login_url}`,
      '2. 点击登录',
      '3. 登录成功后，点击右上角，选择复制链接',
      '4. 返回聊天界面，发送：三角洲qq授权登录 <刚刚复制的链接>',
    ].join('\n');
    await reply(msg, helpMsg);
    return true;
  }

  // 提交授权 URL
  await reply(msg, '正在处理授权信息...');

  const res = await api.submitQqOAuthAuth(authUrl);

  if (!res || (res as any).code !== 0) {
    await reply(msg, `QQ 授权登录失败: ${(res as any)?.msg || (res as any)?.message || '未知错误'}`);
    return true;
  }

  const frameworkToken = (res as any).frameworkToken;
  if (!frameworkToken) {
    await reply(msg, 'QQ 授权登录失败: 未获取到有效 Token');
    return true;
  }

  // 绑定用户
  const config = pluginState.getConfig();
  if (config.clientID && config.clientID !== 'xxxxxx') {
    await api.bindUser({
      frameworkToken,
      platformID: userId,
      clientID: config.clientID,
      clientType: 'napcat',
    });
  }

  pluginState.setActiveToken(userId, frameworkToken);
  await reply(msg, 'QQ OAuth 授权登录成功！Token 已自动绑定');
  return true;
}

/** 微信 OAuth 授权登录 */
export async function wechatOAuthLogin (ctx: NapCatPluginContext, msg: OB11Message, args: string): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const authUrl = args.trim();

  // 无参数时获取授权链接
  if (!authUrl) {
    const res = await api.getWechatOAuthAuth(userId);

    if (!res || (res as any).code !== 0 || !(res as any).login_url) {
      await reply(msg, '获取微信授权链接失败，请稍后重试');
      return true;
    }

    const helpMsg = [
      '【微信 OAuth 授权登录教程】',
      `1. 微信内打开链接：${(res as any).login_url}`,
      '2. 点击登录',
      '3. 登录成功后，点击右上角，选择复制链接',
      '4. 返回聊天界面，发送：三角洲微信授权登录 <刚刚复制的链接>',
    ].join('\n');
    await reply(msg, helpMsg);
    return true;
  }

  // 提交授权 URL
  await reply(msg, '正在处理微信授权信息...');

  const res = await api.submitWechatOAuthAuth(authUrl);

  if (!res || (res as any).code !== 0) {
    await reply(msg, `微信授权登录失败: ${(res as any)?.msg || (res as any)?.message || '未知错误'}`);
    return true;
  }

  const frameworkToken = (res as any).frameworkToken;
  if (!frameworkToken) {
    await reply(msg, '微信授权登录失败: 未获取到有效 Token');
    return true;
  }

  // 绑定用户
  const config = pluginState.getConfig();
  if (config.clientID && config.clientID !== 'xxxxxx') {
    await api.bindUser({
      frameworkToken,
      platformID: userId,
      clientID: config.clientID,
      clientType: 'napcat',
    });
  }

  pluginState.setActiveToken(userId, frameworkToken);
  await reply(msg, '微信 OAuth 授权登录成功！Token 已自动绑定');
  return true;
}

/** 绑定角色 */
export async function bindCharacter (ctx: NapCatPluginContext, msg: OB11Message): Promise<boolean> {
  const api = createApi();
  const userId = getUserId(msg);
  const token = await getAccount(userId);

  if (!token) {
    await reply(msg, '您尚未绑定账号，请先使用 三角洲登录 进行登录');
    return true;
  }

  await reply(msg, '正在获取角色列表...');

  const result = await api.bindCharacter(token);

  if (!result || !(result as any).success) {
    await reply(msg, `绑定失败: ${(result as any)?.message || '未知错误'}`);
    return true;
  }

  await reply(msg, '角色绑定成功！');
  return true;
}

export default {
  commands,
  login,
  cookieLogin,
  qqOAuthLogin,
  wechatOAuthLogin,
  webLogin,
  bindCharacter,
};

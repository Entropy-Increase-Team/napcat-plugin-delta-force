/**
 * 配置 UI 定义
 * 参考原插件 guoba.support.js
 */

import type { NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin-manger';

/** 初始化配置 UI */
export function initConfigUI (ctx: NapCatPluginContext): PluginConfigSchema {
  const C = ctx.NapCatConfig;
  if (!C) return [];

  return C.combine(
    // 标题大框
    C.html(`
      <div style="padding: 16px; background: linear-gradient(135deg, rgba(249,115,22,0.1), rgba(43,52,61,0.1)); border: 1px solid rgba(249,115,22,0.3); border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.04); font-family: system-ui, -apple-system, sans-serif;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
          <div style="width: 36px; height: 36px; background: rgba(249,115,22,0.2); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #F97316; flex-shrink: 0; font-size: 20px;">
            🎮
          </div>
          <div>
            <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #374151;">三角洲行动插件 v1.0.0</h3>
            <p style="margin: 2px 0 0; font-size: 12px; color: #9ca3af;">napcat-plugin-delta-force | 作者: 冷曦</p>
          </div>
        </div>
        <p style="margin: 0 0 4px; font-size: 13px; color: #6b7280; line-height: 1.5;">
          发送 <code style="background: rgba(249,115,22,0.2); padding: 2px 6px; border-radius: 4px; color: #F97316;">三角洲帮助</code> 查看指令 | 
          插件反馈群: <span style="color: #F97316; font-weight: 500;">1085402468</span> | 
          API交流群: <span style="color: #F97316; font-weight: 500;">932459332</span>
        </p>
      </div>
    `),

    // ==================== 必填配置 ====================
    C.html(`
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <b style="color: #F97316;">📡 必填配置</b>
        <a href="https://df.shallow.ink/" target="_blank" style="font-size: 12px; color: #F97316; text-decoration: none; padding: 4px 10px; background: rgba(249,115,22,0.1); border-radius: 6px; border: 1px solid rgba(249,115,22,0.3); transition: all 0.2s;">
          🔗 前往 Delta Force API 注册
        </a>
      </div>
    `),
    C.text('api_key', 'API 密钥', '', '在 https://df.shallow.ink/api-keys 获取'),
    C.text('clientID', '客户端 ID', '', '在 https://df.shallow.ink/profile 获取（用户ID）'),

    // 提示信息
    C.html(`
      <div style="padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; margin-top: 16px; display: flex; gap: 10px; align-items: center; font-family: system-ui, -apple-system, sans-serif;">
        <div style="color: #6b7280; flex-shrink: 0;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        </div>
        <div style="font-size: 13px; color: #4b5563;">
          更多高级配置（定时推送、TTS语音、广播通知等）请前往 
          <a href="#" onclick="window.open(window.location.origin + '/plugin/napcat-plugin-delta-force/page/config', '_blank'); return false;" style="color: #F97316; text-decoration: none; font-weight: 600; transition: opacity 0.2s;">WebUI 控制台</a> 
          进行管理。
        </div>
      </div>
    `)
  );
}

export default { initConfigUI };

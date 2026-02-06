/**
 * WebSocket 管理器
 * 负责与 Delta Force API 的 WebSocket 连接管理
 */

import { EventEmitter } from 'events';
import { pluginState } from '../core/state';
import { apiUrlManager } from '../core/api';
import { logger } from '../utils/logger';

/** WebSocket 连接状态 */
interface ConnectionInfo {
  clientId?: string;
  boundClientId?: string;
  clientType?: string;
}

/** WebSocket 连接选项 */
interface ConnectOptions {
  clientID?: string;
  platformID?: string;
  clientType?: string;
}

/** WebSocket 管理器 */
class WebSocketManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private isConnecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;
  private heartbeatInterval = 30000;
  private subscriptions = new Set<string>();
  private availableChannels: string[] = [];
  private connectionInfo: ConnectionInfo = {};
  private lastConnectOptions: ConnectOptions | null = null;
  private connectionPromiseResolve: ((value: boolean) => void) | null = null;
  private connectionPromiseReject: ((reason: Error) => void) | null = null;
  private messageHandlers = new Map<string, (message: any) => void>();

  constructor () {
    super();
    this.registerDefaultHandlers();
  }

  /** 注册默认消息处理器 */
  private registerDefaultHandlers (): void {
    this.messageHandlers.set('connected', this.handleConnected.bind(this));
    this.messageHandlers.set('subscribed', this.handleSubscribed.bind(this));
    this.messageHandlers.set('unsubscribed', this.handleUnsubscribed.bind(this));
    this.messageHandlers.set('error', this.handleError.bind(this));
    this.messageHandlers.set('pong', this.handlePong.bind(this));
    this.messageHandlers.set('price_update', this.handlePriceUpdate.bind(this));
    this.messageHandlers.set('message', this.handleMessage.bind(this));
  }

  /** 连接到 WebSocket 服务器 */
  async connect (options: ConnectOptions = {}): Promise<boolean> {
    if (this.isConnected || this.isConnecting) {
      logger.warn('WebSocket 已经连接或正在连接中');
      return false;
    }

    const apiKey = pluginState.config.api_key;
    if (!apiKey || apiKey === 'sk-xxxxxxx') {
      logger.error('WebSocket: API Key 未配置');
      return false;
    }

    const clientID = options.clientID || pluginState.config.clientID;
    if (!clientID) {
      logger.error('WebSocket: clientID 未提供');
      return false;
    }

    this.lastConnectOptions = options;
    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      this.connectionPromiseResolve = resolve;
      this.connectionPromiseReject = reject;

      try {
        const baseUrl = apiUrlManager.getWebSocketUrl();
        const params = new URLSearchParams({
          key: apiKey,
          clientID: clientID,
        });

        if (options.platformID) params.append('platformID', options.platformID);
        params.append('clientType', options.clientType || 'bot');

        const wsUrl = `${baseUrl}?${params.toString()}`;
        logger.ws('正在连接...');

        this.ws = new WebSocket(wsUrl);
        this.ws.onopen = this.onOpen.bind(this);
        this.ws.onmessage = this.onMessage.bind(this);
        this.ws.onclose = this.onClose.bind(this);
        this.ws.onerror = this.onError.bind(this);

        // 10秒超时
        setTimeout(() => {
          if (this.isConnecting && !this.isConnected) {
            logger.error('WebSocket 连接超时');
            this.isConnecting = false;
            if (this.ws) this.ws.close();
            if (this.connectionPromiseReject) {
              this.connectionPromiseReject(new Error('连接超时'));
              this.connectionPromiseReject = null;
              this.connectionPromiseResolve = null;
            }
          }
        }, 10000);
      } catch (error: any) {
        logger.error('WebSocket 连接失败:', error);
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /** 断开连接 */
  disconnect (preventReconnect = true): void {
    if (preventReconnect) {
      this.clearReconnectTimer();
      this.reconnectAttempts = 0;
    }
    this.clearHeartbeatTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
    this.subscriptions.clear();

    if (this.connectionPromiseReject) {
      this.connectionPromiseReject(new Error('连接已断开'));
      this.connectionPromiseReject = null;
      this.connectionPromiseResolve = null;
    }

    logger.ws('已断开连接');
    this.emit('disconnected');
  }

  /** 发送消息 */
  send (data: object): boolean {
    if (!this.isConnected || !this.ws) {
      logger.warn('WebSocket 未连接，无法发送消息');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(data));
      return true;
    } catch (error) {
      logger.error('WebSocket 发送消息失败:', error);
      return false;
    }
  }

  /** 订阅频道 */
  subscribe (channels: string | string[], platformId?: string): boolean {
    if (!this.isConnected) {
      logger.warn('WebSocket 未连接，无法订阅频道');
      return false;
    }

    const message: any = { type: 'subscribe' };
    if (Array.isArray(channels)) {
      message.channels = channels;
    } else {
      message.channel = channels;
    }
    if (platformId) message.platformId = platformId;

    const sent = this.send(message);
    if (sent) {
      const channelList = Array.isArray(channels) ? channels : [channels];
      channelList.forEach(ch => this.subscriptions.add(ch));
      logger.ws(`已发送订阅请求: ${channelList.join(', ')}`);
    }
    return sent;
  }

  /** 取消订阅频道 */
  unsubscribe (channels: string | string[]): boolean {
    if (!this.isConnected) return false;

    const message: any = { type: 'unsubscribe' };
    if (Array.isArray(channels)) {
      message.channels = channels;
    } else {
      message.channel = channels;
    }

    const sent = this.send(message);
    if (sent) {
      const channelList = Array.isArray(channels) ? channels : [channels];
      channelList.forEach(ch => this.subscriptions.delete(ch));
    }
    return sent;
  }

  /** 发送心跳 */
  sendPing (): boolean {
    return this.send({ type: 'ping' });
  }

  /** 获取当前订阅的频道列表 */
  getSubscriptions (): string[] {
    return Array.from(this.subscriptions);
  }

  /** 获取连接状态 */
  getStatus (): { isConnected: boolean; isConnecting: boolean; subscriptions: string[]; availableChannels: string[]; connectionInfo: ConnectionInfo } {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      subscriptions: this.getSubscriptions(),
      availableChannels: this.availableChannels,
      connectionInfo: this.connectionInfo,
    };
  }

  // ==================== 事件处理器 ====================

  private onOpen (): void {
    logger.ws('连接已建立');
    this.isConnected = true;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.startHeartbeat();
    this.emit('connected');
  }

  private onMessage (event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);
      const { type } = message;
      pluginState.logDebug(`WebSocket 收到消息: ${type}`);

      this.emit('message', message);

      const handler = this.messageHandlers.get(type);
      if (handler) {
        handler(message);
      } else {
        this.emit('unknown_message', message);
      }
    } catch (error) {
      logger.error('WebSocket 解析消息失败:', error);
    }
  }

  private onClose (event: CloseEvent): void {
    logger.warn(`WebSocket 连接已关闭 [${event.code}] ${event.reason}`);
    this.isConnected = false;
    this.isConnecting = false;
    this.subscriptions.clear();
    this.clearHeartbeatTimer();
    this.emit('closed', { code: event.code, reason: event.reason });

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      logger.error('WebSocket 已达到最大重连次数，停止重连');
    }
  }

  private onError (event: Event): void {
    logger.error('WebSocket 发生错误');
    this.emit('error', event);

    if (this.isConnecting && this.connectionPromiseReject) {
      this.connectionPromiseReject(new Error('WebSocket 连接错误'));
      this.connectionPromiseReject = null;
      this.connectionPromiseResolve = null;
      this.isConnecting = false;
    }
  }

  // ==================== 消息处理器 ====================

  private handleConnected (message: any): void {
    const { data } = message;
    this.connectionInfo = {
      clientId: data.clientId,
      boundClientId: data.boundClientId,
      clientType: data.clientType,
    };
    this.availableChannels = data.availableChannels || [];
    logger.ws(`连接成功，可用频道: ${this.availableChannels.length}`);

    if (this.connectionPromiseResolve) {
      this.connectionPromiseResolve(true);
      this.connectionPromiseResolve = null;
      this.connectionPromiseReject = null;
    }
    this.emit('ready', data);
  }

  private handleSubscribed (message: any): void {
    const { channel, data } = message;
    logger.ws(`订阅成功: ${channel}`);
    this.emit('subscribed', { channel, data });
  }

  private handleUnsubscribed (message: any): void {
    const { channel, data } = message;
    logger.ws(`取消订阅成功: ${channel}`);
    this.emit('unsubscribed', { channel, data });
  }

  private handleError (message: any): void {
    const { data } = message;
    logger.error(`WebSocket 服务器错误 [${data.code}]: ${data.message}`);
    this.emit('server_error', data);
  }

  private handlePong (_message: any): void {
    pluginState.logDebug('WebSocket 收到应用层 pong');
    this.emit('pong');
  }

  private handlePriceUpdate (message: any): void {
    const { channel, data } = message;
    pluginState.logDebug(`WebSocket 价格更新: ${channel}`);
    this.emit('price_update', { channel, data });
  }

  private handleMessage (message: any): void {
    const { data } = message;
    if (data?.messageType) {
      this.emit(data.messageType, data);
    }
  }

  // ==================== 心跳和重连机制 ====================

  private startHeartbeat (): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) this.sendPing();
    }, this.heartbeatInterval);
  }

  private clearHeartbeatTimer (): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect (): void {
    this.clearReconnectTimer();
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 15000);
    logger.ws(`${Math.round(delay / 1000)}秒后尝试第${this.reconnectAttempts}次重连...`);

    this.reconnectTimer = setTimeout(async () => {
      logger.ws(`开始第${this.reconnectAttempts}次重连`);
      try {
        await this.connect(this.lastConnectOptions || {});
      } catch (error: any) {
        logger.error('WebSocket 重连失败:', error.message);
      }
    }, delay);
  }

  private clearReconnectTimer (): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/** 全局单例 */
let wsManager: WebSocketManager | null = null;

/** 获取 WebSocket 管理器实例 */
export function getWebSocketManager (): WebSocketManager {
  if (!wsManager) {
    wsManager = new WebSocketManager();
  }
  return wsManager;
}

export { WebSocketManager };

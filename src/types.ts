export type ProcessHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'idle';

export interface Bot {
  id: string;
  name: string;
  filename: string;
  language: 'python' | 'node';
  status: 'running' | 'stopped' | 'crashed';
  path: string;
  entryPoint: string;
  dependencies: string[];
  created: string;
  uptime: number; // Start timestamp (ms) of current running session
  error?: string;
  env?: Record<string, string>;
  pid?: number;
  memoryMB?: number;
  cpuPercent?: number;
  restarts?: number;
  health?: ProcessHealthStatus;
  healthMessage?: string;
  deploymentDurationSeconds?: number;
  sessionUptimeSeconds?: number;
  ownerId?: number | string;
  ownerUsername?: string;
}

export interface Stats {
  totalBots: number;
  activeBots: number;
  stoppedBots: number;
  crashedBots: number;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  systemLoad: number[];
  uptime: number; // Server uptime in seconds
  processMetrics?: {
    activePids: number;
    totalBotMemoryMB: number;
    avgCpuPercent: number;
  };
}

export interface BotInfo {
  ok: boolean;
  result?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username: string;
    can_join_groups: boolean;
    can_read_all_group_messages: boolean;
    supports_inline_queries: boolean;
  };
}

export interface RenderStatus {
  renderReady: boolean;
  serviceType: string;
  nodeVersion: string;
  port: number;
  environment: string;
  pythonAvailable: boolean;
  pythonVersion: string;
  pipAvailable: boolean;
  persistentStorage: {
    path: string;
    configured: boolean;
    activeDeployments: number;
  };
  suggestedHealthCheck: string;
  uptimeSeconds: number;
  timestamp: string;
}

export interface RenderConfig {
  renderYaml: string;
  dockerfile: string;
  renderBuildSh: string;
  docsUrl: string;
  defaultBuildCommand: string;
  defaultStartCommand: string;
  defaultHealthCheck: string;
}



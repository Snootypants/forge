import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { saveEnvValue } from '../config.ts';

export type AuthStatus = 'authenticated' | 'not_authenticated' | 'checking' | 'error';

export interface AuthState {
  claude: AuthStatus;
  slack: AuthStatus;
  openai: AuthStatus;
}

export function checkClaudeAuth(): AuthStatus {
  const claudeDir = path.join(process.env.HOME ?? '/root', '.claude');
  if (!fs.existsSync(claudeDir)) return 'not_authenticated';

  const credFiles = ['credentials.json', '.credentials.json', 'settings.json'];
  for (const f of credFiles) {
    const fp = path.join(claudeDir, f);
    if (fs.existsSync(fp)) {
      try {
        const content = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        if (content.oauthAccount || content.claudeAiOauth) return 'authenticated';
      } catch {
        continue;
      }
    }
  }
  return 'not_authenticated';
}

export function checkSlackAuth(): AuthStatus {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (botToken && appToken) return 'authenticated';
  return 'not_authenticated';
}

export function checkOpenAIAuth(): AuthStatus {
  if (process.env.OPENAI_API_KEY) return 'authenticated';
  return 'not_authenticated';
}

export function getAuthState(): AuthState {
  return {
    claude: checkClaudeAuth(),
    slack: checkSlackAuth(),
    openai: checkOpenAIAuth(),
  };
}

export function startClaudeOAuth(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['auth', 'login'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr || `Exit code ${code}` });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ success: false, error: 'OAuth flow timed out (5 min)' });
    }, 300_000);
  });
}

export function saveSlackTokens(botToken: string, appToken: string, envPath?: string): void {
  saveEnvValue('SLACK_BOT_TOKEN', botToken, envPath);
  saveEnvValue('SLACK_APP_TOKEN', appToken, envPath);
  process.env.SLACK_BOT_TOKEN = botToken;
  process.env.SLACK_APP_TOKEN = appToken;
}

export function saveOpenAIKey(apiKey: string, envPath?: string): void {
  saveEnvValue('OPENAI_API_KEY', apiKey, envPath);
  process.env.OPENAI_API_KEY = apiKey;
}

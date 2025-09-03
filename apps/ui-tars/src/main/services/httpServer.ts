/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import http from 'node:http';
import { URL } from 'node:url';

import { logger } from '@main/logger';
import { store } from '@main/store/create';
import { sanitizeState } from '@main/utils/sanitizeState';
import { runAgent } from '@main/services/runAgent';
import { GUIAgent } from '@ui-tars/sdk';
import { GUIAgentManager } from '@main/ipcRoutes/agent';
import {
  StatusEnum,
  type Conversation,
  type Message,
} from '@ui-tars/shared/types';

let server: http.Server | null = null;
let boundPort: number | null = null;

const getAuthToken = (): string | undefined => {
  return process.env.UI_TARS_API_TOKEN || undefined;
};

const writeJson = (
  res: http.ServerResponse,
  statusCode: number,
  body: unknown,
) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

const readJson = async <T = any>(
  req: http.IncomingMessage,
): Promise<T | null> => {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      if (!chunks.length) {
        resolve(null);
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(raw));
      } catch (e) {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
};

const ensureCors = (req: http.IncomingMessage, res: http.ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With',
  );
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
};

const ensureAuth = (req: http.IncomingMessage): boolean => {
  const token = getAuthToken();
  if (!token) return true;
  const auth = req.headers['authorization'] || '';
  const prefix = 'Bearer ';
  if (typeof auth === 'string' && auth.startsWith(prefix)) {
    const provided = auth.slice(prefix.length).trim();
    return provided === token;
  }
  return false;
};

export const startHttpApiServer = async (
  port: number | undefined = undefined,
) => {
  if (server) {
    logger.warn('[httpServer] already started on port', boundPort);
    return { port: boundPort, token: getAuthToken() } as const;
  }

  server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        writeJson(res, 404, { ok: false, error: 'not_found' });
        return;
      }

      if (ensureCors(req, res)) return;

      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;

      if (!ensureAuth(req)) {
        writeJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      if (req.method === 'GET' && pathname === '/healthz') {
        writeJson(res, 200, { ok: true, status: 'healthy' });
        return;
      }

      if (req.method === 'GET' && pathname === '/state') {
        const state = sanitizeState(store.getState());
        writeJson(res, 200, { ok: true, data: state });
        return;
      }

      if (pathname === '/agent/run') {
        const { thinking } = store.getState();
        if (thinking) {
          writeJson(res, 409, { ok: false, error: 'already_running' });
          return;
        }
        store.setState({
          abortController: new AbortController(),
          thinking: true,
          errorMsg: null,
        });
        // fire-and-forget
        runAgent(store.setState, store.getState)
          .catch((e) => logger.error('[httpServer.runAgent] error', e))
          .finally(() => store.setState({ thinking: false }));
        writeJson(res, 202, { ok: true });
        return;
      }

      if (pathname === '/agent/stop') {
        const { abortController } = store.getState();
        store.setState({ status: StatusEnum.END, thinking: false });
        abortController?.abort();
        const agent = GUIAgentManager.getInstance().getAgent();
        if (agent instanceof GUIAgent) {
          try {
            agent.resume();
            agent.stop();
          } catch {}
        }
        writeJson(res, 200, { ok: true });
        return;
      }

      if (pathname === '/agent/pause') {
        const agent = GUIAgentManager.getInstance().getAgent();
        if (agent instanceof GUIAgent) {
          agent.pause();
          store.setState({ thinking: false });
        }
        writeJson(res, 200, { ok: true });
        return;
      }

      if (pathname === '/agent/resume') {
        const agent = GUIAgentManager.getInstance().getAgent();
        if (agent instanceof GUIAgent) {
          agent.resume();
          store.setState({ thinking: false });
        }
        writeJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && pathname === '/agent/instructions') {
        const body = (await readJson<{ instructions?: string }>(req)) || {};
        if (!body.instructions || typeof body.instructions !== 'string') {
          writeJson(res, 400, { ok: false, error: 'invalid_instructions' });
          return;
        }
        store.setState({ instructions: body.instructions });
        writeJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && pathname === '/agent/messages') {
        const body = (await readJson<{ messages?: Conversation[] }>(req)) || {};
        if (!Array.isArray(body.messages)) {
          writeJson(res, 400, { ok: false, error: 'invalid_messages' });
          return;
        }
        store.setState({ messages: body.messages });
        writeJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && pathname === '/agent/sessionHistory') {
        const body = (await readJson<{ messages?: Message[] }>(req)) || {};
        if (!Array.isArray(body.messages)) {
          writeJson(res, 400, { ok: false, error: 'invalid_messages' });
          return;
        }
        store.setState({ sessionHistoryMessages: body.messages });
        writeJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && pathname === '/agent/clear') {
        store.setState({
          status: StatusEnum.END,
          messages: [],
          thinking: false,
          errorMsg: null,
          instructions: '',
        });
        writeJson(res, 200, { ok: true });
        return;
      }

      writeJson(res, 404, { ok: false, error: 'not_found' });
    } catch (e) {
      logger.error('[httpServer] request error', e);
      writeJson(res, 500, { ok: false, error: 'internal_error' });
    }
  });

  const listenPort = Number.isInteger(port as number)
    ? (port as number)
    : Number.parseInt(process.env.UI_TARS_API_PORT || '10086', 10);

  await new Promise<void>((resolve) => {
    server!.listen(listenPort, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : listenPort;
  boundPort = actualPort;
  logger.info('[httpServer] started at http://127.0.0.1:' + actualPort);
  if (getAuthToken()) {
    logger.info('[httpServer] auth: Bearer token is enabled');
  } else {
    logger.warn('[httpServer] auth: no token set (UI_TARS_API_TOKEN)');
  }

  return { port: actualPort, token: getAuthToken() } as const;
};

export const stopHttpApiServer = async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  boundPort = null;
  logger.info('[httpServer] stopped');
};

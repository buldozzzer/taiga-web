import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {type ShareConfig, linkErrorText, toCoreLink, fromCoreLink} from '../shared/model.js';
import {env} from './env.js';

/** The core, made executable when a checkout lost the bit; null when there is none. */
export function corePath(): string | null {
  if (!fs.existsSync(env.core)) return null;
  try {
    fs.accessSync(env.core, fs.constants.X_OK);
  } catch {
    try {
      fs.chmodSync(env.core, 0o755);
    } catch {
      return null;
    }
  }
  return env.core;
}

export function coreVersion(): string {
  try {
    return fs.readFileSync(path.join(path.dirname(env.core), 'taiga-core.version'), 'utf8').trim();
  } catch {
    return corePath() ? 'версия неизвестна' : 'не найдено';
  }
}

interface LinkResult {
  config?: ShareConfig;
  link?: string;
  error?: string;
  code?: string;
  param?: string;
}

/**
 * The core's `--parse-link -` / `--make-link -`: the link or config goes in
 * on stdin (it carries the key, never on the command line).
 */
function coreLinks(command: '--parse-link' | '--make-link', input: string): Promise<LinkResult> {
  const core = corePath();
  if (!core) return Promise.reject(new Error(`Не найдено ядро: ${env.core}`));
  return new Promise((resolve, reject) => {
    const child = execFile(core, [command, '-'], {timeout: 15000, encoding: 'utf8'}, (error, stdout) => {
      // The core exits non-zero for a refused link but still answers on stdout.
      if (!stdout?.trim()) return reject(error ?? new Error('Ядро не ответило'));
      let r: LinkResult;
      try {
        r = JSON.parse(stdout.trim());
      } catch {
        return reject(new Error('Ядро не умеет работать со ссылками, обновите его'));
      }
      if (r.error || r.code) return reject(new Error(linkErrorText(r.code ?? '', r.param, r.error)));
      resolve(r);
    });
    child.stdin?.end(input, 'utf8');
  });
}

export async function readLink(link: string): Promise<ShareConfig> {
  const r = await coreLinks('--parse-link', toCoreLink(link));
  if (!r.config) throw new Error(linkErrorText('', '', 'ядро не вернуло настройки'));
  return r.config;
}

export async function makeLink(config: ShareConfig): Promise<string> {
  const r = await coreLinks('--make-link', JSON.stringify(config));
  if (!r.link) throw new Error(linkErrorText('', '', 'ядро не вернуло ссылку'));
  return fromCoreLink(r.link);
}

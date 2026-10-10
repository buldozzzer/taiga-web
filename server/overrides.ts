// Every setting of the Settings page and the sync template can come from .env
// instead: such a value wins over the saved one, is never written to db.json,
// and the page shows it locked. An empty variable counts as not set.

import fs from 'node:fs';
import {siteUrl, telegramUrl} from '../shared/model.js';
import type {RemnawaveSyncTemplate} from '../shared/panel.js';
// .env is read there, before the variables below.
import './env.js';
import {panelUrl} from './remnawave.js';
import {readSshKey} from './sshkey.js';

export interface SettingsOverrides {
  yandexToken?: string;
  docsFolder?: string;
  remnawaveUrl?: string;
  remnawaveToken?: string;
  sshPrivateKey?: string;
  sshPassphrase?: string;
  sshUser?: string;
}

/** The sync template's fields; nodes as the .env names them (ids or names), resolved on reading. */
export type SyncOverrides = Partial<Omit<RemnawaveSyncTemplate, 'nodeIds'>> & {nodes?: string[]};

/** Which variable sets which setting: the page names it on a locked field. */
export const SETTINGS_VARS: Record<keyof SettingsOverrides, string> = {
  yandexToken: 'YANDEX_TOKEN',
  docsFolder: 'YANDEX_DOCS_FOLDER',
  remnawaveUrl: 'REMNAWAVE_URL',
  remnawaveToken: 'REMNAWAVE_TOKEN',
  sshPrivateKey: process.env.SSH_PRIVATE_KEY_FILE?.trim() ? 'SSH_PRIVATE_KEY_FILE' : 'SSH_PRIVATE_KEY',
  sshPassphrase: 'SSH_PASSPHRASE',
  sshUser: 'SSH_USER',
};

export const SYNC_VARS: Record<keyof RemnawaveSyncTemplate, string> = {
  enabled: 'REMNAWAVE_SYNC',
  name: 'SYNC_NAME',
  telegram: 'SYNC_TELEGRAM',
  site: 'SYNC_SITE',
  message: 'SYNC_MESSAGE',
  nodeIds: 'SYNC_NODES',
};

const read = (name: string) => {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
};

/** A key in .env: PEM with "\n" for line breaks, the key file in base64, or SSH_PRIVATE_KEY_FILE with its path. */
function sshKeyFromEnv(): string | undefined {
  const file = read('SSH_PRIVATE_KEY_FILE');
  if (file) {
    try {
      return `${fs.readFileSync(file, 'utf8').trim()}\n`;
    } catch (e) {
      throw new Error(`SSH_PRIVATE_KEY_FILE: не удалось прочитать ${file}: ${(e as Error).message}`);
    }
  }
  const v = read('SSH_PRIVATE_KEY');
  if (!v) return undefined;
  if (v.includes('-----BEGIN')) return `${v.replace(/\\n/g, '\n').trim()}\n`;
  const decoded = Buffer.from(v, 'base64').toString('utf8');
  if (!decoded.includes('-----BEGIN')) throw new Error('SSH_PRIVATE_KEY: нужен ключ PEM с \\n вместо переносов или файл ключа в base64');
  return `${decoded.trim()}\n`;
}

function flag(name: string): boolean | undefined {
  const v = read(name);
  if (v === undefined) return undefined;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|no|off)$/i.test(v)) return false;
  throw new Error(`${name}: нужно 1 или 0`);
}

function load(): {settings: SettingsOverrides; sync: SyncOverrides} {
  const settings: SettingsOverrides = {};
  const set = <K extends keyof SettingsOverrides>(k: K, v: SettingsOverrides[K]) => v !== undefined && (settings[k] = v);

  set('yandexToken', read('YANDEX_TOKEN'));
  const folder = read('YANDEX_DOCS_FOLDER');
  if (folder && !/^disk:\/[^\0]*$/.test(folder)) throw new Error('YANDEX_DOCS_FOLDER: папка вида disk:/Taiga');
  set('docsFolder', folder?.replace(/\/+$/, ''));
  const url = read('REMNAWAVE_URL');
  try {
    set('remnawaveUrl', url && panelUrl(url));
  } catch (e) {
    throw new Error(`REMNAWAVE_URL: ${(e as Error).message}`);
  }
  set('remnawaveToken', read('REMNAWAVE_TOKEN'));
  set('sshPrivateKey', sshKeyFromEnv());
  set('sshPassphrase', read('SSH_PASSPHRASE'));
  const user = read('SSH_USER');
  if (user && !/^[a-z_][a-z0-9_.-]*\$?$/i.test(user)) throw new Error('SSH_USER: логин вида root или ubuntu');
  set('sshUser', user);
  if (settings.sshPrivateKey) {
    try {
      readSshKey(settings.sshPrivateKey, settings.sshPassphrase ?? '');
    } catch (e) {
      throw new Error(`SSH_PRIVATE_KEY: ${(e as Error).message}`);
    }
  }

  const sync: SyncOverrides = {};
  const enabled = flag('REMNAWAVE_SYNC');
  if (enabled !== undefined) sync.enabled = enabled;
  const name = read('SYNC_NAME');
  if (name) sync.name = name.slice(0, 80);
  const telegram = read('SYNC_TELEGRAM');
  if (telegram && !telegramUrl(telegram)) throw new Error('SYNC_TELEGRAM: @канал или ссылка t.me');
  if (telegram) sync.telegram = telegram;
  const site = read('SYNC_SITE');
  if (site && !siteUrl(site)) throw new Error('SYNC_SITE: только https');
  if (site) sync.site = site;
  const message = read('SYNC_MESSAGE');
  if (message) sync.message = message.replace(/\\n/g, '\n').slice(0, 600);
  const nodes = read('SYNC_NODES');
  if (nodes) sync.nodes = nodes.split(',').map(s => s.trim()).filter(Boolean);
  return {settings, sync};
}

export const overrides = (() => {
  try {
    return load();
  } catch (e) {
    console.error(`.env: ${(e as Error).message}`);
    process.exit(1);
  }
})();

/** The settings .env sets, by their names on the page. */
export const settingsFromEnv = Object.keys(overrides.settings) as (keyof SettingsOverrides)[];
export const syncFromEnv = (Object.keys(overrides.sync) as (keyof SyncOverrides)[]).map(k => (k === 'nodes' ? 'nodeIds' : k)) as (keyof RemnawaveSyncTemplate)[];

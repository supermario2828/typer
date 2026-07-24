// Storage abstraction. The game talks to a StatsStore interface; today it's
// backed by localStorage, tomorrow by Firebase. To switch, implement the same
// async methods and swap the export at the bottom — nothing else changes.
//
// Interface (all async so a network backend is a drop-in):
//   getMachineId()                      -> string
//   listUsers()                         -> [{ id, name, createdAt }]
//   createUser(name)                    -> user
//   deleteUser(id)                      -> void
//   getRuns(userId)                     -> [run]
//   addRun(userId, run)                 -> run (with id)
//   clearRuns(userId)                   -> void

const KEY = 'typer.v1';

function uid() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

export class LocalStatsStore {
  constructor(storage = globalThis.localStorage) {
    this.ls = storage;
  }

  _read() {
    try {
      return JSON.parse(this.ls.getItem(KEY)) || {};
    } catch {
      return {};
    }
  }

  _write(data) {
    this.ls.setItem(KEY, JSON.stringify(data));
  }

  async getMachineId() {
    const data = this._read();
    if (!data.machineId) {
      // A stable per-browser/per-machine id. Different keyboards => different
      // machines => separate stats, exactly as requested.
      data.machineId = 'm_' + uid();
      this._write(data);
    }
    return data.machineId;
  }

  async listUsers() {
    const data = this._read();
    return data.users || [];
  }

  async createUser(name) {
    const data = this._read();
    data.users = data.users || [];
    const user = { id: 'u_' + uid(), name: name.trim() || 'Guest', createdAt: Date.now() };
    data.users.push(user);
    data.runs = data.runs || {};
    data.runs[user.id] = [];
    this._write(data);
    return user;
  }

  async deleteUser(id) {
    const data = this._read();
    data.users = (data.users || []).filter((u) => u.id !== id);
    if (data.runs) delete data.runs[id];
    this._write(data);
  }

  async getRuns(userId) {
    const data = this._read();
    return (data.runs && data.runs[userId]) || [];
  }

  async addRun(userId, run) {
    const data = this._read();
    data.runs = data.runs || {};
    data.runs[userId] = data.runs[userId] || [];
    const stored = { id: 'r_' + uid(), ...run };
    data.runs[userId].push(stored);
    // Keep history bounded so localStorage never blows up.
    if (data.runs[userId].length > 500) data.runs[userId] = data.runs[userId].slice(-500);
    this._write(data);
    return stored;
  }

  async clearRuns(userId) {
    const data = this._read();
    if (data.runs) data.runs[userId] = [];
    this._write(data);
  }
}

// The single place to swap backends. When Firebase is ready:
//   import { FirebaseStatsStore } from './firebaseStore.js';
//   export const store = new FirebaseStatsStore(app);
export const store = new LocalStatsStore();

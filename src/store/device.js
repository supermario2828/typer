// Device identity. Each browser has a stable machineId (from LocalStatsStore);
// on top of that the user can give it a friendly name ("MacBook", "Work PC").
// The name lives locally AND, when signed in, in the user's account keyed by
// machineId — so signing in on the same device recognises it every time.
import { FirebaseStatsStore } from './firebaseStore.js';

const cloud = new FirebaseStatsStore();
const NAME_KEY = 'typer.deviceName';

export const deviceService = {
  machineId: '',
  name: '',

  init(machineId) {
    this.machineId = machineId;
    this.name = localStorage.getItem(NAME_KEY) || '';
  },

  label() {
    return this.name || 'Unnamed device';
  },

  hasName() {
    return !!this.name;
  },

  // Reconcile local ⇄ account when a user signs in.
  //  - account name wins (source of truth across the user's devices)
  //  - if the account has none but this device is named locally, push it up
  async syncOnSignIn(uid) {
    try {
      const remote = await cloud.getDeviceName(uid, this.machineId);
      if (remote) {
        this.name = remote;
        localStorage.setItem(NAME_KEY, remote);
      } else if (this.name) {
        await cloud.setDeviceName(uid, this.machineId, this.name);
      }
    } catch (err) {
      console.warn('device sync failed:', err);
    }
  },

  async setName(name, uid) {
    this.name = name.trim();
    if (this.name) localStorage.setItem(NAME_KEY, this.name);
    else localStorage.removeItem(NAME_KEY);
    if (uid && this.name) {
      try {
        await cloud.setDeviceName(uid, this.machineId, this.name);
      } catch (err) {
        console.warn('could not save device name to account:', err);
      }
    }
  },
};

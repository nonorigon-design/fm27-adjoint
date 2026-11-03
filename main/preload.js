'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('adjoint', {
  info: invoke('app:info'),
  settings: { get: invoke('settings:get'), set: invoke('settings:set') },
  key: { status: invoke('key:status'), saveValidated: invoke('key:saveValidated'), forget: invoke('key:forget') },
  gemini: { models: invoke('gemini:models') },
  ollama: { status: invoke('ollama:status'), start: invoke('ollama:start'), install: invoke('ollama:install'), pull: invoke('ollama:pull'), cancelPull: invoke('ollama:cancelPull'), onProgress: listen('ollama:progress') },
  hardware: invoke('hardware:detect'),
  capture: {
    windows: invoke('capture:windows'), screens: invoke('capture:screens'),
    window: invoke('capture:window'), screen: invoke('capture:screen'), fm: invoke('capture:fm'),
    importFiles: invoke('capture:import'), remove: invoke('capture:remove'), clear: invoke('capture:clear'),
    onAdded: listen('capture:added'), onError: listen('capture:error'),
  },
  watch: { set: invoke('watch:set'), adopt: invoke('watch:adopt'), onChange: listen('watch:changed') },
  shortcut: { set: invoke('shortcut:set') },
  analyze: invoke('analyze:run'),
  cancelAnalyze: invoke('analyze:cancel'),
  history: {
    careers: invoke('history:careers'), reports: invoke('history:reports'), messages: invoke('history:messages'),
    changes: invoke('history:changes'), addChange: invoke('history:addChange'), updateChange: invoke('history:updateChange'),
  },
  exportReport: invoke('report:export'),
  update: { check: invoke('update:check'), install: invoke('update:install'), state: invoke('update:state'), onState: listen('update:state') },
  openExternal: invoke('app:openExternal'),
  openLogs: invoke('app:openLogs'),
});

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, listener) => {
  const subscription = (_event, ...args) => listener(...args);
  ipcRenderer.on(channel, subscription);
  return () => ipcRenderer.removeListener(channel, subscription);
};

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: () => invoke('settings:get'),
    save: (settings) => invoke('settings:save', settings)
  },
  invoice: {
    list: (query) => invoke('invoice:list', { query }),
    load: (id) => invoke('invoice:load', id),
    save: (invoice) => invoke('invoice:save', invoice),
    delete: (id) => invoke('invoice:delete', id),
    duplicate: (id, nextNumber) => invoke('invoice:duplicate', { id, nextNumber }),
    nextNumber: () => invoke('invoice:nextNumber')
  },
  pdf: {
    export: (invoice) => invoke('pdf:export', invoice)
  },
  clients: {
    list: (query) => invoke('clients:list', query),
    save: (client) => invoke('clients:save', client),
    delete: (id) => invoke('clients:delete', id)
  },
  profiles: {
    list: (query) => invoke('profiles:list', query),
    save: (profile) => invoke('profiles:save', profile),
    delete: (id) => invoke('profiles:delete', id)
  },
  menu: {
    onNew: (cb) => on('menu:new', cb),
    onOpen: (cb) => on('menu:open', cb),
    onSave: (cb) => on('menu:save', cb),
    onExport: (cb) => on('menu:export', cb),
    onPrint: (cb) => on('menu:print', cb),
    onSettings: (cb) => on('menu:settings', cb),
    onToggleTheme: (cb) => on('menu:toggle-theme', cb)
  }
});



import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// ----- Paths -----
const getUserDataDir = () => app.getPath('userData');
const getInvoicesDir = () => path.join(getUserDataDir(), 'invoices');
const getConfigPath = () => path.join(getUserDataDir(), 'config.json');
const getClientsPath = () => path.join(getUserDataDir(), 'clients.json');
const getProfilesPath = () => path.join(getUserDataDir(), 'profiles.json');

// ----- Domain Models -----
class InvoiceItem {
  constructor({ description = '', quantity = 1, unitPrice = 0 } = {}) {
    this.description = description;
    this.quantity = Number(quantity) || 0;
    this.unitPrice = Number(unitPrice) || 0;
  }
  get lineTotal() {
    return +(this.quantity * this.unitPrice).toFixed(2);
  }
}

class Invoice {
  constructor({
    id = undefined,
    invoiceNumber = '',
    date = new Date().toISOString().slice(0, 10),
    from = { name: '', address: '' },
    billTo = { name: '', address: '' },
    items = [],
    notes = '',
    taxRate = 0,
    currency = '$',
    status = 'open'
  } = {}) {
    this.id = id; // filename without extension
    this.invoiceNumber = invoiceNumber;
    this.date = date;
    this.from = from;
    this.billTo = billTo;
    this.items = items.map((it) => new InvoiceItem(it));
    this.notes = notes;
    this.taxRate = Number(taxRate) || 0;
    this.currency = currency || '$';
    this.status = status || 'open';
  }
  get subTotal() {
    return +this.items.reduce((sum, it) => sum + it.lineTotal, 0).toFixed(2);
  }
  get taxAmount() {
    return +((this.subTotal * this.taxRate) / 100).toFixed(2);
  }
  get total() {
    return +(this.subTotal + this.taxAmount).toFixed(2);
  }
}

// ----- Persistence -----
class SettingsStore {
  constructor(configPath) {
    this.configPath = configPath;
    this.defaultSettings = {
      taxRate: 25,
      currency: '€',
      business: { name: '', address: '' },
      theme: 'light',
      lastInvoiceNumber: 0
    };
  }
  ensureFile() {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(this.configPath, JSON.stringify(this.defaultSettings, null, 2));
    }
  }
  read() {
    try {
      this.ensureFile();
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...this.defaultSettings, ...parsed };
    } catch (err) {
      console.error('Failed to read settings:', err);
      return { ...this.defaultSettings };
    }
  }
  write(settings) {
    try {
      this.ensureFile();
      const merged = { ...this.defaultSettings, ...settings };
      fs.writeFileSync(this.configPath, JSON.stringify(merged, null, 2));
      return merged;
    } catch (err) {
      console.error('Failed to write settings:', err);
      throw err;
    }
  }
}

class InvoiceStore {
  constructor(invoicesDir) {
    this.invoicesDir = invoicesDir;
    if (!fs.existsSync(this.invoicesDir)) {
      fs.mkdirSync(this.invoicesDir, { recursive: true });
    }
  }
  list({ query = '' } = {}) {
    const files = fs.readdirSync(this.invoicesDir).filter((f) => f.endsWith('.json'));
    const items = files.map((file) => {
      const id = path.basename(file, '.json');
      try {
        const raw = fs.readFileSync(path.join(this.invoicesDir, file), 'utf-8');
        const data = JSON.parse(raw);
        return { id, invoiceNumber: data.invoiceNumber, date: data.date, billTo: data.billTo, total: data.total, currency: data.currency, status: data.status || 'open' };
      } catch {
        return { id, invoiceNumber: id, date: '', billTo: { name: '' }, total: 0, currency: '$', status: 'open' };
      }
    });
    if (!query) return items.sort((a, b) => (a.date < b.date ? 1 : -1));
    const lower = query.toLowerCase();
    return items
      .filter((it) =>
        [it.invoiceNumber, it.date, it.billTo?.name].filter(Boolean).some((v) => String(v).toLowerCase().includes(lower))
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  load(id) {
    const file = path.join(this.invoicesDir, `${id}.json`);
    const raw = fs.readFileSync(file, 'utf-8');
    const data = JSON.parse(raw);
    return new Invoice({ id, ...data });
  }
  save(invoice) {
    const id = invoice.id || this.slugify(invoice.invoiceNumber || `invoice-${Date.now()}`);
    const file = path.join(this.invoicesDir, `${id}.json`);
    const withTotals = new Invoice({ ...invoice, id });
    const payload = {
      invoiceNumber: withTotals.invoiceNumber,
      date: withTotals.date,
      from: withTotals.from,
      billTo: withTotals.billTo,
      items: withTotals.items,
      notes: withTotals.notes,
      taxRate: withTotals.taxRate,
      currency: withTotals.currency,
      status: withTotals.status,
      subTotal: withTotals.subTotal,
      taxAmount: withTotals.taxAmount,
      total: withTotals.total
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    return { id, ...payload };
  }
  delete(id) {
    const file = path.join(this.invoicesDir, `${id}.json`);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  duplicate(id, nextNumber) {
    const inv = this.load(id);
    const clone = new Invoice({
      ...inv,
      id: undefined,
      invoiceNumber: nextNumber,
      date: new Date().toISOString().slice(0, 10)
    });
    return this.save(clone);
  }
  slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '')
      .replace(/\-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

// ----- Directory-less Array Stores (Clients / Profiles) -----
class JsonArrayStore {
  constructor(filePath, defaults = []) {
    this.filePath = filePath;
    this.defaults = defaults;
  }
  ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(this.defaults, null, 2));
    }
  }
  readAll() {
    try {
      this.ensureFile();
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.error('Failed to read store', this.filePath, e);
      return [];
    }
  }
  writeAll(items) {
    this.ensureFile();
    fs.writeFileSync(this.filePath, JSON.stringify(items, null, 2));
  }
  upsert(item, getId) {
    const items = this.readAll();
    const id = getId(item);
    const idx = items.findIndex((x) => getId(x) === id);
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...item, id };
    } else {
      items.push({ ...item, id });
    }
    this.writeAll(items);
    return items.find((x) => x.id === id);
  }
  deleteById(id, getId) {
    const items = this.readAll();
    const next = items.filter((x) => getId(x) !== id);
    this.writeAll(next);
  }
}

class ClientsStore extends JsonArrayStore {
  constructor(filePath) {
    super(filePath, []);
  }
  list(query = '') {
    const all = this.readAll();
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter((c) => [c.name, c.email, c.phone, c.address].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }
  save(client) {
    const id = this.slugify(client.id || client.name || `client-${Date.now()}`);
    return this.upsert({ ...client, id }, (x) => x.id);
  }
  delete(id) {
    this.deleteById(id, (x) => x.id);
  }
  slugify(text) {
    return String(text).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '').replace(/\-+/g, '-').replace(/^-+|-+$/g, '');
  }
}

class ProfilesStore extends JsonArrayStore {
  constructor(filePath) {
    super(filePath, []);
  }
  list(query = '') {
    const all = this.readAll();
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter((p) => [p.name, p.email, p.phone, p.address].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }
  save(profile) {
    const id = this.slugify(profile.id || profile.name || `profile-${Date.now()}`);
    return this.upsert({ ...profile, id }, (x) => x.id);
  }
  delete(id) {
    this.deleteById(id, (x) => x.id);
  }
  slugify(text) {
    return String(text).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '').replace(/\-+/g, '-').replace(/^-+|-+$/g, '');
  }
}

// ----- PDF Generation -----
import { jsPDF } from 'jspdf';
// Register jspdf-autotable plugin on jsPDF instance
import 'jspdf-autotable';

class PdfService {
  static async exportInvoice(invoice, outputPath) {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 40;
    const lineHeight = 18;
    const bold = (txt, size = 12) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(size);
      doc.text(txt, margin, doc.getLineHeight());
    };
    let y = margin;

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.text('INVOICE', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.text(`Invoice #: ${invoice.invoiceNumber}`, 400, y);
    y += lineHeight;
    doc.text(`Date: ${invoice.date}`, 400, y);
    y += lineHeight * 1.5;

    // From / Bill To
    doc.setFont('helvetica', 'bold');
    doc.text('From', margin, y);
    doc.text('Bill To', 300, y);
    y += lineHeight;
    doc.setFont('helvetica', 'normal');
    const fromLines = (invoice.from?.name || '') + (invoice.from?.address ? `\n${invoice.from.address}` : '');
    const toLines = (invoice.billTo?.name || '') + (invoice.billTo?.address ? `\n${invoice.billTo.address}` : '');
    doc.text(fromLines, margin, y, { maxWidth: 240 });
    doc.text(toLines, 300, y, { maxWidth: 240 });
    y += lineHeight * 3;

    // Items table
    const currency = '€';
    doc.autoTable({
      startY: y,
      headStyles: { fillColor: [33, 150, 243] },
      head: [['Description', 'Qty', 'Unit Price', 'Total']],
      body: invoice.items.map((it) => [
        it.description,
        String(it.quantity),
        `${currency}${Number(it.unitPrice).toFixed(2)}`,
        `${currency}${(Number(it.quantity) * Number(it.unitPrice)).toFixed(2)}`
      ]),
      styles: { font: 'helvetica', fontSize: 11 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' }
      }
    });
    const tableY = (doc.lastAutoTable && doc.lastAutoTable.finalY) || y;

    // Totals
    const subTotal = invoice.subTotal ?? invoice.items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
    const taxAmount = invoice.taxAmount ?? (subTotal * (Number(invoice.taxRate) || 0)) / 100;
    const total = invoice.total ?? subTotal + taxAmount;

    const totalsX = 340;
    const totalsY = tableY + 20;
    doc.autoTable({
      startY: totalsY,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 11 },
      body: [
        ['Subtotal', `${currency}${subTotal.toFixed(2)}`],
        [`Tax (${invoice.taxRate || 0}%)`, `${currency}${taxAmount.toFixed(2)}`],
        [{ content: 'Total', styles: { fontStyle: 'bold' } }, { content: `${currency}${total.toFixed(2)}`, styles: { fontStyle: 'bold' } }]
      ],
      columnStyles: { 0: { cellWidth: 160 }, 1: { halign: 'right', cellWidth: 120 } },
      tableLineWidth: 0.5,
      tableLineColor: [200, 200, 200],
      margin: { left: totalsX }
    });

    // Notes
    const notesStartY = ((doc.lastAutoTable && doc.lastAutoTable.finalY) || totalsY) + 24;
    if (invoice.notes) {
      doc.setFont('helvetica', 'bold');
      doc.text('Notes / Terms', margin, notesStartY);
      doc.setFont('helvetica', 'normal');
      doc.text(String(invoice.notes), margin, notesStartY + 16, { maxWidth: 520 });
    }

    // Save
    const pdfBytes = doc.output('arraybuffer');
    fs.writeFileSync(outputPath, Buffer.from(pdfBytes));
  }
}

// ----- App Window -----
let mainWindow = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1280,
    minHeight: 720,
    title: 'InvoiceApp',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(app.getAppPath(), 'src', 'preload.cjs')
    }
  });

  mainWindow.loadFile(path.join(app.getAppPath(), 'src', 'index.html'));
  // mainWindow.webContents.openDevTools();
  // Lock 16:9 aspect ratio across resizes
  try { mainWindow.setAspectRatio(16 / 9); } catch {}
};

// ----- Menu -----
const buildMenu = (settingsStore) => {
  const template = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Invoice', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:new') },
        { label: 'Open Invoice', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:open') },
        { label: 'Save Invoice', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save') },
        { type: 'separator' },
        { label: 'Export as PDF', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('menu:export') },
        { label: 'Print', accelerator: 'CmdOrCtrl+P', click: () => mainWindow?.webContents.send('menu:print') },
        { type: 'separator' },
        { label: 'Settings', click: () => mainWindow?.webContents.send('menu:settings') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Toggle Theme', accelerator: 'CmdOrCtrl+D', click: () => mainWindow?.webContents.send('menu:toggle-theme') }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://www.electronjs.org');
          }
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

// ----- App Lifecycle -----
const settingsStore = new SettingsStore(getConfigPath());
const invoiceStore = new InvoiceStore(getInvoicesDir());
const clientsStore = new ClientsStore(getClientsPath());
const profilesStore = new ProfilesStore(getProfilesPath());

app.whenReady().then(() => {
  createWindow();
  buildMenu(settingsStore);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ----- IPC Handlers -----
ipcMain.handle('settings:get', async () => settingsStore.read());
ipcMain.handle('settings:save', async (_e, settings) => settingsStore.write(settings));
ipcMain.handle('invoice:list', async (_e, { query } = {}) => invoiceStore.list({ query }));
ipcMain.handle('invoice:load', async (_e, id) => invoiceStore.load(id));
ipcMain.handle('invoice:save', async (_e, invoice) => invoiceStore.save(new Invoice(invoice)));
ipcMain.handle('invoice:delete', async (_e, id) => invoiceStore.delete(id));
ipcMain.handle('invoice:duplicate', async (_e, { id, nextNumber }) => invoiceStore.duplicate(id, nextNumber));
ipcMain.handle('invoice:nextNumber', async () => {
  const settings = settingsStore.read();
  const next = Number(settings.lastInvoiceNumber || 0) + 1;
  settingsStore.write({ ...settings, lastInvoiceNumber: next });
  return String(next).padStart(4, '0');
});
ipcMain.handle('pdf:export', async (_e, invoice) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Invoice as PDF',
    defaultPath: `Invoice-${invoice.invoiceNumber || 'New'}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { canceled: true };
  await PdfService.exportInvoice(invoice, filePath);
  return { canceled: false, filePath };
});

// Clients IPC
ipcMain.handle('clients:list', async (_e, query = '') => clientsStore.list(query));
ipcMain.handle('clients:save', async (_e, client) => clientsStore.save(client));
ipcMain.handle('clients:delete', async (_e, id) => clientsStore.delete(id));

// Profiles IPC
ipcMain.handle('profiles:list', async (_e, query = '') => profilesStore.list(query));
ipcMain.handle('profiles:save', async (_e, profile) => profilesStore.save(profile));
ipcMain.handle('profiles:delete', async (_e, id) => profilesStore.delete(id));



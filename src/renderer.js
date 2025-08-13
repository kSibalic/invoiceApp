// ---------- Utilities ----------
const $ = (sel, parent = document) => parent.querySelector(sel);        
const $$ = (sel, parent = document) => Array.from(parent.querySelectorAll(sel));

// Helper function for click events
const onClick = (elementId, handler) => {
  const element = document.getElementById(elementId);
  if (element) {
    element.addEventListener('click', handler);
  } else {
    console.warn(`Element with ID '${elementId}' not found`);
  }
};

// Access the API exposed by preload (contextIsolation: true)
const api = window.api;

const formatCurrency = (value) => new Intl.NumberFormat('hr-HR', { 
  style: 'currency', 
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(value) || 0);

// ---------- State ----------
let appSettings = null;
let currentInvoice = null;
let clientsCache = [];
let profilesCache = [];

const blankInvoice = () => ({
  id: undefined,
  invoiceNumber: '',
  date: new Date().toISOString().slice(0, 10),
  from: { 
    name: appSettings?.business?.name || '', 
    address: appSettings?.business?.address || '', 
    phone: appSettings?.business?.phone || '', 
    email: appSettings?.business?.email || '' 
  },
  billTo: { name: '', address: '', phone: '', email: '' },
  items: [{ description: '', quantity: 1, unitPrice: 0 }],
  notes: '',
  taxRate: appSettings?.taxRate || 0,
  currency: '€',
  status: 'open'
});

// ---------- Rendering ----------
const renderItemRow = (item, index) => {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <input type="text" 
             class="form-control description" 
             value="${item.description || ''}" 
             placeholder="Opis proizvoda/usluge" />
    </td>
    <td>
      <input type="number" 
             class="form-control qty text-right" 
             min="0" 
             step="1" 
             value="${item.quantity || 0}" 
             placeholder="1" />
    </td>
    <td>
      <input type="number" 
             class="form-control price text-right" 
             min="0" 
             step="0.01" 
             value="${item.unitPrice || 0}" 
             placeholder="0.00" />
    </td>
    <td class="line-total text-right" style="font-weight: 600; color: var(--text-primary);">
      ${formatCurrency(0)}
    </td>
    <td class="text-right">
      <button class="btn btn-danger btn-xs remove-row" title="Ukloni stavku">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </td>
  `;
  
  const updateLineTotal = () => {
    const qty = Number(tr.querySelector('.qty').value) || 0;
    const price = Number(tr.querySelector('.price').value) || 0;
    const total = qty * price;
    tr.querySelector('.line-total').textContent = formatCurrency(total);
  };
  
  tr.querySelector('.description').addEventListener('input', (e) => {
    currentInvoice.items[index].description = e.target.value;
    updateTotals();
  });
  
  tr.querySelector('.qty').addEventListener('input', (e) => {
    currentInvoice.items[index].quantity = Number(e.target.value) || 0;
    updateLineTotal();
    updateTotals();
  });
  
  tr.querySelector('.price').addEventListener('input', (e) => {
    currentInvoice.items[index].unitPrice = Number(e.target.value) || 0;
    updateLineTotal();
    updateTotals();
  });
  
  tr.querySelector('.remove-row').addEventListener('click', () => {
    if (currentInvoice.items.length === 1) {
      // Don't remove the last item, just clear it
      currentInvoice.items[0] = { description: '', quantity: 1, unitPrice: 0 };
    } else {
      currentInvoice.items.splice(index, 1);
    }
    renderInvoiceForm();
  });
  
  // Update initial line total
  updateLineTotal();
  
  return tr;
};

const updateTotals = () => {
  const inv = currentInvoice;
  if (!inv) return;

  let sub = 0;
  
  const itemRows = document.querySelectorAll('#items-body tr');
  itemRows.forEach((row, idx) => {
    const it = inv.items[idx];
    if (it) {
      const qty = Number(it.quantity) || 0;
      const price = Number(it.unitPrice) || 0;
      const lineTotal = qty * price;
      const lineTotalEl = row.querySelector('.line-total');
      if (lineTotalEl) lineTotalEl.textContent = formatCurrency(lineTotal);
      sub += lineTotal;
    }
  });
  
  const taxRate = Number(inv.taxRate) || 0;
  const tax = (sub * taxRate) / 100;
  const total = sub + tax;
  
  const subtotalEl = $('#subtotal-bottom');
  const taxEl = $('#tax-bottom');
  const totalEl = $('#total-bottom');
  
  if (subtotalEl) subtotalEl.textContent = formatCurrency(sub);
  if (taxEl) taxEl.textContent = formatCurrency(tax);
  if (totalEl) totalEl.textContent = formatCurrency(total);
  
  if (taxEl) {
    const taxRow = taxEl.parentElement;
    if (taxRow) {
      const taxLabel = taxRow.querySelector('span');
      if (taxLabel) taxLabel.textContent = `Porez (${taxRate}%):`;
    }
  }
};

let currentListFilter = 'all';
const renderInvoiceList = async (query = '') => {
  try {
    let list = await api.invoice.list({ query });
    if (currentListFilter !== 'all') {
      list = list.filter((i) => (i.status || 'open') === currentListFilter);
    }
    
    const tbody = $('#invoices-list-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-secondary);">
            <div style="margin-bottom: 12px;">📄</div>
            <div>Nema pronađenih računa</div>
            <div style="font-size: 12px; margin-top: 4px;">
              ${query ? 'Promijenite pojam pretrage ili' : ''} kreirajte novi račun
            </div>
          </td>
        </tr>
      `;
      return;
    }
    
    list.forEach((it) => {
      const tr = document.createElement('tr');
      const statusText = it.status === 'paid' ? 'Plaćen' : 
                        it.status === 'overdue' ? 'Dospio' : 'Neplaćen';
      
      tr.innerHTML = `
        <td style="font-weight: 600;">${it.invoiceNumber || it.id}</td>
        <td>${formatDate(it.date)}</td>
        <td>
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" 
                   ${it.status === 'paid' ? 'checked' : ''} 
                   data-toggle-status 
                   style="accent-color: var(--success); width: 16px; height: 16px;"/>
            <span class="badge ${it.status || 'open'}">${statusText}</span>
          </label>
        </td>
        <td>${it.billTo?.name || '<em style="color: var(--text-muted);">Bez klijenta</em>'}</td>
        <td class="text-right" style="font-weight: 600;">${formatCurrency(it.total || 0)}</td>
        <td>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-secondary btn-xs" data-open title="Otvori račun">Otvori</button>
            <button class="btn btn-secondary btn-xs" data-duplicate title="Dupliciraj račun">Dupliciraj</button>
            <button class="btn btn-danger btn-xs" data-delete title="Obriši račun">Obriši</button>
          </div>
        </td>
      `;
      
      // Toggle status
      const toggleEl = tr.querySelector('[data-toggle-status]');
      if (toggleEl) {
        toggleEl.addEventListener('change', async (e) => {
          try {
            const invoice = await api.invoice.load(it.id);
            invoice.status = e.target.checked ? 'paid' : 'open';
            await api.invoice.save(invoice);
            const searchEl = $('#search');
            await renderInvoiceList(searchEl ? searchEl.value : '');
            showNotification('Status računa je ažuriran', 'success');
          } catch (error) {
            console.error('Error updating invoice status:', error);
            showNotification('Greška pri ažuriranju statusa', 'error');
          }
        });
      }
      
      const openBtn = tr.querySelector('[data-open]');
      if (openBtn) {
        openBtn.addEventListener('click', async () => {
          try {
            const invoice = await api.invoice.load(it.id);
            currentInvoice = invoice;
            showView('editor');
            renderInvoiceForm();
            setActiveNav('nav-editor');
            showNotification(`Otvoren račun ${invoice.invoiceNumber}`, 'success');
          } catch (error) {
            console.error('Error loading invoice:', error);
            showNotification('Greška pri učitavanju računa', 'error');
          }
        });
      }
      
      const duplicateBtn = tr.querySelector('[data-duplicate]');
      if (duplicateBtn) {
        duplicateBtn.addEventListener('click', async () => {
          try {
            const next = await api.invoice.nextNumber();
            const dup = await api.invoice.duplicate(it.id, next);
            const searchEl = $('#search');
            await renderInvoiceList(searchEl ? searchEl.value : '');
            const invoice = await api.invoice.load(dup.id);
            currentInvoice = invoice;
            showView('editor');
            renderInvoiceForm();
            setActiveNav('nav-editor');
            showNotification(`Kreiran dupliciran račun ${next}`, 'success');
          } catch (error) {
            console.error('Error duplicating invoice:', error);
            showNotification('Greška pri dupliciranju računa', 'error');
          }
        });
      }
      
      const deleteBtn = tr.querySelector('[data-delete]');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (!confirm(`Jeste li sigurni da želite obrisati račun ${it.invoiceNumber || it.id}?`)) return;
          try {
            await api.invoice.delete(it.id);
            const searchEl = $('#search');
            await renderInvoiceList(searchEl ? searchEl.value : '');
            showNotification('Račun je obrisan', 'success');
          } catch (error) {
            console.error('Error deleting invoice:', error);
            showNotification('Greška pri brisanju računa', 'error');
          }
        });
      }
      
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error rendering invoice list:', error);
    showNotification('Greška pri učitavanju računa', 'error');
  }
};

const formatDate = (dateString) => {
  if (!dateString) return '';
  try {
    return new Date(dateString).toLocaleDateString('hr-HR');
  } catch {
    return dateString;
  }
};

const showNotification = (message, type = 'info') => {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 20px;
    border-radius: 12px;
    color: white;
    font-weight: 500;
    z-index: 10000;
    max-width: 400px;
    box-shadow: var(--shadow-lg);
    transform: translateX(100%);
    transition: transform 0.3s ease;
  `;
  
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };
  
  notification.style.background = colors[type] || colors.info;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.transform = 'translateX(0)';
  }, 10);
  
  setTimeout(() => {
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
};

// ---------- Navigation ----------
const setActiveNav = (activeId) => {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach((item) => item.classList.remove('active'));
  const activeItem = document.getElementById(activeId);
  if (activeItem) {
    activeItem.classList.add('active');
  } else {
    console.error('Could not find nav item:', activeId);
  }
};

// ---------- Events ----------
const bindEvents = () => {
  const addItemBtn = $('#add-item');
  if (addItemBtn) {
    addItemBtn.addEventListener('click', () => {
      currentInvoice.items.push({ description: '', quantity: 1, unitPrice: 0 });
      renderInvoiceForm();
    });
  }
  
  const invoiceNumberEl = $('#invoice-number');
  if (invoiceNumberEl) {
    invoiceNumberEl.addEventListener('input', (e) => (currentInvoice.invoiceNumber = e.target.value));
  }
  
  const invoiceDateEl = $('#invoice-date');
  if (invoiceDateEl) {
    invoiceDateEl.addEventListener('input', (e) => (currentInvoice.date = e.target.value));
  }
  
  const statusSel = $('#invoice-status');
  if (statusSel) {
    statusSel.addEventListener('change', (e) => (currentInvoice.status = e.target.value));
  }
  
  const fromNameEl = $('#from-name');
  if (fromNameEl) {
    fromNameEl.addEventListener('input', (e) => (currentInvoice.from.name = e.target.value));
  }
  
  const fromAddressEl = $('#from-address');
  if (fromAddressEl) {
    fromAddressEl.addEventListener('input', (e) => (currentInvoice.from.address = e.target.value));
  }
  
  const billtoNameEl = $('#billto-name');
  if (billtoNameEl) {
    billtoNameEl.addEventListener('input', (e) => (currentInvoice.billTo.name = e.target.value));
  }
  
  const billtoAddressEl = $('#billto-address');
  if (billtoAddressEl) {
    billtoAddressEl.addEventListener('input', (e) => (currentInvoice.billTo.address = e.target.value));
  }
  
  const billtoPhoneEl = $('#billto-phone');
  if (billtoPhoneEl) {
    billtoPhoneEl.addEventListener('input', (e) => (currentInvoice.billTo.phone = e.target.value));
  }
  
  const billtoEmailEl = $('#billto-email');
  if (billtoEmailEl) {
    billtoEmailEl.addEventListener('input', (e) => (currentInvoice.billTo.email = e.target.value));
  }
  
  const notesEl = $('#notes');
  if (notesEl) {
    notesEl.addEventListener('input', (e) => (currentInvoice.notes = e.target.value));
  }
  
  const taxRateEl = $('#tax-rate');
  if (taxRateEl) {
    taxRateEl.addEventListener('input', (e) => {
      currentInvoice.taxRate = Number(e.target.value) || 0;
      updateTotals();
    });
  }
  
  // Client and profile management
  onClick('manage-clients', () => openClients());
  onClick('manage-profiles', () => openProfiles());
  
  const clientSelectEl = $('#client-select');
  if (clientSelectEl) {
    clientSelectEl.addEventListener('change', (e) => {
      const id = e.target.value;
      const c = clientsCache.find((x) => x.id === id);
      if (!c) return;
      
      currentInvoice.billTo = {
        name: c.name || '',
        address: c.address || '',
        phone: c.phone || '',
        email: c.email || ''
      };
      
      const billtoNameEl = $('#billto-name');
      const billtoAddressEl = $('#billto-address');
      const billtoPhoneEl = $('#billto-phone');
      const billtoEmailEl = $('#billto-email');
      
      if (billtoNameEl) billtoNameEl.value = currentInvoice.billTo.name;
      if (billtoAddressEl) billtoAddressEl.value = currentInvoice.billTo.address;
      if (billtoPhoneEl) billtoPhoneEl.value = currentInvoice.billTo.phone;
      if (billtoEmailEl) billtoEmailEl.value = currentInvoice.billTo.email;
    });
  }
  
  const profileSelectEl = $('#from-profile');
  if (profileSelectEl) {
    profileSelectEl.addEventListener('change', (e) => {
      const id = e.target.value;
      const p = profilesCache.find((x) => x.id === id);
      if (!p) return;
      
      currentInvoice.from = { 
        name: p.name || '', 
        address: p.address || '', 
        phone: p.phone || '', 
        email: p.email || '' 
      };
      
      const fromNameEl = $('#from-name');
      const fromAddressEl = $('#from-address');
      
      if (fromNameEl) fromNameEl.value = currentInvoice.from.name;
      if (fromAddressEl) fromAddressEl.value = currentInvoice.from.address;
    });
  }

  // Navigation
  onClick('nav-editor', () => {
    setActiveNav('nav-editor');
    showView('editor');
    if (currentInvoice) renderInvoiceForm();
  });
  
  onClick('nav-invoices', async () => {
    setActiveNav('nav-invoices');
    showView('list');
    const searchEl = $('#search');
    await renderInvoiceList(searchEl ? searchEl.value : '');
  });
  
  onClick('nav-clients', () => {
    setActiveNav('nav-clients');
    openClients();
  });
  
  onClick('nav-profiles', () => {
    setActiveNav('nav-profiles');
    openProfiles();
  });
  
  onClick('nav-settings', () => {
    setActiveNav('nav-settings');
    openSettings();
  });

  // Action buttons
  onClick('act-new', () => newInvoice());
  onClick('act-save', () => saveInvoice());
  onClick('act-pdf', () => exportPdf());

  // Search and filters
  const searchEl = $('#search');
  if (searchEl) {
    searchEl.addEventListener('input', async (e) => {
      await renderInvoiceList(e.target.value);
    });
  }
  
  // Status filter buttons
  const filterBtns = document.querySelectorAll('[data-status]');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      filterBtns.forEach(b => {
        b.classList.remove('btn-primary');
        b.classList.add('btn-secondary');
      });
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
      
      currentListFilter = btn.getAttribute('data-status') || 'all';
      const searchEl = $('#search');
      await renderInvoiceList(searchEl ? searchEl.value : '');
    });
  });

  // Settings modal
  onClick('settings-save', async () => {
    try {
      const newSettings = {
        ...appSettings,
        taxRate: Number($('#settings-tax')?.value) || 0,
        currency: '€',
        business: {
          name: $('#settings-business-name')?.value || '',
          address: $('#settings-business-address')?.value || '',
          phone: $('#settings-business-phone')?.value || '',
          email: $('#settings-business-email')?.value || ''
        },
        theme: $('#settings-theme')?.value || 'light'
      };
      
      appSettings = await api.settings.save(newSettings);
      applyTheme();
      
      // Update current invoice defaults if missing
      if (!currentInvoice.currency) currentInvoice.currency = appSettings.currency;
      if (currentInvoice.taxRate == null) currentInvoice.taxRate = appSettings.taxRate;
      
      renderInvoiceForm();
      closeSettings();
      showNotification('Postavke su spremljene', 'success');
    } catch (error) {
      console.error('Error saving settings:', error);
      showNotification('Greška pri spremanju postavki', 'error');
    }
  });
  
  onClick('settings-cancel', () => closeSettings());

  // ESC to close modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettings();
      closeClients();
      closeProfiles();
    }
  });

  // Menu events from Electron
  if (api?.menu) {
    api.menu.onNew(() => newInvoice());
    api.menu.onOpen(async () => {
      setActiveNav('nav-invoices');
      showView('list');
      const searchEl = $('#search');
      await renderInvoiceList(searchEl ? searchEl.value : '');
    });
    api.menu.onSave(() => saveInvoice());
    api.menu.onExport(() => exportPdf());
    api.menu.onPrint(() => printInvoice());
    api.menu.onSettings(() => openSettings());
    api.menu.onToggleTheme(() => toggleTheme());
  }
};

// NOTE: made async so we can await dropdown fills when called
const renderInvoiceForm = async () => {
  if (!currentInvoice) {
    console.error('No current invoice to render');
    return;
  }
  
  const inv = currentInvoice;
  const invoiceNumberEl = $('#invoice-number');
  const invoiceDateEl = $('#invoice-date');
  const statusSel = $('#invoice-status');
  
  if (invoiceNumberEl) invoiceNumberEl.value = inv.invoiceNumber || '';
  if (invoiceDateEl) invoiceDateEl.value = inv.date || '';
  if (statusSel) statusSel.value = inv.status || 'open';
  
  const fromNameEl = $('#from-name');
  const fromAddressEl = $('#from-address');
  if (fromNameEl) fromNameEl.value = inv.from?.name || '';
  if (fromAddressEl) fromAddressEl.value = inv.from?.address || '';
  
  const billtoNameEl = $('#billto-name');
  const billtoAddressEl = $('#billto-address');
  const billtoPhoneEl = $('#billto-phone');
  const billtoEmailEl = $('#billto-email');
  if (billtoNameEl) billtoNameEl.value = inv.billTo?.name || '';
  if (billtoAddressEl) billtoAddressEl.value = inv.billTo?.address || '';
  if (billtoPhoneEl) billtoPhoneEl.value = inv.billTo?.phone || '';
  if (billtoEmailEl) billtoEmailEl.value = inv.billTo?.email || '';
  
  const notesEl = $('#notes');
  const taxRateEl = $('#tax-rate');
  if (notesEl) notesEl.value = inv.notes || '';
  if (taxRateEl) taxRateEl.value = (inv.taxRate ?? appSettings?.taxRate) || 0;

  const tbody = $('#items-body');
  if (tbody && inv.items) {
    tbody.innerHTML = '';
    inv.items.forEach((it, idx) => tbody.appendChild(renderItemRow(it, idx)));
  }

  // Fill dropdowns (await to avoid flicker)
  await renderClientDropdown();
  await renderProfileDropdown();

  updateTotals();

  const pageTitle = $('.page-title');
  if (pageTitle) {
    pageTitle.textContent = inv.invoiceNumber ? `Račun ${inv.invoiceNumber}` : 'Novi račun';
  }
};

// ---------- Actions ----------
const newInvoice = async () => {
  try {
    const next = await api.invoice.nextNumber();
    currentInvoice = blankInvoice();
    currentInvoice.invoiceNumber = next;
    setActiveNav('nav-editor');
    showView('editor');
    await renderInvoiceForm();
    showNotification(`Kreiran novi račun ${next}`, 'success');
  } catch (error) {
    console.error('Error creating new invoice:', error);
    showNotification('Greška pri kreiranju novog računa', 'error');
  }
};

const saveInvoice = async () => {
  if (!currentInvoice?.invoiceNumber?.trim()) {
    showNotification('Broj računa je obavezan', 'warning');
    const invoiceNumberEl = $('#invoice-number');
    if (invoiceNumberEl) invoiceNumberEl.focus();
    return;
  }
  
  if (!currentInvoice?.billTo?.name?.trim()) {
    showNotification('Naziv klijenta je obavezan', 'warning');
    const billtoNameEl = $('#billto-name');
    if (billtoNameEl) billtoNameEl.focus();
    return;
  }
  
  try {
    const saved = await api.invoice.save(currentInvoice);
    currentInvoice = saved;
    showNotification(`Račun ${saved.invoiceNumber} je spremljen`, 'success');
  } catch (error) {
    console.error('Error saving invoice:', error);
    showNotification('Greška pri spremanju računa', 'error');
  }
};

const exportPdf = async () => {
  if (!currentInvoice) {
    showNotification('Nema računa za izvoz', 'warning');
    return;
  }
  
  try {
    const result = await api.pdf.export(currentInvoice);
    if (!result.canceled) {
      showNotification('PDF je uspješno izvezen', 'success');
    }
  } catch (error) {
    console.error('Error exporting PDF:', error);
    showNotification('Greška pri izvozu PDF-a', 'error');
  }
};

const printInvoice = () => {
  if (!currentInvoice) {
    showNotification('Nema računa za ispis', 'warning');
    return;
  }
  
  try {
    renderPrintArea(currentInvoice);
    window.print();
    showNotification('Račun je spreman za ispis', 'success');
  } catch (error) {
    console.error('Error printing invoice:', error);
    showNotification('Greška pri ispisu računa', 'error');
  }
};

// ---------- Print Template ----------
const renderPrintArea = (inv) => {
  const container = $('#print-area');
  if (!container) return;
  
  const sub = inv.items.reduce((s, it) => s + (Number(it.quantity) * Number(it.unitPrice)), 0);
  const tax = (sub * (Number(inv.taxRate) || 0)) / 100;
  const total = sub + tax;
  
  const itemsRows = inv.items.map((it) => `
    <tr>
      <td>${it.description || ''}</td>
      <td class="text-right">${Number(it.quantity) || 0}</td>
      <td class="text-right">${formatCurrency(it.unitPrice)}</td>
      <td class="text-right">${formatCurrency((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))}</td>
    </tr>
  `).join('');
  
  container.innerHTML = `
    <div class="pi-header">
      <div>
        <h1>RAČUN</h1>
      </div>
      <div class="pi-meta">
        <div><strong>Broj računa:</strong> ${inv.invoiceNumber || ''}</div>
        <div><strong>Datum:</strong> ${formatDate(inv.date)}</div>
        <div><strong>Status:</strong> ${inv.status === 'paid' ? 'Plaćen' : inv.status === 'overdue' ? 'Dospio' : 'Neplaćen'}</div>
      </div>
    </div>
    <div class="pi-info">
      <div>
        <h3>Od</h3>
        <div><strong>${inv.from?.name || ''}</strong></div>
        <div>${(inv.from?.address || '').replace(/\n/g, '<br/>')}</div>
        ${inv.from?.phone ? `<div>Tel: ${inv.from.phone}</div>` : ''}
        ${inv.from?.email ? `<div>Email: ${inv.from.email}</div>` : ''}
      </div>
      <div>
        <h3>Za</h3>
        <div><strong>${inv.billTo?.name || ''}</strong></div>
        <div>${(inv.billTo?.address || '').replace(/\n/g, '<br/>')}</div>
        ${inv.billTo?.phone ? `<div>Tel: ${inv.billTo.phone}</div>` : ''}
        ${inv.billTo?.email ? `<div>Email: ${inv.billTo.email}</div>` : ''}
      </div>
    </div>
    <table class="pi-items">
      <thead>
        <tr>
          <th>Opis</th>
          <th class="text-right">Količina</th>
          <th class="text-right">Jedinična cijena</th>
          <th class="text-right">Ukupno</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>
    <table class="pi-totals">
      <tbody>
        <tr><td>Međuzbroj</td><td class="text-right">${formatCurrency(sub)}</td></tr>
        <tr><td>Porez (${inv.taxRate || 0}%)</td><td class="text-right">${formatCurrency(tax)}</td></tr>
        <tr class="grand"><td><strong>Ukupno</strong></td><td class="text-right"><strong>${formatCurrency(total)}</strong></td></tr>
      </tbody>
    </table>
    ${inv.notes ? `<div class="pi-notes"><strong>Napomene / Uvjeti</strong><div>${String(inv.notes).replace(/\n/g, '<br/>')}</div></div>` : ''}
  `;
};

// ---------- Modal Management ----------
const openSettings = () => {
  const modal = $('#settings-modal');
  if (modal) modal.classList.add('open');
  
  const taxEl = $('#settings-tax');
  const nameEl = $('#settings-business-name');
  const addressEl = $('#settings-business-address');
  const phoneEl = $('#settings-business-phone');
  const emailEl = $('#settings-business-email');
  const themeEl = $('#settings-theme');
  
  if (taxEl) taxEl.value = appSettings?.taxRate ?? 0;
  if (nameEl) nameEl.value = appSettings?.business?.name || '';
  if (addressEl) addressEl.value = appSettings?.business?.address || '';
  if (phoneEl) phoneEl.value = appSettings?.business?.phone || '';
  if (emailEl) emailEl.value = appSettings?.business?.email || '';
  if (themeEl) themeEl.value = appSettings?.theme || 'light';
};

const closeSettings = () => {
  const modal = $('#settings-modal');
  if (modal) modal.classList.remove('open');
};

// ---------- Clients Modal ----------
const openClients = async () => {
  const modal = $('#clients-modal');
  if (modal) modal.classList.add('open');
  await renderClients();
  bindClientEvents();
};

const closeClients = () => {
  const modal = $('#clients-modal');
  if (modal) modal.classList.remove('open');
  hideClientForm();
};

const bindClientEvents = () => {
  const searchEl = $('#client-search');
  if (searchEl) {
    searchEl.addEventListener('input', async (e) => renderClients(e.target.value));
  }
  
  onClick('client-new', () => showClientForm());
  onClick('client-save', () => saveClientForm());
  onClick('client-cancel', () => hideClientForm());
  onClick('clients-close', () => closeClients());
};

const renderClients = async (query = '') => {
  try {
    clientsCache = await api.clients.list(query);
    const tbody = $('#clients-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (clientsCache.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-secondary);">
            <div style="margin-bottom: 12px;">👥</div>
            <div>Nema pronađenih klijenata</div>
            <div style="font-size: 12px; margin-top: 4px;">
              ${query ? 'Promijenite pojam pretrage ili' : ''} dodajte novog klijenta
            </div>
          </td>
        </tr>
      `;
      return;
    }
    
    clientsCache.forEach((c) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600;">${c.name || ''}</td>
        <td>${c.phone || ''}</td>
        <td>${c.email || ''}</td>
        <td>${c.address || ''}</td>
        <td>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-secondary btn-xs" data-edit>Uredi</button>
            <button class="btn btn-danger btn-xs" data-del>Obriši</button>
          </div>
        </td>
      `;
      
      const editBtn = tr.querySelector('[data-edit]');
      if (editBtn) {
        editBtn.addEventListener('click', () => showClientForm(c));
      }
      
      const delBtn = tr.querySelector('[data-del]');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Obrisati klijenta "${c.name}"?`)) return;
          try {
            await api.clients.delete(c.id);
            const searchEl = $('#client-search');
            await renderClients(searchEl ? searchEl.value : '');
            await renderClientDropdown();
            showNotification('Klijent je obrisan', 'success');
          } catch (error) {
            console.error('Error deleting client:', error);
            showNotification('Greška pri brisanju klijenta', 'error');
          }
        });
      }
      
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error rendering clients:', error);
    showNotification('Greška pri učitavanju klijenata', 'error');
  }
};

let editingClientId = null;

const showClientForm = (client = { id: null, name: '', phone: '', email: '', address: '' }) => {
  editingClientId = client.id;
  
  const nameEl = $('#client-name');
  const phoneEl = $('#client-phone');
  const emailEl = $('#client-email');
  const addressEl = $('#client-address');
  const formEl = $('#client-form');
  
  if (nameEl) nameEl.value = client.name || '';
  if (phoneEl) phoneEl.value = client.phone || '';
  if (emailEl) emailEl.value = client.email || '';
  if (addressEl) addressEl.value = client.address || '';
  if (formEl) formEl.style.display = 'block';
  if (nameEl) nameEl.focus();
};

const hideClientForm = () => {
  editingClientId = null;
  const formEl = $('#client-form');
  if (formEl) formEl.style.display = 'none';
};

const saveClientForm = async () => {
  const nameEl = $('#client-name');
  const phoneEl = $('#client-phone');
  const emailEl = $('#client-email');
  const addressEl = $('#client-address');
  
  const payload = {
    id: editingClientId || undefined,
    name: nameEl ? nameEl.value.trim() : '',
    phone: phoneEl ? phoneEl.value.trim() : '',
    email: emailEl ? emailEl.value.trim() : '',
    address: addressEl ? addressEl.value.trim() : ''
  };
  
  if (!payload.name) {
    showNotification('Naziv klijenta je obavezan', 'warning');
    if (nameEl) nameEl.focus();
    return;
  }
  
  try {
    await api.clients.save(payload);
    hideClientForm();
    const searchEl = $('#client-search');
    await renderClients(searchEl ? searchEl.value : '');
    await renderClientDropdown();
    showNotification(editingClientId ? 'Klijent je ažuriran' : 'Novi klijent je dodan', 'success');
  } catch (error) {
    console.error('Error saving client:', error);
    showNotification('Greška pri spremanju klijenta', 'error');
  }
};

const renderClientDropdown = async () => {
  try {
    clientsCache = await api.clients.list('');
    const sel = $('#client-select');
    if (!sel) return;
    
    const currentId = sel.value;
    
    sel.innerHTML = '<option value="">Odaberite klijenta...</option>' + 
      clientsCache.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
    
    if (currentId) sel.value = currentId;
  } catch (error) {
    console.error('Error rendering client dropdown:', error);
  }
};

// ---------- Profiles Modal ----------
const openProfiles = async () => {
  const modal = $('#profiles-modal');
  if (modal) modal.classList.add('open');
  await renderProfiles();
  bindProfileEvents();
};

const closeProfiles = () => {
  const modal = $('#profiles-modal');
  if (modal) modal.classList.remove('open');
  hideProfileForm();
};

const bindProfileEvents = () => {
  const searchEl = $('#profile-search');
  if (searchEl) {
    searchEl.addEventListener('input', async (e) => renderProfiles(e.target.value));
  }
  
  onClick('profile-new', () => showProfileForm());
  onClick('profile-save', () => saveProfileForm());
  onClick('profile-cancel', () => hideProfileForm());
  onClick('profiles-close', () => closeProfiles());
};

const renderProfiles = async (query = '') => {
  try {
    profilesCache = await api.profiles.list(query);
    const tbody = $('#profiles-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (profilesCache.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-secondary);">
            <div style="margin-bottom: 12px;">🏢</div>
            <div>Nema pronađenih profila</div>
            <div style="font-size: 12px; margin-top: 4px;">
              ${query ? 'Promijenite pojam pretrage ili' : ''} dodajte novi profil
            </div>
          </td>
        </tr>
      `;
      return;
    }
    
    profilesCache.forEach((p) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600;">${p.name || ''}</td>
        <td>${p.phone || ''}</td>
        <td>${p.email || ''}</td>
        <td>${p.address || ''}</td>
        <td>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-secondary btn-xs" data-edit>Uredi</button>
            <button class="btn btn-danger btn-xs" data-del>Obriši</button>
          </div>
        </td>
      `;
      
      const editBtn = tr.querySelector('[data-edit]');
      if (editBtn) {
        editBtn.addEventListener('click', () => showProfileForm(p));
      }
      
      const delBtn = tr.querySelector('[data-del]');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Obrisati profil "${p.name}"?`)) return;
          try {
            await api.profiles.delete(p.id);
            const searchEl = $('#profile-search');
            await renderProfiles(searchEl ? searchEl.value : '');
            await renderProfileDropdown();
            showNotification('Profil je obrisan', 'success');
          } catch (error) {
            console.error('Error deleting profile:', error);
            showNotification('Greška pri brisanju profila', 'error');
          }
        });
      }
      
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error rendering profiles:', error);
    showNotification('Greška pri učitavanju profila', 'error');
  }
};

let editingProfileId = null;

const showProfileForm = (profile = { id: null, name: '', phone: '', email: '', address: '' }) => {
  editingProfileId = profile.id;
  
  const nameEl = $('#profile-name');
  const phoneEl = $('#profile-phone');
  const emailEl = $('#profile-email');
  const addressEl = $('#profile-address');
  const formEl = $('#profile-form');
  
  if (nameEl) nameEl.value = profile.name || '';
  if (phoneEl) phoneEl.value = profile.phone || '';
  if (emailEl) emailEl.value = profile.email || '';
  if (addressEl) addressEl.value = profile.address || '';
  if (formEl) formEl.style.display = 'block';
  if (nameEl) nameEl.focus();
};

const hideProfileForm = () => {
  editingProfileId = null;
  const formEl = $('#profile-form');
  if (formEl) formEl.style.display = 'none';
};

const saveProfileForm = async () => {
  const nameEl = $('#profile-name');
  const phoneEl = $('#profile-phone');
  const emailEl = $('#profile-email');
  const addressEl = $('#profile-address');
  
  const payload = {
    id: editingProfileId || undefined,
    name: nameEl ? nameEl.value.trim() : '',
    phone: phoneEl ? phoneEl.value.trim() : '',
    email: emailEl ? emailEl.value.trim() : '',
    address: addressEl ? addressEl.value.trim() : ''
  };
  
  if (!payload.name) {
    showNotification('Naziv profila je obavezan', 'warning');
    if (nameEl) nameEl.focus();
    return;
  }
  
  try {
    await api.profiles.save(payload);
    hideProfileForm();
    const searchEl = $('#profile-search');
    await renderProfiles(searchEl ? searchEl.value : '');
    await renderProfileDropdown();
    showNotification(editingProfileId ? 'Profil je ažuriran' : 'Novi profil je dodan', 'success');
  } catch (error) {
    console.error('Error saving profile:', error);
    showNotification('Greška pri spremanju profila', 'error');
  }
};

const renderProfileDropdown = async () => {
  try {
    profilesCache = await api.profiles.list('');
    const sel = $('#from-profile');
    if (!sel) return;
    
    const currentId = sel.value;
    
    sel.innerHTML = '<option value="">Odaberite profil...</option>' + 
      profilesCache.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    
    if (currentId) sel.value = currentId;
  } catch (error) {
    console.error('Error rendering profile dropdown:', error);
  }
};

// ---------- View Management ----------
const showView = (viewName) => {
  // FIX: use $$ to get a NodeList array; $('.view') returns a single element
  const views = $$('.view');
  views.forEach((view) => view.classList.remove('active'));
  const targetView = $(`#view-${viewName}`);
  if (targetView) {
    targetView.classList.add('active');
  } else {
    console.warn(`View #view-${viewName} not found in DOM`);
  }
};

// ---------- Theme ----------
const applyTheme = () => {
  document.documentElement.dataset.theme = appSettings?.theme || 'light';
};

const toggleTheme = async () => {
  const newTheme = appSettings?.theme === 'dark' ? 'light' : 'dark';
  const newSettings = { ...appSettings, theme: newTheme };
  
  try {
    appSettings = await api.settings.save(newSettings);
    applyTheme();
    showNotification(`Prebačeno na ${newTheme === 'dark' ? 'tamnu' : 'svijetlu'} temu`, 'success');
  } catch (error) {
    console.error('Error toggling theme:', error);
    showNotification('Greška pri mijenjanju teme', 'error');
  }
};

// ---------- Bootstrap ----------
window.addEventListener('DOMContentLoaded', async () => {
  try {
    // Wait a bit for DOM to be fully ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check if API is available
    if (!window.api) {
      throw new Error('API not available - preload script may have failed');
    }
    
    // Load settings
    appSettings = await api.settings.get();
    applyTheme();
    
    // Initialize with blank invoice
    currentInvoice = blankInvoice();
    
    // Bind all events FIRST
    bindEvents();
    
    // Then render initial form
    await renderInvoiceForm();
    
    // Load initial data
    await renderInvoiceList();
    await renderClientDropdown();
    await renderProfileDropdown();
    
    // Set initial active filter
    const allFilterBtn = document.querySelector('[data-status="all"]');
    if (allFilterBtn) {
      allFilterBtn.classList.remove('btn-secondary');
      allFilterBtn.classList.add('btn-primary');
    }
    
    // Ensure editor view is active by default
    showView('editor');
    setActiveNav('nav-editor');
    
    showNotification('Aplikacija je uspješno pokrenuta', 'success');
  } catch (error) {
    console.error('Error initializing app:', error);
    showNotification('Greška pri pokretanju aplikacije: ' + error.message, 'error');
  }
});

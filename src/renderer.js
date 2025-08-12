// ---------- Utilities ----------
const $ = (sel, parent = document) => parent.querySelector(sel);
const $$ = (sel, parent = document) => Array.from(parent.querySelectorAll(sel));
const onClick = (id, handler) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handler);
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
const renderInvoiceForm = () => {
  const inv = currentInvoice;
  $('#invoice-number').value = inv.invoiceNumber || '';
  $('#invoice-date').value = inv.date || '';
  const statusSel = $('#invoice-status');
  if (statusSel) statusSel.value = inv.status || 'open';
  
  $('#from-name').value = inv.from?.name || '';
  $('#from-address').value = inv.from?.address || '';
  
  $('#billto-name').value = inv.billTo?.name || '';
  $('#billto-address').value = inv.billTo?.address || '';
  $('#billto-phone').value = inv.billTo?.phone || '';
  $('#billto-email').value = inv.billTo?.email || '';
  
  $('#notes').value = inv.notes || '';
  $('#tax-rate').val((inv.taxRate ?? appSettings?.taxRate) || 0);

  const tbody = $('#items-body');
  tbody.innerHTML = '';
  inv.items.forEach((it, idx) => tbody.appendChild(renderItemRow(it, idx)));
  updateTotals();

  // Fill dropdowns
  renderClientDropdown();
  renderProfileDropdown();
  
  // Update page title based on invoice
  const pageTitle = $('.page-title');
  if (pageTitle) {
    pageTitle.textContent = inv.invoiceNumber ? `Račun ${inv.invoiceNumber}` : 'Novi račun';
  }
};

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
  let sub = 0;
  
  $$('#items-body tr').forEach((row, idx) => {
    const it = inv.items[idx];
    if (it) {
      const qty = Number(it.quantity) || 0;
      const price = Number(it.unitPrice) || 0;
      const lineTotal = qty * price;
      row.querySelector('.line-total').textContent = formatCurrency(lineTotal);
      sub += lineTotal;
    }
  });
  
  const taxRate = Number(inv.taxRate) || 0;
  const tax = (sub * taxRate) / 100;
  const total = sub + tax;
  
  // Update totals in the summary
  const subtotalEl = $('#subtotal-bottom');
  const taxEl = $('#tax-bottom');
  const totalEl = $('#total-bottom');
  
  if (subtotalEl) subtotalEl.textContent = formatCurrency(sub);
  if (taxEl) taxEl.textContent = formatCurrency(tax);
  if (totalEl) totalEl.textContent = formatCurrency(total);
  
  // Update the tax label to show current rate
  const taxRow = taxEl?.parentElement;
  if (taxRow) {
    const taxLabel = taxRow.querySelector('span');
    if (taxLabel) taxLabel.textContent = `Porez (${taxRate}%):`;
  }
};

let currentListFilter = 'all';
const renderInvoiceList = async (query = '') => {
  try {
    let list = await api.invoice.list(query);
    if (currentListFilter !== 'all') {
      list = list.filter((i) => (i.status || 'open') === currentListFilter);
    }
    
    const tbody = $('#invoices-list-body');
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
      tr.querySelector('[data-toggle-status]').addEventListener('change', async (e) => {
        try {
          const invoice = await api.invoice.load(it.id);
          invoice.status = e.target.checked ? 'paid' : 'open';
          await api.invoice.save(invoice);
          await renderInvoiceList($('#search').value);
          showNotification('Status računa je ažuriran', 'success');
        } catch (error) {
          console.error('Error updating invoice status:', error);
          showNotification('Greška pri ažuriranju statusa', 'error');
        }
      });
      
      tr.querySelector('[data-open]').addEventListener('click', async () => {
        try {
          const invoice = await api.invoice.load(it.id);
          currentInvoice = invoice;
          showView('editor');
          renderInvoiceForm();
          showNotification(`Otvoren račun ${invoice.invoiceNumber}`, 'success');
        } catch (error) {
          console.error('Error loading invoice:', error);
          showNotification('Greška pri učitavanju računa', 'error');
        }
      });
      
      tr.querySelector('[data-duplicate]').addEventListener('click', async () => {
        try {
          const next = await api.invoice.nextNumber();
          const dup = await api.invoice.duplicate(it.id, next);
          await renderInvoiceList($('#search').value);
          const invoice = await api.invoice.load(dup.id);
          currentInvoice = invoice;
          showView('editor');
          renderInvoiceForm();
          showNotification(`Kreiran dupliciran račun ${next}`, 'success');
        } catch (error) {
          console.error('Error duplicating invoice:', error);
          showNotification('Greška pri dupliciranju računa', 'error');
        }
      });
      
      tr.querySelector('[data-delete]').addEventListener('click', async () => {
        if (!confirm(`Jeste li sigurni da želite obrisati račun ${it.invoiceNumber || it.id}?`)) return;
        try {
          await api.invoice.delete(it.id);
          await renderInvoiceList($('#search').value);
          showNotification('Račun je obrisan', 'success');
        } catch (error) {
          console.error('Error deleting invoice:', error);
          showNotification('Greška pri brisanju računa', 'error');
        }
      });
      
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error rendering invoice list:', error);
    showNotification('Greška pri učitavanju računa', 'error');
  }
};

// ---------- Utility Functions ----------
const formatDate = (dateString) => {
  if (!dateString) return '';
  try {
    return new Date(dateString).toLocaleDateString('hr-HR');
  } catch {
    return dateString;
  }
};

const showNotification = (message, type = 'info') => {
  // Create notification element
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
  
  // Animate in
  setTimeout(() => {
    notification.style.transform = 'translateX(0)';
  }, 10);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
};

// ---------- Events ----------
const bindEvents = () => {
  $('#add-item').addEventListener('click', () => {
    currentInvoice.items.push({ description: '', quantity: 1, unitPrice: 0 });
    renderInvoiceForm();
  });
  
  $('#invoice-number').addEventListener('input', (e) => (currentInvoice.invoiceNumber = e.target.value));
  $('#invoice-date').addEventListener('input', (e) => (currentInvoice.date = e.target.value));
  
  const statusSel = $('#invoice-status');
  if (statusSel) statusSel.addEventListener('change', (e) => (currentInvoice.status = e.target.value));
  
  $('#from-name').addEventListener('input', (e) => (currentInvoice.from.name = e.target.value));
  $('#from-address').addEventListener('input', (e) => (currentInvoice.from.address = e.target.value));
  $('#billto-name').addEventListener('input', (e) => (currentInvoice.billTo.name = e.target.value));
  $('#billto-address').addEventListener('input', (e) => (currentInvoice.billTo.address = e.target.value));
  $('#billto-phone').addEventListener('input', (e) => (currentInvoice.billTo.phone = e.target.value));
  $('#billto-email').addEventListener('input', (e) => (currentInvoice.billTo.email = e.target.value));
  $('#notes').addEventListener('input', (e) => (currentInvoice.notes = e.target.value));
  
  $('#tax-rate').addEventListener('input', (e) => {
    currentInvoice.taxRate = Number(e.target.value) || 0;
    updateTotals();
  });
  
  // Client and profile management
  onClick('manage-clients', () => openClients());
  onClick('manage-profiles', () => openProfiles());
  
  $('#client-select').addEventListener('change', (e) => {
    const id = e.target.value;
    const c = clientsCache.find((x) => x.id === id);
    if (!c) return;
    
    currentInvoice.billTo = {
      name: c.name || '',
      address: c.address || '',
      phone: c.phone || '',
      email: c.email || ''
    };
    
    $('#billto-name').value = currentInvoice.billTo.name;
    $('#billto-address').value = currentInvoice.billTo.address;
    $('#billto-phone').value = currentInvoice.billTo.phone;
    $('#billto-email').value = currentInvoice.billTo.email;
  });
  
  $('#from-profile').addEventListener('change', (e) => {
    const id = e.target.value;
    const p = profilesCache.find((x) => x.id === id);
    if (!p) return;
    
    currentInvoice.from = { 
      name: p.name || '', 
      address: p.address || '', 
      phone: p.phone || '', 
      email: p.email || '' 
    };
    
    $('#from-name').value = currentInvoice.from.name;
    $('#from-address').value = currentInvoice.from.address;
  });

  // Navigation
  const setActiveNav = (activeId) => {
    $('.nav-item').forEach((item) => item.classList.remove('active'));
    const activeItem = $(`#${activeId}`);
    if (activeItem) activeItem.classList.add('active');
  };

  onClick('nav-editor', () => {
    setActiveNav('nav-editor');
    showView('editor');
    renderInvoiceForm();
  });
  
  onClick('nav-invoices', async () => {
    setActiveNav('nav-invoices');
    showView('list');
    await renderInvoiceList($('#search').value);
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
  $('#search').addEventListener('input', async (e) => {
    await renderInvoiceList(e.target.value);
  });
  
  // Status filter buttons
  $('[data-status]').forEach(btn => {
    btn.addEventListener('click', async () => {
      // Update active state
      $('[data-status]').forEach(b => b.classList.remove('btn-primary'));
      $('[data-status]').forEach(b => b.classList.add('btn-secondary'));
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
      
      currentListFilter = btn.getAttribute('data-status') || 'all';
      await renderInvoiceList($('#search').value);
    });
  });

  // Settings modal
  onClick('settings-save', async () => {
    try {
      const newSettings = {
        ...appSettings,
        taxRate: Number($('#settings-tax').value) || 0,
        currency: '€',
        business: {
          name: $('#settings-business-name').value || '',
          address: $('#settings-business-address').value || '',
          phone: $('#settings-business-phone').value || '',
          email: $('#settings-business-email').value || ''
        },
        theme: $('#settings-theme').value || 'light'
      };
      
      appSettings = await api.settings.save(newSettings);
      applyTheme();
      
      // Update current invoice defaults
      if (!currentInvoice.currency) currentInvoice.currency = appSettings.currency;
      if (!currentInvoice.taxRate) currentInvoice.taxRate = appSettings.taxRate;
      
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
  if (api.menu) {
    api.menu.onNew(() => newInvoice());
    api.menu.onOpen(async () => {
      setActiveNav('nav-invoices');
      showView('list');
      await renderInvoiceList($('#search').value);
    });
    api.menu.onSave(() => saveInvoice());
    api.menu.onExport(() => exportPdf());
    api.menu.onPrint(() => window.print());
    api.menu.onSettings(() => openSettings());
    api.menu.onToggleTheme(() => toggleTheme());
  }
};

// ---------- Actions ----------
const newInvoice = async () => {
  try {
    const next = await api.invoice.nextNumber();
    currentInvoice = blankInvoice();
    currentInvoice.invoiceNumber = next;
    showView('editor');
    renderInvoiceForm();
    showNotification(`Kreiran novi račun ${next}`, 'success');
  } catch (error) {
    console.error('Error creating new invoice:', error);
    showNotification('Greška pri kreiranju novog računa', 'error');
  }
};

const saveInvoice = async () => {
  if (!currentInvoice.invoiceNumber) {
    showNotification('Broj računa je obavezan', 'warning');
    $('#invoice-number').focus();
    return;
  }
  
  if (!currentInvoice.billTo.name) {
    showNotification('Naziv klijenta je obavezan', 'warning');
    $('#billto-name').focus();
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
    renderPrintArea(currentInvoice);
    window.print();
    showNotification('PDF je spreman za ispis', 'success');
  } catch (error) {
    console.error('Error exporting PDF:', error);
    showNotification('Greška pri izvozu PDF-a', 'error');
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
  $('#settings-modal').classList.add('open');
  $('#settings-tax').value = appSettings?.taxRate ?? 0;
  $('#settings-business-name').value = appSettings?.business?.name || '';
  $('#settings-business-address').value = appSettings?.business?.address || '';
  $('#settings-business-phone').value = appSettings?.business?.phone || '';
  $('#settings-business-email').value = appSettings?.business?.email || '';
  $('#settings-theme').value = appSettings?.theme || 'light';
};

const closeSettings = () => $('#settings-modal').classList.remove('open');

// ---------- Clients Modal ----------
const openClients = async () => {
  $('#clients-modal').classList.add('open');
  await renderClients();
  bindClientEvents();
};

const closeClients = () => {
  $('#clients-modal').classList.remove('open');
  hideClientForm();
};

const bindClientEvents = () => {
  $('#client-search').oninput = async (e) => renderClients(e.target.value);
  $('#client-new').onclick = () => showClientForm();
  $('#client-save').onclick = () => saveClientForm();
  $('#client-cancel').onclick = () => hideClientForm();
  $('#clients-close').onclick = () => closeClients();
};

const renderClients = async (query = '') => {
  try {
    clientsCache = await api.clients.list(query);
    const tbody = $('#clients-body');
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
      
      tr.querySelector('[data-edit]').onclick = () => showClientForm(c);
      tr.querySelector('[data-del]').onclick = async () => {
        if (!confirm(`Obrisati klijenta "${c.name}"?`)) return;
        try {
          await api.clients.delete(c.id);
          await renderClients($('#client-search').value);
          await renderClientDropdown();
          showNotification('Klijent je obrisan', 'success');
        } catch (error) {
          console.error('Error deleting client:', error);
          showNotification('Greška pri brisanju klijenta', 'error');
        }
      };
      
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
  $('#client-name').value = client.name || '';
  $('#client-phone').value = client.phone || '';
  $('#client-email').value = client.email || '';
  $('#client-address').value = client.address || '';
  $('#client-form').style.display = 'block';
  $('#client-name').focus();
};

const hideClientForm = () => {
  editingClientId = null;
  $('#client-form').style.display = 'none';
};

const saveClientForm = async () => {
  const payload = {
    id: editingClientId || undefined,
    name: $('#client-name').value.trim(),
    phone: $('#client-phone').value.trim(),
    email: $('#client-email').value.trim(),
    address: $('#client-address').value.trim()
  };
  
  if (!payload.name) {
    showNotification('Naziv klijenta je obavezan', 'warning');
    $('#client-name').focus();
    return;
  }
  
  try {
    await api.clients.save(payload);
    hideClientForm();
    await renderClients($('#client-search').value);
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
  $('#profiles-modal').classList.add('open');
  await renderProfiles();
  bindProfileEvents();
};

const closeProfiles = () => {
  $('#profiles-modal').classList.remove('open');
  hideProfileForm();
};

const bindProfileEvents = () => {
  $('#profile-search').oninput = async (e) => renderProfiles(e.target.value);
  $('#profile-new').onclick = () => showProfileForm();
  $('#profile-save').onclick = () => saveProfileForm();
  $('#profile-cancel').onclick = () => hideProfileForm();
  $('#profiles-close').onclick = () => closeProfiles();
};

const renderProfiles = async (query = '') => {
  try {
    profilesCache = await api.profiles.list(query);
    const tbody = $('#profiles-body');
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
      
      tr.querySelector('[data-edit]').onclick = () => showProfileForm(p);
      tr.querySelector('[data-del]').onclick = async () => {
        if (!confirm(`Obrisati profil "${p.name}"?`)) return;
        try {
          await api.profiles.delete(p.id);
          await renderProfiles($('#profile-search').value);
          await renderProfileDropdown();
          showNotification('Profil je obrisan', 'success');
        } catch (error) {
          console.error('Error deleting profile:', error);
          showNotification('Greška pri brisanju profila', 'error');
        }
      };
      
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
  $('#profile-name').value = profile.name || '';
  $('#profile-phone').value = profile.phone || '';
  $('#profile-email').value = profile.email || '';
  $('#profile-address').value = profile.address || '';
  $('#profile-form').style.display = 'block';
  $('#profile-name').focus();
};

const hideProfileForm = () => {
  editingProfileId = null;
  $('#profile-form').style.display = 'none';
};

const saveProfileForm = async () => {
  const payload = {
    id: editingProfileId || undefined,
    name: $('#profile-name').value.trim(),
    phone: $('#profile-phone').value.trim(),
    email: $('#profile-email').value.trim(),
    address: $('#profile-address').value.trim()
  };
  
  if (!payload.name) {
    showNotification('Naziv profila je obavezan', 'warning');
    $('#profile-name').focus();
    return;
  }
  
  try {
    await api.profiles.save(payload);
    hideProfileForm();
    await renderProfiles($('#profile-search').value);
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
  $('.view').forEach((view) => view.classList.remove('active'));
  const targetView = $(`#view-${viewName}`);
  if (targetView) targetView.classList.add('active');
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
    // Load settings
    appSettings = await api.settings.get();
    applyTheme();
    
    // Initialize with blank invoice
    currentInvoice = blankInvoice();
    
    // Render initial form
    renderInvoiceForm();
    
    // Bind all events
    bindEvents();
    
    // Load initial data
    await renderInvoiceList();
    await renderClientDropdown();
    await renderProfileDropdown();
    
    // Set initial active filter
    const allFilterBtn = $('[data-status="all"]');
    if (allFilterBtn) {
      allFilterBtn.classList.remove('btn-secondary');
      allFilterBtn.classList.add('btn-primary');
    }
    
    console.log('InvoiceApp initialized successfully');
  } catch (error) {
    console.error('Error initializing app:', error);
    showNotification('Greška pri pokretanju aplikacije', 'error');
  }
});
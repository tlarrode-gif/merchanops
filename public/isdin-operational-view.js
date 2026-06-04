(() => {
  const path = window.location.pathname;
  if (!path.includes('/grandes-campanas/isdin') || path.includes('/dashboard') || path.includes('/facturacion')) return;

  const labels = [
    'Farmacia','VIN','Estado','Comentarios','Obs. ISDIN','Andamio','Revisitas','Tipo','Campaña','Alto','Ancho','Base','Total previsto','Semana actual','Fecha actual','Próx. visita','Semana 1ª visita','Semana instalación','Calle','Nº','Ciudad','CP','Provincia','Instalador','Acciones'
  ];

  function ensurePanel() {
    let panel = document.querySelector('.isdin-detail-panel');
    if (panel) return panel;
    panel = document.createElement('aside');
    panel.className = 'isdin-detail-panel';
    panel.innerHTML = `
      <button class="isdin-detail-close" type="button">Cerrar</button>
      <div class="isdin-detail-header">
        <div class="isdin-detail-title">Detalle del vinilo</div>
        <div class="isdin-detail-subtitle">Selecciona una línea para ver la información completa</div>
      </div>
      <div class="isdin-detail-body"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('.isdin-detail-close')?.addEventListener('click', () => panel.classList.remove('is-open'));
    return panel;
  }

  function textOf(cell) {
    const select = cell.querySelector('select');
    if (select) return select.options[select.selectedIndex]?.text || select.value || '';
    const input = cell.querySelector('input');
    if (input) {
      if (input.type === 'checkbox') return input.checked ? 'Sí' : 'No';
      return input.value || '';
    }
    return cell.textContent?.trim() || '';
  }

  function section(title, fields) {
    return `
      <section class="isdin-detail-section">
        <h3>${title}</h3>
        <div class="isdin-detail-grid">
          ${fields.map(([label, value]) => `
            <div class="isdin-detail-field">
              <span class="isdin-detail-label">${label}</span>
              <span class="isdin-detail-value">${value || '—'}</span>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function openDetail(row) {
    const cells = Array.from(row.children);
    const values = labels.map((label, index) => [label, cells[index] ? textOf(cells[index]) : '']);
    const by = Object.fromEntries(values);
    document.querySelectorAll('.isdin-selected-row').forEach(el => el.classList.remove('isdin-selected-row'));
    row.classList.add('isdin-selected-row');

    const panel = ensurePanel();
    panel.querySelector('.isdin-detail-title').textContent = `${by.VIN || 'VIN'} · ${by.Farmacia || 'Farmacia'}`;
    panel.querySelector('.isdin-detail-subtitle').textContent = `${by['Semana actual'] || 'Sin semana'} · ${by.Provincia || 'Sin provincia'} · ${by.Estado || 'Sin estado'}`;
    panel.querySelector('.isdin-detail-body').innerHTML = [
      section('Resumen operativo', [['VIN', by.VIN], ['Farmacia', by.Farmacia], ['Estado', by.Estado], ['Semana actual', by['Semana actual']], ['Instalador', by.Instalador], ['Provincia', by.Provincia]]),
      section('Dirección', [['Calle', by.Calle], ['Número', by['Nº']], ['Ciudad', by.Ciudad], ['Código postal', by.CP], ['Provincia', by.Provincia]]),
      section('Vinilo', [['Tipo', by.Tipo], ['Campaña', by.Campaña], ['Alto', by.Alto], ['Ancho', by.Ancho], ['Andamio', by.Andamio], ['Revisitas', by.Revisitas]]),
      section('Fechas y pagos', [['Fecha actual', by['Fecha actual']], ['Próxima visita', by['Próx. visita']], ['Semana 1ª visita', by['Semana 1ª visita']], ['Semana instalación', by['Semana instalación']], ['Base', by.Base], ['Total previsto', by['Total previsto']]]),
      section('Comentarios', [['Comentarios internos', by.Comentarios], ['Observaciones ISDIN', by['Obs. ISDIN']]])
    ].join('');
    panel.classList.add('is-open');
  }

  function enhance() {
    const title = Array.from(document.querySelectorAll('h1')).find(h => h.textContent?.includes('ISDIN'));
    if (!title) return;
    const tables = Array.from(document.querySelectorAll('table'));
    const table = tables.find(t => t.textContent?.includes('Farmacia') && t.textContent?.includes('VIN'));
    if (!table || table.classList.contains('isdin-compact-table')) return;
    table.classList.add('isdin-compact-table');
    const card = table.closest('.rounded-3xl, .rounded-2xl, .rounded-xl') || table.parentElement;
    if (card && !card.querySelector('.isdin-operational-note')) {
      const note = document.createElement('div');
      note.className = 'isdin-operational-note';
      note.textContent = 'Vista operativa compacta: se muestran los datos clave. Haz clic en cualquier línea para abrir el detalle completo en el panel lateral. La exportación conserva todos los campos.';
      card.insertBefore(note, card.firstChild);
    }
    Array.from(table.querySelectorAll('tbody tr')).forEach(row => {
      if (row.dataset.isdinEnhanced === 'true') return;
      row.dataset.isdinEnhanced = 'true';
      row.addEventListener('click', (event) => {
        const target = event.target;
        if (target && (target.closest('input') || target.closest('select') || target.closest('button') || target.closest('a'))) return;
        openDetail(row);
      });
    });
  }

  const observer = new MutationObserver(() => enhance());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', enhance);
  setTimeout(enhance, 500);
})();

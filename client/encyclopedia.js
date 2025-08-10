// Starfront: Dominion - Encyclopedia UI
// Lightweight client-side module to render a modal encyclopedia from JSON data

(function() {
  const DATA_URL = 'data/encyclopedia.json';
  const ARCHETYPES_URL = '/game/archetypes';
  let encyclopediaCache = null;
  let activeCategoryId = null;
  let activeEntryId = null;

  async function loadData() {
    if (encyclopediaCache) return encyclopediaCache;
    try {
      const resp = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!resp.ok) throw new Error('Failed to load encyclopedia');
      const data = await resp.json();

      // Enrich with live archetypes as an extra category
      try {
        const archResp = await fetch(ARCHETYPES_URL, { cache: 'no-cache' });
        if (archResp.ok) {
          const { archetypes } = await archResp.json();
          const entries = (archetypes || []).map(a => ({
            id: a.key,
            title: `${a.name}`,
            icon: '🌀',
            tags: ['archetype'],
            summary: `${a.fixedSpecialized?.join(', ') || ''}`,
            content: formatArchetype(a)
          }));
          data.categories.push({ id: 'archetypes', name: 'System Archetypes', icon: '🌀', entries });
        }
      } catch (e) { /* ignore live fetch issues */ }

      encyclopediaCache = data;
      return data;
    } catch (e) {
      console.error('Encyclopedia load error:', e);
      return { version: '0', categories: [], defaultEntry: null };
    }
  }

  function formatArchetype(a){
    const core = a.coreBias || {};
    const coreLines = Object.entries(core).map(([k,v])=>`- ${k}: x${Number(v).toFixed(2)}`).join('\n');
    const fixed = (a.fixedSpecialized||[]).join(', ');
    return `**${a.name}**\n\n${a.description || ''}\n\n**Core Mineral Bias**\n${coreLines}\n\n**Themed Minerals**\n- ${fixed}`;
  }

  function renderModalSkeleton() {
    return {
      title: '📖 Game Encyclopedia',
      content: createModalContent(),
      actions: [
        { text: 'Close', style: 'secondary' }
      ]
    };
  }

  function createModalContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'encyclopedia-modal';

    const body = document.createElement('div');
    body.className = 'encyclopedia-body';

    const sidebar = document.createElement('div');
    sidebar.className = 'encyclopedia-sidebar';

    const tabs = document.createElement('div');
    tabs.className = 'encyclopedia-tabs';
    sidebar.appendChild(tabs);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search entries...';
    searchInput.className = 'sf-input encyclopedia-search';
    sidebar.appendChild(searchInput);

    const list = document.createElement('div');
    list.className = 'encyclopedia-list';
    sidebar.appendChild(list);

    const content = document.createElement('div');
    content.className = 'encyclopedia-content';

    body.appendChild(sidebar);
    body.appendChild(content);
    wrapper.appendChild(body);

    // Store refs for later updates
    wrapper._refs = { tabs, list, content, searchInput };

    return wrapper;
  }

  function renderTabs(root, data) {
    const { tabs } = root._refs;
    tabs.innerHTML = '';
    data.categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'encyclopedia-tab' + (cat.id === activeCategoryId ? ' active' : '');
      btn.textContent = `${cat.icon || '📁'} ${cat.name}`;
      btn.onclick = () => {
        activeCategoryId = cat.id;
        activeEntryId = null;
        renderTabs(root, data);
        renderList(root, data);
        // pick first entry automatically
        if (getActiveCategory(data)?.entries?.length) {
          selectEntry(root, data, getActiveCategory(data).entries[0].id);
        } else {
          renderContent(root, data, null);
        }
      };
      tabs.appendChild(btn);
    });
    // Update active style
    Array.from(tabs.children).forEach(ch => ch.classList.remove('active'));
    const idx = data.categories.findIndex(c => c.id === activeCategoryId);
    if (idx >= 0) tabs.children[idx].classList.add('active');
  }

  function renderList(root, data) {
    const { list, searchInput } = root._refs;
    const cat = getActiveCategory(data);
    list.innerHTML = '';
    if (!cat) return;

    const q = (searchInput.value || '').trim().toLowerCase();
    const entries = (cat.entries || []).filter(e => {
      if (!q) return true;
      return (e.title || '').toLowerCase().includes(q) || (e.tags || []).some(t => (t||'').toLowerCase().includes(q));
    });

    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'encyclopedia-item' + (entry.id === activeEntryId ? ' active' : '');
      item.innerHTML = `${entry.icon || ''} <strong>${entry.title}</strong><div style="color:var(--muted);font-size:0.85em">${entry.summary || ''}</div>`;
      item.onclick = () => selectEntry(root, data, entry.id);
      list.appendChild(item);
    });

    searchInput.oninput = () => renderList(root, data);
  }

  function renderContent(root, data, entry) {
    const { content } = root._refs;
    content.innerHTML = '';
    if (!entry) {
      content.innerHTML = `<h3>Welcome</h3><div class="meta">Select a topic from the left to learn more.</div>`;
      return;
    }
    const title = document.createElement('h3');
    title.textContent = `${entry.icon || ''} ${entry.title}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = (entry.tags && entry.tags.length) ? `Tags: ${entry.tags.join(', ')}` : '';
    const body = document.createElement('div');
    body.innerHTML = formatContent(entry.content || '');
    content.appendChild(title);
    content.appendChild(meta);
    content.appendChild(body);
  }

  function selectEntry(root, data, entryId) {
    activeEntryId = entryId;
    const cat = getActiveCategory(data);
    const entry = (cat?.entries || []).find(e => e.id === entryId) || null;
    renderList(root, data);
    renderContent(root, data, entry);
  }

  function getActiveCategory(data) {
    return data.categories.find(c => c.id === activeCategoryId) || null;
  }

  function ensureDefaults(data) {
    if (!activeCategoryId) {
      if (data.defaultEntry && data.categories.some(c => c.id === data.defaultEntry.categoryId)) {
        activeCategoryId = data.defaultEntry.categoryId;
        activeEntryId = data.defaultEntry.entryId || null;
      } else {
        activeCategoryId = data.categories[0]?.id || null;
        activeEntryId = data.categories[0]?.entries?.[0]?.id || null;
      }
    }
  }

  function formatContent(text) {
    // Tiny formatting: convert line breaks, **bold**, *italic*, and simple bullets
    let html = (text || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.split('\n').map(line => {
      if (line.startsWith('- ')) return `<div>• ${line.slice(2)}</div>`;
      return `<p>${line}</p>`;
    }).join('');
    return html;
  }

  // Public API
  window.openEncyclopedia = async function() {
    const data = await loadData();
    ensureDefaults(data);

    const modal = UI.showModal(renderModalSkeleton());
    // Widen/tall modal container specifically for encyclopedia
    const modalContainer = modal.querySelector('.game-modal-container');
    if (modalContainer) modalContainer.classList.add('encyclopedia-wide');
    const container = modal.querySelector('.game-modal-content');
    // Disable parent scroll so child panes can scroll independently
    if (container) container.classList.add('no-scroll');
    const wrapper = container.firstChild; // our skeleton
    // Make wrapper stretch to container so child panes can use full height
    if (wrapper && wrapper.style) wrapper.style.height = '100%';

    // Render tabs, list, content
    renderTabs(wrapper, data);
    renderList(wrapper, data);

    // Default selection
    if (activeEntryId) {
      const cat = getActiveCategory(data);
      const entry = (cat?.entries || []).find(e => e.id === activeEntryId) || null;
      renderContent(wrapper, data, entry);
    } else {
      // Show default / welcome if present
      const defCat = data.categories.find(c => c.id === data.defaultEntry?.categoryId);
      const defEntry = defCat?.entries?.find(e => e.id === data.defaultEntry?.entryId) || null;
      renderContent(wrapper, data, defEntry);
    }
  };
})();



/**
 * MythosTree - Core Application Logic
 * Pure ES6+, zero external framework dependencies.
 */

class MythosTreeApp {
  constructor() {
    this.characters = [];
    this.idMap = new Map();
    this.nameMap = new Map();
    this.childrenMap = new Map();
    this.categoryMap = new Map();
    this.graph = new Map(); // For kinship BFS pathfinding

    this.viewContainer = document.getElementById('view-container');
    this.searchInput = document.getElementById('search-input');
    this.searchDropdown = document.getElementById('search-dropdown');
    this.btnRandom = document.getElementById('btn-random');
    this.btnPathFinder = document.getElementById('btn-path-finder');
    this.pathModal = document.getElementById('path-modal');
    this.btnClosePathModal = document.getElementById('btn-close-path-modal');
    this.statsCount = document.getElementById('stats-count');

    // Edit & Creation UI Elements
    this.btnNewCharacter = document.getElementById('btn-new-character');
    this.editModal = document.getElementById('edit-modal');
    this.btnCloseEditModal = document.getElementById('btn-close-edit-modal');
    this.btnCancelEdit = document.getElementById('btn-cancel-edit');
    this.editForm = document.getElementById('edit-form');
    this.btnSaveToFile = document.getElementById('btn-save-to-file');
    this.btnExportJson = document.getElementById('btn-export-json');
    this.btnResetDb = document.getElementById('btn-reset-db');
    this.toastContainer = document.getElementById('toast-container');

    // Citation Details Modal
    this.citationModal = document.getElementById('citation-modal');
    this.btnCloseCitationModal = document.getElementById('btn-close-citation-modal');
    this.citationModalContent = document.getElementById('citation-modal-content');

    this.selectedSearchIndex = -1;
    this.dirSortBy = 'name'; // 'name', 'id', 'children'
    this.dirSortAsc = true;

    // Edit mode strictly operates only when served by the local Python development server (localhost / 127.0.0.1)
    // To test the exact public read-only view locally, visit: http://localhost:8000/?readonly=1
    this.isLocal = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                && !window.location.search.includes('readonly=1');

    this.hasLocalEdits = false;
    this.modalCurrentTags = [];
    this.modalCurrentAltNames = [];
    this.modalCurrentParentages = [];
    this.lastSearchQuery = '';

    // Multi-source lineage state
    this.allSources = new Set();
    this.selectedKinshipSources = new Set();
    this.activeChildSourceFilter = 'ALL';
  }

  async init() {
    try {
      await this.loadData();
      this.buildIndexes();
      this.setupEventListeners();
      this.setupRouter();
      this.updateHeaderStats();
      this.updateStagedBar();
    } catch (err) {
      console.error('Initialization error:', err);
      let extraHelp = '';
      if (window.location.protocol === 'file:') {
        extraHelp = `
          <p style="margin-top: 0.85rem; font-size: 0.9rem; color: #f87171; line-height: 1.5;">
            <strong>Browser Security Notice:</strong> Modern browsers block loading local JSON files via <code>file://</code> URLs (CORS policy).
            <br>
            Please double-click <strong>run.bat</strong> to run the local server, or host on GitHub Pages.
          </p>
        `;
      }
      this.viewContainer.innerHTML = `
        <div class="empty-children-card">
          <div class="empty-icon">⚠️</div>
          <h3>Failed to load mythological data</h3>
          <p>${this.escapeHtml(err.message)}</p>
          ${extraHelp}
        </div>
      `;
    }
  }

  async loadData() {
    // 0. Check localStorage for staged local edits (only in local edit mode)
    if (this.isLocal) {
      const staged = localStorage.getItem('mythostree_staged_characters');
      if (staged) {
        try {
          const parsed = JSON.parse(staged);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.characters = parsed;
            this.hasLocalEdits = true;
            return;
          }
        } catch (e) {
          console.warn('Could not parse staged database from localStorage', e);
        }
      }
    }

    // 1. Fetch single source of truth: data/characters.json
    const response = await fetch('data/characters.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while fetching data/characters.json`);
    }
    this.characters = await response.json();
  }

  buildIndexes() {
    this.idMap.clear();
    this.nameMap.clear();
    this.childrenMap.clear();
    this.categoryMap.clear();
    this.graph.clear();
    this.allSources.clear();

    // Pass 1: Index characters and initialize maps
    for (const c of this.characters) {
      this.idMap.set(c.ID, c);
      if (c.Name) {
        this.nameMap.set(c.Name.toLowerCase().trim(), c);
      }
      if (Array.isArray(c.AlternateNames)) {
        for (const alt of c.AlternateNames) {
          if (alt && typeof alt === 'string') {
            const cleanAlt = alt.toLowerCase().trim();
            if (cleanAlt && !this.nameMap.has(cleanAlt)) {
              this.nameMap.set(cleanAlt, c);
            }
          }
        }
      }
      this.childrenMap.set(c.ID, []);
      this.graph.set(c.ID, []);

      // Index Categories
      if (Array.isArray(c.Category)) {
        for (const cat of c.Category) {
          if (!this.categoryMap.has(cat)) {
            this.categoryMap.set(cat, []);
          }
          this.categoryMap.get(cat).push(c);
        }
      }
    }

    // Pass 2: Process Parentages array, collect sources, build dynamic Children entries and Kinship Graph
    for (const c of this.characters) {
      if (!Array.isArray(c.Parentages)) {
        c.Parentages = [];
      }

      for (const p of c.Parentages) {
        const sources = Array.isArray(p.Sources) ? p.Sources.filter(s => typeof s === 'string' && s.trim()) : [];
        p.Sources = sources;
        sources.forEach(s => this.allSources.add(s));

        const notes = p.Notes || '';

        // Father relationship
        if (p.FatherID && this.idMap.has(p.FatherID)) {
          this.childrenMap.get(p.FatherID).push({
            child: c,
            parentage: p,
            otherParentId: p.MotherID,
            sources: sources,
            notes: notes
          });
          this.graph.get(c.ID).push({
            to: p.FatherID,
            relation: 'Father',
            sources: sources
          });
          this.graph.get(p.FatherID).push({
            to: c.ID,
            relation: c.Gender === 'Male' ? 'Son' : 'Daughter',
            sources: sources
          });
        }

        // Mother relationship
        if (p.MotherID && this.idMap.has(p.MotherID)) {
          this.childrenMap.get(p.MotherID).push({
            child: c,
            parentage: p,
            otherParentId: p.FatherID,
            sources: sources,
            notes: notes
          });
          this.graph.get(c.ID).push({
            to: p.MotherID,
            relation: 'Mother',
            sources: sources
          });
          this.graph.get(p.MotherID).push({
            to: c.ID,
            relation: c.Gender === 'Male' ? 'Son' : 'Daughter',
            sources: sources
          });
        }
      }
    }

    // Sync selectedKinshipSources with allSources
    if (this.selectedKinshipSources.size === 0) {
      this.selectedKinshipSources = new Set(this.allSources);
    } else {
      const updated = new Set();
      for (const s of this.selectedKinshipSources) {
        if (this.allSources.has(s)) updated.add(s);
      }
      this.selectedKinshipSources = updated;
    }
  }

  countDirectDescendants(characterId) {
    const visited = new Set();
    const queue = (this.childrenMap.get(characterId) || []).map(entry => entry.child);
    while (queue.length > 0) {
      const child = queue.shift();
      if (!visited.has(child.ID)) {
        visited.add(child.ID);
        const nextGen = (this.childrenMap.get(child.ID) || []).map(entry => entry.child);
        for (const desc of nextGen) {
          if (!visited.has(desc.ID)) {
            queue.push(desc);
          }
        }
      }
    }
    return visited.size;
  }

  updateHeaderStats() {
    if (this.statsCount) {
      this.statsCount.textContent = `${this.characters.length} Deities & Mortals Archive`;
    }
  }

  setupRouter() {
    window.addEventListener('hashchange', () => this.handleRoute());
    // Initial route handling
    if (!window.location.hash || window.location.hash === '#/') {
      // Default to Zeus (ID 61) if available, or first character
      const defaultId = this.idMap.has(61) ? 61 : (this.characters[0]?.ID || 1);
      window.location.hash = `#/character/${defaultId}`;
    } else {
      this.handleRoute();
    }
  }

  handleRoute() {
    const hash = window.location.hash || '';
    const charMatch = hash.match(/^#\/character\/(\d+)/);
    const catMatch = hash.match(/^#\/category\/(.+)/);

    if (hash === '#/all' || hash === '#/characters') {
      this.renderDirectoryView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (charMatch) {
      const charId = parseInt(charMatch[1], 10);
      this.renderCharacterView(charId);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (catMatch) {
      const categoryName = decodeURIComponent(catMatch[1]);
      this.renderCategoryView(categoryName);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const defaultId = this.idMap.has(61) ? 61 : 1;
      this.renderCharacterView(defaultId);
    }
  }

  /* ==========================================================================
     Character Page View
     ========================================================================== */
  renderCharacterView(characterId) {
    const char = this.idMap.get(characterId);
    if (!char) {
      this.viewContainer.innerHTML = `
        <div class="empty-children-card">
          <div class="empty-icon">❓</div>
          <h2>Mythological Figure Not Found</h2>
          <p>No character in the archive matches ID ${characterId}.</p>
          <a href="#/character/61" class="btn-back" style="margin-top: 1rem;">Return to Zeus</a>
        </div>
      `;
      return;
    }

    // Resolve Parentages sorted by consensus (number of sources descending)
    const parentages = (Array.isArray(char.Parentages) ? char.Parentages : [])
      .slice()
      .sort((a, b) => (b.Sources?.length || 0) - (a.Sources?.length || 0));

    const primaryTradition = parentages[0] || null;
    const father = primaryTradition?.FatherID ? this.idMap.get(primaryTradition.FatherID) : null;
    const mother = primaryTradition?.MotherID ? this.idMap.get(primaryTradition.MotherID) : null;

    // Primary tradition sources banner
    let primarySourcesHtml = '';
    if (primaryTradition && Array.isArray(primaryTradition.Sources) && primaryTradition.Sources.length > 0) {
      primarySourcesHtml = `
        <div class="lineage-sources-attested">
          <span class="source-attested-label">Primary tradition attested by:</span>
          <div class="source-attested-tags">
            ${primaryTradition.Sources.map(s => `<span class="source-attested-tag">${this.escapeHtml(s)}</span>`).join('')}
          </div>
          ${primaryTradition.Notes ? `<span class="source-tradition-notes">${this.escapeHtml(primaryTradition.Notes)}</span>` : ''}
        </div>
      `;
    }

    // Alternative parent traditions (if multiple traditions recorded)
    let altTraditionsHtml = '';
    if (parentages.length > 1) {
      const altTraditions = parentages.slice(1);
      altTraditionsHtml = `
        <div class="alt-traditions-section">
          <h3 class="alt-traditions-title">Alternative Lineage Traditions (${altTraditions.length})</h3>
          <div class="alt-traditions-list">
            ${altTraditions.map(alt => {
              const f = alt.FatherID ? this.idMap.get(alt.FatherID) : null;
              const m = alt.MotherID ? this.idMap.get(alt.MotherID) : null;
              const fHtml = f ? `<a href="#/character/${f.ID}" class="alt-parent-link"><strong>${this.escapeHtml(f.Name)}</strong> (Father)</a>` : `<span>Unknown Father</span>`;
              const mHtml = m ? `<a href="#/character/${m.ID}" class="alt-parent-link"><strong>${this.escapeHtml(m.Name)}</strong> (Mother)</a>` : `<span>Unknown Mother</span>`;
              const srcHtml = (alt.Sources && alt.Sources.length > 0)
                ? `<div class="source-attested-tags">${alt.Sources.map(s => `<span class="source-attested-tag">${this.escapeHtml(s)}</span>`).join('')}</div>`
                : '';
              const noteHtml = alt.Notes ? `<span class="alt-tradition-notes">${this.escapeHtml(alt.Notes)}</span>` : '';
              return `
                <div class="alt-tradition-item">
                  <div class="alt-tradition-parents">
                    <span class="alt-bullet">⚡</span>
                    ${fHtml}
                    <span style="color: var(--text-muted);">&bull;</span>
                    ${mHtml}
                  </div>
                  ${srcHtml}
                  ${noteHtml}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // Resolve Children dynamically from childrenMap
    const rawChildEntries = this.childrenMap.get(characterId) || [];
    const uniqueChildIds = new Set(rawChildEntries.map(e => e.child.ID));
    const childCount = uniqueChildIds.size;
    const descendantCount = this.countDirectDescendants(characterId);

    // Collect distinct sources attested across this character's children
    const childSourcesSet = new Set();
    rawChildEntries.forEach(e => (e.sources || []).forEach(s => childSourcesSet.add(s)));
    const childSources = Array.from(childSourcesSet).sort();

    // Verify current source filter validity
    if (this.activeChildSourceFilter !== 'ALL' && !childSourcesSet.has(this.activeChildSourceFilter)) {
      this.activeChildSourceFilter = 'ALL';
    }

    // Filter child entries based on active source filter
    const filteredEntries = this.activeChildSourceFilter === 'ALL'
      ? rawChildEntries
      : rawChildEntries.filter(e => (e.sources || []).includes(this.activeChildSourceFilter));

    // Group filtered entries by unique child ID
    const childrenGroupMap = new Map();
    filteredEntries.forEach(e => {
      if (!childrenGroupMap.has(e.child.ID)) {
        childrenGroupMap.set(e.child.ID, { child: e.child, entries: [] });
      }
      childrenGroupMap.get(e.child.ID).entries.push(e);
    });
    const visibleChildren = Array.from(childrenGroupMap.values());

    // Children filter toolbar
    let childrenFilterToolbarHtml = '';
    if (childSources.length > 0) {
      childrenFilterToolbarHtml = `
        <div class="children-filter-toolbar">
          <span class="children-filter-label">Filter by Source:</span>
          <div class="child-source-filter-pills">
            <button type="button" class="child-source-filter-pill ${this.activeChildSourceFilter === 'ALL' ? 'active' : ''}" data-source="ALL">
              All Sources (${childCount})
            </button>
            ${childSources.map(s => {
              const count = new Set(rawChildEntries.filter(e => (e.sources || []).includes(s)).map(e => e.child.ID)).size;
              return `
                <button type="button" class="child-source-filter-pill ${this.activeChildSourceFilter === s ? 'active' : ''}" data-source="${this.escapeHtml(s)}">
                  ${this.escapeHtml(s)} (${count})
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // Categories HTML
    const categoriesHtml = (char.Category && char.Category.length > 0)
      ? char.Category.map(cat => `
          <a href="#/category/${encodeURIComponent(cat)}" class="category-tag" title="Browse all ${this.escapeHtml(cat)}">
            <span>🏛️</span>
            <span>${this.escapeHtml(cat)}</span>
          </a>
        `).join('')
      : `<span class="id-badge">Uncategorized</span>`;

    // Wikipedia button HTML
    const wikiBtnHtml = char.Wikipedia
      ? `
        <a href="${this.escapeHtml(char.Wikipedia)}" target="_blank" rel="noopener noreferrer" class="wiki-btn" title="Open Wikipedia article in a new tab">
          <span>Wikipedia</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>
      `
      : '';

    // Alternate Names HTML
    const altNamesHtml = (char.AlternateNames && char.AlternateNames.length > 0)
      ? `
        <div class="hero-alt-names">
          <span class="hero-alt-names-label">Also known as:</span>
          <span class="hero-alt-names-text">${char.AlternateNames.map(an => this.escapeHtml(an)).join(', ')}</span>
        </div>
      `
      : '';

    // Gender styling
    const isMale = char.Gender === 'Male';
    const genderClass = isMale ? 'male' : 'female';
    const genderSymbol = isMale ? '♂' : '♀';

    // Parent Card Generator
    const renderParentCard = (parent, role, defaultIcon) => {
      if (parent) {
        return `
          <a href="#/character/${parent.ID}" class="parent-card" title="View ${role}: ${this.escapeHtml(parent.Name)}">
            <div class="parent-avatar">${parent.Gender === 'Male' ? '👑' : '✨'}</div>
            <div class="parent-info">
              <span class="parent-role">${role}</span>
              <span class="parent-name">${this.escapeHtml(parent.Name)}</span>
              <span class="parent-desc">${this.escapeHtml(parent.Description || 'No lore recorded')}</span>
            </div>
          </a>
        `;
      }
      return `
        <div class="parent-card empty-parent">
          <div class="parent-avatar">${defaultIcon}</div>
          <div class="parent-info">
            <span class="parent-role">${role}</span>
            <span class="parent-name">Primordial / Unknown</span>
            <span class="parent-desc">No parent recorded in the lineage archive</span>
          </div>
        </div>
      `;
    };

    // Children Cards Generator
    let childrenHtml = '';
    if (visibleChildren.length > 0) {
      childrenHtml = `
        <div class="children-grid">
          ${visibleChildren.map(({ child, entries }) => {
            // Find other parents across these entries
            const otherParentNames = [];
            entries.forEach(e => {
              if (e.otherParentId && this.idMap.has(e.otherParentId)) {
                const otherParent = this.idMap.get(e.otherParentId);
                const srcStr = e.sources.length > 0 ? ` (${e.sources.slice(0, 2).join(', ')})` : '';
                const str = `${otherParent.Name}${srcStr}`;
                if (!otherParentNames.includes(str)) otherParentNames.push(str);
              }
            });

            const otherParentStr = otherParentNames.length > 0
              ? `<span class="child-meta">with ${this.escapeHtml(otherParentNames.join('; '))}</span>`
              : '';

            const childGenderIcon = child.Gender === 'Male' ? '♂' : '♀';
            const childCategories = (child.Category || []).slice(0, 3).map(cat => 
              `<span class="child-category-pill">${this.escapeHtml(cat)}</span>`
            ).join('');

            return `
              <div class="child-card-wrapper" style="position: relative;">
                <a href="#/character/${child.ID}" class="child-card" title="View child: ${this.escapeHtml(child.Name)}">
                  <div class="child-top">
                    <span class="child-name">${this.escapeHtml(child.Name || 'Unnamed')}</span>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <span class="child-meta">${childGenderIcon} #${child.ID}</span>
                      <button type="button" class="btn-child-info" data-child-id="${child.ID}" title="View citation sources & tradition details">ℹ️</button>
                    </div>
                  </div>
                  ${otherParentStr}
                  <p class="child-desc">${this.escapeHtml(child.Description || 'No description recorded')}</p>
                  <div class="child-categories">${childCategories}</div>
                </a>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else if (childCount > 0) {
      childrenHtml = `
        <div class="empty-children-card">
          <div class="empty-icon">🔍</div>
          <p>No children recorded under source <strong>"${this.escapeHtml(this.activeChildSourceFilter)}"</strong> for <strong>${this.escapeHtml(char.Name)}</strong>.</p>
        </div>
      `;
    } else {
      childrenHtml = `
        <div class="empty-children-card">
          <div class="empty-icon">🌿</div>
          <p>No recorded children for <strong>${this.escapeHtml(char.Name)}</strong> in this lineage dataset.</p>
        </div>
      `;
    }

    const editBtnHtml = this.isLocal ? `
      <button class="btn-edit-hero" id="btn-edit-hero" title="Edit this character's record">
        <span>✏️</span>
        <span>Edit</span>
      </button>
    ` : '';

    // Resolve Previous and Next characters by ID
    const sortedChars = [...this.characters].sort((a, b) => a.ID - b.ID);
    const currentIndex = sortedChars.findIndex(c => c.ID === char.ID);
    const prevChar = currentIndex > 0 ? sortedChars[currentIndex - 1] : null;
    const nextChar = currentIndex >= 0 && currentIndex < sortedChars.length - 1 ? sortedChars[currentIndex + 1] : null;

    const prevBtnHtml = prevChar
      ? `
        <a href="#/character/${prevChar.ID}" class="id-nav-arrow" title="Previous figure: ${this.escapeHtml(prevChar.Name)} (#${prevChar.ID})" aria-label="Previous character #${prevChar.ID}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </a>
      `
      : `
        <span class="id-nav-arrow disabled" aria-hidden="true" title="No previous figure">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </span>
      `;

    const nextBtnHtml = nextChar
      ? `
        <a href="#/character/${nextChar.ID}" class="id-nav-arrow" title="Next figure: ${this.escapeHtml(nextChar.Name)} (#${nextChar.ID})" aria-label="Next character #${nextChar.ID}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </a>
      `
      : `
        <span class="id-nav-arrow disabled" aria-hidden="true" title="No next figure">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </span>
      `;

    // Render Full Page
    this.viewContainer.innerHTML = `
      <!-- Hero Card -->
      <section class="character-hero-card">
        <div class="hero-top-meta">
          <div class="badge-group">
            <div class="id-nav-group">
              ${prevBtnHtml}
              <span class="id-badge">ID #${char.ID}</span>
              ${nextBtnHtml}
            </div>
            <span class="gender-badge ${genderClass}">
              <span>${genderSymbol}</span>
              <span>${char.Gender}</span>
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            ${editBtnHtml}
            ${wikiBtnHtml}
          </div>
        </div>

        <h1 class="hero-name">${this.escapeHtml(char.Name || 'Unnamed Figure')}</h1>
        ${altNamesHtml}

        <div class="hero-categories">
          ${categoriesHtml}
        </div>

        <div class="hero-description">
          <p>${this.escapeHtml(char.Description || 'No description available in the archive.')}</p>
        </div>
      </section>

      <!-- Lineage Section -->
      <section class="lineage-section">
        <!-- Parents & Traditions -->
        <div>
          <div class="section-header">
            <h2 class="section-title">Parents & Lineage</h2>
          </div>
          <div class="parents-grid">
            ${renderParentCard(father, 'Father', '⚡')}
            ${renderParentCard(mother, 'Mother', '🌙')}
          </div>
          ${primarySourcesHtml}
          ${altTraditionsHtml}
        </div>

        <!-- Children (Dynamically built from JSON) -->
        <div>
          <div class="section-header children-header-row">
            <h2 class="section-title">Children:</h2>
            <div class="descendants-stat-line">
              <span class="stat-number">${childCount}</span> ${childCount === 1 ? 'child' : 'children'}, 
              <span class="stat-number">${descendantCount}</span> direct ${descendantCount === 1 ? 'descendant' : 'descendants'} in database
            </div>
          </div>
          ${childrenFilterToolbarHtml}
          ${childrenHtml}
        </div>
      </section>
    `;

    // Wire Edit Button
    if (this.isLocal) {
      document.getElementById('btn-edit-hero')?.addEventListener('click', () => {
        this.openEditModal(characterId);
      });
    }

    // Wire Child Source Filter Buttons
    this.viewContainer.querySelectorAll('.child-source-filter-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const src = e.currentTarget.getAttribute('data-source');
        this.activeChildSourceFilter = src;
        this.renderCharacterView(characterId);
      });
    });

    // Wire Child Info (ℹ️) buttons to open citation modal
    this.viewContainer.querySelectorAll('.btn-child-info').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const childId = parseInt(e.currentTarget.getAttribute('data-child-id'), 10);
        const childChar = this.idMap.get(childId);
        if (childChar) {
          this.openCitationModal(char, childChar);
        }
      });
    });
  }

  /* ==========================================================================
     Citation Details Modal
     ========================================================================== */
  openCitationModal(parentChar, childChar) {
    if (!this.citationModal || !this.citationModalContent) return;

    // Filter traditions of child that involve parentChar, or all traditions of child
    const childParentages = Array.isArray(childChar.Parentages) ? childChar.Parentages : [];
    const relevantTraditions = childParentages.filter(p => p.FatherID === parentChar.ID || p.MotherID === parentChar.ID);
    const traditions = relevantTraditions.length > 0 ? relevantTraditions : childParentages;

    let traditionsHtml = '';
    if (traditions.length === 0) {
      traditionsHtml = `
        <p style="color: var(--text-muted); font-size: 0.9rem; padding: 1rem; text-align: center;">
          No parentage traditions or classical citations recorded for this relationship.
        </p>
      `;
    } else {
      traditionsHtml = traditions.map((t, idx) => {
        const father = t.FatherID ? this.idMap.get(t.FatherID) : null;
        const mother = t.MotherID ? this.idMap.get(t.MotherID) : null;
        const isConsensus = idx === 0;

        const fatherLink = father
          ? `<a href="#/character/${father.ID}" onclick="document.getElementById('citation-modal').classList.add('hidden')">${this.escapeHtml(father.Name)}</a>`
          : '<span style="color: var(--text-muted);">Unknown Father</span>';

        const motherLink = mother
          ? `<a href="#/character/${mother.ID}" onclick="document.getElementById('citation-modal').classList.add('hidden')">${this.escapeHtml(mother.Name)}</a>`
          : '<span style="color: var(--text-muted);">Unknown Mother</span>';

        const sources = Array.isArray(t.Sources) ? t.Sources : [];
        const sourcesHtml = sources.length > 0
          ? sources.map(s => `<span class="source-attested-tag">${this.escapeHtml(s)}</span>`).join('')
          : '<span style="color: var(--text-muted); font-size: 0.8rem; font-style: italic;">No specific source tag</span>';

        const notesHtml = t.Notes
          ? `<div style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--gold-200); font-style: italic;">📝 ${this.escapeHtml(t.Notes)}</div>`
          : '';

        return `
          <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-gold); border-radius: 8px; padding: 0.9rem; margin-bottom: 0.75rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
              <span style="font-size: 0.85rem; font-weight: 600; color: var(--gold-400);">
                Tradition #${idx + 1}
                ${isConsensus ? '<span style="background: var(--gold-500); color: #000; font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-left: 0.5rem;">Consensus</span>' : ''}
              </span>
              <span style="font-size: 0.78rem; color: var(--text-muted);">${sources.length} Attesting ${sources.length === 1 ? 'Source' : 'Sources'}</span>
            </div>
            <div style="font-size: 0.9rem; margin-bottom: 0.5rem; color: var(--text-secondary);">
              <strong>Father:</strong> ${fatherLink} &nbsp;&bull;&nbsp; <strong>Mother:</strong> ${motherLink}
            </div>
            <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
              <span style="font-size: 0.8rem; color: var(--text-muted);">Sources:</span>
              ${sourcesHtml}
            </div>
            ${notesHtml}
          </div>
        `;
      }).join('');
    }

    this.citationModalContent.innerHTML = `
      <div style="margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.08);">
        <h3 style="margin: 0 0 0.25rem 0; font-size: 1.25rem; color: var(--gold-300);">${this.escapeHtml(childChar.Name)}</h3>
        <p style="margin: 0; font-size: 0.85rem; color: var(--text-muted);">Lineage traditions and classical citations as offspring of <strong>${this.escapeHtml(parentChar.Name)}</strong></p>
      </div>
      <div>
        ${traditionsHtml}
      </div>
    `;

    this.citationModal.classList.remove('hidden');
  }

  closeCitationModal() {
    if (this.citationModal) {
      this.citationModal.classList.add('hidden');
    }
  }

  /* ==========================================================================
     Category Roster View
     ========================================================================== */
  renderCategoryView(categoryName) {
    const members = this.categoryMap.get(categoryName) || [];

    this.viewContainer.innerHTML = `
      <div class="category-roster-header">
        <button class="btn-back" onclick="window.history.back()">
          ← Return to Character
        </button>
        <h1 class="category-title">${this.escapeHtml(categoryName)}</h1>
        <p class="category-subtitle">Showing all ${members.length} figures classified as ${this.escapeHtml(categoryName)}.</p>
      </div>

      <div class="children-grid">
        ${members.map(m => `
          <a href="#/character/${m.ID}" class="child-card">
            <div class="child-top">
              <span class="child-name">${this.escapeHtml(m.Name || 'Unnamed')}</span>
              <span class="child-meta">${m.Gender === 'Male' ? '♂' : '♀'} #${m.ID}</span>
            </div>
            <p class="child-desc">${this.escapeHtml(m.Description || 'No description recorded')}</p>
            <div class="child-categories">
              ${(m.Category || []).map(cat => `<span class="child-category-pill">${this.escapeHtml(cat)}</span>`).join('')}
            </div>
          </a>
        `).join('')}
      </div>
    `;
  }

  /* ==========================================================================
     All Characters Directory View with Sorting
     ========================================================================== */
  renderDirectoryView() {
    // Clone characters array for sorting
    const sorted = [...this.characters];

    sorted.sort((a, b) => {
      let cmp = 0;
      if (this.dirSortBy === 'name') {
        const nameA = (a.Name || '').toLowerCase();
        const nameB = (b.Name || '').toLowerCase();
        cmp = nameA.localeCompare(nameB);
      } else if (this.dirSortBy === 'id') {
        cmp = a.ID - b.ID;
      } else if (this.dirSortBy === 'children') {
        const cA = new Set((this.childrenMap.get(a.ID) || []).map(e => e.child.ID)).size;
        const cB = new Set((this.childrenMap.get(b.ID) || []).map(e => e.child.ID)).size;
        cmp = cA - cB;
      }
      return this.dirSortAsc ? cmp : -cmp;
    });

    const isNameActive = this.dirSortBy === 'name' ? 'active' : '';
    const isIdActive = this.dirSortBy === 'id' ? 'active' : '';
    const isChildrenActive = this.dirSortBy === 'children' ? 'active' : '';
    const dirIcon = this.dirSortAsc ? '↑' : '↓';
    const dirLabel = this.dirSortAsc ? 'Ascending' : 'Descending';

    this.viewContainer.innerHTML = `
      <div class="category-roster-header">
        <button class="btn-back" onclick="window.history.back()">
          ← Return to Character
        </button>
        <h1 class="category-title">All Deities & Mortals Archive</h1>
        <p class="category-subtitle">Comprehensive archive of all ${this.characters.length} mythological figures.</p>
      </div>

      <!-- Sorting & Filter Controls Toolbar -->
      <div class="directory-toolbar">
        <div class="sort-controls-group">
          <span class="sort-label">Sort By:</span>
          <div class="sort-options-pills">
            <button class="sort-pill-btn ${isNameActive}" id="sort-btn-name">Alphabetical</button>
            <button class="sort-pill-btn ${isIdActive}" id="sort-btn-id">ID</button>
            <button class="sort-pill-btn ${isChildrenActive}" id="sort-btn-children">Number of Children</button>
          </div>
          <button class="sort-dir-toggle" id="sort-dir-toggle" title="Toggle sort direction">
            <span class="sort-dir-icon">${dirIcon}</span>
            <span>${dirLabel}</span>
          </button>
        </div>

        <div style="font-size: 0.85rem; color: var(--text-muted);">
          Showing <strong>${sorted.length}</strong> figures
        </div>
      </div>

      <!-- Characters Grid -->
      <div class="children-grid">
        ${sorted.map(m => {
          const uniqueChildren = new Set((this.childrenMap.get(m.ID) || []).map(e => e.child.ID));
          const childCount = uniqueChildren.size;
          const genderIcon = m.Gender === 'Male' ? '♂' : '♀';
          const altSub = (m.AlternateNames && m.AlternateNames.length > 0)
            ? `<span class="child-alias-meta">aka ${this.escapeHtml(m.AlternateNames.slice(0, 2).join(', '))}${m.AlternateNames.length > 2 ? '...' : ''}</span>`
            : '';

          return `
            <a href="#/character/${m.ID}" class="child-card">
              <div class="child-top">
                <span class="child-name">${this.escapeHtml(m.Name || 'Unnamed')}</span>
                <span class="child-meta">${genderIcon} #${m.ID}</span>
              </div>
              ${altSub}
              <p class="child-desc">${this.escapeHtml(m.Description || 'No description recorded')}</p>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding-top: 0.5rem;">
                <div class="child-categories">
                  ${(m.Category || []).slice(0, 2).map(cat => `<span class="child-category-pill">${this.escapeHtml(cat)}</span>`).join('')}
                </div>
                <span class="child-count-pill">${childCount} ${childCount === 1 ? 'Child' : 'Children'}</span>
              </div>
            </a>
          `;
        }).join('')}
      </div>
    `;

    // Attach click listeners to toolbar controls
    document.getElementById('sort-btn-name')?.addEventListener('click', () => {
      if (this.dirSortBy === 'name') {
        this.dirSortAsc = !this.dirSortAsc;
      } else {
        this.dirSortBy = 'name';
        this.dirSortAsc = true;
      }
      this.renderDirectoryView();
    });

    document.getElementById('sort-btn-id')?.addEventListener('click', () => {
      if (this.dirSortBy === 'id') {
        this.dirSortAsc = !this.dirSortAsc;
      } else {
        this.dirSortBy = 'id';
        this.dirSortAsc = true;
      }
      this.renderDirectoryView();
    });

    document.getElementById('sort-btn-children')?.addEventListener('click', () => {
      if (this.dirSortBy === 'children') {
        this.dirSortAsc = !this.dirSortAsc;
      } else {
        this.dirSortBy = 'children';
        this.dirSortAsc = false; // default to most children first
      }
      this.renderDirectoryView();
    });

    document.getElementById('sort-dir-toggle')?.addEventListener('click', () => {
      this.dirSortAsc = !this.dirSortAsc;
      this.renderDirectoryView();
    });
  }

  /* ==========================================================================
     Header Controls (Search, Random, Kinship Path)
     ========================================================================== */
  setupEventListeners() {
    // 1. Random Button
    if (this.btnRandom) {
      this.btnRandom.addEventListener('click', () => {
        if (this.characters.length === 0) return;
        const randomIdx = Math.floor(Math.random() * this.characters.length);
        const randomChar = this.characters[randomIdx];
        window.location.hash = `#/character/${randomChar.ID}`;
      });
    }

    // 2. Search Box Input
    if (this.searchInput) {
      this.searchInput.addEventListener('input', (e) => this.handleSearchInput(e.target.value));
      this.searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
      
      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#search-wrapper')) {
          this.searchDropdown.classList.add('hidden');
        }
      });
    }

    // 3. Global Hotkey: '/' or 'Ctrl+K' focuses search; Left/Right arrows navigate characters by ID
    window.addEventListener('keydown', (e) => {
      if ((e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'k')) && document.activeElement !== this.searchInput) {
        e.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
        return;
      }

      // Left/Right arrow navigation when not focused on form controls or modals
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (!this.editModal?.classList.contains('hidden') || 
            !this.pathModal?.classList.contains('hidden') || 
            !this.citationModal?.classList.contains('hidden')) return;

        const hash = window.location.hash || '';
        const charMatch = hash.match(/^#\/character\/(\d+)/);
        if (charMatch) {
          const charId = parseInt(charMatch[1], 10);
          const sortedChars = [...this.characters].sort((a, b) => a.ID - b.ID);
          const currentIndex = sortedChars.findIndex(c => c.ID === charId);
          if (e.key === 'ArrowLeft' && currentIndex > 0) {
            e.preventDefault();
            window.location.hash = `#/character/${sortedChars[currentIndex - 1].ID}`;
          } else if (e.key === 'ArrowRight' && currentIndex >= 0 && currentIndex < sortedChars.length - 1) {
            e.preventDefault();
            window.location.hash = `#/character/${sortedChars[currentIndex + 1].ID}`;
          }
        }
      }
    });

    // 4. Path Finder Modal Handlers
    if (this.btnPathFinder) {
      this.btnPathFinder.addEventListener('click', () => this.openPathModal());
    }
    if (this.btnClosePathModal) {
      this.btnClosePathModal.addEventListener('click', () => this.closePathModal());
    }
    if (this.pathModal) {
      this.pathModal.addEventListener('click', (e) => {
        if (e.target === this.pathModal) this.closePathModal();
      });
    }

    // Kinship Sources Filter buttons
    document.getElementById('btn-kinship-select-all')?.addEventListener('click', () => {
      this.selectedKinshipSources = new Set(this.allSources);
      this.renderKinshipSourceChips();
    });
    document.getElementById('btn-kinship-clear-all')?.addEventListener('click', () => {
      this.selectedKinshipSources.clear();
      this.renderKinshipSourceChips();
    });

    const pathForm = document.getElementById('path-form');
    if (pathForm) {
      pathForm.addEventListener('submit', () => this.calculateKinshipPath());
    }

    this.setupPathInputSuggestions('path-start-input', 'path-start-suggest');
    this.setupPathInputSuggestions('path-end-input', 'path-end-suggest');

    // 5. Citation Modal Handlers
    if (this.btnCloseCitationModal) {
      this.btnCloseCitationModal.addEventListener('click', () => this.closeCitationModal());
    }
    if (this.citationModal) {
      this.citationModal.addEventListener('click', (e) => {
        if (e.target === this.citationModal) this.closeCitationModal();
      });
    }

    // 6. Edit & Creation Handlers (Local Mode)
    if (this.btnNewCharacter) {
      if (!this.isLocal) {
        this.btnNewCharacter.style.display = 'none';
      } else {
        this.btnNewCharacter.addEventListener('click', () => this.openCreateModal());
      }
    }

    if (this.btnCloseEditModal) {
      this.btnCloseEditModal.addEventListener('click', () => this.closeEditModal());
    }
    if (this.btnCancelEdit) {
      this.btnCancelEdit.addEventListener('click', () => this.closeEditModal());
    }

    if (this.editForm) {
      this.editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveCharacter();
      });
    }

    // Dynamic Parentage Repeater Add Button
    document.getElementById('btn-add-parentage-pair')?.addEventListener('click', () => {
      this.addParentagePair();
    });

    // Tag Editor handlers
    const btnAddTag = document.getElementById('btn-add-tag');
    const tagNewInput = document.getElementById('tag-new-input');
    if (btnAddTag && tagNewInput) {
      btnAddTag.addEventListener('click', () => this.addTagFromInput());
      tagNewInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.addTagFromInput();
        }
      });
      this.setupTagSuggestions();
    }

    // Alternate Names Editor handlers
    const btnAddAltName = document.getElementById('btn-add-alt-name');
    const altNameNewInput = document.getElementById('alt-name-new-input');
    if (btnAddAltName && altNameNewInput) {
      btnAddAltName.addEventListener('click', () => this.addAltNameFromInput());
      altNameNewInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.addAltNameFromInput();
        }
      });
    }

    // Staged Changes Direct Save, Export & Reset
    if (this.btnSaveToFile) {
      this.btnSaveToFile.addEventListener('click', () => this.saveDatabaseToFile());
    }
    if (this.btnExportJson) {
      this.btnExportJson.addEventListener('click', () => this.exportDatabase());
    }
    if (this.btnResetDb) {
      this.btnResetDb.addEventListener('click', () => this.resetDatabase());
    }
  }

  /* ==========================================================================
     Live Search Autocomplete
     ========================================================================== */
  handleSearchInput(query) {
    const q = query.trim().toLowerCase();
    this.lastSearchQuery = q;
    if (!q) {
      this.searchDropdown.innerHTML = '';
      this.searchDropdown.classList.add('hidden');
      return;
    }

    // Filter characters by name, alternate names, category, or ID
    const results = this.characters.filter(c => {
      const name = (c.Name || '').toLowerCase();
      const idMatch = String(c.ID) === q;
      const nameMatch = name.includes(q);
      const altMatch = (c.AlternateNames || []).some(an => (an || '').toLowerCase().includes(q));
      const catMatch = (c.Category || []).some(cat => cat.toLowerCase().includes(q));
      return idMatch || nameMatch || altMatch || catMatch;
    }).slice(0, 8); // top 8 results

    this.renderSearchResults(results, q);
  }

  renderSearchResults(results, query = '') {
    if (results.length === 0) {
      this.searchDropdown.innerHTML = `
        <div style="padding: 0.75rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
          No characters or categories found
        </div>
      `;
      this.searchDropdown.classList.remove('hidden');
      return;
    }

    this.searchDropdown.innerHTML = results.map((r, i) => {
      let altMatchStr = '';
      if (r.AlternateNames && r.AlternateNames.length > 0 && query) {
        const matchingAlt = r.AlternateNames.find(an => (an || '').toLowerCase().includes(query));
        if (matchingAlt && (r.Name || '').toLowerCase() !== matchingAlt.toLowerCase()) {
          altMatchStr = `<span style="color: var(--cyan-400); font-size: 0.76rem; font-weight: normal; margin-left: 0.35rem;">(aka ${this.escapeHtml(matchingAlt)})</span>`;
        }
      }

      return `
        <div class="search-result-item" data-id="${r.ID}" data-index="${i}" onclick="window.location.hash='#/character/${r.ID}'; document.getElementById('search-dropdown').classList.add('hidden'); document.getElementById('search-input').value='';">
          <div class="result-info">
            <span class="result-name">${this.escapeHtml(r.Name || 'Unnamed')}${altMatchStr}</span>
            <span class="result-desc">${this.escapeHtml(r.Description || '')}</span>
          </div>
          <div class="result-tags">
            ${(r.Category || []).slice(0, 1).map(cat => `<span class="result-tag-pill">${this.escapeHtml(cat)}</span>`).join('')}
          </div>
        </div>
      `;
    }).join('');

    this.selectedSearchIndex = -1;
    this.searchDropdown.classList.remove('hidden');
  }

  handleSearchKeydown(e) {
    const items = this.searchDropdown.querySelectorAll('.search-result-item');
    if (!items.length || this.searchDropdown.classList.contains('hidden')) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedSearchIndex = (this.selectedSearchIndex + 1) % items.length;
      this.highlightSearchItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedSearchIndex = (this.selectedSearchIndex - 1 + items.length) % items.length;
      this.highlightSearchItem(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.selectedSearchIndex >= 0 && items[this.selectedSearchIndex]) {
        items[this.selectedSearchIndex].click();
      }
    } else if (e.key === 'Escape') {
      this.searchDropdown.classList.add('hidden');
      this.searchInput.blur();
    }
  }

  highlightSearchItem(items) {
    items.forEach((item, idx) => {
      item.classList.toggle('selected', idx === this.selectedSearchIndex);
      if (idx === this.selectedSearchIndex) {
        item.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  /* ==========================================================================
     Kinship Path Finder (BFS Shortest Path with Source Selection)
     ========================================================================== */
  openPathModal() {
    this.pathModal.classList.remove('hidden');
    this.renderKinshipSourceChips();

    // Prepopulate Start input with current character if viewing one
    const hash = window.location.hash || '';
    const charMatch = hash.match(/^#\/character\/(\d+)/);
    if (charMatch) {
      const char = this.idMap.get(parseInt(charMatch[1], 10));
      if (char) {
        document.getElementById('path-start-input').value = char.Name;
      }
    }
  }

  closePathModal() {
    this.pathModal.classList.add('hidden');
  }

  renderKinshipSourceChips() {
    const container = document.getElementById('kinship-source-chips');
    if (!container) return;

    const sourcesList = Array.from(this.allSources).sort();
    if (sourcesList.length === 0) {
      container.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-muted); font-style: italic;">No specific classical sources recorded in dataset yet</span>';
      return;
    }

    container.innerHTML = sourcesList.map(s => {
      const isActive = this.selectedKinshipSources.has(s);
      return `
        <button type="button" class="source-chip ${isActive ? 'active' : ''}" data-source="${this.escapeHtml(s)}">
          ${this.escapeHtml(s)}
        </button>
      `;
    }).join('');

    container.querySelectorAll('.source-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const src = e.currentTarget.getAttribute('data-source');
        if (this.selectedKinshipSources.has(src)) {
          this.selectedKinshipSources.delete(src);
        } else {
          this.selectedKinshipSources.add(src);
        }
        this.renderKinshipSourceChips();
      });
    });
  }

  setupPathInputSuggestions(inputId, suggestId) {
    const input = document.getElementById(inputId);
    const suggest = document.getElementById(suggestId);
    if (!input || !suggest) return;

    input.addEventListener('input', (e) => {
      const val = e.target.value.trim().toLowerCase();
      if (!val) {
        suggest.classList.add('hidden');
        return;
      }
      const matches = this.characters.filter(c => {
        const nameMatch = (c.Name || '').toLowerCase().includes(val);
        const altMatch = (c.AlternateNames || []).some(an => (an || '').toLowerCase().includes(val));
        return nameMatch || altMatch;
      }).slice(0, 6);

      if (!matches.length) {
        suggest.classList.add('hidden');
        return;
      }

      suggest.innerHTML = matches.map(m => {
        let altStr = '';
        if (m.AlternateNames && m.AlternateNames.length > 0) {
          const matchedAlt = m.AlternateNames.find(an => (an || '').toLowerCase().includes(val));
          if (matchedAlt && (m.Name || '').toLowerCase() !== matchedAlt.toLowerCase()) {
            altStr = ` <span style="color: var(--cyan-400); font-size: 0.75rem;">(aka ${this.escapeHtml(matchedAlt)})</span>`;
          }
        }
        return `
          <div class="path-suggest-item" onclick="document.getElementById('${inputId}').value = '${this.escapeHtml(m.Name)}'; document.getElementById('${suggestId}').classList.add('hidden');">
            <strong>${this.escapeHtml(m.Name)}</strong>${altStr} (#${m.ID})
          </div>
        `;
      }).join('');
      suggest.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest(`#${inputId}`) && !e.target.closest(`#${suggestId}`)) {
        suggest.classList.add('hidden');
      }
    });
  }

  calculateKinshipPath() {
    const startName = document.getElementById('path-start-input').value.trim().toLowerCase();
    const endName = document.getElementById('path-end-input').value.trim().toLowerCase();
    const resultsContainer = document.getElementById('path-results');

    const startChar = this.nameMap.get(startName) || this.characters.find(c => String(c.ID) === startName);
    const endChar = this.nameMap.get(endName) || this.characters.find(c => String(c.ID) === endName);

    if (!startChar || !endChar) {
      resultsContainer.innerHTML = `
        <p style="color: #F87171; font-size: 0.9rem;">
          Could not find one or both characters. Please verify the spelling.
        </p>
      `;
      resultsContainer.classList.remove('hidden');
      return;
    }

    if (startChar.ID === endChar.ID) {
      resultsContainer.innerHTML = `
        <p style="color: var(--gold-400); font-size: 0.9rem;">
          Both entries point to the same figure: <strong>${this.escapeHtml(startChar.Name)}</strong>.
        </p>
      `;
      resultsContainer.classList.remove('hidden');
      return;
    }

    if (this.allSources.size > 0 && this.selectedKinshipSources.size === 0) {
      resultsContainer.innerHTML = `
        <p style="color: #F87171; font-size: 0.9rem;">
          No classical sources selected. Please select at least one source (or click "Select All") to trace a path.
        </p>
      `;
      resultsContainer.classList.remove('hidden');
      return;
    }

    // Breadth-First Search (BFS) to find the shortest kinship path among selected sources
    // Note: visited Set ensures termination in O(V + E) time with zero infinite loops even with cyclic graphs
    const queue = [[startChar.ID]];
    const visited = new Set([startChar.ID]);
    const edgeUsed = new Map(); // toId -> { relation, sources }
    let foundPath = null;

    while (queue.length > 0) {
      const path = queue.shift();
      const currentId = path[path.length - 1];

      if (currentId === endChar.ID) {
        foundPath = path;
        break;
      }

      const neighbors = this.graph.get(currentId) || [];
      for (const edge of neighbors) {
        // Source filter: edge is allowed if:
        // 1) No sources recorded in dataset, OR
        // 2) Edge has no specific source restrictions, OR
        // 3) At least one of the edge's sources is selected
        const allowsEdge = (this.allSources.size === 0)
          || (edge.sources.length === 0)
          || (edge.sources.some(s => this.selectedKinshipSources.has(s)));

        if (allowsEdge && !visited.has(edge.to)) {
          visited.add(edge.to);
          edgeUsed.set(`${currentId}->${edge.to}`, {
            relation: edge.relation,
            sources: edge.sources || []
          });
          queue.push([...path, edge.to]);
        }
      }
    }

    if (!foundPath) {
      const sourceCountMsg = this.allSources.size > 0
        ? ` under the selected sources (${this.selectedKinshipSources.size} of ${this.allSources.size} sources enabled)`
        : '';
      resultsContainer.innerHTML = `
        <p style="color: var(--text-muted); font-size: 0.9rem;">
          No genealogical connection found between <strong>${this.escapeHtml(startChar.Name)}</strong> and <strong>${this.escapeHtml(endChar.Name)}</strong>${sourceCountMsg}.
        </p>
      `;
      resultsContainer.classList.remove('hidden');
      return;
    }

    // Calculate exact genealogical relationship term
    const kinship = this.getKinshipTerm(startChar, endChar, foundPath);

    // Render path chain
    const stepsHtml = foundPath.map((id, index) => {
      const char = this.idMap.get(id);
      let relationLabel = '';
      if (index > 0) {
        const prevId = foundPath[index - 1];
        const edgeInfo = edgeUsed.get(`${prevId}->${id}`) || { relation: 'Related to', sources: [] };
        const sourcesTag = (edgeInfo.sources && edgeInfo.sources.length > 0)
          ? ` <span style="font-size: 0.72rem; color: var(--gold-300); background: rgba(212,160,23,0.12); padding: 1px 6px; border-radius: 4px; margin-left: 0.35rem;">(${edgeInfo.sources.join(', ')})</span>`
          : '';
        relationLabel = `<span class="path-node-relation">${edgeInfo.relation}${sourcesTag}</span>`;
      } else {
        relationLabel = `<span class="path-node-relation">Starting Figure</span>`;
      }

      return `
        <div class="path-node">
          <span class="path-step-badge">${index + 1}</span>
          <a href="#/character/${char.ID}" class="path-node-name" onclick="document.getElementById('path-modal').classList.add('hidden')">
            ${this.escapeHtml(char.Name)} (#${char.ID})
          </a>
          ${relationLabel}
        </div>
      `;
    }).join('');

    resultsContainer.innerHTML = `
      <!-- Kinship Term Banner -->
      <div class="kinship-term-banner">
        <div class="kinship-term-icon">🏛️</div>
        <div class="kinship-term-content">
          <div class="kinship-term-title">
            <strong>${this.escapeHtml(endChar.Name)}</strong> is the <span class="kinship-term-highlight">${this.escapeHtml(kinship.term)}</span> of <strong>${this.escapeHtml(startChar.Name)}</strong>
          </div>
          <div class="kinship-term-sub">${this.escapeHtml(kinship.detail)}</div>
        </div>
      </div>

      <div style="margin-bottom: 0.75rem; font-size: 0.85rem; color: var(--gold-300);">
        Kinship Path Chain (${foundPath.length - 1} ${foundPath.length - 1 === 1 ? 'generation/step' : 'generations/steps'}):
      </div>
      <div class="path-chain">
        ${stepsHtml}
      </div>
    `;
    resultsContainer.classList.remove('hidden');
  }

  /* ==========================================================================
     Kinship Terminology Determination
     ========================================================================== */
  getKinshipTerm(startChar, endChar, path) {
    if (!path || path.length < 2) return { term: 'Self', detail: '' };

    // Determine direction of each step (UP = child to parent, DOWN = parent to child)
    const steps = [];
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      const c1 = this.idMap.get(p1);
      const c2 = this.idMap.get(p2);

      const c1Parents = new Set((c1?.Parentages || []).flatMap(p => [p.FatherID, p.MotherID].filter(Boolean)));
      const c2Parents = new Set((c2?.Parentages || []).flatMap(p => [p.FatherID, p.MotherID].filter(Boolean)));

      if (c1Parents.has(p2)) {
        steps.push('UP');
      } else if (c2Parents.has(p1)) {
        steps.push('DOWN');
      } else {
        steps.push('UNKNOWN');
      }
    }

    const isMale = endChar.Gender === 'Male';

    // Check if pure UP then pure DOWN (blood ancestry through common ancestor)
    let upCount = 0;
    let downCount = 0;
    let phase = 'UP';
    let isPureAncestry = true;

    for (const s of steps) {
      if (s === 'UP') {
        if (phase === 'DOWN') {
          isPureAncestry = false;
          break;
        }
        upCount++;
      } else if (s === 'DOWN') {
        phase = 'DOWN';
        downCount++;
      } else {
        isPureAncestry = false;
        break;
      }
    }

    if (isPureAncestry) {
      const u = upCount;
      const d = downCount;

      // 1. Direct Ancestor (d === 0): endChar is ancestor of startChar
      if (d === 0) {
        if (u === 1) return { term: isMale ? 'Father' : 'Mother', detail: 'Direct parent' };
        if (u === 2) return { term: isMale ? 'Grandfather' : 'Grandmother', detail: 'Direct grandparent' };
        if (u === 3) return { term: isMale ? 'Great-Grandfather' : 'Great-Grandmother', detail: '3 generations back' };
        return { term: `${u - 2}x Great-${isMale ? 'Grandfather' : 'Grandmother'}`, detail: `${u} generations back` };
      }

      // 2. Direct Descendant (u === 0): endChar is descendant of startChar
      if (u === 0) {
        if (d === 1) return { term: isMale ? 'Son' : 'Daughter', detail: 'Direct child' };
        if (d === 2) return { term: isMale ? 'Grandson' : 'Granddaughter', detail: 'Direct grandchild' };
        if (d === 3) return { term: isMale ? 'Great-Grandson' : 'Great-Granddaughter', detail: '3 generations forward' };
        return { term: `${d - 2}x Great-${isMale ? 'Grandson' : 'Granddaughter'}`, detail: `${d} generations forward` };
      }

      // 3. Siblings (u === 1, d === 1)
      if (u === 1 && d === 1) {
        const startFathers = new Set((startChar.Parentages || []).map(p => p.FatherID).filter(Boolean));
        const startMothers = new Set((startChar.Parentages || []).map(p => p.MotherID).filter(Boolean));
        const endFathers = new Set((endChar.Parentages || []).map(p => p.FatherID).filter(Boolean));
        const endMothers = new Set((endChar.Parentages || []).map(p => p.MotherID).filter(Boolean));

        let sharedFathers = 0;
        for (const f of startFathers) if (endFathers.has(f)) sharedFathers++;
        let sharedMothers = 0;
        for (const m of startMothers) if (endMothers.has(m)) sharedMothers++;

        const isFull = (sharedFathers > 0 && sharedMothers > 0);
        const prefix = isFull ? '' : 'Half-';
        return {
          term: `${prefix}${isMale ? 'Brother' : 'Sister'}`,
          detail: isFull ? 'Shared both father and mother' : 'Shared one parent'
        };
      }

      // 4. Aunt / Uncle (u >= 2, d === 1): endChar is sibling of startChar's ancestor
      if (d === 1) {
        if (u === 2) return { term: isMale ? 'Uncle' : 'Aunt', detail: 'Sibling of parent' };
        if (u === 3) return { term: isMale ? 'Great-Uncle' : 'Great-Aunt', detail: 'Sibling of grandparent' };
        return { term: `${u - 2}x Great-${isMale ? 'Uncle' : 'Aunt'}`, detail: `${u} generations back` };
      }

      // 5. Niece / Nephew (u === 1, d >= 2): endChar is descendant of startChar's sibling
      if (u === 1) {
        if (d === 2) return { term: isMale ? 'Nephew' : 'Niece', detail: 'Child of sibling' };
        if (d === 3) return { term: isMale ? 'Great-Nephew' : 'Great-Niece', detail: 'Grandchild of sibling' };
        return { term: `${d - 2}x Great-${isMale ? 'Nephew' : 'Niece'}`, detail: `${d} generations forward` };
      }

      // 6. Cousins (u >= 2, d >= 2)
      const cousinDeg = Math.min(u, d) - 1;
      const cousinRem = Math.abs(u - d);
      const ordinal = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][cousinDeg - 1] || `${cousinDeg}th`;
      let removedStr = '';
      if (cousinRem === 1) removedStr = ' once removed';
      else if (cousinRem === 2) removedStr = ' twice removed';
      else if (cousinRem === 3) removedStr = ' thrice removed';
      else if (cousinRem > 3) removedStr = ` ${cousinRem} times removed`;

      return {
        term: `${ordinal} Cousin${removedStr}`,
        detail: `Blood relatives sharing a common ancestor ${Math.max(u, d)} generations back`
      };
    }

    // 7. Consort / Co-parent (steps = ['DOWN', 'UP'])
    if (steps.length === 2 && steps[0] === 'DOWN' && steps[1] === 'UP') {
      const sharedChild = this.idMap.get(path[1]);
      return {
        term: 'Consort / Co-parent',
        detail: `Shared child: ${sharedChild ? sharedChild.Name : 'offspring'}`
      };
    }

    return {
      term: 'Kin / Extended Relative',
      detail: `${path.length - 1} steps along the genealogical graph`
    };
  }

  /* ==========================================================================
     Character Editing & Creation System (Local Staged Editing with Parentages)
     ========================================================================== */
  openEditModal(characterId) {
    const char = this.idMap.get(characterId);
    if (!char) return;

    document.getElementById('edit-id').value = char.ID;
    document.getElementById('edit-modal-icon').textContent = '✏️';
    document.getElementById('edit-modal-title').textContent = `Edit Character: ${char.Name || 'ID #' + char.ID}`;
    document.getElementById('edit-modal-subtitle').textContent = `Editing record ID #${char.ID}. All changes update real-time across the tree.`;

    document.getElementById('edit-name').value = char.Name || '';
    document.getElementById('edit-gender').value = char.Gender || 'Male';
    document.getElementById('edit-wiki').value = char.Wikipedia || '';
    document.getElementById('edit-desc').value = char.Description || '';

    // Initialize Parentages repeater
    this.modalCurrentParentages = (Array.isArray(char.Parentages) ? char.Parentages : []).map(p => ({
      _id: Math.random().toString(36).substring(2, 9),
      FatherID: p.FatherID ? parseInt(p.FatherID, 10) : null,
      MotherID: p.MotherID ? parseInt(p.MotherID, 10) : null,
      Sources: Array.isArray(p.Sources) ? [...p.Sources] : [],
      Notes: p.Notes || ''
    }));
    this.renderModalParentages();

    this.modalCurrentTags = [...(char.Category || [])];
    this.renderModalTags();

    this.modalCurrentAltNames = Array.isArray(char.AlternateNames) ? [...char.AlternateNames] : [];
    this.renderModalAltNames();

    this.editModal.classList.remove('hidden');
    document.getElementById('edit-name').focus();
  }

  openCreateModal() {
    const maxId = this.characters.reduce((max, c) => (c.ID > max ? c.ID : max), 0);
    const nextId = maxId + 1;

    document.getElementById('edit-id').value = nextId;
    document.getElementById('edit-modal-icon').textContent = '➕';
    document.getElementById('edit-modal-title').textContent = `Create New Figure (ID #${nextId})`;
    document.getElementById('edit-modal-subtitle').textContent = `Creating a new mythological character. Lineages can be assigned below with supporting classical citations.`;

    document.getElementById('edit-name').value = '';
    document.getElementById('edit-gender').value = 'Male';
    document.getElementById('edit-wiki').value = '';
    document.getElementById('edit-desc').value = '';

    // Initialize clean Parentages repeater
    this.modalCurrentParentages = [];
    this.renderModalParentages();

    this.modalCurrentTags = [];
    this.renderModalTags();

    this.modalCurrentAltNames = [];
    this.renderModalAltNames();

    this.editModal.classList.remove('hidden');
    document.getElementById('edit-name').focus();
  }

  closeEditModal() {
    if (this.editModal) {
      this.editModal.classList.add('hidden');
    }
    document.getElementById('tag-suggest')?.classList.add('hidden');
    const altInput = document.getElementById('alt-name-new-input');
    if (altInput) altInput.value = '';
  }

  addParentagePair() {
    this.modalCurrentParentages.push({
      _id: Math.random().toString(36).substring(2, 9),
      FatherID: null,
      MotherID: null,
      Sources: [],
      Notes: ''
    });
    this.renderModalParentages();
  }

  renderModalParentages() {
    const container = document.getElementById('parentages-list');
    if (!container) return;

    if (this.modalCurrentParentages.length === 0) {
      container.innerHTML = `
        <div style="padding: 1.25rem; text-align: center; color: var(--text-muted); font-size: 0.85rem; border: 1px dashed var(--border-subtle); border-radius: var(--radius-md); background: rgba(0,0,0,0.15);">
          No parentage traditions currently assigned. This figure will be treated as primordial / unknown origin.
          <br>
          Click <strong>"➕ Add Parent Pair / Tradition"</strong> above to record parents and supporting classical texts.
        </div>
      `;
      return;
    }

    container.innerHTML = this.modalCurrentParentages.map((p, idx) => {
      const father = p.FatherID ? this.idMap.get(p.FatherID) : null;
      const mother = p.MotherID ? this.idMap.get(p.MotherID) : null;
      const isConsensus = idx === 0;

      return `
        <div class="parentage-card" data-pid="${p._id}">
          <div class="parentage-card-header">
            <span class="parentage-card-title">
              Tradition #${idx + 1}
              ${isConsensus ? '<span class="primary-tradition-badge">Primary Tradition</span>' : ''}
            </span>
            <button type="button" class="btn-remove-parentage" data-pid="${p._id}" title="Remove this tradition">&times; Remove Tradition</button>
          </div>

          <div class="form-row form-row-2">
            <div class="form-group">
              <label>Father (♂)</label>
              <div class="select-wrapper">
                <input type="text" class="parentage-father-input" data-pid="${p._id}" value="${this.escapeHtml(father ? father.Name : '')}" placeholder="Search father name or ID..." autocomplete="off">
                <input type="hidden" class="parentage-father-id" data-pid="${p._id}" value="${p.FatherID || ''}">
                <div class="path-suggest hidden parentage-father-suggest" data-pid="${p._id}"></div>
              </div>
            </div>

            <div class="form-group">
              <label>Mother (♀)</label>
              <div class="select-wrapper">
                <input type="text" class="parentage-mother-input" data-pid="${p._id}" value="${this.escapeHtml(mother ? mother.Name : '')}" placeholder="Search mother name or ID..." autocomplete="off">
                <input type="hidden" class="parentage-mother-id" data-pid="${p._id}" value="${p.MotherID || ''}">
                <div class="path-suggest hidden parentage-mother-suggest" data-pid="${p._id}"></div>
              </div>
            </div>
          </div>

          <div class="parentage-sources-editor">
            <label style="font-size: 0.8rem; font-weight: 600; color: var(--gold-300);">Supporting Classical Sources (e.g. Hesiod Theogony, Homer Iliad, Apollodorus)</label>
            <div class="tag-editor-container" style="margin-top: 0.35rem;">
              <div class="tag-pills-list parentage-sources-pills" data-pid="${p._id}">
                ${p.Sources.length === 0 ? '<span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">No sources attached</span>' : ''}
                ${p.Sources.map((s, sIdx) => `
                  <span class="source-attested-tag" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    ${this.escapeHtml(s)}
                    <button type="button" class="btn-remove-parentage-source" data-pid="${p._id}" data-sidx="${sIdx}" style="background: none; border: none; color: #F87171; font-weight: bold; cursor: pointer; padding: 0;" title="Remove source">&times;</button>
                  </span>
                `).join('')}
              </div>
              <div class="tag-input-row" style="margin-top: 0.4rem;">
                <div class="select-wrapper" style="flex: 1;">
                  <input type="text" class="parentage-source-input" data-pid="${p._id}" placeholder="Add source citation (e.g. Hesiod Theogony)..." autocomplete="off">
                  <div class="path-suggest hidden parentage-source-suggest" data-pid="${p._id}"></div>
                </div>
                <button type="button" class="btn-tag-add btn-add-parentage-source" data-pid="${p._id}">Add Source</button>
              </div>
            </div>
          </div>

          <div class="form-group" style="margin-top: 0.6rem; margin-bottom: 0;">
            <label style="font-size: 0.8rem; color: var(--text-muted);">Tradition Notes / Lore Context (Optional)</label>
            <input type="text" class="parentage-notes-input" data-pid="${p._id}" value="${this.escapeHtml(p.Notes || '')}" placeholder="e.g. According to Homeric hymn; alternate divine birth narrative...">
          </div>
        </div>
      `;
    }).join('');

    // Wire events for each parentage card
    this.modalCurrentParentages.forEach(p => {
      const card = container.querySelector(`.parentage-card[data-pid="${p._id}"]`);
      if (!card) return;

      // 1. Remove Tradition button
      card.querySelector('.btn-remove-parentage')?.addEventListener('click', () => {
        this.modalCurrentParentages = this.modalCurrentParentages.filter(item => item._id !== p._id);
        this.renderModalParentages();
      });

      // 2. Father input autocomplete
      const fatherInput = card.querySelector('.parentage-father-input');
      const fatherIdField = card.querySelector('.parentage-father-id');
      const fatherSuggest = card.querySelector('.parentage-father-suggest');
      this.setupDynamicParentSuggestions(fatherInput, fatherIdField, fatherSuggest, 'Male', (id) => {
        p.FatherID = id;
      });

      // 3. Mother input autocomplete
      const motherInput = card.querySelector('.parentage-mother-input');
      const motherIdField = card.querySelector('.parentage-mother-id');
      const motherSuggest = card.querySelector('.parentage-mother-suggest');
      this.setupDynamicParentSuggestions(motherInput, motherIdField, motherSuggest, 'Female', (id) => {
        p.MotherID = id;
      });

      // 4. Source Input, Add & Autocomplete
      const sourceInput = card.querySelector('.parentage-source-input');
      const sourceSuggest = card.querySelector('.parentage-source-suggest');
      const btnAddSource = card.querySelector('.btn-add-parentage-source');

      const doAddSource = () => {
        const val = sourceInput.value.trim();
        if (val && !p.Sources.includes(val)) {
          p.Sources.push(val);
          this.renderModalParentages();
        }
      };

      btnAddSource?.addEventListener('click', doAddSource);
      sourceInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doAddSource();
        }
      });

      // Source suggestions from existing sources in dataset
      sourceInput?.addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        if (!val) {
          sourceSuggest.classList.add('hidden');
          return;
        }
        const matches = Array.from(this.allSources).filter(s => s.toLowerCase().includes(val) && !p.Sources.includes(s)).slice(0, 5);
        if (matches.length === 0) {
          sourceSuggest.classList.add('hidden');
          return;
        }
        sourceSuggest.innerHTML = matches.map(s => `
          <div class="path-suggest-item" data-src="${this.escapeHtml(s)}">${this.escapeHtml(s)}</div>
        `).join('');
        sourceSuggest.querySelectorAll('.path-suggest-item').forEach(item => {
          item.addEventListener('click', () => {
            const chosen = item.getAttribute('data-src');
            if (!p.Sources.includes(chosen)) {
              p.Sources.push(chosen);
              this.renderModalParentages();
            }
          });
        });
        sourceSuggest.classList.remove('hidden');
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest(`.parentage-card[data-pid="${p._id}"]`)) {
          sourceSuggest?.classList.add('hidden');
        }
      });

      // 5. Remove Source buttons
      card.querySelectorAll('.btn-remove-parentage-source').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const sIdx = parseInt(e.currentTarget.getAttribute('data-sidx'), 10);
          p.Sources.splice(sIdx, 1);
          this.renderModalParentages();
        });
      });

      // 6. Notes Input
      card.querySelector('.parentage-notes-input')?.addEventListener('input', (e) => {
        p.Notes = e.target.value;
      });
    });
  }

  setupDynamicParentSuggestions(input, idField, suggest, expectedGender, onSelectId) {
    if (!input || !idField || !suggest) return;

    input.addEventListener('input', (e) => {
      const val = e.target.value.trim().toLowerCase();
      if (!val) {
        idField.value = '';
        onSelectId(null);
        suggest.classList.add('hidden');
        return;
      }

      const matches = this.characters.filter(c => {
        const nameMatch = (c.Name || '').toLowerCase().includes(val);
        const altMatch = (c.AlternateNames || []).some(an => (an || '').toLowerCase().includes(val));
        const idMatch = String(c.ID) === val;
        return nameMatch || altMatch || idMatch;
      }).sort((a, b) => {
        if (expectedGender) {
          if (a.Gender === expectedGender && b.Gender !== expectedGender) return -1;
          if (b.Gender === expectedGender && a.Gender !== expectedGender) return 1;
        }
        return (a.Name || '').localeCompare(b.Name || '');
      }).slice(0, 6);

      if (matches.length === 0) {
        suggest.classList.add('hidden');
        return;
      }

      suggest.innerHTML = matches.map(m => {
        let altTag = '';
        if (m.AlternateNames && m.AlternateNames.length > 0) {
          const matchedAlt = m.AlternateNames.find(an => (an || '').toLowerCase().includes(val));
          if (matchedAlt && (m.Name || '').toLowerCase() !== matchedAlt.toLowerCase()) {
            altTag = `<span style="color: var(--cyan-400); font-size: 0.75rem; font-weight: normal;">(aka ${this.escapeHtml(matchedAlt)})</span> `;
          }
        }

        return `
          <div class="path-suggest-item" data-id="${m.ID}" data-name="${this.escapeHtml(m.Name)}">
            <strong>${this.escapeHtml(m.Name)}</strong> ${altTag}(#${m.ID}) - ${m.Gender === 'Male' ? '♂' : '♀'} <span style="color: var(--text-muted); font-size: 0.72rem;">${(m.Category || []).slice(0, 1).join(', ')}</span>
          </div>
        `;
      }).join('');

      suggest.querySelectorAll('.path-suggest-item').forEach(item => {
        item.addEventListener('click', () => {
          const chosenName = item.getAttribute('data-name');
          const chosenId = parseInt(item.getAttribute('data-id'), 10);
          input.value = chosenName;
          idField.value = chosenId;
          onSelectId(chosenId);
          suggest.classList.add('hidden');
        });
      });

      suggest.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !suggest.contains(e.target)) {
        suggest.classList.add('hidden');
      }
    });
  }

  renderModalAltNames() {
    const container = document.getElementById('alt-names-pills-list');
    if (!container) return;

    if (this.modalCurrentAltNames.length === 0) {
      container.innerHTML = '<span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">No alternate names assigned</span>';
      return;
    }

    container.innerHTML = this.modalCurrentAltNames.map((name, idx) => `
      <span class="alt-name-item-pill">
        ${this.escapeHtml(name)}
        <button type="button" class="btn-remove-alt-name" data-index="${idx}" title="Remove alternate name">&times;</button>
      </span>
    `).join('');

    container.querySelectorAll('.btn-remove-alt-name').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-index'), 10);
        this.modalCurrentAltNames.splice(idx, 1);
        this.renderModalAltNames();
      });
    });
  }

  addAltNameFromInput() {
    const input = document.getElementById('alt-name-new-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    const exists = this.modalCurrentAltNames.some(n => n.toLowerCase() === val.toLowerCase());
    if (!exists) {
      this.modalCurrentAltNames.push(val);
      this.renderModalAltNames();
    }
    input.value = '';
  }

  renderModalTags() {
    const container = document.getElementById('tag-pills-list');
    if (!container) return;

    if (this.modalCurrentTags.length === 0) {
      container.innerHTML = '<span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">No categories assigned</span>';
      return;
    }

    container.innerHTML = this.modalCurrentTags.map((tag, idx) => `
      <span class="tag-item-pill">
        ${this.escapeHtml(tag)}
        <button type="button" class="btn-remove-tag" data-index="${idx}" title="Remove category">&times;</button>
      </span>
    `).join('');

    container.querySelectorAll('.btn-remove-tag').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-index'), 10);
        this.modalCurrentTags.splice(idx, 1);
        this.renderModalTags();
      });
    });
  }

  addTagFromInput() {
    const input = document.getElementById('tag-new-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    const formatted = val.charAt(0).toUpperCase() + val.slice(1);
    if (!this.modalCurrentTags.includes(formatted)) {
      this.modalCurrentTags.push(formatted);
      this.renderModalTags();
    }
    input.value = '';
    document.getElementById('tag-suggest')?.classList.add('hidden');
  }

  setupTagSuggestions() {
    const input = document.getElementById('tag-new-input');
    const suggest = document.getElementById('tag-suggest');
    if (!input || !suggest) return;

    input.addEventListener('input', (e) => {
      const val = e.target.value.trim().toLowerCase();
      if (!val) {
        suggest.classList.add('hidden');
        return;
      }
      const existingCats = Array.from(this.categoryMap.keys());
      const matches = existingCats.filter(cat => cat.toLowerCase().includes(val) && !this.modalCurrentTags.includes(cat)).slice(0, 5);
      if (matches.length === 0) {
        suggest.classList.add('hidden');
        return;
      }
      suggest.innerHTML = matches.map(cat => `
        <div class="path-suggest-item" data-cat="${this.escapeHtml(cat)}">${this.escapeHtml(cat)}</div>
      `).join('');
      suggest.querySelectorAll('.path-suggest-item').forEach(item => {
        item.addEventListener('click', () => {
          const cat = item.getAttribute('data-cat');
          if (!this.modalCurrentTags.includes(cat)) {
            this.modalCurrentTags.push(cat);
            this.renderModalTags();
          }
          input.value = '';
          suggest.classList.add('hidden');
        });
      });
      suggest.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#tag-editor-container')) {
        suggest.classList.add('hidden');
      }
    });
  }

  async saveCharacter() {
    const id = parseInt(document.getElementById('edit-id').value, 10);
    const name = document.getElementById('edit-name').value.trim();
    const gender = document.getElementById('edit-gender').value;
    const wiki = document.getElementById('edit-wiki').value.trim();
    const category = [...this.modalCurrentTags];
    const altNames = [...this.modalCurrentAltNames];
    const desc = document.getElementById('edit-desc').value.trim();

    if (!name) {
      alert('Please enter a name for the mythological figure.');
      return;
    }

    // Clean and validate Parentages
    const cleanParentages = this.modalCurrentParentages.map(p => ({
      FatherID: p.FatherID ? parseInt(p.FatherID, 10) : null,
      MotherID: p.MotherID ? parseInt(p.MotherID, 10) : null,
      Sources: (Array.isArray(p.Sources) ? p.Sources : []).filter(s => typeof s === 'string' && s.trim()),
      Notes: (p.Notes || '').trim()
    })).filter(p => p.FatherID !== null || p.MotherID !== null || p.Sources.length > 0 || p.Notes.length > 0);

    // Sort traditions within character by consensus (number of sources descending)
    cleanParentages.sort((a, b) => b.Sources.length - a.Sources.length);

    let char = this.idMap.get(id);

    if (char) {
      // Update existing character
      char.Name = name;
      char.AlternateNames = altNames;
      char.Gender = gender;
      char.Parentages = cleanParentages;
      delete char.FatherID;
      delete char.MotherID;
      char.Wikipedia = wiki;
      char.Category = category;
      char.Description = desc;
    } else {
      // Create new character
      char = {
        ID: id,
        Name: name,
        AlternateNames: altNames,
        Gender: gender,
        Parentages: cleanParentages,
        Wikipedia: wiki,
        Category: category,
        Description: desc
      };
      this.characters.push(char);
    }

    // Sort by ID for consistent clean data
    this.characters.sort((a, b) => a.ID - b.ID);

    // Re-index all graphs and maps
    this.buildIndexes();
    this.updateHeaderStats();
    this.closeEditModal();

    // Auto-save directly to characters.json via the server API
    await this.saveDatabaseToFile(`Saved "${name}" (ID #${id}) directly to data/characters.json!`);

    // Navigate to / refresh character view
    window.location.hash = `#/character/${id}`;
    this.renderCharacterView(id);
  }

  async saveDatabaseToFile(customSuccessMsg) {
    if (!this.isLocal) return;

    // Sort for pristine consistency
    this.characters.sort((a, b) => a.ID - b.ID);

    try {
      const resp = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.characters, null, 2)
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      // Success: clear staged flag and browser localStorage staging
      localStorage.removeItem('mythostree_staged_characters');
      this.hasLocalEdits = false;
      this.updateStagedBar();
      this.showToast(customSuccessMsg || `Database saved directly to data/characters.json (${this.characters.length} figures)`);
    } catch (err) {
      console.warn('Auto-save to server file failed; staging in browser storage:', err);
      // Fallback: save to localStorage so no work is ever lost
      localStorage.setItem('mythostree_staged_characters', JSON.stringify(this.characters, null, 2));
      this.hasLocalEdits = true;
      this.updateStagedBar();
      this.showToast('Server unavailable. Changes staged in browser memory.', true);
    }
  }

  showToast(message, isWarning = false) {
    if (!this.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast-notification ${isWarning ? 'toast-warning' : ''}`;
    toast.innerHTML = `
      <span style="font-size: 1.1rem;">${isWarning ? '⚠️' : '✅'}</span>
      <span>${this.escapeHtml(message)}</span>
    `;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-hiding');
      setTimeout(() => toast.remove(), 350);
    }, 3500);
  }

  updateStagedBar() {
    if (!this.stagedBar) return;
    if (this.hasLocalEdits && this.isLocal) {
      this.stagedBar.classList.remove('hidden');
      if (this.stagedCountText) {
        this.stagedCountText.textContent = `Unsaved edits pending (${this.characters.length} characters in memory)`;
      }
    } else {
      this.stagedBar.classList.add('hidden');
    }
  }


  exportDatabase() {
    // Sort array by ID for a pristine clean export
    const sorted = [...this.characters].sort((a, b) => a.ID - b.ID);
    const jsonStr = JSON.stringify(sorted, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'characters.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  resetDatabase() {
    if (confirm("Reset all local staged edits and restore the original database file from disk?")) {
      localStorage.removeItem('mythostree_staged_characters');
      window.location.reload();
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Initialize Application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new MythosTreeApp();
  app.init();
});

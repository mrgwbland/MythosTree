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

    this.selectedSearchIndex = -1;
    this.dirSortBy = 'name'; // 'name', 'id', 'children'
    this.dirSortAsc = true;
  }

  async init() {
    try {
      await this.loadData();
      this.buildIndexes();
      this.setupEventListeners();
      this.setupRouter();
      this.updateHeaderStats();
    } catch (err) {
      console.error('Initialization error:', err);
      this.viewContainer.innerHTML = `
        <div class="empty-children-card">
          <div class="empty-icon">⚠️</div>
          <h3>Failed to load mythological data</h3>
          <p>${err.message}</p>
        </div>
      `;
    }
  }

  async loadData() {
    // 1. First priority: Direct browser window object from data/characters.js (works with file:// and http://)
    if (window.MYTHOS_DATA && Array.isArray(window.MYTHOS_DATA)) {
      this.characters = window.MYTHOS_DATA;
      return;
    }

    // 2. Fetch from characters.json if hosted on webserver
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

    // Pass 1: Index characters and initialize maps
    for (const c of this.characters) {
      this.idMap.set(c.ID, c);
      if (c.Name) {
        this.nameMap.set(c.Name.toLowerCase().trim(), c);
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

    // Pass 2: Build dynamic Children relationships and Kinship Graph
    for (const c of this.characters) {
      // Mother relationship
      if (c.MotherID && this.idMap.has(c.MotherID)) {
        this.childrenMap.get(c.MotherID).push(c);
        this.graph.get(c.ID).push({ to: c.MotherID, relation: 'Mother' });
        this.graph.get(c.MotherID).push({ to: c.ID, relation: c.Gender === 'Male' ? 'Son' : 'Daughter' });
      }

      // Father relationship
      if (c.FatherID && this.idMap.has(c.FatherID)) {
        this.childrenMap.get(c.FatherID).push(c);
        this.graph.get(c.ID).push({ to: c.FatherID, relation: 'Father' });
        this.graph.get(c.FatherID).push({ to: c.ID, relation: c.Gender === 'Male' ? 'Son' : 'Daughter' });
      }
    }
  }

  countDirectDescendants(characterId) {
    const visited = new Set();
    const queue = [...(this.childrenMap.get(characterId) || [])];
    while (queue.length > 0) {
      const child = queue.shift();
      if (!visited.has(child.ID)) {
        visited.add(child.ID);
        const nextGen = this.childrenMap.get(child.ID) || [];
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

    // Resolve Parents
    const father = char.FatherID ? this.idMap.get(char.FatherID) : null;
    const mother = char.MotherID ? this.idMap.get(char.MotherID) : null;

    // Resolve Children dynamically from childrenMap
    const children = this.childrenMap.get(characterId) || [];
    const childCount = children.length;
    const descendantCount = this.countDirectDescendants(characterId);

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
    if (children.length > 0) {
      childrenHtml = `
        <div class="children-grid">
          ${children.map(child => {
            // Find other parent
            let otherParentStr = '';
            const otherParentId = (child.FatherID === char.ID) ? child.MotherID : child.FatherID;
            if (otherParentId && this.idMap.has(otherParentId)) {
              const otherParent = this.idMap.get(otherParentId);
              otherParentStr = `<span class="child-meta">with ${this.escapeHtml(otherParent.Name)}</span>`;
            }

            const childGenderIcon = child.Gender === 'Male' ? '♂' : '♀';
            const childCategories = (child.Category || []).slice(0, 3).map(cat => 
              `<span class="child-category-pill">${this.escapeHtml(cat)}</span>`
            ).join('');

            return `
              <a href="#/character/${child.ID}" class="child-card" title="View child: ${this.escapeHtml(child.Name)}">
                <div class="child-top">
                  <span class="child-name">${this.escapeHtml(child.Name || 'Unnamed')}</span>
                  <span class="child-meta">${childGenderIcon} #${child.ID}</span>
                </div>
                ${otherParentStr}
                <p class="child-desc">${this.escapeHtml(child.Description || 'No description recorded')}</p>
                <div class="child-categories">${childCategories}</div>
              </a>
            `;
          }).join('')}
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

    // Render Full Page
    this.viewContainer.innerHTML = `
      <!-- Hero Card -->
      <section class="character-hero-card">
        <div class="hero-top-meta">
          <div class="badge-group">
            <span class="id-badge">ID #${char.ID}</span>
            <span class="gender-badge ${genderClass}">
              <span>${genderSymbol}</span>
              <span>${char.Gender}</span>
            </span>
          </div>
          ${wikiBtnHtml}
        </div>

        <h1 class="hero-name">${this.escapeHtml(char.Name || 'Unnamed Figure')}</h1>

        <div class="hero-categories">
          ${categoriesHtml}
        </div>

        <div class="hero-description">
          <p>${this.escapeHtml(char.Description || 'No description available in the archive.')}</p>
        </div>
      </section>

      <!-- Lineage Section -->
      <section class="lineage-section">
        <!-- Parents -->
        <div>
          <div class="section-header">
            <h2 class="section-title">Parents & Lineage</h2>
          </div>
          <div class="parents-grid">
            ${renderParentCard(father, 'Father', '⚡')}
            ${renderParentCard(mother, 'Mother', '🌙')}
          </div>
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
          ${childrenHtml}
        </div>
      </section>
    `;
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
        const cA = (this.childrenMap.get(a.ID) || []).length;
        const cB = (this.childrenMap.get(b.ID) || []).length;
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
          const children = this.childrenMap.get(m.ID) || [];
          const childCount = children.length;
          const genderIcon = m.Gender === 'Male' ? '♂' : '♀';

          return `
            <a href="#/character/${m.ID}" class="child-card">
              <div class="child-top">
                <span class="child-name">${this.escapeHtml(m.Name || 'Unnamed')}</span>
                <span class="child-meta">${genderIcon} #${m.ID}</span>
              </div>
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

    // 3. Global Hotkey: '/' or 'Ctrl+K' focuses search
    window.addEventListener('keydown', (e) => {
      if ((e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'k')) && document.activeElement !== this.searchInput) {
        e.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
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

    const pathForm = document.getElementById('path-form');
    if (pathForm) {
      pathForm.addEventListener('submit', () => this.calculateKinshipPath());
    }

    this.setupPathInputSuggestions('path-start-input', 'path-start-suggest');
    this.setupPathInputSuggestions('path-end-input', 'path-end-suggest');
  }

  /* ==========================================================================
     Live Search Autocomplete
     ========================================================================== */
  handleSearchInput(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      this.searchDropdown.innerHTML = '';
      this.searchDropdown.classList.add('hidden');
      return;
    }

    // Filter characters by name, category, or ID
    const results = this.characters.filter(c => {
      const name = (c.Name || '').toLowerCase();
      const idMatch = String(c.ID) === q;
      const nameMatch = name.includes(q);
      const catMatch = (c.Category || []).some(cat => cat.toLowerCase().includes(q));
      return idMatch || nameMatch || catMatch;
    }).slice(0, 8); // top 8 results

    this.renderSearchResults(results);
  }

  renderSearchResults(results) {
    if (results.length === 0) {
      this.searchDropdown.innerHTML = `
        <div style="padding: 0.75rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
          No characters or categories found
        </div>
      `;
      this.searchDropdown.classList.remove('hidden');
      return;
    }

    this.searchDropdown.innerHTML = results.map((r, i) => `
      <div class="search-result-item" data-id="${r.ID}" data-index="${i}" onclick="window.location.hash='#/character/${r.ID}'; document.getElementById('search-dropdown').classList.add('hidden'); document.getElementById('search-input').value='';">
        <div class="result-info">
          <span class="result-name">${this.escapeHtml(r.Name || 'Unnamed')}</span>
          <span class="result-desc">${this.escapeHtml(r.Description || '')}</span>
        </div>
        <div class="result-tags">
          ${(r.Category || []).slice(0, 1).map(cat => `<span class="result-tag-pill">${this.escapeHtml(cat)}</span>`).join('')}
        </div>
      </div>
    `).join('');

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
     Kinship Path Finder (BFS Shortest Path)
     ========================================================================== */
  openPathModal() {
    this.pathModal.classList.remove('hidden');
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
      const matches = this.characters.filter(c => (c.Name || '').toLowerCase().includes(val)).slice(0, 5);
      if (!matches.length) {
        suggest.classList.add('hidden');
        return;
      }
      suggest.innerHTML = matches.map(m => `
        <div class="path-suggest-item" onclick="document.getElementById('${inputId}').value = '${this.escapeHtml(m.Name)}'; document.getElementById('${suggestId}').classList.add('hidden');">
          ${this.escapeHtml(m.Name)} (#${m.ID})
        </div>
      `).join('');
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

    // Breadth-First Search (BFS) to find the shortest kinship path
    const queue = [[startChar.ID]];
    const visited = new Set([startChar.ID]);
    const edgeUsed = new Map(); // toId -> relation from fromId
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
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          edgeUsed.set(`${currentId}->${edge.to}`, edge.relation);
          queue.push([...path, edge.to]);
        }
      }
    }

    if (!foundPath) {
      resultsContainer.innerHTML = `
        <p style="color: var(--text-muted); font-size: 0.9rem;">
          No genealogical connection found between <strong>${this.escapeHtml(startChar.Name)}</strong> and <strong>${this.escapeHtml(endChar.Name)}</strong> within this dataset.
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
        const relation = edgeUsed.get(`${prevId}->${id}`) || 'Related to';
        relationLabel = `<span class="path-node-relation">${relation}</span>`;
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

    // Determine direction of each step:
    // UP: from child to parent
    // DOWN: from parent to child
    const steps = [];
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      const c1 = this.idMap.get(p1);
      const c2 = this.idMap.get(p2);
      if (c1.MotherID === p2 || c1.FatherID === p2) {
        steps.push('UP');
      } else if (c2.MotherID === p1 || c2.FatherID === p1) {
        steps.push('DOWN');
      } else {
        steps.push('UNKNOWN');
      }
    }

    const isMale = endChar.Gender === 'Male';

    // Check if pure UP then pure DOWN (pure blood ancestry through common ancestor)
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
        let shared = 0;
        if (startChar.FatherID && startChar.FatherID === endChar.FatherID) shared++;
        if (startChar.MotherID && startChar.MotherID === endChar.MotherID) shared++;
        const isFull = (shared === 2);
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

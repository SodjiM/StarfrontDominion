// Starfront: Dominion - Enhanced Encyclopedia
// Dynamic encyclopedia with live data integration and modern UI

(function() {
  // Dynamic data sources
  const API_ENDPOINTS = {
    blueprints: '/game/blueprints',
    abilities: '/game/abilities',
    archetypes: '/game/archetypes'
  };

  let encyclopediaData = null;
  let activeCategoryId = null;
  let activeEntryId = null;
  let searchTerm = '';

  // Core encyclopedia structure matching user specification
  const ENCYCLOPEDIA_STRUCTURE = {
    categories: [
      {
        id: 'getting-started',
        name: 'Getting Started',
        icon: '🏠',
        entries: []
      },
      {
        id: 'ships-construction',
        name: 'Ships & Construction',
        icon: '🚀',
        entries: []
      },
      {
        id: 'combat-abilities',
        name: 'Combat & Abilities',
        icon: '⚔️',
        entries: []
      },
      {
        id: 'systems-archetypes',
        name: 'Systems & Archetypes',
        icon: '🌌',
        entries: []
      },
      {
        id: 'game-mechanics',
        name: 'Game Mechanics',
        icon: '📜',
        entries: []
      },
      {
        id: 'infrastructure',
        name: 'Infrastructure',
        icon: '🏭',
        entries: []
      }
    ],
    defaultEntry: { categoryId: 'getting-started', entryId: 'welcome' }
  };

  // Enhanced loading with error handling and fallbacks
  let loadingState = false;
  let dataCache = new Map();
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  async function loadData(forceRefresh = false) {
    // Check cache first
    const cacheKey = 'encyclopedia_data';
    const cached = dataCache.get(cacheKey);

    if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    if (encyclopediaData && !forceRefresh) return encyclopediaData;
    if (loadingState) return ENCYCLOPEDIA_STRUCTURE; // Return structure while loading

    try {
      loadingState = true;
      showGlobalLoadingIndicator();

      // Load all dynamic data with individual error handling
      const loadResults = await Promise.allSettled([
        loadWithTimeout(API_ENDPOINTS.blueprints, 'blueprints'),
        loadWithTimeout(API_ENDPOINTS.abilities, 'abilities'),
        loadWithTimeout(API_ENDPOINTS.archetypes, 'archetypes')
      ]);

      // Process results with fallbacks
      const blueprintsData = processApiResult(loadResults[0], 'blueprints');
      const abilitiesData = processApiResult(loadResults[1], 'abilities');
      const archetypesData = processApiResult(loadResults[2], 'archetypes');

      console.log('API Data loaded:', {
        blueprints: blueprintsData.blueprints?.length || 0,
        abilities: Object.keys(abilitiesData.abilities || {}).length,
        archetypes: archetypesData.archetypes?.length || 0
      });

      // Log archetype data structure for debugging
      if (archetypesData.archetypes && archetypesData.archetypes.length > 0) {
        console.log('Sample archetype data:', archetypesData.archetypes[0]);
      }

      // Build encyclopedia data structure
      const data = { ...ENCYCLOPEDIA_STRUCTURE };

      // Populate sections with dynamic and static content
      data.categories.forEach(category => {
        category.entries = generateCategoryEntries(category.id, {
          blueprints: blueprintsData.blueprints || [],
          abilities: abilitiesData.abilities || [],
          archetypes: archetypesData.archetypes || []
        });
        console.log(`Generated ${category.entries.length} entries for category: ${category.id}`);
        if (category.entries.length > 0) {
          console.log(`Sample entries for ${category.id}:`, category.entries.slice(0, 3).map(e => ({ id: e.id, title: e.title })));
        }
      });

      // Add metadata about data freshness
      data.lastUpdated = Date.now();
      data.hasErrors = loadResults.some(result => result.status === 'rejected');

      // Cache the successful data
      dataCache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });

      encyclopediaData = data;
      hideGlobalLoadingIndicator();
      loadingState = false;

      return data;
    } catch (e) {
      console.error('Critical encyclopedia load error:', e);
      hideGlobalLoadingIndicator();
      loadingState = false;

      // Return fallback data with error indication
      return createFallbackData();
    }
  }

  async function loadWithTimeout(url, dataType, timeout = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        cache: 'no-cache',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      clearTimeout(timeoutId);
      return { success: false, error: error.message, dataType };
    }
  }

  function processApiResult(result, dataType) {
    if (result.status === 'fulfilled' && result.value.success) {
      return result.value.data;
    }

    // Log the specific error
    console.warn(`Failed to load ${dataType}:`, result.reason || result.value?.error || 'Unknown error');

    // Return empty data structure for graceful degradation
    return {
      blueprints: [],
      abilities: {},
      archetypes: []
    }[dataType] || [];
  }

  function createFallbackData() {
    const fallbackData = { ...ENCYCLOPEDIA_STRUCTURE };
    fallbackData.hasErrors = true;
    fallbackData.errorMessage = 'Some content may be unavailable due to loading errors.';

    // Add basic fallback content for essential sections
    fallbackData.categories.forEach(category => {
      category.entries = generateFallbackEntries(category.id);
    });

    return fallbackData;
  }

  function generateFallbackEntries(categoryId) {
    switch (categoryId) {
      case 'getting-started':
        return [{
          id: 'loading-error',
          title: 'Content Loading Error',
          icon: '⚠️',
          tags: ['error'],
          summary: 'Some encyclopedia content failed to load',
          content: `
            <div class="error-content">
              <h3>Content Unavailable</h3>
              <p>We're having trouble loading some encyclopedia content. This might be due to network issues or server problems.</p>
              <p>You can still browse basic information, but some dynamic content may be missing.</p>
              <button onclick="window.Encyclopedia.refresh()" class="sf-btn sf-btn-secondary">Retry Loading</button>
            </div>
          `
        }];

      case 'systems-archetypes':
        return generateArchetypeFallbacks();

      case 'ships-construction':
        return [{
          id: 'ships-fallback',
          title: 'Ship Construction Basics',
          icon: '🚀',
          tags: ['ships', 'construction', 'basics'],
          summary: 'Core principles of ship building and fleet management',
          content: `
            <div class="ships-fallback">
              <h3>Ship Construction System</h3>
              <p>Build your fleet using minerals extracted from asteroid belts and nebulae. Each ship requires core minerals plus specialized materials based on its role.</p>

              <h4>Core Minerals (Always Required)</h4>
              <ul>
                <li><strong>Ferrite Alloy:</strong> Hull and structural material</li>
                <li><strong>Crytite:</strong> Energy storage and reactor core</li>
                <li><strong>Ardanium:</strong> FTL drive stabilization</li>
                <li><strong>Vornite:</strong> Electronic and sensor systems</li>
                <li><strong>Zerothium:</strong> Warp field generation</li>
              </ul>

              <h4>Ship Roles</h4>
              <ul>
                <li><strong>Explorers:</strong> Scouting and initial resource discovery</li>
                <li><strong>Miners:</strong> Resource extraction and cargo transport</li>
                <li><strong>Fighters:</strong> Combat and system defense</li>
                <li><strong>Capital Ships:</strong> Command and heavy operations</li>
              </ul>

              <p><em>Detailed ship blueprints and specialized mineral information will be available when the encyclopedia data loads successfully.</em></p>
            </div>
          `
        }];

      case 'combat-abilities':
        return [{
          id: 'combat-fallback',
          title: 'Combat System Overview',
          icon: '⚔️',
          tags: ['combat', 'abilities', 'basics'],
          summary: 'Turn-based combat with energy management and ability synergy',
          content: `
            <div class="combat-fallback">
              <h3>Combat Mechanics</h3>
              <p>Engage in strategic turn-based combat where positioning, energy management, and ability synergy determine victory.</p>

              <h4>Combat Flow</h4>
              <ol>
                <li><strong>Planning Phase:</strong> Select actions and movement</li>
                <li><strong>Resolution:</strong> All actions occur simultaneously</li>
                <li><strong>Effects:</strong> Damage, movement, and status effects apply</li>
                <li><strong>Recovery:</strong> Ships regenerate energy for the next turn</li>
              </ol>

              <h4>Ability Types</h4>
              <ul>
                <li><strong>Offensive:</strong> Deal damage and apply debuffs</li>
                <li><strong>Defensive:</strong> Protect ships and remove threats</li>
                <li><strong>Utility:</strong> Movement, scanning, and positioning</li>
                <li><strong>Support:</strong> Fleet coordination and enhancement</li>
              </ul>

              <p><em>Detailed ability descriptions and strategic combat guides will be available when the encyclopedia data loads successfully.</em></p>
            </div>
          `
        }];

      default:
        return [{
          id: 'placeholder',
          title: 'Loading...',
          icon: '⏳',
          tags: ['placeholder'],
          summary: 'Content is being loaded',
          content: '<p>This section is currently loading. Please wait...</p>'
        }];
    }
  }

  function showGlobalLoadingIndicator() {
    let loader = document.querySelector('.encyclopedia-global-loader');
    if (!loader) {
      loader = document.createElement('div');
      loader.className = 'encyclopedia-global-loader';
      loader.innerHTML = `
        <div class="loader-overlay">
          <div class="loader-content">
            <div class="loading-spinner"></div>
            <div class="loading-text">Loading Encyclopedia...</div>
          </div>
        </div>
      `;
      document.body.appendChild(loader);
    }
    loader.style.display = 'block';
  }

  function hideGlobalLoadingIndicator() {
    const loader = document.querySelector('.encyclopedia-global-loader');
    if (loader) {
      loader.style.display = 'none';
    }
  }

  function generateCategoryEntries(categoryId, dynamicData) {
    switch (categoryId) {
      case 'getting-started':
        return generateGettingStartedEntries();
      case 'ships-construction':
        return generateShipsConstructionEntries(dynamicData);
      case 'combat-abilities':
        return generateCombatAbilitiesEntries(dynamicData);
      case 'systems-archetypes':
        return generateSystemsArchetypesEntries(dynamicData);
      case 'game-mechanics':
        return generateGameMechanicsEntries();
      case 'infrastructure':
        return generateInfrastructureEntries();
      default:
        return [];
    }
  }

  // Content generation functions
  function generateGettingStartedEntries() {
    return [
      {
        id: 'welcome',
        title: 'Welcome to Starfront Dominion',
        icon: '🌌',
        tags: ['getting-started', 'tutorial'],
        summary: 'Your journey into the depths of space begins here',
        content: formatWelcomeContent()
      },
      {
        id: 'quick-start',
        title: 'Quick Start Guide',
        icon: '⚡',
        tags: ['getting-started', 'tutorial'],
        summary: 'Get up and running in under 5 minutes',
        content: formatQuickStartContent()
      },
      {
        id: 'first-steps',
        title: 'First Steps',
        icon: '👣',
        tags: ['getting-started', 'tutorial'],
        summary: 'Essential actions for new commanders',
        content: formatFirstStepsContent()
      }
    ];
  }

  function generateShipsConstructionEntries(dynamicData) {
    const entries = [];

    // Add all ship blueprints dynamically
    dynamicData.blueprints.forEach(blueprint => {
      entries.push({
        id: `ship-${blueprint.id}`,
        title: `${blueprint.name} (${blueprint.class})`,
        icon: getShipIcon(blueprint.role),
        tags: ['ship', blueprint.class, blueprint.role, ...blueprint.abilities],
        summary: blueprint.shortDescription,
        content: formatShipBlueprint(blueprint)
      });
    });

    // Add construction overview
    entries.push({
      id: 'construction-overview',
      title: 'Ship Construction',
      icon: '🔧',
      tags: ['construction', 'blueprints'],
      summary: 'How to build and maintain your fleet',
      content: formatConstructionContent()
    });

    return entries;
  }

  function generateCombatAbilitiesEntries(dynamicData) {
    const entries = [];

    // Add all abilities dynamically
    Object.values(dynamicData.abilities).forEach(ability => {
      entries.push({
        id: `ability-${ability.key}`,
        title: ability.name,
        icon: getAbilityIcon(ability.type),
        tags: ['ability', ability.type],
        summary: ability.shortDescription,
        content: formatAbilityDetails(ability)
      });
    });

    // Add combat mechanics overview
    entries.push({
      id: 'combat-mechanics',
      title: 'Combat Mechanics',
      icon: '⚔️',
      tags: ['combat', 'mechanics'],
      summary: 'How combat and abilities work',
      content: formatCombatMechanicsContent()
    });

    return entries;
  }

  function generateSystemsArchetypesEntries(dynamicData) {
    const entries = [];

    // Add all system archetypes dynamically
    if (dynamicData.archetypes && Array.isArray(dynamicData.archetypes)) {
      dynamicData.archetypes.forEach(archetype => {
        // Ensure we have the required fields, fallback if not
        const key = archetype.key || 'unknown';
        const displayName = archetype.displayName || archetype.name || `${key.charAt(0).toUpperCase() + key.slice(1)} System`;
        const description = archetype.description || 'A unique system archetype with special characteristics.';

        console.log(`Creating archetype entry: ${key} -> ${displayName}`);

        entries.push({
          id: `archetype-${key}`,
          title: displayName,
          icon: '🌀',
          tags: ['archetype', 'system', key],
          summary: description,
          content: formatArchetypeDetails(archetype)
        });
      });
    } else {
      console.warn('No archetypes data available, using fallbacks');
    }

    // Add celestial objects
    entries.push(
      {
        id: 'asteroid-belts',
        title: 'Asteroid Belts',
        icon: '☄️',
        tags: ['celestial', 'resources'],
        summary: 'Rock hotspots with high competition',
        content: formatCelestialObjectContent('belts')
      },
      {
        id: 'nebulae',
        title: 'Nebulae',
        icon: '🌌',
        tags: ['celestial', 'resources'],
        summary: 'Gas clouds for harvesting operations',
        content: formatCelestialObjectContent('nebulae')
      },
      {
        id: 'resource-distribution',
        title: 'Resource Distribution',
        icon: '📊',
        tags: ['resources', 'strategy'],
        summary: 'Core, primary, and secondary resource patterns',
        content: formatResourceDistributionContent(dynamicData.archetypes || [])
      }
    );

    console.log(`Generated ${entries.length} archetype entries:`, entries.map(e => ({ id: e.id, title: e.title })));
    return entries;
  }

  function generateGameMechanicsEntries() {
    return [
      {
        id: 'turn-resolution',
        title: 'Turn Resolution',
        icon: '⏱️',
        tags: ['mechanics', 'turns'],
        summary: 'How turns are processed and resolved',
        content: formatTurnResolutionContent()
      },
      {
        id: 'movement-travel',
        title: 'Movement & Travel',
        icon: '🌟',
        tags: ['mechanics', 'movement'],
        summary: 'Impulse, warp, and interstellar gate mechanics',
        content: formatMovementTravelContent()
      },
      {
        id: 'warp-lanes',
        title: 'Warp Lanes',
        icon: '🌌',
        tags: ['mechanics', 'travel', 'lanes', 'navigation'],
        summary: 'Fast corridors connecting key locations in each system',
        content: formatWarpLanesContent()
      },
      {
        id: 'lane-capacity',
        title: 'Lane Capacity & Congestion',
        icon: '🚦',
        tags: ['mechanics', 'lanes', 'capacity', 'congestion'],
        summary: 'How lane capacity affects travel speed and planning',
        content: formatLaneCapacityContent()
      },
      {
        id: 'interdiction-system',
        title: 'Interdiction & Combat',
        icon: '⚔️',
        tags: ['mechanics', 'combat', 'interdiction', 'lanes'],
        summary: 'How combat works in and around warp lanes',
        content: formatInterdictionContent()
      },
      {
        id: 'archetype-travel',
        title: 'Archetype Travel Mechanics',
        icon: '🌀',
        tags: ['mechanics', 'archetypes', 'travel', 'specialization'],
        summary: 'How each system archetype affects travel and navigation',
        content: formatArchetypeTravelContent()
      },
      {
        id: 'mining-economy',
        title: 'Mining & Economy',
        icon: '⛏️',
        tags: ['mechanics', 'economy'],
        summary: 'Resource extraction and economic systems',
        content: formatMiningEconomyContent()
      },
      {
        id: 'visibility-scanning',
        title: 'Visibility & Scanning',
        icon: '👁️',
        tags: ['mechanics', 'visibility'],
        summary: 'Fog of war and information gathering',
        content: formatVisibilityScanningContent()
      }
    ];
  }

  function generateInfrastructureEntries() {
    return [
      {
        id: 'stations-structures',
        title: 'Stations & Structures',
        icon: '🏭',
        tags: ['infrastructure', 'stations'],
        summary: 'Your permanent installations',
        content: formatStationsStructuresContent()
      },
      {
        id: 'logistics-cargo',
        title: 'Logistics & Cargo',
        icon: '📦',
        tags: ['infrastructure', 'logistics'],
        summary: 'Moving resources and managing supply chains',
        content: formatLogisticsCargoContent()
      },
      {
        id: 'fleet-management',
        title: 'Fleet Management',
        icon: '🚢',
        tags: ['infrastructure', 'fleet'],
        summary: 'Organizing and maintaining your ships',
        content: formatFleetManagementContent()
      },
      {
        id: 'economic-systems',
        title: 'Economic Systems',
        icon: '💰',
        tags: ['infrastructure', 'economy'],
        summary: 'Resource management and trade',
        content: formatEconomicSystemsContent()
      }
    ];
  }

  // Content formatting functions
  function formatWelcomeContent() {
    return `
      <div class="welcome-content">
        <h2>Commander, welcome to the depths of space.</h2>
        <p>Starfront: Dominion is a strategic space exploration and resource management game set in a procedurally generated galaxy.</p>

        <h3>Your Mission</h3>
        <ul>
          <li><strong>Explore:</strong> Chart the unknown reaches of space</li>
          <li><strong>Extract:</strong> Mine valuable resources from asteroid belts and nebulae</li>
          <li><strong>Construct:</strong> Build ships to expand your capabilities</li>
          <li><strong>Dominate:</strong> Establish economic and military superiority</li>
        </ul>

        <h3>Key Concepts</h3>
        <ul>
          <li><strong>Systems:</strong> Unique sectors with different resource profiles</li>
          <li><strong>Archetypes:</strong> System types that influence resource availability</li>
          <li><strong>Turns:</strong> Plan your moves, then watch them resolve simultaneously</li>
          <li><strong>Visibility:</strong> Scan to reveal hidden objects and ships</li>
        </ul>
      </div>
    `;
  }

  function formatQuickStartContent() {
    return `
      <div class="quickstart-content">
        <h3>1. Choose Your Ship</h3>
        <p>Select from available blueprints in the Shipyard. Start with the Explorer for its balanced capabilities.</p>

        <h3>2. Set Your Destination</h3>
        <p>Use the map to select a warp destination. Look for asteroid belts (☄️) for resources.</p>

        <h3>3. Mine Resources</h3>
        <p>Move to resource nodes and use mining abilities to extract materials.</p>

        <h3>4. Build & Expand</h3>
        <p>Return to your station to build new ships and structures.</p>

        <h3>5. Plan Your Turns</h3>
        <p>Coordinate multiple ships for maximum efficiency before locking your turn.</p>
      </div>
    `;
  }

  function formatFirstStepsContent() {
    return `
      <div class="first-steps-content">
        <h3>Immediate Actions</h3>
        <ul>
          <li>Deploy a Starbase at your starting location</li>
          <li>Build an Explorer ship for scouting</li>
          <li>Scan nearby sectors to reveal resource opportunities</li>
          <li>Identify high-value resource nodes</li>
        </ul>

        <h3>Early Game Priorities</h3>
        <ul>
          <li>Secure a reliable source of core minerals</li>
          <li>Build multiple mining ships</li>
          <li>Establish cargo routes between resources and your base</li>
          <li>Expand your scanning range</li>
        </ul>

        <h3>Critical Resources</h3>
        <ul>
          <li><strong>Ferrite Alloy:</strong> Required for all ship construction</li>
          <li><strong>Crytite:</strong> Powers your ships and abilities</li>
          <li><strong>Ardanium:</strong> Enables long-range travel</li>
          <li><strong>Vornite:</strong> Improves ship systems</li>
          <li><strong>Zerothium:</strong> Stabilizes warp drives</li>
        </ul>
      </div>
    `;
  }

  function getShipIcon(role) {
    const icons = {
      'scout': '🔍',
      'pathfinder': '🧭',
      'interceptor': '⚡',
      'brawler': '💪',
      'sniper': '🎯',
      'carrier': '🚁',
      'miner': '⛏️',
      'logistics': '📦'
    };
    return icons[role] || '🚀';
  }

  function getAbilityIcon(type) {
    const icons = {
      'utility': '🔧',
      'offense': '⚔️',
      'defense': '🛡️',
      'support': '🤝'
    };
    return icons[type] || '✨';
  }

  function formatShipBlueprint(blueprint) {
    const stats = [];
    if (blueprint.maxHp) stats.push(`HP: ${blueprint.maxHp}`);
    if (blueprint.movementSpeed) stats.push(`Speed: ${blueprint.movementSpeed}`);
    if (blueprint.scanRange) stats.push(`Scan: ${blueprint.scanRange}`);
    if (blueprint.cargoCapacity) stats.push(`Cargo: ${blueprint.cargoCapacity}`);

    const coreReqs = Object.entries(blueprint.requirements.core)
      .map(([mineral, amount]) => `<span class="mineral-item core-mineral" data-mineral="${mineral}" title="${getMineralDescription(mineral)}">${mineral}: ${amount}</span>`)
      .join('');

    const specializedReqs = Object.entries(blueprint.requirements.specialized || {})
      .map(([mineral, amount]) => `<span class="mineral-item specialized-mineral" data-mineral="${mineral}" title="${getMineralDescription(mineral)}">${mineral}: ${amount}</span>`)
      .join('');

    return `
      <div class="ship-blueprint interactive" data-ship-id="${blueprint.id}">
        <div class="ship-header">
          <div class="ship-image">
            <img src="assets/ships/${blueprint.id}.png" alt="${blueprint.name}" loading="lazy" onerror="this.style.display='none'" data-lazy-loaded="false">
            <div class="ship-icon-fallback">${getShipIcon(blueprint.role)}</div>
          </div>
          <div class="ship-info">
          <h3>${blueprint.name}</h3>
            <div class="ship-meta">
          <span class="ship-class">${blueprint.class}</span>
          <span class="ship-role">${blueprint.role}</span>
            </div>
          </div>
        </div>

        <p class="ship-description">${blueprint.longDescription}</p>

        <div class="ship-stats collapsible">
          <h4 class="collapsible-header">Base Stats</h4>
          <div class="collapsible-content stats-grid">
            ${stats.map(stat => `<span class="stat-item" title="${stat}">${stat}</span>`).join('')}
          </div>
        </div>

        <div class="ship-requirements collapsible">
          <h4 class="collapsible-header">Construction Requirements</h4>
          <div class="collapsible-content">
          <div class="requirements-section">
            <h5>Core Minerals</h5>
              <div class="mineral-list">
                ${coreReqs}
              </div>
          </div>
          ${specializedReqs ? `
            <div class="requirements-section">
              <h5>Specialized Minerals</h5>
                <div class="mineral-list">
                  ${specializedReqs}
                </div>
            </div>
          ` : ''}
          </div>
        </div>

        ${blueprint.abilities && blueprint.abilities.length > 0 ? `
          <div class="ship-abilities collapsible">
            <h4 class="collapsible-header">Built-in Abilities</h4>
            <div class="collapsible-content">
              <ul class="ability-list">
                ${blueprint.abilities.map(ability => `<li class="ability-item" data-ability="${ability}" title="Click to learn more">${ability}</li>`).join('')}
            </ul>
            </div>
          </div>
        ` : ''}

        ${blueprint.upkeep && Object.keys(blueprint.upkeep).length > 0 ? `
          <div class="ship-upkeep collapsible">
            <h4 class="collapsible-header">Upkeep Costs</h4>
            <div class="collapsible-content">
              <div class="upkeep-costs">
                ${Object.entries(blueprint.upkeep).map(([mineral, cost]) =>
                  `<span class="mineral-item upkeep-mineral" data-mineral="${mineral}" title="${getMineralDescription(mineral)}">${mineral}: ${cost}/turn</span>`
                ).join('')}
              </div>
            </div>
          </div>
        ` : ''}

        <div class="ship-strategy collapsible">
          <h4 class="collapsible-header">Strategic Notes</h4>
          <div class="collapsible-content">
            <p>${getShipStrategy(blueprint.id)}</p>
          </div>
        </div>
      </div>
    `;
  }

  function formatAbilityDetails(ability) {
    return `
      <div class="ability-details">
        <div class="ability-header">
          <h3>${ability.name}</h3>
          <span class="ability-type">${ability.type}</span>
        </div>

        <p class="ability-description">${ability.longDescription}</p>

        <div class="ability-stats">
          <div class="stat-row">
            <span class="stat-label">Cooldown:</span>
            <span class="stat-value">${ability.cooldown} turns</span>
          </div>
          ${ability.energyCost ? `
            <div class="stat-row">
              <span class="stat-label">Energy Cost:</span>
              <span class="stat-value">${ability.energyCost}</span>
            </div>
          ` : ''}
          ${ability.range && ability.range !== null ? `
            <div class="stat-row">
              <span class="stat-label">Range:</span>
              <span class="stat-value">${ability.range === null ? 'Self' : ability.range}</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // Helper functions for interactive content
  function getMineralDescription(mineralName) {
    const mineralData = {
      // Core Minerals (5)
      'Ferrite Alloy': 'Primary hull metal for frames, armor, and ship plating. Universal bottleneck for shipbuilding.',
      'Crytite': 'Energy storage crystal for reactors and weapon capacitors. Vital to all ships.',
      'Ardanium': 'Structural reinforcement alloy to prevent FTL hull stress.',
      'Vornite': 'Electronic-grade conductor for navigation and targeting systems.',
      'Zerothium': 'Warp stabilizer material for long-range drives.',

      // Specialized Minerals (25)
      'Spectrathene': 'Core stealth material for cloaks and sensor dampening.',
      'Auralite': 'Precision sensor and targeting enhancement crystal.',
      'Gravium': 'Heavy element for gravity-based weapons and tractor systems.',
      'Fluxium': 'Agile FTL tuning crystal, used for speed boosts and interceptors.',
      'Corvexite': 'Plasma and hull-piercing munitions core.',
      'Voidglass': 'Elite stealth hull coating material.',
      'Heliox Ore': 'Life support and colony atmosphere material.',
      'Neurogel': 'Neural interface substrate for AI cores and drone control.',
      'Phasegold': 'Teleportation and phase-cloak resonator metal.',
      'Kryon Dust': 'Cryogenic stasis & missile cooling agent.',
      'Riftstone': 'Wormhole and dimensional stability crystal.',
      'Solarite': 'High-energy fuel for lasers and energy stations.',
      'Mythrion': 'Ultra-light structural alloy for high-speed ships.',
      'Drakonium': 'Plasma weapon core and heavy artillery material.',
      'Aurivex': 'Prestige alloy for elite diplomatic ships.',
      'Aetherium': 'Long-range communication and command relay crystal.',
      'Tachytrium': 'FTL overdrive mineral for extreme speed.',
      'Oblivium': 'Energy-absorption armor plating material.',
      'Luminite': 'High-efficiency shield generator crystal.',
      'Cryphos': 'Electromagnetic weapon capacitor mineral.',
      'Pyronex': 'Thermal lance and heat-based weapon core.',
      'Nebryllium': 'Sensor jamming and false signal generation mineral.',
      'Magnetrine': 'Magnetic railgun and tractor system component.',
      'Quarzon': 'Multi-spectrum targeting and optics material.',
      'Starforged Carbon': 'Dense armor plating material for capitals.',

      // Legacy minerals (kept for compatibility)
      'rock': 'Legacy common construction material.',
      'gas': 'Legacy nebula gas used historically.',
      'energy': 'Legacy energy nodes around stars.',
      'salvage': 'Recovered tech and components from derelicts.'
    };
    return mineralData[mineralName] || `${mineralName} - Mineral description not available`;
  }

  function getShipStrategy(shipId) {
    const strategies = {
      'explorer': 'Perfect for early game scouting and resource prospecting. Use the Explorer to map asteroid belts and nebulae, then return to base to build specialized ships based on what you find.',
      'needle-gunship': 'Close-range brawler that excels at intercepting and disrupting enemy operations. Best used in hit-and-run tactics against larger, slower targets.',
      'drill-skiff': 'Heavy mining specialist designed for maximum resource extraction. Position in rich resource nodes and let it work while you defend the area.',
      'swift-courier': 'High-speed logistics vessel for rapid resource transport. Use to ferry minerals between mining operations and your main base efficiently.'
    };
    return strategies[shipId] || 'Strategic information not available for this ship type.';
  }

  // Add collapsible functionality
  function initializeCollapsibleElements(container) {
    const headers = container.querySelectorAll('.collapsible-header');
    headers.forEach(header => {
      header.addEventListener('click', () => {
        const content = header.nextElementSibling;
        const isExpanded = content.classList.contains('expanded');

        if (isExpanded) {
          content.classList.remove('expanded');
          header.classList.remove('expanded');
        } else {
          content.classList.add('expanded');
          header.classList.add('expanded');
        }
      });
    });
  }

  // Lazy loading for images
  function initializeLazyLoading(container) {
    const images = container.querySelectorAll('img[data-lazy-loaded="false"]');

    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.setAttribute('data-lazy-loaded', 'true');
          observer.unobserve(img);
        }
      });
    }, {
      rootMargin: '50px 0px',
      threshold: 0.1
    });

    images.forEach(img => imageObserver.observe(img));
  }

  // Performance optimization: Debounced content updates
  let contentUpdateTimeout;
  function debounceContentUpdate(callback, delay = 100) {
    clearTimeout(contentUpdateTimeout);
    contentUpdateTimeout = setTimeout(callback, delay);
  }

  // Performance optimization: Memoized mineral descriptions
  const mineralDescriptionCache = new Map();
  function getCachedMineralDescription(mineralName) {
    if (mineralDescriptionCache.has(mineralName)) {
      return mineralDescriptionCache.get(mineralName);
    }
    const description = getMineralDescription(mineralName);
    mineralDescriptionCache.set(mineralName, description);
    return description;
  }

  // Performance optimization: Throttled search for very rapid typing
  let searchThrottleTimeout;
  let lastProcessedSearchTerm = '';
  function throttleSearch(callback, delay = 50) {
    if (searchThrottleTimeout) return;
    searchThrottleTimeout = setTimeout(() => {
      callback();
      searchThrottleTimeout = null;
    }, delay);
  }

  // Performance optimization: Avoid unnecessary search processing
  function shouldProcessSearch(newTerm, oldTerm) {
    // Skip if terms are identical
    if (newTerm === oldTerm) return false;

    // Skip if both are empty or whitespace-only
    if (!newTerm.trim() && !oldTerm.trim()) return false;

    // Skip if only minor differences (like trailing spaces)
    if (newTerm.trim() === oldTerm.trim()) return false;

    return true;
  }

  // Enhanced mineral display with images
  function createMineralDisplay(mineralName, amount, type = 'core') {
    const mineralKey = mineralName.toLowerCase().replace(/\s+/g, '-');
    return `
      <div class="mineral-display ${type}-mineral" data-mineral="${mineralName}">
        <div class="mineral-image">
          <img src="assets/minerals/${mineralKey}.png" alt="${mineralName}" loading="lazy" onerror="this.style.display='none'" data-lazy-loaded="false">
          <div class="mineral-icon-fallback">${getMineralIcon(mineralName)}</div>
        </div>
        <div class="mineral-info">
          <span class="mineral-name">${mineralName}</span>
          ${amount ? `<span class="mineral-amount">${amount}</span>` : ''}
        </div>
        <div class="mineral-tooltip">${getMineralDescription(mineralName)}</div>
      </div>
    `;
  }

  function getMineralIcon(mineralName) {
    // Return appropriate emoji based on mineral type
    const iconMap = {
      'Ferrite Alloy': '🔩',
      'Crytite': '🔷',
      'Ardanium': '🟢',
      'Vornite': '🔌',
      'Zerothium': '⚫',
      'Spectrathene': '🔮',
      'Auralite': '🔆',
      'Gravium': '🕳️',
      'Fluxium': '🌀',
      'Corvexite': '💥',
      'Voidglass': '🌑',
      'Heliox Ore': '💨',
      'Neurogel': '🧠',
      'Phasegold': '🟡',
      'Kryon Dust': '❄️',
      'Riftstone': '🟣',
      'Solarite': '☀️',
      'Mythrion': '⚪',
      'Drakonium': '🐉',
      'Aurivex': '🏅',
      'Aetherium': '📡',
      'Tachytrium': '⚡',
      'Oblivium': '⬛',
      'Luminite': '💎',
      'Cryphos': '⚡',
      'Pyronex': '🔥',
      'Nebryllium': '🌫️',
      'Magnetrine': '🧲',
      'Quarzon': '🔷',
      'Starforged Carbon': '🛡️'
    };
    return iconMap[mineralName] || '⭕';
  }

  function formatArchetypeDetails(archetype) {
    const coreBias = archetype.coreBias || {};
    const fixedSpecialized = archetype.fixedSpecialized || [];

    return `
      <div class="archetype-details">
        <h3>${archetype.displayName}</h3>
        <p class="archetype-description">${archetype.description}</p>

        ${Object.keys(coreBias).length > 0 ? `
          <div class="archetype-bias">
            <h4>Core Mineral Bias</h4>
            <ul>
              ${Object.entries(coreBias).map(([mineral, multiplier]) =>
                `<li>${mineral}: ${Number(multiplier).toFixed(2)}x</li>`
              ).join('')}
            </ul>
          </div>
        ` : ''}

        ${fixedSpecialized.length > 0 ? `
          <div class="archetype-specialized">
            <h4>Featured Specialized Minerals</h4>
            <ul>
              ${fixedSpecialized.map(mineral => `<li>${mineral}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <div class="archetype-strategy">
          <h4>Strategic Considerations</h4>
          <p>Each system archetype offers unique opportunities and challenges. Understanding these patterns helps optimize your resource extraction and fleet composition.</p>
        </div>
      </div>
    `;
  }

  // Placeholder content functions for remaining sections
  function formatConstructionContent() {
    const coreMinerals = [
      { name: 'Ferrite Alloy', desc: 'Primary hull metal for frames, armor, and ship plating. Universal bottleneck for shipbuilding.' },
      { name: 'Crytite', desc: 'Energy storage crystal for reactors and weapon capacitors. Vital to all ships.' },
      { name: 'Ardanium', desc: 'Structural reinforcement alloy to prevent FTL hull stress.' },
      { name: 'Vornite', desc: 'Electronic-grade conductor for navigation and targeting systems.' },
      { name: 'Zerothium', desc: 'Warp stabilizer material for long-range drives.' }
    ];

    const specializedMinerals = [
      { name: 'Spectrathene', desc: 'Core stealth material for cloaks and sensor dampening.' },
      { name: 'Auralite', desc: 'Precision sensor and targeting enhancement crystal.' },
      { name: 'Gravium', desc: 'Heavy element for gravity-based weapons and tractor systems.' },
      { name: 'Fluxium', desc: 'Agile FTL tuning crystal, used for speed boosts and interceptors.' },
      { name: 'Corvexite', desc: 'Plasma and hull-piercing munitions core.' },
      { name: 'Voidglass', desc: 'Elite stealth hull coating material.' },
      { name: 'Heliox Ore', desc: 'Life support and colony atmosphere material.' },
      { name: 'Neurogel', desc: 'Neural interface substrate for AI cores and drone control.' },
      { name: 'Phasegold', desc: 'Teleportation and phase-cloak resonator metal.' },
      { name: 'Kryon Dust', desc: 'Cryogenic stasis & missile cooling agent.' },
      { name: 'Riftstone', desc: 'Wormhole and dimensional stability crystal.' },
      { name: 'Solarite', desc: 'High-energy fuel for lasers and energy stations.' },
      { name: 'Mythrion', desc: 'Ultra-light structural alloy for high-speed ships.' },
      { name: 'Drakonium', desc: 'Plasma weapon core and heavy artillery material.' },
      { name: 'Aurivex', desc: 'Prestige alloy for elite diplomatic ships.' },
      { name: 'Aetherium', desc: 'Long-range communication and command relay crystal.' },
      { name: 'Tachytrium', desc: 'FTL overdrive mineral for extreme speed.' },
      { name: 'Oblivium', desc: 'Energy-absorption armor plating material.' },
      { name: 'Luminite', desc: 'High-efficiency shield generator crystal.' },
      { name: 'Cryphos', desc: 'Electromagnetic weapon capacitor mineral.' },
      { name: 'Pyronex', desc: 'Thermal lance and heat-based weapon core.' },
      { name: 'Nebryllium', desc: 'Sensor jamming and false signal generation mineral.' },
      { name: 'Magnetrine', desc: 'Magnetic railgun and tractor system component.' },
      { name: 'Quarzon', desc: 'Multi-spectrum targeting and optics material.' },
      { name: 'Starforged Carbon', desc: 'Dense armor plating material for capitals.' }
    ];

    return `
      <div class="construction-content">
        <h3>Ship Construction Process</h3>
        <p>All ships require core minerals plus role-specific specialized minerals. Construction happens at stations and takes one turn to complete.</p>

        <div class="collapsible">
          <h4 class="collapsible-header">Core Minerals (Always Required)</h4>
          <div class="collapsible-content">
            <div class="mineral-list">
              ${coreMinerals.map(mineral => `
                <span class="mineral-item core-mineral" data-mineral="${mineral.name}" title="${mineral.desc}">
                  ${mineral.name}
                </span>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="collapsible">
          <h4 class="collapsible-header">Specialized Minerals (25 Total)</h4>
          <div class="collapsible-content">
            <p>Each ship role requires different specialized minerals that enhance specific capabilities. These minerals are distributed across system archetypes with varying biases.</p>
            <div class="mineral-list">
              ${specializedMinerals.map(mineral => `
                <span class="mineral-item specialized-mineral" data-mineral="${mineral.name}" title="${mineral.desc}">
                  ${mineral.name}
                </span>
              `).join('')}
            </div>
          </div>
        </div>

        <h3>Mineral Distribution</h3>
        <p>Each system archetype features different mineral biases, making trade and territorial control essential for accessing rare resources.</p>
      </div>
    `;
  }

  function formatCombatMechanicsContent() {
    return `
      <div class="combat-content">
        <h3>Combat Resolution</h3>
        <p>Combat occurs simultaneously during turn resolution. Ships use abilities to engage each other.</p>

        <h3>Ability Types</h3>
        <ul>
          <li><strong>Offense:</strong> Direct damage and disruption</li>
          <li><strong>Utility:</strong> Movement and positioning</li>
          <li><strong>Defense:</strong> Protection and survival</li>
          <li><strong>Support:</strong> Fleet coordination</li>
        </ul>

        <h3>Energy Management</h3>
        <p>Most abilities consume energy. Ships regenerate energy each turn, but overusing abilities can leave you vulnerable.</p>
      </div>
    `;
  }

  function formatCelestialObjectContent(type) {
    const content = {
      belts: `
        <div class="celestial-content">
          <h3>Asteroid Belts</h3>
          <p>Rock resource hotspots that spawn near warp entry points. These are the most competitive resource locations.</p>

          <h4>Characteristics</h4>
          <ul>
            <li>High rock concentrations</li>
            <li>Multiple extraction points</li>
            <li>Strategic locations</li>
            <li>Heavy competition</li>
          </ul>

          <h4>Strategy</h4>
          <p>Secure belts early for reliable core mineral supplies. Use explorers to scout and secure positions.</p>
        </div>
      `,
      nebulae: `
        <div class="celestial-content">
          <h3>Nebulae</h3>
          <p>Gas cloud formations that provide specialized resource extraction opportunities.</p>

          <h4>Characteristics</h4>
          <ul>
            <li>Gas resource concentrations</li>
            <li>Stealth advantages</li>
            <li>Slower extraction</li>
            <li>Lower competition</li>
          </ul>

          <h4>Strategy</h4>
          <p>Ideal for stealth operations and specialized gas harvesting. Less contested than belts.</p>
        </div>
      `
    };
    return content[type] || '<p>Content not found</p>';
  }

  function formatResourceDistributionContent(archetypes) {
    return `
      <div class="resource-distribution">
        <h3>Resource Distribution Patterns</h3>
        <p>Each system archetype influences which resources are more abundant, creating strategic opportunities.</p>

        <h4>Core Resources</h4>
        <p>Ferrite Alloy, Crytite, Ardanium, Vornite, and Zerothium are available in all systems but at varying rates.</p>

        <h4>Primary Resources</h4>
        <p>Each archetype features 2-3 primary specialized minerals that are more common.</p>

        <h4>Secondary Resources</h4>
        <p>Less common minerals that require dedicated operations but offer unique advantages.</p>

        <h4>Strategic Planning</h4>
        <p>Understanding these patterns allows you to specialize your operations and trade for needed resources.</p>
      </div>
    `;
  }

  function formatTurnResolutionContent() {
    return `
      <div class="turn-resolution">
        <h3>Turn Resolution Order</h3>
        <ol>
          <li><strong>Ability Processing:</strong> All ability effects resolve</li>
          <li><strong>Movement:</strong> Ships move to new positions</li>
          <li><strong>Visibility Updates:</strong> Scanning reveals new information</li>
          <li><strong>Cleanup:</strong> Old movement orders are cleared</li>
        </ol>

        <h4>Simultaneous Resolution</h4>
        <p>All actions resolve at the same time, making prediction and timing critical.</p>
      </div>
    `;
  }

  function formatMovementTravelContent() {
    return `
      <div class="movement-travel">
        <h3>Movement Types</h3>

        <h4>Impulse Movement</h4>
        <p>Standard tile-by-tile movement using your ship's speed. Reliable but slow for long distances.</p>

        <h4>Warp Travel</h4>
        <p>Instant movement to visible destinations within range. Requires energy and has strategic limitations.</p>

        <h4>Interstellar Gates</h4>
        <p>Permanent structures that allow travel between sectors. Expensive to deploy but enable expansion.</p>

        <h4>Strategic Considerations</h4>
        <p>Each movement type has different costs, limitations, and strategic implications.</p>
      </div>
    `;
  }

  function formatMiningEconomyContent() {
    return `
      <div class="mining-economy">
        <h3>Mining Process</h3>
        <p>Move adjacent to resource nodes and use mining abilities to extract materials.</p>

        <h4>Resource Types</h4>
        <ul>
          <li><strong>Rock:</strong> Core minerals from asteroid belts</li>
          <li><strong>Gas:</strong> Specialized minerals from nebulae</li>
          <li><strong>Energy:</strong> Power sources from stars</li>
        </ul>

        <h4>Economic Factors</h4>
        <ul>
          <li>Resource scarcity affects prices</li>
          <li>Transportation costs impact efficiency</li>
          <li>Storage limitations constrain operations</li>
          <li>Market dynamics influence strategy</li>
        </ul>
      </div>
    `;
  }

  function formatVisibilityScanningContent() {
    return `
      <div class="visibility-scanning">
        <h3>Fog of War</h3>
        <p>Most of the galaxy starts hidden. You must actively scan to reveal information.</p>

        <h4>Scanning Mechanics</h4>
        <ul>
          <li><strong>Base Scan Range:</strong> Ships reveal nearby tiles</li>
          <li><strong>Active Scanning:</strong> Abilities extend vision at energy cost</li>
          <li><strong>Persistent Vision:</strong> Once scanned, areas stay visible</li>
          <li><strong>Shared Intelligence:</strong> All your ships benefit from scanning</li>
        </ul>

        <h4>Information Warfare</h4>
        <p>Scanning is both offensive (gathering intelligence) and defensive (denying information to opponents).</p>
      </div>
    `;
  }

  function formatStationsStructuresContent() {
    return `
      <div class="stations-structures">
        <h3>Station Types</h3>

        <h4>Starbase (Command Center)</h4>
        <p>Your primary hub for construction, storage, and fleet management.</p>

        <h4>Deployable Structures</h4>
        <ul>
          <li><strong>Storage Boxes:</strong> Portable resource containers</li>
          <li><strong>Warp Beacons:</strong> Navigation waypoints</li>
          <li><strong>Interstellar Gates:</strong> Sector connections</li>
        </ul>

        <h4>Strategic Placement</h4>
        <p>Structure placement affects logistics efficiency and territorial control.</p>
      </div>
    `;
  }

  function formatLogisticsCargoContent() {
    return `
      <div class="logistics-cargo">
        <h3>Cargo Management</h3>
        <p>Efficient resource movement is critical for economic success.</p>

        <h4>Transportation Methods</h4>
        <ul>
          <li><strong>Ship Cargo:</strong> Direct transport via ship capacity</li>
          <li><strong>Storage Structures:</strong> Temporary holding facilities</li>
          <li><strong>Supply Chains:</strong> Multi-step resource routing</li>
        </ul>

        <h4>Optimization Strategies</h4>
        <ul>
          <li>Balance cargo capacity with speed</li>
          <li>Position storage strategically</li>
          <li>Minimize empty return trips</li>
          <li>Plan for resource dependencies</li>
        </ul>
      </div>
    `;
  }

  function formatFleetManagementContent() {
    return `
      <div class="fleet-management">
        <h3>Fleet Organization</h3>
        <p>Effective fleet management requires balancing specialization and flexibility.</p>

        <h4>Fleet Composition</h4>
        <ul>
          <li><strong>Scouts:</strong> Exploration and reconnaissance</li>
          <li><strong>Miners:</strong> Resource extraction</li>
          <li><strong>Logistics:</strong> Transportation and supply</li>
          <li><strong>Combat:</strong> Protection and engagement</li>
        </ul>

        <h4>Maintenance Considerations</h4>
        <ul>
          <li>Upkeep costs for active ships</li>
          <li>Positioning for efficient operations</li>
          <li>Coordination for simultaneous actions</li>
          <li>Adaptation to changing conditions</li>
        </ul>
      </div>
    `;
  }

  function formatEconomicSystemsContent() {
    return `
      <div class="economic-systems">
        <h3>Economic Dynamics</h3>
        <p>The galactic economy is driven by resource scarcity and transportation costs.</p>

        <h4>Key Factors</h4>
        <ul>
          <li><strong>Scarcity:</strong> Rare minerals command higher value</li>
          <li><strong>Transportation:</strong> Distance affects profitability</li>
          <li><strong>Competition:</strong> Multiple players compete for resources</li>
          <li><strong>Specialization:</strong> Focus on high-value resources</li>
        </ul>

        <h4>Economic Strategies</h4>
        <ul>
          <li>Secure reliable core mineral sources</li>
          <li>Specialize in high-demand specialized minerals</li>
          <li>Establish efficient logistics networks</li>
          <li>Balance production with consumption needs</li>
        </ul>
      </div>
    `;
  }

  function formatWarpLanesContent() {
    return `
      <div class="warp-lanes">
        <h3>Warp Lane System</h3>
        <p>Warp lanes are high-speed corridors that connect key locations within each star system. Unlike traditional warp travel, lanes provide predictable, fast transit with strategic trade-offs.</p>

        <h4>Lane Structure</h4>
        <ul>
          <li><strong>Core:</strong> Bright center providing maximum speed and protection</li>
          <li><strong>Shoulder:</strong> Fainter halo with moderate speed and reduced protection</li>
          <li><strong>Taps:</strong> Diamonds marking on-ramps/off-ramps for entering lanes</li>
          <li><strong>Deep Space:</strong> Area outside lanes with traditional interdiction risks</li>
        </ul>

        <h4>Using Lanes</h4>
        <div class="collapsible">
          <h4 class="collapsible-header">1. Entering Lanes</h4>
          <div class="collapsible-content">
            <ul>
              <li><strong>Taps:</strong> Use designated tap points for fast, safe entry (1-turn merge)</li>
              <li><strong>Wildcat Merges:</strong> Enter from deep space anywhere along the lane (slower, riskier)</li>
              <li><strong>Route Planning:</strong> The map shows multiple route options with ETA and risk estimates</li>
            </ul>
          </div>
        </div>

        <div class="collapsible">
          <h4 class="collapsible-header">2. Lane Travel</h4>
          <div class="collapsible-content">
            <p>Once in a lane, ships benefit from:</p>
            <ul>
              <li>Significantly boosted speed (3-5x impulse)</li>
              <li>Reduced interdiction risk in healthy cores</li>
              <li>Predictable travel times</li>
              <li>Capacity-based congestion effects</li>
            </ul>
          </div>
        </div>

        <div class="collapsible">
          <h4 class="collapsible-header">3. Exiting Lanes</h4>
          <div class="collapsible-content">
            <ul>
              <li><strong>Soft Off-ramps:</strong> 1-turn merge to shoulder/deep space</li>
              <li><strong>Hard Off-ramps:</strong> Forced exits from interdiction or emergencies</li>
              <li><strong>Scatter Effects:</strong> Hard exits cause brief stun and position randomization</li>
            </ul>
          </div>
        </div>

        <h4>Strategic Considerations</h4>
        <ul>
          <li><strong>Route Selection:</strong> Choose lanes based on capacity, region health, and security</li>
          <li><strong>Timing:</strong> Monitor congestion and plan heavy convoys around peak times</li>
          <li><strong>Security:</strong> Healthy regions provide better protection in lane cores</li>
          <li><strong>Alternatives:</strong> Always identify backup routes through different lanes or deep space</li>
        </ul>
      </div>
    `;
  }

  function formatLaneCapacityContent() {
    return `
      <div class="lane-capacity">
        <h3>Capacity & Congestion Mechanics</h3>
        <p>Each warp lane has limited capacity measured in Convoy Units (CU). Understanding capacity is crucial for efficient logistics.</p>

        <h4>Convoy Unit Examples</h4>
        <ul>
          <li><strong>Interceptors:</strong> 0.5 CU (small, agile)</li>
          <li><strong>Frigates:</strong> 1.0 CU (standard combat ships)</li>
          <li><strong>Haulers:</strong> 1.5 CU (cargo vessels)</li>
          <li><strong>Capitals:</strong> 3.0 CU (large command ships)</li>
        </ul>

        <h4>Congestion Effects</h4>
        <div class="collapsible">
          <h4 class="collapsible-header">Load Thresholds</h4>
          <div class="collapsible-content">
            <ul>
              <li><strong>≤100%:</strong> Full speed, optimal travel</li>
              <li><strong>100-150%:</strong> 20% speed reduction</li>
              <li><strong>150-200%:</strong> 40% speed reduction</li>
              <li><strong>>200%:</strong> 60% speed reduction, interdiction risk +10%</li>
            </ul>
          </div>
        </div>

        <h4>Capacity Management</h4>
        <ul>
          <li><strong>Stagger Departures:</strong> Split large convoys across multiple turns</li>
          <li><strong>Alternative Routes:</strong> Use secondary lanes when primary routes are congested</li>
          <li><strong>Region Health:</strong> Maintain system regions to increase lane capacity</li>
          <li><strong>Archetype Effects:</strong> Some systems have natural bottlenecks or advantages</li>
        </ul>

        <h4>Visual Indicators</h4>
        <ul>
          <li><strong>Green:</strong> Clear lanes, optimal speed</li>
          <li><strong>Yellow:</strong> Moderate congestion, reduced speed</li>
          <li><strong>Red:</strong> Heavy congestion, significant delays</li>
          <li><strong>Tap Pips:</strong> Show queue length and estimated wait times</li>
        </ul>
      </div>
    `;
  }

  function formatInterdictionContent() {
    return `
      <div class="interdiction-system">
        <h3>Interdiction & Lane Combat</h3>
        <p>Combat in warp lanes differs significantly from deep space encounters, with specialized mechanics for each zone.</p>

        <h4>Interdiction Zones</h4>
        <div class="collapsible">
          <h4 class="collapsible-header">Deep Space (Outside Lanes)</h4>
          <div class="collapsible-content">
            <ul>
              <li><strong>Risk:</strong> Full interdiction strength</li>
              <li><strong>Best For:</strong> Ambushes and piracy</li>
              <li><strong>Counterplay:</strong> Stealth modules, decoy clouds</li>
            </ul>
          </div>
        </div>

        <div class="collapsible">
          <h4 class="collapsible-header">Lane Shoulder</h4>
          <div class="collapsible-content">
            <ul>
              <li><strong>Risk:</strong> Reduced interdiction (-30% power)</li>
              <li><strong>Requirements:</strong> Attacker must be in or near lane</li>
              <li><strong>Best For:</strong> Hit-and-run tactics</li>
            </ul>
          </div>
        </div>

        <div class="collapsible">
          <h4 class="collapsible-header">Lane Core (Healthy Regions)</h4>
          <div class="collapsible-content">
            <ul>
              <li><strong>Risk:</strong> Heavily reduced or blocked interdiction</li>
              <li><strong>Requirements:</strong> Attacker needs special equipment</li>
              <li><strong>Best For:</strong> Safe, predictable travel</li>
            </ul>
          </div>
        </div>

        <h4>Interdiction Tools</h4>
        <ul>
          <li><strong>Warp Disruptors:</strong> Single-target scram that prevents lane entry</li>
          <li><strong>Web Fields:</strong> Slow targets and increase merge/exit times</li>
          <li><strong>Interdictor Buoys:</strong> Area denial that weakens lane protection</li>
          <li><strong>Drag/Repulse Beams:</strong> Force ships out of protective cores</li>
        </ul>

        <h4>Defensive Tools</h4>
        <ul>
          <li><strong>Nullfield Burst:</strong> Temporary immunity to scrams</li>
          <li><strong>Phase Slip:</strong> Instant repositioning core-ward</li>
          <li><strong>Decoy Cloud:</strong> Creates false lock targets</li>
          <li><strong>Escort Tow:</strong> Pulls allies back into protective cores</li>
        </ul>

        <h4>Archetype Considerations</h4>
        <ul>
          <li><strong>Diplomatic Expanse:</strong> C-core interdiction is illegal when C≥60</li>
          <li><strong>Wormhole Cluster:</strong> Customs pylons reduce acquisition odds</li>
          <li><strong>Graviton Sink:</strong> Enhanced scatter effects from shear spikes</li>
          <li><strong>Solar Flare:</strong> Protection fluctuates during flare peaks</li>
        </ul>
      </div>
    `;
  }

  function formatArchetypeTravelContent() {
    return `
      <div class="archetype-travel">
        <h3>System-Specific Travel Mechanics</h3>
        <p>Each system archetype features unique travel challenges and opportunities that affect lane behavior, interdiction, and navigation.</p>

        <div class="archetype-grid">
          <div class="archetype-card">
            <h4>🏛️ Diplomatic Expanse</h4>
            <ul>
              <li><strong>C-Spine Corridor:</strong> Arbitration cores when C≥60</li>
              <li><strong>Permit System:</strong> 30% reserved slots for holders</li>
              <li><strong>Customs Enforcement:</strong> Fines for shoulder freeloaders</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>🕳️ Wormhole Cluster</h4>
            <ul>
              <li><strong>Ringway Network:</strong> Hub-and-spoke around wormhole</li>
              <li><strong>Periodic Windows:</strong> Ring stability cycles</li>
              <li><strong>Customs Pylons:</strong> Reduce interdiction success</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>🌪️ Graviton Sink</h4>
            <ul>
              <li><strong>Slingshot Arcs:</strong> Free speed boost when A≥80</li>
              <li><strong>Shear Dynamics:</strong> Convoy windows for safe transit</li>
              <li><strong>Enhanced Scatter:</strong> Forced exits cause more disruption</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>☄️ Asteroid-Heavy Belt</h4>
            <ul>
              <li><strong>Belt Trails:</strong> Weaving paths through dense rubble</li>
              <li><strong>Debris Clearance:</strong> Tug sweep windows</li>
              <li><strong>Capacity Reduction:</strong> Natural bottlenecks</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>☀️ Solar Flare Engine</h4>
            <ul>
              <li><strong>Flare Synced:</strong> Speed surges during lulls</li>
              <li><strong>Window Edges:</strong> Snare opportunities</li>
              <li><strong>Core Protection:</strong> Dips during flare peaks</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>🌌 Dark Nebula Nursery</h4>
            <ul>
              <li><strong>Shadow Alleys:</strong> Stealth buff corridors</li>
              <li><strong>Bright Bypasses:</strong> Fast but risky alternatives</li>
              <li><strong>Stealth Advantages:</strong> Reduced interdiction odds</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>⚡ Ion Tempest</h4>
            <ul>
              <li><strong>Grounded Rails:</strong> Storm-safe corridors</li>
              <li><strong>Weather Windows:</strong> Storm shift tracking</li>
              <li><strong>EM Interference:</strong> Temporary protection dips</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>📡 Starlight Relay</h4>
            <ul>
              <li><strong>Slipstream Core:</strong> Fast when synced</li>
              <li><strong>Beacon Network:</strong> Parallel routing options</li>
              <li><strong>Permit Gating:</strong> 35% reserved for authorized users</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>🧊 Cryo Comet Rain</h4>
            <ul>
              <li><strong>Icing Events:</strong> Lane width reduction</li>
              <li><strong>Convoy Windows:</strong> Longer safe periods</li>
              <li><strong>Cryo Permits:</strong> Bonus slots for specialized cargo</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>🔥 Supernova Remnant</h4>
            <ul>
              <li><strong>Heat Pockets:</strong> Force hard off-ramps</li>
              <li><strong>Calm Swells:</strong> Brief safe windows</li>
              <li><strong>Shielding Projects:</strong> Can restore lost capacity</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>💫 Binary Star System</h4>
            <ul>
              <li><strong>Tidal Sling:</strong> Alignment-based speed boosts</li>
              <li><strong>Eclipse Windows:</strong> Near barycenter timing</li>
              <li><strong>Periastron Risk:</strong> Enhanced mishap chances</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>🚢 Capital Forgeyard</h4>
            <ul>
              <li><strong>Tow Lanes:</strong> Shoulder assistance systems</li>
              <li><strong>Heavy Priority:</strong> 40% reserved for large ships</li>
              <li><strong>Yard Releases:</strong> Cadenced construction windows</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>👻 Ghost Net Array</h4>
            <ul>
              <li><strong>Decoy Phases:</strong> Ambiguous visual interference</li>
              <li><strong>Masking Cycles:</strong> Irregular stealth windows</li>
              <li><strong>Detection Jitter:</strong> Unpredictable interdiction</li>
            </ul>
          </div>

          <div class="archetype-card">
            <h4>🏭 Standard System</h4>
            <ul>
              <li><strong>Baseline Travel:</strong> No special mechanics</li>
              <li><strong>Balanced Capacity:</strong> Standard lane behavior</li>
              <li><strong>Predictable:</strong> Reliable but unremarkable</li>
            </ul>
          </div>
        </div>

        <h4>Strategic Adaptation</h4>
        <p>Successful commanders adapt their travel strategies to each system's unique characteristics. Understanding these patterns allows for optimal routing, timing, and risk management.</p>
      </div>
    `;
  }

  function generateArchetypeFallbacks() {
    const archetypes = [
      {
        key: 'diplomatic',
        displayName: 'Diplomatic Expanse',
        description: 'Auric courts with arbitration corridors and permit systems',
        minerals: { primary: ['Aurivex', 'Auralite'], secondary: ['Luminite', 'Aetherium', 'Mythrion', 'Quarzon', 'Heliox Ore'] }
      },
      {
        key: 'wormhole',
        displayName: 'Wormhole Cluster',
        description: 'Hub-and-spoke network with periodic stability windows',
        minerals: { primary: ['Riftstone', 'Phasegold'], secondary: ['Fluxium', 'Tachytrium', 'Aetherium', 'Quarzon', 'Spectrathene'] }
      },
      {
        key: 'graviton',
        displayName: 'Graviton Sink Zone',
        description: 'Shear dynamics and slingshot acceleration mechanics',
        minerals: { primary: ['Gravium', 'Fluxium'], secondary: ['Spectrathene', 'Magnetrine', 'Voidglass', 'Cryphos', 'Pyronex'] }
      },
      {
        key: 'asteroid-heavy',
        displayName: 'Asteroid-Heavy Belt',
        description: 'Dense rubble fields with foundry riches and clearance mechanics',
        minerals: { primary: ['Quarzon', 'Mythrion'], secondary: ['Magnetrine', 'Starforged Carbon', 'Fluxium', 'Heliox Ore', 'Aetherium'] }
      },
      {
        key: 'solar',
        displayName: 'Solar Flare Engine',
        description: 'Flare-synchronized speed surges and edge snare opportunities',
        minerals: { primary: ['Solarite', 'Pyronex'], secondary: ['Fluxium', 'Crytite', 'Auralite', 'Drakonium', 'Luminite'] }
      },
      {
        key: 'dark-nebula',
        displayName: 'Dark Nebula Nursery',
        description: 'Shadow alleys for stealth operations and gas harvesting',
        minerals: { primary: ['Voidglass', 'Nebryllium'], secondary: ['Spectrathene', 'Fluxium', 'Aetherium', 'Phasegold', 'Kryon Dust'] }
      },
      {
        key: 'ion-tempest',
        displayName: 'Ion Tempest',
        description: 'EM interference and storm-safe grounded rail corridors',
        minerals: { primary: ['Cryphos', 'Magnetrine'], secondary: ['Fluxium', 'Aetherium', 'Quarzon', 'Auralite', 'Luminite'] }
      },
      {
        key: 'relay',
        displayName: 'Starlight Relay Network',
        description: 'Beacon-synchronized slipstream corridors and permit gating',
        minerals: { primary: ['Aetherium', 'Quarzon'], secondary: ['Luminite', 'Fluxium', 'Auralite', 'Cryphos', 'Phasegold'] }
      },
      {
        key: 'cryo-comet',
        displayName: 'Cryo Comet Rain',
        description: 'Icing events and specialized cryo cargo logistics',
        minerals: { primary: ['Kryon Dust', 'Voidglass'], secondary: ['Fluxium', 'Heliox Ore', 'Nebryllium', 'Phasegold', 'Spectrathene'] }
      },
      {
        key: 'supernova',
        displayName: 'Supernova Remnant',
        description: 'Heat pockets and brief calm swells in turbulent space',
        minerals: { primary: ['Pyronex', 'Drakonium'], secondary: ['Solarite', 'Fluxium', 'Luminite', 'Cryphos', 'Aetherium'] }
      },
      {
        key: 'binary',
        displayName: 'Binary Star System',
        description: 'Tidal slings and eclipse window timing mechanics',
        minerals: { primary: ['Solarite', 'Fluxium'], secondary: ['Pyronex', 'Crytite', 'Auralite', 'Drakonium', 'Luminite'] }
      },
      {
        key: 'forgeyard',
        displayName: 'Capital Forgeyard',
        description: 'Heavy industry with tow lanes and construction cadences',
        minerals: { primary: ['Starforged Carbon', 'Magnetrine'], secondary: ['Ferrite Alloy', 'Crytite', 'Ardanium', 'Vornite', 'Zerothium'] }
      },
      {
        key: 'ghost-net',
        displayName: 'Ghost Net Array',
        description: 'Decoy phases and ambiguous visual interference mechanics',
        minerals: { primary: ['Nebryllium', 'Spectrathene'], secondary: ['Voidglass', 'Phasegold', 'Fluxium', 'Aetherium', 'Kryon Dust'] }
      },
      {
        key: 'standard',
        displayName: 'Standard System',
        description: 'Balanced, predictable system with no special mechanics',
        minerals: { primary: ['Fluxium', 'Auralite'], secondary: ['Ferrite Alloy', 'Crytite', 'Ardanium', 'Vornite', 'Zerothium'] }
      }
    ];

    console.log('Generating fallback archetypes:', archetypes.length);

    return archetypes.map(archetype => ({
      id: `archetype-${archetype.key}`,
      title: archetype.displayName,
      icon: '🌀',
      tags: ['archetype', 'system', archetype.key],
      summary: archetype.description,
      content: formatArchetypeDetails(archetype)
    }));
  }

  function renderModalSkeleton() {
    return {
      title: '📖 Game Encyclopedia',
      content: createModalContent(),
      actions: [
        { text: 'Close', style: 'secondary' }
      ],
      width: 1400,
      height: 900
    };
  }

  function createModalContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'encyclopedia-modal enhanced';

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

    data.categories.forEach((category, index) => {
      const tab = document.createElement('div');
      tab.className = `encyclopedia-tab ${activeCategoryId === category.id ? 'active' : ''}`;
      tab.innerHTML = `${category.icon} ${category.name}`;
      tab.onclick = () => {
        activeCategoryId = category.id;
        activeEntryId = null;
        renderTabs(root, data);
        renderList(root, data);
        renderContent(root, data);
      };
      tabs.appendChild(tab);
    });
  }

  function renderList(root, data) {
    const { list } = root._refs;
    list.innerHTML = '';

    if (!activeCategoryId) {
      activeCategoryId = data.categories[0].id;
    }

    const category = data.categories.find(c => c.id === activeCategoryId);
    if (!category) return;

    let entries = category.entries;

    // Apply advanced search if there's a search term
    if (searchTerm && searchTerm.trim()) {
      const query = searchTerm.trim().toLowerCase();

      // Score and filter entries
      entries = entries.map(entry => ({
        ...entry,
        searchScore: calculateSearchScore(entry, query),
        highlightedTitle: highlightMatches(entry.title, query),
        highlightedSummary: highlightMatches(entry.summary, query)
      }))
      .filter(entry => entry.searchScore > 0)
      .sort((a, b) => b.searchScore - a.searchScore);

      // Add search result count
      if (entries.length > 0) {
        const resultCount = document.createElement('div');
        resultCount.className = 'search-result-count';
        resultCount.textContent = `${entries.length} result${entries.length !== 1 ? 's' : ''} for "${query}"`;
        list.appendChild(resultCount);
      }
    }

    // Render entries with highlighting
    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = `encyclopedia-item ${activeEntryId === entry.id ? 'active' : ''}`;

      const titleHtml = entry.highlightedTitle || entry.title;
      const summaryHtml = entry.highlightedSummary || entry.summary;

      item.innerHTML = `
        <div class="entry-icon">${entry.icon}</div>
        <div class="entry-info">
          <div class="entry-title">${titleHtml}</div>
          <div class="entry-summary">${summaryHtml}</div>
          ${entry.searchScore ? `<div class="search-score">Relevance: ${entry.searchScore}</div>` : ''}
        </div>
      `;

      item.onclick = () => {
        console.log(`Navigating to entry: ${entry.id} - ${entry.title} (current category: ${activeCategoryId})`);

        // Find which category this entry belongs to
        let entryCategory = null;
        for (const category of data.categories) {
          if (category.entries.some(e => e.id === entry.id)) {
            entryCategory = category.id;
            break;
          }
        }

        if (entryCategory && entryCategory !== activeCategoryId) {
          console.log(`Entry ${entry.id} belongs to category ${entryCategory}, switching from ${activeCategoryId}`);
        }

        activeEntryId = entry.id;
        renderList(root, data);
        renderContent(root, data);
      };

      list.appendChild(item);
    });

    // Debug logging
    if (entries.length > 0) {
      console.log(`Rendered ${entries.length} entries in category ${activeCategoryId}:`,
        entries.map(e => ({ id: e.id, title: e.title })));
    }

    // Show "no results" message if search returned nothing
    if (searchTerm && searchTerm.trim() && entries.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'no-search-results';
      noResults.innerHTML = `
        <div class="no-results-icon">🔍</div>
        <div class="no-results-text">
          <strong>No results found for "${searchTerm.trim()}"</strong>
          <br><small>Try a different search term or browse categories</small>
        </div>
      `;
      list.appendChild(noResults);
    }
  }

  function calculateSearchScore(entry, query) {
    let score = 0;
    const title = (entry.title || '').toLowerCase();
    const summary = (entry.summary || '').toLowerCase();
    const tags = (entry.tags || []).join(' ').toLowerCase();
    const content = (entry.content || '').toLowerCase();

    // Exact matches get highest scores
    if (title === query) return 100;
    if (title.includes(query)) score += 75;

    // Summary matches
    if (summary.includes(query)) score += 50;

    // Tag matches
    if (tags.includes(query)) score += 60;

    // Content matches (lower weight)
    if (content.includes(query)) score += 25;

    // Fuzzy matching for typos (if query is longer than 3 chars)
    if (query.length >= 3) {
      if (fuzzyMatch(title, query)) score += 40;
      if (fuzzyMatch(summary, query)) score += 20;
    }

    // Word boundary matches get bonus
    const wordBoundaryRegex = new RegExp(`\\b${query}\\b`, 'i');
    if (wordBoundaryRegex.test(title)) score += 10;
    if (wordBoundaryRegex.test(summary)) score += 5;

    return score;
  }

  function fuzzyMatch(text, query) {
    if (query.length < 3) return false;

    let textIndex = 0;
    for (let queryIndex = 0; queryIndex < query.length; queryIndex++) {
      const found = text.indexOf(query[queryIndex], textIndex);
      if (found === -1) return false;
      textIndex = found + 1;
    }
    return true;
  }

  function highlightMatches(text, query) {
    if (!query || !text) return text;

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark class="search-highlight">$1</mark>');
  }

  function renderContent(root, data) {
    const { content } = root._refs;
    content.innerHTML = '';

    if (!activeEntryId) {
      const defaultEntry = data.defaultEntry;
      if (defaultEntry) {
        activeCategoryId = defaultEntry.categoryId;
        activeEntryId = defaultEntry.entryId;
      } else {
        content.innerHTML = '<div class="encyclopedia-placeholder">Select an entry from the sidebar</div>';
        return;
      }
    }

    // Find the entry across ALL categories, not just the current activeCategoryId
    let foundEntry = null;
    let foundCategory = null;

    for (const category of data.categories) {
      const entry = category.entries.find(e => e.id === activeEntryId);
      if (entry) {
        foundEntry = entry;
        foundCategory = category;
        break;
      }
    }

    if (!foundEntry || !foundCategory) {
      console.error(`Entry not found: ${activeEntryId} in any category`);

      // Try to find a similar entry by partial ID match across all categories
      for (const category of data.categories) {
        const similarEntry = category.entries.find(e => e.id.includes(activeEntryId) || activeEntryId.includes(e.id));
        if (similarEntry) {
          console.log('Found similar entry:', similarEntry.id, 'in category:', category.id);
          activeEntryId = similarEntry.id;
          activeCategoryId = category.id;
          renderContent(root, data);
          return;
        }
      }

      // Show helpful error message with available entries
      const allEntries = data.categories.flatMap(c => c.entries.map(e => `${e.title} (${c.name})`)).slice(0, 5);
      content.innerHTML = `
        <div class="encyclopedia-placeholder">
          <h3>Entry not found: "${activeEntryId}"</h3>
          <p>This entry could not be found in any category.</p>
          <p>Available entries: ${allEntries.join(', ')}${allEntries.length >= 5 ? '...' : ''}</p>
          <button onclick="window.Encyclopedia.refresh()" class="sf-btn sf-btn-secondary">Refresh Encyclopedia</button>
        </div>
      `;
      return;
    }

    // Update activeCategoryId to the correct category where the entry was found
    if (activeCategoryId !== foundCategory.id) {
      console.log(`Switching category from ${activeCategoryId} to ${foundCategory.id} for entry ${activeEntryId}`);
      activeCategoryId = foundCategory.id;
      // Update the UI to reflect the category change
      renderTabs(root, data);
      renderList(root, data);
    }

    content.innerHTML = `
      <div class="encyclopedia-entry">
        <h1>${foundEntry.icon} ${foundEntry.title}</h1>
        <p class="entry-summary">${foundEntry.summary}</p>
        <div class="entry-content">${foundEntry.content}</div>
      </div>
    `;

    // Initialize interactive elements
    initializeCollapsibleElements(content);
    initializeLazyLoading(content);

    // Add click handlers for minerals and abilities
    addInteractiveHandlers(content);
  }

  function addInteractiveHandlers(container) {
    // Mineral click handlers
    const mineralItems = container.querySelectorAll('.mineral-item');
    mineralItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const mineralName = item.dataset.mineral;
        showMineralTooltip(item, mineralName);
      });
    });

    // Ability click handlers
    const abilityItems = container.querySelectorAll('.ability-item');
    abilityItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const abilityName = item.dataset.ability;
        if (abilityName) {
          // Try to find and display the ability details
          const category = encyclopediaData.categories.find(c => c.id === 'combat-abilities');
          if (category) {
            const abilityEntry = category.entries.find(e => e.id === `ability-${abilityName}`);
            if (abilityEntry) {
              // Navigate to the ability entry
              activeCategoryId = 'combat-abilities';
              activeEntryId = `ability-${abilityName}`;
              renderTabs(container.closest('.encyclopedia-modal'), encyclopediaData);
              renderList(container.closest('.encyclopedia-modal'), encyclopediaData);
              renderContent(container.closest('.encyclopedia-modal'), encyclopediaData);
            }
          }
        }
      });
    });
  }

  function showMineralTooltip(element, mineralName) {
    // Create or update tooltip
    let tooltip = document.querySelector('.mineral-tooltip-popup');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'mineral-tooltip-popup';
      document.body.appendChild(tooltip);
    }

    const description = getCachedMineralDescription(mineralName);
    tooltip.innerHTML = `
      <div class="tooltip-header">${mineralName}</div>
      <div class="tooltip-content">${description}</div>
    `;

    // Position tooltip
    const rect = element.getBoundingClientRect();
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.top = `${rect.bottom + 5}px`;
    tooltip.style.display = 'block';

    // Hide on click outside
    const hideTooltip = (e) => {
      if (!tooltip.contains(e.target) && !element.contains(e.target)) {
        tooltip.style.display = 'none';
        document.removeEventListener('click', hideTooltip);
      }
    };
    setTimeout(() => document.addEventListener('click', hideTooltip), 100);
  }

  function bindEvents(root, data) {
    const { searchInput } = root._refs;

        // Enhanced search with debouncing and throttling
    let searchTimeout;
    searchInput.oninput = (e) => {
      const newSearchTerm = e.target.value;

      // Skip processing if search term hasn't meaningfully changed
      if (!shouldProcessSearch(newSearchTerm, searchTerm)) return;

      searchTerm = newSearchTerm;

      // Use throttled search for very rapid typing, then debounce for final updates
      throttleSearch(() => {
        debounceContentUpdate(() => {
          lastProcessedSearchTerm = searchTerm; // Track processed term
          renderList(root, data);
          // Auto-select first result if available
          if (searchTerm.trim() && activeCategoryId) {
            const category = data.categories.find(c => c.id === activeCategoryId);
            if (category) {
              const filteredEntries = category.entries.filter(entry =>
                calculateSearchScore(entry, searchTerm.trim().toLowerCase()) > 0
              );
              if (filteredEntries.length > 0 && !activeEntryId) {
                activeEntryId = filteredEntries[0].id;
                renderContent(root, data);
              }
            }
          }
        }, 150); // Reduced delay for throttled updates
      });
    };

    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target === searchInput) {
        if (e.key === 'Enter') {
          e.preventDefault();
          // Focus first search result
          const firstItem = root.querySelector('.encyclopedia-item');
          if (firstItem) firstItem.click();
        } else if (e.key === 'Escape') {
          // Clear search
          searchInput.value = '';
          searchTerm = '';
          renderList(root, data);
        }
      }
    });

    // Add focus management
    searchInput.addEventListener('focus', () => {
      searchInput.parentElement.classList.add('focused');
    });

    searchInput.addEventListener('blur', () => {
      searchInput.parentElement.classList.remove('focused');
    });
  }

    // Public API
  window.Encyclopedia = {
    show: async function() {
      const data = await loadData();
      const modal = renderModalSkeleton();

      // Initial render
      renderTabs(modal.content, data);
      renderList(modal.content, data);
      renderContent(modal.content, data);
      bindEvents(modal.content, data);

      // Show modal
      if (window.UI && UI.showModal) {
        UI.showModal(modal);
      } else {
        console.error('UI modal system not available');
      }
    },

    // Legacy function name for UI compatibility
    open: async function() {
      return this.show();
    },

    refresh: async function() {
      // Clear cache and force reload
      dataCache.clear();
      encyclopediaData = null;

      // Show loading state
      showGlobalLoadingIndicator();

      try {
        const data = await loadData(true); // Force refresh
        hideGlobalLoadingIndicator();

        // If encyclopedia is currently open, refresh the display
        const existingModal = document.querySelector('.encyclopedia-modal');
        if (existingModal) {
          const modal = renderModalSkeleton();
          renderTabs(existingModal, data);
          renderList(existingModal, data);
          renderContent(existingModal, data);
          bindEvents(existingModal, data);
        }

        console.log('Encyclopedia data refreshed successfully');
      } catch (error) {
        hideGlobalLoadingIndicator();
        console.error('Failed to refresh encyclopedia:', error);
      }
    }
  };

  // Add the expected function name for UI compatibility
  window.openEncyclopedia = window.Encyclopedia.show;

})();

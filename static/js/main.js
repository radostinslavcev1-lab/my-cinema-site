/**
 * CINEMAX / STREAMFLIX - Vanilla JavaScript Logic
 * Handles:
 *  - Navbar autocomplete search
 *  - Dynamic episode switcher without page reloads
 *  - Admin upload method toggles & file drag-and-drop
 *  - Real-time upload progress bar via XMLHttpRequest
 *  - Delete confirmation modals
 *  - Flash alert dismissals
 */

document.addEventListener('DOMContentLoaded', () => {

  // ========================================================
  // 1. FLASH MESSAGE AUTO-DISMISS & CLOSE BUTTONS
  // ========================================================
  document.querySelectorAll('.alert-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const alert = e.target.closest('.alert');
      if (alert) {
        alert.style.opacity = '0';
        setTimeout(() => alert.remove(), 300);
      }
    });
  });

  // Auto hide flash alerts after 6 seconds
  setTimeout(() => {
    document.querySelectorAll('.alert').forEach(alert => {
      alert.style.transition = 'opacity 0.5s ease';
      alert.style.opacity = '0';
      setTimeout(() => alert.remove(), 500);
    });
  }, 6000);


  // ========================================================
  // 2. NAVBAR LIVE SEARCH AUTOCOMPLETE
  // ========================================================
  const navSearchInput = document.getElementById('navSearchInput');
  const searchDropdown = document.getElementById('searchResultsDropdown');

  let debounceTimer = null;

  if (navSearchInput && searchDropdown) {
    navSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearTimeout(debounceTimer);

      if (query.length < 2) {
        searchDropdown.classList.remove('active');
        searchDropdown.innerHTML = '';
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const resp = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
          if (!resp.ok) return;
          const items = await resp.json();

          if (items.length === 0) {
            searchDropdown.innerHTML = `
              <div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
                Няма намерени заглавия за „${escapeHtml(query)}“
              </div>
            `;
          } else {
            searchDropdown.innerHTML = items.map(item => `
              <a href="${item.url}" class="search-item">
                <img src="${item.poster_url}" alt="${escapeHtml(item.title)}" class="search-item-thumb" onerror="this.src='https://via.placeholder.com/60x90?text=No+Poster'">
                <div class="search-item-info">
                  <h4>${escapeHtml(item.title)}</h4>
                  <p>
                    <span class="badge ${item.media_type === 'series' ? 'badge-series' : 'badge-movie'}" style="font-size:0.65rem; padding: 1px 5px;">
                      ${item.media_type === 'series' ? 'СЕРИАЛ' : 'ФИЛМ'}
                    </span>
                    ${item.release_year ? item.release_year + ' • ' : ''}
                    ★ ${item.rating}
                  </p>
                </div>
              </a>
            `).join('');
          }
          searchDropdown.classList.add('active');
        } catch (err) {
          console.error('Search error:', err);
        }
      }, 250);
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
      if (!navSearchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.classList.remove('active');
      }
    });

    // Mobile Bottom Bar Search button trigger
    const mobileSearchTrigger = document.getElementById('mobileSearchTrigger');
    if (mobileSearchTrigger) {
      mobileSearchTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => {
          navSearchInput.focus();
          navSearchInput.classList.add('mobile-focused');
          setTimeout(() => navSearchInput.classList.remove('mobile-focused'), 1500);
        }, 250);
      });
    }
  }


  // ========================================================
  // 3. WATCH PAGE: DYNAMIC EPISODE SWITCHER
  // ========================================================
  const playerIframe = document.getElementById('playerIframe');
  const episodeButtons = document.querySelectorAll('.episode-btn');
  const seasonTabs = document.querySelectorAll('.season-tab-btn');
  const currentEpisodeLabel = document.getElementById('currentEpisodeDisplay');

  // Season Tab switching
  if (seasonTabs.length > 0) {
    seasonTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const seasonNum = tab.dataset.season;

        seasonTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        episodeButtons.forEach(epBtn => {
          if (epBtn.dataset.season === seasonNum) {
            epBtn.style.display = 'flex';
          } else {
            epBtn.style.display = 'none';
          }
        });
      });
    });
  }

  // Live Countdown Timer for Coming Soon / Premiere
  let activeCountdownInterval = null;
  function startCountdown(targetIso) {
    if (activeCountdownInterval) {
      clearInterval(activeCountdownInterval);
      activeCountdownInterval = null;
    }
    const timerWrap = document.getElementById('csCountdownWrapper');
    if (!targetIso) {
      if (timerWrap) timerWrap.style.display = 'none';
      return;
    }
    const targetTime = new Date(targetIso).getTime();
    if (isNaN(targetTime)) {
      if (timerWrap) timerWrap.style.display = 'none';
      return;
    }

    if (timerWrap) timerWrap.style.display = 'block';

    function tick() {
      const now = Date.now();
      const diff = targetTime - now;
      const daysEl = document.getElementById('cdDays');
      const hoursEl = document.getElementById('cdHours');
      const minEl = document.getElementById('cdMinutes');
      const secEl = document.getElementById('cdSeconds');

      if (diff <= 0) {
        if (activeCountdownInterval) clearInterval(activeCountdownInterval);
        if (daysEl) daysEl.textContent = '00';
        if (hoursEl) hoursEl.textContent = '00';
        if (minEl) minEl.textContent = '00';
        if (secEl) secEl.textContent = '00';
        const csTitle = document.getElementById('csTitle');
        if (csTitle) csTitle.textContent = 'Премиерата започва!';
        return;
      }

      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);

      if (daysEl) daysEl.textContent = String(d).padStart(2, '0');
      if (hoursEl) hoursEl.textContent = String(h).padStart(2, '0');
      if (minEl) minEl.textContent = String(m).padStart(2, '0');
      if (secEl) secEl.textContent = String(s).padStart(2, '0');
    }

    tick();
    activeCountdownInterval = setInterval(tick, 1000);
  }

  // Initialize countdown on page load if element exists
  const initialCountdownEl = document.getElementById('csCountdown');
  if (initialCountdownEl && initialCountdownEl.dataset.target) {
    startCountdown(initialCountdownEl.dataset.target);
  }

  // Admin visitor preview toggle button
  const toggleVisitorPreviewBtn = document.getElementById('toggleVisitorPreviewBtn');
  let isVisitorPreviewActive = false;
  if (toggleVisitorPreviewBtn) {
    toggleVisitorPreviewBtn.addEventListener('click', () => {
      isVisitorPreviewActive = !isVisitorPreviewActive;
      const playerComingSoon = document.getElementById('playerComingSoon');
      const extWatchBtn = document.getElementById('extWatchBtn');

      const ratioBox = document.querySelector('.player-aspect-ratio');
      if (isVisitorPreviewActive) {
        if (playerIframe) playerIframe.style.display = 'none';
        if (playerComingSoon) playerComingSoon.style.display = 'flex';
        if (extWatchBtn) extWatchBtn.style.display = 'none';
        if (ratioBox) ratioBox.classList.add('has-coming-soon');
        toggleVisitorPreviewBtn.textContent = '👁️ Обратно към админ плейър';
        toggleVisitorPreviewBtn.classList.add('btn-primary');
        toggleVisitorPreviewBtn.classList.remove('btn-secondary');
      } else {
        if (playerIframe) playerIframe.style.display = 'block';
        if (playerComingSoon) playerComingSoon.style.display = 'none';
        if (extWatchBtn) extWatchBtn.style.display = 'inline-flex';
        if (ratioBox) ratioBox.classList.remove('has-coming-soon');
        toggleVisitorPreviewBtn.textContent = '👁️ Изглед за посетители';
        toggleVisitorPreviewBtn.classList.remove('btn-primary');
        toggleVisitorPreviewBtn.classList.add('btn-secondary');
      }
    });
  }

  // Smooth episode playback without reload
  if (episodeButtons.length > 0 && playerIframe) {
    episodeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();

        const isLocked = btn.dataset.isLocked === 'true';
        const streamtapeId = btn.dataset.streamtapeId;
        const playerComingSoon = document.getElementById('playerComingSoon');
        const extWatchBtn = document.getElementById('extWatchBtn');
        const playerUnavailableBox = document.getElementById('playerUnavailableBox');

        let fallbackUrl = '';
        if (streamtapeId) {
          if (streamtapeId.startsWith('gdrive:') || streamtapeId.startsWith('drive:')) {
            fallbackUrl = `https://drive.google.com/file/d/${streamtapeId.split(':')[1]}/preview`;
          } else if (streamtapeId.startsWith('abyss:') || streamtapeId.startsWith('hydrax:')) {
            fallbackUrl = `https://playhydrax.com/?v=${streamtapeId.split(':')[1]}`;
          } else if (streamtapeId.startsWith('anon:')) {
            fallbackUrl = `https://anonmp4.help/embed/${streamtapeId.split(':')[1]}`;
          } else {
            fallbackUrl = `https://streamtape.com/e/${streamtapeId}/`;
          }
        }
        const embedUrl = btn.dataset.embedUrl || fallbackUrl;
        const serverName = btn.dataset.serverName || 'Cloud Stream';
        const episodeId = btn.dataset.episodeId;
        const episodeTitle = btn.dataset.episodeTitle;

        // Check if current user is admin
        const isAdmin = document.body.dataset.isAdmin === '1';

        const ratioBox = document.querySelector('.player-aspect-ratio');
        if (isLocked && (!isAdmin || isVisitorPreviewActive)) {
          if (ratioBox) ratioBox.classList.add('has-coming-soon');
          // Locked episode for visitors: Completely suppress player & show Coming Soon overlay
          if (playerIframe) {
            playerIframe.style.display = 'none';
            playerIframe.src = '';
          }
          if (playerUnavailableBox) playerUnavailableBox.style.display = 'none';
          if (playerComingSoon) {
            playerComingSoon.style.display = 'flex';
            const csTitle = document.getElementById('csTitle');
            const csEpTitle = document.getElementById('csEpisodeTitle');
            const csMessage = document.getElementById('csMessage');
            const csDateWrap = document.getElementById('csDateWrapper');
            const csDateText = document.getElementById('csDateText');

            const relDate = btn.dataset.releaseDate;
            const relIso = btn.dataset.releaseIso;

            if (csTitle) {
              csTitle.textContent = relDate ? 'Премиера скоро' : 'Очаквайте скоро';
            }

            if (csEpTitle && episodeTitle) csEpTitle.textContent = episodeTitle;
            
            const customMsg = btn.dataset.customMsg;
            if (csMessage) {
              if (customMsg) {
                csMessage.textContent = customMsg;
                csMessage.style.display = 'block';
              } else if (relDate) {
                csMessage.textContent = 'Този епизод все още не е достъпен. Премиерата ще се състои на посочената дата!';
                csMessage.style.display = 'block';
              } else {
                csMessage.textContent = 'Този епизод все още не е достъпен. Очаквайте го скоро в CINEMAX!';
                csMessage.style.display = 'block';
              }
            }

            if (csDateWrap && csDateText) {
              if (relDate) {
                csDateText.textContent = relDate;
                csDateWrap.style.display = 'flex';
              } else {
                csDateWrap.style.display = 'none';
              }
            }

            startCountdown(relIso);
          }

          if (extWatchBtn) {
            extWatchBtn.style.display = 'none';
            extWatchBtn.href = '#';
          }
        } else {
          if (ratioBox) ratioBox.classList.remove('has-coming-soon');
          // Unlocked episode or Admin Preview mode
          if (playerComingSoon) playerComingSoon.style.display = 'none';
          if (playerIframe) {
            playerIframe.style.display = 'block';
            if (embedUrl) {
              applyAdShieldState(isAdShieldActive, false);
              playerIframe.src = embedUrl;
            }
          }

          if (extWatchBtn) {
            if (streamtapeId && (!isLocked || isAdmin)) {
              let extUrl = '';
              if (streamtapeId.startsWith('gdrive:') || streamtapeId.startsWith('drive:')) {
                extUrl = `https://drive.google.com/file/d/${streamtapeId.split(':')[1]}/view`;
              } else if (streamtapeId.startsWith('abyss:') || streamtapeId.startsWith('hydrax:')) {
                extUrl = `https://playhydrax.com/?v=${streamtapeId.split(':')[1]}`;
              } else {
                extUrl = `https://streamtape.com/v/${streamtapeId}`;
              }
              extWatchBtn.href = extUrl;
              extWatchBtn.style.display = 'inline-flex';
            } else {
              extWatchBtn.style.display = 'none';
              extWatchBtn.href = '#';
            }
          }
        }

        // Update active streaming server name if present
        const activeServerEl = document.getElementById('activeServerName');
        if (activeServerEl && serverName) {
          activeServerEl.textContent = serverName;
        }

        // Update active class
        episodeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update text display
        if (currentEpisodeLabel && episodeTitle) {
          currentEpisodeLabel.textContent = episodeTitle;
        }

        // Update URL state without reload
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('ep', episodeId);
        window.history.pushState({}, '', newUrl);

        // Scroll player into view smoothly if on mobile
        if (window.innerWidth < 768) {
          playerIframe.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  }


  // ========================================================
  // 3.1 WATCH PAGE: TOGGLE DESCRIPTION (SHOW MORE / SHOW LESS)
  // ========================================================
  const toggleDescBtn = document.getElementById('toggleDescriptionBtn');
  const watchDescription = document.getElementById('watchDescription');

  if (toggleDescBtn && watchDescription) {
    // If the text naturally fits without being clipped, hide the toggle button
    if (watchDescription.scrollHeight <= watchDescription.clientHeight + 4) {
      toggleDescBtn.style.display = 'none';
      watchDescription.classList.remove('clamped');
    }

    toggleDescBtn.addEventListener('click', () => {
      const isExpanded = watchDescription.classList.contains('expanded');
      const textSpan = toggleDescBtn.querySelector('.toggle-desc-text');

      if (isExpanded) {
        watchDescription.classList.remove('expanded');
        watchDescription.classList.add('clamped');
        toggleDescBtn.classList.remove('expanded');
        if (textSpan) textSpan.textContent = 'Покажи повече';
        toggleDescBtn.setAttribute('aria-expanded', 'false');
      } else {
        watchDescription.classList.remove('clamped');
        watchDescription.classList.add('expanded');
        toggleDescBtn.classList.add('expanded');
        if (textSpan) textSpan.textContent = 'Покажи по-малко';
        toggleDescBtn.setAttribute('aria-expanded', 'true');
      }
    });
  }


  // ========================================================
  // 3.2 WATCH PAGE: AD-SHIELD & PLAYER ENGINE
  // ========================================================
  const toggleAdShieldBtn = document.getElementById('toggleAdShieldBtn');
  const adShieldStatusText = document.getElementById('adShieldStatusText');
  const adShieldToggleLabel = document.getElementById('adShieldToggleLabel');
  const adShieldPulse = document.getElementById('adShieldPulse');
  const reloadPlayerBtn = document.getElementById('reloadPlayerBtn');

  // Streamtape strictly disallows the 'sandbox' attribute and blocks playback with:
  // "Client blocked! Your browser or the embed you are viewing are doing nasty things!"
  // When Streamtape is active, sandbox MUST be removed so the player works seamlessly.
  const SANDBOX_SHIELD = 'allow-scripts allow-same-origin allow-forms allow-presentation';

  // Read saved state (default is false to ensure 100% compatibility across all streaming providers)
  let isAdShieldActive = localStorage.getItem('cinema_adshield_active') === 'true';

  function updateAdShieldUI(active) {
    if (adShieldStatusText) {
      adShieldStatusText.textContent = active ? 'Активен' : 'Изключен';
      adShieldStatusText.style.color = active ? '#10b981' : '#ef4444';
    }
    if (adShieldToggleLabel) {
      adShieldToggleLabel.textContent = active ? 'ВКЛ' : 'ИЗКЛ';
    }
    if (adShieldPulse) {
      if (active) {
        adShieldPulse.classList.remove('disabled');
      } else {
        adShieldPulse.classList.add('disabled');
      }
    }
    if (toggleAdShieldBtn) {
      if (active) {
        toggleAdShieldBtn.classList.add('active');
        toggleAdShieldBtn.classList.remove('disabled-state');
      } else {
        toggleAdShieldBtn.classList.remove('active');
        toggleAdShieldBtn.classList.add('disabled-state');
      }
    }
  }

  function applyAdShieldState(active, reload = false) {
    if (!playerIframe) return;

    const disallowsSandbox = playerIframe.src && (
      playerIframe.src.includes('drive.google.com') ||
      playerIframe.src.includes('docs.google.com') ||
      playerIframe.src.includes('streamtape.com') ||
      playerIframe.src.includes('playhydrax.com') ||
      playerIframe.src.includes('hydrax.net') ||
      playerIframe.src.includes('abyss.to')
    );

    // Never add sandbox to Streamtape or Hydrax/Abyss because they detect it and block playback
    if (disallowsSandbox || !active) {
      playerIframe.removeAttribute('sandbox');
    } else {
      playerIframe.setAttribute('sandbox', SANDBOX_SHIELD);
    }

    updateAdShieldUI(active);

    if (reload) {
      const currentSrc = playerIframe.src;
      playerIframe.src = 'about:blank';
      setTimeout(() => {
        playerIframe.src = currentSrc;
      }, 60);
    }
  }

  // Initial apply
  if (playerIframe) {
    applyAdShieldState(isAdShieldActive, false);
  }

  // Toggle button click listener
  if (toggleAdShieldBtn) {
    toggleAdShieldBtn.addEventListener('click', () => {
      isAdShieldActive = !isAdShieldActive;
      localStorage.setItem('cinema_adshield_active', isAdShieldActive ? 'true' : 'false');
      applyAdShieldState(isAdShieldActive, true);
    });
  }

  // Reload player button to refresh stream
  if (reloadPlayerBtn && playerIframe) {
    reloadPlayerBtn.addEventListener('click', () => {
      let currentSrc = playerIframe.src;
      if (!currentSrc || currentSrc === 'about:blank') return;
      playerIframe.src = 'about:blank';
      setTimeout(() => {
        playerIframe.src = currentSrc;
      }, 60);
    });
  }


  // ========================================================
  // 4. ADMIN PANEL: METHOD TOGGLE (ABYSS/HYDRAX vs MANUAL vs STREAMTAPE API)
  // ========================================================
  const methodAbyssBtn = document.getElementById('methodAbyssBtn');
  const methodManualBtn = document.getElementById('methodManualBtn');
  const methodApiBtn = document.getElementById('methodApiBtn');
  const uploadMethodInput = document.getElementById('uploadMethodInput');
  const abyssUploadFields = document.getElementById('abyssUploadFields');
  const manualFields = document.getElementById('manualFields');
  const apiUploadFields = document.getElementById('apiUploadFields');
  const mediaTypeSelect = document.getElementById('mediaTypeSelect');
  const movieStreamtapeGroup = document.getElementById('movieStreamtapeGroup');
  const seriesNoticeGroup = document.getElementById('seriesNoticeGroup');

  function setUploadMethod(method) {
    if (uploadMethodInput) uploadMethodInput.value = method;
    [methodAbyssBtn, methodManualBtn, methodApiBtn].forEach(b => { if (b) b.classList.remove('active'); });
    if (abyssUploadFields) abyssUploadFields.style.display = (method === 'abyss_upload') ? 'block' : 'none';
    if (manualFields) manualFields.style.display = (method === 'manual') ? 'block' : 'none';
    if (apiUploadFields) apiUploadFields.style.display = (method === 'api_upload') ? 'block' : 'none';

    if (method === 'abyss_upload' && methodAbyssBtn) methodAbyssBtn.classList.add('active');
    if (method === 'manual' && methodManualBtn) methodManualBtn.classList.add('active');
    if (method === 'api_upload' && methodApiBtn) methodApiBtn.classList.add('active');
  }

  if (methodAbyssBtn) methodAbyssBtn.addEventListener('click', () => setUploadMethod('abyss_upload'));
  if (methodManualBtn) methodManualBtn.addEventListener('click', () => setUploadMethod('manual'));
  if (methodApiBtn) methodApiBtn.addEventListener('click', () => setUploadMethod('api_upload'));

  // Live auto-detection of streaming server when pasting link or ID
  document.querySelectorAll('input[name="streamtape_id"]').forEach(input => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.toLowerCase().trim();
      const form = e.target.closest('form');
      if (!form) return;
      const select = form.querySelector('select[name="server_type"]');
      if (!select) return;

      if (val.includes('drive.google.com') || val.includes('docs.google.com') || val.startsWith('gdrive:') || val.startsWith('drive:')) {
        select.value = 'gdrive';
      } else if (val.includes('abyss.to') || val.includes('abysscdn.com') || val.includes('hydrax') || val.startsWith('abyss:') || val.startsWith('hydrax:')) {
        select.value = 'abyss';
      } else if (val.includes('streamtape') || val.includes('streamta.pe')) {
        select.value = 'streamtape';
      }
    });
  });

  // Handle media type change (movie vs series)
  if (mediaTypeSelect) {
    const handleMediaTypeChange = () => {
      const isSeries = mediaTypeSelect.value === 'series';
      if (movieStreamtapeGroup) {
        movieStreamtapeGroup.style.display = isSeries ? 'none' : 'block';
      }
      if (seriesNoticeGroup) {
        seriesNoticeGroup.style.display = isSeries ? 'block' : 'none';
      }
    };
    mediaTypeSelect.addEventListener('change', handleMediaTypeChange);
    handleMediaTypeChange();
  }


  // ========================================================
  // 5. FILE UPLOAD DROP-ZONES (ABYSS / HYDRAX & STREAMTAPE)
  // ========================================================
  
  // Abyss.to / Hydrax Drop Zone
  const abyssDropBox = document.getElementById('abyssUploadBox');
  const abyssFileInput = document.getElementById('abyssFileInput');
  const abyssFileSelectedName = document.getElementById('abyssFileSelectedName');

  if (abyssDropBox && abyssFileInput) {
    abyssDropBox.addEventListener('click', () => abyssFileInput.click());

    ['dragenter', 'dragover'].forEach(name => {
      abyssDropBox.addEventListener(name, (e) => {
        e.preventDefault();
        abyssDropBox.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      abyssDropBox.addEventListener(name, (e) => {
        e.preventDefault();
        abyssDropBox.classList.remove('dragover');
      });
    });

    abyssDropBox.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length > 0) {
        abyssFileInput.files = e.dataTransfer.files;
        updateAbyssFileInfo(abyssFileInput.files[0]);
      }
    });

    abyssFileInput.addEventListener('change', () => {
      if (abyssFileInput.files.length > 0) {
        updateAbyssFileInfo(abyssFileInput.files[0]);
      }
    });

    function updateAbyssFileInfo(file) {
      if (!file) return;
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      if (abyssFileSelectedName) {
        abyssFileSelectedName.innerHTML = `✓ Избран файл за Abyss / Hydrax: <strong>${escapeHtml(file.name)}</strong> (${sizeMB} MB)`;
      }
    }
  }

  // Streamtape Drop Zone
  const dropBox = document.getElementById('fileUploadBox');
  const fileInput = document.getElementById('videoFileInput');
  const fileSelectedName = document.getElementById('fileSelectedName');
  const adminAddForm = document.getElementById('adminAddForm');
  const progressWrapper = document.getElementById('uploadProgressWrapper');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressTextPercent = document.getElementById('progressTextPercent');
  const progressStatusDetail = document.getElementById('progressStatusDetail');

  if (dropBox && fileInput) {
    dropBox.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(name => {
      dropBox.addEventListener(name, (e) => {
        e.preventDefault();
        dropBox.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      dropBox.addEventListener(name, (e) => {
        e.preventDefault();
        dropBox.classList.remove('dragover');
      });
    });

    dropBox.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        updateFileInfo(fileInput.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        updateFileInfo(fileInput.files[0]);
      }
    });

    function updateFileInfo(file) {
      if (!file) return;
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      if (fileSelectedName) {
        fileSelectedName.innerHTML = `✓ Избран файл: <strong>${escapeHtml(file.name)}</strong> (${sizeMB} MB)`;
      }
    }
  }

  // Helper for Direct Browser-to-Abyss.to / Hydrax Cloud Upload (up to 10 GB)
  async function uploadDirectToAbyss(file, onProgress, onStatus) {
    if (onStatus) onStatus('Свързване с Abyss / Hydrax API...');
    const urlResp = await fetch('/api/abyss/get-upload-url');
    const urlData = await urlResp.json();
    if (!urlResp.ok || !urlData.success || !urlData.upload_url) {
      throw new Error(urlData.error || 'Липсва конфигуриран API Key. Моля проверете настройките.');
    }

    if (onStatus) onStatus('Директно облачно качване към Abyss / Hydrax Cloud (до 10 GB)...');
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append('file', file);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(e.loaded, e.total);
        }
      });

      xhr.onload = () => {
        try {
          if (xhr.status === 401) {
            reject(new Error('Невалиден API Key (401 Unauthorized). Моля проверете ключа в Настройките.'));
            return;
          }
          const resp = JSON.parse(xhr.responseText);
          if (resp && (resp.slug || resp.status === true)) {
            const slug = resp.slug || resp.video_id || resp.id;
            if (slug) {
              resolve(slug);
              return;
            }
          }
          if (resp && resp.msg) {
            reject(new Error(resp.msg));
            return;
          }
          if (resp && resp.error) {
            const errMsg = typeof resp.error === 'object' ? (resp.error.message || JSON.stringify(resp.error)) : resp.error;
            reject(new Error(errMsg));
            return;
          }
          reject(new Error('Неочакван отговор от сървъра (липсва slug).'));
        } catch (err) {
          reject(new Error('Грешка при обработка на отговора от сървъра за качване.'));
        }
      };

      xhr.onerror = () => {
        reject(new Error('Мрежова грешка при трансфера към Abyss / Hydrax сървъра.'));
      };

      xhr.open('POST', urlData.upload_url);
      xhr.send(fd);
    });
  }

  // Helper for Direct Browser-to-Streamtape Cloud Upload
  async function uploadDirectToStreamtape(file, onProgress, onStatus) {
    onStatus('Свързване със Streamtape API за уникален адрес за качване...');
    const urlResp = await fetch('/api/streamtape/get-upload-url');
    const urlData = await urlResp.json();
    if (!urlResp.ok || !urlData.success || !urlData.upload_url) {
      throw new Error(urlData.error || 'Липсват Streamtape API ключове. Моля въведете ги в настройките.');
    }

    onStatus('Директно облачно качване към сървърите на Streamtape...');
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append('file', file);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(e.loaded, e.total);
        }
      });

      xhr.onload = () => {
        try {
          const resp = JSON.parse(xhr.responseText);
          if (resp.status === 200 && resp.result && resp.result.id) {
            resolve(resp.result.id);
          } else {
            reject(new Error(resp.msg || 'Streamtape не върна Video ID.'));
          }
        } catch (err) {
          reject(new Error('Невалиден отговор от сървъра на Streamtape.'));
        }
      };

      xhr.onerror = () => {
        reject(new Error('Мрежова грешка при трансфера на видеото към Streamtape.'));
      };

      xhr.open('POST', urlData.upload_url);
      xhr.send(fd);
    });
  }

  // Upload with Progress Bar for Movies / Series (adminAddForm)
  if (adminAddForm) {
    adminAddForm.addEventListener('submit', async (e) => {
      const currentMethod = uploadMethodInput ? uploadMethodInput.value : 'manual';

      // 1. Abyss.to Upload
      if (currentMethod === 'abyss_upload') {
        const file = abyssFileInput ? abyssFileInput.files[0] : null;
        if (!file) return;

        e.preventDefault();
        const abyssProgWrap = document.getElementById('abyssProgressWrapper');
        const abyssProgFill = document.getElementById('abyssProgressBarFill');
        const abyssProgPercent = document.getElementById('abyssProgressTextPercent');
        const abyssProgStatus = document.getElementById('abyssProgressStatusDetail');

        if (abyssProgWrap) abyssProgWrap.style.display = 'block';
        if (abyssProgFill) abyssProgFill.style.width = '0%';
        if (abyssProgPercent) abyssProgPercent.textContent = '0%';
        if (abyssProgStatus) abyssProgStatus.textContent = 'Инициализиране на качването към Abyss.to...';

        try {
          const slug = await uploadDirectToAbyss(
            file,
            (loaded, total) => {
              const percent = Math.round((loaded / total) * 100);
              if (abyssProgFill) abyssProgFill.style.width = `${percent}%`;
              if (abyssProgPercent) abyssProgPercent.textContent = `${percent}%`;
              const upMB = (loaded / (1024 * 1024)).toFixed(1);
              const totMB = (total / (1024 * 1024)).toFixed(1);
              if (abyssProgStatus) abyssProgStatus.textContent = `Качване в Abyss.to: ${upMB} MB / ${totMB} MB`;
            },
            (statusText) => {
              if (abyssProgStatus) abyssProgStatus.textContent = statusText;
            }
          );

          if (abyssProgStatus) abyssProgStatus.textContent = 'Качването в Abyss.to завърши успешно! Публикуване...';

          // Set identifier
          let streamtapeIdInput = document.getElementById('streamtape_id');
          if (streamtapeIdInput) {
            streamtapeIdInput.value = `abyss:${slug}`;
          }

          // Switch to manual to avoid re-uploading file bytes to backend
          uploadMethodInput.value = 'manual';
          abyssFileInput.value = '';

          adminAddForm.submit();
        } catch (err) {
          if (abyssProgStatus) abyssProgStatus.textContent = 'Грешка: ' + err.message;
          alert('Грешка при директно качване към Abyss.to: ' + err.message + '\n\nСъвет: Проверете вашия Abyss API Key в Настройките или качете ръчно в сайта abyss.to.');
        }
        return;
      }

      // 2. Streamtape API Upload
      if (currentMethod === 'api_upload') {
        const file = fileInput ? fileInput.files[0] : null;
        if (!file) return;

        e.preventDefault();

        if (progressWrapper) progressWrapper.style.display = 'block';
        if (progressBarFill) progressBarFill.style.width = '0%';
        if (progressTextPercent) progressTextPercent.textContent = '0%';
        if (progressStatusDetail) progressStatusDetail.textContent = 'Инициализиране...';

        try {
          const streamtapeId = await uploadDirectToStreamtape(
            file,
            (loaded, total) => {
              const percent = Math.round((loaded / total) * 100);
              if (progressBarFill) progressBarFill.style.width = `${percent}%`;
              if (progressTextPercent) progressTextPercent.textContent = `${percent}%`;
              const upMB = (loaded / (1024 * 1024)).toFixed(1);
              const totMB = (total / (1024 * 1024)).toFixed(1);
              if (progressStatusDetail) progressStatusDetail.textContent = `Качване в Streamtape: ${upMB} MB / ${totMB} MB`;
            },
            (statusText) => {
              if (progressStatusDetail) progressStatusDetail.textContent = statusText;
            }
          );

          if (progressStatusDetail) progressStatusDetail.textContent = 'Качването завърши успешно! Записване в каталога...';

          let streamtapeIdInput = document.getElementById('streamtape_id');
          if (streamtapeIdInput) {
            streamtapeIdInput.value = streamtapeId;
          }

          uploadMethodInput.value = 'manual';
          fileInput.value = '';

          adminAddForm.submit();
        } catch (err) {
          if (progressStatusDetail) progressStatusDetail.textContent = 'Грешка: ' + err.message;
          alert('Грешка при качване: ' + err.message + '\n\nСъвет: Можете да качите видеото директно на Streamtape.com и да въведете линка в Метод 2 (Ръчен линк).');
        }
      }
    });
  }

  // Upload with Progress Bar for Episodes (adminEpisodeForm)
  const adminEpisodeForm = document.getElementById('adminEpisodeForm');
  const epProgressWrapper = document.getElementById('epProgressWrapper');
  const epProgressBarFill = document.getElementById('epProgressBarFill');
  const epProgressTextPercent = document.getElementById('epProgressTextPercent');
  const epProgressStatusDetail = document.getElementById('epProgressStatusDetail');
  const epUploadMethodInput = document.getElementById('epUploadMethodInput');
  const epVideoFile = document.getElementById('epVideoFile');
  const epAbyssVideoFile = document.getElementById('epAbyssVideoFile');
  const epAbyssProgressWrapper = document.getElementById('epAbyssProgressWrapper');
  const epAbyssProgressBarFill = document.getElementById('epAbyssProgressBarFill');
  const epAbyssProgressTextPercent = document.getElementById('epAbyssProgressTextPercent');
  const epAbyssProgressStatusDetail = document.getElementById('epAbyssProgressStatusDetail');
  const epSubmitBtn = document.getElementById('epSubmitBtn');

  if (adminEpisodeForm) {
    adminEpisodeForm.addEventListener('submit', async (e) => {
      const currentMethod = epUploadMethodInput ? epUploadMethodInput.value : 'manual';

      // 1. Episode Abyss.to Upload
      if (currentMethod === 'abyss_upload') {
        const file = epAbyssVideoFile ? epAbyssVideoFile.files[0] : null;
        if (!file) return;

        e.preventDefault();

        if (epAbyssProgressWrapper) epAbyssProgressWrapper.style.display = 'block';
        if (epAbyssProgressBarFill) epAbyssProgressBarFill.style.width = '0%';
        if (epAbyssProgressTextPercent) epAbyssProgressTextPercent.textContent = '0%';
        if (epAbyssProgressStatusDetail) epAbyssProgressStatusDetail.textContent = 'Инициализиране на качването към Abyss.to...';
        if (epSubmitBtn) {
          epSubmitBtn.disabled = true;
          epSubmitBtn.textContent = '⏳ Качване в Abyss.to...';
        }

        try {
          const slug = await uploadDirectToAbyss(
            file,
            (loaded, total) => {
              const percent = Math.round((loaded / total) * 100);
              if (epAbyssProgressBarFill) epAbyssProgressBarFill.style.width = `${percent}%`;
              if (epAbyssProgressTextPercent) epAbyssProgressTextPercent.textContent = `${percent}%`;
              const upMB = (loaded / (1024 * 1024)).toFixed(1);
              const totMB = (total / (1024 * 1024)).toFixed(1);
              if (epAbyssProgressStatusDetail) epAbyssProgressStatusDetail.textContent = `Качване в Abyss.to: ${upMB} MB / ${totMB} MB`;
            },
            (statusText) => {
              if (epAbyssProgressStatusDetail) epAbyssProgressStatusDetail.textContent = statusText;
            }
          );

          if (epAbyssProgressStatusDetail) epAbyssProgressStatusDetail.textContent = 'Видео файлът е в Abyss.to! Записване на епизода...';

          const epStreamtapeInput = adminEpisodeForm.querySelector('#streamtape_id');
          if (epStreamtapeInput) {
            epStreamtapeInput.value = `abyss:${slug}`;
          }

          epUploadMethodInput.value = 'manual';
          epAbyssVideoFile.value = '';

          adminEpisodeForm.submit();
        } catch (err) {
          if (epAbyssProgressStatusDetail) epAbyssProgressStatusDetail.textContent = 'Грешка: ' + err.message;
          alert('Грешка при качване в Abyss.to: ' + err.message + '\n\nСъвет: Проверете вашия Abyss API Key в Настройките или качете ръчно в сайта abyss.to.');
          if (epSubmitBtn) {
            epSubmitBtn.disabled = false;
            epSubmitBtn.textContent = '💾 Добави епизода';
          }
        }
        return;
      }

      // 2. Episode Streamtape API Upload
      if (currentMethod === 'api_upload') {
        const file = epVideoFile ? epVideoFile.files[0] : null;
        if (!file) return;

        e.preventDefault();

        if (epProgressWrapper) epProgressWrapper.style.display = 'block';
        if (epProgressBarFill) epProgressBarFill.style.width = '0%';
        if (epProgressTextPercent) epProgressTextPercent.textContent = '0%';
        if (epProgressStatusDetail) epProgressStatusDetail.textContent = 'Инициализиране...';
        if (epSubmitBtn) {
          epSubmitBtn.disabled = true;
          epSubmitBtn.textContent = '⏳ Качване в Streamtape...';
        }

        try {
          const streamtapeId = await uploadDirectToStreamtape(
            file,
            (loaded, total) => {
              const percent = Math.round((loaded / total) * 100);
              if (epProgressBarFill) epProgressBarFill.style.width = `${percent}%`;
              if (epProgressTextPercent) epProgressTextPercent.textContent = `${percent}%`;
              const upMB = (loaded / (1024 * 1024)).toFixed(1);
              const totMB = (total / (1024 * 1024)).toFixed(1);
              if (epProgressStatusDetail) epProgressStatusDetail.textContent = `Качване в Streamtape: ${upMB} MB / ${totMB} MB`;
            },
            (statusText) => {
              if (epProgressStatusDetail) epProgressStatusDetail.textContent = statusText;
            }
          );

          if (epProgressStatusDetail) epProgressStatusDetail.textContent = 'Видео файлът е в Streamtape! Записване на епизода...';

          const epStreamtapeInput = adminEpisodeForm.querySelector('#streamtape_id');
          if (epStreamtapeInput) {
            epStreamtapeInput.value = streamtapeId;
          }

          epUploadMethodInput.value = 'manual';
          epVideoFile.value = '';

          adminEpisodeForm.submit();

        } catch (err) {
          if (epProgressStatusDetail) epProgressStatusDetail.textContent = 'Грешка: ' + err.message;
          alert('Грешка при качване: ' + err.message + '\n\nСъвет: Можете да качите видеото директно в Streamtape.com и да поставите получения линк в полето.');
          if (epSubmitBtn) {
            epSubmitBtn.disabled = false;
            epSubmitBtn.textContent = '💾 Добави епизода';
          }
        }
      }
    });
  }


  // ========================================================
  // 6. DELETE CONFIRMATION MODAL
  // ========================================================
  const deleteModal = document.getElementById('deleteModal');
  const deleteForm = document.getElementById('deleteItemForm');
  const deleteItemTitle = document.getElementById('deleteItemTitle');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');

  document.querySelectorAll('.open-delete-modal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = btn.dataset.itemId;
      const title = btn.dataset.itemTitle;
      const actionUrl = btn.dataset.actionUrl;

      if (deleteItemTitle) deleteItemTitle.textContent = title;
      if (deleteForm) deleteForm.action = actionUrl || `/admin/delete/${itemId}`;
      if (deleteModal) deleteModal.classList.add('active');
    });
  });

  if (cancelDeleteBtn && deleteModal) {
    cancelDeleteBtn.addEventListener('click', () => {
      deleteModal.classList.remove('active');
    });

    deleteModal.addEventListener('click', (e) => {
      if (e.target === deleteModal) {
        deleteModal.classList.remove('active');
      }
    });
  }


  // ========================================================
  // ========================================================
  // 7. COPY SHARE LINK BUTTON
  // ========================================================
  const shareBtn = document.getElementById('shareLinkBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        const originalText = shareBtn.innerHTML;
        shareBtn.innerHTML = '✓ Линкът е копиран!';
        shareBtn.classList.remove('btn-secondary');
        shareBtn.classList.add('btn-primary');

        setTimeout(() => {
          shareBtn.innerHTML = originalText;
          shareBtn.classList.remove('btn-primary');
          shareBtn.classList.add('btn-secondary');
        }, 2500);
      } catch (err) {
        prompt('Копирайте линка към видеото:', window.location.href);
      }
    });
  }


  // 8. ANTI-SCREENSHOT & ANTI-SCREEN-RECORDING SECURITY SHIELD (HBO MAX STYLE)
  // ========================================================
  const shieldModal = document.getElementById('screenShieldModal');
  const shieldCloseXBtn = document.getElementById('shieldCloseXBtn');
  const shieldAcceptBtn = document.getElementById('shieldAcceptBtn');

  // Device detection: Mobile (iPhone, iPad, Android) vs Desktop
  const isMobileDevice = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth < 1024);

  // Check if current page loaded as a result of a redirect or with pending warning notice
  const urlParams = new URLSearchParams(window.location.search);
  const hasPendingNotice = urlParams.get('blocked') === 'recording' || sessionStorage.getItem('pending_shield_notice') === '1';

  if (hasPendingNotice && shieldModal) {
    sessionStorage.removeItem('pending_shield_notice');
    shieldModal.style.display = 'flex';
    shieldModal.setAttribute('aria-hidden', 'false');
  }

  /**
   * Instantly forces the video player into pitch black (DRM Black Screen),
   * identical to HBO Max and Netflix hardware protection pipelines.
   */
  function applyInstantBlackout() {
    // Only apply on desktop or explicit capture attempts
    const iframe = document.getElementById('playerIframe');
    const cover = document.getElementById('playerShieldCover');
    const ratioBox = document.querySelector('.player-aspect-ratio');

    if (cover) {
      cover.style.display = 'flex';
    }
    if (ratioBox) {
      ratioBox.classList.add('drm-blackout');
    }
    if (iframe) {
      iframe.classList.add('drm-blackout');
      if (iframe.src && iframe.src !== 'about:blank' && !iframe.src.endsWith('about:blank')) {
        iframe.dataset.savedSrc = iframe.src;
      }
    }
  }

  /**
   * Halts playback, blackens frame, increments violation tracking,
   * and presents the user notice modal with close [X].
   */
  function triggerSecurityLockdown(reason, forceRedirect = false) {
    applyInstantBlackout();

    const iframe = document.getElementById('playerIframe');
    if (iframe) {
      iframe.src = 'about:blank';
      iframe.style.display = 'none';
    }

    // Track violations in current session
    let count = parseInt(sessionStorage.getItem('shield_violations') || '0', 10) + 1;
    sessionStorage.setItem('shield_violations', count);

    // If 3 consecutive violations occurred -> redirect to homepage and show the notice on the new page
    if (count >= 3 || forceRedirect) {
      sessionStorage.setItem('pending_shield_notice', '1');
      window.location.href = '/?blocked=recording';
      return;
    }

    // Display user warning modal with [X]
    if (shieldModal) {
      shieldModal.style.display = 'flex';
      shieldModal.setAttribute('aria-hidden', 'false');
    }
  }

  /**
   * Closes the security notice, dismisses the blackout, and restores
   * normal video playback seamlessly when user clicks [X].
   */
  function dismissSecurityLockdown() {
    if (shieldModal) {
      shieldModal.style.display = 'none';
      shieldModal.setAttribute('aria-hidden', 'true');
    }

    sessionStorage.removeItem('pending_shield_notice');

    // Clean URL query param if present without reloading
    const curUrl = new URL(window.location.href);
    if (curUrl.searchParams.has('blocked')) {
      curUrl.searchParams.delete('blocked');
      window.history.replaceState({}, '', curUrl.pathname + (curUrl.search ? curUrl.search : ''));
    }

    const cover = document.getElementById('playerShieldCover');
    const ratioBox = document.querySelector('.player-aspect-ratio');
    const iframe = document.getElementById('playerIframe');

    if (cover) cover.style.display = 'none';
    if (ratioBox) ratioBox.classList.remove('drm-blackout');
    if (iframe) {
      iframe.classList.remove('drm-blackout');
      iframe.style.display = 'block';
      if (iframe.dataset.savedSrc) {
        iframe.src = iframe.dataset.savedSrc;
      }
    }
  }

  // Dismiss listeners (X button and Accept button)
  if (shieldCloseXBtn) {
    shieldCloseXBtn.addEventListener('click', dismissSecurityLockdown);
  }
  if (shieldAcceptBtn) {
    shieldAcceptBtn.addEventListener('click', dismissSecurityLockdown);
  }

  // A. Continuous Background Scanner (every 350ms) - Detects window capture, OBS, Game Bar
  let blurTickCount = 0;
  setInterval(() => {
    // CRITICAL FIX: Skip blur/focus scanner on iPhone, iPad, and Android phones!
    // On iOS Safari, touching an iframe or scrolling collapses the bar and drops focus naturally.
    if (isMobileDevice) return;

    const iframe = document.getElementById('playerIframe');
    const cover = document.getElementById('playerShieldCover');
    const modal = document.getElementById('screenShieldModal');
    const ratioBox = document.querySelector('.player-aspect-ratio');

    if (!iframe) return;

    // Check if player is active with a stream
    const isPlaying = (iframe.dataset.savedSrc || (iframe.src && iframe.src !== 'about:blank' && iframe.style.display !== 'none'));
    if (!isPlaying) return;

    // On desktop: If user clicked inside the iframe (to play/pause/adjust volume),
    // document.activeElement is the IFRAME! That is normal watching, NOT screen recording!
    if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
      blurTickCount = 0;
      return;
    }

    // If window lost focus while watching on desktop (e.g. Snipping Tool, OBS window capture)
    if (!document.hasFocus()) {
      blurTickCount++;
      // Instantly blackout video area so any recording captures 100% black
      if (cover && cover.style.display !== 'flex') {
        cover.style.display = 'flex';
      }
      if (ratioBox) ratioBox.classList.add('drm-blackout');
      if (iframe) iframe.classList.add('drm-blackout');

      // If focus remains lost for over 1.7s, pause stream and display the warning modal
      if (blurTickCount === 5 && modal && modal.style.display === 'none') {
        triggerSecurityLockdown('Засечена външна програма за заснемане на екрана или загуба на фокус.');
      }
    } else {
      blurTickCount = 0;
      // Normal focus: if modal is not open, remove blackout
      if (modal && modal.style.display === 'none') {
        if (cover && cover.style.display === 'flex') {
          cover.style.display = 'none';
        }
        if (ratioBox) ratioBox.classList.remove('drm-blackout');
        if (iframe) iframe.classList.remove('drm-blackout');
      }
    }
  }, 350);

  // B. Intercept browser screen recording API (getDisplayMedia)
  if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
    const origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = function(...args) {
      triggerSecurityLockdown('Браузърно разширение или програма опита да запише екрана чрез getDisplayMedia!');
      return Promise.reject(new DOMException('Записът на екрана е забранен!', 'NotAllowedError'));
    };
  }

  // C. Keyboard Screenshot & Snipping Tool interception with Microsecond Blackout
  window.addEventListener('keydown', (e) => {
    const key = e.key || '';
    const code = e.code || '';
    const isPrtScn = key === 'PrintScreen' || code === 'PrintScreen' || e.keyCode === 44;
    const isWinSnipping = (e.metaKey || e.ctrlKey) && e.shiftKey && (key.toLowerCase() === 's' || code === 'KeyS');
    const isMacCapture = e.metaKey && e.shiftKey && ['3', '4', '5'].includes(key);
    const isPrint = (e.ctrlKey || e.metaKey) && (key.toLowerCase() === 'p' || code === 'KeyP');
    const isSave = (e.ctrlKey || e.metaKey) && (key.toLowerCase() === 's' || code === 'KeyS') && !e.shiftKey;

    if (isPrtScn || isWinSnipping || isMacCapture || isPrint) {
      // 1. Instant blackout in current synchronous execution frame
      applyInstantBlackout();

      e.preventDefault();
      e.stopPropagation();

      // Wipe OS clipboard so no captured frame is pasted
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText('⚠️ Записът и скрийншотването на съдържание от CINEMAX са абсолютно забранени!');
        }
      } catch (err) {}

      triggerSecurityLockdown('Засечен клавишен опит за скрийншот или запис на екрана!');
      return false;
    }

    if (isSave) {
      e.preventDefault();
      return false;
    }
  }, true);

  // Catch PrintScreen keyup event
  window.addEventListener('keyup', (e) => {
    if (e.key === 'PrintScreen' || e.code === 'PrintScreen' || e.keyCode === 44) {
      applyInstantBlackout();
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText('⚠️ Записът и скрийншотването на съдържание от CINEMAX са абсолютно забранени!');
        }
      } catch (err) {}
      triggerSecurityLockdown('Засечен клавиш PrintScreen!');
    }
  }, true);

  // D. Window blur on desktop only (skips mobile and clicking inside player)
  window.addEventListener('blur', () => {
    if (isMobileDevice) return;
    if (document.activeElement && document.activeElement.tagName === 'IFRAME') return;
    applyInstantBlackout();
  });

  window.addEventListener('focus', () => {
    const modal = document.getElementById('screenShieldModal');
    const cover = document.getElementById('playerShieldCover');
    const ratioBox = document.querySelector('.player-aspect-ratio');
    const iframe = document.getElementById('playerIframe');

    // Only restore if warning modal is NOT active
    if (modal && modal.style.display === 'none') {
      if (cover) cover.style.display = 'none';
      if (ratioBox) ratioBox.classList.remove('drm-blackout');
      if (iframe) iframe.classList.remove('drm-blackout');
    }
  });

  // E. Disable right-click context menu on player and posters
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.player-theater-wrapper') || e.target.closest('.watch-poster-side') || e.target.closest('.media-card') || e.target.tagName === 'IMG') {
      e.preventDefault();
      return false;
    }
  });

  // F. Dynamic floating watermark (moves every 8 seconds)
  const watermark = document.getElementById('playerWatermark');
  if (watermark) {
    const positions = [
      { top: '16px', left: '20px', bottom: 'auto', right: 'auto' },
      { top: '16px', right: '20px', bottom: 'auto', left: 'auto' },
      { bottom: '16px', left: '20px', top: 'auto', right: 'auto' },
      { bottom: '16px', right: '20px', top: 'auto', left: 'auto' }
    ];
    let posIdx = 0;
    setInterval(() => {
      posIdx = (posIdx + 1) % positions.length;
      const p = positions[posIdx];
      watermark.style.top = p.top;
      watermark.style.bottom = p.bottom;
      watermark.style.left = p.left;
      watermark.style.right = p.right;
    }, 8000);
  }

  // E. Disable right-click context menu on player and posters
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.player-theater-wrapper') || e.target.closest('.watch-poster-side') || e.target.closest('.media-card') || e.target.tagName === 'IMG') {
      e.preventDefault();
      return false;
    }
  });

  // F. Dynamic floating watermark (moves every 8 seconds)
  const watermark = document.getElementById('playerWatermark');
  if (watermark) {
    const positions = [
      { top: '16px', left: '20px', bottom: 'auto', right: 'auto' },
      { top: '16px', right: '20px', bottom: 'auto', left: 'auto' },
      { bottom: '16px', left: '20px', top: 'auto', right: 'auto' },
      { bottom: '16px', right: '20px', top: 'auto', left: 'auto' }
    ];
    let posIdx = 0;
    setInterval(() => {
      posIdx = (posIdx + 1) % positions.length;
      const p = positions[posIdx];
      watermark.style.top = p.top;
      watermark.style.bottom = p.bottom;
      watermark.style.left = p.left;
      watermark.style.right = p.right;
    }, 8000);
  }

});


/**
 * Utility function to sanitize HTML in dynamically rendered strings
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

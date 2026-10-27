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

  // Smooth episode playback without reload
  if (episodeButtons.length > 0 && playerIframe) {
    episodeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();

        const streamtapeId = btn.dataset.streamtapeId;
        const embedUrl = btn.dataset.embedUrl || (streamtapeId ? `https://streamtape.com/e/${streamtapeId}/` : '');
        const serverName = btn.dataset.serverName || 'Cloud Stream';
        const episodeId = btn.dataset.episodeId;
        const episodeTitle = btn.dataset.episodeTitle;

        if (!embedUrl && !streamtapeId) return;

        // Ensure Ad-Shield sandbox is maintained on episode switch
        applyAdShieldState(isAdShieldActive, false);

        // Update iframe source
        playerIframe.src = embedUrl;

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
  // 3.2 WATCH PAGE: AD-SHIELD (ANTI-POPUP & ANTI-REDIRECT ENGINE)
  // ========================================================
  const toggleAdShieldBtn = document.getElementById('toggleAdShieldBtn');
  const adShieldStatusText = document.getElementById('adShieldStatusText');
  const adShieldToggleLabel = document.getElementById('adShieldToggleLabel');
  const adShieldPulse = document.getElementById('adShieldPulse');
  const reloadPlayerBtn = document.getElementById('reloadPlayerBtn');

  // Sandbox definitions:
  // Strict Shield: allows HTML5 video execution & same-origin streaming, but blocks popups, new tabs, top navigation!
  const SANDBOX_SHIELD = 'allow-scripts allow-same-origin allow-forms allow-presentation';
  const SANDBOX_STANDARD = 'allow-scripts allow-same-origin allow-forms allow-presentation allow-popups allow-top-navigation-by-user-activation';

  // Read saved state (default is true / active)
  let isAdShieldActive = localStorage.getItem('cinema_adshield_active') !== 'false';

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

    if (active) {
      playerIframe.setAttribute('sandbox', SANDBOX_SHIELD);
    } else {
      playerIframe.setAttribute('sandbox', SANDBOX_STANDARD);
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

  // Reload player button
  if (reloadPlayerBtn && playerIframe) {
    reloadPlayerBtn.addEventListener('click', () => {
      const currentSrc = playerIframe.src;
      playerIframe.src = 'about:blank';
      setTimeout(() => {
        playerIframe.src = currentSrc;
      }, 60);
    });
  }

  // Protect parent window against rogue popup scripts from external iframes
  try {
    const parentRealOpen = window.open;
    window.open = function(url, target, features) {
      if (isAdShieldActive) {
        console.warn('[Ad-Shield] Защитата блокира изскачащ прозорец към:', url);
        return null;
      }
      return parentRealOpen.call(window, url, target, features);
    };
  } catch (err) {
    // Ignore restricted environments
  }


  // ========================================================
  // 4. ADMIN PANEL: METHOD TOGGLE (ANONMP4 vs MANUAL vs STREAMTAPE API)
  // ========================================================
  const methodAnonBtn = document.getElementById('methodAnonBtn');
  const methodManualBtn = document.getElementById('methodManualBtn');
  const methodApiBtn = document.getElementById('methodApiBtn');
  const uploadMethodInput = document.getElementById('uploadMethodInput');
  const anonUploadFields = document.getElementById('anonUploadFields');
  const manualFields = document.getElementById('manualFields');
  const apiUploadFields = document.getElementById('apiUploadFields');
  const mediaTypeSelect = document.getElementById('mediaTypeSelect');
  const movieStreamtapeGroup = document.getElementById('movieStreamtapeGroup');
  const seriesNoticeGroup = document.getElementById('seriesNoticeGroup');

  function setUploadMethod(method) {
    if (uploadMethodInput) uploadMethodInput.value = method;
    [methodAnonBtn, methodManualBtn, methodApiBtn].forEach(b => { if (b) b.classList.remove('active'); });
    if (anonUploadFields) anonUploadFields.style.display = (method === 'anonmp4_upload') ? 'block' : 'none';
    if (manualFields) manualFields.style.display = (method === 'manual') ? 'block' : 'none';
    if (apiUploadFields) apiUploadFields.style.display = (method === 'api_upload') ? 'block' : 'none';

    if (method === 'anonmp4_upload' && methodAnonBtn) methodAnonBtn.classList.add('active');
    if (method === 'manual' && methodManualBtn) methodManualBtn.classList.add('active');
    if (method === 'api_upload' && methodApiBtn) methodApiBtn.classList.add('active');
  }

  if (methodAnonBtn) methodAnonBtn.addEventListener('click', () => setUploadMethod('anonmp4_upload'));
  if (methodManualBtn) methodManualBtn.addEventListener('click', () => setUploadMethod('manual'));
  if (methodApiBtn) methodApiBtn.addEventListener('click', () => setUploadMethod('api_upload'));

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
  // 5. FILE UPLOAD DROP-ZONES (ANONMP4 & STREAMTAPE)
  // ========================================================
  
  // AnonMP4 Drop Zone
  const anonDropBox = document.getElementById('anonUploadBox');
  const anonFileInput = document.getElementById('anonFileInput');
  const anonFileSelectedName = document.getElementById('anonFileSelectedName');

  if (anonDropBox && anonFileInput) {
    anonDropBox.addEventListener('click', () => anonFileInput.click());

    ['dragenter', 'dragover'].forEach(name => {
      anonDropBox.addEventListener(name, (e) => {
        e.preventDefault();
        anonDropBox.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      anonDropBox.addEventListener(name, (e) => {
        e.preventDefault();
        anonDropBox.classList.remove('dragover');
      });
    });

    anonDropBox.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length > 0) {
        anonFileInput.files = e.dataTransfer.files;
        updateAnonFileInfo(anonFileInput.files[0]);
      }
    });

    anonFileInput.addEventListener('change', () => {
      if (anonFileInput.files.length > 0) {
        updateAnonFileInfo(anonFileInput.files[0]);
      }
    });

    function updateAnonFileInfo(file) {
      if (!file) return;
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      if (anonFileSelectedName) {
        anonFileSelectedName.innerHTML = `✓ Избран файл за AnonMP4: <strong>${escapeHtml(file.name)}</strong> (${sizeMB} MB)`;
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

  // Helper for Direct Browser-to-AnonMP4 Upload (up to 20 GB)
  function uploadDirectToAnonMP4(file, onProgress, onStatus) {
    if (onStatus) onStatus('Свързване с AnonMP4 сървъра...');
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
          if ((resp.success || resp.status === 'active') && resp.video_id) {
            resolve(resp.video_id);
          } else if (resp.error && resp.error.message) {
            reject(new Error(resp.error.message));
          } else {
            reject(new Error(resp.message || 'AnonMP4 не върна Video ID.'));
          }
        } catch (err) {
          reject(new Error('Невалиден отговор от сървъра на AnonMP4.'));
        }
      };

      xhr.onerror = () => {
        reject(new Error('Мрежова грешка при трансфера на видеото към AnonMP4.'));
      };

      xhr.timeout = 3600000; // 1 hour max
      xhr.ontimeout = () => {
        reject(new Error('Времето за качване към AnonMP4 изтече.'));
      };

      xhr.open('POST', 'https://anonmp4api.xyz/upload');
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

      // 1. AnonMP4 Upload
      if (currentMethod === 'anonmp4_upload') {
        const file = anonFileInput ? anonFileInput.files[0] : null;
        if (!file) return; // Fallback to normal submit (will trigger validation)

        e.preventDefault();
        const anonProgWrap = document.getElementById('anonProgressWrapper');
        const anonProgFill = document.getElementById('anonProgressBarFill');
        const anonProgPercent = document.getElementById('anonProgressTextPercent');
        const anonProgStatus = document.getElementById('anonProgressStatusDetail');

        if (anonProgWrap) anonProgWrap.style.display = 'block';
        if (anonProgFill) anonProgFill.style.width = '0%';
        if (anonProgPercent) anonProgPercent.textContent = '0%';
        if (anonProgStatus) anonProgStatus.textContent = 'Инициализиране на качването към AnonMP4...';

        try {
          const videoId = await uploadDirectToAnonMP4(
            file,
            (loaded, total) => {
              const percent = Math.round((loaded / total) * 100);
              if (anonProgFill) anonProgFill.style.width = `${percent}%`;
              if (anonProgPercent) anonProgPercent.textContent = `${percent}%`;
              const upMB = (loaded / (1024 * 1024)).toFixed(1);
              const totMB = (total / (1024 * 1024)).toFixed(1);
              if (anonProgStatus) anonProgStatus.textContent = `Качване в AnonMP4: ${upMB} MB / ${totMB} MB`;
            },
            (statusText) => {
              if (anonProgStatus) anonProgStatus.textContent = statusText;
            }
          );

          if (anonProgStatus) anonProgStatus.textContent = 'Качването в AnonMP4 завърши успешно! Публикуване...';

          // Set identifier
          let streamtapeIdInput = document.getElementById('streamtape_id');
          if (streamtapeIdInput) {
            streamtapeIdInput.value = `anon:${videoId}`;
          }

          // Switch to manual to avoid re-uploading file bytes to Render
          uploadMethodInput.value = 'manual';
          anonFileInput.value = '';

          adminAddForm.submit();
        } catch (err) {
          if (anonProgStatus) anonProgStatus.textContent = 'Грешка: ' + err.message;
          alert('Грешка при директно качване към AnonMP4: ' + err.message + '\n\nСъвет: Можете да качите видеото директно в AnonMP4 и да поставите получения линк в Метод 2 (Ръчно въвеждане).');
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
  const epAnonVideoFile = document.getElementById('epAnonVideoFile');
  const epAnonProgressWrapper = document.getElementById('epAnonProgressWrapper');
  const epAnonProgressBarFill = document.getElementById('epAnonProgressBarFill');
  const epAnonProgressTextPercent = document.getElementById('epAnonProgressTextPercent');
  const epAnonProgressStatusDetail = document.getElementById('epAnonProgressStatusDetail');
  const epSubmitBtn = document.getElementById('epSubmitBtn');

  if (adminEpisodeForm) {
    adminEpisodeForm.addEventListener('submit', async (e) => {
      const currentMethod = epUploadMethodInput ? epUploadMethodInput.value : 'manual';

      // 1. Episode AnonMP4 Upload
      if (currentMethod === 'anonmp4_upload') {
        const file = epAnonVideoFile ? epAnonVideoFile.files[0] : null;
        if (!file) return;

        e.preventDefault();

        if (epAnonProgressWrapper) epAnonProgressWrapper.style.display = 'block';
        if (epAnonProgressBarFill) epAnonProgressBarFill.style.width = '0%';
        if (epAnonProgressTextPercent) epAnonProgressTextPercent.textContent = '0%';
        if (epAnonProgressStatusDetail) epAnonProgressStatusDetail.textContent = 'Инициализиране...';
        if (epSubmitBtn) {
          epSubmitBtn.disabled = true;
          epSubmitBtn.textContent = '⏳ Качване в AnonMP4...';
        }

        try {
          const videoId = await uploadDirectToAnonMP4(
            file,
            (loaded, total) => {
              const percent = Math.round((loaded / total) * 100);
              if (epAnonProgressBarFill) epAnonProgressBarFill.style.width = `${percent}%`;
              if (epAnonProgressTextPercent) epAnonProgressTextPercent.textContent = `${percent}%`;
              const upMB = (loaded / (1024 * 1024)).toFixed(1);
              const totMB = (total / (1024 * 1024)).toFixed(1);
              if (epAnonProgressStatusDetail) epAnonProgressStatusDetail.textContent = `Качване в AnonMP4: ${upMB} MB / ${totMB} MB`;
            },
            (statusText) => {
              if (epAnonProgressStatusDetail) epAnonProgressStatusDetail.textContent = statusText;
            }
          );

          if (epAnonProgressStatusDetail) epAnonProgressStatusDetail.textContent = 'Видео файлът е в AnonMP4! Записване на епизода...';

          const epStreamtapeInput = adminEpisodeForm.querySelector('#streamtape_id');
          if (epStreamtapeInput) {
            epStreamtapeInput.value = `anon:${videoId}`;
          }

          epUploadMethodInput.value = 'manual';
          epAnonVideoFile.value = '';

          adminEpisodeForm.submit();
        } catch (err) {
          if (epAnonProgressStatusDetail) epAnonProgressStatusDetail.textContent = 'Грешка: ' + err.message;
          alert('Грешка при качване в AnonMP4: ' + err.message + '\n\nСъвет: Можете да качите видеото и да поставите получения линк в Ръчен линк / ID.');
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

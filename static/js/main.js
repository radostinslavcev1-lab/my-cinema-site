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
        const episodeId = btn.dataset.episodeId;
        const episodeTitle = btn.dataset.episodeTitle;

        if (!streamtapeId) return;

        // Update iframe source
        playerIframe.src = `https://streamtape.com/e/${streamtapeId}/`;

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
  // 4. ADMIN PANEL: METHOD TOGGLE (MANUAL vs API UPLOAD)
  // ========================================================
  const methodManualBtn = document.getElementById('methodManualBtn');
  const methodApiBtn = document.getElementById('methodApiBtn');
  const uploadMethodInput = document.getElementById('uploadMethodInput');
  const manualFields = document.getElementById('manualFields');
  const apiUploadFields = document.getElementById('apiUploadFields');
  const mediaTypeSelect = document.getElementById('mediaTypeSelect');
  const movieStreamtapeGroup = document.getElementById('movieStreamtapeGroup');
  const seriesNoticeGroup = document.getElementById('seriesNoticeGroup');

  if (methodManualBtn && methodApiBtn && uploadMethodInput) {
    methodManualBtn.addEventListener('click', () => {
      methodManualBtn.classList.add('active');
      methodApiBtn.classList.remove('active');
      uploadMethodInput.value = 'manual';

      if (manualFields) manualFields.style.display = 'block';
      if (apiUploadFields) apiUploadFields.style.display = 'none';
    });

    methodApiBtn.addEventListener('click', () => {
      methodApiBtn.classList.add('active');
      methodManualBtn.classList.remove('active');
      uploadMethodInput.value = 'api_upload';

      if (manualFields) manualFields.style.display = 'none';
      if (apiUploadFields) apiUploadFields.style.display = 'block';
    });
  }

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
  // 5. FILE UPLOAD DROP-ZONE & PROGRESS BAR
  // ========================================================
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
  if (adminAddForm && progressWrapper && progressBarFill) {
    adminAddForm.addEventListener('submit', async (e) => {
      const isApiUpload = uploadMethodInput && uploadMethodInput.value === 'api_upload';
      if (!isApiUpload) return; // Allow normal manual submission

      const file = fileInput ? fileInput.files[0] : null;
      if (!file) return;

      e.preventDefault();

      // Show progress UI
      progressWrapper.style.display = 'block';
      progressBarFill.style.width = '0%';
      progressTextPercent.textContent = '0%';
      progressStatusDetail.textContent = 'Инициализиране...';

      try {
        const streamtapeId = await uploadDirectToStreamtape(
          file,
          (loaded, total) => {
            const percent = Math.round((loaded / total) * 100);
            progressBarFill.style.width = `${percent}%`;
            progressTextPercent.textContent = `${percent}%`;
            const upMB = (loaded / (1024 * 1024)).toFixed(1);
            const totMB = (total / (1024 * 1024)).toFixed(1);
            progressStatusDetail.textContent = `Качване в Streamtape: ${upMB} MB / ${totMB} MB`;
          },
          (statusText) => {
            progressStatusDetail.textContent = statusText;
          }
        );

        progressStatusDetail.textContent = 'Качването завърши успешно! Записване в каталога...';

        // Auto populate streamtape_id input and submit lightweight metadata
        let streamtapeIdInput = document.getElementById('streamtape_id');
        if (streamtapeIdInput) {
          streamtapeIdInput.value = streamtapeId;
        }

        // Switch method to manual so backend doesn't re-upload
        uploadMethodInput.value = 'manual';

        // Clear file input so huge video is NOT re-sent to Render!
        fileInput.value = '';

        // Submit form with metadata
        adminAddForm.submit();

      } catch (err) {
        progressStatusDetail.textContent = 'Грешка: ' + err.message;
        alert('Грешка при качване: ' + err.message + '\n\nСъвет: Можете да качите видеото директно на Streamtape.com и да въведете линка в Метод 1 (Ръчно въвеждане).');
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
  const epSubmitBtn = document.getElementById('epSubmitBtn');

  if (adminEpisodeForm && epProgressWrapper && epProgressBarFill) {
    adminEpisodeForm.addEventListener('submit', async (e) => {
      const isApiUpload = epUploadMethodInput && epUploadMethodInput.value === 'api_upload';
      if (!isApiUpload) return; // Allow manual link submission

      const file = epVideoFile ? epVideoFile.files[0] : null;
      if (!file) return;

      e.preventDefault();

      epProgressWrapper.style.display = 'block';
      epProgressBarFill.style.width = '0%';
      epProgressTextPercent.textContent = '0%';
      epProgressStatusDetail.textContent = 'Инициализиране...';
      if (epSubmitBtn) {
        epSubmitBtn.disabled = true;
        epSubmitBtn.textContent = '⏳ Качване в Streamtape...';
      }

      try {
        const streamtapeId = await uploadDirectToStreamtape(
          file,
          (loaded, total) => {
            const percent = Math.round((loaded / total) * 100);
            epProgressBarFill.style.width = `${percent}%`;
            epProgressTextPercent.textContent = `${percent}%`;
            const upMB = (loaded / (1024 * 1024)).toFixed(1);
            const totMB = (total / (1024 * 1024)).toFixed(1);
            epProgressStatusDetail.textContent = `Качване в Streamtape: ${upMB} MB / ${totMB} MB`;
          },
          (statusText) => {
            epProgressStatusDetail.textContent = statusText;
          }
        );

        epProgressStatusDetail.textContent = 'Видео файлът е в Streamtape! Записване на епизода...';

        // Set streamtape_id in input
        const epStreamtapeInput = adminEpisodeForm.querySelector('#streamtape_id');
        if (epStreamtapeInput) {
          epStreamtapeInput.value = streamtapeId;
        }

        // Switch to manual and clear video file so Render receives 0 MB video!
        epUploadMethodInput.value = 'manual';
        epVideoFile.value = '';

        adminEpisodeForm.submit();

      } catch (err) {
        epProgressStatusDetail.textContent = 'Грешка: ' + err.message;
        alert('Грешка при качване: ' + err.message + '\n\nСъвет: Можете да качите видеото директно в Streamtape.com и да поставите получения линк в полето.');
        if (epSubmitBtn) {
          epSubmitBtn.disabled = false;
          epSubmitBtn.textContent = '💾 Добави епизода';
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

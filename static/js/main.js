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

  // Upload with Progress Bar via XMLHttpRequest
  if (adminAddForm && progressWrapper && progressBarFill) {
    adminAddForm.addEventListener('submit', (e) => {
      const isApiUpload = uploadMethodInput && uploadMethodInput.value === 'api_upload';
      if (!isApiUpload) return; // Allow standard submission for manual method

      const file = fileInput ? fileInput.files[0] : null;
      if (!file) return; // HTML5 required attribute will handle it

      e.preventDefault();

      // Show progress UI
      progressWrapper.style.display = 'block';
      progressBarFill.style.width = '0%';
      progressTextPercent.textContent = '0%';
      progressStatusDetail.textContent = 'Подготовка и качване към сървъра...';

      const formData = new FormData(adminAddForm);
      const xhr = new XMLHttpRequest();

      // Upload progress event
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          progressBarFill.style.width = `${percent}%`;
          progressTextPercent.textContent = `${percent}%`;

          if (percent >= 100) {
            progressStatusDetail.textContent = 'Файлът е получен! Извършва се 2-стъпково качване към Streamtape API (моля изчакайте)...';
          } else {
            const uploadedMB = (event.loaded / (1024 * 1024)).toFixed(1);
            const totalMB = (event.total / (1024 * 1024)).toFixed(1);
            progressStatusDetail.textContent = `Качване: ${uploadedMB} MB / ${totalMB} MB`;
          }
        }
      });

      xhr.onreadystatechange = () => {
        if (xhr.readyState === XMLHttpRequest.DONE) {
          if (xhr.status === 200 || xhr.status === 302 || xhr.responseURL) {
            progressStatusDetail.textContent = 'Готово! Пренасочване...';
            // Redirect to resulting URL
            window.location.href = xhr.responseURL || '/admin';
          } else {
            progressStatusDetail.textContent = 'Възникна грешка при качването.';
            alert('Грешка при качване на видеото към сървъра или Streamtape.');
          }
        }
      };

      xhr.open('POST', adminAddForm.action || window.location.href);
      xhr.send(formData);
    });
  }

  // Upload with Progress Bar for Episodes
  const adminEpisodeForm = document.getElementById('adminEpisodeForm');
  const epProgressWrapper = document.getElementById('epProgressWrapper');
  const epProgressBarFill = document.getElementById('epProgressBarFill');
  const epProgressTextPercent = document.getElementById('epProgressTextPercent');
  const epProgressStatusDetail = document.getElementById('epProgressStatusDetail');
  const epUploadMethodInput = document.getElementById('epUploadMethodInput');
  const epVideoFile = document.getElementById('epVideoFile');
  const epSubmitBtn = document.getElementById('epSubmitBtn');

  if (adminEpisodeForm && epProgressWrapper && epProgressBarFill) {
    adminEpisodeForm.addEventListener('submit', (e) => {
      const isApiUpload = epUploadMethodInput && epUploadMethodInput.value === 'api_upload';
      if (!isApiUpload) return;

      const file = epVideoFile ? epVideoFile.files[0] : null;
      if (!file) return;

      e.preventDefault();

      epProgressWrapper.style.display = 'block';
      epProgressBarFill.style.width = '0%';
      epProgressTextPercent.textContent = '0%';
      epProgressStatusDetail.textContent = 'Подготовка и качване...';
      if (epSubmitBtn) {
        epSubmitBtn.disabled = true;
        epSubmitBtn.textContent = '⏳ Качване към сървъра...';
      }

      const formData = new FormData(adminEpisodeForm);
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          epProgressBarFill.style.width = `${percent}%`;
          epProgressTextPercent.textContent = `${percent}%`;

          if (percent >= 100) {
            epProgressStatusDetail.textContent = 'Файлът е изпратен! Извършва се трансфер към Streamtape API...';
            if (epSubmitBtn) epSubmitBtn.textContent = '⏳ Обработка в Streamtape...';
          } else {
            const uploadedMB = (event.loaded / (1024 * 1024)).toFixed(1);
            const totalMB = (event.total / (1024 * 1024)).toFixed(1);
            epProgressStatusDetail.textContent = `Качване: ${uploadedMB} MB / ${totalMB} MB`;
          }
        }
      });

      xhr.onreadystatechange = () => {
        if (xhr.readyState === XMLHttpRequest.DONE) {
          if (xhr.status === 200 || xhr.status === 302 || xhr.responseURL) {
            epProgressStatusDetail.textContent = 'Готово!';
            window.location.href = xhr.responseURL || window.location.href;
          } else {
            epProgressStatusDetail.textContent = 'Възникна грешка при качването.';
            alert('Грешка при качване на видеото към сървъра или Streamtape (Код: ' + xhr.status + '). Можете да качите видеото директно в Streamtape.com и да въведете линка ръчно.');
            if (epSubmitBtn) {
              epSubmitBtn.disabled = false;
              epSubmitBtn.textContent = '💾 Добави епизода';
            }
          }
        }
      };

      xhr.open('POST', adminEpisodeForm.action || window.location.href);
      xhr.send(formData);
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

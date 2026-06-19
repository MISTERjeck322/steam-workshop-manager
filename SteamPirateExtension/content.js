(async function() {
    console.log("[Pirate Extension] Скрипт запущен.");

    let LOCALIZATION = {};
    let currentLang = 'en';

    // Функция асинхронной загрузки внешнего файла локализации
    async function loadLocales() {
        try {
            const url = chrome.runtime.getURL('locales.json');
            const response = await fetch(url);
            LOCALIZATION = await response.json();
            
            // Определение активного языка
            currentLang = localStorage.getItem('pirate-lang');
            if (!currentLang) {
                const navLang = navigator.language.toLowerCase();
                if (navLang.startsWith('uk')) currentLang = 'uk';
                else if (navLang.startsWith('es')) currentLang = 'es';
                else if (navLang.startsWith('pt')) currentLang = 'pt-br';
                else if (navLang.startsWith('id')) currentLang = 'id';
                else if (navLang.startsWith('ru')) currentLang = 'ru';
                else currentLang = 'en';
            }
        } catch (e) {
            console.error("[Pirate Extension] Ошибка загрузки locales.json:", e);
        }
    }

    // Загружаем локализацию перед выполнением кода
    await loadLocales();

    // Функция перевода
    function t(key, placeholders = {}) {
        let text = LOCALIZATION[currentLang]?.[key] || LOCALIZATION['en']?.[key] || key;
        for (const placeholder in placeholders) {
            text = text.replace(new RegExp(`{${placeholder}}`, 'g'), placeholders[placeholder]);
        }
        return text;
    }

    let activeMods = []; 
    let gameSettings = {}; 
    let sidebarOpenState = false; 
    let selectedGame = null; 
    let pollIntervalId = null; 

    let activeAppId = null;
    let activeGameName = null;

    const POPULAR_GAMES = {
        "108600": "Project Zomboid",
        "4000": "Garry's Mod",
        "294100": "RimWorld",
        "255710": "Cities Skylines",
        "107410": "Arma 3",
        "281990": "Stellaris",
        "394360": "Hearts of Iron IV",
        "431960": "Wallpaper Engine",
        "262060": "Darkest Dungeon",
        "311210": "Call of Duty: Black Ops III",
        "211820": "Starbound",
        "252490": "Rust",
        "227300": "Euro Truck Simulator 2"
    };

    function injectStyles() {
        if (document.getElementById('pirate-css-rules')) return;
        
        let style = document.createElement('style');
        style.id = 'pirate-css-rules';
        style.innerHTML = `
            #SubscribeItemBtn, .game_area_purchase_game_dropdown_selection, 
            .game_area_purchase_game_dropdown_selection_item_text { display: none !important; }
            
            /* Стили кнопок контента */
            .pirate-card-btn {
                background: linear-gradient(to bottom, #417a9b 0%, #224c64 100%) !important;
                border: 1px solid #3d6c8f !important;
                color: #ffffff !important;
                padding: 5px 14px !important;
                text-align: center !important;
                border-radius: 3px !important;
                cursor: pointer !important;
                margin-top: 8px !important;
                font-size: 12px !important;
                font-weight: bold !important;
                text-shadow: 1px 1px 0px rgba(0,0,0,0.5) !important;
                box-sizing: border-box !important;
                display: inline-block !important;
                width: max-content !important;
                text-decoration: none !important;
                z-index: 10 !important;
                position: relative !important;
            }
            .pirate-card-btn:hover { filter: brightness(1.15); color: #ffffff !important; }

            .pirate-collection-btn {
                background: linear-gradient(to bottom, #417a9b 0%, #224c64 100%) !important;
                border: 1px solid #3d6c8f !important;
                border-radius: 3px !important;
                cursor: pointer !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                height: 30px !important;
                padding: 0 15px !important;
                color: #ffffff !important;
                font-size: 12px !important;
                font-weight: bold !important;
                text-shadow: 1px 1px 0px rgba(0,0,0,0.5) !important;
                text-decoration: none !important;
            }
            .pirate-collection-btn:hover { filter: brightness(1.15); color: #ffffff !important; }
            
            /* Уведомления */
            #pirate-toast-container {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 100000;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: none;
            }
            
            .pirate-toast {
                background-color: #171a21;
                color: #c5c3c0;
                border: 1px solid #3d6c8f;
                border-left: 5px solid #66c0f4;
                padding: 12px 20px;
                border-radius: 4px;
                font-family: "Motiva Sans", Arial, sans-serif;
                font-size: 13px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.6);
                transform: translateX(120%);
                opacity: 0;
                transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease;
                pointer-events: auto;
                display: flex;
                align-items: center;
                gap: 10px;
                min-width: 250px;
            }
            .pirate-toast.show { transform: translateX(0); opacity: 1; }
            .pirate-toast.error { border-left-color: #ae3838; }

            /* Боковая панель */
            #pirate-floating-widget {
                position: fixed;
                right: 0;
                top: 30%;
                transform: translateY(-50%);
                background: linear-gradient(to bottom, #417a9b 0%, #224c64 100%);
                border: 1px solid #3d6c8f;
                border-right: none;
                color: white;
                padding: 12px 10px;
                border-top-left-radius: 8px;
                border-bottom-left-radius: 8px;
                cursor: pointer;
                box-shadow: -2px 2px 10px rgba(0,0,0,0.5);
                z-index: 99999;
                font-size: 20px;
                transition: padding 0.2s;
            }
            #pirate-floating-widget:hover { padding-right: 15px; filter: brightness(1.1); }

            #pirate-sidebar-panel {
                position: fixed;
                right: -420px;
                top: 0;
                width: 400px;
                height: 100vh;
                background-color: #171a21;
                border-left: 1px solid #2a475e;
                box-shadow: -5px 0 25px rgba(0,0,0,0.8);
                z-index: 100000;
                transition: right 0.3s cubic-bezier(0.075, 0.82, 0.165, 1);
                color: #c5c3c0;
                font-family: "Motiva Sans", Arial, sans-serif;
                display: flex;
                flex-direction: column;
            }
            #pirate-sidebar-panel.open { right: 0; }

            .pirate-panel-header {
                background-color: #0b0e14;
                padding: 15px;
                border-bottom: 1px solid #2a475e;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .pirate-panel-header h3 { margin: 0; color: #fff; font-size: 15px; display: flex; align-items: center; gap: 5px; }
            .pirate-close-btn { cursor: pointer; font-size: 20px; color: #66c0f4; }
            .pirate-close-btn:hover { color: white; }

            .pirate-global-controls {
                padding: 15px;
                border-bottom: 1px solid #2a475e;
                background-color: #1b2838;
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
            }
            .pirate-action-btn {
                flex: 1;
                background-color: #2a475e;
                border: 1px solid #386e97;
                color: #66c0f4;
                padding: 8px;
                text-align: center;
                border-radius: 3px;
                cursor: pointer;
                font-size: 11px;
                font-weight: bold;
                text-transform: uppercase;
                transition: background 0.2s, color 0.2s;
            }
            .pirate-action-btn:hover { background-color: #386e97; color: white; }
            .pirate-action-btn.full-width { 
                flex: 100%; 
                margin-top: 5px; 
                background: linear-gradient(to bottom, #417a9b 0%, #224c64 100%); 
                border-color: #3d6c8f; 
                color: white; 
            }
            .pirate-action-btn.full-width:hover { filter: brightness(1.15); }

            .pirate-active-game-box {
                background-color: #1b2838;
                border: 1px solid #3d6c8f;
                padding: 12px;
                margin: 12px 15px 0 15px;
                border-radius: 4px;
            }

            .pirate-search-box {
                padding: 10px 15px;
                border-bottom: 1px solid #2a475e;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .pirate-input {
                background-color: #0b0e14;
                border: 1px solid #2a475e;
                color: white;
                padding: 6px 10px;
                border-radius: 3px;
                font-size: 12px;
                width: 100%;
                box-sizing: border-box;
            }
            .pirate-input:focus { border-color: #66c0f4; outline: none; }

            .pirate-mods-list {
                flex: 1;
                overflow-y: auto;
                padding: 15px;
                position: relative;
            }
            
            .pirate-game-row {
                background: #1b2838;
                border: 1px solid #2a475e;
                padding: 12px;
                margin-bottom: 8px;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-weight: bold;
                font-size: 13px;
                color: white;
                transition: background 0.2s, border-color 0.2s;
            }
            .pirate-game-row:hover { background: #2a475e !important; border-color: #386e97 !important; }

            .pirate-back-btn {
                background: #2a475e;
                color: #66c0f4;
                padding: 8px 12px;
                border-radius: 3px;
                font-size: 11px;
                font-weight: bold;
                cursor: pointer;
                margin-bottom: 12px;
                width: max-content;
                transition: background 0.2s, color 0.2s;
                display: flex;
                align-items: center;
                gap: 5px;
            }
            .pirate-back-btn:hover { background: #386e97 !important; color: white !important; }

            .pirate-game-title {
                color: #66c0f4;
                font-size: 13px;
                font-weight: bold;
                border-bottom: 1px solid #2a475e;
                padding-bottom: 5px;
                margin-bottom: 10px;
                display: flex;
                justify-content: space-between;
            }

            .pirate-mod-card {
                display: flex;
                background-color: #1b2838;
                border: 1px solid #2a475e;
                border-radius: 4px;
                padding: 8px;
                margin-bottom: 8px;
                gap: 10px;
                position: relative;
            }
            .pirate-mod-card-img {
                width: 50px;
                height: 50px;
                border-radius: 3px;
                object-fit: cover;
                background-color: #000;
            }
            .pirate-mod-card-info { flex: 1; min-width: 0; }
            .pirate-mod-card-title {
                color: white;
                font-size: 12px;
                font-weight: bold;
                margin-bottom: 3px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .pirate-mod-card-meta { font-size: 10px; color: #8f98a0; }
            .pirate-mod-card-version { font-size: 11px; color: #66c0f4; font-weight: bold; margin-top: 3px;}

            .pirate-progress-container { width: 100%; background: #0b0e14; border-radius: 3px; height: 6px; margin-top: 5px; overflow: hidden; }
            .pirate-progress-bar { background-color: #66c0f4; height: 100%; width: 0%; transition: width 0.3s ease; }
            .pirate-mod-error-text { font-size: 10px; color: #ae3838; margin-top: 3px; font-weight: bold; }

            .pirate-mod-delete { position: absolute; top: 8px; right: 8px; cursor: pointer; color: #507b99; font-size: 14px; transition: color 0.2s; }
            .pirate-mod-delete:hover { color: #ae3838; }

            /* Окно импорта поверх списка модов */
            #pirate-import-modal {
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(11, 14, 20, 0.95);
                backdrop-filter: blur(3px);
                z-index: 100;
                display: flex;
                flex-direction: column;
                padding: 20px;
            }
            .pirate-modal-box {
                background: #1b2838;
                border: 1px solid #3d6c8f;
                border-radius: 6px;
                padding: 15px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.8);
            }
            .pirate-modal-title { color: white; font-size: 15px; font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #2a475e; padding-bottom: 5px; }
            .pirate-modal-text { font-size: 12px; color: #c5c3c0; margin-bottom: 15px; }
            .pirate-modal-buttons { display: flex; gap: 10px; margin-top: 15px; }
        `;
        document.head.appendChild(style);
    }

    function showNotification(message, isError = false) {
        let container = document.getElementById('pirate-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'pirate-toast-container';
            document.body.appendChild(container);
        }

        let toast = document.createElement('div');
        toast.className = 'pirate-toast' + (isError ? ' error' : '');
        toast.innerHTML = isError ? `❌ ${message}` : `🏴‍☠️ ${message}`;

        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 50);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    function getModIdFromUrl(url) {
        let match = url.match(/id=(\d+)/);
        return match ? match[1] : "unknown";
    }

    function getAppId() {
        let url = window.location.href;
        let appidMatch = url.match(/[?&]appid=(\d+)/) || url.match(/\/workshop\/(\d+)/);
        if (appidMatch) return appidMatch[1];
        let scripts = document.getElementsByTagName('script');
        for (let script of scripts) {
            let content = script.textContent;
            let match = content.match(/g_OriginalAppID\s*=\s*(\d+)/) || content.match(/g_AppId\s*=\s*(\d+)/) || content.match(/ShowWorkshopCommonMenu\(\s*(\d+)/);
            if (match) return match[1];
        }
        let appLink = document.querySelector('a[href*="/app/"]');
        if (appLink) {
            let m = appLink.href.match(/\/app\/(\d+)/);
            if (m) return m[1];
        }
        return null;
    }

    function getGameNameFromBreadcrumbs() {
        let appId = getAppId();
        if (!appId) return null;
        let breadcrumbs = document.querySelectorAll('.breadcrumbs a, .breadcrumb a, .responsive_breadcrumbs a, .workshop_breadcrumbs a');
        for (let link of breadcrumbs) {
            let href = link.href;
            if (href.includes(`appid=${appId}`)) {
                let text = link.textContent.trim();
                if (text && text.length > 1) {
                    let lowText = text.toLowerCase();
                    if (!lowText.includes('browse') && !lowText.includes('просмотр') && !lowText.includes('workshop') && !lowText.includes('мастерская')) {
                        return text;
                    }
                }
            }
        }
        return null;
    }

    function getGameName() {
        let appId = getAppId();
        let appNameEl = document.querySelector('.apphub_AppName');
        if (appNameEl && appNameEl.textContent.trim().length > 0) return appNameEl.textContent.trim();
        let nameFromNav = getGameNameFromBreadcrumbs();
        if (nameFromNav) return nameFromNav;
        let headerEl = document.querySelector('.workshopHeaderTitle') || document.querySelector('.workshop_header_title');
        if (headerEl) {
            let cloned = headerEl.cloneNode(true);
            let subtitle = cloned.querySelector('.workshopHeaderSubtitle') || cloned.querySelector('.sub_title');
            if (subtitle) subtitle.remove();
            let name = cloned.textContent.trim().replace(/(Workshop|Мастерская)/gi, "").trim();
            if (name) return name;
        }
        if (appId && POPULAR_GAMES[appId]) return POPULAR_GAMES[appId];
        return "Steam Game";
    }

    function getPageMetadata() {
        let titleEl = document.getElementById('workshopItemTitle') || document.querySelector('.workshopItemTitle');
        let title = titleEl ? titleEl.textContent.trim() : document.title;
        let imgEl = document.getElementById('headerimage') || document.querySelector('.workshopItemPreviewImage');
        let imageUrl = imgEl ? imgEl.src : "";
        return { title, imageUrl, gameName: getGameName(), appId: getAppId() };
    }

    function getCardMetadata(card) {
        let imgEl = card.querySelector('img');
        let imageUrl = imgEl ? imgEl.src : "";
        let titleLink = card.querySelector('a[href*="sharedfiles/filedetails/?id="]:not(:has(img))');
        if (!titleLink) {
            let links = card.querySelectorAll('a[href*="sharedfiles/filedetails/?id="]');
            titleLink = Array.from(links).find(l => l.textContent.trim().length > 0);
        }
        let title = titleLink ? titleLink.textContent.trim() : "Mod";
        return { title, imageUrl, gameName: getGameName(), appId: getAppId() };
    }

    function getCollectionItemMetadata(control) {
        let cardContainer = control.closest('.collectionItem') || control.closest('.workshopItem') || control.parentElement;
        let titleEl = cardContainer.querySelector('.workshopItemTitle') || cardContainer.querySelector('a');
        let title = titleEl ? titleEl.textContent.trim() : "Collection Item";
        let imgEl = cardContainer.querySelector('img');
        let imageUrl = imgEl ? imgEl.src : "";
        return { title, imageUrl, gameName: getGameName(), appId: getAppId() };
    }

    function sendToPythonServer(url, metadata) {
        fetch('http://127.0.0.1:8080/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: url,
                title: metadata.title,
                imageUrl: metadata.imageUrl,
                gameName: metadata.gameName,
                appId: metadata.appId
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.status !== "exists") {
                showNotification(t('toast_queued', { id: getModIdFromUrl(url) }));
            }
            refreshSidebar();
        })
        .catch(error => showNotification(t('toast_no_server'), true));
    }

    function processPageElements() {
        injectStyles();
        let mainSubscribeBtn = document.getElementById('SubscribeItemBtn');
        if (mainSubscribeBtn && !mainSubscribeBtn.classList.contains('pirate-processed')) {
            mainSubscribeBtn.classList.add('pirate-processed');
            mainSubscribeBtn.style.setProperty('display', 'none', 'important');
            let pirateBtn = createMainPirateButton(function(e) {
                e.preventDefault();
                sendToPythonServer(window.location.href, getPageMetadata());
            });
            mainSubscribeBtn.parentNode.insertBefore(pirateBtn, mainSubscribeBtn.nextSibling);
        }
        let modLinks = document.querySelectorAll('a[href*="sharedfiles/filedetails/?id="]');
        modLinks.forEach(link => {
            let card = link.closest('.Panel') || link.closest('.workshopItem');
            if (!card) return;
            if (card.classList.contains('pirate-card-processed')) return;
            card.classList.add('pirate-card-processed');
            let cardBtn = createCardPirateButton();
            cardBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                sendToPythonServer(link.href, getCardMetadata(card));
            });
            let infoBlock = card.querySelector('div:not(:first-child)') || card;
            infoBlock.appendChild(cardBtn);
        });
        let subControls = document.querySelectorAll('.subscriptionControls');
        subControls.forEach(control => {
            if (control.classList.contains('pirate-processed')) return;
            control.classList.add('pirate-processed');
            let subBtn = control.querySelector('a[id^="SubscribeItemBtn"]');
            if (!subBtn) return;
            subBtn.style.setProperty('display', 'none', 'important');
            let modId = subBtn.id.replace('SubscribeItemBtn', '');
            if (modId) {
                let pirateBtn = document.createElement('a');
                pirateBtn.className = 'pirate-collection-btn';
                pirateBtn.innerHTML = t('download');
                pirateBtn.href = '#';
                pirateBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    sendToPythonServer(`https://steamcommunity.com/sharedfiles/filedetails/?id=${modId}`, getCollectionItemMetadata(control));
                });
                control.appendChild(pirateBtn);
            }
        });
        let collectionHeaders = document.querySelectorAll('.subscribeCollection');
        collectionHeaders.forEach(header => {
            if (header.classList.contains('pirate-processed')) return;
            header.classList.add('pirate-processed');
            let subAllBtn = header.querySelector('a[onclick*="SubscribeCollection"]');
            if (!subAllBtn) return;
            let downloadAllBtn = createDownloadAllButton(function(e) {
                e.preventDefault();
                e.stopPropagation();
                let currentCollectionId = getModIdFromUrl(window.location.href);
                let allLinks = document.querySelectorAll('a[href*="sharedfiles/filedetails/?id="]');
                let uniqueIds = new Set();
                let targets = [];
                allLinks.forEach(link => {
                    let id = getModIdFromUrl(link.href);
                    let card = link.closest('.collectionItem') || link.closest('.workshopItem');
                    if (id !== "unknown" && id !== currentCollectionId && !uniqueIds.has(id) && card) {
                        uniqueIds.add(id);
                        targets.push({ url: link.href, metadata: getCardMetadata(card) });
                    }
                });
                if (targets.length === 0) { showNotification(t('toast_no_mods_in_collection'), true); return; }
                targets.forEach((item, index) => { setTimeout(() => sendToPythonServer(item.url, item.metadata), index * 300); });
            });
            subAllBtn.parentNode.insertBefore(downloadAllBtn, subAllBtn);
        });
    }

    function createMainPirateButton(onClickCallback) {
        let btn = document.createElement('div');
        btn.className = 'btn_green_white_innerfade btn_medium pirate-injected-btn';
        btn.style.cssText = 'background-color: #224c64; background-image: linear-gradient(to bottom, #417a9b 0%, #224c64 100%); border-color: #3d6c8f; display: inline-block; cursor: pointer; margin-left: 10px;';
        let span = document.createElement('span');
        span.innerHTML = t('download');
        span.style.cssText = 'padding: 0 15px; color: #ffffff; text-shadow: 1px 1px 0px rgba(0,0,0,0.5);';
        btn.appendChild(span);
        btn.addEventListener('click', onClickCallback);
        return btn;
    }

    function createCardPirateButton() {
        let btn = document.createElement('a');
        btn.className = 'pirate-card-btn';
        btn.innerHTML = t('download');
        btn.href = '#';
        return btn;
    }

    function createDownloadAllButton(onClickCallback) {
        let btn = document.createElement('a');
        btn.className = 'general_btn subscribe pirate-collection-all-btn';
        btn.style.cssText = 'background: linear-gradient(to bottom, #417a9b 0%, #224c64 100%) !important; border: 1px solid #3d6c8f !important; color: #ffffff !important; cursor: pointer; display: inline-flex; align-items: center; padding: 0 15px; height: 30px; border-radius: 3px; font-weight: bold; margin-right: 5px; text-shadow: 1px 1px 0px rgba(0,0,0,0.5); text-decoration: none;';
        btn.innerHTML = `<span style="color: white !important;">${t('download_all')}</span>`;
        btn.addEventListener('click', onClickCallback);
        return btn;
    }

    function startPolling() { if (!pollIntervalId) pollIntervalId = setInterval(refreshSidebar, 2000); }
    function stopPolling() { if (pollIntervalId) { clearInterval(pollIntervalId); pollIntervalId = null; } }

    function buildSidebarUI() {
        injectStyles();
        if (document.getElementById('pirate-sidebar-panel')) return;

        let widget = document.createElement('div');
        widget.id = 'pirate-floating-widget';
        widget.innerHTML = '☠️';
        widget.title = t('manager_title');
        document.body.appendChild(widget);

        let panel = document.createElement('div');
        panel.id = 'pirate-sidebar-panel';
        if (sidebarOpenState) panel.classList.add('open');

        panel.innerHTML = `
            <div class="pirate-panel-header">
                <h3>🏴‍☠️ <span id="pirate-manager-title-span">${t('manager_title')}</span> <span id="pirate-total-count" style="color: #66c0f4">(0)</span></h3>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <select id="pirate-lang-select" style="background: #0b0e14; color: #c5c3c0; border: 1px solid #2a475e; border-radius: 3px; padding: 2px 5px; font-size: 11px; cursor: pointer;">
                        <option value="en">English</option>
                        <option value="ru">Русский</option>
                        <option value="uk">Українська</option>
                        <option value="es">Español</option>
                        <option value="pt-br">Português (Brasil)</option>
                        <option value="id">Bahasa Indonesia</option>
                    </select>
                    <span class="pirate-close-btn" id="pirate-sidebar-close">×</span>
                </div>
            </div>
            <div class="pirate-global-controls">
                <div class="pirate-action-btn" id="pirate-btn-check-updates">${t('check_updates')}</div>
                <div class="pirate-action-btn" id="pirate-btn-update-all">${t('update_all')}</div>
                <div class="pirate-action-btn full-width" id="pirate-btn-global-import">${t('import_collection')}</div>
                <input type="file" id="pirate-global-import-input" accept=".json" style="display:none;">
            </div>
            <div id="pirate-active-workshop-container"></div>
            <div class="pirate-search-box">
                <input type="text" class="pirate-input" id="pirate-search-game" placeholder="${t('search_games')}">
                <input type="text" class="pirate-input" id="pirate-search-mod" placeholder="${t('search_mods')}" style="display:none;">
            </div>
            <div class="pirate-mods-list" id="pirate-mods-container"></div>
        `;
        document.body.appendChild(panel);

        const select = document.getElementById('pirate-lang-select');
        if (select) {
            select.value = currentLang;
            select.addEventListener('change', async (e) => {
                currentLang = e.target.value;
                localStorage.setItem('pirate-lang', currentLang);
                
                // Перерисовываем элементы страницы с новым языком
                document.querySelectorAll('.pirate-processed, .pirate-card-processed').forEach(el => {
                    el.classList.remove('pirate-processed', 'pirate-card-processed');
                });
                document.querySelectorAll('.pirate-injected-btn, .pirate-card-btn, .pirate-collection-btn, .pirate-collection-all-btn').forEach(el => el.remove());
                
                const currentOpen = sidebarOpenState;
                panel.remove();
                widget.remove();
                sidebarOpenState = currentOpen;
                safeInit();
            });
        }

        widget.addEventListener('click', () => {
            panel.classList.toggle('open');
            sidebarOpenState = panel.classList.contains('open');
            if (sidebarOpenState) { refreshSidebar(); startPolling(); } else stopPolling();
        });

        document.getElementById('pirate-sidebar-close').addEventListener('click', () => {
            panel.classList.remove('open');
            sidebarOpenState = false;
            stopPolling();
        });

        document.getElementById('pirate-search-game').addEventListener('input', renderSidebarContent);
        document.getElementById('pirate-search-mod').addEventListener('input', renderSidebarContent);

        document.getElementById('pirate-btn-check-updates').addEventListener('click', () => {
            showNotification(t('toast_checking'));
            fetch('http://127.0.0.1:8080/check-updates', { method: 'POST' })
                .then(res => res.json())
                .then(data => { showNotification(data.message); refreshSidebar(); })
                .catch(() => showNotification(t('toast_no_server'), true));
        });

        document.getElementById('pirate-btn-update-all').addEventListener('click', () => {
            fetch('http://127.0.0.1:8080/update-all', { method: 'POST' })
                .then(res => res.json())
                .then(data => showNotification(data.message));
        });

        let globalImportInput = document.getElementById('pirate-global-import-input');
        document.getElementById('pirate-btn-global-import').addEventListener('click', () => globalImportInput.click());
        
        globalImportInput.addEventListener('change', (e) => {
            let file = e.target.files[0];
            if (!file) return;
            let reader = new FileReader();
            reader.onload = function(evt) {
                try {
                    let importedMods = JSON.parse(evt.target.result);
                    if (!Array.isArray(importedMods) || importedMods.length === 0) throw new Error("Invalid format");
                    showImportConfigModal(importedMods);
                } catch (err) {
                    showNotification(t('toast_invalid_json'), true);
                }
                globalImportInput.value = '';
            };
            reader.readAsText(file);
        });

        if (sidebarOpenState) { refreshSidebar(); startPolling(); }
    }

    function showImportConfigModal(importedMods) {
        let container = document.getElementById('pirate-mods-container');
        if (!container) return;

        let targetAppId = importedMods[0].appid || getAppId() || "0";
        let targetGameName = importedMods[0].gameName || "Game";
        let modCount = importedMods.length;
        let savedPath = gameSettings[targetAppId]?.customPath || '';

        let modal = document.createElement('div');
        modal.id = 'pirate-import-modal';
        modal.innerHTML = `
            <div class="pirate-modal-box">
                <div class="pirate-modal-title">${t('import_settings')}</div>
                <div class="pirate-modal-text">
                    ${t('import_text', { count: modCount, game: targetGameName })}
                </div>
                <input type="text" class="pirate-input" id="pirate-modal-path-input" placeholder="D:\\Games\\${targetGameName}\\Mods" value="${savedPath}">
                
                <div class="pirate-modal-buttons">
                    <button class="pirate-action-btn" id="pirate-modal-start" style="background: linear-gradient(to bottom, #417a9b 0%, #224c64 100%); border-color: #3d6c8f; color:white;">${t('start_download')}</button>
                    <button class="pirate-action-btn" id="pirate-modal-cancel">${t('cancel')}</button>
                </div>
            </div>
        `;
        container.appendChild(modal);

        modal.querySelector('#pirate-modal-cancel').addEventListener('click', () => modal.remove());

        modal.querySelector('#pirate-modal-start').addEventListener('click', () => {
            let userPath = modal.querySelector('#pirate-modal-path-input').value;
            
            fetch(`http://127.0.0.1:8080/game-settings/${targetAppId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customPath: userPath, gameName: targetGameName })
            })
            .then(() => {
                modal.remove();
                showNotification(t('toast_import_start', { count: modCount }));
                
                importedMods.forEach((mod, index) => {
                    setTimeout(() => {
                        sendToPythonServer(mod.url, {
                            title: mod.title,
                            imageUrl: mod.imageUrl || "",
                            gameName: mod.gameName || targetGameName,
                            appId: mod.appid || targetAppId
                        });
                    }, index * 300);
                });
            })
            .catch(() => showNotification(t('toast_save_path_failed'), true));
        });
    }

    function refreshSidebar() {
        Promise.all([
            fetch('http://127.0.0.1:8080/mods').then(res => res.json()),
            fetch('http://127.0.0.1:8080/game-settings').then(res => res.json())
        ]).then(([modsData, settingsData]) => {
            activeMods = modsData;
            gameSettings = settingsData;
            if (!document.getElementById('pirate-import-modal')) {
                renderSidebarContent();
            }
        }).catch(() => console.log("[Pirate Extension] Error: Python Server is offline."));
    }

    function saveGameSettingsOnServer(appId, gameName, customPath) {
        fetch(`http://127.0.0.1:8080/game-settings/${appId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customPath: customPath, gameName: gameName })
        })
        .then(res => res.json())
        .then(data => { showNotification(t('toast_path_saved', { game: gameName })); refreshSidebar(); })
        .catch(() => showNotification(t('toast_save_path_failed'), true));
    }

    function renderSidebarContent() {
        let container = document.getElementById('pirate-mods-container');
        if (!container) return;
        
        if (document.getElementById('pirate-import-modal')) return;

        let totalCountEl = document.getElementById('pirate-total-count');
        if (totalCountEl) totalCountEl.textContent = `(${activeMods.length})`;

        let activeContainer = document.getElementById('pirate-active-workshop-container');
        if (activeContainer) {
            if (activeAppId) {
                let savedPath = gameSettings[activeAppId]?.customPath || '';
                activeContainer.innerHTML = `
                    <div class="pirate-active-game-box">
                        <div style="font-size:10px; text-transform:uppercase; color:#8f98a0; margin-bottom:4px;">${t('current_workshop')}</div>
                        <div style="font-size:13px; font-weight:bold; color:white; display:flex; align-items:center; gap:6px;">
                            🎮 ${activeGameName} <span style="font-size:10px; color:#66c0f4">(ID: ${activeAppId})</span>
                        </div>
                        <div style="margin-top:8px;">
                            <label style="font-size:10px; color:#66c0f4; display:block; margin-bottom:3px;">${t('extraction_folder')}</label>
                            <div style="display:flex; gap:5px;">
                                <input type="text" class="pirate-input" id="pirate-active-path-input" style="flex:1; font-size:11px;" placeholder="${t('default_path_placeholder')}" value="${savedPath}">
                                <button class="pirate-action-btn" id="pirate-active-path-save" style="flex:none; padding: 6px 10px; font-size:11px;">💾 OK</button>
                            </div>
                        </div>
                    </div>
                `;
                document.getElementById('pirate-active-path-save').addEventListener('click', () => {
                    saveGameSettingsOnServer(activeAppId, activeGameName, document.getElementById('pirate-active-path-input').value);
                });
            } else {
                activeContainer.innerHTML = '';
            }
        }

        container.innerHTML = '';

        let grouped = {};
        activeMods.forEach(mod => {
            if (!grouped[mod.gameName]) grouped[mod.gameName] = [];
            grouped[mod.gameName].push(mod);
        });

        let searchGameInput = document.getElementById('pirate-search-game');
        let searchModInput = document.getElementById('pirate-search-mod');

        if (selectedGame === null) {
            if (searchGameInput) searchGameInput.style.display = 'block';
            if (searchModInput) searchModInput.style.display = 'none';

            let gameQuery = (searchGameInput?.value || '').toLowerCase();
            let filteredGames = Object.keys(grouped).filter(game => game.toLowerCase().includes(gameQuery));

            if (filteredGames.length === 0) {
                container.innerHTML = `<div style="text-align:center; margin-top:20px; color:#66cbff; font-size: 12px;">${t('no_mods_added')}</div>`;
                return;
            }

            filteredGames.forEach(gameName => {
                let gameRow = document.createElement('div');
                gameRow.className = 'pirate-game-row';
                gameRow.innerHTML = `<span>🎮 ${gameName}</span><span style="color: #66c0f4; background: rgba(0,0,0,0.4); padding: 2px 8px; border-radius: 10px; font-size: 11px;">${grouped[gameName].length} ${t('pcs')}</span>`;
                gameRow.addEventListener('click', () => {
                    selectedGame = gameName;
                    if (searchModInput) searchModInput.value = '';
                    renderSidebarContent();
                });
                container.appendChild(gameRow);
            });
        } else {
            if (searchGameInput) searchGameInput.style.display = 'none';
            if (searchModInput) searchModInput.style.display = 'block';

            let backBtn = document.createElement('div');
            backBtn.className = 'pirate-back-btn';
            backBtn.innerHTML = t('back_to_games');
            backBtn.addEventListener('click', () => {
                selectedGame = null;
                if (searchGameInput) searchGameInput.value = '';
                renderSidebarContent();
            });
            container.appendChild(backBtn);

            let gameHeader = document.createElement('div');
            gameHeader.className = 'pirate-game-title';
            gameHeader.innerHTML = `<span>🎮 ${selectedGame}</span> <span style="color:#66c0f4">(${grouped[selectedGame]?.length || 0})</span>`;
            container.appendChild(gameHeader);

            let modsList = grouped[selectedGame] || [];

            let exportBtn = document.createElement('div');
            exportBtn.className = 'pirate-action-btn';
            exportBtn.style.cssText = 'margin-bottom: 12px;';
            exportBtn.innerHTML = t('export_collection');
            exportBtn.addEventListener('click', () => {
                let exportData = modsList.map(m => ({ id: m.id, appid: m.appid, url: m.url, title: m.title, imageUrl: m.imageUrl, gameName: m.gameName }));
                let dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
                let dlAnchorElem = document.createElement('a');
                dlAnchorElem.setAttribute("href", dataStr);
                let safeName = selectedGame.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_').toLowerCase();
                dlAnchorElem.setAttribute("download", `pirate_collection_${safeName}.json`);
                dlAnchorElem.click();
                showNotification(t('toast_collection_saved', { game: selectedGame }));
            });
            container.appendChild(exportBtn);

            let targetAppId = modsList.find(m => m.appid)?.appid || "";
            if (targetAppId) {
                let savedPathForGame = gameSettings[targetAppId]?.customPath || '';
                let configBox = document.createElement('div');
                configBox.style.cssText = 'background:#1b2838; border:1px solid #2a475e; border-radius:4px; padding:10px; margin-bottom:12px;';
                configBox.innerHTML = `
                    <label style="font-size:11px; color:#66c0f4; display:block; margin-bottom:4px;">${t('extraction_folder')} (${selectedGame}):</label>
                    <div style="display:flex; gap:5px;">
                        <input type="text" class="pirate-input" id="pirate-game-path-input" style="flex:1; font-size:11px;" placeholder="${t('default_path_placeholder')}" value="${savedPathForGame}">
                        <button class="pirate-action-btn" id="pirate-game-path-save" style="flex:none; padding: 6px 10px; font-size:11px;">💾 OK</button>
                    </div>
                `;
                container.appendChild(configBox);
                configBox.querySelector('#pirate-game-path-save').addEventListener('click', () => {
                    saveGameSettingsOnServer(targetAppId, selectedGame, configBox.querySelector('#pirate-game-path-input').value);
                });
            }

            let modQuery = (searchModInput?.value || '').toLowerCase();
            let filteredMods = modsList.filter(mod => mod.title.toLowerCase().includes(modQuery));

            if (filteredMods.length === 0) {
                let noMods = document.createElement('div');
                noMods.style.cssText = 'text-align:center; margin-top:20px; color:#66cbff; font-size:12px;';
                noMods.textContent = t('no_mods_found');
                container.appendChild(noMods);
                return;
            }

            filteredMods.forEach(mod => {
                let card = document.createElement('div');
                card.className = 'pirate-mod-card';
                let imgHtml = mod.imageUrl ? `<img class="pirate-mod-card-img" src="${mod.imageUrl}">` : `<div class="pirate-mod-card-img" style="background:#000; display:flex; align-items:center; justify-content:center; color:#555; font-size:20px">📦</div>`;
                let statusDetailsHtml = '';
                if (mod.status === 'downloading' || mod.status === 'updating') {
                    let progressPct = mod.progress || 0;
                    let label = mod.status === 'updating' ? t('updating') : t('downloading');
                    statusDetailsHtml = `<div class="pirate-mod-card-version">${label} ${progressPct.toFixed(1)}%</div><div class="pirate-progress-container"><div class="pirate-progress-bar" style="width: ${progressPct}%"></div></div>`;
                } else if (mod.status === 'pending') {
                    statusDetailsHtml = `<div class="pirate-mod-card-version" style="color: #66c0f4;">${t('queued')}</div>`;
                } else if (mod.status === 'failed') {
                    statusDetailsHtml = `<div class="pirate-mod-card-version" style="color: #ae3838;">${t('error')}</div><div class="pirate-mod-error-text" title="${mod.error || ''}">${mod.error || ''}</div>`;
                } else if (mod.status === 'update_available') {
                    statusDetailsHtml = `<div class="pirate-mod-card-version" style="color: #5cbd5c; font-weight: bold;">${t('update_available')}</div><div class="pirate-mod-error-text" style="color: #66c0f4;" title="${mod.version || ''}">${mod.version || ''}</div>`;
                } else {
                    statusDetailsHtml = `<div class="pirate-mod-card-version" style="color: #4caf50;">${t('ready')}</div><div class="pirate-mod-error-text" style="color: #8f98a0;" title="${mod.version || ''}">${mod.version || ''}</div>`;
                }
                card.innerHTML = `${imgHtml}<div class="pirate-mod-card-info"><div class="pirate-mod-card-title" title="${mod.title}">${mod.title}</div><div class="pirate-mod-card-meta">ID: ${mod.id} | AppID: ${mod.appid || 'unknown'}</div>${statusDetailsHtml}</div><span class="pirate-mod-delete" data-id="${mod.id}" title="${t('delete_mod')}">🗑️</span>`;
                card.querySelector('.pirate-mod-delete').addEventListener('click', function(e) {
                    let mid = this.getAttribute('data-id');
                    e.stopPropagation();
                    fetch(`http://127.0.0.1:8080/mods/${mid}`, { method: 'DELETE' }).then(res => res.json()).then(data => { showNotification(data.message); refreshSidebar(); });
                });
                container.appendChild(card);
            });
        }
    }

    function safeInit() {
        if (window.pirateObserver) window.pirateObserver.disconnect();
        activeAppId = getAppId();
        activeGameName = activeAppId ? getGameName() : null;
        processPageElements();
        buildSidebarUI();
        if (window.pirateObserver) window.pirateObserver.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener('popstate', () => { selectedGame = null; refreshSidebar(); safeInit(); });
    window.addEventListener('pageshow', () => { selectedGame = null; refreshSidebar(); safeInit(); });

    safeInit();
    window.pirateObserver = new MutationObserver(() => safeInit());
    window.pirateObserver.observe(document.body, { childList: true, subtree: true });
})();
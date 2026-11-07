// --- SABİTLER ---
const DEFAULT_CATEGORY = "Genel";
const MIN_TEAMS = 2;
const MAX_TEAMS = 5;
const MAX_SAVED_TEAMS = 30;
const SETTINGS_KEY = 'anime_tabu_settings';
const SAVED_TEAMS_KEY = 'anime_tabu_teams';
const LAST_SETUP_KEY = 'anime_tabu_last_setup';

let selectedTeamCount = 2;
let lastTeamInput = null; // En son dokunulan takım kutusu (kayıtlı takım seçilince oraya yazılır)

// --- LOCALSTORAGE YARDIMCILARI (gizli sekme vb. durumlarda hata vermesin) ---
function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}
function writeJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* kaydedilemezse sessizce geç */ }
}

// --- AYARLAR (Sadece Bu Cihazda Kalır) ---
function getSettings() {
    const defaults = { targetScore: 50, turnDuration: 60, passLimit: 3, vibration: true, sound: true, music: true, volume: 70 };
    const saved = readJSON(SETTINGS_KEY, null);
    // Eski kayıtlarda yeni alanlar yoksa varsayılan değerler devreye girsin
    return saved && typeof saved === 'object' ? Object.assign(defaults, saved) : defaults;
}
function saveSettings(settings) {
    writeJSON(SETTINGS_KEY, settings);
}

// --- TİTREŞİM (destekleyen telefonlarda; iPhone Safari desteklemez, sessizce atlanır) ---
function vibrate(pattern) {
    try {
        if (getSettings().vibration && navigator.vibrate) {
            navigator.vibrate(pattern);
        }
    } catch (e) { /* desteklenmiyorsa geç */ }
}

// --- EKRAN GEÇİŞ YÖNETİMİ ---
// Menü müziği bu ekranlarda çalar; oyun ekranlarında durur (game.js'teki syncMenuMusic kullanır)
const MENU_SCREENS = [
    'main-menu', 'team-setup-screen', 'add-card-screen', 'edit-card-screen', 'pool-screen',
    'leaderboard-screen', 'settings-screen', 'credits-screen', 'admin-login-screen'
];
let currentScreenId = 'splash-screen';

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => screen.style.display = 'none');
    const activeScreen = document.getElementById(screenId);
    if (activeScreen) activeScreen.style.display = 'block';
    window.scrollTo(0, 0); // Telefonda yeni ekran en üstten başlasın

    currentScreenId = screenId;
    if (typeof syncMenuMusic === 'function') syncMenuMusic();
}

// --- METİN YARDIMCILARI ---
// Karşılaştırma için: küçük harf (Türkçe uyumlu), fazla boşlukları temizle
function normalizeText(text) {
    return String(text || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
}

// --- KART YÜKLEME DURUMU ---
// Firebase'den ilk veri gelene kadar "Oyna" butonu kapalı kalır (boş havuz hatasını önler)
function updateCardsStatusUI() {
    const btn = document.getElementById('btn-play');
    if (!btn) return;
    if (!window.cardsLoaded) {
        btn.disabled = true;
        btn.textContent = 'Kartlar yükleniyor...';
    } else {
        btn.disabled = false;
        btn.textContent = 'Oyna';
    }
}

// --- YÖNETİCİ DURUMU ---
// Giriş/çıkış olunca buton yazısını, havuz notunu ve düzenle/sil butonlarını günceller
function updateAdminUI() {
    const btn = document.getElementById('btn-admin');
    if (btn) btn.textContent = window.isAdmin ? 'Yönetici Çıkışı' : 'Yönetici Girişi';

    const note = document.getElementById('pool-admin-note');
    if (note) note.style.display = window.isAdmin ? 'none' : 'block';

    const resetBtn = document.getElementById('btn-leaderboard-reset');
    if (resetBtn) resetBtn.style.display = window.isAdmin ? 'block' : 'none';

    renderPool();
}

function adminLoginErrorMessage(code) {
    switch (code) {
        case 'auth/invalid-credential':
        case 'auth/invalid-login-credentials':
        case 'auth/wrong-password':
            return 'Şifre yanlış!';
        case 'auth/user-not-found':
            return 'Yönetici hesabı bulunamadı. Firebase Authentication ayarlarını kontrol et.';
        case 'auth/too-many-requests':
            return 'Çok fazla yanlış deneme yapıldı. Biraz bekleyip tekrar dene.';
        case 'auth/network-request-failed':
            return 'Bağlantı hatası. İnternetini kontrol et.';
        case 'auth/operation-not-allowed':
            return 'Firebase\'de E-posta/Şifre girişi açık değil.';
        default:
            return 'Giriş yapılamadı.';
    }
}

// Firebase yazma hatalarını anlaşılır şekilde göster
function showWriteError(err, fallback) {
    const denied = err && ((err.code && String(err.code).includes('PERMISSION_DENIED')) ||
                           (err.message && err.message.includes('PERMISSION_DENIED')));
    if (denied) {
        alert(`${fallback} İşlem reddedildi: düzenleme/silme için yönetici girişi gerekir; ekleme için alan uzunluk sınırlarına uymalısın.`);
    } else {
        alert(`${fallback} Bağlantını kontrol et.`);
    }
}

// --- TAKIM KURULUMU (sayı seçimi, kayıtlı takımlar, son kurulum) ---
function getTeamInputs() {
    return [...document.querySelectorAll('.team-name-input')];
}

function defaultTeamName(index) {
    return String.fromCharCode(65 + index) + ' Takımı'; // A Takımı, B Takımı, ...
}

// Takım sayısını seç (2-5); fazla kutuları gizle
function setTeamCount(count) {
    selectedTeamCount = Math.min(MAX_TEAMS, Math.max(MIN_TEAMS, Number(count) || MIN_TEAMS));
    document.querySelectorAll('.count-btn').forEach(btn => {
        btn.classList.toggle('selected', Number(btn.dataset.count) === selectedTeamCount);
    });
    getTeamInputs().forEach((input, index) => {
        input.style.display = index < selectedTeamCount ? '' : 'none';
    });
}

// Kutulardaki yazıları ve takım sayısını okur. names: boş kutular varsayılan isimle dolar
function readTeamSetup() {
    const inputs = getTeamInputs().slice(0, selectedTeamCount);
    const rawNames = inputs.map(input => input.value.replace(/\s+/g, ' ').trim());
    const names = rawNames.map((name, index) => name !== '' ? name : defaultTeamName(index));
    return { count: selectedTeamCount, rawNames, names };
}

// Oyun başlayınca: yazılan takım adlarını kaydet ve son kurulumu hatırla
function saveTeamSetup(setup) {
    addSavedTeams(setup.rawNames.filter(name => name !== ''));
    writeJSON(LAST_SETUP_KEY, { count: setup.count, names: setup.rawNames });
}

// Takım ekranı açılırken son kurulumu geri yükle
function prepareTeamSetup() {
    const last = readJSON(LAST_SETUP_KEY, null);
    const inputs = getTeamInputs();
    inputs.forEach(input => input.value = '');

    if (last && Array.isArray(last.names)) {
        last.names.forEach((name, index) => {
            if (inputs[index] && typeof name === 'string') inputs[index].value = name;
        });
        setTeamCount(last.count);
    } else {
        setTeamCount(selectedTeamCount);
    }
    refreshSavedTeams();
}

function getSavedTeams() {
    const list = readJSON(SAVED_TEAMS_KEY, []);
    return Array.isArray(list) ? list.filter(name => typeof name === 'string' && name.trim() !== '') : [];
}

function addSavedTeams(names) {
    const list = getSavedTeams();
    names.forEach(name => {
        const key = normalizeText(name);
        const existing = list.findIndex(n => normalizeText(n) === key);
        if (existing !== -1) list.splice(existing, 1); // En başa taşı
        list.unshift(name);
    });
    writeJSON(SAVED_TEAMS_KEY, list.slice(0, MAX_SAVED_TEAMS));
    refreshSavedTeams();
}

function clearSavedTeams() {
    try {
        localStorage.removeItem(SAVED_TEAMS_KEY);
        localStorage.removeItem(LAST_SETUP_KEY);
    } catch (e) { /* geç */ }
    refreshSavedTeams();
}

// Kayıtlı takımları dokunulabilir etiketler olarak göster
function refreshSavedTeams() {
    const wrap = document.getElementById('saved-teams-wrap');
    const box = document.getElementById('saved-teams');
    if (!wrap || !box) return;

    const saved = getSavedTeams().slice(0, 12);
    box.innerHTML = '';
    wrap.style.display = saved.length ? 'block' : 'none';

    saved.forEach(name => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = name; // textContent: güvenli
        chip.addEventListener('click', () => fillTeamName(name));
        box.appendChild(chip);
    });
}

// Etikete dokununca ilk boş kutuya yaz; hepsi doluysa son dokunulan kutunun yerine geç
function fillTeamName(name) {
    const inputs = getTeamInputs().slice(0, selectedTeamCount);
    let target = inputs.find(input => input.value.trim() === '');
    if (!target) target = inputs.includes(lastTeamInput) ? lastTeamInput : inputs[0];
    target.value = name;
}

// --- SIRALAMA SATIRI (liderlik tablosu ve final sıralaması ortak kullanır) ---
function buildRankRow({ rank, name, sub, main, mainSub, highlight }) {
    const row = document.createElement('div');
    row.className = 'rank-row' + (highlight ? ' rank-first' : '');

    const pos = document.createElement('div');
    pos.className = 'rank-pos';
    pos.textContent = rank;

    const info = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'rank-name';
    nameEl.textContent = name;
    info.appendChild(nameEl);
    if (sub) {
        const subEl = document.createElement('div');
        subEl.className = 'rank-sub';
        subEl.textContent = sub;
        info.appendChild(subEl);
    }

    const value = document.createElement('div');
    value.className = 'rank-value';
    const mainEl = document.createElement('div');
    mainEl.className = 'rank-main';
    mainEl.textContent = main;
    value.appendChild(mainEl);
    if (mainSub) {
        const mainSubEl = document.createElement('div');
        mainSubEl.className = 'rank-sub';
        mainSubEl.textContent = mainSub;
        value.appendChild(mainSubEl);
    }

    row.appendChild(pos);
    row.appendChild(info);
    row.appendChild(value);
    return row;
}

// --- LİDERLİK TABLOSU ---
// Kayıtlı oyunlardan takım başına galibiyet / beraberlik / puan hesaplar
function computeLeaderboard(games) {
    const table = new Map();
    const ordered = [...games].sort((a, b) => (a.ts || 0) - (b.ts || 0));

    ordered.forEach(game => {
        const top = Math.max(...game.teams.map(t => t.score));
        const winners = game.teams.filter(t => t.score === top);

        game.teams.forEach(team => {
            const key = normalizeText(team.name); // "akatsuki" ve "Akatsuki" aynı takım
            if (!table.has(key)) {
                table.set(key, { name: team.name, games: 0, wins: 0, draws: 0, points: 0 });
            }
            const row = table.get(key);
            row.name = team.name; // En son yazımı göster
            row.games++;
            row.points += team.score;
            if (team.score === top) {
                if (winners.length === 1) row.wins++;
                else row.draws++;
            }
        });
    });

    return [...table.values()].sort((a, b) =>
        b.wins - a.wins ||
        b.draws - a.draws ||
        b.points - a.points ||
        a.games - b.games ||
        a.name.localeCompare(b.name, 'tr')
    );
}

function renderLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    const note = document.getElementById('leaderboard-note');
    if (!list || !note) return;
    list.innerHTML = '';

    if (window.gamesError) {
        note.textContent = 'Liderlik tablosu yüklenemedi. Firebase kurallarını kontrol et.';
        return;
    }
    if (!window.gamesLoaded) {
        note.textContent = 'Yükleniyor...';
        return;
    }

    const games = window.globalGames || [];
    const rows = computeLeaderboard(games);

    if (rows.length === 0) {
        note.textContent = 'Henüz kayıtlı oyun yok. İlk oyunu sen oyna!';
        return;
    }
    note.textContent = `${games.length} oyun, ${rows.length} takım`;

    const medals = ['🥇', '🥈', '🥉'];
    rows.forEach((row, index) => {
        const subParts = [`${row.games} oyun`, `${row.points} puan`];
        if (row.draws > 0) subParts.push(`${row.draws} beraberlik`);

        list.appendChild(buildRankRow({
            rank: medals[index] || String(index + 1),
            name: row.name,
            sub: subParts.join(' · '),
            main: String(row.wins),
            mainSub: 'galibiyet',
            highlight: index === 0
        }));
    });
}

// Oyun sonu sıralaması: puana göre azalan, eşit puan aynı sırayı alır
function renderFinalStandings(teams) {
    const box = document.getElementById('final-standings');
    if (!box) return;
    box.innerHTML = '';

    const sorted = [...teams].sort((a, b) => b.score - a.score);
    const top = sorted.length ? sorted[0].score : 0;
    let rank = 0;
    let previousScore = null;

    sorted.forEach((team, index) => {
        if (team.score !== previousScore) rank = index + 1;
        previousScore = team.score;

        box.appendChild(buildRankRow({
            rank: String(rank),
            name: team.name,
            sub: team.score === top ? 'Kazanan' : '',
            main: String(team.score),
            mainSub: 'puan',
            highlight: team.score === top
        }));
    });
}

// --- KATEGORİ YÖNETİMİ ---
// Havuzdaki kategoriler ve her birindeki kart sayısı
function getCategoryCounts() {
    const counts = new Map();
    (window.globalCards || []).forEach(card => {
        const cat = card.category || DEFAULT_CATEGORY;
        counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    return new Map([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr')));
}

// Kullanıcının yazdığı kategoriyi temizler; zaten varsa aynı yazımı kullanır (naruto / Naruto ayrı sayılmasın)
function resolveCategory(rawCategory) {
    const cleaned = String(rawCategory || '').replace(/\s+/g, ' ').trim();
    if (cleaned === '') return DEFAULT_CATEGORY;
    const existing = [...getCategoryCounts().keys()].find(cat => normalizeText(cat) === normalizeText(cleaned));
    return existing || cleaned;
}

// Kart ekle/düzenle öneri listesini ve oyun başlangıcındaki kategori menüsünü günceller
function refreshCategoryUI() {
    const counts = getCategoryCounts();

    // 1. Kart ekleme/düzenleme ekranlarındaki öneri listesi (datalist)
    const datalist = document.getElementById('category-list');
    if (datalist) {
        datalist.innerHTML = '';
        counts.forEach((count, cat) => {
            const option = document.createElement('option');
            option.value = cat;
            datalist.appendChild(option);
        });
    }

    // 2. Takım kurulum ekranındaki kategori seçimi
    const select = document.getElementById('game-category');
    if (select) {
        const previous = select.value;
        select.innerHTML = '';

        const total = (window.globalCards || []).length;
        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = `Tüm Kategoriler (${total})`;
        select.appendChild(allOption);

        counts.forEach((count, cat) => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = `${cat} (${count})`;
            select.appendChild(option);
        });

        // Önceki seçim hâlâ varsa koru
        if ([...select.options].some(opt => opt.value === previous)) {
            select.value = previous;
        }
    }
}

// --- KART DOĞRULAMA (boş alan, kopya kart, tekrarlayan yasaklı kelime) ---
// Hata varsa mesajı döndürür, sorun yoksa null
function validateCard(mainWord, forbiddenWords, excludeId) {
    if (!mainWord || forbiddenWords.length < 5) {
        return 'Lütfen ana kelimeyi ve 5 yasaklı kelimenin tamamını doldurun!';
    }

    const normalizedMain = normalizeText(mainWord);

    // Aynı ana kelimeyle başka kart var mı? (düzenlerken kendisi hariç)
    const duplicate = (window.globalCards || []).find(card =>
        card.id !== excludeId && normalizeText(card.word) === normalizedMain
    );
    if (duplicate) {
        return `"${duplicate.word}" kartı havuzda zaten var! (Kategori: ${duplicate.category})`;
    }

    // Yasaklı kelimeler birbirinden ve ana kelimeden farklı olmalı
    const seen = new Set();
    for (const word of forbiddenWords) {
        const normalized = normalizeText(word);
        if (normalized === normalizedMain) {
            return 'Yasaklı kelimelerden biri ana kelimeyle aynı olamaz!';
        }
        if (seen.has(normalized)) {
            return `"${word}" yasaklı kelimesi birden fazla kez yazılmış!`;
        }
        seen.add(normalized);
    }
    return null;
}

// --- KART HAVUZU (Buluttan Çekilir ve XSS'e Karşı Güvenlidir) ---
function renderPool() {
    const poolContainer = document.getElementById('card-list');
    if (!poolContainer) return;
    poolContainer.innerHTML = '';

    const allCards = window.globalCards || [];

    // Arama: kelime, yasaklı kelimeler veya kategori içinde geçiyorsa göster
    const searchInput = document.getElementById('pool-search');
    const query = normalizeText(searchInput ? searchInput.value : '');
    const cards = allCards
        .filter(card => {
            if (!query) return true;
            const haystack = [card.word, card.category, ...(card.forbidden || [])]
                .map(normalizeText)
                .join(' | ');
            return haystack.includes(query);
        })
        .sort((a, b) => a.word.localeCompare(b.word, 'tr'));

    const countLabel = document.getElementById('pool-count');
    if (countLabel) {
        countLabel.textContent = query
            ? `${cards.length} / ${allCards.length} kart gösteriliyor`
            : `Toplam ${allCards.length} kart`;
    }

    if (cards.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'pool-empty';
        empty.textContent = query ? 'Eşleşen kart bulunamadı.' : 'Havuzda henüz kart yok.';
        poolContainer.appendChild(empty);
        return;
    }

    cards.forEach((card) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'pool-item';

        // Sol taraf: kelime + kategori (textContent ile güvenli basım)
        const info = document.createElement('div');
        info.className = 'pool-item-info';

        const wordSpan = document.createElement('span');
        wordSpan.textContent = card.word;

        const categoryTag = document.createElement('div');
        categoryTag.className = 'pool-category';
        categoryTag.textContent = card.category || DEFAULT_CATEGORY;

        info.appendChild(wordSpan);
        info.appendChild(categoryTag);
        cardDiv.appendChild(info);

        // Düzenle/Sil sadece yöneticiye gösterilir (asıl koruma Firebase kurallarında)
        if (window.isAdmin) {
            const btnGroup = document.createElement('div');
            btnGroup.className = 'pool-item-buttons';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn-edit';
            editBtn.setAttribute('data-id', card.id);
            editBtn.textContent = 'Düzenle';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-delete';
            deleteBtn.setAttribute('data-id', card.id);
            deleteBtn.textContent = 'Sil';

            btnGroup.appendChild(editBtn);
            btnGroup.appendChild(deleteBtn);
            cardDiv.appendChild(btnGroup);
        }

        poolContainer.appendChild(cardDiv);
    });

    // Silme Butonları Dinleyicisi
    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Yanlışlıkla silmelere karşı basit bir onay penceresi
            if (confirm("Bu kartı silmek istediğine emin misin?")) {
                const id = e.target.getAttribute('data-id');
                window.deleteCardFromDatabase(id).catch((err) => {
                    showWriteError(err, 'Kart silinemedi!');
                });
            }
        });
    });

    // Düzenle Butonları Dinleyicisi
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            const cardToEdit = window.globalCards.find(c => c.id === id);

            if (cardToEdit) {
                window.currentEditCardId = id; // Hangi kartı düzenlediğimizi global hafızaya alıyoruz

                // Ekrandaki inputları mevcut verilerle doldur
                document.getElementById('edit-main-word').value = cardToEdit.word;
                document.getElementById('edit-category').value = cardToEdit.category || DEFAULT_CATEGORY;
                const editInputs = document.querySelectorAll('.edit-forbidden');
                editInputs.forEach((input, index) => {
                    input.value = (cardToEdit.forbidden || [])[index] || '';
                });

                showScreen('edit-card-screen');
            }
        });
    });
}

// --- MÜZİK VE SES KAYNAKLARI EKRANI ---
// music.js'teki şarkılardan başlığı yazılmış olanları listeler (CC BY lisansı için yapımcı adı gerekir)
function renderCredits() {
    const list = document.getElementById('credits-list');
    if (!list) return;
    list.innerHTML = '';

    const allSongs = [
        ...(typeof VICTORY_SONGS !== 'undefined' ? VICTORY_SONGS : []),
        ...(typeof MENU_SONGS !== 'undefined' ? MENU_SONGS : [])
    ];
    const songs = allSongs.filter(song => song.title);
    if (songs.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'pool-empty';
        empty.textContent = 'Henüz kaynak gösterilmesi gereken bir müzik eklenmedi.';
        list.appendChild(empty);
        return;
    }

    songs.forEach(song => {
        const item = document.createElement('div');
        item.className = 'credit-item';

        const title = document.createElement('div');
        title.className = 'rank-name';
        title.textContent = song.artist ? `${song.title} - ${song.artist}` : song.title;
        item.appendChild(title);

        const details = [song.source, song.license].filter(Boolean).join(' · ');
        if (details) {
            const sub = document.createElement('div');
            sub.className = 'rank-sub';
            sub.textContent = details;
            item.appendChild(sub);
        }
        list.appendChild(item);
    });
}

// --- BUTON DİNLEYİCİLERİ ---
document.addEventListener('DOMContentLoaded', () => {

    updateCardsStatusUI();
    refreshCategoryUI();
    updateAdminUI();
    renderLeaderboard();
    setTeamCount(2);
    refreshSavedTeams();

    // Giriş ekranı -> ana menü
    document.getElementById('btn-splash-start').addEventListener('click', () => {
        // Bu dokunuş sayesinde tarayıcı sesi başlatmaya izin verir; menü müziği buradan itibaren çalabilir
        if (typeof allowMenuMusic === 'function') allowMenuMusic();
        showScreen('main-menu');
    });

    // Yönetici girişi / çıkışı
    document.getElementById('btn-admin').addEventListener('click', () => {
        if (window.isAdmin) {
            window.adminLogout().then(() => alert('Yönetici oturumu kapatıldı.'));
        } else {
            document.getElementById('admin-password').value = '';
            showScreen('admin-login-screen');
        }
    });

    const adminLogin = () => {
        const password = document.getElementById('admin-password').value;
        if (!password) {
            alert('Lütfen şifreyi yaz.');
            return;
        }
        if (typeof window.adminLogin !== 'function') {
            alert('Bağlantı henüz hazır değil, birkaç saniye sonra tekrar dene.');
            return;
        }
        window.adminLogin(password)
            .then(() => {
                document.getElementById('admin-password').value = '';
                alert('Yönetici girişi yapıldı!');
                showScreen('main-menu');
            })
            .catch((err) => alert(adminLoginErrorMessage(err && err.code)));
    };
    document.getElementById('btn-admin-login').addEventListener('click', adminLogin);
    document.getElementById('admin-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') adminLogin();
    });

    // Menü Geçişleri
    document.getElementById('btn-play').addEventListener('click', () => {
        refreshCategoryUI();
        prepareTeamSetup();
        showScreen('team-setup-screen');
    });
    document.getElementById('btn-add-card').addEventListener('click', () => showScreen('add-card-screen'));
    document.getElementById('btn-pool').addEventListener('click', () => {
        document.getElementById('pool-search').value = '';
        renderPool();
        showScreen('pool-screen');
    });
    document.getElementById('btn-leaderboard').addEventListener('click', () => {
        renderLeaderboard();
        showScreen('leaderboard-screen');
    });

    // Liderlik tablosunu sıfırla (sadece yönetici; asıl kontrol Firebase kurallarında)
    document.getElementById('btn-leaderboard-reset').addEventListener('click', () => {
        if (confirm('Tüm liderlik tablosu kalıcı olarak silinecek. Emin misin?')) {
            window.clearLeaderboard().catch((err) => showWriteError(err, 'Tablo sıfırlanamadı!'));
        }
    });

    // Takım sayısı seçimi (2-5) ve takım kutuları
    document.querySelectorAll('.count-btn').forEach(btn => {
        btn.addEventListener('click', () => setTeamCount(btn.dataset.count));
    });
    getTeamInputs().forEach(input => {
        input.addEventListener('focus', () => { lastTeamInput = input; });
    });

    // Havuzda arama (her harf yazıldığında listeyi süz)
    document.getElementById('pool-search').addEventListener('input', renderPool);

    document.getElementById('btn-settings').addEventListener('click', () => {
        const settings = getSettings();
        document.getElementById('target-score').value = settings.targetScore;
        document.getElementById('turn-duration').value = settings.turnDuration;
        document.getElementById('pass-limit').value = settings.passLimit;
        document.getElementById('vibration-enabled').checked = !!settings.vibration;
        document.getElementById('sound-enabled').checked = !!settings.sound;
        document.getElementById('music-enabled').checked = !!settings.music;
        document.getElementById('volume-level').value = settings.volume;
        document.getElementById('volume-value').textContent = settings.volume;
        showScreen('settings-screen');
    });

    // Tüm Geri ve Ana Sayfa Butonları
    document.querySelectorAll('.btn-back, .btn-home').forEach(btn => {
        btn.addEventListener('click', () => showScreen('main-menu'));
    });

    // Kart düzenleme ekranından Geri: ana menü yerine havuza dön
    document.getElementById('btn-edit-back').addEventListener('click', () => {
        renderPool();
        showScreen('pool-screen');
    });

    // 1. Yeni Kartı Buluta Kaydetme
    document.getElementById('btn-save-card').addEventListener('click', () => {
        const mainWordInput = document.getElementById('input-main-word');
        const forbiddenInputs = document.querySelectorAll('.input-forbidden');
        const mainWord = mainWordInput.value.trim();
        const category = resolveCategory(document.getElementById('input-category').value);
        const forbiddenWords = [];

        forbiddenInputs.forEach(input => {
            if (input.value.trim() !== '') forbiddenWords.push(input.value.trim());
        });

        const error = validateCard(mainWord, forbiddenWords, null);
        if (error) {
            alert(error);
            return;
        }

        window.saveCardToDatabase(mainWord, forbiddenWords, category)
            .then(() => {
                // Formu temizle (kategori kalsın: aynı diziden art arda kart eklemek kolaylaşır)
                mainWordInput.value = '';
                forbiddenInputs.forEach(input => input.value = '');
                alert('Kart Firebase havuzuna eklendi! Tüm cihazlarda anında görünecek.');
            })
            .catch((err) => {
                showWriteError(err, 'Kart kaydedilemedi!');
            });
    });

    // 2. Düzenlenen Kartı Buluta Kaydetme
    document.getElementById('btn-update-card').addEventListener('click', () => {
        const mainWord = document.getElementById('edit-main-word').value.trim();
        const category = resolveCategory(document.getElementById('edit-category').value);
        const forbiddenInputs = document.querySelectorAll('.edit-forbidden');
        const forbiddenWords = [];

        forbiddenInputs.forEach(input => {
            if (input.value.trim() !== '') forbiddenWords.push(input.value.trim());
        });

        // Kendi kartı kopya sayılmasın diye düzenlenen kartın ID'si hariç tutulur
        const error = validateCard(mainWord, forbiddenWords, window.currentEditCardId);
        if (error) {
            alert(error);
            return;
        }

        window.editCardInDatabase(window.currentEditCardId, mainWord, forbiddenWords, category)
            .then(() => {
                alert('Kart güncellendi!');
                renderPool();
                showScreen('pool-screen'); // Otomatik olarak havuza geri dön
            })
            .catch((err) => {
                showWriteError(err, 'Kart güncellenemedi!');
            });
    });

    // 3. Ayarları Kaydetme
    document.getElementById('btn-save-settings').addEventListener('click', () => {
        const targetScore = parseInt(document.getElementById('target-score').value);
        const turnDuration = parseInt(document.getElementById('turn-duration').value);
        const passLimit = parseInt(document.getElementById('pass-limit').value);
        const vibration = document.getElementById('vibration-enabled').checked;
        const sound = document.getElementById('sound-enabled').checked;
        const music = document.getElementById('music-enabled').checked;
        const volume = Math.max(0, Math.min(100, parseInt(document.getElementById('volume-level').value) || 0));

        if (targetScore > 0 && turnDuration > 0 && passLimit >= 0) {
            saveSettings({ targetScore, turnDuration, passLimit, vibration, sound, music, volume });
            vibrate(60); // Açıksa küçük bir deneme titreşimi
            if (typeof refreshMenuMusic === 'function') refreshMenuMusic(); // Müzik/ses ayarı hemen uygulansın
            alert('Oyun ayarları kaydedildi!');
        } else {
            alert('Hedef puan ve tur süresi 0\'dan büyük, pas hakkı 0 veya daha büyük olmalı!');
        }
    });

    // Ses seviyesi göstergesi ve deneme
    document.getElementById('volume-level').addEventListener('input', (e) => {
        document.getElementById('volume-value').textContent = e.target.value;
    });
    document.getElementById('btn-test-sound').addEventListener('click', () => {
        // Kaydetmeden, kaydırıcıdaki seviyeyle dene (ses kapalı olsa bile çalar)
        const options = { force: true, volume: Number(document.getElementById('volume-level').value) };
        playSfx('correct', options);
        setTimeout(() => playSfx('pass', options), 600);
        setTimeout(() => playSfx('taboo', options), 1000);
    });

    // Müzik ve ses kaynakları
    document.getElementById('btn-credits').addEventListener('click', () => {
        renderCredits();
        showScreen('credits-screen');
    });
    document.getElementById('btn-credits-back').addEventListener('click', () => showScreen('settings-screen'));

    // 4. Kayıtlı takımları temizle
    document.getElementById('btn-clear-teams').addEventListener('click', () => {
        if (confirm('Bu cihazdaki kayıtlı takım isimleri silinecek. Emin misin?')) {
            clearSavedTeams();
            alert('Kayıtlı takımlar temizlendi.');
        }
    });
});

// --- OYUN İÇİ ARAYÜZ GÜNCELLEMELERİ (game.js kullanır) ---
// 2-5 takımın skor kutularını çizer; sırası gelen takım vurgulanır
function renderScoreboard(teams, activeIndex) {
    const board = document.getElementById('scoreboard');
    board.innerHTML = '';
    board.classList.toggle('compact', teams.length >= 4);

    teams.forEach((team, index) => {
        const box = document.createElement('div');
        box.className = 'score-box' + (index === activeIndex ? ' active' : '');

        const nameEl = document.createElement('span');
        nameEl.className = 'score-team';
        nameEl.textContent = team.name;

        const valueEl = document.createElement('span');
        valueEl.className = 'score-value';
        valueEl.textContent = team.score;

        box.appendChild(nameEl);
        box.appendChild(valueEl);
        board.appendChild(box);
    });
}
function updateActiveTeamUI(teamName) {
    document.getElementById('active-team-display').innerText = teamName + " Oynuyor";
}
function updateTimeUI(time) {
    const timeEl = document.getElementById('time-left');
    timeEl.innerText = time;
    // Son 10 saniyede uyarı rengi
    timeEl.classList.toggle('time-warning', time > 0 && time <= 10);
}
// passLimit 0 ise sınırsız pas; değilse kalan hakkı yazar ve bitince butonu kapatır
function updatePassUI(passesLeft, passLimit) {
    const btn = document.getElementById('btn-pass');
    if (passLimit > 0) {
        btn.textContent = `Pas (${passesLeft})`;
        btn.disabled = passesLeft <= 0;
    } else {
        btn.textContent = 'Pas';
        btn.disabled = false;
    }
}

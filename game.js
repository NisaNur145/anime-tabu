// --- OYUN DEĞİŞKENLERİ ---
let teams = [];            // [{ name, score }] (2-5 takım)
let activeTeam = 0;        // Sırası gelen takımın dizideki yeri
let saveResultToBoard = true; // Oyun sonucu liderlik tablosuna yazılsın mı?
let resultSaved = false;      // Aynı oyun iki kez kaydedilmesin
let timeLeft = 60;
let timerInterval = null;
let isPaused = false;
let endTime = 0;       // Turun biteceği an (Date.now tabanlı, sayaç kaymasın diye)
let remainingMs = 0;   // Duraklatınca kalan süre
let currentDeck = [];
let lastCardId = null;   // Son gösterilen kart (deste yenilenince hemen tekrar gelmesin)
let currentCard = null;   // Ekranda gösterilen kart
let targetScore = 50;
let turnDuration = 60;
let passLimit = 3;        // Tur başına pas hakkı (0 = sınırsız)
let equalTurns = true;    // Hedef puana ulaşılsa da herkes eşit sayıda tur oynasın
let passesLeft = 3;
let selectedCategories = []; // Seçilen kategoriler (boş = hepsi)
let turnLog = [];          // Turda oynanan kartlar: { word, points }
let victoryAudio = null;
let menuAudio = null;          // Menü müziği (menü ekranlarında döngüyle çalar)
let menuMusicAllowed = false;  // Giriş ekranındaki dokunuştan sonra true olur
let menuSongQueue = null;      // Menü şarkıları, sırayla denenir
let wakeLock = null;       // Oyun sırasında telefon ekranı kapanmasın
let wakeLockPending = false;

// Tur özetindeki sonuç etiketleri
const RESULT_TEXT = { "1": "Doğru", "-1": "Tabu", "0": "Pas" };
const RESULT_CLASS = { "1": "result-correct", "-1": "result-taboo", "0": "result-pass" };
const RESULT_CYCLE = [1, -1, 0]; // Özet ekranında dokunuldukça bu sırayla değişir

// Titreşim kalıpları (milisaniye)
const VIBRATE_CORRECT = 40;
const VIBRATE_TABOO = [70, 50, 70];
const VIBRATE_PASS = 25;
const VIBRATE_TICK = 30;
const VIBRATE_TIME_UP = [300, 100, 300];
const VIBRATE_VICTORY = [100, 50, 100, 50, 300];

// --- OYUNU BAŞLATMA VE TAKIM KURULUMU ---
document.addEventListener('DOMContentLoaded', () => {

    // Takım kurulum ekranından oyuna geçiş
    document.getElementById('btn-start-game').addEventListener('click', () => {
        // ui.js'ten takım sayısı ve isimleri al (boş kutular A Takımı, B Takımı... olur)
        const setup = readTeamSetup();

        const keys = setup.names.map(normalizeText);
        if (new Set(keys).size !== keys.length) {
            alert('Takım isimleri birbirinden farklı olmalı!');
            return;
        }

        // ui.js içinden ayarları çek
        const settings = getSettings();
        targetScore = settings.targetScore;
        turnDuration = settings.turnDuration;
        passLimit = settings.passLimit;
        equalTurns = settings.equalTurns !== false;

        // Seçilen kategori (boşsa tüm kartlar)
        selectedCategories = [...chosenCategories]; // ui.js'teki seçim
        saveResultToBoard = document.getElementById('save-to-leaderboard').checked;

        // Firebase'den veri gelmediyse ya da okunamadıysa başlatma
        if (window.cardsError) {
            alert("Kartlar yüklenemedi. İnternet bağlantını ve Firebase ayarlarını kontrol et.");
            return;
        }
        if (!window.cardsLoaded) {
            alert("Kartlar henüz yüklenmedi, birkaç saniye bekleyip tekrar dene.");
            return;
        }

        // Havuzda kart yoksa oyunu BAŞLATMA (Çökmeyi engeller)
        if (!loadAndShuffleDeck()) {
            return;
        }

        // Oyun gerçekten başlıyor: takımları kur, adları ve son kurulumu hatırla
        teams = setup.names.map(name => ({ name: name, score: 0 }));
        activeTeam = 0;
        resultSaved = false;
        saveTeamSetup(setup);

        showReadyScreen("Oyun başlıyor!");
    });

    // "Hazır mısınız?" ekranındaki Başla butonu
    document.getElementById('btn-ready-start').addEventListener('click', () => {
        showScreen('game-screen');
        startTurn();
    });

    // Hazır ekranından çıkış
    document.getElementById('btn-ready-quit').addEventListener('click', quitGame);

    // Oyun İçi Butonları Dinleme
    document.getElementById('btn-correct').addEventListener('click', () => handleAnswer(1));
    document.getElementById('btn-taboo').addEventListener('click', () => handleAnswer(-1));
    document.getElementById('btn-pass').addEventListener('click', () => handleAnswer(0));

    // Duraklat / Devam / Çıkış
    document.getElementById('btn-pause').addEventListener('click', pauseGame);
    document.getElementById('btn-resume').addEventListener('click', resumeGame);
    document.getElementById('btn-quit').addEventListener('click', quitGame);
    document.getElementById('btn-pause-quit').addEventListener('click', quitGame);

    // Tur özeti ekranı
    document.getElementById('btn-summary-continue').addEventListener('click', finishSummary);
    document.getElementById('btn-summary-quit').addEventListener('click', quitGame);

    // Sekme arka plana geçerse oyunu otomatik duraklat (hile ve haksız süre kaybını önler)
    document.addEventListener('visibilitychange', () => {
        const gameScreen = document.getElementById('game-screen');
        if (document.hidden && gameScreen.style.display === 'block' && !isPaused && timerInterval) {
            pauseGame();
        }
    });

    // Sekme arka plana geçince menü müziğini sustur, dönünce menüdeyse devam ettir
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) pauseMenuMusic();
        else syncMenuMusic();
    });

    // Rövanş ve Ana Sayfa
    document.getElementById('btn-rematch').addEventListener('click', () => {
        stopMusic();
        teams.forEach(team => team.score = 0);
        activeTeam = 0;
        resultSaved = false;
        if (!loadAndShuffleDeck()) return;
        showReadyScreen("Rövanş başlıyor!");
    });

    document.querySelectorAll('.btn-home').forEach(btn => {
        btn.addEventListener('click', () => {
            stopMusic();
            clearInterval(timerInterval);
            releaseWakeLock();
        });
    });
});

// --- YARDIMCILAR ---
function activeTeamName() {
    return teams[activeTeam] ? teams[activeTeam].name : '';
}

// "Akatsuki 12 • Gotei 13 8 • ..." şeklinde skor satırı
function formatScores() {
    return teams.map(team => `${team.name} ${team.score}`).join('  •  ');
}

// --- EKRANIN KAPANMASINI ENGELLE (destekleyen tarayıcılarda) ---
async function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock || wakeLockPending) return;
    wakeLockPending = true;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) {
        wakeLock = null; // Desteklenmiyor ya da reddedildi: sorun değil
    } finally {
        wakeLockPending = false;
    }
}

function releaseWakeLock() {
    try {
        if (wakeLock) wakeLock.release();
    } catch (e) { /* geç */ }
    wakeLock = null;
}

// --- "HAZIR MISINIZ?" EKRANI ---
function showReadyScreen(message) {
    clearInterval(timerInterval);
    timerInterval = null;
    isPaused = false;
    hidePauseOverlay();
    releaseWakeLock();

    document.getElementById('ready-message').textContent = message;
    document.getElementById('ready-team-name').textContent = activeTeamName();
    document.getElementById('ready-scores').textContent = formatScores();

    showScreen('ready-screen');
}

// --- DURAKLATMA VE ÇIKIŞ ---
function pauseGame() {
    if (isPaused) return;
    isPaused = true;
    remainingMs = Math.max(0, endTime - Date.now()); // Kalan süreyi sakla
    clearInterval(timerInterval);
    timerInterval = null;
    releaseWakeLock();
    document.getElementById('pause-overlay').style.display = 'flex';
}

function resumeGame() {
    if (!isPaused) return;
    isPaused = false;
    hidePauseOverlay();
    runTimer();
}

function hidePauseOverlay() {
    document.getElementById('pause-overlay').style.display = 'none';
}

function quitGame() {
    if (!confirm("Oyundan çıkmak istediğine emin misin? Mevcut oyun kaybolacak.")) return;
    clearInterval(timerInterval);
    timerInterval = null;
    isPaused = false;
    currentCard = null;
    hidePauseOverlay();
    releaseWakeLock();
    stopMusic();
    showScreen('main-menu');
}

// --- KART VE DESTE YÖNETİMİ ---
// Seçili kategoriye uyan kartlar
function getPlayableCards() {
    const allCards = window.globalCards || [];
    if (selectedCategories.length === 0) return allCards;
    return allCards.filter(card => selectedCategories.includes(card.category));
}

function loadAndShuffleDeck() {
    const playable = getPlayableCards();

    // Güvenlik: Kart yoksa uyarı ver ve işlemi durdur
    if (playable.length === 0) {
        if (selectedCategories.length > 0) {
            alert(`Seçtiğin kategorilerde (${selectedCategories.join(', ')}) hiç kart yok! Başka bir kategori seç ya da kart ekle.`);
            showScreen('team-setup-screen');
        } else {
            alert("Firebase havuzunda hiç kart yok! Lütfen önce kart ekleyin.");
            showScreen('main-menu');
        }
        return false;
    }

    // Fisher-Yates karıştırma (eşit dağılım sağlar)
    currentDeck = [...playable];
    for (let i = currentDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [currentDeck[i], currentDeck[j]] = [currentDeck[j], currentDeck[i]];
    }

    // Deste yenilenince az önce gösterilen kart hemen tekrar gelmesin
    const lastIndex = currentDeck.length - 1;
    if (currentDeck.length > 1 && lastCardId && currentDeck[lastIndex].id === lastCardId) {
        [currentDeck[0], currentDeck[lastIndex]] = [currentDeck[lastIndex], currentDeck[0]];
    }
    return true;
}

function drawNextCard() {
    if (currentDeck.length === 0) {
        if (!loadAndShuffleDeck()) {
            // Kartlar oyun sırasında silindiyse oyunu güvenle durdur
            clearInterval(timerInterval);
            timerInterval = null;
            currentCard = null;
            releaseWakeLock();
            return;
        }
    }

    const card = currentDeck.pop();
    if (!card) return; // Fazladan güvenlik
    currentCard = card;
    lastCardId = card.id;

    // Ekrana bas
    document.getElementById('display-main-word').textContent = card.word; // XSS Yaması
    const forbiddenList = document.getElementById('display-forbidden-words');
    forbiddenList.innerHTML = '';

    (card.forbidden || []).forEach(word => {
        const li = document.createElement('li');
        li.textContent = word; // XSS Yaması
        forbiddenList.appendChild(li);
    });
}

// --- TUR VE ZAMANLAYICI MANTIĞI ---
function startTurn() {
    clearInterval(timerInterval);
    isPaused = false;
    hidePauseOverlay();

    timeLeft = turnDuration;
    remainingMs = turnDuration * 1000;
    turnLog = [];
    passesLeft = passLimit;

    updateTimeUI(timeLeft);
    renderScoreboard(teams, activeTeam);
    updateActiveTeamUI(activeTeamName());
    updatePassUI(passesLeft, passLimit);

    drawNextCard();
    runTimer();
}

// Sayaç ayrı bir fonksiyonda: hem tur başında hem "Devam Et"te kullanılır
function runTimer() {
    clearInterval(timerInterval);
    requestWakeLock();
    endTime = Date.now() + remainingMs;
    timerInterval = setInterval(() => {
        // Süreyi saat farkından hesapla: yavaşlayan/arka plandaki sekmede de kaymaz
        const secondsLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
        if (secondsLeft !== timeLeft) {
            timeLeft = secondsLeft;
            updateTimeUI(timeLeft);
            // Son 3 saniyede kısa titreşimle uyar
            if (timeLeft > 0 && timeLeft <= 3) { vibrate(VIBRATE_TICK); playSfx('tick'); }
        }

        if (timeLeft <= 0) {
            endTurn(true);
        }
    }, 200);
}

// Tur biter (süre doldu) -> özet ekranı
function endTurn(timedOut) {
    clearInterval(timerInterval);
    timerInterval = null;
    isPaused = false;
    currentCard = null;
    hidePauseOverlay();
    releaseWakeLock();
    if (timedOut) { vibrate(VIBRATE_TIME_UP); playSfx('timeup'); }
    showSummaryScreen();
}

// --- PUANLAMA ---
function addScore(points) {
    teams[activeTeam].score += points;
}

function handleAnswer(pointType) {
    if (isPaused || !currentCard) return; // Duraklatılmışken ya da tur bittiyse işlenmesin

    // Pas hakkı kontrolü
    if (pointType === 0 && passLimit > 0) {
        if (passesLeft <= 0) return;
        passesLeft--;
        updatePassUI(passesLeft, passLimit);
    }

    // Özet ekranında göstermek için kaydet
    turnLog.push({ word: currentCard.word, points: pointType });

    addScore(pointType);
    renderScoreboard(teams, activeTeam);

    // Dokunma geri bildirimi
    if (pointType === 1) { vibrate(VIBRATE_CORRECT); playSfx('correct'); }
    else if (pointType === -1) { vibrate(VIBRATE_TABOO); playSfx('taboo'); }
    else { vibrate(VIBRATE_PASS); playSfx('pass'); }

    // Hedef puana ulaşılsa bile tur süre dolana kadar devam eder (oyunun bitip bitmeyeceğine tur sonunda bakılır)
    drawNextCard();
}

// --- TUR ÖZETİ ---
function targetReached() {
    return teams.some(team => team.score >= targetScore);
}

// Oyun şimdi bitmeli mi? Hedefe ulaşıldıysa ve (eşit tur kapalıysa ya da son takımın turuysa) evet.
// Eşit tur açıkken tur dönüşü bitmeden oyun kesilmez, böylece her takım aynı sayıda tur oynar.
function shouldEndGame() {
    if (!targetReached()) return false;
    if (!equalTurns) return true;
    return activeTeam === teams.length - 1;
}

function showSummaryScreen() {
    document.getElementById('summary-team-name').textContent = activeTeamName();
    renderSummaryList();
    showScreen('summary-screen');
}

function renderSummaryList() {
    const list = document.getElementById('summary-list');
    const scrollPos = list.scrollTop; // Düzeltme yapınca liste başa kaymasın
    list.innerHTML = '';

    if (turnLog.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'summary-empty';
        empty.textContent = 'Bu turda hiç kart oynanmadı.';
        list.appendChild(empty);
    }

    turnLog.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'summary-item';

        const wordSpan = document.createElement('span');
        wordSpan.textContent = entry.word; // XSS'e karşı güvenli

        // Sonuç rozeti: dokununca Doğru -> Tabu -> Pas -> Doğru şeklinde değişir
        const badge = document.createElement('button');
        badge.className = 'summary-result ' + RESULT_CLASS[entry.points];
        badge.textContent = RESULT_TEXT[entry.points];
        badge.addEventListener('click', () => cycleResult(entry));

        row.appendChild(wordSpan);
        row.appendChild(badge);
        list.appendChild(row);
    });

    list.scrollTop = scrollPos;

    const turnTotal = turnLog.reduce((sum, entry) => sum + entry.points, 0);
    document.getElementById('summary-turn-score').textContent =
        `Bu tur: ${turnTotal > 0 ? '+' : ''}${turnTotal} puan`;
    document.getElementById('summary-total').textContent = formatScores();
    document.getElementById('btn-summary-continue').textContent =
        shouldEndGame() ? 'Sonucu Gör' : 'Sıradaki Takıma Geç';
}

// Yanlış basılan sonucu düzelt: puanı farkı kadar ayarla
function cycleResult(entry) {
    const nextIndex = (RESULT_CYCLE.indexOf(entry.points) + 1) % RESULT_CYCLE.length;
    const newPoints = RESULT_CYCLE[nextIndex];

    addScore(newPoints - entry.points);
    entry.points = newPoints;

    renderSummaryList();
}

// Özet onaylandı: hedef puana ulaşıldıysa oyun biter, yoksa sıra bir sonraki takıma geçer
function finishSummary() {
    if (shouldEndGame()) {
        endGame();
        return;
    }
    const reachedAlready = targetReached(); // Hedefe ulaşıldı ama tur dönüşü bitmedi
    activeTeam = (activeTeam + 1) % teams.length;
    showReadyScreen(reachedAlready
        ? "Hedef puana ulaşıldı! Herkes eşit tur oynasın diye tur tamamlanıyor. Sıradaki takım hazırlansın!"
        : "Sıradaki takım hazırlansın!");
}

function endGame() {
    clearInterval(timerInterval);
    timerInterval = null;
    hidePauseOverlay();
    releaseWakeLock();
    showScreen('victory-screen');

    // En yüksek puanlı takım(lar) kazanır; eşitlik varsa beraberlik
    const topScore = Math.max(...teams.map(team => team.score));
    const winners = teams.filter(team => team.score === topScore);
    const winnerText = winners.length === 1
        ? `Kazanan: ${winners[0].name}!`
        : `Beraberlik: ${winners.map(team => team.name).join(', ')}!`;
    document.getElementById('winner-text').innerText = winnerText;

    renderFinalStandings(teams);
    saveResultOnce();

    vibrate(VIBRATE_VICTORY);
    playVictoryMusic();
}

// Sonucu liderlik tablosuna yaz (aynı oyun için bir kez)
function saveResultOnce() {
    const note = document.getElementById('victory-save-note');
    note.textContent = '';

    if (!saveResultToBoard || resultSaved || typeof window.saveGameResult !== 'function') return;
    resultSaved = true;

    note.textContent = 'Sonuç liderlik tablosuna kaydediliyor...';
    window.saveGameResult(teams)
        .then(() => { note.textContent = 'Sonuç liderlik tablosuna kaydedildi.'; })
        .catch(() => { note.textContent = 'Sonuç kaydedilemedi. Bağlantını ve Firebase kurallarını kontrol et.'; });
}

// --- MÜZİK YÖNETİMİ ---
// Kazanma ekranında music.js'teki şarkılardan rastgele birini çalar.
// Dosya bulunamazsa sıradakini dener; hiçbiri çalmazsa kodla üretilen zafer melodisi çalar.
function playVictoryMusic() {
    stopMusic();

    const prefs = getSettings();
    if (!prefs.music) {
        playSfx('victory'); // Müzik kapalıysa sadece kısa melodi (efektler açıksa)
        return;
    }

    // Şarkıları karıştır, sırayla dene
    const queue = [...VICTORY_SONGS];
    for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    const tryNext = () => {
        if (queue.length === 0) {
            playSfx('victory');
            return;
        }

        const song = queue.shift();
        const audio = new Audio(MUSIC_FOLDER + song.file);
        audio.volume = soundVolume();
        victoryAudio = audio;

        // currentTime ancak dosya bilgisi yüklendikten sonra güvenle ayarlanabilir
        audio.addEventListener('loadedmetadata', () => {
            // Dosya yüklenirken müzik durdurulduysa (rövanş, ana sayfa) çalmaya başlama
            if (victoryAudio !== audio) return;
            const start = Number(song.start) || 0;
            audio.currentTime = Number.isFinite(audio.duration) && start < audio.duration - 5 ? start : 0;
            audio.play().catch(() => {
                if (victoryAudio === audio) playSfx('victory'); // Tarayıcı engellerse melodiye dön
            });

            // song.end varsa o saniyede dururken sesi yumuşakça kıs (fade-out)
            const end = Number(song.end) || 0;
            if (end > audio.currentTime + 1) {
                const baseVolume = audio.volume;
                const fadeSeconds = 1.5;
                const fadeTimer = setInterval(() => {
                    if (victoryAudio !== audio) { clearInterval(fadeTimer); return; }
                    const remaining = end - audio.currentTime;
                    if (remaining <= 0) {
                        clearInterval(fadeTimer);
                        audio.pause();
                    } else if (remaining < fadeSeconds) {
                        audio.volume = Math.max(0, baseVolume * (remaining / fadeSeconds));
                    }
                }, 100);
            }
        });

        // Dosya yoksa ya da bozuksa sıradaki şarkıyı dene
        audio.addEventListener('error', () => {
            if (victoryAudio === audio) tryNext();
        });
    };

    tryNext();
}

function stopMusic() {
    if (victoryAudio) {
        victoryAudio.pause();
        victoryAudio.currentTime = 0;
        victoryAudio = null;
    }
}

// --- MENÜ MÜZİĞİ ---
// Ana menü ve menü ekranlarında çalar, oyun ekranlarında (hazır, oyun, özet, kazanma) durur.
function menuVolume() {
    return soundVolume() * 0.6; // Menü müziği kazanma müziğinden biraz kısık
}

function allowMenuMusic() {
    menuMusicAllowed = true;
}

// Şu anki ekrana göre menü müziğini başlat ya da duraklat
function syncMenuMusic() {
    if (typeof MENU_SCREENS !== 'undefined' && MENU_SCREENS.includes(currentScreenId)) {
        startMenuMusic();
    } else {
        pauseMenuMusic();
    }
}

function startMenuMusic() {
    if (!menuMusicAllowed || document.hidden) return;
    if (!getSettings().music || typeof MENU_SONGS === 'undefined' || MENU_SONGS.length === 0) {
        pauseMenuMusic();
        return;
    }

    // Daha önce çalıyorsa kaldığı yerden devam et
    if (menuAudio) {
        menuAudio.volume = Math.min(1, menuVolume());
        tryPlayMenu(menuAudio);
        return;
    }

    if (!menuSongQueue) {
        menuSongQueue = [...MENU_SONGS];
        for (let i = menuSongQueue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [menuSongQueue[i], menuSongQueue[j]] = [menuSongQueue[j], menuSongQueue[i]];
        }
    }
    if (menuSongQueue.length === 0) return; // Hiçbir dosya çalınamadı, sessiz kal

    const song = menuSongQueue.shift();
    const audio = new Audio(MUSIC_FOLDER + song.file);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = Math.min(1, menuVolume());
    menuAudio = audio;

    audio.addEventListener('loadedmetadata', () => {
        if (menuAudio !== audio) return;
        const start = Number(song.start) || 0;
        if (start > 0 && Number.isFinite(audio.duration) && start < audio.duration - 5) audio.currentTime = start;
    });

    // Dosya yoksa ya da bozuksa sıradaki menü şarkısını dene
    audio.addEventListener('error', () => {
        console.warn('Menü müziği yüklenemedi:', MUSIC_FOLDER + song.file, audio.error);
        if (menuAudio !== audio) return;
        menuAudio = null;
        startMenuMusic();
    });

    // Dokunuşun içinde hemen çal (Safari/iOS yalnızca böyle izin verir)
    tryPlayMenu(audio);
}

// Çalmayı dener; tarayıcı engellerse bir sonraki dokunuşta tekrar dener
function tryPlayMenu(audio) {
    const p = audio.play();
    if (p && p.catch) {
        p.catch(err => {
            console.warn('Menü müziği başlatılamadı:', err && err.name);
            const retry = () => {
                if (menuAudio === audio && MENU_SCREENS.includes(currentScreenId) && !document.hidden && getSettings().music) {
                    audio.play().catch(() => {});
                }
            };
            document.addEventListener('pointerdown', retry, { once: true });
        });
    }
}

function pauseMenuMusic() {
    if (menuAudio) menuAudio.pause();
}

// Ayarlar kaydedilince: müzik kapandıysa sustur, açıksa/ses değiştiyse uygula
function refreshMenuMusic() {
    if (menuAudio) menuAudio.volume = Math.min(1, menuVolume());
    syncMenuMusic();
}

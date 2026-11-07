import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getDatabase, ref, onValue, push, remove, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBmVGGiCj6g_Shxo4oiD65YTfunMRMUiww",
  authDomain: "anime-tabu.firebaseapp.com",
  projectId: "anime-tabu",
  storageBucket: "anime-tabu.firebasestorage.app",
  messagingSenderId: "272769700977",
  appId: "1:272769700977:web:90c0a3ae796f39408af7d0"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// Yönetici hesabının e-postası. Firebase Console > Authentication > Users kısmında
// BU e-posta ile bir kullanıcı oluştur; kullanıcılar sadece şifreyi yazar.
// (Gerçek bir e-posta olması şart değil, ama konsoldakiyle birebir aynı olmalı.)
const ADMIN_EMAIL = "admin@anime-tabu.com";

// Kategorisi olmayan (eski) kartlar için varsayılan kategori
const DEFAULT_CATEGORY = "Genel";

// Tüm cihazlarda anlık senkronize olacak havuz
window.globalCards = [];
window.cardsLoaded = false; // İlk veri gelene kadar false (oyun başlatma buna bakar)
window.cardsError = false;  // Okuma hatası olursa true
window.isAdmin = false;     // Yönetici girişi yapıldı mı?

// Liderlik tablosu için kayıtlı oyunlar
window.globalGames = [];
window.gamesLoaded = false;
window.gamesError = false;

// --- KART HAVUZUNU DİNLE ---
const cardsRef = ref(db, 'cards');
onValue(cardsRef, (snapshot) => {
    const cards = [];
    snapshot.forEach((child) => {
        const data = child.val();

        // Bozuk / boş kayıtları atla (oyunu çökertmesinler)
        if (!data || typeof data.word !== 'string' || data.word.trim() === '') {
            return;
        }

        // Firebase diziyi bazen nesne olarak döndürür; ikisini de destekle
        const rawForbidden = Array.isArray(data.forbidden)
            ? data.forbidden
            : (data.forbidden ? Object.values(data.forbidden) : []);
        const forbidden = rawForbidden.filter(w => typeof w === 'string' && w.trim() !== '');

        cards.push({
            id: child.key, // Firebase'in atadığı benzersiz ID
            word: data.word,
            forbidden: forbidden,
            category: data.category || DEFAULT_CATEGORY
        });
    });

    window.globalCards = cards;
    window.cardsLoaded = true;
    window.cardsError = false;
    notifyUI();
}, (error) => {
    // Okuma reddedildi ya da bağlantı kurulamadı
    console.error("Kartlar okunamadı:", error);
    window.cardsLoaded = true;
    window.cardsError = true;
    notifyUI();
});

// Arayüze "veri değişti" haberi ver (ui.js fonksiyonları varsa)
function notifyUI() {
    if (typeof updateCardsStatusUI === "function") updateCardsStatusUI();
    if (typeof refreshCategoryUI === "function") refreshCategoryUI();
    if (typeof renderPool === "function") renderPool();
}

// --- KAYITLI OYUNLARI DİNLE (liderlik tablosu bunlardan hesaplanır) ---
const gamesRef = ref(db, 'games');
onValue(gamesRef, (snapshot) => {
    const games = [];
    snapshot.forEach((child) => {
        const data = child.val();
        if (!data) return;

        // teams dizi ya da nesne olarak gelebilir
        const rawTeams = Array.isArray(data.teams) ? data.teams : (data.teams ? Object.values(data.teams) : []);
        const teams = rawTeams
            .filter(t => t && typeof t.name === 'string' && t.name.trim() !== '' && Number.isFinite(t.score))
            .map(t => ({ name: t.name, score: t.score }));

        if (teams.length < 2) return; // Geçersiz kayıt

        games.push({ id: child.key, ts: Number(data.ts) || 0, teams: teams });
    });

    window.globalGames = games;
    window.gamesLoaded = true;
    window.gamesError = false;
    if (typeof renderLeaderboard === "function") renderLeaderboard();
}, (error) => {
    console.error("Liderlik tablosu okunamadı:", error);
    window.gamesLoaded = true;
    window.gamesError = true;
    if (typeof renderLeaderboard === "function") renderLeaderboard();
});

// --- YÖNETİCİ GİRİŞİ (Firebase Authentication) ---
onAuthStateChanged(auth, (user) => {
    window.isAdmin = !!user;
    if (typeof updateAdminUI === "function") updateAdminUI();
});

window.adminLogin = function(password) {
    return signInWithEmailAndPassword(auth, ADMIN_EMAIL, password);
};

window.adminLogout = function() {
    return signOut(auth);
};

// --- KART İŞLEMLERİ ---
// Hepsi Promise döndürür; hata yakalama ui.js'te.
// Ekleme herkese açık, düzenleme ve silme sadece yönetici (kurallar sunucuda uygulanır).
window.saveCardToDatabase = function(mainWord, forbiddenArray, category) {
    return push(cardsRef, {
        word: mainWord,
        forbidden: forbiddenArray,
        category: category || DEFAULT_CATEGORY
    });
};

window.deleteCardFromDatabase = function(cardId) {
    return remove(ref(db, 'cards/' + cardId));
};

window.editCardInDatabase = function(cardId, mainWord, forbiddenArray, category) {
    const cardRef = ref(db, 'cards/' + cardId);
    return update(cardRef, {
        word: mainWord,
        forbidden: forbiddenArray,
        category: category || DEFAULT_CATEGORY
    });
};

// --- LİDERLİK TABLOSU İŞLEMLERİ ---
// Oyun bitince sonucu kaydeder (herkes ekleyebilir, silme/sıfırlama sadece yönetici)
window.saveGameResult = function(teams) {
    return push(gamesRef, {
        ts: serverTimestamp(),
        teams: teams.map(t => ({ name: t.name, score: t.score }))
    });
};

// Tüm kayıtlı oyunları siler (sadece yönetici)
window.clearLeaderboard = function() {
    return remove(gamesRef);
};

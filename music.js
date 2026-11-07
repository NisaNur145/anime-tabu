// --- KAZANMA MÜZİKLERİ ---
// Şarkı dosyalarını assets/sounds/music/ klasörüne koy ve aşağıdaki listeye ekle.
// Kazanan belli olunca bu listeden RASTGELE biri çalar. Dosya bulunamazsa sıradakine geçilir,
// hiçbiri çalmazsa kısa bir zafer melodisi çalar.
//
//   file   : dosya adı (assets/sounds/music/ içinde)
//   start  : kaçıncı saniyeden başlasın (0 = baştan)
//   end    : kaçıncı saniyede dursun (isteğe bağlı; yoksa şarkı sonuna kadar çalar, bitişte yumuşakça kısılır)
//   title, artist, source, license : "Müzik ve Ses Kaynakları" ekranında görünür.
//            title boş bırakılırsa o şarkı kaynaklar ekranında gösterilmez.
//            Lisansı "CC BY" olan parçalarda yapımcı adı ve kaynak yazmak zorunludur.
const MUSIC_FOLDER = 'assets/sounds/music/';

const VICTORY_SONGS = [
    // title/artist/source/license'ı doldurursan "Müzik ve Ses Kaynakları" ekranında görünür
    { file: 'timesup.mp3', start: 33, title: '', artist: '', source: 'pixabay.com', license: 'Pixabay License' }
];

// --- MENÜ MÜZİĞİ ---
// Giriş "Başla" butonuna basıldıktan sonra ana menüde ve diğer menü ekranlarında çalar, oyun başlayınca durur.
// Menüye dönünce (ana sayfa, oyundan çıkış) kaldığı yerden devam eder. Kısa ve döngüye uygun, sakin bir parça seç.
// Dosya yoksa menü müziği sessizce atlanır. Alanlar VICTORY_SONGS ile aynı (end burada kullanılmaz).
const MENU_SONGS = [
    { file: 'anamenu.mp3', start: 0, title: '', artist: '', source: '', license: '' }
];

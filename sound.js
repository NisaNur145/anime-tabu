// --- SES EFEKTLERİ (Web Audio ile kodla üretilir: ses dosyası yok, telif sorunu yok) ---
let audioCtx = null;

// Tarayıcılar sesi bir dokunuştan sonra başlatır; ilk dokunuşta ses motorunu hazırla
function getAudioCtx() {
    try {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            audioCtx = new AC();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    } catch (e) {
        return null;
    }
}
['pointerdown', 'touchstart', 'keydown'].forEach(evt => {
    document.addEventListener(evt, getAudioCtx, { passive: true });
});

// 0-100 arası ses seviyesini kulağa doğal gelen bir eğriye çevirir (0-1)
function soundVolume(override) {
    let level = override && override.volume !== undefined ? override.volume : getSettings().volume;
    level = Number(level);
    if (!Number.isFinite(level)) level = 70;
    level = Math.max(0, Math.min(100, level)) / 100;
    return level * level;
}

// Tek bir nota/ses çalar
function tone(opts, vol) {
    const ctx = getAudioCtx();
    if (!ctx || vol <= 0) return;

    const freq = opts.freq;
    const start = opts.start || 0;
    const dur = opts.dur || 0.15;
    const type = opts.type || 'sine';
    const gain = opts.gain !== undefined ? opts.gain : 0.4;

    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);

    // Ani "çıt" sesi olmasın diye hızlı yükselen, yumuşak sönen zarf
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * vol), t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
}

// Efekt tanımları: her biri birkaç notadan oluşur
const SOUNDS = {
    // Doğru: iki notalı yükselen "ding-ding"
    correct: [
        { freq: 784, dur: 0.12, type: 'triangle', gain: 0.5 },
        { freq: 1175, start: 0.1, dur: 0.3, type: 'triangle', gain: 0.5 }
    ],
    // Tabu: alçalan, hırıltılı "bzzzt"
    taboo: [
        { freq: 196, dur: 0.18, type: 'sawtooth', gain: 0.28, slideTo: 150 },
        { freq: 165, start: 0.2, dur: 0.34, type: 'sawtooth', gain: 0.28, slideTo: 110 }
    ],
    // Pas: yumuşak, kısa, alçalan "tık-tuk"
    pass: [
        { freq: 520, dur: 0.07, type: 'sine', gain: 0.4 },
        { freq: 390, start: 0.07, dur: 0.1, type: 'sine', gain: 0.35 }
    ],
    // Son saniyeler: kısa tik
    tick: [
        { freq: 900, dur: 0.05, type: 'square', gain: 0.14 }
    ],
    // Süre bitti: üç bip + uzun alçak nota
    timeup: [
        { freq: 880, dur: 0.15, type: 'triangle', gain: 0.5 },
        { freq: 880, start: 0.2, dur: 0.15, type: 'triangle', gain: 0.5 },
        { freq: 880, start: 0.4, dur: 0.15, type: 'triangle', gain: 0.5 },
        { freq: 440, start: 0.62, dur: 0.6, type: 'triangle', gain: 0.55 }
    ],
    // Zafer melodisi (müzik kapalıysa ya da şarkı çalınamazsa)
    victory: [
        { freq: 523, dur: 0.16, type: 'triangle', gain: 0.45 },
        { freq: 659, start: 0.14, dur: 0.16, type: 'triangle', gain: 0.45 },
        { freq: 784, start: 0.28, dur: 0.16, type: 'triangle', gain: 0.45 },
        { freq: 1047, start: 0.42, dur: 0.7, type: 'triangle', gain: 0.5 },
        { freq: 659, start: 0.42, dur: 0.7, type: 'sine', gain: 0.3 },
        { freq: 784, start: 0.42, dur: 0.7, type: 'sine', gain: 0.3 }
    ]
};

// Efekti çalar. override.force: ayarlardaki "kapalı" seçimini yok say (Sesi Dene için)
function playSfx(name, override) {
    try {
        if (!(override && override.force) && !getSettings().sound) return;
        const parts = SOUNDS[name];
        if (!parts) return;
        const vol = soundVolume(override);
        parts.forEach(part => tone(part, vol));
    } catch (e) { /* ses çalınamazsa oyun etkilenmesin */ }
}

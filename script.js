// DOM Elements
const btnSimulate = document.getElementById('btn-simulate');
const btnAccept = document.getElementById('btn-accept');
const btnDecline = document.getElementById('btn-decline');
const btnHangup = document.getElementById('btn-hangup');
const modalIncoming = document.getElementById('incoming-modal');
const activeControls = document.getElementById('active-controls');
const transcriptBox = document.getElementById('transcript-box');
const statusText = document.getElementById('call-status-text');
const timerElement = document.getElementById('timer');
const waveform = document.getElementById('waveform');
const deptBadges = document.querySelectorAll('.dept-badge');
const intentDisplay = document.getElementById('intent-text');
const moodText = document.getElementById('mood-text');
const moodBar = document.getElementById('mood-bar');

// Global State
let isCallActive = false;
let callStartTime = null;
let timerInterval = null;
let currentAgent = 'reception'; // reception, sales, marketing, refunds, inventory
let recognition;
let synth = window.speechSynthesis;

// Configuration: Department Personas
const AGENTS = {
    reception: {
        name: "Jessica (Reception)",
        greeting: "Hello, thank you for calling AI Connect. How can I direct your call today?",
        voiceRate: 1.0,
        voicePitch: 1.0,
        keywords: []
    },
    sales: {
        name: "David (Sales)",
        greeting: "Hi there! Welcome to the Sales department. Looking for our latest collection?",
        voiceRate: 1.1, // Slightly faster, energetic
        voicePitch: 1.0,
        keywords: ['buy', 'price', 'cost', 'offer', 'discount', 'sale', 'shirt', 'pant']
    },
    marketing: {
        name: "Sarah (Marketing)",
        greeting: "Hello! Marketing here. How can we help promote your brand?",
        voiceRate: 1.0,
        voicePitch: 1.2, // Higher pitch
        keywords: ['ad', 'promotion', 'campaign', 'brand']
    },
    refunds: {
        name: "Michael (Support)",
        greeting: "I apologize for any inconvenience. I'm here to help with your return or refund.",
        voiceRate: 0.9, // Slower, empathetic
        voicePitch: 0.9,
        keywords: ['return', 'refund', 'money', 'back', 'broken', 'damage', 'wrong']
    },
    inventory: {
        name: "Rob (Stock)",
        greeting: "Inventory control. Please state the item code you are checking.",
        voiceRate: 1.0,
        voicePitch: 0.8, // Deeper
        keywords: ['stock', 'available', 'inventory', 'quantity', 'size']
    }
};

// --- Initialization ---
function init() {
    // Browser Check
    const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
    if (!isChrome) {
        alert("CRITICAL WARNING: This app ONLY works in Google Chrome / Edge. Please switch browser.");
        addLog("Error: Non-Chrome browser detected.", 'system');
    }

    setupSpeechRecognition();
    btnSimulate.addEventListener('click', startIncomingCall);
    btnAccept.addEventListener('click', acceptCall);
    btnDecline.addEventListener('click', endCall);
    btnHangup.addEventListener('click', endCall);

    // Add diagnostics button dynamically
    const diagBtn = document.createElement('button');
    diagBtn.innerText = "🛠 Test Mic & Audio";
    diagBtn.className = "btn secondary";
    diagBtn.style.marginTop = "10px";
    diagBtn.onclick = runDiagnostics;
    activeControls.parentElement.appendChild(diagBtn);
}

function runDiagnostics() {
    addLog("--- Starting Diagnostics ---", 'system');

    // 1. Check Synthesis
    if ('speechSynthesis' in window) {
        addLog("✔ Text-to-Speech supported.", 'system');
        try {
            const u = new SpeechSynthesisUtterance("System check.");
            synth.speak(u);
            addLog("✔ Sent audio command.", 'system');
        } catch (e) {
            addLog("❌ Speech Output failed: " + e.message, 'system');
        }
    } else {
        addLog("❌ Text-to-Speech NOT supported.", 'system');
    }

    // 2. Check Recognition
    if ('webkitSpeechRecognition' in window) {
        addLog("✔ Speech Recognition supported.", 'system');
        try {
            recognition.start();
            addLog("Checking Mic permissions... Speak now.", 'system');
        } catch (e) {
            addLog("❌ Mic Start failed (might be already running): " + e.message, 'system');
        }
    } else {
        addLog("❌ Speech Recognition NOT supported.", 'system');
    }
}

// --- Voice Recognition Setup ---
function setupSpeechRecognition() {
    if ('webkitSpeechRecognition' in window) {
        recognition = new webkitSpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            console.log("Recognition started");
            waveform.classList.remove('hidden');
            addLog("✔ Mic Active (Listening)", 'system');
        };

        recognition.onend = () => {
            console.log("Recognition ended");
            waveform.classList.add('hidden');
            // Restart logic is handled in restartMic() to avoid duplicate code
            if (isCallActive) restartMic();
        };

        recognition.onerror = (event) => {
            console.error("Error", event.error);
            if (event.error === 'not-allowed') {
                alert("MICROPHONE BLOCKED. Please click the 'Lock' icon in URL bar -> Site Settings -> Allow Microphone.");
                addLog("❌ Mic Blocked by User/Browser.", 'system');
            } else if (event.error === 'no-speech') {
                // Ignore
            } else {
                addLog("❌ Mic Error: " + event.error, 'system');
            }
        };

        recognition.onresult = (event) => {
            const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase();
            console.log("Heard:", transcript);
            addLog(`User: "${transcript}"`, 'customer');
            processUserSpeech(transcript);
        };
    } else {
        alert("Web Speech API not supported.");
    }
}

// Helper to safely restart mic
function restartMic() {
    setTimeout(() => {
        if (isCallActive) {
            try { recognition.start(); } catch (e) { }
        }
    }, 1000);
}

// --- Voice Synthesis Setup ---
// Ensure voices are loaded (fixes empty voice list on some browsers)
window.speechSynthesis.onvoiceschanged = () => {
    const voices = window.speechSynthesis.getVoices();
    console.log(`Voices loaded: ${voices.length}`);
};

// --- Call Logic ---

function startIncomingCall() {
    modalIncoming.classList.remove('hidden');
    addLog("Incoming Call... Click Answer.", 'system');
}

function acceptCall() {
    isCallActive = true;
    modalIncoming.classList.add('hidden');
    btnSimulate.classList.add('hidden');
    activeControls.classList.remove('hidden');
    statusText.innerText = "Connected";
    statusText.style.color = "var(--accent-success)";

    callStartTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);
    switchDepartment('reception');
    addLog("Call Connected.", "system");

    // CRITICAL FIX: Trigger Audio & Mic IMMEDIATELY within the click handler
    // This preserves the 'User Gesture' security token.

    // 1. Speak greeting
    if (synth.speaking) synth.cancel();
    speak(AGENTS['reception'].greeting);

    // 2. Start Mic immediately (don't wait for speech to end, can handle overlaps)
    try {
        recognition.start();
    } catch (e) {
        console.warn("Mic start error:", e);
    }
}

function processUserSpeech(text) {
    // 1. Analyze Sentiment (simple keyword check)
    analyzeSentiment(text);

    // 2. Analyze Intent & Routing
    const targetDept = detectIntent(text);

    // 3. Response Logic
    setTimeout(() => {
        if (targetDept && targetDept !== currentAgent) {
            // Switch Department
            speak(`Please hold while I transfer you to ${targetDept}.`);
            addLog(`Transferring to ${targetDept}...`, 'system');

            setTimeout(() => {
                switchDepartment(targetDept);
                speak(AGENTS[targetDept].greeting);
            }, 3000);
        } else {
            // Stay in current department, generic response
            generateResponse(text);
        }
    }, 1000);
}

function detectIntent(text) {
    // Check keywords for all departments EXCEPT current one (to avoid re-routing to self unnecessary, though maybe useful)
    for (const [dept, data] of Object.entries(AGENTS)) {
        if (dept === 'reception') continue;
        if (data.keywords.some(keyword => text.includes(keyword))) {
            return dept;
        }
    }
    return null;
}

function generateResponse(text) {
    // Simple mock logic for now
    let response = "";
    if (currentAgent === 'reception') {
        response = "I see. Could you please clarify if this is for sales, a refund, or stock checking?";
    } else if (currentAgent === 'sales') {
        response = "That matches our new collection perfectly. Would you like to place an order?";
    } else if (currentAgent === 'refunds') {
        response = "I understand. I've noted that. Please provide your Order ID.";
    } else {
        response = "I heard you. Let me check our detailed records.";
    }
    speak(response);
}

function speak(text) {
    if (synth.speaking) synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const agentData = AGENTS[currentAgent];

    utterance.rate = agentData.voiceRate;
    utterance.pitch = agentData.voicePitch;

    // Try to select a different voice if available (not reliable across all browsers)
    const voices = synth.getVoices();
    // Simple heuristic: pick female for reception/marketing, male for others if possible
    // This is highly browser dependent

    addLog(text, 'agent');
    synth.speak(utterance);
}

// --- Helper Functions ---

function switchDepartment(dept) {
    currentAgent = dept;

    // Update UI
    deptBadges.forEach(b => b.classList.remove('active'));
    document.getElementById(`dept-${dept}`).classList.add('active');

    intentDisplay.innerText = `Routed to: ${dept.charAt(0).toUpperCase() + dept.slice(1)}`;
}

function analyzeSentiment(text) {
    const negativeWords = ['angry', 'bad', 'slow', 'stupid', 'wrong', 'late', 'hate'];
    const positiveWords = ['good', 'great', 'thanks', 'happy', 'fast', 'love'];

    let score = 50; // Neutral start

    if (negativeWords.some(w => text.includes(w))) {
        score = 20; // Bad mood
        updateMood("Frustrated", score, "var(--accent-danger)");
    } else if (positiveWords.some(w => text.includes(w))) {
        score = 80; // Good mood
        updateMood("Happy", score, "var(--accent-success)");
    } else {
        updateMood("Neutral", 50, "var(--accent-warning)");
    }
}

function updateMood(label, score, color) {
    moodText.innerText = label;
    moodBar.style.width = `${score}%`;
    moodBar.style.backgroundColor = color;
}

function addLog(message, type) {
    const div = document.createElement('div');
    div.classList.add('message', type);
    div.innerText = message;
    transcriptBox.appendChild(div);
    transcriptBox.scrollTop = transcriptBox.scrollHeight;

    // Add to side log
    if (type !== 'system') {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${type === 'agent' ? 'AI' : 'User'}:</strong> ${message.substring(0, 20)}...`;
        document.getElementById('activity-log').prepend(li);
    }
}

function updateTimer() {
    const delta = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = Math.floor(delta / 60).toString().padStart(2, '0');
    const secs = (delta % 60).toString().padStart(2, '0');
    timerElement.innerText = `${mins}:${secs}`;
}

function endCall() {
    isCallActive = false;
    clearInterval(timerInterval);
    if (recognition) recognition.stop();
    synth.cancel();

    modalIncoming.classList.add('hidden');
    activeControls.classList.add('hidden');
    btnSimulate.classList.remove('hidden');
    statusText.innerText = "Call Ended";
    statusText.style.color = "var(--text-muted)";
    waveform.classList.add('hidden');

    addLog("Call Disconnected.", "system");
}

// Start
init();

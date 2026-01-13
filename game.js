// ============================================
// SUPABASE CONFIGURATION
// ============================================
const SUPABASE_URL = 'https://qlwtovkrmfoqfgrtynrv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsd3RvdmtybWZvcWZncnR5bnJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyNzE4NTksImV4cCI6MjA4Mzg0Nzg1OX0.XMPhSftpLtTeM3gTS0Acf6DrFuI_H0U-iAfxAas9n8Y';

// Initialize Supabase client
let supabase;
let currentUser = null;

// Game state
const defaultGameState = {
    news: 0,
    bruh: 0,
    buildings: [
        { id: 0, name: "Paperboy", baseCost: 15, baseCPS: 0.5, count: 0 },
        { id: 1, name: "Editor", baseCost: 100, baseCPS: 4, count: 0 },
        { id: 2, name: "Printing Press", baseCost: 1100, baseCPS: 12, count: 0 },
        { id: 3, name: "Distribution Van", baseCost: 12000, baseCPS: 45, count: 0 },
        { id: 4, name: "News Tower", baseCost: 130000, baseCPS: 160, count: 0 },
        { id: 5, name: "Media Empire", baseCost: 1400000, baseCPS: 850, count: 0 }
    ],
    lastUpdate: Date.now(),
    version: "2.0.0",
    playerName: "",
    chatNotifications: true,
    boostProgress: 0,
    isBoostActive: false,
    boostTimeLeft: 0,
    boostCooldown: 0,
    boostMultiplier: 1,
    lastDepletionTime: Date.now()
};

let gameState = JSON.parse(JSON.stringify(defaultGameState));
let chatMessages = [];
let leaderboardData = [];
let isInitialized = false;

// ============================================
// INITIALIZATION
// ============================================
async function initializeSupabase() {
    // Load Supabase client
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/@supabase/supabase-js@2';
    script.onload = async () => {
        const { createClient } = window.supabase;
        supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        // Check for existing session
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            currentUser = session.user;
            await loadGameState();
            startGame();
        }
    };
    document.head.appendChild(script);
}

// ============================================
// AUTHENTICATION FUNCTIONS
// ============================================
async function handleLogin(email, password) {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });
        
        if (error) throw error;
        
        currentUser = data.user;
        
        // Load or create player profile
        await loadOrCreatePlayerProfile();
        
        return true;
    } catch (error) {
        console.error('Login error:', error.message);
        return false;
    }
}

async function handleRegister(name, email, password) {
    try {
        // First, sign up with Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    display_name: name
                }
            }
        });
        
        if (authError) throw authError;
        
        // Then create player profile
        const { error: profileError } = await supabase
            .from('players')
            .insert([
                {
                    id: authData.user.id,
                    email: email,
                    display_name: name,
                    password_hash: await hashPassword(password),
                    game_state: { ...defaultGameState, playerName: name }
                }
            ]);
            
        if (profileError) throw profileError;
        
        return true;
    } catch (error) {
        console.error('Registration error:', error.message);
        return false;
    }
}

async function hashPassword(password) {
    // Simple hash for demo - in production use proper hashing
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'newsbruh_salt');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================
// GAME STATE MANAGEMENT
// ============================================
async function loadOrCreatePlayerProfile() {
    if (!currentUser) return;
    
    try {
        // Check if player exists
        const { data, error } = await supabase
            .from('players')
            .select('*')
            .eq('id', currentUser.id)
            .single();
            
        if (error || !data) {
            // Create new player profile
            const { error: insertError } = await supabase
                .from('players')
                .insert([
                    {
                        id: currentUser.id,
                        email: currentUser.email,
                        display_name: currentUser.user_metadata?.display_name || currentUser.email.split('@')[0],
                        password_hash: 'temp_hash',
                        game_state: { ...defaultGameState, playerName: currentUser.user_metadata?.display_name || currentUser.email.split('@')[0] }
                    }
                ]);
                
            if (insertError) throw insertError;
            
            gameState = { ...defaultGameState, playerName: currentUser.user_metadata?.display_name || currentUser.email.split('@')[0] };
        } else {
            // Load existing game state
            if (data.game_state) {
                gameState = { ...defaultGameState, ...data.game_state };
                gameState.playerName = data.display_name;
            }
        }
    } catch (error) {
        console.error('Load profile error:', error);
    }
}

async function saveGameState() {
    if (!currentUser || !gameState) return;
    
    try {
        const { error } = await supabase
            .from('players')
            .update({
                game_state: gameState,
                total_news: gameState.news,
                total_bruh: gameState.bruh,
                last_login: new Date().toISOString()
            })
            .eq('id', currentUser.id);
            
        if (error) throw error;
        
        // Update leaderboard
        await updateLeaderboard();
    } catch (error) {
        console.error('Save game error:', error);
    }
}

// ============================================
// LEADERBOARD FUNCTIONS
// ============================================
async function updateLeaderboard() {
    if (!currentUser || !gameState) return;
    
    try {
        const level = calculateLevel(gameState.bruh, gameState.news);
        
        const { error } = await supabase
            .from('leaderboard')
            .upsert({
                player_id: currentUser.id,
                display_name: gameState.playerName,
                bruh_count: gameState.bruh,
                news_count: gameState.news,
                level: level,
                last_updated: new Date().toISOString()
            }, {
                onConflict: 'player_id'
            });
            
        if (error) throw error;
    } catch (error) {
        console.error('Leaderboard update error:', error);
    }
}

async function loadLeaderboard() {
    try {
        const { data, error } = await supabase
            .from('leaderboard')
            .select('*')
            .order('bruh_count', { ascending: false })
            .limit(20);
            
        if (error) throw error;
        
        leaderboardData = data || [];
        updateLeaderboardDisplay();
    } catch (error) {
        console.error('Load leaderboard error:', error);
    }
}

// ============================================
// CHAT FUNCTIONS
// ============================================
async function sendChatMessage(message) {
    if (!currentUser || !message.trim()) return;
    
    try {
        const { error } = await supabase
            .from('chat_messages')
            .insert([
                {
                    player_id: currentUser.id,
                    display_name: gameState.playerName,
                    message: message.trim(),
                    timestamp: new Date().toISOString()
                }
            ]);
            
        if (error) throw error;
    } catch (error) {
        console.error('Send chat error:', error);
    }
}

async function loadChatMessages() {
    try {
        const { data, error } = await supabase
            .from('chat_messages')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(50);
            
        if (error) throw error;
        
        chatMessages = data ? data.reverse() : [];
        updateChatDisplay();
    } catch (error) {
        console.error('Load chat error:', error);
    }
}

// ============================================
// GAME FUNCTIONS (from your original code)
// ============================================
function formatNumber(num) {
    if (typeof num !== 'number' || !isFinite(num)) return '0';
    if (num < 0) return '-' + formatNumber(-num);
    if (num < 1000) return Math.floor(num).toLocaleString();
    
    if (num >= 1e15) return (num / 1e15).toFixed(2) + "Qa";
    if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
    if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
    if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
    if (num >= 1e3) return (num / 1e3).toFixed(1) + "k";
    
    return Math.floor(num).toLocaleString();
}

function getMultiplier() {
    const bruh = gameState.bruh || 0;
    if (bruh > 1e12) {
        return (1 + Math.pow(Math.log10(bruh + 1), 2)) * gameState.boostMultiplier;
    }
    return (1 + bruh) * gameState.boostMultiplier;
}

function getCost(building) {
    const count = building.count || 0;
    const baseCost = building.baseCost || 15;
    
    if (count > 1000) {
        const exponent = Math.min(count, 10000) * 0.15;
        return Math.floor(baseCost * Math.pow(1.15, Math.min(exponent, 100)));
    }
    
    return Math.floor(baseCost * Math.pow(1.15, count));
}

function getCPS() {
    let base = gameState.buildings.reduce((acc, b) => acc + (b.count * b.baseCPS), 0);
    return base * getMultiplier();
}

function calculateLevel(bruh, news) {
    return Math.floor(Math.sqrt(bruh * 10 + news / 1000));
}

function manualClick(e) {
    e.preventDefault();
    
    const amount = 1 * getMultiplier();
    gameState.news += amount;
    
    // Visual feedback
    const btn = document.getElementById('print-btn');
    btn.classList.add('pulse');
    setTimeout(() => btn.classList.remove('pulse'), 300);
    
    updateUI();
    saveGameState();
}

// ============================================
// UI UPDATE FUNCTIONS
// ============================================
function updateUI() {
    document.getElementById('currency').textContent = formatNumber(gameState.news);
    document.getElementById('cps').textContent = formatNumber(getCPS());
    document.getElementById('multiplier').textContent = formatNumber(getMultiplier());
    document.getElementById('bruh-owned').textContent = formatNumber(gameState.bruh);
    document.getElementById('tap-value-display').textContent = `📰 +${formatNumber(1 * getMultiplier())} New per Tap`;
}

function updateLeaderboardDisplay() {
    const tbody = document.getElementById('leaderboard-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    leaderboardData.forEach((player, index) => {
        const row = document.createElement('tr');
        const rank = index + 1;
        
        let rankClass = '';
        if (rank === 1) rankClass = 'rank-1';
        else if (rank === 2) rankClass = 'rank-2';
        else if (rank === 3) rankClass = 'rank-3';
        
        const isCurrentUser = currentUser && player.display_name === gameState.playerName;
        
        row.innerHTML = `
            <td class="player-rank ${rankClass}">${rank}</td>
            <td class="player-name">${player.display_name} ${isCurrentUser ? ' (You)' : ''}</td>
            <td class="player-bruh">${formatNumber(player.bruh_count)}</td>
            <td class="player-level">${formatNumber(player.level)}</td>
        `;
        
        if (isCurrentUser) {
            row.style.backgroundColor = '#e8f5e8';
            row.style.fontWeight = 'bold';
        }
        
        tbody.appendChild(row);
    });
    
    document.getElementById('leaderboard-update-time').textContent = 
        `Updated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function updateChatDisplay() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    container.innerHTML = '';
    
    chatMessages.forEach(msg => {
        const messageDiv = document.createElement('div');
        const isSelf = currentUser && msg.display_name === gameState.playerName;
        
        messageDiv.className = `chat-message ${isSelf ? 'self' : 'other'}`;
        
        const time = new Date(msg.timestamp).toLocaleTimeString([], 
            { hour: '2-digit', minute: '2-digit' });
        
        let content = msg.message;
        content = content.replace(/@(\w+)/g, '<span class="tagged-player">@$1</span>');
        
        messageDiv.innerHTML = `
            <div class="message-sender">
                ${msg.display_name} 
                <span class="message-timestamp">${time}</span>
            </div>
            <div class="message-content">${content}</div>
        `;
        
        container.appendChild(messageDiv);
    });
    
    container.scrollTop = container.scrollHeight;
}

// ============================================
// GAME INITIALIZATION
// ============================================
function startGame() {
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('newspaper').style.display = 'flex';
    document.getElementById('user-info-display').style.display = 'flex';
    
    if (currentUser) {
        document.getElementById('user-email').textContent = currentUser.email;
    }
    
    init();
}

function init() {
    if (isInitialized) return;
    
    // Initialize UI
    updateUI();
    
    // Load data
    loadLeaderboard();
    loadChatMessages();
    
    // Start game loops
    startGameLoops();
    
    isInitialized = true;
}

function startGameLoops() {
    // Game update loop
    function gameLoop() {
        // Add CPS
        const cps = getCPS();
        if (cps > 0) {
            gameState.news += cps * 0.1;
            if (gameState.news > Number.MAX_SAFE_INTEGER) {
                gameState.news = Number.MAX_SAFE_INTEGER;
            }
        }
        
        // Update UI
        updateUI();
        
        // Auto-save every 30 seconds
        if (Date.now() % 30000 < 16) {
            saveGameState();
        }
        
        requestAnimationFrame(gameLoop);
    }
    
    // Start loops
    gameLoop();
    
    // Update leaderboard every 10 seconds
    setInterval(() => {
        loadLeaderboard();
    }, 10000);
    
    // Load chat every 5 seconds
    setInterval(() => {
        loadChatMessages();
    }, 5000);
    
    // Simulate player counts
    setInterval(() => {
        const onlineEl = document.getElementById('online-count');
        const totalEl = document.getElementById('total-count');
        
        let online = parseInt(onlineEl.textContent.replace(/,/g, '')) || 12403;
        let total = parseInt(totalEl.textContent.replace(/,/g, '')) || 842019;
        
        online += Math.floor(Math.random() * 100) - 50;
        total += Math.floor(Math.random() * 1000);
        
        online = Math.max(10000, online);
        total = Math.max(842000, total);
        
        onlineEl.textContent = online.toLocaleString();
        totalEl.textContent = total.toLocaleString();
    }, 30000);
}

// ============================================
// EXPORT FUNCTIONS TO GLOBAL SCOPE
// ============================================
window.manualClick = manualClick;
window.sendChatMessage = () => {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (message) {
        sendChatMessage(message);
        input.value = '';
    }
};

window.togglePassword = (fieldId) => {
    const field = document.getElementById(fieldId);
    field.type = field.type === 'password' ? 'text' : 'password';
};

// Start everything when page loads
document.addEventListener('DOMContentLoaded', () => {
    initializeSupabase();
});

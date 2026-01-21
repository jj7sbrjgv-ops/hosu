// ===== グローバル変数 =====
let stepCount = 0;
let isListening = false;
let lastAcceleration = 0;
let chart = null;
let deviceMotionListener = null;
const STEP_THRESHOLD = 20; // 加速度の閾値
const STORAGE_KEY = 'stepData';
const LAST_RESET_KEY = 'lastResetTime';
const MAX_DAYS = 30;
const BACKGROUND_STEP_KEY = 'backgroundSteps';
const BACKGROUND_TIME_KEY = 'backgroundTime';
const LISTENING_STATE_KEY = 'isListeningEnabled';

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    registerServiceWorker();
    setupEventListeners();
    loadTodaySteps();
    updateDisplay();
    updateStats();
    renderChart();
    renderHistory();
    updateTimeRemaining();
    
    // 毎秒更新
    setInterval(updateTimeRemaining, 1000);
    
    // 定期的にデータ更新
    setInterval(() => {
        checkAndResetSteps();
        updateStats();
    }, 60000); // 1分ごと
    
    // バックグラウンドステップを同期
    setInterval(syncBackgroundSteps, 5000); // 5秒ごと
});

// ===== Service Worker登録 =====
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('service-worker.js');
            console.log('Service Worker登録成功:', registration);
            
            // バックグラウンド同期をリクエスト
            if ('sync' in registration) {
                try {
                    await registration.sync.register('sync-steps');
                    console.log('バックグラウンド同期登録成功');
                } catch (e) {
                    console.log('バックグラウンド同期はサポートされていません');
                }
            }
        } catch (error) {
            console.log('Service Worker登録失敗:', error);
        }
    }
}

// ===== 初期化関数 =====
function initializeApp() {
    loadOrInitializeData();
    setupSensorPermission();
    updateDateDisplay();
    restoreListeningState();
}

function setupEventListeners() {
    const permissionBtn = document.getElementById('permissionBtn');
    const resetBtn = document.getElementById('resetBtn');
    
    if (permissionBtn) {
        permissionBtn.addEventListener('click', requestSensorPermission);
    }
    
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (confirm('本日のデータをリセットしますか？')) {
                resetTodaySteps();
            }
        });
    }
}

// ===== センサー権限 =====
function requestSensorPermission() {
    if (typeof DeviceMotionEvent === 'undefined') {
        alert('お使いのデバイスはモーションセンサーに対応していません。');
        return;
    }
    
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        // iOS 13+ 用
        DeviceMotionEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    enableSensorListening();
                }
            })
            .catch(console.error);
    } else {
        // Android や iOS 12 以下
        enableSensorListening();
    }
}

function setupSensorPermission() {
    const permissionBtn = document.getElementById('permissionBtn');
    const savedState = localStorage.getItem(LISTENING_STATE_KEY) === 'true';
    if (savedState && permissionBtn) {
        permissionBtn.disabled = true;
        permissionBtn.textContent = '✓ センサー有効';
    }
}

function restoreListeningState() {
    const savedState = localStorage.getItem(LISTENING_STATE_KEY) === 'true';
    if (savedState) {
        // ボタンUIを先に更新
        const permissionBtn = document.getElementById('permissionBtn');
        if (permissionBtn) {
            permissionBtn.disabled = true;
            permissionBtn.textContent = '✓ センサー有効';
        }
        // その後、センサーリッスンを開始
        setTimeout(() => {
            startListening();
        }, 100);
    }
}
function enableSensorListening() {
    startListening();
    localStorage.setItem(LISTENING_STATE_KEY, 'true');
    document.getElementById('permissionBtn').disabled = true;
    document.getElementById('permissionBtn').textContent = '✓ センサー有効';
}

// ===== リスニング機能 =====
function startListening() {
    if (isListening) return; // 既に実行中なら何もしない
    
    isListening = true;
    
    // デバイスモーションハンドラーを保持
    deviceMotionListener = handleDeviceMotion;
    
    // リスナーを設定
    window.addEventListener('devicemotion', deviceMotionListener, true);
    
    // バックグラウンドでの継続リッスンのため、ページ非表示時もリスナーを保持
    document.addEventListener('visibilitychange', handleVisibilityChange, false);
    
    console.log('✓ センサーリスニング開始');
}

function stopListening() {
    isListening = false;
    window.removeEventListener('devicemotion', deviceMotionListener, true);
    document.removeEventListener('visibilitychange', handleVisibilityChange, false);
}

// バックグラウンド時のハンドラー
function handleVisibilityChange() {
    if (document.hidden) {
        // バックグラウンド時：タイムスタンプを記録
        recordBackgroundTime();
    } else {
        // フォアグラウンド復帰時：バックグラウンド中のステップを同期
        syncBackgroundSteps();
    }
}

function recordBackgroundTime() {
    localStorage.setItem(BACKGROUND_TIME_KEY, Date.now().toString());
}

function syncBackgroundSteps() {
    const backgroundTime = localStorage.getItem(BACKGROUND_TIME_KEY);
    if (!backgroundTime) return;
    
    const backgroundSteps = parseInt(localStorage.getItem(BACKGROUND_STEP_KEY)) || 0;
    if (backgroundSteps > 0) {
        stepCount += backgroundSteps;
        saveCurrentSteps();
        updateDisplay();
        updateStats();
        renderHistory();
        
        // バックグラウンドステップをクリア
        localStorage.removeItem(BACKGROUND_STEP_KEY);
    }
    
    localStorage.removeItem(BACKGROUND_TIME_KEY);
}

// ===== 加速度検出 =====
function handleDeviceMotion(event) {
    checkAndResetSteps();
    
    const acceleration = event.acceleration;
    if (!acceleration) return;
    
    // 加速度の合計を計算
    const ax = acceleration.x || 0;
    const ay = acceleration.y || 0;
    const az = acceleration.z || 0;
    
    const totalAcceleration = Math.sqrt(ax * ax + ay * ay + az * az);
    
    // 閾値を超えた場合にカウント
    if (totalAcceleration > STEP_THRESHOLD && lastAcceleration <= STEP_THRESHOLD) {
        if (document.hidden) {
            // バックグラウンド時
            incrementBackgroundStep();
        } else {
            // フォアグラウンド時
            incrementStep();
        }
    }
    
    lastAcceleration = totalAcceleration;
}

function incrementStep() {
    stepCount++;
    saveCurrentSteps();
    updateDisplay();
    
    // 一定の歩数ごとに統計情報も更新
    if (stepCount % 10 === 0) {
        updateStats();
    }
}

function incrementBackgroundStep() {
    const backgroundSteps = parseInt(localStorage.getItem(BACKGROUND_STEP_KEY)) || 0;
    localStorage.setItem(BACKGROUND_STEP_KEY, (backgroundSteps + 1).toString());
}

// ===== ストレージ操作 =====
function loadOrInitializeData() {
    let data = localStorage.getItem(STORAGE_KEY);
    
    if (!data) {
        data = {};
        for (let i = 0; i < MAX_DAYS; i++) {
            const date = getDateString(new Date(Date.now() - i * 86400000));
            data[date] = 0;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } else {
        data = JSON.parse(data);
        // データの一貫性をチェック
        const today = getDateString(new Date());
        if (!data[today]) {
            data[today] = 0;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
}

function getTodayKey() {
    return getDateString(new Date());
}

function getDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function saveCurrentSteps() {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    const today = getTodayKey();
    data[today] = stepCount;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadTodaySteps() {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    const today = getTodayKey();
    stepCount = data[today] || 0;
}

function resetTodaySteps() {
    stepCount = 0;
    saveCurrentSteps();
    updateDisplay();
    updateStats();
    renderChart();
    renderHistory();
}

function checkAndResetSteps() {
    const now = new Date();
    const lastReset = localStorage.getItem(LAST_RESET_KEY);
    const lastResetDate = lastReset ? new Date(lastReset) : null;
    const today = getTodayKey();
    
    // 日付が変わった場合、本日分のデータを初期化
    if (!lastResetDate || getDateString(lastResetDate) !== today) {
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        
        // 古いデータを削除（31日目より古い）
        for (let i = MAX_DAYS; i < 365; i++) {
            const oldDate = getDateString(new Date(Date.now() - i * 86400000));
            delete data[oldDate];
        }
        
        // 本日が存在しない場合のみ初期化
        if (data[today] === undefined) {
            stepCount = 0;
            data[today] = 0;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            localStorage.setItem(LAST_RESET_KEY, now.toISOString());
        }
    }
}

// ===== 表示更新 =====
function updateDisplay() {
    const stepCountElement = document.getElementById('stepCount');
    if (stepCountElement) {
        stepCountElement.textContent = stepCount.toLocaleString();
    }
}

function updateDateDisplay() {
    const dateDisplay = document.getElementById('dateDisplay');
    if (dateDisplay) {
        const today = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateDisplay.textContent = today.toLocaleDateString('ja-JP', options);
    }
}

function updateTimeRemaining() {
    const element = document.getElementById('timeRemaining');
    if (!element) return;
    
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const timeLeft = tomorrow - now;
    const hours = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
    
    element.textContent = `リセットまで: ${hours}時間 ${minutes}分 ${seconds}秒`;
}

// ===== 統計情報 =====
function updateStats() {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    const today = getTodayKey();
    
    // 本日の歩数
    const todaySteps = data[today] || 0;
    document.getElementById('todaySteps').textContent = todaySteps.toLocaleString();
    
    // 取得可能なデータをフィルタリング
    const validDates = Object.keys(data)
        .filter(date => date && data[date] !== undefined)
        .sort()
        .reverse();
    
    // 平均歩数
    if (validDates.length > 0) {
        const total = validDates.reduce((sum, date) => sum + (data[date] || 0), 0);
        const avgSteps = Math.floor(total / validDates.length);
        document.getElementById('avgSteps').textContent = avgSteps.toLocaleString();
        
        // 最高記録
        const maxSteps = Math.max(...validDates.map(date => data[date] || 0));
        document.getElementById('maxSteps').textContent = maxSteps.toLocaleString();
        
        // 連続日数
        let streak = 0;
        for (const date of validDates) {
            if ((data[date] || 0) > 0) {
                streak++;
            } else {
                break;
            }
        }
        document.getElementById('streak').textContent = streak;
    }
}

// ===== チャート描画 =====
function renderChart() {
    const canvas = document.getElementById('stepChart');
    if (!canvas) return;
    
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    
    // 過去30日のデータを取得
    const labels = [];
    const chartData = [];
    
    for (let i = 29; i >= 0; i--) {
        const date = new Date(Date.now() - i * 86400000);
        const dateStr = getDateString(date);
        const dayLabel = date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
        
        labels.push(dayLabel);
        chartData.push(data[dateStr] || 0);
    }
    
    const ctx = canvas.getContext('2d');
    
    if (chart) {
        chart.destroy();
    }
    
    chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '歩数',
                data: chartData,
                backgroundColor: 'rgba(99, 102, 241, 0.5)',
                borderColor: 'rgb(99, 102, 241)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

// ===== 履歴リスト =====
function renderHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    
    // 過去30日のデータを取得
    const days = [];
    const maxSteps = Math.max(...Object.values(data).map(v => v || 0));
    
    for (let i = 0; i < MAX_DAYS; i++) {
        const date = new Date(Date.now() - i * 86400000);
        const dateStr = getDateString(date);
        const steps = data[dateStr] || 0;
        
        days.push({
            dateStr: dateStr,
            displayDate: date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' }),
            steps: steps,
            percentage: maxSteps > 0 ? (steps / maxSteps) * 100 : 0
        });
    }
    
    historyList.innerHTML = days.map(day => `
        <div class="history-item">
            <div>
                <div class="history-date">${day.displayDate}</div>
                <div class="history-bar">
                    <div class="history-bar-fill" style="width: ${day.percentage}%"></div>
                </div>
            </div>
            <div class="history-steps">${day.steps.toLocaleString()}</div>
        </div>
    `).join('');
}

// ===== イベントリスナー =====
// ページが見えるようになったときに更新
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        updateDisplay();
        updateStats();
        updateTimeRemaining();
        checkAndResetSteps();
        loadTodaySteps();
        renderChart();
        renderHistory();
        syncBackgroundSteps();
    }
});
